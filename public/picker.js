// Yuk tanlash paneli: Kategoriya → Model → (matras ketsa: qanday matras) → ＋ Zakazga qo'shish (yoki Enter).
// Egasi/xodim sahifasi ham, sotuvchi sahifasi ham shuni ishlatadi.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const natural = (a, b) => String(a.nomi).localeCompare(String(b.nomi), undefined, { numeric: true });
  const MATRAS_ONLY = '__matras'; // "Faqat matras" (mebelsiz) — maxsus kategoriya tugmasi

  window.createPicker = function createPicker(root, opts) {
    const toast = (opts && opts.toast) || (() => {});
    let sklad = { categories: [], models: [] };
    let items = [];           // zakazga qo'shilganlar
    let selCat = null;        // tanlangan kategoriya id (yoki MATRAS_ONLY)
    let selModel = null;      // tanlangan model id
    let st = { qty: 1, useMat: true, matId: '', matQty: '' };

    root.classList.add('pk');
    root.innerHTML = `
      <div class="pk-step"><span class="pk-num">1</span><span>Kategoriya</span></div>
      <div class="pk-chips" data-r="cats"></div>
      <div data-r="s2" class="pk-hide">
        <div class="pk-step"><span class="pk-num">2</span><span>Model</span></div>
        <div class="pk-chips pk-models" data-r="models"></div>
      </div>
      <div data-r="panel" class="pk-panel pk-hide"></div>
      <div class="pk-added-head" data-r="addedHead"></div>
      <div class="pk-added" data-r="added"></div>`;
    const $ = (r) => root.querySelector(`[data-r="${r}"]`);

    // ---------- yordamchilar ----------
    const cats = () => sklad.categories.filter((c) => c.yonalish === 'mebel' && !c.yashirin);
    const matrasModels = () => sklad.models.filter((m) => (sklad.categories.find((c) => c.id === m.categoryId) || {}).yonalish === 'matras').sort(natural);
    const modelById = (id) => sklad.models.find((m) => m.id === id) || null;
    const catOfModel = (m) => (m ? sklad.categories.find((c) => c.id === m.categoryId) : null);
    const allowedMatras = (m) => {
      const all = matrasModels();
      const ids = (m && m.matrasIds) || [];
      const list = ids.length ? all.filter((x) => ids.includes(x.id)) : all;
      return list;
    };
    const stockNote = (m) => {
      const bor = Number(m.qoldiq) || 0;
      return bor > 0 ? `skladda ${bor}` : 'skladda yo\'q';
    };

    // ---------- chizish ----------
    function renderCats() {
      const list = cats();
      const hasMat = matrasModels().length > 0;
      if (!list.length && !hasMat) {
        $('cats').innerHTML = '<div class="pk-empty">Hali kategoriya yo\'q. Egasi «🏬 Sklad» bo\'limida kategoriya va model qo\'shishi kerak.</div>';
        return;
      }
      $('cats').innerHTML = list.map((c) => `<button type="button" class="pk-chip ${selCat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.nomi)}</button>`).join('')
        + (hasMat ? `<button type="button" class="pk-chip pk-chip-mat ${selCat === MATRAS_ONLY ? 'on' : ''}" data-cat="${MATRAS_ONLY}">🛏 Faqat matras</button>` : '');
    }
    function renderModels() {
      if (!selCat) { $('s2').classList.add('pk-hide'); return; }
      const list = selCat === MATRAS_ONLY ? matrasModels() : sklad.models.filter((m) => m.categoryId === selCat).sort(natural);
      $('s2').classList.remove('pk-hide');
      $('models').innerHTML = list.length
        ? list.map((m) => `<button type="button" class="pk-chip pk-model ${selModel === m.id ? 'on' : ''}" data-model="${m.id}">${esc(m.nomi)}${selCat !== MATRAS_ONLY && m.matrasKetadi ? ' <span class="pk-tag">🛏</span>' : ''}${selCat === MATRAS_ONLY ? ` <span class="pk-tag">${esc(stockNote(m))}</span>` : ''}</button>`).join('')
        : `<div class="pk-empty">${selCat === MATRAS_ONLY ? 'Matras modeli yo\'q' : 'Bu kategoriyada model yo\'q'}</div>`;
    }
    function renderPanel() {
      const box = $('panel');
      const m = selModel ? modelById(selModel) : null;
      if (!m) { box.classList.add('pk-hide'); box.innerHTML = ''; return; }
      box.classList.remove('pk-hide');
      box.classList.remove('pk-pop'); void box.offsetWidth; box.classList.add('pk-pop');
      const isMat = selCat === MATRAS_ONLY;
      let html = `<div class="pk-panel-head">${isMat ? '🛏' : '🛋'} <b>${esc(m.nomi)}</b>${isMat ? ` <span class="pk-tag">${esc(stockNote(m))}</span>` : ''}</div>
        <div class="pk-fields"><label>Soni<input type="number" data-r="qty" min="1" step="1" value="${esc(st.qty)}" inputmode="numeric" /></label></div>`;
      if (!isMat) {
        if (m.matrasKetadi) {
          const al = allowedMatras(m);
          if (!al.length) {
            html += '<div class="pk-note warn">Bu modelga matras ketadi, lekin sklad matras ro\'yxati bo\'sh. «🏬 Sklad → 🛏 Matras» bo\'limida matras qo\'shing.</div>';
            st.useMat = false;
          } else {
            if (!al.some((x) => x.id === st.matId)) st.matId = al.length === 1 ? al[0].id : '';
            html += `<label class="pk-switch"><input type="checkbox" data-r="useMat" ${st.useMat ? 'checked' : ''} /><span class="pk-sw"></span><span>🛏 Matras ketadi</span></label>
              <div class="pk-matbox ${st.useMat ? '' : 'pk-hide'}" data-r="matbox">
                <div class="pk-fields two">
                  <label>Qanday matras
                    <select data-r="matSel"><option value="" ${st.matId ? '' : 'selected'} disabled>— matrasni tanlang —</option>${al.map((x) => `<option value="${x.id}" ${st.matId === x.id ? 'selected' : ''}>${esc(x.nomi)} (${esc(stockNote(x))})</option>`).join('')}</select>
                  </label>
                  <label>Matras soni<input type="number" data-r="matQty" min="1" step="1" value="${esc(st.matQty)}" placeholder="${esc(st.qty)}" inputmode="numeric" /></label>
                </div>
              </div>`;
          }
        } else {
          html += '<div class="pk-note ok">✓ Bu modelga matras ketmaydi — zakazga shundayicha qo\'shiladi</div>';
        }
      }
      html += '<button type="button" class="primary-btn pk-add" data-r="add">＋ Zakazga qo\'shish <span class="pk-kbd">Enter</span></button>';
      box.innerHTML = html;
    }
    function lineText(it) {
      const mat = it.matrasId ? `<div class="pk-card-sub">🛏 ${esc(it.matrasNomi || '')} <b>× ${it.matrasSoni}</b></div>`
        : (it.yonalish === 'matras' ? '' : '<div class="pk-card-sub muted">matrassiz</div>');
      const head = it.yonalish === 'matras'
        ? `🛏 <b>${esc(it.model)}</b> <span class="pk-cat">faqat matras</span>`
        : `🛋 <b>${esc(it.model)}</b> <span class="pk-cat">${esc(it.kategoriya || '')}</span>`;
      return `<div class="pk-card-main"><div class="pk-card-title">${head}${it._gone ? ' <span class="sk-warn">(o\'chirilgan)</span>' : ''}</div>${mat}</div>`;
    }
    function renderAdded(newIdx) {
      $('addedHead').innerHTML = items.length ? `<span>🧾 Zakazdagi yuklar</span><b>${items.length}</b>` : '';
      $('added').innerHTML = items.map((it, i) => `<div class="pk-card ${i === newIdx ? 'pk-new' : ''}">${lineText(it)}
        <div class="pk-card-qty"><span>soni</span><input type="number" min="1" step="1" value="${it.soni}" data-qi="${i}" /></div>
        <button type="button" class="pk-x" data-rm="${i}" title="Olib tashlash">✕</button></div>`).join('')
        || '<div class="pk-empty soft">Hali yuk qo\'shilmagan</div>';
    }
    function renderAll() { renderCats(); renderModels(); renderPanel(); renderAdded(); }

    // ---------- qo'shish ----------
    function tryAdd() {
      const m = selModel ? modelById(selModel) : null;
      if (!m) return { ok: false, empty: true };
      const soni = Math.floor(Number(st.qty));
      if (!(soni > 0)) { toast('Sonini kiriting (1 dan boshlab)', true); return { ok: false }; }
      const isMat = selCat === MATRAS_ONLY;
      const c = catOfModel(m);
      const it = { modelId: m.id, soni, model: m.nomi, kategoriya: c ? c.nomi : '', yonalish: isMat ? 'matras' : 'mebel' };
      if (!isMat && m.matrasKetadi && st.useMat) {
        const mm = modelById(st.matId);
        if (!mm) { toast('Qanday matras ketishini tanlang', true); return { ok: false }; }
        const ms = st.matQty === '' ? soni : Math.floor(Number(st.matQty));
        if (!(ms > 0)) { toast('Matras sonini kiriting', true); return { ok: false }; }
        it.matrasId = mm.id; it.matrasNomi = mm.nomi; it.matrasSoni = ms;
      }
      const same = items.findIndex((x) => x.modelId === it.modelId && (x.matrasId || '') === (it.matrasId || ''));
      let idx;
      if (same >= 0) { items[same].soni += it.soni; if (it.matrasId) items[same].matrasSoni += it.matrasSoni; idx = same; }
      else { items.push(it); idx = items.length - 1; }
      selModel = null; st = { qty: 1, useMat: true, matId: '', matQty: '' };
      renderModels(); renderPanel(); renderAdded(idx);
      toast(`${it.model} zakazga qo'shildi ✓`);
      const first = root.querySelector('.pk-model');
      if (first) first.focus({ preventScroll: true });
      return { ok: true };
    }

    // ---------- hodisalar ----------
    root.addEventListener('click', (e) => {
      const cat = e.target.closest('[data-cat]');
      if (cat) { selCat = cat.dataset.cat; selModel = null; st = { qty: 1, useMat: true, matId: '', matQty: '' }; renderCats(); renderModels(); renderPanel(); return; }
      const mod = e.target.closest('[data-model]');
      if (mod) {
        selModel = mod.dataset.model; st = { qty: 1, useMat: true, matId: '', matQty: '' };
        renderModels(); renderPanel();
        const q = root.querySelector('[data-r="qty"]'); if (q) { q.focus({ preventScroll: true }); q.select(); }
        return;
      }
      if (e.target.closest('[data-r="add"]')) { tryAdd(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { items.splice(Number(rm.dataset.rm), 1); renderAdded(); }
    });
    root.addEventListener('input', (e) => {
      const r = e.target.dataset.r;
      if (r === 'qty') { st.qty = e.target.value; const mq = root.querySelector('[data-r="matQty"]'); if (mq) mq.placeholder = e.target.value || '1'; }
      else if (r === 'matQty') st.matQty = e.target.value;
    });
    root.addEventListener('change', (e) => {
      const r = e.target.dataset.r;
      if (r === 'useMat') { st.useMat = e.target.checked; const b = $('matbox'); if (b) b.classList.toggle('pk-hide', !st.useMat); }
      else if (r === 'matSel') st.matId = e.target.value;
      else if (e.target.dataset.qi !== undefined) {
        const it = items[Number(e.target.dataset.qi)]; const v = Math.floor(Number(e.target.value));
        if (it && v > 0) { if (it.matrasId && it.matrasSoni === it.soni) it.matrasSoni = v; it.soni = v; }
        renderAdded();
      }
    });
    // Enter — formani yubormaydi, balki zakazga qo'shadi
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = e.target;
      if (t.tagName === 'BUTTON') return; // tugmada Enter — odatdagidek bosiladi
      e.preventDefault();
      if (t.dataset && t.dataset.qi !== undefined) { t.blur(); return; }
      tryAdd();
    });

    // ---------- tashqi API ----------
    return {
      setSklad(s) { sklad = { categories: (s && s.categories) || [], models: (s && s.models) || [] }; if (selModel && !modelById(selModel)) selModel = null; renderAll(); },
      // Saqlangan (yassi) ro'yxatdan qayta tiklash
      setItems(flat) {
        items = [];
        (flat || []).forEach((i) => {
          if (i.yonalish === 'matras' && i.fromModelId) return; // mebelga biriktirilgan matras alohida qator emas
          const m = modelById(i.modelId);
          const it = { modelId: i.modelId, soni: i.soni, model: (m && m.nomi) || i.model, kategoriya: i.kategoriya || '', yonalish: i.yonalish || 'mebel', _gone: !m };
          if (i.matrasId) { it.matrasId = i.matrasId; it.matrasSoni = i.matrasSoni || i.soni; const mm = modelById(i.matrasId); it.matrasNomi = (mm && mm.nomi) || i.matrasNomi || ''; if (!mm) it._gone = true; }
          items.push(it);
        });
        selCat = null; selModel = null; st = { qty: 1, useMat: true, matId: '', matQty: '' };
        renderAll();
      },
      reset() { items = []; selCat = null; selModel = null; st = { qty: 1, useMat: true, matId: '', matQty: '' }; renderAll(); },
      // Tanlangan, lekin hali "Zakazga qo'shish" bosilmagan model bo'lsa, o'zi qo'shadi. false = xato (toast chiqqan)
      commitPending() { const r = tryAdd(); return r.empty ? true : r.ok; },
      count() { return items.length; },
      // Serverga yuboriladigan ko'rinish; o'chirilgan modellar tashlab yuboriladi (dropped soni bilan)
      getItems() {
        const send = []; let dropped = 0;
        items.forEach((it) => {
          if (!modelById(it.modelId)) { dropped += 1; return; }
          const r = { modelId: it.modelId, soni: it.soni };
          if (it.matrasId) { if (modelById(it.matrasId)) { r.matrasId = it.matrasId; r.matrasSoni = it.matrasSoni; } else dropped += 1; }
          send.push(r);
        });
        return { send, dropped };
      },
    };
  };
})();
