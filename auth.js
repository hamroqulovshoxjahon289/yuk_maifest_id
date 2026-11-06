// Autentifikatsiya yordamchilari — tashqi kutubxonasiz (faqat Node'ning o'z "crypto" moduli)
const crypto = require('crypto');

// ---------- Parol ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------- Imzolangan token (cookie ichida) ----------
function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(body).digest('base64url'));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Cookie ----------
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---------- Google ID token tekshiruvi ----------
let certCache = { keys: null, exp: 0 };
async function getGoogleKeys(fetchImpl, force) {
  if (!force && certCache.keys && Date.now() < certCache.exp) return certCache.keys;
  const r = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error("Google kalitlarini olib bo'lmadi");
  const data = await r.json();
  certCache = { keys: data.keys || [], exp: Date.now() + 60 * 60 * 1000 };
  return certCache.keys;
}
function decodePart(s) { return JSON.parse(Buffer.from(s, 'base64url').toString()); }

async function verifyGoogleIdToken(idToken, clientId, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error("Token shakli noto'g'ri");
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Algoritm qo\'llab-quvvatlanmaydi');

  let keys = await getGoogleKeys(fetchImpl, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getGoogleKeys(fetchImpl, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('Kalit topilmadi');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Imzo noto\'g\'ri');

  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('Issuer noto\'g\'ri');
  if (payload.aud !== clientId) throw new Error('Client ID mos kelmadi');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('Token muddati tugagan');
  if (!payload.sub || !payload.email) throw new Error('Email topilmadi');
  return {
    sub: payload.sub,
    email: String(payload.email).toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name || payload.email,
  };
}

// ---------- Urinishlarni cheklash (parol terishdan himoya) ----------
function createLimiter(max, windowMs) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || rec.reset < now) return true;
      return rec.count < max;
    },
    fail(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || rec.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
      else rec.count += 1;
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    },
    clear(key) { hits.delete(key); },
  };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, parseCookies, verifyGoogleIdToken, createLimiter };
