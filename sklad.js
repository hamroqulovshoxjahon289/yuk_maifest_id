// Sklad: 3 yo'nalish (matras, mebel, zapchast) -> kategoriya -> model (qoldiq soni bilan).
// Yuk "Yuborildi" bo'lganda tanlangan modellar skladdan avtomatik ayiriladi.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const YONALISHLAR = ['matras', 'mebel', 'zapchast'];
const YONALISH_NOMI = { matras: 'Matras', mebel: 'Mebel', zapchast: 'Zapchast' };
const MAX_QTY = 1000000;
const MAX_HARAKAT = 5000;
const MAX_IMG = 4 * 1024 * 1024;
const IMG_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Faylning haqiqiy turini boshidagi baytlardan aniqlaymiz (nomiga ishonmaymiz)
function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function fail(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) Object.assign(e, extra);
  return e;
}
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 80);
const toQty = (v) => Math.floor(Number(v));

function createSklad(store) {
  function read(p) {
    const s = store.readJson(p.sklad, null) || {};
    return {
      categories: Array.isArray(s.categories) ? s.categories : [],
      models: Array.isArray(s.models) ? s.models : [],
      harakat: Array.isArray(s.harakat) ? s.harakat : [],
    };
  }
  function write(p, s) {
    if (s.harakat.length > MAX_HARAKAT) s.harakat = s.harakat.slice(-MAX_HARAKAT);
    store.writeJson(p.sklad, s);
  }

  const imgPath = (p, m) => (m.rasm && IMG_MIME[m.rasm.ext] ? path.join(p.skladImg, `${m.id}.${m.rasm.ext}`) : null);
  function removeImage(p, m) {
    Object.keys(IMG_MIME).forEach((ext) => {
      try { fs.unlinkSync(path.join(p.skladImg, `${m.id}.${ext}`)); } catch { /* yo'q bo'lsa — mayli */ }
    });
    m.rasm = null;
  }
  // Zborshik sahifasi uchun: mahsulot qatoriga "suratim bor" belgisini qo'shadi (surat o'zi emas)
  function withPhotoFlags(p, loads) {
    const s = read(p);
    return loads.map((l) => ({
      ...l,
      skladItems: (l.skladItems || []).map((i) => {
        const m = s.models.find((x) => x.id === i.modelId);
        return { ...i, rasmV: m && m.rasm ? m.rasm.v : null };
      }),
    }));
  }

  // Yukka kelgan qatorlarni tekshirib, nomlarini nusxa (snapshot) qilib qaytaradi.
  function normalizeItems(p, input) {
    const s = read(p);
    const merged = new Map();
    (Array.isArray(input) ? input : []).forEach((it) => {
      const m = s.models.find((x) => x.id === (it && it.modelId));
      if (!m) throw fail(400, 'Sklad modeli topilmadi (o\'chirilgan bo\'lishi mumkin). Qaytadan tanlang.');
      const soni = toQty(it.soni);
      if (!(soni > 0) || soni > MAX_QTY) throw fail(400, `"${m.nomi}" sonini to'g'ri kiriting (1 dan boshlab)`);
      merged.set(m.id, { m, soni: (merged.has(m.id) ? merged.get(m.id).soni : 0) + soni });
    });
    return [...merged.values()].map(({ m, soni }) => {
      const c = s.categories.find((x) => x.id === m.categoryId);
      return { modelId: m.id, yonalish: c ? c.yonalish : 'mebel', kategoriya: c ? c.nomi : '', model: m.nomi, soni };
    });
  }

  // Nom yozilmagan bo'lsa, tanlangan modellardan avtomatik nom
  function autoNomi(items) {
    const t = (items || []).map((i) => i.model).join(', ');
    return t.length > 80 ? `${t.slice(0, 77)}...` : t;
  }

  function sameItems(a, b) {
    const k = (arr) => (arr || []).map((x) => `${x.modelId}:${x.soni}`).sort().join('|');
    return k(a) === k(b);
  }

  function logger(s, load, ctx) {
    return (item, delta, tur) => s.harakat.push({
      id: crypto.randomUUID(), sana: ctx.today, vaqt: new Date().toISOString(),
      modelId: item.modelId, yonalish: item.yonalish, kategoriya: item.kategoriya, model: item.model,
      delta, tur, loadId: load.id, loadNomi: load.nomi || '', kim: ctx.kim || '',
    });
  }

  // Avval ayirilgan bo'lsa, qaytarib qo'yadi. O'zgargan bo'lsa true.
  function giveBack(s, load, log) {
    if (!load.skladCut) return false;
    (load.skladCutItems || []).forEach((it) => {
      const m = s.models.find((x) => x.id === it.modelId);
      if (m) { m.qoldiq = (Number(m.qoldiq) || 0) + it.soni; log(it, +it.soni, 'qaytarish'); }
    });
    load.skladCut = false;
    load.skladCutItems = [];
    return true;
  }

  // Yuk holatiga qarab skladni moslaydi:
  //  - holat "yashil" (Yuborildi) bo'lsa va hali ayirilmagan bo'lsa -> ayiradi
  //  - Yuborildidan qaytarilsa yoki qatorlar o'zgarsa -> avval ayirilganini qaytaradi
  // Yetarli bo'lmasa va force yo'q bo'lsa 409 xato (hech narsa o'zgarmaydi).
  function syncLoadStock(p, load, ctx) {
    const s = read(p);
    const log = logger(s, load, ctx);
    const items = load.skladItems || [];
    const shouldCut = load.holat === 'yashil' && items.length > 0;
    let changed = false;

    if (load.skladCut && (!shouldCut || !sameItems(load.skladCutItems, items))) {
      changed = giveBack(s, load, log) || changed;
    }
    if (shouldCut && !load.skladCut) {
      const kamlar = [];
      items.forEach((it) => {
        const m = s.models.find((x) => x.id === it.modelId);
        const bor = m ? (Number(m.qoldiq) || 0) : 0;
        if (bor < it.soni) kamlar.push({ yonalish: it.yonalish, kategoriya: it.kategoriya, model: it.model, bor, kerak: it.soni });
      });
      if (kamlar.length && !ctx.force) {
        const txt = kamlar.map((k) => `${k.model} (bor ${k.bor}, kerak ${k.kerak})`).join('; ');
        throw fail(409, `Skladda yetarli emas: ${txt}`, { kamlar });
      }
      items.forEach((it) => {
        const m = s.models.find((x) => x.id === it.modelId);
        if (m) { m.qoldiq = (Number(m.qoldiq) || 0) - it.soni; log(it, -it.soni, 'chiqim'); }
      });
      load.skladCut = true;
      load.skladCutItems = items.map((x) => ({ ...x }));
      changed = true;
    }
    if (changed) write(p, s);
    return changed;
  }

  // Yuk o'chirilganda ayirilgan mahsulotlar skladga qaytadi
  function releaseLoadStock(p, load, ctx) {
    if (!load.skladCut) return false;
    const s = read(p);
    const changed = giveBack(s, load, logger(s, load, ctx));
    if (changed) write(p, s);
    return changed;
  }

  // Kunlar bo'yicha hisobot: har bir yo'nalish va model kesimida
  function buildReport(p, loads, from, to) {
    const s = read(p);
    const stock = new Map(s.models.map((m) => [m.id, Number(m.qoldiq) || 0]));
    const days = new Map();
    const dayOf = (sana) => {
      if (!days.has(sana)) {
        const y = {};
        YONALISHLAR.forEach((k) => { y[k] = { jami: 0, ketdi: 0, qoldi: 0, map: new Map() }; });
        days.set(sana, y);
      }
      return days.get(sana);
    };
    loads.forEach((l) => {
      if (!l.sana || l.sana < from || l.sana > to) return;
      const sent = l.holat === 'yashil';
      (l.skladItems || []).forEach((it) => {
        const y = dayOf(l.sana)[YONALISHLAR.includes(it.yonalish) ? it.yonalish : 'mebel'];
        const key = it.modelId;
        if (!y.map.has(key)) y.map.set(key, { modelId: it.modelId, kategoriya: it.kategoriya, model: it.model, jami: 0, ketdi: 0, qoldi: 0, skladda: stock.has(key) ? stock.get(key) : null });
        const row = y.map.get(key);
        row.jami += it.soni; y.jami += it.soni;
        if (sent) { row.ketdi += it.soni; y.ketdi += it.soni; } else { row.qoldi += it.soni; y.qoldi += it.soni; }
      });
    });
    const out = [];
    for (const [sana, y] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const yonalishlar = {};
      YONALISHLAR.forEach((k) => {
        yonalishlar[k] = {
          jami: y[k].jami, ketdi: y[k].ketdi, qoldi: y[k].qoldi,
          modellar: [...y[k].map.values()].sort((a, b) => (a.kategoriya || '').localeCompare(b.kategoriya || '') || a.model.localeCompare(b.model)),
        };
      });
      out.push({ sana, yonalishlar });
    }
    return { from, to, days: out };
  }

  // Bir xil nom takrorlanmasligi kerak bo'lgan modellar guruhi (matrasda — hamma matras modellari)
  function sameGroup(s, c) {
    if (c.yonalish === 'matras') {
      const ids = new Set(s.categories.filter((k) => k.yonalish === 'matras').map((k) => k.id));
      return s.models.filter((m) => ids.has(m.categoryId));
    }
    return s.models.filter((m) => m.categoryId === c.id);
  }

  function mount(app, d) {
    const { requireAuth, staffOnly, can, deleteCode, readLoads, todayStr, express } = d;
    const manage = can('team'); // kategoriya/model/kirim: egasi yoki "Jamoani boshqarish" ruxsati bor xodim

    app.get('/api/sklad', requireAuth, staffOnly, (req, res) => {
      const s = read(req.paths);
      res.json({ yonalishlar: YONALISHLAR.map((k) => ({ id: k, nomi: YONALISH_NOMI[k] })), categories: s.categories, models: s.models });
    });

    app.get('/api/sklad/harakat', requireAuth, staffOnly, (req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 300);
      const s = read(req.paths);
      res.json(s.harakat.slice(-limit).reverse());
    });

    app.post('/api/sklad/categories', requireAuth, staffOnly, manage, (req, res) => {
      const yonalish = String(req.body.yonalish || '');
      const nomi = cleanName(req.body.nomi);
      if (!YONALISHLAR.includes(yonalish)) return res.status(400).json({ error: "Yo'nalishni tanlang" });
      if (yonalish === 'matras') return res.status(400).json({ error: "Matras yo'nalishida kategoriya kerak emas — to'g'ridan-to'g'ri model qo'shing" });
      if (!nomi) return res.status(400).json({ error: 'Kategoriya nomini kiriting' });
      const s = read(req.paths);
      if (s.categories.some((c) => c.yonalish === yonalish && c.nomi.toLowerCase() === nomi.toLowerCase())) {
        return res.status(400).json({ error: 'Bu kategoriya allaqachon mavjud' });
      }
      const c = { id: crypto.randomUUID(), yonalish, nomi };
      s.categories.push(c);
      write(req.paths, s);
      res.json(c);
    });

    app.put('/api/sklad/categories/:id', requireAuth, staffOnly, manage, (req, res) => {
      const nomi = cleanName(req.body.nomi);
      if (!nomi) return res.status(400).json({ error: 'Kategoriya nomini kiriting' });
      const s = read(req.paths);
      const c = s.categories.find((x) => x.id === req.params.id);
      if (!c) return res.status(404).json({ error: 'Kategoriya topilmadi' });
      if (s.categories.some((x) => x.id !== c.id && x.yonalish === c.yonalish && x.nomi.toLowerCase() === nomi.toLowerCase())) {
        return res.status(400).json({ error: 'Bu kategoriya allaqachon mavjud' });
      }
      c.nomi = nomi;
      write(req.paths, s);
      res.json(c);
    });

    app.delete('/api/sklad/categories/:id', requireAuth, staffOnly, manage, deleteCode, (req, res) => {
      const s = read(req.paths);
      const i = s.categories.findIndex((x) => x.id === req.params.id);
      if (i === -1) return res.status(404).json({ error: 'Kategoriya topilmadi' });
      s.categories.splice(i, 1);
      s.models.filter((m) => m.categoryId === req.params.id).forEach((m) => removeImage(req.paths, m));
      s.models = s.models.filter((m) => m.categoryId !== req.params.id); // ichidagi modellar ham o'chadi
      write(req.paths, s);
      res.json({ ok: true });
    });

    app.post('/api/sklad/models', requireAuth, staffOnly, manage, (req, res) => {
      const nomi = cleanName(req.body.nomi);
      if (!nomi) return res.status(400).json({ error: 'Model nomini kiriting' });
      const s = read(req.paths);
      let c;
      if (req.body.yonalish === 'matras' && !req.body.categoryId) {
        // Matrasda kategoriya yo'q: ichki (ko'rinmaydigan) umumiy guruhga qo'shiladi
        c = s.categories.find((x) => x.yonalish === 'matras' && x.yashirin);
        if (!c) { c = { id: crypto.randomUUID(), yonalish: 'matras', nomi: 'Matras', yashirin: true }; s.categories.push(c); }
      } else {
        c = s.categories.find((x) => x.id === req.body.categoryId);
      }
      if (!c) return res.status(400).json({ error: 'Kategoriya topilmadi' });
      if (sameGroup(s, c).some((m) => m.nomi.toLowerCase() === nomi.toLowerCase())) {
        return res.status(400).json({ error: c.yonalish === 'matras' ? 'Bunday matras modeli allaqachon bor' : 'Bu model shu kategoriyada allaqachon bor' });
      }
      let qoldiq = 0;
      if (req.body.qoldiq !== undefined && req.body.qoldiq !== '') {
        qoldiq = toQty(req.body.qoldiq);
        if (!(qoldiq >= 0) || qoldiq > MAX_QTY) return res.status(400).json({ error: "Boshlang'ich qoldiq noto'g'ri" });
      }
      const m = { id: crypto.randomUUID(), categoryId: c.id, nomi, qoldiq, createdAt: new Date().toISOString() };
      s.models.push(m);
      if (qoldiq > 0) {
        s.harakat.push({ id: crypto.randomUUID(), sana: todayStr(), vaqt: new Date().toISOString(), modelId: m.id, yonalish: c.yonalish, kategoriya: c.nomi, model: m.nomi, delta: qoldiq, tur: 'kirim', loadId: null, loadNomi: '', kim: req.user.name });
      }
      write(req.paths, s);
      res.json(m);
    });

    app.put('/api/sklad/models/:id', requireAuth, staffOnly, manage, (req, res) => {
      const nomi = cleanName(req.body.nomi);
      if (!nomi) return res.status(400).json({ error: 'Model nomini kiriting' });
      const s = read(req.paths);
      const m = s.models.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Model topilmadi' });
      const mc = s.categories.find((k) => k.id === m.categoryId) || { id: m.categoryId, yonalish: '' };
      if (sameGroup(s, mc).some((x) => x.id !== m.id && x.nomi.toLowerCase() === nomi.toLowerCase())) {
        return res.status(400).json({ error: 'Bu nomli model allaqachon bor' });
      }
      m.nomi = nomi;
      write(req.paths, s);
      res.json(m);
    });

    app.delete('/api/sklad/models/:id', requireAuth, staffOnly, manage, deleteCode, (req, res) => {
      const s = read(req.paths);
      const i = s.models.findIndex((x) => x.id === req.params.id);
      if (i === -1) return res.status(404).json({ error: 'Model topilmadi' });
      removeImage(req.paths, s.models[i]);
      s.models.splice(i, 1);
      write(req.paths, s);
      res.json({ ok: true });
    });

    // Kirim: skladga mahsulot keldi (qoldiq oshadi)
    app.post('/api/sklad/models/:id/kirim', requireAuth, staffOnly, manage, (req, res) => {
      const soni = toQty(req.body.soni);
      if (!(soni > 0) || soni > MAX_QTY) return res.status(400).json({ error: "Sonni to'g'ri kiriting (1 dan boshlab)" });
      const s = read(req.paths);
      const m = s.models.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Model topilmadi' });
      const c = s.categories.find((x) => x.id === m.categoryId) || {};
      m.qoldiq = (Number(m.qoldiq) || 0) + soni;
      s.harakat.push({ id: crypto.randomUUID(), sana: todayStr(), vaqt: new Date().toISOString(), modelId: m.id, yonalish: c.yonalish || 'mebel', kategoriya: c.nomi || '', model: m.nomi, delta: soni, tur: 'kirim', loadId: null, loadNomi: '', kim: req.user.name });
      write(req.paths, s);
      res.json(m);
    });

    // Tuzatish: sanab chiqqandan keyin aniq qoldiqni qo'yish
    app.put('/api/sklad/models/:id/qoldiq', requireAuth, staffOnly, manage, (req, res) => {
      const yangi = toQty(req.body.qoldiq);
      if (!(yangi >= 0) || yangi > MAX_QTY) return res.status(400).json({ error: "Qoldiqni to'g'ri kiriting (0 yoki undan katta)" });
      const s = read(req.paths);
      const m = s.models.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Model topilmadi' });
      const c = s.categories.find((x) => x.id === m.categoryId) || {};
      const delta = yangi - (Number(m.qoldiq) || 0);
      m.qoldiq = yangi;
      if (delta !== 0) {
        s.harakat.push({ id: crypto.randomUUID(), sana: todayStr(), vaqt: new Date().toISOString(), modelId: m.id, yonalish: c.yonalish || 'mebel', kategoriya: c.nomi || '', model: m.nomi, delta, tur: 'tuzatish', loadId: null, loadNomi: '', kim: req.user.name });
      }
      write(req.paths, s);
      res.json(m);
    });

    // ---- Model surati: faqat Mebel yo'nalishi, ixtiyoriy. Ko'ruvchilar: egasi/xodim va shu modelli yuk biriktirilgan zborshik.
    app.put('/api/sklad/models/:id/rasm', requireAuth, staffOnly, manage, express.raw({ type: 'image/*', limit: MAX_IMG }), (req, res) => {
      const s = read(req.paths);
      const m = s.models.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Model topilmadi' });
      const c = s.categories.find((x) => x.id === m.categoryId);
      if (!c || c.yonalish !== 'mebel') return res.status(400).json({ error: "Surat faqat Mebel yo'nalishidagi modellarga qo'yiladi" });
      const ext = sniffImage(req.body);
      if (!ext) return res.status(400).json({ error: "Surat tanlanmadi yoki format noto'g'ri (JPG, PNG yoki WebP bo'lsin)" });
      fs.mkdirSync(req.paths.skladImg, { recursive: true });
      removeImage(req.paths, m);
      const file = path.join(req.paths.skladImg, `${m.id}.${ext}`);
      fs.writeFileSync(`${file}.tmp`, req.body);
      fs.renameSync(`${file}.tmp`, file);
      m.rasm = { ext, v: Date.now() };
      write(req.paths, s);
      res.json(m);
    });
    // Surat juda katta bo'lsa — tushunarli xabar
    app.use('/api/sklad/models/:id/rasm', (err, req, res, next) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'Surat juda katta (4 MB gacha)' });
      return next(err);
    });

    app.delete('/api/sklad/models/:id/rasm', requireAuth, staffOnly, manage, (req, res) => {
      const s = read(req.paths);
      const m = s.models.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Model topilmadi' });
      removeImage(req.paths, m);
      write(req.paths, s);
      res.json(m);
    });

    app.get('/api/sklad/models/:id/rasm', requireAuth, (req, res) => {
      const role = req.user.role;
      let allowed = role === 'owner' || role === 'ishchi';
      if (!allowed && role === 'zborshik') {
        allowed = readLoads(req.paths).some((l) => l.zborshik && l.zborshik.id === req.user.zborshikId
          && (l.skladItems || []).some((i) => i.modelId === req.params.id));
      }
      if (!allowed) return res.status(403).json({ error: "Bu suratni ko'rishga ruxsat yo'q" });
      const m = read(req.paths).models.find((x) => x.id === req.params.id);
      const file = m && imgPath(req.paths, m);
      if (!file || !fs.existsSync(file)) return res.status(404).json({ error: "Surat yo'q" });
      res.set({ 'Content-Type': IMG_MIME[m.rasm.ext], 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      res.sendFile(file);
    });

    app.get('/api/sklad/hisobot', requireAuth, staffOnly, (req, res) => {
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const today = todayStr();
      const shift = (n) => { const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
      const from = iso.test(req.query.from || '') ? req.query.from : shift(-6);
      const to = iso.test(req.query.to || '') ? req.query.to : shift(2);
      if (from > to || (new Date(to) - new Date(from)) / 86400000 > 92) return res.status(400).json({ error: "Sana oralig'i noto'g'ri (ko'pi bilan 92 kun)" });
      res.json({ today, ...buildReport(req.paths, readLoads(req.paths), from, to) });
    });
  }

  return { read, normalizeItems, autoNomi, syncLoadStock, releaseLoadStock, buildReport, withPhotoFlags, mount };
}

module.exports = { createSklad, YONALISHLAR };
