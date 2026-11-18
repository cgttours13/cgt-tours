/**
 * SIGHTSEEING / TOURS provider — Hotelbeds Activities API (sample tours when no key is set).
 * search  → list of tours in the city with "price from"
 * options → exact options and prices for one tour on one date
 */
const hb = require('./hotelbeds');
const { num, rid, signItem } = require('./util');

const name = 'Hotelbeds Activities';
const live = () => hb.configured('activity');
const cache = new Map();

const image = c => {
  const im = (((c || {}).media || {}).images || [])[0];
  if (!im) return '';
  const u = (im.urls || []).find(x => /LARGE|XLARGE|MEDIUM/i.test(x.sizeType || '')) || (im.urls || [])[0];
  return u ? u.resource : '';
};
const ages = q => [...Array(+q.adults || 1).fill(30), ...(q.childAges || [])].map(age => ({ age: +age }));

/** q: { dest:{hbDest, lat, lng, city}, from, to, adults, childAges } */
async function search(q) {
  if (!live()) return demo(q);
  const key = JSON.stringify([q.dest.hbDest, q.from, q.to, ages(q)]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.data;
  const body = f => ({ filters: [{ searchFilterItems: [f] }], from: q.from, to: q.to, paxes: ages(q), language: 'en', pagination: { itemsPerPage: 60, page: 1 }, order: 'DEFAULT' });
  let d;
  // 1) by Hotelbeds destination code; 2) if nothing (or code unknown), by GPS point of the city
  try { d = await hb.call('activity', 'POST', '/activity-api/3.0/activities', body({ type: 'destination', value: q.dest.hbDest })); }
  catch (e) { if (e.status !== 400 && e.status !== 404) throw e; d = { activities: [] }; }
  if (!(d.activities || []).length && q.dest.lat) {
    try { d = await hb.call('activity', 'POST', '/activity-api/3.0/activities', body({ type: 'gps', latitude: +q.dest.lat, longitude: +q.dest.lng })); }
    catch (e) { if (e.status !== 400 && e.status !== 404) throw e; d = { activities: [] }; }
  }
  const adults = +q.adults || 1, kids = (q.childAges || []).length;
  const activities = (d.activities || []).map(a => {
    const from = a.amountsFrom || [];
    const ad = from.find(x => /ADULT/i.test(x.paxType)) || from[0] || {}, ch = from.find(x => /CHILD/i.test(x.paxType)) || ad;
    const c = a.content || {};
    const dur = ((a.modalities || [])[0] || {}).duration || {};
    return {
      code: a.code, title: a.name || c.name, image: image(c), description: String(c.description || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, 400),
      duration: dur.value ? `${dur.value} ${String(dur.metric || '').toLowerCase()}` : '', type: a.type, currency: a.currency || 'EUR',
      fromNet: Math.round((num(ad.amount) * adults + num(ch.amount) * kids) * 100) / 100,
      perAdult: num(ad.amount), modalities: (a.modalities || []).length,
    };
  }).filter(a => a.fromNet > 0).sort((a, b) => a.fromNet - b.fromNet);
  const data = { activities, source: 'hotelbeds' };
  if (activities.length) cache.set(key, { at: Date.now(), data });
  return data;
}

/** Exact options for one tour on a date. */
async function options(code, date, q) {
  if (!live() || String(code).startsWith('DEMO')) return demoOptions(code, date, q);
  const d = await hb.call('activity', 'POST', '/activity-api/3.0/activities/details', { code, from: date, to: date, language: 'en', paxes: ages(q) });
  const a = d.activity || {};
  const out = [];
  for (const m of a.modalities || []) for (const r of m.rates || []) for (const rd of r.rateDetails || []) {
    const op = (rd.operationDates || []).find(o => o.from <= date && o.to >= date) || (rd.operationDates || [])[0] || {};
    const pol = (op.cancellationPolicies || [])[0];
    out.push({ id: rid(5), modalityCode: m.code, modality: m.name, rateCode: r.rateCode, rateName: r.name, rateKey: rd.rateKey, net: num(rd.totalAmount && rd.totalAmount.amount), currency: a.currency || 'EUR', languages: (rd.languages || []).map(l => l.description || l.code).join(', '), cancel: pol ? `Free cancellation until ${String(pol.dateFrom).replace('T', ' ').slice(0, 16)}` : 'Non-refundable', duration: m.duration ? `${m.duration.value} ${String(m.duration.metric || '').toLowerCase()}` : '' });
  }
  return { title: a.name, options: out.filter(o => o.net > 0).sort((x, y) => x.net - y.net) };
}

function makeItem(act, opt, date, q, destIdx) {
  const it = {
    kind: 'activity', source: act.source || 'hotelbeds', destIdx, code: act.code, title: act.title, image: act.image, description: act.description, duration: opt.duration || act.duration,
    modality: opt.modality, modalityCode: opt.modalityCode, rateCode: opt.rateCode, date, cancel: opt.cancel,
    net: opt.net, currency: opt.currency, ref: opt.rateKey, rateKey: opt.rateKey, pax: { adults: q.adults, childAges: q.childAges || [] },
  };
  it.sig = signItem(it);
  return it;
}

async function book(item, guests, holder, clientRef) {
  if (item.source === 'demo') return { status: 'CONFIRMED (demo)', supplierRef: 'DEMO-A' + rid(3).toUpperCase(), net: item.net, currency: item.currency };
  const fresh = await options(item.code, item.date, item.pax);
  const pick = fresh.options.find(o => o.modalityCode === item.modalityCode && o.rateCode === item.rateCode) || fresh.options.find(o => o.modalityCode === item.modalityCode);
  if (!pick) throw new Error(`"${item.title}" is not available on ${item.date} any more.`);
  const paxAges = ages(item.pax);
  const body = {
    language: 'en', clientReference: String(clientRef).slice(0, 20),
    holder: { name: holder.name, surname: holder.surname, email: holder.email, telephones: [holder.phone], title: 'MR', address: '', zipCode: '', mailing: false, country: 'PK' },
    activities: [{ preferedLanguage: 'en', serviceLanguage: 'en', rateKey: pick.rateKey, from: item.date, to: item.date, answers: [],
      paxes: paxAges.map((p, i) => { const g = guests[i] || guests[0]; return { age: p.age, name: g.name, surname: g.surname, type: p.age >= 12 ? 'ADULT' : 'CHILD' }; }) }],
  };
  const d = await hb.call('activity', 'PUT', '/activity-api/3.0/bookings', body);
  const b = d.booking || {};
  return { status: b.status || 'CONFIRMED', supplierRef: b.reference, net: pick.net, currency: pick.currency, raw: d };
}

async function cancel(supplierRef) {
  if (String(supplierRef).startsWith('DEMO')) return { status: 'CANCELLED (demo)' };
  const d = await hb.call('activity', 'DELETE', `/activity-api/3.0/bookings/en/${encodeURIComponent(supplierRef)}?cancellationFlag=CANCELLATION`);
  return { status: (d.booking && d.booking.status) || 'CANCELLED', raw: d };
}

/* ---------- sample tours ---------- */
const SAMPLE = [['City Tour with Hotel Pick-up', 'Half day · 4 hours', 18], ['Desert Safari with BBQ Dinner', 'Evening · 6 hours', 35], ['Full Day Highlands Tour with Cable Car', 'Full day · 8 hours', 42], ['Dinner Cruise', 'Evening · 2 hours', 30], ['Theme Park Ticket', 'Full day', 55], ['Aquarium & Underwater Zoo Ticket', '2–3 hours', 25]];
function demo(q) {
  const n = (+q.adults || 1) + (q.childAges || []).length * 0.7;
  return { activities: SAMPLE.map(([t, dur, p], i) => ({ code: 'DEMO-' + i, title: `${q.dest.city}: ${t}`, image: '', description: 'Sample tour (demo). Real sightseeing with photos and live prices appears once the Hotelbeds Activities key is set.', duration: dur, currency: 'USD', fromNet: Math.round(p * n), perAdult: p, modalities: 2, source: 'demo' })), source: 'demo' };
}
function demoOptions(code, date, q) {
  const i = +String(code).split('-')[1] || 0, p = SAMPLE[i] ? SAMPLE[i][2] : 20, n = (+q.adults || 1) + (q.childAges || []).length * 0.7;
  return { title: SAMPLE[i] && SAMPLE[i][0], options: [
    { id: 'o1', modalityCode: 'SIC', modality: 'Shared tour (SIC)', rateCode: 'STD', rateKey: `DEMO|${code}|SIC|${date}`, net: Math.round(p * n), currency: 'USD', cancel: 'Free cancellation until 24 hours before', duration: SAMPLE[i] && SAMPLE[i][1] },
    { id: 'o2', modalityCode: 'PVT', modality: 'Private tour with driver', rateCode: 'STD', rateKey: `DEMO|${code}|PVT|${date}`, net: Math.round(p * n * 1.8 + 20), currency: 'USD', cancel: 'Free cancellation until 24 hours before', duration: SAMPLE[i] && SAMPLE[i][1] },
  ] };
}

module.exports = { name, live, search, options, makeItem, book, cancel };
