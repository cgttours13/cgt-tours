/**
 * CGT Tours — package costing CRM
 * Flights + hotels + transfers + sightseeing → quotation → WhatsApp / PDF → booking request → processing
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const auth = require('./auth');
const P = require('./pricing');
const prov = require('./providers');
const { rid, num, addDays, nightsBetween, verifyItem } = require('./util');

const app = express();
app.use(express.json({ limit: '3mb' }));
app.disable('x-powered-by');

/* ---------- static files (all files sit next to server.js) ---------- */
const STATIC = new Set(['index.html', 'app.js', 'app.css', 'print.html', 'airports.js', 'logo.png', 'favicon.png']);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:file', (req, res, next) => STATIC.has(req.params.file) && fs.existsSync(path.join(__dirname, req.params.file)) ? res.sendFile(path.join(__dirname, req.params.file)) : next());

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(req.method, req.path, e.message, e.data ? JSON.stringify(e.data).slice(0, 400) : '');
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message || 'Something went wrong' });
});
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
const now = () => new Date().toISOString();
const log = (user, action, detail) => db.put('logs', { id: Date.now().toString(36) + rid(2), at: now(), user: user ? user.username : '', action, detail: String(detail || '').slice(0, 300) });
const userName = u => u ? (u.name || u.username) : '';

/* ---------- auth ---------- */
app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.rateLimit(req.ip + '|' + username)) bad('Too many attempts. Wait 15 minutes.', 429);
  const u = db.find('users', x => x.username === String(username || '').trim().toLowerCase());
  if (!u || !u.active || !auth.checkPassword(password, u.password)) bad('Wrong username or password.', 401);
  u.lastLogin = now(); db.put('users', u); log(u, 'login', '');
  res.json({ token: auth.makeToken(u), user: auth.publicUser(u) });
}));

app.get('/api/me', auth.requireUser, (req, res) => {
  const s = P.settings();
  res.json({
    user: auth.publicUser(req.user),
    perms: { admin: req.user.role === 'admin', process: auth.can(req.user, 'processBookings'), seeNet: auth.can(req.user, 'seeNet'), seeAll: auth.can(req.user, 'seeAllQuotations') },
    company: s.company, quoteCurrencies: s.quoteCurrencies, currencies: Object.keys(s.fx), allowAgentProfit: s.allowAgentProfit, notes: s.notes, excludes: s.excludes, validityHours: s.validityHours,
    providers: Object.fromEntries(Object.entries(prov).map(([k, p]) => [k, { name: p.name, live: p.live() }])),
    destinations: db.all('destinations').filter(d => d.active !== false).sort((a, b) => (a.country + a.city).localeCompare(b.country + b.city)),
    storage: db.usingSheets ? 'Google Sheets' : 'Local file (testing)',
  });
});
app.post('/api/me/password', auth.requireUser, wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!auth.checkPassword(oldPassword, req.user.password)) bad('Current password is wrong.');
  if (String(newPassword || '').length < 8) bad('New password must be at least 8 characters.');
  req.user.password = auth.hashPassword(newPassword); req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
  db.put('users', req.user); res.json({ ok: true, token: auth.makeToken(req.user) });
}));

/* ---------- admin: users ---------- */
const admin = [auth.requireUser, auth.requirePerm('admin')];
const cleanUser = b => ({
  name: String(b.name || '').trim(), role: ['admin', 'staff', 'agent'].includes(b.role) ? b.role : 'agent', active: b.active !== false,
  canProcessBookings: !!b.canProcessBookings, canSeeNet: !!b.canSeeNet, canSeeAllQuotations: !!b.canSeeAllQuotations,
  margins: Object.fromEntries(['flight', 'hotel', 'transfer', 'activity', 'extra'].map(k => [k, b.margins && b.margins[k] !== '' && b.margins[k] != null ? num(b.margins[k]) : null]).filter(([, v]) => v !== null)),
  agency: { name: String((b.agency || {}).name || '').trim(), phone: String((b.agency || {}).phone || ''), email: String((b.agency || {}).email || ''), address: String((b.agency || {}).address || ''), website: String((b.agency || {}).website || ''), logo: String((b.agency || {}).logo || '').slice(0, 45000) },
  city: String(b.city || ''),
});
app.get('/api/admin/users', admin, (req, res) => res.json({ users: db.all('users').map(auth.publicUser).sort((a, b) => a.name.localeCompare(b.name)) }));
app.post('/api/admin/users', admin, wrap(async (req, res) => {
  const b = req.body || {}, username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) bad('Username: 3–30 letters/numbers, no spaces.');
  if (db.find('users', u => u.username === username)) bad('That username is taken.');
  if (String(b.password || '').length < 8) bad('Password must be at least 8 characters.');
  const u = { id: rid(6), username, password: auth.hashPassword(b.password), ...cleanUser(b), createdAt: now(), createdBy: req.user.username };
  db.put('users', u); log(req.user, 'user.create', username);
  res.json({ user: auth.publicUser(u) });
}));
app.put('/api/admin/users/:id', admin, wrap(async (req, res) => {
  const u = db.get('users', req.params.id); if (!u) bad('User not found', 404);
  const b = req.body || {}, c = cleanUser({ ...auth.publicUser(u), ...b, agency: { ...(u.agency || {}), ...(b.agency || {}) } });
  if (u.id === req.user.id && (c.role !== 'admin' || !c.active)) bad('You cannot remove your own admin access.');
  Object.assign(u, c, { updatedAt: now() });
  if (b.password) { if (String(b.password).length < 8) bad('Password must be at least 8 characters.'); u.password = auth.hashPassword(b.password); u.tokenVersion = (u.tokenVersion || 0) + 1; }
  db.put('users', u); log(req.user, 'user.update', u.username);
  res.json({ user: auth.publicUser(u) });
}));

/* ---------- admin: settings & destinations ---------- */
app.get('/api/admin/settings', admin, (req, res) => res.json({ settings: P.settings(), storage: db.usingSheets ? 'Google Sheets' : 'Local file', pendingWrites: db.pending() }));
app.put('/api/admin/settings', admin, wrap(async (req, res) => {
  const s = P.settings(), b = req.body || {};
  if (b.company) s.company = { ...s.company, ...b.company, logo: String((b.company.logo != null ? b.company.logo : s.company.logo) || '').slice(0, 45000) };
  if (b.margins) for (const k of Object.keys(s.margins)) if (b.margins[k] !== undefined) s.margins[k] = num(b.margins[k]);
  if (b.fx) { s.fx = { PKR: 1 }; for (const [k, v] of Object.entries(b.fx)) if (/^[A-Z]{3}$/.test(k) && num(v) > 0) s.fx[k] = num(v); s.fx.PKR = 1; }
  if (Array.isArray(b.quoteCurrencies)) s.quoteCurrencies = b.quoteCurrencies.filter(c => s.fx[c]);
  if (b.allowAgentProfit !== undefined) s.allowAgentProfit = !!b.allowAgentProfit;
  if (b.validityHours) s.validityHours = num(b.validityHours);
  if (Array.isArray(b.notes)) s.notes = b.notes.map(String).filter(Boolean);
  if (Array.isArray(b.excludes)) s.excludes = b.excludes.map(String).filter(Boolean);
  s.fxUpdatedAt = b.fx ? now() : s.fxUpdatedAt;
  db.put('settings', s); log(req.user, 'settings', 'updated');
  res.json({ settings: s });
}));
app.get('/api/admin/destinations', admin, (req, res) => res.json({ destinations: db.all('destinations').sort((a, b) => (a.country + a.city).localeCompare(b.country + b.city)) }));
app.post('/api/admin/destinations', admin, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.city || !b.country || !/^[A-Z]{3}$/.test(String(b.iata || '').toUpperCase())) bad('Country, city and a 3-letter airport code are required.');
  const d = { id: b.id || 'D' + rid(3), country: b.country.trim(), city: b.city.trim(), iata: b.iata.toUpperCase(), hbDest: String(b.hbDest || b.iata).toUpperCase(), lat: num(b.lat), lng: num(b.lng), radius: num(b.radius) || 15, active: b.active !== false };
  db.put('destinations', d); res.json({ destination: d });
}));
app.delete('/api/admin/destinations/:id', admin, (req, res) => { db.del('destinations', req.params.id); res.json({ ok: true }); });

/* ---------- quotations ---------- */
const STATUS = ['Draft', 'Quoted', 'Booking Requested', 'Processing', 'Confirmed', 'Cancelled'];
const canSee = (u, q) => u.role === 'admin' || q.ownerId === u.id || auth.can(u, 'seeAllQuotations') || (auth.can(u, 'processBookings') && ['Booking Requested', 'Processing', 'Confirmed'].includes(q.status));
const canEdit = (u, q) => (q.ownerId === u.id || u.role === 'admin') && ['Draft', 'Quoted'].includes(q.status);
function loadQuote(req, edit) {
  const q = db.get('quotations', req.params.id);
  if (!q || !canSee(req.user, q)) bad('Quotation not found', 404);
  if (edit && !canEdit(req.user, q)) bad('This quotation is locked (booking already requested). Duplicate it to make changes.', 409);
  return q;
}
function reprice(q) { const owner = db.get('users', q.ownerId) || null; q.pricing = P.price(q, owner); return q; }
const view = (req, q) => P.forViewer(reprice(q), auth.can(req.user, 'seeNet'));
const save = q => { q.updatedAt = now(); reprice(q); return db.put('quotations', q); };

function nextRef() {
  const d = new Date(), ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const n = db.all('quotations').filter(q => String(q.ref || '').startsWith(`CGT-${ym}-`)).length + 1;
  return `CGT-${ym}-${String(n).padStart(4, '0')}`;
}

/** Build a clean trip from the form: destinations follow each other night by night. */
function buildTrip(b) {
  const t = b || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.start || '')) bad('Choose the travel start date.');
  const dests = (t.destinations || []).filter(d => d && d.destId);
  if (!dests.length) bad('Add at least one destination.');
  let cur = t.start;
  const destinations = dests.map(d => {
    const m = db.get('destinations', d.destId); if (!m) bad('Unknown destination');
    const nights = Math.max(1, Math.min(30, +d.nights || 1));
    const x = { destId: m.id, city: m.city, country: m.country, iata: m.iata, hbDest: m.hbDest, lat: m.lat, lng: m.lng, radius: m.radius, nights, checkIn: cur, checkOut: addDays(cur, nights) };
    cur = x.checkOut; return x;
  });
  const rooms = (t.rooms || [{ adults: 2, childAges: [] }]).slice(0, 6).map(r => ({ adults: Math.max(1, Math.min(6, +r.adults || 1)), childAges: (r.childAges || []).slice(0, 4).map(a => Math.max(0, Math.min(17, +a || 0))) }));
  const ages = rooms.flatMap(r => r.childAges);
  const pax = { adt: rooms.reduce((s, r) => s + r.adults, 0) + ages.filter(a => a >= 12).length, chd: ages.filter(a => a >= 2 && a < 12).length, inf: ages.filter(a => a < 2).length };
  return { origin: String(t.origin || 'LHE').toUpperCase().slice(0, 3), start: t.start, end: cur, nationality: t.nationality || 'PK', residence: t.residence || 'PK', destinations, rooms, pax, nights: nightsBetween(t.start, cur) };
}
const TYPES = { T: 'Ticket only', TH: 'Ticket + Hotel', FULL: 'Ticket + Hotel + Transfers + Sightseeing', LAND: 'Hotel + Transfers + Sightseeing' };

app.get('/api/quotes', auth.requireUser, (req, res) => {
  const { status, q: text, mine } = req.query;
  const list = db.all('quotations').filter(q => canSee(req.user, q) && (!status || q.status === status) && (!mine || q.ownerId === req.user.id)
    && (!text || `${q.ref} ${q.name} ${q.ownerName} ${q.agencyName} ${(q.trip.destinations || []).map(d => d.city).join(' ')}`.toLowerCase().includes(String(text).toLowerCase())))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(q => { reprice(q); return { id: q.id, ref: q.ref, name: q.name, status: q.status, type: q.type, typeLabel: TYPES[q.type], owner: q.ownerName, agency: q.agencyName, countries: [...new Set(q.trip.destinations.map(d => d.country))].join(', '), cities: q.trip.destinations.map(d => d.city).join(', '), start: q.trip.start, end: q.trip.end, pax: q.trip.pax, total: q.pricing.total, perPerson: q.pricing.perPerson, currency: q.pricing.currency, createdAt: q.createdAt, ...(auth.can(req.user, 'seeNet') ? { profitPKR: q.pricing.profitPKR } : {}) }; });
  res.json({ quotes: list });
});
app.get('/api/quotes/:id', auth.requireUser, wrap(async (req, res) => res.json({ quote: view(req, loadQuote(req)), canEdit: canEdit(req.user, loadQuote(req)) })));

app.post('/api/quotes', auth.requireUser, wrap(async (req, res) => {
  const b = req.body || {};
  const q = { id: rid(6), ref: nextRef(), name: String(b.name || '').trim() || 'New quotation', type: TYPES[b.type] ? b.type : 'FULL', status: 'Draft', currency: 'PKR',
    ownerId: req.user.id, ownerName: userName(req.user), agencyName: (req.user.agency && req.user.agency.name) || '', trip: buildTrip(b.trip), agentProfit: { type: 'fixed', value: 0 },
    items: { flights: [], hotels: [], transfers: [], activities: [], extras: [] }, notes: '', createdAt: now() };
  save(q); res.json({ quote: view(req, q) });
}));
app.put('/api/quotes/:id', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true), b = req.body || {};
  if (b.name !== undefined) q.name = String(b.name).trim().slice(0, 80) || q.name;
  if (b.trip) {
    const t = buildTrip(b.trip), changed = JSON.stringify([t.start, t.destinations.map(d => [d.destId, d.nights]), t.rooms]) !== JSON.stringify([q.trip.start, q.trip.destinations.map(d => [d.destId, d.nights]), q.trip.rooms]);
    if (changed && P.allItems(q).some(i => i.kind !== 'extra') && !b.clearItems) bad('Dates, destinations or rooms changed — the selected services no longer match. Confirm to clear them.', 409);
    if (changed && b.clearItems) q.items = { flights: [], hotels: [], transfers: [], activities: [], extras: q.items.extras || [] };
    q.trip = t;
  }
  if (b.type && TYPES[b.type]) q.type = b.type;
  if (b.currency && P.settings().quoteCurrencies.includes(b.currency)) q.currency = b.currency;
  if (b.agentProfit) q.agentProfit = { type: b.agentProfit.type === 'percent' ? 'percent' : 'fixed', value: Math.max(0, num(b.agentProfit.value)) };
  if (b.notes !== undefined) q.notes = String(b.notes).slice(0, 2000);
  if (b.status === 'Quoted' || b.status === 'Draft') q.status = b.status;
  save(q); res.json({ quote: view(req, q) });
}));
app.delete('/api/quotes/:id', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true);
  if (q.ownerId !== req.user.id && req.user.role !== 'admin') bad('Not allowed', 403);
  db.del('quotations', q.id); log(req.user, 'quote.delete', q.ref); res.json({ ok: true });
}));
app.post('/api/quotes/:id/duplicate', auth.requireUser, wrap(async (req, res) => {
  const src = loadQuote(req), q = JSON.parse(JSON.stringify(src));
  Object.assign(q, { id: rid(6), ref: nextRef(), name: src.name + ' (copy)', status: 'Draft', ownerId: req.user.id, ownerName: userName(req.user), agencyName: (req.user.agency && req.user.agency.name) || '', createdAt: now(), booking: undefined });
  for (const it of P.allItems(q)) delete it.booking;
  save(q); res.json({ quote: view(req, q) });
}));

/* ---------- searches (results kept on the server; the browser only sees selling prices) ---------- */
const searches = new Map();
setInterval(() => { const cut = Date.now() - 90 * 60e3; for (const [k, v] of searches) if (v.at < cut) searches.delete(k); }, 600e3).unref();
const keep = (service, quoteId, q, data) => { const id = rid(6); searches.set(id, { service, quoteId, q, data, at: Date.now() }); return id; };
const getSearch = (id, service) => { const s = searches.get(id); if (!s || s.service !== service) bad('Search results expired — please search again.', 410); return s; };
const sell = (req, kind, net, currency) => P.sellPKR({ kind, net, currency }, db.get('users', req.quoteOwner) || req.user);
const shownNet = (req, net, currency) => auth.can(req.user, 'seeNet') ? { net, netCurrency: currency } : {};

function destOf(q, i) { const d = q.trip.destinations[+i || 0]; if (!d) bad('Unknown destination'); return d; }

app.post('/api/quotes/:id/search/flights', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true); req.quoteOwner = q.ownerId;
  const b = req.body || {};
  const legs = (b.legs || []).filter(l => /^[A-Z]{3}$/.test(l.from) && /^[A-Z]{3}$/.test(l.to) && /^\d{4}-\d{2}-\d{2}$/.test(l.date)).slice(0, 6);
  if (!legs.length) bad('Add at least one flight (from, to, date).');
  const sq = { legs, adt: q.trip.pax.adt, chd: q.trip.pax.chd, inf: q.trip.pax.inf, cabin: b.cabin || 'Y', nonStop: !!b.nonStop, airline: b.airline || '' };
  const r = await prov.flights.search(sq);
  const sid = keep('flights', q.id, sq, r.flights);
  res.json({ searchId: sid, source: r.source, warnings: r.warnings, flights: r.flights.map((f, i) => ({ idx: i, legs: f.legs, airline: f.airline, refundable: f.refundable, baggage: f.baggage, sell: sell(req, 'flight', f.net, f.currency), ...shownNet(req, f.net, f.currency) })) });
}));
app.post('/api/quotes/:id/search/hotels', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true); req.quoteOwner = q.ownerId;
  const di = +req.body.destIdx || 0, d = destOf(q, di);
  const sq = { dest: d, checkIn: d.checkIn, checkOut: d.checkOut, rooms: q.trip.rooms };
  const r = await prov.hotels.search(sq);
  const sid = keep('hotels', q.id, { ...sq, destIdx: di }, r.hotels);
  res.json({ searchId: sid, source: r.source, hotels: r.hotels.map((h, i) => ({ idx: i, code: h.code, name: h.name, stars: h.stars, zone: h.zone, city: h.city, images: h.images, description: h.description, address: h.address, nights: h.nights,
    from: h.groups.reduce((s, g) => s + sell(req, 'hotel', g.options[0].net, h.currency), 0),
    groups: h.groups.map(g => ({ label: g.label, options: g.options.map(o => ({ id: o.id, roomName: o.roomName, board: o.board, refundable: o.refundable, cancel: o.cancel, offers: o.offers, sell: sell(req, 'hotel', o.net, h.currency), ...shownNet(req, o.net, h.currency) })) })) })) });
}));
function transferPoints(q, di) {
  const d = destOf(q, di);
  const hotel = (q.items.hotels || []).find(h => h.destIdx === di && h.source === 'hotelbeds' && h.hotelCode);
  const hotelPt = hotel ? { type: 'ATLAS', code: String(hotel.hotelCode), label: hotel.title } : { type: 'GPS', lat: d.lat, lng: d.lng, label: `${d.city} hotel (city centre)` };
  const airport = { type: 'IATA', code: d.iata, label: `${d.city} Airport (${d.iata})` };
  // flight times: arrival into this city / departure out of it
  const segs = (q.items.flights || []).flatMap(f => (f.legs || []).flatMap(l => l.segments || []));
  const arr = segs.find(s => s.to === d.iata && s.arrDate && s.arrDate.split('-').reverse().join('-') === d.checkIn);
  const dep = segs.find(s => s.from === d.iata && s.depDate && s.depDate.split('-').reverse().join('-') === d.checkOut);
  const t = x => `${x.slice(0, 2)}:${x.slice(2, 4)}:00`;
  const minus3 = x => { const m = (+x.slice(0, 2)) * 60 + (+x.slice(2, 4)) - 180; const v = Math.max(m, 0); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`; };
  return { d, hotelPt, airport, outTime: arr ? t(arr.arrTime) : '14:00:00', backTime: dep ? minus3(dep.depTime) : '10:00:00', hotelChosen: !!hotel, arrFlight: arr ? arr.mktg + arr.flightNo : '', depFlight: dep ? dep.mktg + dep.flightNo : '' };
}
app.post('/api/quotes/:id/search/transfers', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true); req.quoteOwner = q.ownerId;
  const di = +req.body.destIdx || 0, p = transferPoints(q, di);
  const kids = q.trip.rooms.flatMap(r => r.childAges);
  const sq = { from: p.airport, to: p.hotelPt, outbound: `${p.d.checkIn}T${req.body.outTime || p.outTime}`, inbound: `${p.d.checkOut}T${req.body.backTime || p.backTime}`, adults: q.trip.pax.adt, children: kids.filter(a => a >= 3 && a < 13).length, infants: kids.filter(a => a < 3).length, city: p.d.city };
  const r = await prov.transfers.search(sq);
  const sid = keep('transfers', q.id, { ...sq, destIdx: di, flights: { arr: p.arrFlight, dep: p.depFlight } }, r.transfers);
  res.json({ searchId: sid, source: r.source, hotelChosen: p.hotelChosen, times: { out: sq.outbound, back: sq.inbound },
    transfers: r.transfers.map((t, i) => ({ idx: i, direction: t.direction, type: t.type, vehicle: t.vehicle, category: t.category, title: t.title, fromLabel: t.fromLabel, toLabel: t.toLabel, date: t.date, time: t.time, maxPax: t.maxPax, image: t.image, description: t.description, cancel: t.cancel, sell: sell(req, 'transfer', t.net, t.currency), ...shownNet(req, t.net, t.currency) })) });
}));
app.post('/api/quotes/:id/search/activities', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true); req.quoteOwner = q.ownerId;
  const di = +req.body.destIdx || 0, d = destOf(q, di);
  const sq = { dest: d, from: d.checkIn, to: addDays(d.checkOut, -1) < d.checkIn ? d.checkIn : addDays(d.checkOut, -1), adults: q.trip.pax.adt, childAges: q.trip.rooms.flatMap(r => r.childAges).filter(a => a < 12) };
  const r = await prov.activities.search(sq);
  const sid = keep('activities', q.id, { ...sq, destIdx: di }, r.activities);
  res.json({ searchId: sid, source: r.source, days: [...Array(Math.max(1, d.nights))].map((_, i) => addDays(d.checkIn, i)),
    activities: r.activities.map((a, i) => ({ idx: i, code: a.code, title: a.title, image: a.image, description: a.description, duration: a.duration, from: sell(req, 'activity', a.fromNet, a.currency), ...shownNet(req, a.fromNet, a.currency) })) });
}));
app.post('/api/quotes/:id/activity-options', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true); req.quoteOwner = q.ownerId;
  const s = getSearch(req.body.searchId, 'activities'), a = s.data[+req.body.idx]; if (!a) bad('Tour not found');
  const r = await prov.activities.options(a.code, req.body.date, s.q);
  s.opts = s.opts || {}; s.opts[`${req.body.idx}|${req.body.date}`] = r.options;
  res.json({ options: r.options.map(o => ({ id: o.id, modality: o.modality, cancel: o.cancel, duration: o.duration, languages: o.languages, sell: sell(req, 'activity', o.net, o.currency), ...shownNet(req, o.net, o.currency) })) });
}));

/* ---------- add / remove items ---------- */
app.post('/api/quotes/:id/items', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true), b = req.body || {};
  const s = getSearch(b.searchId, b.service);
  if (s.quoteId !== q.id) bad('Search belongs to another quotation');
  let it;
  if (b.service === 'flights') { const f = s.data[+b.idx]; if (!f) bad('Flight not found'); it = prov.flights.makeItem(f, s.q); q.items.flights = [it]; }
  else if (b.service === 'hotels') { const h = s.data[+b.idx]; if (!h) bad('Hotel not found'); it = prov.hotels.makeItem(h, b.picks || [], s.q, s.q.destIdx); q.items.hotels = q.items.hotels.filter(x => x.destIdx !== s.q.destIdx).concat(it); }
  else if (b.service === 'transfers') {
    const t = s.data[+b.idx]; if (!t) bad('Transfer not found');
    it = prov.transfers.makeItem(t, { ...s.q, outbound: t.direction === 'DEPARTURE' ? s.q.inbound : s.q.outbound, from: t.direction === 'DEPARTURE' ? s.q.to : s.q.from, to: t.direction === 'DEPARTURE' ? s.q.from : s.q.to }, s.q.destIdx);
    it.flightCode = t.direction === 'DEPARTURE' ? s.q.flights.dep : s.q.flights.arr;
    it.search = { from: s.q.from, to: s.q.to, outbound: s.q.outbound, inbound: s.q.inbound, adults: s.q.adults, children: s.q.children, infants: s.q.infants }; // same round-trip search for re-booking
    q.items.transfers = q.items.transfers.filter(x => !(x.destIdx === s.q.destIdx && x.direction === it.direction)).concat(it);
  } else if (b.service === 'activities') {
    const a = s.data[+b.idx]; const opts = (s.opts || {})[`${b.idx}|${b.date}`]; const o = opts && opts.find(x => x.id === b.optionId);
    if (!a || !o) bad('Option expired — check options again.');
    it = prov.activities.makeItem(a, o, b.date, s.q, s.q.destIdx); q.items.activities.push(it);
  } else bad('Unknown service');
  it.id = rid(4); it.addedBy = req.user.username;
  save(q); res.json({ quote: view(req, q) });
}));
app.post('/api/quotes/:id/manual', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true), b = req.body || {};
  const kind = ['flight', 'hotel', 'transfer', 'activity', 'extra'].includes(b.kind) ? b.kind : 'extra';
  const cur = String(b.currency || 'PKR').toUpperCase(); P.rate(cur);
  let net = num(b.amount);
  const perPax = b.perPax ? { adt: num(b.perPax.adt), chd: num(b.perPax.chd), inf: num(b.perPax.inf) } : null;
  if (perPax) net = perPax.adt * q.trip.pax.adt + perPax.chd * q.trip.pax.chd + perPax.inf * q.trip.pax.inf;
  if (net <= 0) bad('Enter an amount.');
  const it = { id: rid(4), kind, source: 'manual', title: String(b.title || 'Service').slice(0, 120), details: String(b.details || '').slice(0, 500), destIdx: b.destIdx != null ? +b.destIdx : null, date: b.date || '', perPax, net, currency: cur, sellIsFinal: !!b.sellIsFinal, addedBy: req.user.username };
  const key = { flight: 'flights', hotel: 'hotels', transfer: 'transfers', activity: 'activities', extra: 'extras' }[kind];
  if (kind === 'flight') q.items.flights = [it]; else q.items[key].push(it);
  save(q); res.json({ quote: view(req, q) });
}));
app.delete('/api/quotes/:id/items/:itemId', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true);
  for (const k of Object.keys(q.items)) q.items[k] = q.items[k].filter(i => i.id !== req.params.itemId);
  save(q); res.json({ quote: view(req, q) });
}));
app.put('/api/quotes/:id/items/:itemId', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true), it = P.allItems(q).find(i => i.id === req.params.itemId); if (!it) bad('Item not found', 404);
  if (req.body.note !== undefined) it.note = String(req.body.note).slice(0, 300);
  save(q); res.json({ quote: view(req, q) });
}));

/* ---------- booking request & processing ---------- */
app.post('/api/quotes/:id/request-booking', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req, true), b = req.body || {};
  const pax = (b.pax || []).map(p => ({ paxType: ['ADT', 'CHD', 'INF'].includes(p.paxType) ? p.paxType : 'ADT', salutation: String(p.salutation || ''), givenName: String(p.givenName || '').trim().toUpperCase(), surName: String(p.surName || '').trim().toUpperCase(), gender: p.gender || (['Mr', 'Mstr'].includes(p.salutation) ? 'Male' : 'Female'), birthDate: p.birthDate || '', nationality: p.nationality || 'PK', passportNo: String(p.passportNo || '').toUpperCase(), passportExpiry: p.passportExpiry || '' }));
  const need = q.trip.pax.adt + q.trip.pax.chd + q.trip.pax.inf;
  if (pax.length !== need || pax.some(p => !p.givenName || !p.surName)) bad(`Enter names for all ${need} travellers.`);
  if (!b.contact || !b.contact.phone) bad('Enter a contact phone number.');
  if (!P.allItems(q).length) bad('The quotation is empty.');
  for (const it of P.allItems(q)) if (!verifyItem(it)) bad('A price in this quotation was changed outside the system. Remove and add the item again.');
  q.status = 'Booking Requested';
  q.booking = { requestedAt: now(), requestedBy: req.user.username, pax, contact: { name: String(b.contact.name || ''), phone: String(b.contact.phone), email: String(b.contact.email || '') }, remarks: String(b.remarks || '').slice(0, 1000), log: [] };
  save(q); log(req.user, 'booking.request', q.ref);
  res.json({ quote: view(req, q) });
}));
const proc = [auth.requireUser, auth.requirePerm('processBookings')];
app.get('/api/bookings', proc, (req, res) => {
  const list = db.all('quotations').filter(q => ['Booking Requested', 'Processing', 'Confirmed', 'Cancelled'].includes(q.status) && q.booking).sort((a, b) => (b.booking.requestedAt || '').localeCompare(a.booking.requestedAt || ''))
    .map(q => { reprice(q); const items = P.allItems(q); return { id: q.id, ref: q.ref, name: q.name, status: q.status, owner: q.ownerName, agency: q.agencyName, cities: q.trip.destinations.map(d => d.city).join(', '), start: q.trip.start, pax: q.trip.pax, total: q.pricing.total, currency: q.pricing.currency, requestedAt: q.booking.requestedAt, done: items.filter(i => i.booking && /CONFIRM|HK|TICKET|MANUAL/i.test(i.booking.status)).length, items: items.length }; });
  res.json({ bookings: list });
});
app.post('/api/quotes/:id/process/:itemId', proc, wrap(async (req, res) => {
  const q = db.get('quotations', req.params.id); if (!q || !q.booking) bad('Booking not found', 404);
  const it = P.allItems(q).find(i => i.id === req.params.itemId); if (!it) bad('Item not found', 404);
  const a = req.body.action, pax = q.booking.pax, lead = pax[0], c = q.booking.contact;
  const holder = { name: lead.givenName, surname: lead.surName, email: c.email || P.settings().company.email || 'booking@cgt.pk', phone: c.phone, remark: q.booking.remarks };
  const guests = pax.map(p => ({ name: p.givenName, surname: p.surName }));
  let r;
  if (a === 'manual') {
    r = { status: req.body.status || 'CONFIRMED (manual)', supplierRef: String(req.body.supplierRef || ''), pnr: String(req.body.pnr || ''), tickets: String(req.body.tickets || '') };
    if (req.body.net) { r.net = num(req.body.net); r.currency = it.currency; }
  } else if (a === 'book') {
    if (it.source === 'manual') bad('Manual item — confirm it with the supplier and use "Mark confirmed".');
    if (it.booking && /CONFIRM|HK/i.test(it.booking.status)) bad('Already booked.');
    if (it.kind === 'hotel') r = await prov.hotels.book(it, guests, holder, q.ref);
    else if (it.kind === 'transfer') { if (req.body.flightCode) it.flightCode = String(req.body.flightCode).toUpperCase().replace(/\s/g, ''); if (!it.flightCode && it.source !== 'demo') bad('Enter the client\'s flight number for this transfer.'); r = await prov.transfers.book(it, holder, it.flightCode, q.ref); }
    else if (it.kind === 'activity') r = await prov.activities.book(it, guests, holder, q.ref);
    else if (it.kind === 'flight') r = await prov.flights.book(it, pax, c);
    else bad('Nothing to book for this item');
  } else if (a === 'issue') {
    if (it.kind !== 'flight' || !it.booking || !it.booking.supplierRef) bad('Hold the flight first.');
    r = { ...it.booking, ...(await prov.flights.issue(it.booking.supplierRef, it.booking.meta || {})) };
  } else if (a === 'cancel') {
    if (!it.booking || !it.booking.supplierRef) r = { status: 'CANCELLED' };
    else if (it.kind === 'flight') r = { ...it.booking, ...(await prov.flights.cancel(it.booking.supplierRef, it.booking.meta || {})) };
    else r = { ...it.booking, ...(await ({ hotel: prov.hotels, transfer: prov.transfers, activity: prov.activities }[it.kind]).cancel(it.booking.supplierRef)) };
  } else bad('Unknown action');
  const raw = r.raw; delete r.raw;
  const priceChange = r.net && Math.abs(num(r.net) - num(it.net)) > 0.01 ? { from: it.net, to: r.net, currency: r.currency || it.currency } : null;
  it.booking = { ...r, by: req.user.username, at: now() };
  if (priceChange) it.booking.priceChange = priceChange;
  q.booking.log.push({ at: now(), by: req.user.username, item: it.title, action: a, status: r.status, ref: r.supplierRef || r.pnr || '' });
  if (q.status === 'Booking Requested') q.status = 'Processing';
  q.updatedAt = now(); db.put('quotations', q); log(req.user, 'booking.' + a, `${q.ref} ${it.title} ${r.status}`);
  res.json({ quote: view(req, q), result: { ...r, raw: auth.can(req.user, 'seeNet') ? raw : undefined } });
}));
app.post('/api/quotes/:id/status', proc, wrap(async (req, res) => {
  const q = db.get('quotations', req.params.id); if (!q) bad('Not found', 404);
  if (!['Processing', 'Confirmed', 'Cancelled', 'Quoted'].includes(req.body.status)) bad('Bad status');
  q.status = req.body.status; if (q.booking) q.booking.log.push({ at: now(), by: req.user.username, action: 'status', status: q.status });
  save(q); log(req.user, 'booking.status', `${q.ref} ${q.status}`); res.json({ quote: view(req, q) });
}));

/* ---------- print (PDF) data ---------- */
app.get('/api/quotes/:id/print', auth.requireUser, wrap(async (req, res) => {
  const q = loadQuote(req), owner = db.get('users', q.ownerId) || req.user, s = P.settings();
  const brand = owner.agency && owner.agency.name ? owner.agency : s.company;
  res.json({ quote: P.forViewer(reprice(q), false), brand, company: s.company, notes: s.notes, excludes: s.excludes, validityHours: s.validityHours, owner: { name: owner.name, phone: (owner.agency || {}).phone } });
}));

/* ---------- dashboard ---------- */
app.get('/api/dashboard', auth.requireUser, (req, res) => {
  const mineOnly = !(req.user.role === 'admin' || auth.can(req.user, 'seeAllQuotations'));
  const qs = db.all('quotations').filter(q => !mineOnly || q.ownerId === req.user.id);
  const month = new Date().toISOString().slice(0, 7), today = new Date().toISOString().slice(0, 10);
  const inMonth = qs.filter(q => q.createdAt.startsWith(month));
  qs.forEach(reprice);
  const confirmed = inMonth.filter(q => q.status === 'Confirmed');
  const byDest = {}; inMonth.forEach(q => q.trip.destinations.forEach(d => byDest[d.country] = (byDest[d.country] || 0) + 1));
  const byDay = {}; inMonth.forEach(q => { const d = q.createdAt.slice(8, 10); byDay[d] = (byDay[d] || 0) + 1; });
  const byAgent = {}; if (!mineOnly) inMonth.forEach(q => { byAgent[q.ownerName] = (byAgent[q.ownerName] || 0) + 1; });
  res.json({
    month, quotations: inMonth.length, today: qs.filter(q => q.createdAt.startsWith(today)).length,
    pending: qs.filter(q => q.status === 'Booking Requested').length, processing: qs.filter(q => q.status === 'Processing').length,
    confirmed: confirmed.length, confirmedValuePKR: confirmed.reduce((s, q) => s + q.pricing.totalPKR, 0),
    ...(auth.can(req.user, 'seeNet') ? { profitPKR: confirmed.reduce((s, q) => s + q.pricing.profitPKR, 0) } : {}),
    pax: inMonth.reduce((s, q) => s + q.trip.pax.adt + q.trip.pax.chd + q.trip.pax.inf, 0),
    byDest, byDay, byAgent,
    recent: qs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(q => ({ id: q.id, ref: q.ref, name: q.name, status: q.status, cities: q.trip.destinations.map(d => d.city).join(', '), start: q.trip.start, total: q.pricing.total, currency: q.pricing.currency, owner: q.ownerName })),
  });
});

app.get('/api/health', (req, res) => res.json({ ok: db.isReady(), storage: db.usingSheets ? 'sheets' : 'local', pendingWrites: db.pending() }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- start ---------- */
async function start() {
  await db.load();
  auth.ensureAdmin();
  if (!db.all('destinations').length) require('./destinations').forEach(d => db.put('destinations', d));
  if (!db.get('settings', 'main')) db.put('settings', P.DEFAULT_SETTINGS);
  const port = +process.env.PORT || 3000;
  app.listen(port, () => console.log(`CGT Tours on http://localhost:${port} · ` + Object.entries(prov).map(([k, p]) => `${k}: ${p.live() ? p.name : 'demo'}`).join(' · ')));
}
if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });
module.exports = { app, start };
