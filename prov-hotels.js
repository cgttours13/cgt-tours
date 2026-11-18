/**
 * HOTELS provider — Hotelbeds Booking API (falls back to sample hotels when no key is set).
 * To change supplier later: write a new file with the same exported functions (search, book, cancel)
 * and point providers.js at it.
 */
const hb = require('./hotelbeds');
const { num, rid, signItem, nightsBetween } = require('./util');

const name = 'Hotelbeds';
const live = () => hb.configured('hotel');
const content = new Map(); // hotel code -> { images, description, address }
const cache = new Map();   // search -> { at, data }

function groupRooms(rooms) {
  // identical rooms are searched together ("2 rooms × 2 adults")
  const m = new Map();
  rooms.forEach((r, i) => {
    const ages = (r.childAges || []).map(a => +a).sort((a, b) => a - b);
    const k = `${r.adults}|${ages.join(',')}`;
    if (!m.has(k)) m.set(k, { adults: +r.adults, ages, count: 0, idx: [] });
    const g = m.get(k); g.count++; g.idx.push(i);
  });
  return [...m.values()];
}
const groupLabel = (g, i) => `${g.count > 1 ? g.count + ' Rooms' : 'Room ' + (i + 1)} · ${g.adults} Adult${g.adults > 1 ? 's' : ''}${g.ages.length ? ` + ${g.ages.length} Child (${g.ages.join(', ')})` : ''}${g.count > 1 ? ' each' : ''}`;

const cancelText = (rt) => {
  if (rt.rateClass === 'NRF' || !(rt.cancellationPolicies || []).length) return { refundable: false, text: 'Non-refundable' };
  const p = rt.cancellationPolicies.slice().sort((a, b) => String(a.from).localeCompare(String(b.from)))[0];
  const m = String(p.from).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  return { refundable: true, text: m ? `Free cancellation until ${m[3]}-${m[2]}-${m[1]} ${m[4]} (hotel time)` : 'Free cancellation (see policy)' };
};

async function loadContent(codes) {
  const need = codes.filter(c => !content.has(c)).slice(0, 50);
  if (!need.length) return;
  try {
    const d = await hb.call('hotel', 'GET', `/hotel-content-api/1.0/hotels?codes=${need.join(',')}&fields=code,images,description,address,facilities&language=ENG&from=1&to=${need.length}&useSecondaryLanguage=false`);
    for (const h of d.hotels || []) {
      const imgs = (h.images || []).sort((a, b) => (a.imageTypeCode === 'GEN' ? -1 : 0) - (b.imageTypeCode === 'GEN' ? -1 : 0) || (a.order || 0) - (b.order || 0)).slice(0, 8).map(i => 'https://photos.hotelbeds.com/giata/bigger/' + i.path);
      content.set(h.code, { images: imgs, description: (h.description && h.description.content || '').slice(0, 700), address: h.address && h.address.content || '' });
    }
  } catch (e) { console.warn('Hotel content:', e.message); }
  for (const c of need) if (!content.has(c)) content.set(c, { images: [], description: '', address: '' });
}

/** q: { dest:{city,lat,lng,radius}, checkIn, checkOut, rooms:[{adults, childAges}], hotelCodes? } */
async function search(q) {
  if (!live()) return demo(q);
  const groups = groupRooms(q.rooms);
  const key = JSON.stringify([q.dest.lat, q.dest.lng, q.checkIn, q.checkOut, groups, q.hotelCodes]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  const body = {
    stay: { checkIn: q.checkIn, checkOut: q.checkOut },
    occupancies: groups.map(g => ({ rooms: g.count, adults: g.adults * g.count, children: g.ages.length * g.count, ...(g.ages.length ? { paxes: [].concat(...Array(g.count).fill(g.ages.map(age => ({ type: 'CH', age })))) } : {}) })),
    ...(q.hotelCodes ? { hotels: { hotel: q.hotelCodes.map(Number) } } : { geolocation: { latitude: +q.dest.lat, longitude: +q.dest.lng, radius: Math.min(+q.dest.radius || 15, 50), unit: 'km' } }),
    filter: { maxHotels: q.hotelCodes ? 5 : 60, maxRatesPerRoom: 6 },
  };
  const d = await hb.call('hotel', 'POST', '/hotel-api/1.0/hotels', body);
  const raw = (d.hotels && d.hotels.hotels) || [];
  await loadContent(raw.map(h => h.code));
  const nights = nightsBetween(q.checkIn, q.checkOut);
  const hotels = raw.map(h => {
    const cur = h.currency || 'EUR';
    const allRates = (h.rooms || []).flatMap(r => (r.rates || []).map(rt => ({ room: r, rt })));
    const opts = groups.map((g, gi) => ({
      label: groupLabel(g, gi), count: g.count,
      options: allRates.filter(({ rt }) => (+rt.rooms || 1) === g.count && (+rt.adults === g.adults * g.count || +rt.adults === g.adults) && ((+rt.children || 0) === g.ages.length * g.count || (+rt.children || 0) === g.ages.length))
        .map(({ room, rt }) => { const c = cancelText(rt); return { id: rid(5), roomCode: room.code, roomName: room.name, board: rt.boardName || rt.boardCode, boardCode: rt.boardCode, rateKey: rt.rateKey, rateType: rt.rateType, net: num(rt.net), currency: cur, refundable: c.refundable, cancel: c.text, offers: (rt.offers || []).map(o => o.name) }; })
        .sort((a, b) => a.net - b.net).slice(0, 12),
    }));
    if (opts.some(o => !o.options.length)) return null;
    const c = content.get(h.code) || {};
    const minNet = opts.reduce((s, o) => s + o.options[0].net, 0);
    return { code: h.code, name: h.name, stars: (String(h.categoryName || '').match(/\d/) || [0])[0] * 1, category: h.categoryName, zone: h.zoneName, city: h.destinationName, lat: num(h.latitude), lng: num(h.longitude), images: c.images || [], description: c.description || '', address: c.address || '', currency: cur, minNet, nights, groups: opts };
  }).filter(Boolean).sort((a, b) => a.minNet - b.minNet);
  const data = { hotels, source: 'hotelbeds' };
  if (hotels.length) cache.set(key, { at: Date.now(), data });
  return data;
}

/** Turn the user's choice (one option per room group) into a quotation item */
function makeItem(hotel, picks, q, destIdx) {
  const rooms = hotel.groups.map((g, i) => { const o = g.options.find(x => x.id === picks[i]) || g.options[0]; return { label: g.label, count: g.count, roomName: o.roomName, roomCode: o.roomCode, board: o.board, boardCode: o.boardCode, rateKey: o.rateKey, net: o.net, refundable: o.refundable, cancel: o.cancel }; });
  const it = {
    kind: 'hotel', source: hotel.source || 'hotelbeds', destIdx, title: hotel.name, stars: hotel.stars, city: hotel.city || q.dest.city, zone: hotel.zone, image: (hotel.images || [])[0] || '',
    checkIn: q.checkIn, checkOut: q.checkOut, nights: nightsBetween(q.checkIn, q.checkOut), rooms, hotelCode: hotel.code,
    board: [...new Set(rooms.map(r => r.board))].join(' / '), refundable: rooms.every(r => r.refundable), cancel: rooms.map(r => r.cancel).join(' · '),
    net: Math.round(rooms.reduce((s, r) => s + r.net, 0) * 100) / 100, currency: hotel.currency, ref: rooms.map(r => r.rateKey).join('~'),
    occupancy: q.rooms,
  };
  it.sig = signItem(it);
  return it;
}

/** Book at processing time: re-check the rate (re-search the same hotel if the rate has expired). */
async function book(item, guests, holder, clientRef) {
  if (item.source === 'demo') return { status: 'CONFIRMED (demo)', supplierRef: 'DEMO-' + rid(3).toUpperCase(), net: item.net, currency: item.currency };
  let keys = [];
  try {
    const chk = await hb.call('hotel', 'POST', '/hotel-api/1.0/checkrates', { rooms: item.rooms.map(r => ({ rateKey: r.rateKey })) });
    keys = (chk.hotel.rooms || []).flatMap(r => (r.rates || []).map(x => ({ rateKey: x.rateKey, net: num(x.net) })));
  } catch (e) {
    // rate expired → search the same hotel again and pick the same room & board
    const fresh = await search({ dest: {}, checkIn: item.checkIn, checkOut: item.checkOut, rooms: item.occupancy, hotelCodes: [item.hotelCode] });
    const h = fresh.hotels[0];
    if (!h) throw new Error('Hotel is no longer available for these dates.');
    keys = item.rooms.map((r, i) => { const o = h.groups[i].options.find(x => x.roomCode === r.roomCode && x.boardCode === r.boardCode) || h.groups[i].options.find(x => x.boardCode === r.boardCode); if (!o) throw new Error(`Room "${r.roomName}" (${r.board}) is no longer available.`); return { rateKey: o.rateKey, net: o.net }; });
  }
  const newNet = keys.reduce((s, k) => s + k.net, 0);
  // paxes: guests are listed room by room in the same order as item.occupancy
  let gi = 0, roomId = 0;
  const rooms = item.rooms.map((r, i) => ({ rateKey: (keys[i] || keys[0]).rateKey, paxes: [] }));
  // distribute guests per physical room
  const groups = groupRooms(item.occupancy);
  groups.forEach((g, i) => {
    for (let c = 0; c < g.count; c++) {
      roomId++;
      for (let a = 0; a < g.adults; a++) { const x = guests[gi++] || guests[0]; rooms[i].paxes.push({ roomId, type: 'AD', name: x.name, surname: x.surname }); }
      g.ages.forEach(age => { const x = guests[gi++] || guests[0]; rooms[i].paxes.push({ roomId, type: 'CH', age, name: x.name, surname: x.surname }); });
    }
  });
  const d = await hb.call('hotel', 'POST', '/hotel-api/1.0/bookings', { holder: { name: holder.name, surname: holder.surname }, rooms, clientReference: String(clientRef).slice(0, 20), remark: holder.remark || '', tolerance: 3 });
  const b = d.booking || {};
  return { status: b.status || 'CONFIRMED', supplierRef: b.reference, net: newNet || item.net, currency: b.currency || item.currency, raw: d };
}

async function cancel(supplierRef) {
  if (String(supplierRef).startsWith('DEMO')) return { status: 'CANCELLED (demo)' };
  const d = await hb.call('hotel', 'DELETE', `/hotel-api/1.0/bookings/${encodeURIComponent(supplierRef)}?cancellationFlag=CANCELLATION`);
  return { status: d.booking && d.booking.status || 'CANCELLED', raw: d };
}

/* ---------- sample hotels until the key is added ---------- */
function demo(q) {
  const groups = groupRooms(q.rooms), nights = Math.max(1, nightsBetween(q.checkIn, q.checkOut));
  const base = [['Grand Palace Hotel', 5, 'City Centre', 140], ['Marina View Suites', 4, 'Marina', 95], ['Garden Inn', 3, 'Old Town', 48], ['Skyline Residence', 4, 'Business District', 80], ['Royal Crescent', 5, 'Waterfront', 175], ['Comfort Stay Hotel', 3, 'Central', 39]];
  const hotels = base.map(([n, st, zone, per], hi) => {
    const opts = groups.map((g, gi) => {
      const f = g.count * (g.adults / 2 + g.ages.length * 0.25) * nights * per;
      const mk = (room, board, m, ref) => ({ id: `d${hi}${gi}${room.length}${board.length}`, roomCode: room.slice(0, 3).toUpperCase(), roomName: room, board, boardCode: board.slice(0, 2).toUpperCase(), rateKey: `DEMO|${hi}|${gi}|${room}|${board}`, net: Math.round(f * m * 100) / 100, currency: 'USD', refundable: ref, cancel: ref ? 'Free cancellation until 3 days before check-in' : 'Non-refundable' });
      return { label: groupLabel(g, gi), count: g.count, options: [mk('Superior Double Room', 'Room only', 0.9, false), mk('Superior Double Room', 'Bed and breakfast', 1, true), mk('Deluxe Twin Room', 'Bed and breakfast', 1.25, true), mk('Executive Suite', 'Half board', 1.7, true)] };
    });
    return { code: 9000 + hi, name: `${n} ${q.dest.city}`, stars: st, category: st + ' STARS', zone, city: q.dest.city, images: [], description: 'Sample hotel (demo). Real hotels, photos and live rates appear once the Hotelbeds key is set on the server.', address: '', currency: 'USD', minNet: opts.reduce((s, o) => s + o.options[0].net, 0), nights, groups: opts, source: 'demo' };
  }).sort((a, b) => a.minNet - b.minNet);
  return { hotels, source: 'demo' };
}

module.exports = { name, live, search, makeItem, book, cancel };
