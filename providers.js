/**
 * Which supplier powers each service.
 * To swap a supplier later, add a new prov-*.js file with the same functions
 * (search, makeItem, book, cancel — activities also: options) and register it below.
 * Then choose it in Render → Environment, e.g. PROVIDER_HOTELS=ratehawk.
 */
const registry = {
  flights: { aiqs: () => require('./prov-flights') },
  hotels: { hotelbeds: () => require('./prov-hotels') },
  transfers: { hotelbeds: () => require('./prov-transfers') },
  activities: { hotelbeds: () => require('./prov-activities') },
};
const pick = (service, envName, def) => {
  const want = (process.env[envName] || def).toLowerCase();
  const f = registry[service][want] || registry[service][def];
  return f();
};
module.exports = {
  flights: pick('flights', 'PROVIDER_FLIGHTS', 'aiqs'),
  hotels: pick('hotels', 'PROVIDER_HOTELS', 'hotelbeds'),
  transfers: pick('transfers', 'PROVIDER_TRANSFERS', 'hotelbeds'),
  activities: pick('activities', 'PROVIDER_ACTIVITIES', 'hotelbeds'),
};
