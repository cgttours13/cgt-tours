/**
 * FLIGHTS provider — AIQS air hub (WebSocket search + REST booking). Sample flights when no credentials are set.
 *   AIQS_AUTH_URL   https://pp-auth-api.aiqs.link/auth/cognito
 *   AIQS_REST_URL   https://pp-api.aiqs.link
 *   AIQS_WSS_URL    wss://pp-api.aiqs.link
 *   AIQS_CLIENT_ID, AIQS_USERNAME, AIQS_PASSWORD, AIQS_TARGET (Test|Production)
 *   AIQS_AGENCY_CODE, AIQS_AGENCY_NAME, AIQS_CURRENCY (PKR), AIQS_SUPPLIER_CODES (optional), AIQS_WSS_TOKEN_PARAM (optional)
 */
const WebSocket = require('ws');
const { num, rid, signItem, httpJson } = require('./util');

const C = {
  auth: (process.env.AIQS_AUTH_URL || 'https://pp-auth-api.aiqs.link/auth/cognito').replace(/\/$/, ''),
  rest: (process.env.AIQS_REST_URL || 'https://pp-api.aiqs.link').replace(/\/$/, ''),
  wss: process.env.AIQS_WSS_URL || 'wss://pp-api.aiqs.link',
  wsParam: process.env.AIQS_WSS_TOKEN_PARAM || '',
  clientId: process.env.AIQS_CLIENT_ID, user: process.env.AIQS_USERNAME, pass: process.env.AIQS_PASSWORD,
  target: process.env.AIQS_TARGET || 'Test', agency: process.env.AIQS_AGENCY_CODE || '', agencyName: process.env.AIQS_AGENCY_NAME || '',
  currency: process.env.AIQS_CURRENCY || 'PKR', suppliers: (process.env.AIQS_SUPPLIER_CODES || '').split(',').map(s => s.trim()).filter(Boolean),
  timeout: +(process.env.AIQS_SEARCH_TIMEOUT_MS || 45000),
};
const name = 'AIQS Air';
const live = () => !!(C.clientId && C.user && C.pass);

/* ---------- login / token ---------- */
const tok = { id: null, access: null, exp: 0, p: null };
async function login() {
  const d = await httpJson(`${C.auth}/client/user/signin/initiate`, { method: 'POST', body: { clientId: C.clientId, authFlow: 'USER_PASSWORD_AUTH', authParameters: { USERNAME: C.user, PASSWORD: C.pass } } });
  const r = (d.data && d.data.authenticationResult) || d.authenticationResult || {};
  if (!r.idToken) throw new Error('Flight API login failed');
  tok.id = r.idToken; tok.access = r.accessToken; tok.exp = Date.now() + (+r.expiresIn || 1800) * 1000;
}
async function refresh() {
  const d = await httpJson(`${C.auth}/custom/user/token/get/accessToken`, { method: 'POST', body: { accessToken: tok.access, clientId: C.clientId } });
  const x = d.data || d, id = x.id_token || x.idToken || (x.authenticationResult && x.authenticationResult.idToken);
  if (!id) throw new Error('refresh failed');
  tok.id = id; if (x.access_token || x.accessToken) tok.access = x.access_token || x.accessToken;
  tok.exp = Date.now() + (+(x.expires_in || x.expiresIn) || 1800) * 1000;
}
async function token() {
  if (tok.id && Date.now() < tok.exp - 600e3) return tok.id;
  if (!tok.p) tok.p = (async () => { try { if (tok.access && Date.now() < tok.exp - 30e3) await refresh(); else await login(); } catch { await login(); } })().finally(() => { tok.p = null; });
  await tok.p; return tok.id;
}
async function api(path, body) {
  const t = await token();
  try { return await httpJson(C.rest + path, { method: 'POST', body, headers: { Authorization: `Bearer ${t}` }, timeout: 90000 }); }
  catch (e) { if (e.status === 401) { tok.id = null; tok.exp = 0; return httpJson(C.rest + path, { method: 'POST', body, headers: { Authorization: `Bearer ${await token()}` }, timeout: 90000 }); } throw e; }
}
const dmy = s => { const [y, m, d] = String(s).split('-'); return `${d}-${m}-${y}`; };
const node = () => ({ currency: C.currency, ...(C.agency ? { agencyCode: C.agency } : {}), ...(C.agencyName ? { agencyName: C.agencyName } : {}) });

/* ---------- search ---------- */
const offers = new Map();
setInterval(() => { const cut = Date.now() - 3600e3; for (const [k, v] of offers) if (v.at < cut) offers.delete(k); }, 600e3).unref();

/** q: { legs:[{from,to,date}], adt, chd, inf, cabin, nonStop, airline } */
function tripType(q) {
  if (q.legs.length === 1) return 'O';
  if (q.legs.length === 2 && q.legs[0].from === q.legs[1].to && q.legs[0].to === q.legs[1].from) return 'R';
  return 'M';
}
function wsSearch(q, t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(C.wsParam ? `${C.wss}?${C.wsParam}=${encodeURIComponent(t)}` : C.wss);
    const pages = [], errors = [], sup = {}; let expected = null, fin = false;
    const done = () => { if (fin) return; fin = true; clearTimeout(tm); try { ws.close(); } catch {} resolve({ pages, errors }); };
    const tm = setTimeout(done, C.timeout);
    ws.on('open', () => {
      const adt = +q.adt || 1, chd = +q.chd || 0, inf = +q.inf || 0;
      const req = { service: 'FlightRQ', token: t, node: node(), content: { command: 'FlightSearchRQ', criteria: {
        criteriaType: 'Air', commonRequestSearch: { numberOfUnits: adt + chd + inf, typeOfUnit: 'PX', resultsCount: '50' },
        ondPairs: q.legs.map(l => ({ departureDate: dmy(l.date), originLocation: l.from, destinationLocation: l.to })),
        preferredAirline: q.airline ? [String(q.airline).toUpperCase()] : [], nonStop: !!q.nonStop, cabin: q.cabin || 'Y',
        maxStopQuantity: q.nonStop ? 'Direct' : 'All', tripType: tripType(q), target: C.target, paxQuantity: { adt, chd, inf } } } };
      if (C.suppliers.length) req.supplierCodes = C.suppliers;
      ws.send(JSON.stringify({ request: req }));
    });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.requestDetails && m.requestDetails.count != null) { expected = +m.requestDetails.count || 0; if (!expected) done(); return; }
      const r = m.response || m, c = r.content || {};
      if (r.error || c.error) errors.push(r.error || c.error);
      const k = String(r.supplierCode != null ? r.supplierCode : 's' + Object.keys(sup).length);
      const s = sup[k] || (sup[k] = { total: 1, got: new Set() });
      s.total = +c.totalPages || s.total; s.got.add(String(c.currentPage || s.got.size + 1));
      if (c.searchResponse) pages.push(r);
      if (expected != null && Object.keys(sup).length >= expected && Object.values(sup).every(x => x.got.size >= x.total)) done();
    });
    ws.on('error', e => { errors.push({ message: e.message }); if (!pages.length) { fin = true; clearTimeout(tm); reject(new Error('Flight search connection failed: ' + e.message)); } else done(); });
    ws.on('close', done);
  });
}

function normalise(pages, q) {
  const list = [];
  for (const r of pages) {
    const c = r.content || {};
    for (const fi of (c.searchResponse || {}).flightIndex || []) {
      const legs = (fi.ondPairs || []).map((op, oi) => {
        const ondID = op.ond && op.ond.ondID != null ? op.ond.ondID : oi;
        const segments = (op.flightDetails || []).map((fd, si) => {
          const f = fd.flifo || fd.fInfo || {}, dt = f.dateTime || {}, loc = f.location || {}, co = f.companyId || {};
          return { ondID, segID: fd.segID != null ? fd.segID : si, depDate: dt.depDate, depTime: dt.depTime, arrDate: dt.arrDate, arrTime: dt.arrTime, from: loc.depAirport, to: loc.arrAirport, depTerminal: loc.depTerminal, arrTerminal: loc.arrTerminal, mktg: co.mktgAirline, oper: co.operAirline, flightNo: f.flightNo, eqp: f.eqpType, rbd: f.rbd, cabin: f.cabin, duration: f.duration, stops: f.stops || 0, baggage: f.baggageAllowance || [] };
        });
        return { ondID, duration: op.ond && op.ond.duration, airline: (op.ond && op.ond.issuingAirline) || (segments[0] && segments[0].mktg), segments };
      });
      if (!legs.length) continue;
      const fare = fi.fare || {}, id = rid(6);
      offers.set(id, { at: Date.now(), fi, ctx: { supplierCode: r.supplierCode, node: r.node, selectCredential: r.selectCredential, searchKey: r.searchKey, css: c.supplierSpecific || null }, legs, q });
      const bag = ((legs[0].segments[0] || {}).baggage || []).find(b => /check/i.test(b.type || '')) || ((legs[0].segments[0] || {}).baggage || [])[0];
      list.push({ id, legs, airline: legs[0].airline, net: num(fare.total), currency: fare.currency || C.currency, refundable: !!fi.refundable,
        baggage: bag ? `${bag.value} ${bag.unit === 'PC' ? 'pc' : (bag.unit || '').toLowerCase()}` : '',
        fareBreakup: ((fi.fareDetails || {}).fareBreakup || []).map(b => ({ paxType: b.paxType, paxCount: b.paxCount, total: num(b.total) || (num(b.baseFare) + num(b.tax)) })) });
    }
  }
  return list.sort((a, b) => a.net - b.net);
}

async function search(q) {
  if (!live()) return demo(q);
  const { pages, errors } = await wsSearch(q, await token());
  const flights = normalise(pages, q);
  return { flights, warnings: flights.length ? [] : errors.map(e => e.message || JSON.stringify(e)).slice(0, 3), source: 'aiqs' };
}

const flightKey = legs => legs.map(l => l.segments.map(s => `${s.mktg}${s.flightNo}@${s.depDate}`).join('+')).join('|');
function makeItem(offer, q) {
  const it = { kind: 'flight', source: offer.source || 'aiqs', title: offer.legs.map(l => `${l.segments[0].from}-${l.segments[l.segments.length - 1].to}`).join(' / '), airline: offer.airline, legs: offer.legs, refundable: offer.refundable, baggage: offer.baggage, fareBreakup: offer.fareBreakup, net: offer.net, currency: offer.currency, ref: flightKey(offer.legs), search: q };
  it.sig = signItem(it);
  return it;
}

/* ---------- booking (processing) ---------- */
const env = (ctx, extra = {}) => ({ service: 'FlightRQ', supplierCodes: [Number(ctx.supplierCode)], node: ctx.node || node(), ...(ctx.selectCredential ? { selectCredential: ctx.selectCredential } : {}), ...(ctx.searchKey ? { searchKey: ctx.searchKey } : {}), ...extra });
const segGroup = legs => legs.flatMap(l => l.segments.map(s => ({ flifo: { dateTime: { depDate: s.depDate, depTime: s.depTime, arrDate: s.arrDate, arrTime: s.arrTime }, depAirport: { trueLocationId: s.from }, arrAirport: { trueLocationId: s.to }, location: { mktgAirline: s.mktg, operAirline: s.oper || s.mktg, issuingAirline: l.airline || s.mktg }, flightIdentification: { flightNo: s.flightNo, rbd: s.rbd }, flightTypeDetails: { ondID: s.ondID, segID: s.segID } } })));

/** pax: [{paxType, salutation, givenName, surName, gender, birthDate, nationality, passportNo, passportExpiry}], contact:{email, phone} */
async function book(item, pax, contact) {
  if (item.source === 'demo') return { status: 'HK (demo)', pnr: rid(3).toUpperCase(), supplierRef: 'DEMO-F' + rid(3).toUpperCase(), net: item.net, currency: item.currency };
  if (item.source === 'manual') throw new Error('Manual ticket — book it in your GDS and enter the PNR manually.');
  const res = await search(item.search);
  const found = res.flights.find(f => flightKey(f.legs) === item.ref);
  if (!found) throw new Error('The same flights are no longer available. Search again in the quotation.');
  const e = offers.get(found.id), q = item.search;
  const v = await api('/api/air/validate', { request: { ...env(e.ctx), content: { command: 'FlightValidateRQ', validateFareRequest: { target: C.target, adt: +q.adt || 1, chd: +q.chd || 0, inf: +q.inf || 0, totalAmount: found.net, segmentGroup: segGroup(e.legs), tripType: tripType(q), from: q.legs[0].from, to: q.legs[0].to }, supplierSpecific: [e.fi.supplierSpecific || e.ctx.css || {}] } } });
  const vc = (v.response && v.response.content) || {}, vf = vc.validateFareResponse;
  if (!vf || !vf.sealed) throw new Error((v.response && v.response.error && v.response.error.message) || 'Airline could not confirm the fare.');
  const tp = (p, i) => ({ paxType: p.paxType, gender: p.gender, salutation: p.salutation, givenName: p.givenName, surName: p.surName, birthDate: p.birthDate ? dmy(p.birthDate) : null, docType: '1', docID: p.passportNo || null, documentNumber: p.passportNo || null, docIssueCountry: p.nationality || 'PK', nationality: p.nationality || 'PK', expiryDate: p.passportExpiry ? dmy(p.passportExpiry) : null, ...(i === 0 ? { leadPax: true } : {}),
    contact: { emailList: [{ emailId: contact.email, emailType: { id: 1 } }], phoneList: [{ number: String(contact.phone || '').replace(/\D/g, '').replace(/^0/, ''), phoneType: { id: 1 }, country: { code: 'PK', telephonecode: '92' } }] } });
  const b = await api('/api/air/book', { request: { ...env(e.ctx), content: { command: 'FlightBookRQ', supplierSpecific: vc.supplierSpecific || e.fi.supplierSpecific || {}, bookFlightRQ: {
    bookingRefId: null, sealed: vf.sealed, tripType: tripType(q), adt: +q.adt || 1, chd: +q.chd || 0, inf: +q.inf || 0, fare: vf.fare,
    ondPairs: e.legs.map(l => { const g = (vf.segmentGroup || []).find(x => x.ondID === l.ondID) || {}; return { ondID: l.ondID, duration: l.duration || '', originCity: l.segments[0].from, destinationCity: l.segments[l.segments.length - 1].to, segments: l.segments.map(s => ({ segID: s.segID, fareBasis: g.fareBasis, depDate: s.depDate, depTime: s.depTime, arrDate: s.arrDate, arrTime: s.arrTime, depAirport: s.from, arrAirport: s.to, mktgAirline: s.mktg, operAirline: s.oper || s.mktg, issuingAirline: l.airline || s.mktg, flightNo: s.flightNo, cabin: s.cabin || 'Y', duration: s.duration, rbd: s.rbd, eqpType: s.eqp, depTerminal: s.depTerminal || '', arrTerminal: s.arrTerminal || '', stopQuantity: s.stops || 0, baggageAllowance: s.baggage })) }; }),
    travelerInfo: pax.map(tp), paymentMode: 7, issue: false, paymentCard: null } } } });
  const bc = (b.response && b.response.content) || {}, r = bc.bookFlightResult || bc.bookFlightRS || {};
  if (!r.success || !r.pnr) throw new Error((b.response && b.response.error && b.response.error.message) || 'Airline did not confirm the booking.');
  return { status: r.status || 'HK (on hold)', pnr: r.pnr, supplierRef: r.bookingRefId, ticketingTimeLimit: r.ticketingTimeLimit || '', net: num(vf.fare && vf.fare.total), currency: (vf.fare && vf.fare.currency) || item.currency,
    meta: { supplierCode: e.ctx.supplierCode, agencyCode: (e.ctx.node && e.ctx.node.agencyCode) || C.agency, selectCredential: e.ctx.selectCredential || null, traceId: (vc.supplierSpecific && vc.supplierSpecific.traceId) || '' }, raw: b };
}

const pnrEnv = (meta, command, key, inner, ss) => ({ request: { service: 'FlightRQ', node: { agencyCode: meta.agencyCode || C.agency }, supplierCodes: [Number(meta.supplierCode)], ...(meta.selectCredential ? { selectCredential: meta.selectCredential } : {}), content: { command, supplierSpecific: ss || (meta.traceId ? { traceId: meta.traceId } : {}), [key]: inner } } });
async function retrieve(ref, meta) { return api('/api/air/retrievePNR', pnrEnv(meta, 'FlightRetrieveBookingRQ', 'tripDetailRQ', { bookingRefId: ref })); }
async function issue(ref, meta) {
  if (String(ref).startsWith('DEMO')) return { status: 'Ticketed (demo)', tickets: 'DEMO-TKT' };
  const r = await retrieve(ref, meta), ss = r.response && r.response.content && r.response.content.supplierSpecific;
  const d = await api('/api/air/issueTicket', pnrEnv(meta, 'FlightIssueTicketRQ', 'issueTicketRQ', { bookingRefId: ref, paymentMode: 7 }, ss));
  const it = (d.response && d.response.content && d.response.content.issueTicketRS) || {};
  if (!it.success) throw new Error((d.response && d.response.error && d.response.error.message) || 'Ticketing failed');
  return { status: it.ticketStatus || 'Ticketed', tickets: (it.travelerInfo || []).map(t => `${t.givenName} ${t.surName}: ${(t.eTickets || []).map(x => x.eTicketNumber).join(',')}`).join('; '), raw: d };
}
async function cancel(ref, meta) {
  if (String(ref).startsWith('DEMO')) return { status: 'CANCELLED (demo)' };
  const r = await retrieve(ref, meta), ss = r.response && r.response.content && r.response.content.supplierSpecific;
  const d = await api('/api/air/cancel', pnrEnv(meta, 'FlightCancelPnrRQ', 'cancelPnrRQ', { bookingRefId: ref }, ss));
  return { status: (d.response && d.response.content && d.response.content.cancelPnrRS && d.response.content.cancelPnrRS.success) ? 'CANCELLED' : 'Cancel failed', raw: d };
}

/* ---------- sample flights ---------- */
function demo(q) {
  const A = [['FZ', 'flydubai', 52000, null, '0310'], ['EK', 'Emirates', 68500, null, '0300'], ['PK', 'PIA', 49500, null, '0315'], ['QR', 'Qatar Airways', 61200, 'DOH', '0645'], ['TK', 'Turkish Airlines', 74000, 'IST', '0830'], ['PA', 'Airblue', 45800, null, '0320']];
  const add = (t, m) => { const x = (+t.slice(0, 2)) * 60 + (+t.slice(2)) + m; return String(Math.floor(x / 60) % 24).padStart(2, '0') + String(x % 60).padStart(2, '0'); };
  const mins = d => (+d.slice(0, 2)) * 60 + (+d.slice(2));
  const times = ['0215', '0450', '0930', '1340', '1825', '2210'];
  const pax = (+q.adt || 1) + (+q.chd || 0) * 0.75 + (+q.inf || 0) * 0.1;
  const flights = A.map((a, i) => {
    const legs = q.legs.map((l, li) => {
      const d = dmy(l.date), dep = times[(i + li * 3) % 6];
      const segs = a[3] ? [{ ondID: li, segID: 0, depDate: d, depTime: dep, arrDate: d, arrTime: add(dep, 160), from: l.from, to: a[3], mktg: a[0], flightNo: String(600 + i * 11 + li), cabin: 'Y', duration: '0240', baggage: [{ type: 'checkIn', value: '30', unit: 'KG' }] }, { ondID: li, segID: 1, depDate: d, depTime: add(dep, 250), arrDate: d, arrTime: add(dep, mins(a[4])), from: a[3], to: l.to, mktg: a[0], flightNo: String(700 + i * 11 + li), cabin: 'Y', duration: '0300', baggage: [{ type: 'checkIn', value: '30', unit: 'KG' }] }]
        : [{ ondID: li, segID: 0, depDate: d, depTime: dep, arrDate: d, arrTime: add(dep, mins(a[4])), from: l.from, to: l.to, mktg: a[0], flightNo: String(200 + i * 13 + li), cabin: 'Y', duration: a[4], baggage: [{ type: 'checkIn', value: a[0] === 'PA' ? '20' : '30', unit: 'KG' }] }];
      return { ondID: li, duration: a[4], airline: a[0], segments: segs };
    });
    return { id: 'demo-' + a[0], legs, airline: a[0], net: Math.round(a[2] * pax * (0.6 + 0.45 * q.legs.length)), currency: 'PKR', refundable: i % 2 === 0, baggage: a[0] === 'PA' ? '20 kg' : '30 kg', fareBreakup: [], source: 'demo' };
  }).sort((x, y) => x.net - y.net);
  return { flights, warnings: [], source: 'demo' };
}

module.exports = { name, live, search, makeItem, book, issue, cancel, retrieve, flightKey };
