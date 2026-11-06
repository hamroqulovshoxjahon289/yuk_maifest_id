// Bildirishnomalar: egasi (admin) yangi zakaz qo'shganda barcha faol XODIMLARGA (ishchi) boradi.
// Zborshik va labo (shafyor) bildirishnoma olmaydi.
const crypto = require('crypto');

const MAX_KEEP = 200;

function createNotify(store) {
  const read = (p) => {
    const l = store.readJson(p.bildirishnoma, []);
    return Array.isArray(l) ? l : [];
  };
  const write = (p, list) => store.writeJson(p.bildirishnoma, list.slice(-MAX_KEEP));

  const recipients = (ownerId) => store.users()
    .filter((u) => u.role === 'ishchi' && u.ownerId === ownerId && u.active !== false)
    .map((u) => u.id);

  // Yangi zakaz qo'shildi — xodimlarga xabar
  function loadAdded(p, ownerId, load, byName) {
    const kimga = recipients(ownerId);
    if (!kimga.length) return null;
    const items = load.skladItems || [];
    const bits = [`📅 ${load.sana}`];
    if (load.manzil && load.manzil.hudud) bits.push(`📍 ${load.manzil.hudud}`);
    if (items.length) bits.push(`📦 ${items.slice(0, 4).map((i) => `${i.model} ×${i.soni}`).join(', ')}${items.length > 4 ? ` +${items.length - 4}` : ''}`);
    const n = {
      id: crypto.randomUUID(), tur: 'yuk', loadId: load.id, sana: load.sana,
      matn: `Yangi zakaz: ${load.nomi || '—'}`, tafsilot: bits.join(' · '),
      kim: byName || '', vaqt: new Date().toISOString(), kimga, oqigan: [],
    };
    const list = read(p);
    list.push(n);
    write(p, list);
    return n;
  }

  function mount(app, { requireAuth, staffOnly }) {
    app.get('/api/bildirishnoma', requireAuth, staffOnly, (req, res) => {
      if (req.user.role !== 'ishchi') return res.json({ items: [], unread: 0 }); // egasi o'z amalidan xabar olmaydi
      const mine = read(req.paths).filter((n) => (n.kimga || []).includes(req.user.id));
      const items = mine.slice(-30).reverse().map((n) => ({
        id: n.id, tur: n.tur, loadId: n.loadId, sana: n.sana, matn: n.matn, tafsilot: n.tafsilot,
        kim: n.kim, vaqt: n.vaqt, oqilgan: (n.oqigan || []).includes(req.user.id),
      }));
      res.json({ items, unread: mine.filter((n) => !(n.oqigan || []).includes(req.user.id)).length });
    });

    // ids berilmasa — hammasi o'qilgan deb belgilanadi
    app.post('/api/bildirishnoma/oqildi', requireAuth, staffOnly, (req, res) => {
      const ids = Array.isArray(req.body.ids) ? new Set(req.body.ids.map(String)) : null;
      const list = read(req.paths);
      let changed = false;
      list.forEach((n) => {
        if (!(n.kimga || []).includes(req.user.id)) return;
        if (ids && !ids.has(n.id)) return;
        n.oqigan = n.oqigan || [];
        if (!n.oqigan.includes(req.user.id)) { n.oqigan.push(req.user.id); changed = true; }
      });
      if (changed) write(req.paths, list);
      res.json({ ok: true });
    });
  }

  return { loadAdded, mount };
}

module.exports = { createNotify };
