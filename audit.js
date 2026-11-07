// Kuzatuv jurnali (audit log): kim, qachon, qaysi qurilmadan, nima qildi, oldin nima edi -> keyin nima bo'ldi.
// Faqat egasi (admin) ko'radi, alohida kod bilan himoyalangan. Jurnal faqat qo'shiladi (o'chirish/tahrirlash endpointi yo'q).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP_LINES = 60000;           // jurnalda saqlanadigan eng ko'p yozuv
const MAX_BYTES = 25 * 1024 * 1024; // shu hajmdan oshsa eng eskilari kesiladi
const HOLAT = { qizil: 'Hali tayyor emas', sariq: 'Yuklanmoqda', yashil: 'Yuborildi' };
const ROLE = { owner: 'Admin (ega)', ishchi: 'Xodim', zborshik: 'Zborshik', labo: 'Shafyor (labo)', sotuvchi: 'Sotuvchi' };

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const money = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const cut = (v, n) => String(v ?? '').slice(0, n);

// ---------- Qurilmani User-Agent'dan aniqlash ----------
function parseUA(uaRaw) {
  const ua = String(uaRaw || '');
  let os = "Noma'lum"; let model = '';
  let m;
  if (/iPhone/.test(ua)) { m = ua.match(/OS (\d+)[_\d]*/); os = 'iOS' + (m ? ' ' + m[1] : ''); model = 'iPhone'; }
  else if (/iPad/.test(ua)) { m = ua.match(/OS (\d+)[_\d]*/); os = 'iPadOS' + (m ? ' ' + m[1] : ''); model = 'iPad'; }
  else if (/Android/.test(ua)) {
    m = ua.match(/Android ([\d.]+)/); os = 'Android' + (m ? ' ' + m[1] : '');
    const mm = ua.match(/Android [\d.]+; ([^;)]+)/);
    if (mm) { const v = mm[1].trim().replace(/ Build.*/, ''); if (v && !/^(wv|Mobile|U|K)$/i.test(v)) model = v; }
  }
  else if (/Windows NT/.test(ua)) { m = ua.match(/Windows NT ([\d.]+)/); os = 'Windows' + (m ? (m[1] === '10.0' ? ' 10/11' : ' ' + m[1]) : ''); }
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';

  let tur = 'Kompyuter / noutbuk';
  if (/iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) tur = 'Planshet';
  else if (/iPhone|Android|Mobile/i.test(ua)) tur = 'Telefon';

  let brauzer = 'Brauzer';
  if (/Telegram/i.test(ua)) brauzer = 'Telegram';
  else if (/Instagram/i.test(ua)) brauzer = 'Instagram';
  else if (/FBAN|FBAV/.test(ua)) brauzer = 'Facebook';
  else if (/YaBrowser/.test(ua)) brauzer = 'Yandex';
  else if (/SamsungBrowser/.test(ua)) brauzer = 'Samsung Internet';
  else if (/OPR\/|Opera/.test(ua)) brauzer = 'Opera';
  else if (/Edg\//.test(ua)) brauzer = 'Edge';
  else if (/Firefox|FxiOS/.test(ua)) brauzer = 'Firefox';
  else if (/CriOS|Chrome/.test(ua)) brauzer = 'Chrome';
  else if (/Safari/.test(ua)) brauzer = 'Safari';
  if (!ua) { tur = "Noma'lum"; brauzer = "Noma'lum"; }
  return { tur, os, model, brauzer };
}
function cleanIp(ip) { return String(ip || '').replace(/^::ffff:/, '').slice(0, 64); }
function deviceOf(req, extra) {
  const d = parseUA(req.headers['user-agent']);
  d.ip = cleanIp(req.ip);
  // Brauzer o'zi yuborgan qo'shimcha ma'lumot (faqat kirishda): ekran o'lchami, til, vaqt mintaqasi
  const x = extra && typeof extra === 'object' ? extra : null;
  if (x) {
    if (x.ekran) d.ekran = cut(x.ekran, 20);
    if (x.til) d.til = cut(x.til, 20);
    if (x.tz) d.tz = cut(x.tz, 40);
    if (x.platforma) d.platforma = cut(x.platforma, 40);
  }
  return d;
}

// ---------- Zakaz maydonlarini o'qiladigan ko'rinishga keltirish va solishtirish ----------
const itemsText = (l) => ((l && l.skladItems) || []).map((i) => `${i.model} ×${i.soni}`).sort().join(', ');
const FIELDS = [
  ["Jo'natish sanasi", (l) => l.sana],
  ['Holat', (l) => HOLAT[l.holat] || l.holat],
  ['Kategoriya', (l) => l.kategoriya && l.kategoriya.nomi],
  ['Nomi', (l) => l.nomi, 'nomi'],
  ['Izoh', (l) => l.izoh],
  ['Hudud', (l) => l.manzil && l.manzil.hudud],
  ['Dom', (l) => l.manzil && l.manzil.dom],
  ['Padyez', (l) => l.manzil && l.manzil.padyez],
  ['Etaj', (l) => l.manzil && l.manzil.etaj],
  ["Astatka (so'm)", (l) => (l.astatka || l.astatka === 0 ? money(l.astatka) : '')],
  ['1-telefon', (l) => l.tel1],
  ['2-telefon', (l) => l.tel2],
  ['Zborshik', (l) => l.zborshik && l.zborshik.ism],
  ['Labo (mashina)', (l) => l.labo && l.labo.raqami],
  ['Filial', (l) => l.filial && l.filial.nomi],
  ['Matras (eski belgi)', (l) => (l.matras && l.matras.bor ? l.matras.turi : '')],
  ['Sklad mahsulotlari', itemsText],
  ['Zalog', (l) => (l.zalog && l.zalog.summa ? `${money(l.zalog.summa)} so'm${l.zalog.izoh ? ` (${l.zalog.izoh})` : ''}` : '')],
];
const show = (v) => (v === undefined || v === null || String(v).trim() === '' ? '—' : String(v));
function diffLoads(a, b, skip = []) {
  const out = [];
  FIELDS.forEach(([label, get, key]) => {
    if (key && skip.includes(key)) return;
    const x = show(get(a || {})); const y = show(get(b || {}));
    if (x !== y) out.push({ m: label, oldin: cut(x, 300), keyin: cut(y, 300) });
  });
  return out;
}
function snapshotRows(l, closing) {
  const rows = [];
  FIELDS.forEach(([label, get]) => {
    const v = show(get(l || {}));
    if (v !== '—') rows.push(closing ? { m: label, oldin: cut(v, 300), keyin: closing } : { m: label, oldin: '—', keyin: cut(v, 300) });
  });
  return rows;
}
const paidTotal = (l) => ((l && l.tolovlar) || []).reduce((s, t) => s + (Number(t.summa) || 0), 0);
const pendingShape = (p, withHolat) => (p ? {
  ...(withHolat ? { holat: 'qizil' } : {}),
  sana: p.sana, kategoriya: p.kategoriya, nomi: p.nomi, izoh: p.izoh, manzil: p.manzil, astatka: p.astatka, tel1: p.tel1, tel2: p.tel2,
  filial: p.filial, matras: p.matras, skladItems: p.skladItems, zalog: p.zalogSumma ? { summa: p.zalogSumma, izoh: p.zalogIzoh } : null,
} : {});
const permText = (perms) => {
  const names = { add: "qo'shish", edit: 'tahrirlash', pay: 'pul olish', delete: "o'chirish", reorder: 'tartib', team: 'jamoa' };
  const on = Object.keys(names).filter((k) => perms && perms[k]).map((k) => names[k]);
  return on.length ? on.join(', ') : "ruxsat yo'q";
};
const userShape = (u) => (u ? { name: u.name, login: u.login, faol: u.active !== false ? 'ha' : "yo'q (to'xtatilgan)", perms: permText(u.perms) } : null);
function diffObj(a, b, labels) {
  const out = [];
  Object.keys(labels).forEach((k) => {
    const x = show(a && a[k]); const y = show(b && b[k]);
    if (x !== y) out.push({ m: labels[k], oldin: x, keyin: y });
  });
  return out;
}
const USER_LABELS = { name: 'Ism', login: 'Login', faol: 'Kirishi yoqilgan', perms: 'Ruxsatlar' };

function createAudit({ store, getUser, sklad }) {
  const counters = new Map();
  const seen = new Map(); // throttle: kalit -> oxirgi vaqt

  function appendLine(ownerId, ev) {
    const p = store.ownerPaths(ownerId).audit;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(ev) + '\n');
    const n = (counters.get(p) || 0) + 1;
    counters.set(p, n);
    if (n % 300 === 1) trim(p);
  }
  function trim(p) {
    try {
      if (fs.statSync(p).size <= MAX_BYTES) return;
      const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
      const keep = lines.slice(-KEEP_LINES);
      fs.writeFileSync(`${p}.tmp`, keep.join('\n') + '\n');
      fs.renameSync(`${p}.tmp`, p);
    } catch (e) { console.error('Kuzatuv jurnalini kesishda xato:', e.message); }
  }

  // Asosiy yozuv funksiyasi. Hech qachon so'rovni buzmaydi (xato bo'lsa faqat konsolga yozadi).
  function log(req, entry, opts = {}) {
    try {
      const actor = opts.actor || req.user;
      const ownerId = opts.ownerId || req.ownerId;
      if (!actor || !ownerId) return;
      const ev = {
        id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
        t: new Date().toISOString(),
        kim: { id: actor.id, ism: actor.name, rol: actor.role },
        tur: entry.tur,
        matn: cut(entry.matn, 400),
        q: deviceOf(req, opts.device),
      };
      if (entry.xavf) ev.xavf = true;
      if (entry.yuk) ev.yuk = { id: entry.yuk.id, nomi: cut(entry.yuk.nomi, 120), sana: entry.yuk.sana };
      if (entry.oz && entry.oz.length) ev.oz = entry.oz.slice(0, 40);
      appendLine(ownerId, ev);
    } catch (e) { console.error('Kuzatuv yozuvi xatosi:', e.message); }
  }

  // Faollik: bir odam uchun ko'pi bilan har N daqiqada bitta yozuv
  function touch(req, matn, minutes) {
    if (!req.user) return;
    const key = `${req.user.id}|faollik`;
    const now = Date.now();
    if (now - (seen.get(key) || 0) < minutes * 60000) return;
    seen.set(key, now);
    log(req, { tur: 'faollik', matn });
  }
  function once(req, key, ms, entry) {
    const k = `${req.user.id}|${key}`;
    const now = Date.now();
    if (now - (seen.get(k) || 0) < ms) return;
    seen.set(k, now);
    log(req, entry);
  }

  // ---------- Marshrutlar jadvali ----------
  const E = (m) => new RegExp(`^/api/${m}$`);
  const ROUTES = [
    ['POST', E('loads'), 'load_new'],
    ['PUT', E('loads/([^/]+)'), 'load_edit'],
    ['PUT', E('loads/([^/]+)/assign'), 'load_assign'],
    ['PUT', E('loads/([^/]+)/move'), 'load_move'],
    ['PUT', E('loads/([^/]+)/pay'), 'load_pay'],
    ['PUT', E('loads/([^/]+)/unpay'), 'load_unpay'],
    ['DELETE', E('loads/([^/]+)'), 'load_del'],
    ['POST', E('pending/([^/]+)/approve'), 'p_approve'],
    ['POST', E('pending/([^/]+)/reject'), 'p_reject'],
    ['POST', E('sotuvchi/orders'), 's_new'],
    ['PUT', E('sotuvchi/orders/([^/]+)'), 's_edit'],
    ['DELETE', E('sotuvchi/orders/([^/]+)'), 's_del'],
    ['POST', E('staff'), 'staff_new'], ['PUT', E('staff/([^/]+)'), 'staff_edit'], ['DELETE', E('staff/([^/]+)'), 'staff_del'],
    ['POST', E('sotuvchilar'), 'sel_new'], ['PUT', E('sotuvchilar/([^/]+)'), 'sel_edit'], ['DELETE', E('sotuvchilar/([^/]+)'), 'sel_del'],
    ['POST', E('zborshiklar'), 'zb_new'], ['PUT', E('zborshiklar/([^/]+)/login'), 'zb_login'],
    ['DELETE', E('zborshiklar/([^/]+)/login'), 'zb_login_del'], ['DELETE', E('zborshiklar/([^/]+)'), 'zb_del'],
    ['POST', E('labolar'), 'lb_new'], ['PUT', E('labolar/([^/]+)/login'), 'lb_login'],
    ['DELETE', E('labolar/([^/]+)/login'), 'lb_login_del'], ['DELETE', E('labolar/([^/]+)'), 'lb_del'],
    ['POST', E('filiallar'), 'fl_new'], ['DELETE', E('filiallar/([^/]+)'), 'fl_del'],
    ['POST', E('taxonomy/categories'), 'cat_new'],
    ['PUT', E('codes'), 'codes'],
    ['POST', E('sklad/categories'), 'sk_cat_new'], ['PUT', E('sklad/categories/([^/]+)'), 'sk_cat_edit'], ['DELETE', E('sklad/categories/([^/]+)'), 'sk_cat_del'],
    ['POST', E('sklad/models'), 'sk_mod_new'], ['PUT', E('sklad/models/([^/]+)'), 'sk_mod_edit'], ['DELETE', E('sklad/models/([^/]+)'), 'sk_mod_del'],
    ['POST', E('sklad/models/([^/]+)/kirim'), 'sk_kirim'], ['PUT', E('sklad/models/([^/]+)/qoldiq'), 'sk_qoldiq'],
    ['PUT', E('sklad/models/([^/]+)/rasm'), 'sk_img'], ['DELETE', E('sklad/models/([^/]+)/rasm'), 'sk_img_del'],
  ];

  const readLoads = (paths) => store.readJson(paths.loads, []);
  const findLoad = (paths, id) => readLoads(paths).find((l) => l.id === id);
  const findPend = (paths, id) => (store.readJson(paths.pending, []) || []).find((x) => x.id === id);
  const userById = (id) => store.users().find((u) => u.id === id);
  const zbAcc = (zid) => store.users().find((u) => u.role === 'zborshik' && u.zborshikId === zid);
  const lbAcc = (lid) => store.users().find((u) => u.role === 'labo' && u.laboId === lid);
  const nameIn = (file, id, key) => { const x = (store.readJson(file, []) || []).find((e) => e.id === id); return x ? x[key] : null; };

  // So'rov bajarilishidan OLDIN holatni eslab qolamiz (keyin "oldin" sifatida ko'rsatiladi)
  function snapshotBefore(name, id, paths) {
    switch (name) {
      case 'load_edit': case 'load_assign': case 'load_move': case 'load_pay': case 'load_unpay': case 'load_del':
        return { load: clone(findLoad(paths, id)) };
      case 'p_approve': case 'p_reject': case 's_edit': case 's_del':
        return { pend: clone(findPend(paths, id)) };
      case 'staff_edit': case 'staff_del': case 'sel_edit': case 'sel_del':
        return { user: clone(userShape(userById(id))) };
      case 'zb_login': case 'zb_login_del': return { user: clone(userShape(zbAcc(id))), nom: nameIn(paths.zborshiklar, id, 'ism') };
      case 'lb_login': case 'lb_login_del': return { user: clone(userShape(lbAcc(id))), nom: nameIn(paths.labolar, id, 'raqami') };
      case 'zb_del': return { nom: nameIn(paths.zborshiklar, id, 'ism') };
      case 'lb_del': return { nom: nameIn(paths.labolar, id, 'raqami') };
      case 'fl_del': return { nom: nameIn(paths.filiallar, id, 'nomi') };
      case 'sk_cat_edit': case 'sk_cat_del': {
        const s = sklad.read(paths); const c = s.categories.find((x) => x.id === id);
        return { cat: clone(c), modelSoni: s.models.filter((m) => m.categoryId === id).length };
      }
      case 'sk_mod_edit': case 'sk_mod_del': case 'sk_kirim': case 'sk_qoldiq': case 'sk_img': case 'sk_img_del':
        return { model: clone(sklad.read(paths).models.find((x) => x.id === id)) };
      default: return {};
    }
  }
  const modelName = (paths, id) => { const m = sklad.read(paths).models.find((x) => x.id === id); return m ? m.nomi : null; };

  // Muvaffaqiyatli so'rovdan keyin yoziladigan yozuvni tuzish
  function build(name, id, ctx) {
    const { req, paths, pre, resBody } = ctx;
    const b = req.body || {};
    const yukOf = (l) => (l ? { id: l.id, nomi: l.nomi, sana: l.sana } : null);
    switch (name) {
      case 'load_new': {
        const l = resBody || {};
        return { tur: 'yuk_qoshdi', matn: `Yangi zakaz qo'shdi: «${l.nomi}»`, yuk: yukOf(l), oz: snapshotRows(l) };
      }
      case 'p_approve': {
        const l = resBody || {}; const p = pre.pend;
        const oz = p ? diffLoads(pendingShape(p, true), l, p.nomi ? [] : ['nomi']) : [];
        const edited = oz.length > 0;
        return { tur: 'tasdiq', matn: `Sotuvchi ${p && p.sotuvchi ? p.sotuvchi.ism : ''} zakazini ${edited ? 'TAHRIRLAB ' : ''}tasdiqladi: «${l.nomi}»`, yuk: yukOf(l), oz: edited ? oz : snapshotRows(l) };
      }
      case 'p_reject': {
        const p = pre.pend; if (!p) return null;
        return { tur: 'rad', matn: `Sotuvchi ${p.sotuvchi ? p.sotuvchi.ism : ''} zakazini rad etdi: «${p.nomi || itemsText(p)}»${b.sabab ? ` — sabab: ${cut(b.sabab, 200)}` : ''}`, yuk: { nomi: p.nomi || itemsText(p), sana: p.sana } };
      }
      case 's_new': {
        const p = resBody || {};
        return { tur: 'sotuvchi_zakaz', matn: `Zakaz yubordi (tasdiqlanishi kutilmoqda): «${p.nomi || itemsText(p)}»`, yuk: { nomi: p.nomi || itemsText(p), sana: p.sana }, oz: snapshotRows(pendingShape(p)) };
      }
      case 's_edit': {
        const oz = diffLoads(pendingShape(pre.pend), pendingShape(resBody));
        return { tur: 'sotuvchi_tahrir', matn: `Yuborgan zakazini tahrirladi: «${(resBody && resBody.nomi) || ''}»${pre.pend && pre.pend.status === 'rad' ? ' (rad etilgani qayta yuborildi)' : ''}`, yuk: { nomi: resBody && (resBody.nomi || itemsText(resBody)), sana: resBody && resBody.sana }, oz };
      }
      case 's_del': {
        const p = pre.pend; if (!p) return null;
        return { tur: 'sotuvchi_bekor', xavf: true, matn: `Yuborgan zakazini bekor qildi / o'chirdi: «${p.nomi || itemsText(p)}»`, yuk: { nomi: p.nomi || itemsText(p), sana: p.sana }, oz: snapshotRows(pendingShape(p), "(o'chirildi)") };
      }
      case 'load_edit': case 'load_assign': {
        const before = pre.load; const after = findLoad(paths, id);
        if (!before || !after) return null;
        const oz = diffLoads(before, after);
        if (!oz.length) return null; // hech narsa o'zgarmagan
        const onlyHolat = oz.length === 1 && oz[0].m === 'Holat';
        const tur = name === 'load_assign' ? (onlyHolat ? 'holat' : 'tayinlash') : 'yuk_tahrir';
        const matn = onlyHolat ? `Holatni o'zgartirdi: «${after.nomi}» — ${oz[0].oldin} → ${oz[0].keyin}` : `Zakazni ${name === 'load_assign' ? 'biriktirdi / yangiladi' : 'tahrirladi'}: «${after.nomi}»`;
        return { tur, matn, yuk: yukOf(after), oz };
      }
      case 'load_move': {
        const before = pre.load; const after = findLoad(paths, id);
        if (!before || !after || before.tartib === after.tartib) return null;
        return { tur: 'tartib', matn: `Tartib raqamini o'zgartirdi: «${after.nomi}» — ${before.tartib} → ${after.tartib}`, yuk: yukOf(after), oz: [{ m: 'Tartib raqami', oldin: show(before.tartib), keyin: show(after.tartib) }] };
      }
      case 'load_pay': {
        const before = pre.load; const after = findLoad(paths, id);
        if (!before || !after) return null;
        const last = (after.tolovlar || [])[(after.tolovlar || []).length - 1] || {};
        const oz = [{ m: "To'langan jami (so'm)", oldin: money(paidTotal(before)), keyin: money(paidTotal(after)) }, { m: 'Astatka (so\'m)', oldin: money(after.astatka), keyin: money(after.astatka) }];
        if (!before.tolandi && after.tolandi) oz.push({ m: 'Pul holati', oldin: "to'liq olinmagan", keyin: "to'liq olindi" });
        return { tur: 'pul', matn: `PUL OLDI: ${money(last.summa)} so'm — «${after.nomi}»${after.tolandi ? " (to'liq to'landi)" : ''}`, yuk: yukOf(after), oz };
      }
      case 'load_unpay': {
        const before = pre.load; const after = findLoad(paths, id);
        if (!before) return null;
        const list = (before.tolovlar || []).map((t) => `${t.sana}: ${money(t.summa)} so'm (${t.kim || '—'})`).join('; ') || "to'lov yozuvi yo'q edi";
        return { tur: 'pul_bekor', xavf: true, matn: `PUL YOZUVLARINI BEKOR QILDI: «${before.nomi}» — ${money(paidTotal(before))} so'm o'chirildi`, yuk: yukOf(after || before), oz: [{ m: "Olingan to'lovlar", oldin: cut(list, 300), keyin: "o'chirildi" }, { m: "To'langan jami (so'm)", oldin: money(paidTotal(before)), keyin: '0' }] };
      }
      case 'load_del': {
        const l = pre.load; if (!l) return null;
        const oz = snapshotRows(l, "(o'chirildi)");
        if (paidTotal(l)) oz.push({ m: "Olingan to'lovlar (so'm)", oldin: money(paidTotal(l)), keyin: "(o'chirildi)" });
        return { tur: 'yuk_ochirdi', xavf: true, matn: `ZAKAZNI O'CHIRDI: «${l.nomi}» (${l.sana})${paidTotal(l) ? ` — shundan ${money(paidTotal(l))} so'm to'langan edi` : ''}`, yuk: yukOf(l), oz };
      }
      // ---- Jamoa ----
      case 'staff_new': case 'sel_new': {
        const isStaff = name === 'staff_new'; const r = resBody || {};
        return { tur: 'jamoa', matn: `${isStaff ? 'Xodim' : 'Sotuvchi'} qo'shdi: ${r.name} (login: ${r.login})`, oz: [{ m: 'Ruxsatlar', oldin: '—', keyin: permText(r.perms) }] };
      }
      case 'staff_edit': case 'sel_edit': {
        const after = userShape(userById(id)); const oz = diffObj(pre.user, after, USER_LABELS);
        if (b.password) oz.push({ m: 'Parol', oldin: '—', keyin: "o'zgartirildi" });
        if (!oz.length) return null;
        return { tur: 'jamoa', xavf: !!(pre.user && after && pre.user.faol !== after.faol), matn: `${name === 'staff_edit' ? 'Xodim' : 'Sotuvchi'} ma'lumotini o'zgartirdi: ${(after && after.name) || (pre.user && pre.user.name) || ''}`, oz };
      }
      case 'staff_del': case 'sel_del':
        return { tur: 'jamoa', xavf: true, matn: `${name === 'staff_del' ? 'Xodimni' : 'Sotuvchini'} O'CHIRDI: ${(pre.user && pre.user.name) || ''} (login: ${(pre.user && pre.user.login) || ''})` };
      case 'zb_new': return { tur: 'jamoa', matn: `Zborshik qo'shdi: ${cut(b.ism, 80)}${b.login ? ` (login-parol bilan: ${cut(b.login, 40)})` : ''}` };
      case 'lb_new': return { tur: 'jamoa', matn: `Labo (mashina) qo'shdi: ${cut(b.raqami, 40)}${b.haydovchi ? `, haydovchi ${cut(b.haydovchi, 60)}` : ''}${b.login ? ` (login-parol bilan: ${cut(b.login, 40)})` : ''}` };
      case 'fl_new': return { tur: 'jamoa', matn: `Filial qo'shdi: ${cut(b.nomi, 80)}` };
      case 'cat_new': return { tur: 'jamoa', matn: `Kategoriya qo'shdi: ${cut(b.name, 80)}` };
      case 'zb_login': case 'lb_login': {
        const acc = name === 'zb_login' ? zbAcc(id) : lbAcc(id);
        const oz = diffObj(pre.user, userShape(acc), USER_LABELS);
        if (b.password) oz.push({ m: 'Parol', oldin: '—', keyin: pre.user ? "o'zgartirildi" : "o'rnatildi" });
        return { tur: 'jamoa', xavf: !!(pre.user && acc && pre.user.faol !== userShape(acc).faol), matn: `${name === 'zb_login' ? 'Zborshik' : 'Labo'} «${pre.nom || ''}» uchun login-parol ${pre.user ? "o'zgartirildi" : 'yaratildi'}`, oz };
      }
      case 'zb_login_del': case 'lb_login_del':
        return { tur: 'jamoa', xavf: true, matn: `${name === 'zb_login_del' ? 'Zborshik' : 'Labo'} «${pre.nom || ''}» kirishini (login-parolini) O'CHIRDI` };
      case 'zb_del': return { tur: 'jamoa', xavf: true, matn: `Zborshikni O'CHIRDI: ${pre.nom || ''}` };
      case 'lb_del': return { tur: 'jamoa', xavf: true, matn: `Labo (mashina)ni O'CHIRDI: ${pre.nom || ''}` };
      case 'fl_del': return { tur: 'jamoa', xavf: true, matn: `Filialni O'CHIRDI: ${pre.nom || ''}` };
      case 'codes': {
        const names = { actionCode: 'Amal kodi', deleteCode: "O'chirish kodi", payCode: 'Pul kodi' };
        const parts = Object.keys(names).filter((k) => b[k] !== undefined && b[k] !== null).map((k) => `${names[k]} ${String(b[k]).trim() ? "o'zgartirildi / o'rnatildi" : "O'CHIRILDI"}`);
        if (!parts.length) return null;
        return { tur: 'kod', xavf: true, matn: `Kodlarni o'zgartirdi: ${parts.join(', ')}` };
      }
      // ---- Sklad ----
      case 'sk_cat_new': return { tur: 'sklad', matn: `Sklad kategoriyasi qo'shdi: ${cut((resBody && resBody.nomi) || b.nomi, 80)}` };
      case 'sk_cat_edit': return { tur: 'sklad', matn: `Sklad kategoriyasini o'zgartirdi: ${(pre.cat && pre.cat.nomi) || ''} → ${cut((resBody && resBody.nomi) || b.nomi || '', 80)}` };
      case 'sk_cat_del': return { tur: 'sklad', xavf: true, matn: `Sklad kategoriyasini O'CHIRDI: ${(pre.cat && pre.cat.nomi) || ''} (ichidagi ${pre.modelSoni || 0} ta model bilan)` };
      case 'sk_mod_new': { const r = resBody || {}; return { tur: 'sklad', matn: `Sklad modeli qo'shdi: ${r.nomi} (boshlang'ich qoldiq: ${r.qoldiq ?? 0})` }; }
      case 'sk_mod_edit': {
        const a = clone(sklad.read(paths).models.find((x) => x.id === id));
        const oz = diffObj(pre.model, a, { nomi: 'Nomi', categoryId: 'Kategoriya (ID)', min: 'Minimal qoldiq' });
        return { tur: 'sklad', matn: `Sklad modelini o'zgartirdi: ${(pre.model && pre.model.nomi) || ''}`, oz };
      }
      case 'sk_mod_del': return { tur: 'sklad', xavf: true, matn: `Sklad modelini O'CHIRDI: ${(pre.model && pre.model.nomi) || ''} (qoldiq ${pre.model ? pre.model.qoldiq : '—'} edi)` };
      case 'sk_kirim': {
        const a = sklad.read(paths).models.find((x) => x.id === id);
        return { tur: 'sklad', matn: `Skladga kirim: ${(a && a.nomi) || (pre.model && pre.model.nomi) || ''} +${cut(b.soni ?? b.miqdor, 10)}`, oz: [{ m: 'Qoldiq', oldin: show(pre.model && pre.model.qoldiq), keyin: show(a && a.qoldiq) }] };
      }
      case 'sk_qoldiq': {
        const a = sklad.read(paths).models.find((x) => x.id === id);
        const was = Number(pre.model && pre.model.qoldiq); const now = Number(a && a.qoldiq);
        return { tur: 'sklad', xavf: Number.isFinite(was) && Number.isFinite(now) && now < was, matn: `Sklad qoldig'ini qo'lda to'g'riladi: ${(a && a.nomi) || ''} — ${show(was)} → ${show(now)}`, oz: [{ m: 'Qoldiq', oldin: show(was), keyin: show(now) }] };
      }
      case 'sk_img': return { tur: 'sklad', matn: `Model suratini yukladi: ${(pre.model && pre.model.nomi) || ''}` };
      case 'sk_img_del': return { tur: 'sklad', matn: `Model suratini o'chirdi: ${(pre.model && pre.model.nomi) || ''}` };
      default: return null;
    }
  }

  // ---------- Express middleware: /api ostida ishlaydi ----------
  function middleware(req, res, next) {
    const method = req.method;
    // Express /api ostida req.path'ni qisqartiradi, shuning uchun to'liq yo'lni originalUrl'dan olamiz
    const fullPath = String(req.originalUrl || '').split('?')[0];
    const sub = fullPath.replace(/^\/api/, '');
    let preCtx = null; let routeName = null; let routeId = null;
    const u = (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') ? getUser(req) : null;
    if (u) {
      const ownerId = u.role === 'owner' ? u.id : u.ownerId;
      const hit = ROUTES.find(([m, re]) => m === method && re.test(fullPath));
      if (hit) {
        routeName = hit[2]; routeId = (fullPath.match(hit[1]) || [])[1];
        try { preCtx = snapshotBefore(routeName, routeId, store.ownerPaths(ownerId)); } catch (e) { preCtx = {}; }
      }
    }
    // Javob matnini ushlab qolamiz
    const origJson = res.json.bind(res);
    res.json = (body) => { res.locals._body = body; return origJson(body); };

    res.on('finish', () => {
      try {
        const au = req.user; // requireAuth o'rnatgan bo'lsa
        if (!au || !req.ownerId) return;
        const paths = req.paths;
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (preCtx && routeName) {
          if (ok) {
            const entry = build(routeName, routeId, { req, paths, pre: preCtx, resBody: res.locals._body });
            if (entry) log(req, entry);
          } else if (res.statusCode === 403 && req.headers['x-action-code'] && res.locals._body && res.locals._body.codeRequired) {
            log(req, { tur: 'xavf', xavf: true, matn: `NOTO'G'RI KOD bilan urindi (${req.method} ${sub.replace(/^\//, '')})` });
          }
          return;
        }
        if (method !== 'GET' || !ok) return;
        // ---- Faqat o'qish so'rovlari: faollik va surat ko'rish ----
        if (sub === '/loads' && au.role !== 'owner') touch(req, 'Zakazlar jadvalini ochdi / ishlayapti', 15);
        else if (sub === '/loads') touch(req, 'Zakazlar jadvalini ochdi', 30);
        else if (sub === '/my-loads') {
          const n = Array.isArray(res.locals._body) ? res.locals._body.length : 0;
          touch(req, `Zakazlar ro'yxatini ko'rdi (${n} ta zakaz)`, 10);
        } else if (sub === '/sotuvchi/orders') touch(req, "O'z zakazlari sahifasini ochdi", 15);
        else if (/^\/sklad\/models\/[^/]+\/rasm$/.test(sub) && au.role !== 'owner') {
          const mid = sub.split('/')[3];
          const nom = modelName(paths, mid) || mid;
          once(req, `rasm|${mid}`, 60000, { tur: 'surat', matn: `Mahsulot suratini ko'rdi: ${nom}` });
        } else if (sub === '/export/excel') log(req, { tur: 'eksport', matn: 'Excel faylni yuklab oldi' });
      } catch (e) { console.error('Kuzatuv middleware xatosi:', e.message); }
    });
    next();
  }

  // ---------- O'qish ----------
  function readAll(ownerId) {
    const p = store.ownerPaths(ownerId).audit;
    if (!fs.existsSync(p)) return [];
    const out = [];
    fs.readFileSync(p, 'utf-8').split('\n').forEach((ln) => { if (!ln) return; try { out.push(JSON.parse(ln)); } catch { /* buzilgan qator */ } });
    return out;
  }
  const GROUPS = {
    kirish: ['kirish', 'kirish_xato', 'chiqish', 'faollik'],
    zakaz: ['yuk_qoshdi', 'yuk_tahrir', 'yuk_ochirdi', 'holat', 'tayinlash', 'tartib', 'sotuvchi_zakaz', 'sotuvchi_tahrir', 'sotuvchi_bekor', 'tasdiq', 'rad'],
    pul: ['pul', 'pul_bekor'],
    sklad: ['sklad', 'surat'],
    jamoa: ['jamoa', 'kod', 'xavf', 'eksport'],
  };
  function events(ownerId, f) {
    const all = readAll(ownerId);
    const from = f.from ? new Date(`${f.from}T00:00:00+05:00`).getTime() : 0;
    const to = f.to ? new Date(`${f.to}T23:59:59.999+05:00`).getTime() : Infinity;
    const before = f.before || '';
    const q = String(f.q || '').trim().toLowerCase();
    const types = f.tur && GROUPS[f.tur] ? GROUPS[f.tur] : null;
    const out = [];
    const limit = Math.min(Math.max(parseInt(f.limit, 10) || 100, 1), 300);
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const e = all[i];
      if (before && !(e.t < before)) continue;
      const ts = Date.parse(e.t);
      if (ts < from || ts > to) continue;
      if (f.user && (!e.kim || e.kim.id !== f.user)) continue;
      if (types && !types.includes(e.tur)) continue;
      if (f.xavf === '1' && !e.xavf) continue;
      if (q) {
        const hay = `${e.matn} ${e.kim && e.kim.ism} ${e.yuk && e.yuk.nomi} ${(e.oz || []).map((o) => `${o.m} ${o.oldin} ${o.keyin}`).join(' ')} ${e.q && e.q.ip}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push(e);
    }
    return { events: out, hasMore: out.length === limit };
  }
  function people(ownerId) {
    const all = readAll(ownerId);
    const per = new Map();
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
    const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(iso));
    const weekAgo = Date.now() - 7 * 86400000; const monthAgo = Date.now() - 30 * 86400000;
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i]; if (!e.kim) continue;
      let r = per.get(e.kim.id);
      if (!r) { r = { oxirgiKirish: null, oxirgiFaollik: null, qurilma: null, bugun: 0, jami: 0, xato7: 0, xavfli30: 0, devices: new Map() }; per.set(e.kim.id, r); }
      r.jami++;
      if (!r.oxirgiFaollik) { r.oxirgiFaollik = e.t; r.qurilma = e.q; }
      if (e.tur === 'kirish' && !r.oxirgiKirish) r.oxirgiKirish = e.t;
      const ts = Date.parse(e.t);
      if (e.tur !== 'faollik' && e.tur !== 'kirish' && e.tur !== 'chiqish' && e.tur !== 'kirish_xato' && dayOf(e.t) === todayKey) r.bugun++;
      if (e.tur === 'kirish_xato' && ts > weekAgo) r.xato7++;
      if (e.xavf && ts > monthAgo) r.xavfli30++;
      if (e.q && ts > monthAgo) {
        const key = [e.q.tur, e.q.os, e.q.model, e.q.brauzer, e.q.ip].join('|');
        const d = r.devices.get(key) || { ...e.q, oxirgi: e.t, soni: 0 };
        d.soni++; if (e.t > d.oxirgi) d.oxirgi = e.t; r.devices.set(key, d);
      }
    }
    const list = store.users().filter((u) => u.id === ownerId || u.ownerId === ownerId);
    return list.map((u) => {
      const r = per.get(u.id) || { oxirgiKirish: null, oxirgiFaollik: null, qurilma: null, bugun: 0, jami: 0, xato7: 0, xavfli30: 0, devices: new Map() };
      return {
        id: u.id, ism: u.name, rol: u.role, rolNomi: ROLE[u.role] || u.role, login: u.login || null, faol: u.active !== false,
        oxirgiKirish: r.oxirgiKirish, oxirgiFaollik: r.oxirgiFaollik, qurilma: r.qurilma, bugun: r.bugun, jami: r.jami,
        xatoUrinish7kun: r.xato7, xavfli30kun: r.xavfli30,
        qurilmalar: [...r.devices.values()].sort((a, b) => String(b.oxirgi).localeCompare(String(a.oxirgi))).slice(0, 6),
      };
    }).sort((a, b) => (a.rol === 'owner' ? -1 : 0) - (b.rol === 'owner' ? -1 : 0) || String(b.oxirgiFaollik || '').localeCompare(String(a.oxirgiFaollik || '')));
  }

  return { log, touch, middleware, events, people, deviceOf, ROLE };
}

module.exports = { createAudit };
