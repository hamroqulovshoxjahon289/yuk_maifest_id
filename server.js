// Yuk Manifest — login, ko'p egali (multi-tenant) versiya
// Rollar: owner (egasi, Google orqali), ishchi (egasi yaratadi), zborshik (egasi yaratadi)
try { require('dotenv').config(); } catch { /* dotenv ixtiyoriy */ }

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { createStore } = require('./store');
const {
  hashPassword, verifyPassword, signToken, verifyToken, parseCookies, verifyGoogleIdToken, createLimiter,
} = require('./auth');

const app = express();
app.set('trust proxy', 1); // Railway proxy ortida — https'ni to'g'ri aniqlash uchun
const PORT = process.env.PORT || 3000;

// Railway'da doimiy Volume papkasi (masalan "/data"). Bo'lmasa — loyiha papkasi.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// Eski ma'lumotlarni qaysi Google email egasi olishi (tavsiya etiladi). Bo'sh bo'lsa — birinchi ro'yxatdan o'tgan.
const LEGACY_OWNER_EMAIL = (process.env.LEGACY_OWNER_EMAIL || '').trim().toLowerCase();

const MAX_PER_DAY = 99;
const SESSION_DAYS = 30;
const DEFAULT_CATEGORIES = ['Shkaf', 'Penal', 'Adnaspalni', 'Spalni garnitur', 'Termo', 'Dvuxspalni', 'Sandiq', 'Divan'];
const MATRAS_CATEGORIES = ['Adnaspalni', 'Spalni garnitur', 'Dvuxspalni', 'Divan'];
const MATRAS_TYPES = ['Pol artaped', 'Artaped', 'Super artaped'];
const HOLATLAR = ['yashil', 'qizil', 'sariq'];
const HOLAT_EXCEL_LABEL = { qizil: 'Hali tayyor emas', sariq: 'Yuklanmoqda', yashil: 'Yuborildi' };

const store = createStore(DATA_DIR);
fs.mkdirSync(DATA_DIR, { recursive: true });

// Sessiya kaliti: env'dan yoki diskda bir marta yaratiladi (server qayta ishga tushsa ham sessiyalar saqlanadi)
function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'accounts', 'session-secret.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SESSION_SECRET = loadSessionSecret();

// Toshkent vaqti bo'yicha bugungi sana (server UTC'da bo'lsa ham kun siljimaydi)
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
}

app.use(express.json({ limit: '200kb' }));

// Boshqa saytdan keladigan o'zgartiruvchi so'rovlarni to'xtatish (CSRF'ga qo'shimcha himoya)
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    } catch { return res.status(403).json({ error: 'Ruxsat yo\'q' }); }
  }
  next();
});

// ============================================================
//  SESSIYA / FOYDALANUVCHI
// ============================================================
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function publicUser(u) {
  const owner = u.role === 'owner' ? u : store.users().find((x) => x.id === u.ownerId);
  return {
    id: u.id, role: u.role, name: u.name,
    perms: effectivePerms(u),
    ownerName: owner ? owner.name : '',
    codeEnabled: !!(owner && owner.actionCodeHash),
    deleteCodeEnabled: !!(owner && owner.deleteCodeHash),
    payCodeEnabled: !!(owner && owner.payCodeHash),
    email: u.email || undefined,
  };
}

function getUser(req) {
  const token = parseCookies(req.headers.cookie).sid;
  const payload = verifyToken(token, SESSION_SECRET);
  if (!payload) return null;
  const u = store.users().find((x) => x.id === payload.uid);
  if (!u || u.active === false) return null;
  if ((u.tokenVersion || 0) !== (payload.v || 0)) return null; // parol o'zgargan / to'xtatilgan
  if (u.role !== 'owner') {
    const owner = store.users().find((x) => x.id === u.ownerId);
    if (!owner || owner.active === false) return null;
  }
  return u;
}

function setSession(req, res, user) {
  const token = signToken({ uid: user.id, v: user.tokenVersion || 0, exp: Date.now() + SESSION_DAYS * 86400000 }, SESSION_SECRET);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function homeFor(u) { return u.role === 'zborshik' ? '/zborshik.html' : '/yuk.html'; }

function requireAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Avval tizimga kiring' });
  req.user = u;
  req.ownerId = u.role === 'owner' ? u.id : u.ownerId;
  req.paths = store.ownerPaths(req.ownerId);
  next();
}
function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Bu amal uchun ruxsat yo\'q' }));
}
const staffOnly = requireRole('owner', 'ishchi');
const ownerOnly = requireRole('owner');
// Ruxsatlar: add (yuk qo'shish), edit (tahrirlash), pay (pul qabul qilish), delete (yuk o'chirish),
// reorder (zakaz tartibini almashtirish), team (jamoani boshqarish). Egasida hammasi bor.
// Eski xodimlarda 'edit' yo'q bo'lsa, 'add' ruxsati bilan bir xil deb olinadi.
function effectivePerms(u) {
  if (u.role === 'owner') return { add: true, edit: true, pay: true, delete: true, reorder: true, team: true };
  const p = u.perms || {};
  return {
    add: !!p.add,
    edit: p.edit === undefined ? !!p.add : !!p.edit,
    pay: !!p.pay,
    delete: !!p.delete,
    reorder: !!p.reorder,
    team: !!p.team,
  };
}
function can(...perms) {
  return (req, res, next) => {
    const ep = effectivePerms(req.user);
    if (perms.some((perm) => ep[perm])) return next();
    res.status(403).json({ error: 'Sizda bu amal uchun ruxsat yo\'q. Egasidan so\'rang.' });
  };
}

// ---------- Kodlar (egasi Sozlamalarda o'zi qo'yadi, xohlagan payt o'zgartiradi) ----------
// 1) Amal kodi (4 xonali): yuk qo'shish, tahrirlash, pul qabul qilish.
// 2) O'chirish kodi (4 xonali): yukni, zborshik/labo/filial/xodimni o'chirish.
// Kod o'rnatilmagan bo'lsa, o'sha amal kodsiz ishlayveradi.
const codeLimiter = createLimiter(8, 15 * 60 * 1000);
function needCode(kind) {
  const field = { action: 'actionCodeHash', delete: 'deleteCodeHash', pay: 'payCodeHash' }[kind];
  const what = { action: 'Bu amal', delete: "O'chirish", pay: 'Pul qabul qilish' }[kind];
  return (req, res, next) => {
    const owner = store.users().find((x) => x.id === req.ownerId);
    if (!owner || !owner[field]) return next();
    const key = `${req.ownerId}|${req.ip}|${kind}`;
    if (!codeLimiter.check(key)) {
      return res.status(429).json({ error: "Kod juda ko'p marta noto'g'ri kiritildi. 15 daqiqadan keyin urinib ko'ring." });
    }
    const code = String(req.headers['x-action-code'] || '').trim();
    if (!code || !verifyPassword(code, owner[field])) {
      if (code) codeLimiter.fail(key);
      return res.status(403).json({ error: code ? "Kod noto'g'ri" : `${what} uchun kod kerak`, codeRequired: true, codeKind: kind });
    }
    codeLimiter.clear(key);
    next();
  };
}
const actionCode = needCode('action');
const deleteCode = needCode('delete');
const payCode = needCode('pay');

// ============================================================
//  SAHIFALAR (himoyalangan) va statik fayllar
// ============================================================
function pageGuard(roles, file) {
  return (req, res) => {
    const u = getUser(req);
    if (!u) return res.redirect('/');
    if (!roles.includes(u.role)) return res.redirect(homeFor(u));
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'private', file));
  };
}
app.get('/', (req, res) => {
  const u = getUser(req);
  if (u) return res.redirect(homeFor(u));
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/yuk.html', pageGuard(['owner', 'ishchi'], 'yuk.html'));
app.get('/zborshik.html', pageGuard(['zborshik'], 'zborshik.html'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ============================================================
//  AUTH API
// ============================================================
const loginLimiter = createLimiter(8, 15 * 60 * 1000);

app.get('/api/auth/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));

app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google kirish hali sozlanmagan (GOOGLE_CLIENT_ID yo\'q)' });
  let info;
  try {
    info = await verifyGoogleIdToken(req.body.credential, GOOGLE_CLIENT_ID);
  } catch (err) {
    console.error('Google token xatosi:', err.message);
    return res.status(401).json({ error: 'Google orqali tasdiqlab bo\'lmadi. Qayta urinib ko\'ring.' });
  }
  if (!info.emailVerified) return res.status(401).json({ error: 'Google email tasdiqlanmagan' });

  const users = store.users();
  let user = users.find((u) => u.role === 'owner' && u.googleSub === info.sub)
    || users.find((u) => u.role === 'owner' && u.email === info.email);
  if (user) {
    if (!user.googleSub) { user.googleSub = info.sub; store.saveUsers(); }
  } else {
    user = {
      id: crypto.randomUUID(), role: 'owner', name: info.name, email: info.email,
      googleSub: info.sub, active: true, tokenVersion: 0, createdAt: new Date().toISOString(),
    };
    user.ownerId = user.id;
    users.push(user);
    store.saveUsers();
    initOwnerData(user);
  }
  if (user.active === false) return res.status(403).json({ error: 'Bu akaunt o\'chirilgan' });
  setSession(req, res, user);
  res.json({ ok: true, redirect: homeFor(user) });
});

function initOwnerData(owner) {
  const p = store.ownerPaths(owner.id);
  fs.mkdirSync(p.dir, { recursive: true });
  const legacyOk = store.legacyAvailable() && (!LEGACY_OWNER_EMAIL || LEGACY_OWNER_EMAIL === owner.email);
  if (legacyOk) {
    store.claimLegacy(owner.id, owner.email);
    console.log(`Eski ma'lumotlar ${owner.email} akauntiga ko'chirildi`);
  } else {
    store.writeJson(p.taxonomy, DEFAULT_CATEGORIES.map((name) => ({ id: crypto.randomUUID(), name, colors: [] })));
  }
}

app.post('/api/auth/login', (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = `${req.ip}|${login}`;
  if (!loginLimiter.check(key)) return res.status(429).json({ error: 'Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring.' });

  const user = store.users().find((u) => u.role !== 'owner' && u.login === login);
  const ok = user ? verifyPassword(password, user.passHash) : (verifyPassword(password, DUMMY_HASH), false);
  if (!ok) {
    loginLimiter.fail(key);
    return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
  }
  if (user.active === false) return res.status(403).json({ error: 'Sizning kirishingiz to\'xtatilgan. Egasiga murojaat qiling.' });
  const owner = store.users().find((u) => u.id === user.ownerId);
  if (!owner || owner.active === false) return res.status(403).json({ error: 'Akaunt faol emas' });
  loginLimiter.clear(key);
  setSession(req, res, user);
  res.json({ ok: true, redirect: homeFor(user) });
});

app.post('/api/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

// Egasi kodlarini o'rnatadi / o'zgartiradi / o'chiradi. Yuborilmagan maydon o'zgarmaydi, bo'sh yuborilsa — o'chadi.
// Sozlamalarga kirish xavfsizligi: amal kodi o'rnatilgan bo'lsa, Sozlamalarni ochish va kodlarni o'zgartirish uchun shu kod kerak.
app.get('/api/codes/check', requireAuth, ownerOnly, actionCode, (req, res) => res.json({ ok: true }));

app.put('/api/codes', requireAuth, ownerOnly, actionCode, (req, res) => {
  const map = { actionCode: 'actionCodeHash', deleteCode: 'deleteCodeHash', payCode: 'payCodeHash' };
  const changes = {};
  for (const key of Object.keys(map)) {
    if (req.body[key] === undefined || req.body[key] === null) continue;
    const v = String(req.body[key]).trim();
    if (v && !/^\d{4}$/.test(v)) return res.status(400).json({ error: "Kod aniq 4 ta raqamdan iborat bo'lsin" });
    changes[key] = v;
  }
  for (const key of Object.keys(changes)) {
    if (changes[key]) req.user[map[key]] = hashPassword(changes[key]);
    else delete req.user[map[key]];
  }
  store.saveUsers();
  res.json({ ok: true, codeEnabled: !!req.user.actionCodeHash, deleteCodeEnabled: !!req.user.deleteCodeHash, payCodeEnabled: !!req.user.payCodeHash });
});

// ============================================================
//  LOGIN/PAROL VALIDATSIYASI
// ============================================================
function validateLogin(login, excludeUserId) {
  const l = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(l)) return { error: "Login 3–30 belgi bo'lsin: faqat lotin harflari, raqam, nuqta, chiziqcha" };
  if (store.users().some((u) => u.login === l && u.id !== excludeUserId)) return { error: 'Bu login band, boshqasini tanlang' };
  return { value: l };
}
function validatePassword(pw) {
  const p = String(pw || '');
  if (p.length < 6) return { error: "Parol kamida 6 belgidan iborat bo'lsin" };
  if (p.length > 100) return { error: 'Parol juda uzun' };
  return { value: p };
}
function cleanPerms(p) {
  const q = p || {};
  return { add: !!q.add, edit: !!q.edit, pay: !!q.pay, delete: !!q.delete, reorder: !!q.reorder, team: !!q.team };
}
function publicStaff(u) {
  return { id: u.id, name: u.name, login: u.login, active: u.active !== false, perms: effectivePerms(u), createdAt: u.createdAt };
}

// ============================================================
//  XODIMLAR (ishchilar) — faqat egasi
// ============================================================
app.get('/api/staff', requireAuth, ownerOnly, (req, res) => {
  res.json(store.users().filter((u) => u.role === 'ishchi' && u.ownerId === req.ownerId).map(publicStaff));
});

app.post('/api/staff', requireAuth, ownerOnly, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Ishchi ismini kiriting' });
  const l = validateLogin(req.body.login);
  if (l.error) return res.status(400).json({ error: l.error });
  const p = validatePassword(req.body.password);
  if (p.error) return res.status(400).json({ error: p.error });
  const user = {
    id: crypto.randomUUID(), role: 'ishchi', ownerId: req.ownerId, name, login: l.value,
    passHash: hashPassword(p.value), active: true, tokenVersion: 0,
    perms: req.body.perms ? cleanPerms(req.body.perms) : { add: true, edit: true, pay: false, delete: false, reorder: false, team: false },
    createdAt: new Date().toISOString(),
  };
  store.users().push(user);
  store.saveUsers();
  res.json(publicStaff(user));
});

app.put('/api/staff/:id', requireAuth, ownerOnly, (req, res) => {
  const u = store.users().find((x) => x.id === req.params.id && x.role === 'ishchi' && x.ownerId === req.ownerId);
  if (!u) return res.status(404).json({ error: 'Ishchi topilmadi' });
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Ism bo\'sh bo\'lmasin' });
    u.name = name;
  }
  if (req.body.login !== undefined && String(req.body.login).trim().toLowerCase() !== u.login) {
    const l = validateLogin(req.body.login, u.id);
    if (l.error) return res.status(400).json({ error: l.error });
    u.login = l.value;
    u.tokenVersion = (u.tokenVersion || 0) + 1;
  }
  if (req.body.password) {
    const p = validatePassword(req.body.password);
    if (p.error) return res.status(400).json({ error: p.error });
    u.passHash = hashPassword(p.value);
    u.tokenVersion = (u.tokenVersion || 0) + 1; // eski sessiyalar tugaydi
  }
  if (req.body.perms) u.perms = cleanPerms(req.body.perms);
  if (req.body.active !== undefined) {
    u.active = !!req.body.active;
    if (!u.active) u.tokenVersion = (u.tokenVersion || 0) + 1;
  }
  store.saveUsers();
  res.json(publicStaff(u));
});

app.delete('/api/staff/:id', requireAuth, ownerOnly, deleteCode, (req, res) => {
  const users = store.users();
  const idx = users.findIndex((x) => x.id === req.params.id && x.role === 'ishchi' && x.ownerId === req.ownerId);
  if (idx === -1) return res.status(404).json({ error: 'Ishchi topilmadi' });
  users.splice(idx, 1);
  store.saveUsers();
  res.json({ ok: true });
});

// ============================================================
//  YUK MANIFEST — ma'lumotlar (har bir ega uchun alohida)
// ============================================================
const readLoads = (p) => store.readJson(p.loads, []);
const writeLoads = (p, loads) => store.writeJson(p.loads, loads);
const readZborshiklar = (p) => store.readJson(p.zborshiklar, []);
const readLabolar = (p) => store.readJson(p.labolar, []);
const readFiliallar = (p) => store.readJson(p.filiallar, []);
function readTaxonomy(p) {
  let tax = store.readJson(p.taxonomy, null);
  if (!tax) {
    tax = DEFAULT_CATEGORIES.map((name) => ({ id: crypto.randomUUID(), name, colors: [] }));
    store.writeJson(p.taxonomy, tax);
  }
  return tax;
}

function totalPaid(l) {
  return (l.tolovlar || []).reduce((sum, t) => sum + (Number(t.summa) || 0), 0);
}
function publicLoad(l) {
  const { pin, ...rest } = l; // eski PIN maydoni hech qachon yuborilmaydi
  const jamiTolangan = totalPaid(l);
  return { ...rest, jamiTolangan, qoldiq: Math.max(0, (Number(l.astatka) || 0) - jamiTolangan) };
}

function buildWorkbook(loads) {
    try {
        const wb = XLSX.utils.book_new();

        // ---------- 1-VARAQ: Zakazlar (asosiy ro'yxat) ----------
        const rows = loads.map((l) => {
            const jamiTolangan = totalPaid(l);
            const qoldiq = Math.max(0, (Number(l.astatka) || 0) - jamiTolangan);
            return {
                'Sana': l.sana,
                'Holat': HOLAT_EXCEL_LABEL[l.holat] || l.holat,
                'Filial': l.filial?.nomi || '',
                'Kategoriya': l.kategoriya?.nomi || '',
                'Nomi': l.nomi || '',
                'Matras': l.matras?.bor ? (l.matras.turi || 'Bor') : '',
                'Izoh': l.izoh || '',
                'Hudud': l.manzil?.hudud || '',
                'Dom': l.manzil?.dom || '',
                'Padyez': l.manzil?.padyez || '',
                'Etaj': l.manzil?.etaj || '',
                'Astatka': l.astatka || 0,
                'Telefon 1': l.tel1 || '',
                'Telefon 2': l.tel2 || '',
                "Zborshik": l.zborshik?.ism || '',
                'Zborshik tel': l.zborshik?.telefon || '',
                'Labo raqami': l.labo?.raqami || '',
                'Haydovchi': l.labo?.haydovchi || '',
                'Haydovchi tel': l.labo?.telefon || '',
                "Jami to'langan": jamiTolangan,
                "Qoldiq": qoldiq,
                "To'landimi": l.tolandi ? "To'liq to'landi" : (jamiTolangan > 0 ? 'Qisman to\'landi' : "Yo'q"),
                'Yaratilgan': l.createdAt || '',
            };
        });
        const sheet = XLSX.utils.json_to_sheet(rows);
        sheet['!cols'] = [
            { wch: 11 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
            { wch: 26 }, { wch: 20 }, { wch: 8 }, { wch: 9 }, { wch: 7 }, { wch: 13 },
            { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 16 },
            { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 15 }, { wch: 19 },
        ];
        if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
        XLSX.utils.book_append_sheet(wb, sheet, 'Zakazlar');

        // ---------- 2-VARAQ: Zborshiklar hisoboti ----------
        const zbRows = loads.filter((l) => l.zborshik).map((l) => ({
            'Sana': l.sana,
            'Zborshik': l.zborshik.ism,
            'Telefon': l.zborshik.telefon || '',
            'Buyurtma': l.nomi || '',
            'Filial': l.filial?.nomi || '',
            'Hudud': l.manzil?.hudud || '',
            'Holat': HOLAT_EXCEL_LABEL[l.holat] || l.holat,
        }));
        const zbSheet = XLSX.utils.json_to_sheet(zbRows);
        zbSheet['!cols'] = [{ wch: 11 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 16 }];
        if (zbSheet['!ref']) zbSheet['!autofilter'] = { ref: zbSheet['!ref'] };
        XLSX.utils.book_append_sheet(wb, zbSheet, 'Zborshiklar hisoboti');

        // ---------- 3-VARAQ: Labolar hisoboti ----------
        const lbRows = loads.filter((l) => l.labo).map((l) => ({
            'Sana': l.sana,
            'Labo raqami': l.labo.raqami,
            'Haydovchi': l.labo.haydovchi,
            'Telefon': l.labo.telefon || '',
            'Buyurtma': l.nomi || '',
            'Filial': l.filial?.nomi || '',
            'Hudud': l.manzil?.hudud || '',
            'Holat': HOLAT_EXCEL_LABEL[l.holat] || l.holat,
        }));
        const lbSheet = XLSX.utils.json_to_sheet(lbRows);
        lbSheet['!cols'] = [{ wch: 11 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 16 }];
        if (lbSheet['!ref']) lbSheet['!autofilter'] = { ref: lbSheet['!ref'] };
        XLSX.utils.book_append_sheet(wb, lbSheet, 'Labolar hisoboti');

        // ---------- 4-VARAQ: Kassa (barcha to'lovlar) ----------
        const kassaRows = [];
        loads.forEach((l) => {
            (l.tolovlar || []).forEach((t) => {
                kassaRows.push({
                    "To'lov sanasi": t.sana,
                    'Buyurtma': l.nomi || '',
                    'Filial': l.filial?.nomi || '',
                    'Hudud': l.manzil?.hudud || '',
                    'Summa': Number(t.summa) || 0,
                });
            });
        });
        kassaRows.sort((a, b) => String(a["To'lov sanasi"]).localeCompare(String(b["To'lov sanasi"])));
        const jamiKassa = kassaRows.reduce((s, r) => s + r.Summa, 0);
        kassaRows.push({ "To'lov sanasi": '', 'Buyurtma': '', 'Filial': '', 'Hudud': 'JAMI:', 'Summa': jamiKassa });
        const kassaSheet = XLSX.utils.json_to_sheet(kassaRows);
        kassaSheet['!cols'] = [{ wch: 13 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 14 }];
        if (kassaSheet['!ref']) kassaSheet['!autofilter'] = { ref: kassaSheet['!ref'] };
        XLSX.utils.book_append_sheet(wb, kassaSheet, 'Kassa');

        return wb;
    } catch (err) {
        console.error("Excel yaratishda xatolik:", err.message);
        return XLSX.utils.book_new();
    }
}


// ---------- Taxonomy ----------
app.get('/api/taxonomy', requireAuth, staffOnly, (req, res) => {
  res.json({ categories: readTaxonomy(req.paths), matrasCategories: MATRAS_CATEGORIES, matrasTypes: MATRAS_TYPES });
});
app.post('/api/taxonomy/categories', requireAuth, staffOnly, can('add', 'team'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Kategoriya nomini kiriting' });
  const tax = readTaxonomy(req.paths);
  if (tax.some((c) => c.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Bu kategoriya allaqachon mavjud' });
  const cat = { id: crypto.randomUUID(), name, colors: [] };
  tax.push(cat);
  store.writeJson(req.paths.taxonomy, tax);
  res.json(cat);
});
// ---------- Zborshiklar (+ ixtiyoriy login/parol) ----------
function zborshikWithLogin(z, users) {
  const acc = users.find((u) => u.role === 'zborshik' && u.zborshikId === z.id);
  return { ...z, login: acc ? acc.login : null, loginActive: acc ? acc.active !== false : false };
}
app.get('/api/zborshiklar', requireAuth, staffOnly, (req, res) => {
  const list = readZborshiklar(req.paths);
  if (req.user.role !== 'owner') return res.json(list); // ishchi login ma'lumotini ko'rmaydi
  res.json(list.map((z) => zborshikWithLogin(z, store.users())));
});

app.post('/api/zborshiklar', requireAuth, staffOnly, can('add', 'team'), (req, res) => {
  const ism = String(req.body.ism || '').trim();
  const telefon = String(req.body.telefon || '').trim();
  if (!ism) return res.status(400).json({ error: 'Zborshik ismini kiriting' });

  let loginValue = null; let passValue = null;
  if (req.body.login || req.body.password) {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Login-parolni faqat egasi yarata oladi' });
    const l = validateLogin(req.body.login);
    if (l.error) return res.status(400).json({ error: l.error });
    const p = validatePassword(req.body.password);
    if (p.error) return res.status(400).json({ error: p.error });
    loginValue = l.value; passValue = p.value;
  }
  const list = readZborshiklar(req.paths);
  const z = { id: crypto.randomUUID(), ism, telefon };
  list.push(z);
  store.writeJson(req.paths.zborshiklar, list);
  if (loginValue) {
    store.users().push({
      id: crypto.randomUUID(), role: 'zborshik', ownerId: req.ownerId, name: ism, zborshikId: z.id,
      login: loginValue, passHash: hashPassword(passValue), active: true, tokenVersion: 0, createdAt: new Date().toISOString(),
    });
    store.saveUsers();
  }
  res.json(zborshikWithLogin(z, store.users()));
});

// Zborshik login-parolini yaratish / o'zgartirish / to'xtatish — faqat egasi
app.put('/api/zborshiklar/:id/login', requireAuth, ownerOnly, (req, res) => {
  const z = readZborshiklar(req.paths).find((x) => x.id === req.params.id);
  if (!z) return res.status(404).json({ error: 'Zborshik topilmadi' });
  let acc = store.users().find((u) => u.role === 'zborshik' && u.zborshikId === z.id && u.ownerId === req.ownerId);

  if (!acc) {
    const l = validateLogin(req.body.login);
    if (l.error) return res.status(400).json({ error: l.error });
    const p = validatePassword(req.body.password);
    if (p.error) return res.status(400).json({ error: p.error });
    acc = {
      id: crypto.randomUUID(), role: 'zborshik', ownerId: req.ownerId, name: z.ism, zborshikId: z.id,
      login: l.value, passHash: hashPassword(p.value), active: true, tokenVersion: 0, createdAt: new Date().toISOString(),
    };
    store.users().push(acc);
  } else {
    if (req.body.login !== undefined && String(req.body.login).trim().toLowerCase() !== acc.login) {
      const l = validateLogin(req.body.login, acc.id);
      if (l.error) return res.status(400).json({ error: l.error });
      acc.login = l.value;
      acc.tokenVersion = (acc.tokenVersion || 0) + 1;
    }
    if (req.body.password) {
      const p = validatePassword(req.body.password);
      if (p.error) return res.status(400).json({ error: p.error });
      acc.passHash = hashPassword(p.value);
      acc.tokenVersion = (acc.tokenVersion || 0) + 1;
    }
    if (req.body.active !== undefined) {
      acc.active = !!req.body.active;
      if (!acc.active) acc.tokenVersion = (acc.tokenVersion || 0) + 1;
    }
  }
  store.saveUsers();
  res.json(zborshikWithLogin(z, store.users()));
});

app.delete('/api/zborshiklar/:id/login', requireAuth, ownerOnly, deleteCode, (req, res) => {
  const users = store.users();
  const idx = users.findIndex((u) => u.role === 'zborshik' && u.zborshikId === req.params.id && u.ownerId === req.ownerId);
  if (idx === -1) return res.status(404).json({ error: 'Bu zborshikda login yo\'q' });
  users.splice(idx, 1);
  store.saveUsers();
  res.json({ ok: true });
});

// ---------- Labolar / Filiallar ----------
app.get('/api/labolar', requireAuth, staffOnly, (req, res) => res.json(readLabolar(req.paths)));
app.post('/api/labolar', requireAuth, staffOnly, can('add', 'team'), (req, res) => {
  const raqami = String(req.body.raqami || '').trim();
  const haydovchi = String(req.body.haydovchi || '').trim();
  const telefon = String(req.body.telefon || '').trim();
  if (!raqami || !haydovchi) return res.status(400).json({ error: 'Labo raqami va haydovchi ismini kiriting' });
  const list = readLabolar(req.paths);
  const l = { id: crypto.randomUUID(), raqami, haydovchi, telefon };
  list.push(l);
  store.writeJson(req.paths.labolar, list);
  res.json(l);
});
app.get('/api/filiallar', requireAuth, staffOnly, (req, res) => res.json(readFiliallar(req.paths)));
app.post('/api/filiallar', requireAuth, staffOnly, can('add', 'team'), (req, res) => {
  const nomi = String(req.body.nomi || '').trim();
  if (!nomi) return res.status(400).json({ error: 'Filial nomini kiriting' });
  const list = readFiliallar(req.paths);
  if (list.some((f) => f.nomi.toLowerCase() === nomi.toLowerCase())) return res.status(400).json({ error: 'Bu filial allaqachon mavjud' });
  const f = { id: crypto.randomUUID(), nomi };
  list.push(f);
  store.writeJson(req.paths.filiallar, list);
  res.json(f);
});

// ---------- O'chirish: zborshik / labo / filial (jamoani boshqarish ruxsati + o'chirish kodi) ----------
// Eski zakazlarda ularning ismi nusxa sifatida saqlanib qoladi, shuning uchun tarix buzilmaydi.
app.delete('/api/zborshiklar/:id', requireAuth, staffOnly, can('team'), deleteCode, (req, res) => {
  const list = readZborshiklar(req.paths);
  const idx = list.findIndex((z) => z.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Zborshik topilmadi' });
  list.splice(idx, 1);
  store.writeJson(req.paths.zborshiklar, list);
  const users = store.users();
  let removed = false;
  for (let i = users.length - 1; i >= 0; i--) {
    if (users[i].role === 'zborshik' && users[i].zborshikId === req.params.id && users[i].ownerId === req.ownerId) { users.splice(i, 1); removed = true; }
  }
  if (removed) store.saveUsers();
  res.json({ ok: true });
});
app.delete('/api/labolar/:id', requireAuth, staffOnly, can('team'), deleteCode, (req, res) => {
  const list = readLabolar(req.paths);
  const idx = list.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Labo topilmadi' });
  list.splice(idx, 1);
  store.writeJson(req.paths.labolar, list);
  res.json({ ok: true });
});
app.delete('/api/filiallar/:id', requireAuth, staffOnly, can('team'), deleteCode, (req, res) => {
  const list = readFiliallar(req.paths);
  const idx = list.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Filial topilmadi' });
  list.splice(idx, 1);
  store.writeJson(req.paths.filiallar, list);
  res.json({ ok: true });
});

// ---------- Zakaz tartib raqami (har bir kun ichida 1, 2, 3, ...) ----------
const NEW_LAST = 1e9;
// Har bir kundagi zakazlarni 1..n qilib qayta raqamlaydi. O'zgargan bo'lsa true qaytaradi.
function normalizeOrder(loads) {
  const byDay = new Map();
  loads.forEach((l) => {
    const k = l.sana || '';
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(l);
  });
  let changed = false;
  byDay.forEach((list) => {
    list.sort((a, b) => ((a.tartib ?? 1e8) - (b.tartib ?? 1e8)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    list.forEach((l, i) => { if (l.tartib !== i + 1) { l.tartib = i + 1; changed = true; } });
  });
  return changed;
}

// ---------- Yuklar ----------
app.get('/api/loads', requireAuth, staffOnly, (req, res) => {
  const loads = readLoads(req.paths);
  if (normalizeOrder(loads)) writeLoads(req.paths, loads); // eski zakazlarga ham tartib raqami beriladi
  res.json(loads.map(publicLoad));
});

// Zborshik faqat o'ziga biriktirilgan zakazlarni ko'radi (hamma ma'lumoti bilan)
app.get('/api/my-loads', requireAuth, requireRole('zborshik'), (req, res) => {
  const mine = readLoads(req.paths).filter((l) => l.zborshik && l.zborshik.id === req.user.zborshikId);
  mine.sort((a, b) => String(a.sana).localeCompare(String(b.sana)) || ((a.tartib ?? 1e8) - (b.tartib ?? 1e8)));
  res.json(mine.map(publicLoad));
});

function resolveMatras(kategoriyaNomi, input) {
  if (!input || !input.bor) return { bor: false, turi: null };
  if (!MATRAS_CATEGORIES.includes(kategoriyaNomi)) return { bor: false, turi: null };
  return { bor: true, turi: MATRAS_TYPES.includes(input.turi) ? input.turi : MATRAS_TYPES[0] };
}
function snapZborshik(p, id) {
  const z = readZborshiklar(p).find((x) => x.id === id);
  return z ? { id: z.id, ism: z.ism, telefon: z.telefon } : null;
}
function snapLabo(p, id) {
  const l = readLabolar(p).find((x) => x.id === id);
  return l ? { id: l.id, raqami: l.raqami, haydovchi: l.haydovchi, telefon: l.telefon } : null;
}
function snapFilial(p, id) {
  const f = readFiliallar(p).find((x) => x.id === id);
  return f ? { id: f.id, nomi: f.nomi } : null;
}

app.post('/api/loads', requireAuth, staffOnly, can('add'), actionCode, (req, res) => {
  const { sana, holat, kategoriyaId, nomi, matras, izoh, manzil, astatka, tel1, tel2, zborshikId, laboId, filialId } = req.body;
  if (!sana || !kategoriyaId || !String(nomi || '').trim()) {
    return res.status(400).json({ error: 'Sana, kategoriya va nomi majburiy' });
  }
  const loads = readLoads(req.paths);
  if (loads.filter((l) => l.sana === sana).length >= MAX_PER_DAY) {
    return res.status(400).json({ error: `Bu kunga zakazlar to'ldi (kuniga maksimum ${MAX_PER_DAY} ta)` });
  }
  const cat = readTaxonomy(req.paths).find((c) => c.id === kategoriyaId);
  if (!cat) return res.status(400).json({ error: 'Kategoriya topilmadi' });

  const newLoad = {
    id: crypto.randomUUID(),
    sana,
    holat: HOLATLAR.includes(holat) ? holat : 'qizil',
    kategoriya: { id: cat.id, nomi: cat.name },
    nomi: String(nomi).trim(),
    matras: resolveMatras(cat.name, matras),
    izoh: String(izoh || '').trim(),
    manzil: { hudud: manzil?.hudud || '', dom: manzil?.dom || '', padyez: manzil?.padyez || '', etaj: manzil?.etaj || '' },
    astatka: Number(astatka) || 0,
    tel1: tel1 || '',
    tel2: tel2 || '',
    zborshik: zborshikId ? snapZborshik(req.paths, zborshikId) : null,
    labo: laboId ? snapLabo(req.paths, laboId) : null,
    filial: filialId ? snapFilial(req.paths, filialId) : null,
    yaratdi: req.user.name,
    tolovlar: [],
    tolandi: false,
    tartib: NEW_LAST, // kunning oxirgi raqamini oladi
    createdAt: new Date().toISOString(),
  };
  loads.push(newLoad);
  normalizeOrder(loads);
  writeLoads(req.paths, loads);
  res.json(publicLoad(newLoad));
});

app.put('/api/loads/:id', requireAuth, staffOnly, can('edit'), actionCode, (req, res) => {
  const loads = readLoads(req.paths);
  const idx = loads.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  const { sana, holat, kategoriyaId, nomi, matras, izoh, manzil, astatka, tel1, tel2, zborshikId, laboId, filialId } = req.body;
  const oldSana = loads[idx].sana;

  if (sana && sana !== loads[idx].sana) {
    if (loads.filter((l) => l.sana === sana && l.id !== loads[idx].id).length >= MAX_PER_DAY) {
      return res.status(400).json({ error: `Bu kunga zakazlar to'ldi (kuniga maksimum ${MAX_PER_DAY} ta)` });
    }
  }
  let kategoriya = loads[idx].kategoriya;
  let matrasFinal = loads[idx].matras;
  if (kategoriyaId || matras !== undefined) {
    const cat = readTaxonomy(req.paths).find((c) => c.id === (kategoriyaId || loads[idx].kategoriya?.id));
    if (cat) kategoriya = { id: cat.id, nomi: cat.name };
    matrasFinal = resolveMatras(kategoriya.nomi, matras !== undefined ? matras : loads[idx].matras);
  }
  loads[idx] = {
    ...loads[idx],
    sana: sana ?? loads[idx].sana,
    holat: HOLATLAR.includes(holat) ? holat : loads[idx].holat,
    kategoriya,
    nomi: nomi !== undefined ? String(nomi).trim() : loads[idx].nomi,
    matras: matrasFinal,
    izoh: izoh !== undefined ? String(izoh).trim() : loads[idx].izoh,
    manzil: manzil ?? loads[idx].manzil,
    astatka: astatka !== undefined ? Number(astatka) : loads[idx].astatka,
    tel1: tel1 ?? loads[idx].tel1,
    tel2: tel2 ?? loads[idx].tel2,
    zborshik: zborshikId !== undefined ? (zborshikId ? (snapZborshik(req.paths, zborshikId) || loads[idx].zborshik) : null) : loads[idx].zborshik,
    labo: laboId !== undefined ? (laboId ? (snapLabo(req.paths, laboId) || loads[idx].labo) : null) : loads[idx].labo,
    filial: filialId !== undefined ? (filialId ? (snapFilial(req.paths, filialId) || loads[idx].filial) : null) : loads[idx].filial,
  };
  if (loads[idx].sana !== oldSana) loads[idx].tartib = NEW_LAST; // boshqa kunga o'tdi — o'sha kunning oxiriga
  normalizeOrder(loads);
  writeLoads(req.paths, loads);
  res.json(publicLoad(loads[idx]));
});

// Zborshik / labo / filial / holatni tezkor almashtirish (ishchi ham qila oladi)
app.put('/api/loads/:id/assign', requireAuth, staffOnly, can('edit'), (req, res) => {
  const loads = readLoads(req.paths);
  const idx = loads.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  const { zborshikId, laboId, holat, filialId } = req.body;
  if (zborshikId !== undefined) loads[idx].zborshik = zborshikId ? (snapZborshik(req.paths, zborshikId) || loads[idx].zborshik) : null;
  if (laboId !== undefined) loads[idx].labo = laboId ? (snapLabo(req.paths, laboId) || loads[idx].labo) : null;
  if (filialId !== undefined) loads[idx].filial = filialId ? (snapFilial(req.paths, filialId) || loads[idx].filial) : null;
  if (holat !== undefined && HOLATLAR.includes(holat)) loads[idx].holat = holat;
  writeLoads(req.paths, loads);
  res.json(publicLoad(loads[idx]));
});

// Zakazni kun ichida boshqa raqamga ko'chirish: qolganlari siljiydi (3 ga qo'ysangiz, oldingi 3 → 4, 4 → 5 ...)
app.put('/api/loads/:id/move', requireAuth, staffOnly, can('reorder'), (req, res) => {
  const loads = readLoads(req.paths);
  normalizeOrder(loads);
  const load = loads.find((l) => l.id === req.params.id);
  if (!load) return res.status(404).json({ error: 'Topilmadi' });
  let pos = Math.floor(Number(req.body.tartib));
  if (!pos || pos < 1) return res.status(400).json({ error: "Tartib raqamini kiriting (1 dan boshlab)" });
  const day = loads.filter((l) => l.sana === load.sana).sort((a, b) => a.tartib - b.tartib);
  pos = Math.min(pos, day.length);
  const rest = day.filter((l) => l !== load);
  rest.splice(pos - 1, 0, load);
  rest.forEach((l, i) => { l.tartib = i + 1; });
  writeLoads(req.paths, loads);
  res.json(publicLoad(load));
});

app.put('/api/loads/:id/pay', requireAuth, staffOnly, can('pay'), payCode, (req, res) => {
  const amount = Number(req.body.summa);
  if (!amount || amount <= 0) return res.status(400).json({ error: "To'lov miqdorini kiriting" });
  const loads = readLoads(req.paths);
  const idx = loads.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  if (loads[idx].tolandi) return res.status(400).json({ error: "Bu yuk uchun pul allaqachon to'liq olingan" });
  if (!loads[idx].tolovlar) loads[idx].tolovlar = [];
  loads[idx].tolovlar.push({ sana: todayStr(), summa: amount, kim: req.user.name });
  if (totalPaid(loads[idx]) >= (Number(loads[idx].astatka) || 0)) loads[idx].tolandi = true;
  writeLoads(req.paths, loads);
  res.json(publicLoad(loads[idx]));
});

app.put('/api/loads/:id/unpay', requireAuth, staffOnly, can('pay'), payCode, (req, res) => {
  const loads = readLoads(req.paths);
  const idx = loads.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  loads[idx].tolovlar = [];
  loads[idx].tolandi = false;
  writeLoads(req.paths, loads);
  res.json(publicLoad(loads[idx]));
});

app.delete('/api/loads/:id', requireAuth, staffOnly, can('delete'), deleteCode, (req, res) => {
  let loads = readLoads(req.paths);
  if (!loads.some((l) => l.id === req.params.id)) return res.status(404).json({ error: 'Topilmadi' });
  loads = loads.filter((l) => l.id !== req.params.id);
  normalizeOrder(loads); // qolganlar 1, 2, 3... bo'lib qayta raqamlanadi
  writeLoads(req.paths, loads);
  res.json({ ok: true });
});

app.get('/api/export/excel', requireAuth, staffOnly, (req, res) => {
  const wb = buildWorkbook(readLoads(req.paths));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="yuk-manifest.xlsx"',
  });
  res.send(buf);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Topilmadi' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ishga tushdi: port ${PORT}`);
  console.log(`Ma'lumotlar papkasi: ${DATA_DIR}`);
  if (!GOOGLE_CLIENT_ID) console.warn("DIQQAT: GOOGLE_CLIENT_ID sozlanmagan — Google orqali kirish ishlamaydi");
  if (store.legacyAvailable() && !LEGACY_OWNER_EMAIL) {
    console.warn("DIQQAT: eski zakazlar bor, lekin LEGACY_OWNER_EMAIL sozlanmagan — birinchi Google orqali kirgan odam ularni oladi");
  }
});
