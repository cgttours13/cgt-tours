/**
 * CGT Tours — data store
 * Google Sheet is the database (through the Apps Script web app in Code.gs).
 * Everything is kept in memory for speed and written through to the Sheet in the background.
 * Without SHEETS_WEBHOOK_URL it saves to a local file (data.json) — fine for testing only.
 */
const fs = require('fs');
const path = require('path');
const { sleep } = require('./util');

const URL_ = process.env.SHEETS_WEBHOOK_URL || '';
const KEY_ = process.env.SHEETS_WEBHOOK_SECRET || '';
const LOCAL = path.join(__dirname, 'data.json');
const TABLES = ['users', 'settings', 'quotations', 'destinations', 'logs'];

// Columns shown in each Google Sheet tab (the full record is kept in the "data" column)
const COLUMNS = {
  users: r => ({ username: r.username, name: r.name, role: r.role, agency: r.agency && r.agency.name || '', phone: r.agency && r.agency.phone || '', active: r.active ? 'Yes' : 'No', createdAt: r.createdAt }),
  quotations: r => ({ ref: r.ref, name: r.name, status: r.status, type: r.type, agent: r.ownerName, agency: r.agencyName, destinations: (r.trip && r.trip.destinations || []).map(d => d.city).join(', '), start: r.trip && r.trip.start, end: r.trip && r.trip.end, pax: r.trip ? `${r.trip.pax.adt}A ${r.trip.pax.chd}C ${r.trip.pax.inf}I` : '', total: r.pricing && r.pricing.total, cost: r.pricing && r.pricing.cost, profit: r.pricing && r.pricing.profit, currency: r.pricing && r.pricing.currency, createdAt: r.createdAt, updatedAt: r.updatedAt }),
  settings: () => ({}),
  destinations: r => ({ country: r.country, city: r.city, iata: r.iata, hbDest: r.hbDest, lat: r.lat, lng: r.lng, active: r.active === false ? 'No' : 'Yes' }),
  logs: r => ({ at: r.at, user: r.user, action: r.action, detail: r.detail }),
};

const mem = Object.fromEntries(TABLES.map(t => [t, new Map()]));
let ready = false;
const queue = [];
let busy = false;

async function hook(action, payload) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, redirect: 'follow', body: JSON.stringify({ secret: KEY_, action, payload }) });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error('Google Sheet web app did not return JSON. Check the deployment URL and access = Anyone.'); }
  if (!j.ok) throw new Error('Google Sheet: ' + (j.error || 'error'));
  return j;
}

async function load() {
  if (URL_) {
    for (let i = 0; i < 3; i++) {
      try {
        const j = await hook('dump', { tables: TABLES });
        for (const t of TABLES) for (const row of (j.tables && j.tables[t]) || []) {
          try { const o = JSON.parse(row.data); mem[t].set(String(o.id), o); } catch {}
        }
        ready = true; console.log('DB: loaded from Google Sheet', TABLES.map(t => `${t}=${mem[t].size}`).join(' '));
        return;
      } catch (e) { console.error('DB load failed:', e.message); await sleep(2000 * (i + 1)); }
    }
    throw new Error('Could not load data from the Google Sheet. Check SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_SECRET.');
  }
  if (fs.existsSync(LOCAL)) {
    const j = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
    for (const t of TABLES) for (const o of j[t] || []) mem[t].set(String(o.id), o);
  }
  ready = true; console.log('DB: local file mode (set SHEETS_WEBHOOK_URL to use Google Sheets)');
}

let saveTimer = null;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(LOCAL, JSON.stringify(Object.fromEntries(TABLES.map(t => [t, [...mem[t].values()]])))), 300);
}

async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const job = queue[0];
    try { await hook(job.action, job.payload); queue.shift(); }
    catch (e) { job.tries = (job.tries || 0) + 1; console.error('Sheet write failed (try ' + job.tries + '):', e.message); if (job.tries >= 5) queue.shift(); else await sleep(3000 * job.tries); }
  }
  busy = false;
}

function put(table, obj) {
  obj.id = String(obj.id);
  mem[table].set(obj.id, obj);
  if (URL_) {
    queue.push({ action: 'upsert', payload: { table, id: obj.id, cols: COLUMNS[table](obj), data: JSON.stringify(obj) } });
    pump();
  } else saveLocal();
  return obj;
}
function del(table, id) {
  mem[table].delete(String(id));
  if (URL_) { queue.push({ action: 'delete', payload: { table, id: String(id) } }); pump(); } else saveLocal();
}
const get = (table, id) => mem[table].get(String(id)) || null;
const all = table => [...mem[table].values()];
const find = (table, fn) => all(table).find(fn) || null;
const pending = () => queue.length;

module.exports = { load, put, del, get, all, find, pending, isReady: () => ready, usingSheets: !!URL_ };
