/**
 * Hotelbeds (HBX Group APItude) connection shared by the hotel, transfer and sightseeing providers.
 * Each product uses its own key; the Bundle key is used as a backup when a product key is missing
 * or has reached its daily quota.
 *   HB_URL                         https://api.test.hotelbeds.com  (live: https://api.hotelbeds.com)
 *   HB_HOTEL_KEY / HB_HOTEL_SECRET
 *   HB_ACTIVITY_KEY / HB_ACTIVITY_SECRET
 *   HB_TRANSFER_KEY / HB_TRANSFER_SECRET
 *   HB_BUNDLE_KEY / HB_BUNDLE_SECRET
 */
const crypto = require('crypto');
const { httpJson } = require('./util');

const URL_ = (process.env.HB_URL || 'https://api.test.hotelbeds.com').replace(/\/$/, '');
const pair = p => (process.env[`HB_${p}_KEY`] && process.env[`HB_${p}_SECRET`]) ? { name: p, key: process.env[`HB_${p}_KEY`], secret: process.env[`HB_${p}_SECRET`] } : null;
const KEYS = {
  hotel: [pair('HOTEL'), pair('BUNDLE')].filter(Boolean),
  activity: [pair('ACTIVITY'), pair('BUNDLE')].filter(Boolean),
  transfer: [pair('TRANSFER'), pair('BUNDLE')].filter(Boolean),
};
const exhausted = new Map(); // key -> until timestamp

const configured = product => KEYS[product].length > 0;

async function call(product, method, path, body) {
  const keys = KEYS[product].filter(k => !(exhausted.get(k.key) > Date.now()));
  if (!keys.length) { const e = new Error(KEYS[product].length ? 'Daily Hotelbeds test quota reached. It resets in 24 hours.' : `No Hotelbeds ${product} key set.`); e.status = 503; throw e; }
  let last;
  for (const k of keys) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha256').update(k.key + k.secret + ts).digest('hex');
    try {
      return await httpJson(URL_ + path, { method, body, headers: { 'Api-key': k.key, 'X-Signature': sig, 'Accept-Encoding': 'gzip' }, timeout: 60000 });
    } catch (e) {
      last = e;
      const quota = e.status === 429 || (e.status === 403 && /quota|limit|exceeded/i.test(e.raw || e.message));
      if (quota) { exhausted.set(k.key, Date.now() + 6 * 3600e3); continue; }
      if (e.status === 401 || e.status === 403) { e.message = `Hotelbeds rejected the ${k.name} key (${e.message}). Check the key and secret.`; continue; }
      throw e;
    }
  }
  throw last;
}

module.exports = { call, configured, URL: URL_, isTest: /test/.test(URL_) };
