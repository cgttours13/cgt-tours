// Margins, currency conversion and quotation totals
const db = require('./db');
const { num } = require('./util');

const DEFAULT_SETTINGS = {
  id: 'main',
  company: { name: 'Choudhary Group of Travels', brand: 'CGT Tours', phone: '0321-1111121 | 0345-7775328 | 041-2621200', email: '', address: '', website: '', logo: '' },
  margins: { flight: 3, hotel: 10, transfer: 15, activity: 15, extra: 0 },   // admin margin % added on supplier net
  fx: { PKR: 1, USD: 281, EUR: 325, GBP: 375, AED: 76.5, SAR: 75, MYR: 64, THB: 8.6 }, // 1 unit = PKR (set today's rates in Admin)
  quoteCurrencies: ['PKR', 'USD'],
  allowAgentProfit: true,
  validityHours: 48,
  notes: [
    'Standard international check-in is at 2:00 PM to 4:00 PM (depending on the market), and check-out is at 12:00 PM. Early check-in or late check-out is subject to availability and the hotel\'s discretion.',
    'There will be no refunds for services such as meals, sightseeing, or activities that are not utilized during the tour.',
    'Hotel services and beds are subject to availability.',
    'Quotation valid for 48 hours only.',
  ],
  excludes: ['Anything not specifically mentioned in the above quotation.', 'Travel insurance, tips, personal expenses, meals & drinks (unless mentioned).'],
};

function settings() {
  const s = db.get('settings', 'main');
  if (!s) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...s, company: { ...DEFAULT_SETTINGS.company, ...(s.company || {}) }, margins: { ...DEFAULT_SETTINGS.margins, ...(s.margins || {}) }, fx: { ...DEFAULT_SETTINGS.fx, ...(s.fx || {}) } };
}

const rate = (cur, s = settings()) => { const r = num(s.fx[String(cur || 'PKR').toUpperCase()]); if (!r) throw new Error(`No exchange rate for ${cur}. Add it in Admin → Settings.`); return r; };
const toPKR = (amount, cur, s) => num(amount) * rate(cur, s);
const marginFor = (kind, user, s = settings()) => {
  const o = user && user.margins && user.margins[kind];
  return o !== undefined && o !== null && o !== '' ? num(o) : num(s.margins[kind]);
};
/** Selling price in PKR for one item, for the given user (admin margin applied, rounded up to 10). */
function sellPKR(item, user, s = settings()) {
  if (item.source === 'manual' && item.sellIsFinal) return Math.round(toPKR(item.net, item.currency, s));
  const base = toPKR(item.net, item.currency, s);
  return Math.ceil(base * (1 + marginFor(item.kind, user, s) / 100) / 10) * 10;
}

/** Totals for a quotation. Owner's margins decide the price (so agents always get their own rate). */
function price(q, owner) {
  const s = settings();
  const lines = { flight: 0, hotel: 0, transfer: 0, activity: 0, extra: 0 };
  const costs = { ...lines };
  for (const it of allItems(q)) {
    const sp = sellPKR(it, owner, s);
    it.sellPKR = sp;
    lines[it.kind] = (lines[it.kind] || 0) + sp;
    costs[it.kind] = (costs[it.kind] || 0) + toPKR(it.net, it.currency, s);
  }
  const subtotal = Object.values(lines).reduce((a, b) => a + b, 0);
  const ap = q.agentProfit || {};
  const agentProfit = s.allowAgentProfit ? (ap.type === 'percent' ? subtotal * num(ap.value) / 100 : num(ap.value)) : 0;
  const totalPKR = Math.round(subtotal + agentProfit);
  const pax = q.trip.pax, paying = Math.max(1, (pax.adt || 0) + (pax.chd || 0));
  const cur = (q.currency || 'PKR').toUpperCase();
  const conv = v => cur === 'PKR' ? Math.round(v) : Math.round(v / rate(cur, s) * 100) / 100;
  const cost = Object.values(costs).reduce((a, b) => a + b, 0);
  return {
    currency: cur, lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, conv(v)])),
    agentProfit: conv(agentProfit), total: conv(totalPKR), perPerson: conv(totalPKR / paying),
    totalPKR, costPKR: Math.round(cost), profitPKR: Math.round(totalPKR - cost),
    cost: Math.round(cost), profit: Math.round(totalPKR - cost),
  };
}
const allItems = q => ['flights', 'hotels', 'transfers', 'activities', 'extras'].flatMap(k => (q.items && q.items[k]) || []);

/** Remove supplier net prices and secret keys for users who may not see them. */
function forViewer(q, canSeeNet) {
  const c = JSON.parse(JSON.stringify(q));
  if (!canSeeNet) {
    for (const it of allItems(c)) { delete it.net; delete it.currency; delete it.sig; delete it.raw; }
    if (c.pricing) { delete c.pricing.cost; delete c.pricing.profit; delete c.pricing.costPKR; delete c.pricing.profitPKR; }
  }
  for (const it of allItems(c)) delete it.raw;
  return c;
}

module.exports = { DEFAULT_SETTINGS, settings, toPKR, sellPKR, marginFor, price, allItems, forViewer, rate };
