/**
 * TRANSFERS provider — Hotelbeds Transfers API (sample transfers when no key is set).
 * Airport → hotel uses the airport IATA code and the Hotelbeds hotel code (ATLAS) when a hotel is chosen,
 * otherwise the city centre GPS point.
 */
const hb = require('./hotelbeds');
const { num, rid, signItem } = require('./util');

const name = 'Hotelbeds Transfers';
const live = () => hb.configured('transfer');
const cache = new Map();

const point = p => p.type === 'GPS' ? `GPS/${p.lat},${p.lng}` : `${p.type}/${encodeURIComponent(p.code)}`;

/**
 * q: { from:{type:'IATA'|'ATLAS'|'GPS', code, lat, lng, label}, to:{...}, outbound:'YYYY-MM-DDTHH:mm:ss', inbound?, adults, children, infants, city }
 */
async function search(q) {
  if (!live()) return demo(q);
  const path = `/transfer-api/1.0/availability/en/from/${point(q.from)}/to/${point(q.to)}/${q.outbound}${q.inbound ? '/' + q.inbound : ''}/${+q.adults || 1}/${+q.children || 0}/${+q.infants || 0}`;
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  let d;
  try { d = await hb.call('transfer', 'GET', path); }
  catch (e) { if (e.status === 204 || /no.*(result|availability)/i.test(e.message)) return { transfers: [], source: 'hotelbeds' }; throw e; }
  const transfers = (d.services || []).map(s => {
    const img = ((s.content && s.content.images) || []).find(i => /SMALL|MEDIUM|LARGE|EXTRALARGE/i.test(i.type || '')) || ((s.content && s.content.images) || [])[0];
    const price = s.price || {};
    const pi = s.pickupInformation || {};
    return {
      id: rid(5), direction: s.direction || 'ARRIVAL', type: s.transferType || '', vehicle: (s.vehicle && s.vehicle.name) || '', vehicleCode: s.vehicle && s.vehicle.code, category: (s.category && s.category.name) || '', categoryCode: s.category && s.category.code,
      title: `${(pi.from && pi.from.description) || q.from.label} → ${(pi.to && pi.to.description) || q.to.label}`,
      fromLabel: (pi.from && pi.from.description) || q.from.label, toLabel: (pi.to && pi.to.description) || q.to.label,
      date: pi.date, time: pi.time, minPax: s.minPaxCapacity, maxPax: s.maxPaxCapacity,
      image: img ? img.url : '', description: ((s.content && s.content.transferDetailInfo) || []).map(x => x.name || x.description).filter(Boolean).slice(0, 4).join(' · '),
      net: num(price.netAmount || price.totalAmount), currency: price.currencyId || 'EUR', rateKey: s.rateKey,
      cancel: (s.cancellationPolicies || []).length ? `Free cancellation until ${String(s.cancellationPolicies[0].from).replace('T', ' ').slice(0, 16)}` : 'Non-refundable',
    };
  }).filter(t => t.net > 0).sort((a, b) => a.net - b.net);
  const data = { transfers, source: 'hotelbeds' };
  if (transfers.length) cache.set(path, { at: Date.now(), data });
  return data;
}

function makeItem(t, q, destIdx) {
  const it = {
    kind: 'transfer', source: t.source || 'hotelbeds', destIdx, title: `${t.fromLabel} → ${t.toLabel} – ${t.type === 'PRIVATE' ? 'Private' : t.type === 'SHARED' ? 'Shared' : t.type}`,
    direction: t.direction, type: t.type, vehicle: t.vehicle, vehicleCode: t.vehicleCode, category: t.category, categoryCode: t.categoryCode, image: t.image,
    date: t.date || (q.outbound || '').slice(0, 10), time: t.time || (q.outbound || '').slice(11, 16), cancel: t.cancel, maxPax: t.maxPax,
    net: t.net, currency: t.currency, ref: t.rateKey, rateKey: t.rateKey, search: { from: q.from, to: q.to, outbound: q.outbound, adults: q.adults, children: q.children, infants: q.infants },
  };
  it.sig = signItem(it);
  return it;
}

async function book(item, holder, flightCode, clientRef) {
  if (item.source === 'demo') return { status: 'CONFIRMED (demo)', supplierRef: 'DEMO-T' + rid(3).toUpperCase(), net: item.net, currency: item.currency };
  // fresh availability → same vehicle & type
  const s = item.search;
  const fresh = await search(s);
  const same = fresh.transfers.filter(t => !item.direction || t.direction === item.direction);
  const pick = same.find(t => t.vehicleCode === item.vehicleCode && t.type === item.type && t.categoryCode === item.categoryCode) || same.find(t => t.type === item.type);
  if (!pick) throw new Error('This transfer is no longer available. Choose another transfer.');
  const body = {
    language: 'en', holder: { name: holder.name, surname: holder.surname, email: holder.email, phone: holder.phone },
    transfers: [{ rateKey: pick.rateKey, transferDetails: [{ type: 'FLIGHT', direction: item.direction || 'ARRIVAL', code: flightCode || 'XX0000', companyName: null }] }],
    clientReference: String(clientRef).slice(0, 20), welcomeMessage: holder.name + ' ' + holder.surname, remark: holder.remark || '',
  };
  const d = await hb.call('transfer', 'POST', '/transfer-api/1.0/bookings', body);
  const b = (d.bookings && d.bookings[0]) || d.booking || {};
  return { status: b.status || 'CONFIRMED', supplierRef: b.reference, net: pick.net, currency: pick.currency, raw: d };
}

async function cancel(supplierRef) {
  if (String(supplierRef).startsWith('DEMO')) return { status: 'CANCELLED (demo)' };
  const d = await hb.call('transfer', 'DELETE', `/transfer-api/1.0/booking/en/reference/${encodeURIComponent(supplierRef)}`);
  return { status: (d.booking && d.booking.status) || 'CANCELLED', raw: d };
}

function demo(q) {
  const pax = (+q.adults || 1) + (+q.children || 0);
  const list = [['PRIVATE', 'Car', 'Standard', 4, 28], ['PRIVATE', 'Minivan', 'Standard', 7, 42], ['PRIVATE', 'Minibus', 'Standard', 13, 75], ['SHARED', 'Shuttle bus', 'Standard', 50, 9 * pax]]
    .filter(x => x[3] >= pax);
  const mk = (dir, from, to, date) => list.map(([type, vehicle, category, max, price]) => ({ id: rid(4), direction: dir, type, vehicle, vehicleCode: vehicle.toUpperCase(), category, categoryCode: 'STND', title: `${from} → ${to}`, fromLabel: from, toLabel: to, date: (date || '').slice(0, 10), time: (date || '').slice(11, 16), maxPax: max, image: '', description: type === 'PRIVATE' ? 'Meet & greet at arrivals · door-to-door' : 'Shared shuttle · fixed stops', net: price, currency: 'USD', rateKey: `DEMO|${dir}|${vehicle}`, cancel: 'Free cancellation until 48 hours before', source: 'demo' }));
  const out = mk('ARRIVAL', q.from.label, q.to.label, q.outbound);
  const back = q.inbound ? mk('DEPARTURE', q.to.label, q.from.label, q.inbound) : [];
  return { transfers: out.concat(back), source: 'demo' };
}

module.exports = { name, live, search, makeItem, book, cancel };
