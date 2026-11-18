// Users, passwords, login tokens and permissions
const crypto = require('crypto');
const db = require('./db');
const { SECRET, rid } = require('./util');

const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64 = s => Buffer.from(s).toString('base64url');
function makeToken(user, hours = 12) {
  const body = b64(JSON.stringify({ uid: user.id, v: user.tokenVersion || 0, exp: Date.now() + hours * 3600e3 }));
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function readToken(t) {
  const [body, sig] = String(t || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (p.exp < Date.now()) return null;
  const u = db.get('users', p.uid);
  if (!u || !u.active || (u.tokenVersion || 0) !== p.v) return null;
  return u;
}

/** Roles: admin (everything) · staff (team member) · agent (sub-agent / network agency) */
const can = (u, perm) => {
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (perm === 'processBookings') return !!u.canProcessBookings;
  if (perm === 'seeAllQuotations') return u.role === 'staff' && !!u.canSeeAllQuotations;
  if (perm === 'seeNet') return !!u.canSeeNet;
  return false;
};

const attempts = new Map();
function rateLimit(key) {
  const now = Date.now(), a = (attempts.get(key) || []).filter(t => now - t < 15 * 60e3);
  a.push(now); attempts.set(key, a);
  return a.length <= 10;
}

function requireUser(req, res, next) {
  const u = readToken((req.get('authorization') || '').replace(/^Bearer /, ''));
  if (!u) return res.status(401).json({ error: 'Please sign in again.' });
  req.user = u; next();
}
const requirePerm = perm => (req, res, next) => can(req.user, perm) ? next() : res.status(403).json({ error: 'You do not have permission for this.' });

function publicUser(u) {
  const { password, tokenVersion, ...rest } = u;
  return rest;
}

/** Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when there are no users yet. */
function ensureAdmin() {
  if (db.all('users').length) return;
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
  db.put('users', {
    id: rid(6), username, password: hashPassword(pw), role: 'admin', name: 'Administrator', active: true,
    canProcessBookings: true, canSeeNet: true, createdAt: new Date().toISOString(),
    agency: { name: 'Choudhary Group of Travels', phone: '', email: '', address: '', logo: '' },
  });
  console.log(`Admin account created: ${username}`);
}

module.exports = { hashPassword, checkPassword, makeToken, readToken, requireUser, requirePerm, can, publicUser, ensureAdmin, rateLimit };
