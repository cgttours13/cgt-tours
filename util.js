// Shared helpers
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'change-this-app-secret-in-render';
const num = v => Number(String(v == null ? 0 : v).replace(/,/g, '')) || 0;
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Sign the price-critical part of an item so the browser cannot change net prices. */
function signItem(item) {
  const core = JSON.stringify([item.kind, item.source, item.ref || '', item.net, item.currency]);
  return crypto.createHmac('sha256', SECRET).update(core).digest('hex').slice(0, 32);
}
function verifyItem(item) {
  if (item.source === 'manual') return true;
  return item.sig && item.sig === signItem(item);
}

async function httpJson(url, { method = 'GET', headers = {}, body, timeout = 45000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method, signal: ctl.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    if (!res.ok) {
      const msg = (data.error && (data.error.message || data.error.code || data.error)) || data.message || `HTTP ${res.status}`;
      const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); e.status = res.status; e.data = data; e.raw = text; throw e;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('Supplier did not answer in time. Please try again.'); x.status = 504; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsBetween = (a, b) => Math.max(0, Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5));

module.exports = { num, rid, sleep, signItem, verifyItem, httpJson, iso, addDays, nightsBetween, SECRET };
