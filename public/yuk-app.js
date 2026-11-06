const DAY_NAMES_BY_DOW = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const HOLAT_LABEL = { qizil: 'Hali tayyor emas', sariq: 'Yuklanmoqda', yashil: 'Yuborildi' };
const MAX_PER_DAY = 99;
const NEW_OPTION = '__new__';
const VISIBLE_DAYS = 3;   // asosiy ekranda ko'rinadigan kunlar soni
const REPORT_DAYS = 7;    // hisobot doim 7 kunlik (haftalik) hisoblanadi
const ADNASPALNI_NAME = 'adnaspalni';

// Sessiya tugagan bo'lsa (yoki xodim o'chirilgan bo'lsa) — login sahifasiga qaytaramiz
const _origFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const r = await _origFetch(...args);
  if (r.status === 401) { location.href = '/'; }
  return r;
};

let me = null;       // joriy foydalanuvchi: { role, name, perms }
let staffList = [];
const isOwner = () => me && me.role === 'owner';
const hasPerm = (p) => isOwner() || !!(me && me.perms && me.perms[p]);

let loads = [];
let taxonomy = { categories: [], matrasCategories: [], matrasTypes: [] };
let zborshiklar = [];
let labolar = [];
let filiallar = [];
let currentStart = startOfDay(new Date());
let editingId = null;
let viewingLoad = null;
let searchTerm = '';

// ---------------- Sana yordamchilari ----------------
function startOfDay(d) { const date = new Date(d); date.setHours(0, 0, 0, 0); return date; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function toISO(d) {
  // MUHIM: toISOString() ishlatmaymiz — u UTC (Grinvich) vaqtiga o'tkazib
  // hisoblaydi, O'zbekiston esa UTC+5 bo'lgani uchun bu kunni bir kunga
  // siljitib qo'yardi. Shu sabab mahalliy (local) sana qismlarini
  // to'g'ridan-to'g'ri o'zimiz yig'amiz — hech qanday siljish bo'lmaydi.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtShort(d) { return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' }); }
// Zakaz qachon kiritilgani: 05.11.2026 14:32 (Toshkent vaqti)
function fmtCreated(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '—';
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
function fmtMoney(n) { return Number(n || 0).toLocaleString('ru-RU'); }
function escapeHtml(s) { const div = document.createElement('div'); div.textContent = s ?? ''; return div.innerHTML; }

// ---------------- API: loads ----------------
async function fetchLoads() { loads = await (await fetch('/api/loads')).json(); }
// ---------------- Kodlar: 4 xonali, yozayotganda ko'rinmaydi ----------------
// action — yuk qo'shish / tahrirlash (va Sozlamalarga kirish); pay — pul qabul qilish; delete — o'chirish (yuk, zborshik, labo, filial, xodim)
const codeState = { action: false, delete: false, pay: false };
let settingsCode = ''; // Sozlamalar ochilganda kiritilgan amal kodi (saqlashda kerak bo'ladi)
const CODE_TITLES = { action: '🔐 Tasdiqlash kodini kiriting', delete: "🔐 O'chirish kodini kiriting", pay: '💰 Pul qabul qilish kodini kiriting' };

// Faqat raqam, 4 tagacha
document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('code-input')) e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

// Yashirin (nuqtali) kod oynasi. Bekor qilinsa null qaytaradi.
function askSecret(title) {
  return new Promise((resolve) => {
    const modal = document.getElementById('secretModal');
    const form = document.getElementById('secretForm');
    const input = document.getElementById('secretInput');
    const err = document.getElementById('secretError');
    const hintEl = document.getElementById('secretHint');
    document.getElementById('secretTitle').textContent = title;
    hintEl.style.display = 'none';
    input.value = ''; input.type = 'password'; err.textContent = '';
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
    const done = (v) => {
      modal.classList.add('hidden');
      form.onsubmit = null;
      document.getElementById('secretCancel').onclick = null;
      input.value = '';
      resolve(v);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!/^\d{4}$/.test(v)) { err.textContent = 'Kod 4 ta raqamdan iborat'; return; }
      done(v);
    };
    document.getElementById('secretCancel').onclick = () => done(null);
  });
}

// So'rovni kod bilan yuboradi. Kod o'rnatilgan bo'lsa, avval kodni so'raydi.
async function callWithCode(url, method, body, kind = 'action') {
  let code = '';
  const ask = async (k) => {
    const v = await askSecret(CODE_TITLES[k] || CODE_TITLES.action);
    if (v === null) throw new Error('Bekor qilindi');
    return v;
  };
  if (codeState[kind]) code = await ask(kind);
  for (let i = 0; i < 2; i++) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Action-Code': code },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    // Egasi kodni yangi qo'ygan bo'lishi mumkin — shunda kodni so'rab, qayta urinamiz
    if (res.status === 403 && data.codeRequired && i === 0 && !code) {
      const k = data.codeKind || kind;
      codeState[k] = true;
      code = await ask(k);
      continue;
    }
    throw new Error(data.error || 'Xatolik');
  }
}

async function createLoad(payload) {
  return callWithCode('/api/loads', 'POST', payload);
}
async function updateLoad(id, payload) {
  return callWithCode(`/api/loads/${id}`, 'PUT', payload);
}
async function assignLoad(id, payload) {
  const res = await fetch(`/api/loads/${id}/assign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function deleteLoad(id) {
  return callWithCode(`/api/loads/${id}`, 'DELETE', null, 'delete');
}

// ---------------- API: taxonomy / zborshik / labo (hech qanday kod so'ralmaydi) ----------------
async function fetchTaxonomy() { taxonomy = await (await fetch('/api/taxonomy')).json(); }
async function addCategory(name) {
  const res = await fetch('/api/taxonomy/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function addColor(catId, name) {
  const res = await fetch(`/api/taxonomy/categories/${catId}/colors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchZborshiklar() { zborshiklar = await (await fetch('/api/zborshiklar')).json(); }
async function addZborshik(ism, telefon, login, password) {
  const res = await fetch('/api/zborshiklar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ism, telefon, login, password }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchLabolar() { labolar = await (await fetch('/api/labolar')).json(); }
async function addLabo(raqami, haydovchi, telefon) {
  const res = await fetch('/api/labolar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raqami, haydovchi, telefon }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchFiliallar() { filiallar = await (await fetch('/api/filiallar')).json(); }
async function addFilial(nomi) {
  const res = await fetch('/api/filiallar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomi }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}

// ---------------- Formadagi selectlar ----------------
const catSelect = document.getElementById('f_kategoriya');
const nomiInput = document.getElementById('f_nomi');
const rangSelect = document.getElementById('f_rang');
const matrasRow = document.getElementById('matrasRow');
const matrasBorCheck = document.getElementById('f_matras_bor');
const matrasTuriWrap = document.getElementById('matrasTuriWrap');
const matrasTuriSelect = document.getElementById('f_matras_turi');
const zborshikSelect = document.getElementById('f_zborshik');
const laboSelect = document.getElementById('f_labo');
const filialSelect = document.getElementById('f_filial');

function fillSelect(select, items, placeholder, addLabel, valueFn, labelFn) {
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  ph.disabled = true;
  select.appendChild(ph);
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = valueFn ? valueFn(item) : item.id;
    opt.textContent = labelFn ? labelFn(item) : item.name;
    select.appendChild(opt);
  });
  if (addLabel) {
    const addOpt = document.createElement('option');
    addOpt.value = NEW_OPTION;
    addOpt.textContent = addLabel;
    select.appendChild(addOpt);
  }
  select.value = '';
}

function currentCategory() { return taxonomy.categories.find((c) => c.id === catSelect.value); }

function populateCategories(selectedId) {
  fillSelect(catSelect, taxonomy.categories, 'Kategoriyani tanlang', "➕ Yangi kategoriya qo'shish");
  if (selectedId) catSelect.value = selectedId;
  toggleMatrasRow();
}
function populateColors(selectedId) {
  const cat = currentCategory();
  // "Yangi rang qo'shish" tugmasi olib tashlandi — endi faqat mavjud ranglar ko'rsatiladi
  fillSelect(rangSelect, cat ? cat.colors : [], cat ? 'Rangni tanlang' : 'Avval kategoriya tanlang', null);
  rangSelect.disabled = !cat;
  if (selectedId) rangSelect.value = selectedId;
}
function populateZborshiklar(select, selectedId) {
  fillSelect(select, zborshiklar, '— tanlanmagan —', "➕ Yangi zborshik qo'shish", null, (z) => `${z.ism}${z.telefon ? ' — ' + z.telefon : ''}`);
  select.value = selectedId || '';
}
function populateLabolar(select, selectedId) {
  fillSelect(select, labolar, '— tanlanmagan —', "➕ Yangi labo qo'shish", null, (l) => `${l.raqami} — ${l.haydovchi}`);
  select.value = selectedId || '';
}
function populateFiliallar(select, selectedId) {
  fillSelect(select, filiallar, '— tanlanmagan —', "➕ Yangi filial qo'shish", null, (f) => f.nomi);
  select.value = selectedId || '';
}

function toggleMatrasRow() {
  const cat = currentCategory();
  const name = (cat?.name || '').toLowerCase();
  const applicable = taxonomy.matrasCategories.some((m) => m.toLowerCase() === name);
  matrasRow.style.display = applicable ? '' : 'none';
  if (!applicable) {
    matrasBorCheck.checked = false;
    matrasTuriWrap.style.display = 'none';
  }
}

catSelect.addEventListener('change', async () => {
  if (catSelect.value === NEW_OPTION) {
    const name = prompt('Yangi kategoriya nomi:');
    if (!name || !name.trim()) { catSelect.value = ''; return; }
    try {
      const cat = await addCategory(name.trim());
      await fetchTaxonomy();
      populateCategories(cat.id);
      populateColors('');
    } catch (err) {
      showToast(err.message, true);
      catSelect.value = '';
    }
    return;
  }
  toggleMatrasRow();
  populateColors('');
});

// "Yangi rang qo'shish" funksiyasi olib tashlandi (endi rangSelect faqat mavjud
// ranglarni ko'rsatadi, yangi qo'shish imkoniyati yo'q)

matrasBorCheck.addEventListener('change', () => {
  matrasTuriWrap.style.display = matrasBorCheck.checked ? '' : 'none';
});

zborshikSelect.addEventListener('change', async () => {
  if (zborshikSelect.value === NEW_OPTION) {
    const ism = prompt('Yangi zborshik ismi:');
    if (!ism || !ism.trim()) { zborshikSelect.value = ''; return; }
    const telefon = prompt('Zborshikning telefon raqami:') || '';
    try {
      const z = await addZborshik(ism.trim(), telefon.trim());
      await fetchZborshiklar();
      populateZborshiklar(zborshikSelect, z.id);
    } catch (err) {
      showToast(err.message, true);
      zborshikSelect.value = '';
    }
  }
});

laboSelect.addEventListener('change', async () => {
  if (laboSelect.value === NEW_OPTION) {
    const raqami = prompt('Labo (mashina) raqami:');
    if (!raqami || !raqami.trim()) { laboSelect.value = ''; return; }
    const haydovchi = prompt('Haydovchi ismi:') || '';
    const telefon = prompt('Haydovchi telefon raqami:') || '';
    try {
      const l = await addLabo(raqami.trim(), haydovchi.trim(), telefon.trim());
      await fetchLabolar();
      populateLabolar(laboSelect, l.id);
    } catch (err) {
      showToast(err.message, true);
      laboSelect.value = '';
    }
  }
});

filialSelect.addEventListener('change', async () => {
  if (filialSelect.value === NEW_OPTION) {
    const nomi = prompt('Yangi filial nomi:');
    if (!nomi || !nomi.trim()) { filialSelect.value = ''; return; }
    try {
      const f = await addFilial(nomi.trim());
      await fetchFiliallar();
      populateFiliallar(filialSelect, f.id);
    } catch (err) {
      showToast(err.message, true);
      filialSelect.value = '';
    }
  }
});

// ---------------- Qidiruv ----------------
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderBoard();
});
function matchesSearch(l) {
  if (!searchTerm) return true;
  const hay = [
    l.nomi, l.manzil?.hudud, l.manzil?.dom, l.tel1, l.tel2,
    l.zborshik?.ism, l.zborshik?.telefon, l.labo?.raqami, l.labo?.haydovchi, l.labo?.telefon,
    l.kategoriya?.nomi, l.rang?.nomi,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(searchTerm);
}

// ---------------- Render: board (har kun ichida 2 ustun: Boshqa | Adnaspalni) ----------------
function renderWeekLabel() {
  const end = addDays(currentStart, VISIBLE_DAYS - 1);
  document.getElementById('weekLabel').textContent = `${fmtShort(currentStart)} — ${fmtShort(end)}`;
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const todayISO = toISO(new Date());

  for (let i = 0; i < VISIBLE_DAYS; i++) {
    const date = addDays(currentStart, i);
    const iso = toISO(date);
    const isToday = iso === todayISO;

    const col = document.createElement('div');
    col.className = 'day-col' + (isToday ? ' is-today' : '');

    const dayLoads = loads.filter((l) => l.sana === iso).sort((a, b) => (a.tartib || 0) - (b.tartib || 0)); // tartib raqami bo'yicha; limit uchun — filtrlanmagan
    const displayLoads = dayLoads.filter(matchesSearch);
    const otherLoads = displayLoads.filter((l) => (l.kategoriya?.nomi || '').toLowerCase() !== ADNASPALNI_NAME);
    const adnaLoads = displayLoads.filter((l) => (l.kategoriya?.nomi || '').toLowerCase() === ADNASPALNI_NAME);

    const head = document.createElement('div');
    head.className = 'day-col-head';
    head.innerHTML = `<span class="day-name">${DAY_NAMES_BY_DOW[date.getDay()]}</span><span class="day-date">${fmtShort(date)} · ${dayLoads.length}/${MAX_PER_DAY}</span>`;
    col.appendChild(head);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-card-btn';
    addBtn.textContent = dayLoads.length >= MAX_PER_DAY ? `To'ldi (${MAX_PER_DAY}/${MAX_PER_DAY})` : "+ Yuk qo'shish";
    addBtn.disabled = dayLoads.length >= MAX_PER_DAY;
    addBtn.onclick = () => openAddModal(iso);
    if (hasPerm('add')) col.appendChild(addBtn);

    const split = document.createElement('div');
    split.className = 'day-split';
    split.appendChild(renderGroup('Boshqa', otherLoads));
    split.appendChild(renderGroup('Adnaspalni', adnaLoads));
    col.appendChild(split);

    board.appendChild(col);
  }
}

function renderGroup(title, items) {
  const wrap = document.createElement('div');
  wrap.className = 'day-group';
  const head = document.createElement('div');
  head.className = 'day-group-head';
  head.textContent = `${title} · ${items.length}`;
  wrap.appendChild(head);
  const list = document.createElement('div');
  list.className = 'day-group-list';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-day';
    empty.textContent = '—';
    list.appendChild(empty);
  } else {
    items.forEach((l) => list.appendChild(renderCard(l)));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderCard(l) {
  const card = document.createElement('div');
  card.className = `load-card rang-${l.holat}` + (l.tolandi ? ' is-paid' : '');
  const addrBits = [l.manzil?.hudud, l.manzil?.dom ? `dom ${l.manzil.dom}` : '', l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '', l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : '']
    .filter(Boolean).join(', ');

  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ');
  const meta = [];
  if (l.matras?.bor) meta.push(`🛏 ${l.matras.turi}`);
  if (l.zborshik) meta.push(`🧰 ${l.zborshik.ism}`);
  if (l.labo) meta.push(`🚚 ${l.labo.raqami}`);

  card.innerHTML = `
    <div class="load-card-top">
      <div class="load-name">${l.tartib ? `<span class="load-seq${hasPerm('reorder') ? ' load-seq-btn' : ''}"${hasPerm('reorder') ? ' title="Tartib raqamini almashtirish"' : ''}>${l.tartib}</span>` : ''}${escapeHtml(title || '—')}</div>
      ${l.kategoriya?.nomi ? `<div class="load-number">${escapeHtml(l.kategoriya.nomi)}</div>` : ''}
    </div>
    ${addrBits ? `<div class="load-addr">${escapeHtml(addrBits)}</div>` : ''}
    <div class="load-fin">
      <div class="dot-leader"><span class="lbl">Astatka</span><span class="fill"></span><span class="val">${fmtMoney(l.astatka)}</span></div>
      ${l.tel1 ? `<div class="dot-leader"><span class="lbl">Tel</span><span class="fill"></span><span class="val">${escapeHtml(l.tel1)}</span></div>` : ''}
    </div>
    ${meta.length ? `<div class="load-meta">${meta.map(escapeHtml).join(' · ')}</div>` : ''}
    ${l.tolandi ? `<div class="paid-badge">💰 To'landi</div>` : ((l.jamiTolangan || 0) > 0 ? `<div class="paid-badge partial">💵 Qisman (${fmtMoney(l.jamiTolangan)})</div>` : '')}
  `;
  card.onclick = (e) => {
    if (e.target.closest('.load-seq-btn')) { openMoveModal(l); return; } // raqamni bossa — tartibni almashtirish
    openViewModal(l);
  };
  return card;
}

// ---------------- Add / Edit modal ----------------
const formModal = document.getElementById('formModal');
const loadForm = document.getElementById('loadForm');
const formError = document.getElementById('formError');

function openAddModal(prefilledDate) {
  editingId = null;
  document.getElementById('formModalTitle').textContent = "Yangi yuk qo'shish";
  loadForm.reset();
  populateCategories('');
  populateColors('');
  populateZborshiklar(zborshikSelect, '');
  populateLabolar(laboSelect, '');
  populateFiliallar(filialSelect, '');
  matrasBorCheck.checked = false;
  matrasTuriWrap.style.display = 'none';
  document.getElementById('f_sana').value = prefilledDate || toISO(new Date());
  formError.textContent = '';
  formModal.classList.remove('hidden');
}

function openEditModal(l) {
  editingId = l.id;
  document.getElementById('formModalTitle').textContent = 'Yukni tahrirlash';
  populateCategories(l.kategoriya?.id || '');
  nomiInput.value = l.nomi || '';
  populateColors(l.rang?.id || '');
  populateZborshiklar(zborshikSelect, l.zborshik?.id || '');
  populateLabolar(laboSelect, l.labo?.id || '');
  populateFiliallar(filialSelect, l.filial?.id || '');

  toggleMatrasRow();
  if (l.matras?.bor) {
    matrasBorCheck.checked = true;
    matrasTuriWrap.style.display = '';
    matrasTuriSelect.value = l.matras.turi || '';
  } else {
    matrasBorCheck.checked = false;
    matrasTuriWrap.style.display = 'none';
  }

  document.getElementById('f_izoh').value = l.izoh || '';
  document.getElementById('f_sana').value = l.sana || '';
  document.getElementById('f_holat').value = l.holat || 'qizil';
  document.getElementById('f_hudud').value = l.manzil?.hudud || '';
  document.getElementById('f_dom').value = l.manzil?.dom || '';
  document.getElementById('f_padyez').value = l.manzil?.padyez || '';
  document.getElementById('f_etaj').value = l.manzil?.etaj || '';
  document.getElementById('f_astatka').value = l.astatka || '';
  document.getElementById('f_tel1').value = l.tel1 || '';
  document.getElementById('f_tel2').value = l.tel2 || '';
  formError.textContent = '';
  closeModals();
  formModal.classList.remove('hidden');
}

function closeModals() {
  formModal.classList.add('hidden');
  document.getElementById('viewModal').classList.add('hidden');
  document.getElementById('reportModal').classList.add('hidden');
  document.getElementById('teamModal').classList.add('hidden');
  document.getElementById('staffModal').classList.add('hidden');
  document.getElementById('zbModal').classList.add('hidden');
  document.getElementById('settingsModal').classList.add('hidden');
  document.getElementById('moveModal').classList.add('hidden');
  settingsCode = '';
}

document.querySelectorAll('.close-modal').forEach((btn) => btn.addEventListener('click', closeModals));
formModal.addEventListener('click', (e) => { if (e.target === formModal) closeModals(); });
document.getElementById('viewModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('viewModal')) closeModals();
});
document.getElementById('reportModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('reportModal')) closeModals();
});
document.getElementById('teamModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('teamModal')) closeModals();
});

document.getElementById('addLoadTopBtn').onclick = () => openAddModal(toISO(new Date()));

loadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';

  if (!catSelect.value || catSelect.value === NEW_OPTION) { formError.textContent = 'Kategoriyani tanlang'; return; }
  if (!nomiInput.value.trim()) { formError.textContent = 'Nomini kiriting'; return; }
  if (!rangSelect.value || rangSelect.value === NEW_OPTION) { formError.textContent = 'Rangni tanlang'; return; }

  const manzil = {
    hudud: document.getElementById('f_hudud').value.trim(),
    dom: document.getElementById('f_dom').value.trim(),
    padyez: document.getElementById('f_padyez').value.trim(),
    etaj: document.getElementById('f_etaj').value.trim(),
  };
  const base = {
    kategoriyaId: catSelect.value,
    nomi: nomiInput.value.trim(),
    rangId: rangSelect.value,
    matras: { bor: matrasBorCheck.checked, turi: matrasBorCheck.checked ? matrasTuriSelect.value : null },
    zborshikId: zborshikSelect.value || null,
    laboId: laboSelect.value || null,
    filialId: filialSelect.value || null,
    izoh: document.getElementById('f_izoh').value.trim(),
    sana: document.getElementById('f_sana').value,
    holat: document.getElementById('f_holat').value,
    manzil,
    astatka: document.getElementById('f_astatka').value,
    tel1: document.getElementById('f_tel1').value.trim(),
    tel2: document.getElementById('f_tel2').value.trim(),
  };

  try {
    if (editingId) {
      await updateLoad(editingId, base);
      showToast('Yuk yangilandi ✓');
    } else {
      await createLoad(base);
      showToast("Yuk qo'shildi ✓");
    }
    closeModals();
    await refresh();
  } catch (err) {
    formError.textContent = err.message;
  }
});

// ---------------- View modal ----------------
const viewModal = document.getElementById('viewModal');
const quickZborshikSelect = document.getElementById('quickZborshik');
const quickLaboSelect = document.getElementById('quickLabo');

function openViewModal(l) {
  viewingLoad = l;
  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ');
  document.getElementById('viewTitle').textContent = title || 'Yuk';
  const addrLine = [l.manzil?.hudud].filter(Boolean).join(', ') || '—';
  const domLine = [
    l.manzil?.dom ? `dom ${l.manzil.dom}` : '',
    l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '',
    l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : '',
  ].filter(Boolean).join(' · ') || '—';

  const jamiTolangan = l.jamiTolangan || 0;
  const qoldiq = l.qoldiq !== undefined ? l.qoldiq : Math.max(0, (Number(l.astatka) || 0) - jamiTolangan);
  const tolovTarixi = (l.tolovlar || []).map(t => `${t.sana}: ${fmtMoney(t.summa)} so'm`).join('<br>') || 'Hali to\'lov yo\'q';
  const tolovHolatDot = l.tolandi ? 'tolandi' : (jamiTolangan > 0 ? 'qisman' : 'kutilmoqda');
  const tolovHolatText = l.tolandi ? "To'liq to'landi" : (jamiTolangan > 0 ? `Qisman to'landi (${fmtMoney(jamiTolangan)} so'm)` : 'Hali to\'lanmagan');

  document.getElementById('viewBody').innerHTML = `
    <div class="view-created">🕒 Kiritilgan: ${fmtCreated(l.createdAt)}</div>
    <div class="view-row"><span class="k">Tartib raqami</span><span class="v mono">${l.tartib || '—'}</span></div>
    <div class="view-row"><span class="k">Holat</span><span class="v"><span class="status-pill"><span class="dot ${l.holat}"></span>${HOLAT_LABEL[l.holat] || l.holat}</span></span></div>
    <div class="view-row"><span class="k">Filial</span><span class="v">${escapeHtml(l.filial?.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">To'lov holati</span><span class="v"><span class="status-pill"><span class="dot ${tolovHolatDot}"></span>${tolovHolatText}</span></span></div>
    <div class="view-row"><span class="k">Astatka (umumiy narx)</span><span class="v mono">${fmtMoney(l.astatka)} so'm</span></div>
    <div class="view-row"><span class="k">Jami to'langan</span><span class="v mono">${fmtMoney(jamiTolangan)} so'm</span></div>
    <div class="view-row"><span class="k">Qoldiq</span><span class="v mono" style="color:${qoldiq > 0 ? '#f87171' : '#4ade80'};">${fmtMoney(qoldiq)} so'm</span></div>
    <div class="view-row"><span class="k">To'lovlar tarixi</span><span class="v">${tolovTarixi}</span></div>
    <div class="view-row"><span class="k">Kategoriya</span><span class="v">${escapeHtml(l.kategoriya?.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">Nomi</span><span class="v">${escapeHtml(l.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">Rang</span><span class="v">${escapeHtml(l.rang?.nomi || '—')}</span></div>
    ${l.matras?.bor ? `<div class="view-row"><span class="k">Matras</span><span class="v">${escapeHtml(l.matras.turi)}</span></div>` : ''}
    ${l.izoh ? `<div class="view-row"><span class="k">Izoh</span><span class="v">${escapeHtml(l.izoh)}</span></div>` : ''}
    <div class="view-row"><span class="k">Jo'natish sanasi</span><span class="v">${l.sana}</span></div>
    <div class="view-row"><span class="k">Hudud</span><span class="v">${escapeHtml(addrLine)}</span></div>
    <div class="view-row"><span class="k">Dom / padyez / etaj</span><span class="v">${escapeHtml(domLine)}</span></div>
    <div class="view-row"><span class="k">1-telefon</span><span class="v mono">${escapeHtml(l.tel1 || '—')}</span></div>
    <div class="view-row"><span class="k">2-telefon</span><span class="v mono">${escapeHtml(l.tel2 || '—')}</span></div>
  `;

  populateZborshiklar(quickZborshikSelect, l.zborshik?.id || '');
  populateLabolar(quickLaboSelect, l.labo?.id || '');

  document.getElementById('deleteLoadBtn').style.display = hasPerm('delete') ? '' : 'none';
  document.getElementById('editLoadBtn').style.display = hasPerm('edit') ? '' : 'none';
  document.getElementById('paymentSection').style.display = hasPerm('pay') ? '' : 'none';
  document.getElementById('quickAssignSection').style.display = hasPerm('edit') ? '' : 'none';

  document.getElementById('payLoadBtn').style.display = l.tolandi ? 'none' : '';
  document.getElementById('payLoadBtn').textContent = qoldiq > 0 && jamiTolangan > 0
    ? `💰 Yana pul qabul qilish (qoldi ${fmtMoney(qoldiq)} so'm)`
    : `💰 Pul qabul qilish`;
  formModal.classList.add('hidden');
  viewModal.classList.remove('hidden');
}

quickZborshikSelect.addEventListener('change', async () => {
  if (quickZborshikSelect.value === NEW_OPTION) {
    const ism = prompt('Yangi zborshik ismi:');
    if (!ism || !ism.trim()) { quickZborshikSelect.value = viewingLoad?.zborshik?.id || ''; return; }
    const telefon = prompt('Zborshikning telefon raqami:') || '';
    try {
      const z = await addZborshik(ism.trim(), telefon.trim());
      await fetchZborshiklar();
      populateZborshiklar(quickZborshikSelect, z.id);
    } catch (err) {
      showToast(err.message, true);
    }
  }
});
quickLaboSelect.addEventListener('change', async () => {
  if (quickLaboSelect.value === NEW_OPTION) {
    const raqami = prompt('Labo (mashina) raqami:');
    if (!raqami || !raqami.trim()) { quickLaboSelect.value = viewingLoad?.labo?.id || ''; return; }
    const haydovchi = prompt('Haydovchi ismi:') || '';
    const telefon = prompt('Haydovchi telefon raqami:') || '';
    try {
      const l = await addLabo(raqami.trim(), haydovchi.trim(), telefon.trim());
      await fetchLabolar();
      populateLabolar(quickLaboSelect, l.id);
    } catch (err) {
      showToast(err.message, true);
    }
  }
});

document.getElementById('quickZborshikSave').onclick = async () => {
  if (!viewingLoad) return;
  if (!quickZborshikSelect.value || quickZborshikSelect.value === NEW_OPTION) { showToast("Zborshikni tanlang", true); return; }
  try {
    const updated = await assignLoad(viewingLoad.id, { zborshikId: quickZborshikSelect.value });
    viewingLoad = updated;
    showToast("Zborshik almashtirildi ✓");
    await refresh();
    openViewModal(updated);
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('quickLaboSave').onclick = async () => {
  if (!viewingLoad) return;
  if (!quickLaboSelect.value || quickLaboSelect.value === NEW_OPTION) { showToast('Laboni tanlang', true); return; }
  try {
    const updated = await assignLoad(viewingLoad.id, { laboId: quickLaboSelect.value });
    viewingLoad = updated;
    showToast('Labo almashtirildi ✓');
    await refresh();
    openViewModal(updated);
  } catch (err) {
    showToast(err.message, true);
  }
};

// Holatni PIN'siz, bitta tugma bosish bilan almashtirish
document.querySelectorAll('.status-quick-btn').forEach((btn) => {
  btn.onclick = async () => {
    if (!viewingLoad) return;
    try {
      const updated = await assignLoad(viewingLoad.id, { holat: btn.dataset.holat });
      viewingLoad = updated;
      showToast(`Holat "${HOLAT_LABEL[btn.dataset.holat]}" ga almashtirildi ✓`);
      await refresh();
      openViewModal(updated);
    } catch (err) {
      showToast(err.message, true);
    }
  };
});

// Bitta buyurtmani chop etish (Ctrl+P) — faqat shu buyurtmaning o'zi chiqadi
document.getElementById('printLoadBtn').onclick = () => {
  if (!viewingLoad) return;
  const l = viewingLoad;
  const addrLine = [l.manzil?.hudud].filter(Boolean).join(', ') || '—';
  const domLine = [
    l.manzil?.dom ? `dom ${l.manzil.dom}` : '',
    l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '',
    l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : '',
  ].filter(Boolean).join(' · ') || '—';
  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ');

  document.getElementById('printArea').innerHTML = `
    <h1>${escapeHtml(title || 'Yuk')}</h1>
    <table class="print-table">
      <tr><td>Holat</td><td>${HOLAT_LABEL[l.holat] || l.holat}</td></tr>
      <tr><td>Kategoriya</td><td>${escapeHtml(l.kategoriya?.nomi || '—')}</td></tr>
      <tr><td>Rang</td><td>${escapeHtml(l.rang?.nomi || '—')}</td></tr>
      ${l.matras?.bor ? `<tr><td>Matras</td><td>${escapeHtml(l.matras.turi)}</td></tr>` : ''}
      ${l.izoh ? `<tr><td>Izoh</td><td>${escapeHtml(l.izoh)}</td></tr>` : ''}
      <tr><td>Jo'natish sanasi</td><td>${l.sana}</td></tr>
      <tr><td>Hudud</td><td>${escapeHtml(addrLine)}</td></tr>
      <tr><td>Dom / padyez / etaj</td><td>${escapeHtml(domLine)}</td></tr>
      <tr><td>Astatka (qoldiq)</td><td>${fmtMoney(l.astatka)} so'm</td></tr>
      <tr><td>1-telefon</td><td>${escapeHtml(l.tel1 || '—')}</td></tr>
      <tr><td>2-telefon</td><td>${escapeHtml(l.tel2 || '—')}</td></tr>
      ${l.zborshik ? `<tr><td>Zborshik</td><td>${escapeHtml(l.zborshik.ism)} — ${escapeHtml(l.zborshik.telefon || '')}</td></tr>` : ''}
      ${l.labo ? `<tr><td>Labo</td><td>${escapeHtml(l.labo.raqami)} (${escapeHtml(l.labo.haydovchi)}) — ${escapeHtml(l.labo.telefon || '')}</td></tr>` : ''}
    </table>
  `;
  window.print();
};

document.getElementById('editLoadBtn').onclick = () => { if (viewingLoad) openEditModal(viewingLoad); };

document.getElementById('deleteLoadBtn').onclick = async () => {
  if (!viewingLoad) return;
  if (!confirm("Bu yukni o'chirishni tasdiqlaysizmi?")) return;
  try {
    await deleteLoad(viewingLoad.id);
    showToast("Yuk o'chirildi");
    closeModals();
    await refresh();
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('payLoadBtn').onclick = async () => {
  if (!viewingLoad) return;
  const qoldiq = viewingLoad.qoldiq !== undefined ? viewingLoad.qoldiq : viewingLoad.astatka;
  const summaStr = prompt(`Necha so'm qabul qilindi? (Qoldiq: ${fmtMoney(qoldiq)} so'm)`);
  if (summaStr === null) return;
  const summa = Number(String(summaStr).replace(/\s/g, ''));
  if (!summa || summa <= 0) { showToast("To'g'ri summa kiriting", true); return; }

  try {
    const data = await callWithCode(`/api/loads/${viewingLoad.id}/pay`, 'PUT', { summa }, 'pay');
    if (data.tolandi) {
      showToast(`✅ To'liq to'landi! Jami: ${fmtMoney(data.jamiTolangan)} so'm`);
    } else {
      showToast(`💰 ${fmtMoney(summa)} so'm qabul qilindi. Qoldiq: ${fmtMoney(data.qoldiq)} so'm`);
    }
    viewingLoad = data;
    await refresh();
    openViewModal(data);
  } catch (err) {
    showToast(err.message, true);
  }
};

// ---------------- Jamoa (Zborshik / Labo) — tashqi boshqaruv, kodsiz ----------------
const teamModal = document.getElementById('teamModal');

// O'chirish tugmasi (jamoani boshqarish ruxsati kerak; o'chirishda o'chirish kodi so'raladi)
const delBtn = (type, id, label) => hasPerm('team')
  ? `<button class="danger-btn small-btn" data-del-type="${type}" data-del-id="${id}" data-del-label="${encodeURIComponent(label || '')}" title="O'chirish">🗑</button>`
  : '';

function renderTeamModal() {
  // Ranglar: kategoriya tanlansa, o'sha kategoriyaning ranglari ko'rsatiladi
  const catSel = document.getElementById('teamColorCatSelect');
  catSel.innerHTML = taxonomy.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (!catSel.value && taxonomy.categories.length) catSel.value = taxonomy.categories[0].id;
  renderTeamColorList();

  const zbList = document.getElementById('teamZborshikList');
  zbList.innerHTML = zborshiklar.length
    ? zborshiklar.map((z) => `<div class="team-item team-row"><div><b>${escapeHtml(z.ism)}</b>${z.telefon ? ` <span class="muted">${escapeHtml(z.telefon)}</span>` : ''}${isOwner() ? (z.login ? `<div class="muted">🔑 ${escapeHtml(z.login)}${z.loginActive ? '' : " · to'xtatilgan"}</div>` : `<div class="muted">login yo'q</div>`) : ''}</div>${isOwner() ? `<button class="ghost-btn small-btn" data-zb-login="${z.id}">🔑 ${z.login ? 'Login' : 'Login berish'}</button>` : ''}${delBtn('zborshiklar', z.id, z.ism)}</div>`).join('')
    : `<div class="empty-day">Hali zborshik qo'shilmagan</div>`;

  const lbList = document.getElementById('teamLaboList');
  lbList.innerHTML = labolar.length
    ? labolar.map((l) => `<div class="team-item team-row"><div><b>${escapeHtml(l.raqami)}</b> — ${escapeHtml(l.haydovchi)}${l.telefon ? ` <span class="muted">${escapeHtml(l.telefon)}</span>` : ''}</div>${delBtn('labolar', l.id, l.raqami)}</div>`).join('')
    : `<div class="empty-day">Hali labo qo'shilmagan</div>`;

  const filList = document.getElementById('teamFilialList');
  filList.innerHTML = filiallar.length
    ? filiallar.map((f) => `<div class="team-item team-row"><div><b>${escapeHtml(f.nomi)}</b></div>${delBtn('filiallar', f.id, f.nomi)}</div>`).join('')
    : `<div class="empty-day">Hali filial qo'shilmagan</div>`;

  document.getElementById('staffSection').classList.toggle('hidden', !isOwner());
  if (isOwner()) renderStaffList();
  teamModal.classList.remove('hidden');
}

function renderTeamColorList() {
  const catSel = document.getElementById('teamColorCatSelect');
  const cat = taxonomy.categories.find((c) => c.id === catSel.value);
  const list = document.getElementById('teamColorList');
  list.innerHTML = (cat && cat.colors.length)
    ? cat.colors.map((c) => `<div class="team-item"><b>${escapeHtml(c.name)}</b></div>`).join('')
    : `<div class="empty-day">Bu kategoriyada hali rang yo'q</div>`;
}

document.getElementById('teamColorCatSelect').addEventListener('change', renderTeamColorList);

document.getElementById('teamAddColorBtn').onclick = async () => {
  const catSel = document.getElementById('teamColorCatSelect');
  if (!catSel.value) { showToast("Avval kategoriya tanlang", true); return; }
  const name = prompt('Yangi rang nomi:');
  if (!name || !name.trim()) return;
  try {
    await addColor(catSel.value, name.trim());
    await fetchTaxonomy();
    renderTeamColorList();
    showToast(`✅ "${name.trim()}" rangi qo'shildi`);
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('teamBtn').onclick = renderTeamModal;

document.getElementById('teamAddZborshikBtn').onclick = () => openZbModal(null);

document.getElementById('teamAddLaboBtn').onclick = async () => {
  const raqami = prompt('Labo (mashina) raqami:');
  if (!raqami || !raqami.trim()) return;
  const haydovchi = prompt('Haydovchi ismi:') || '';
  const telefon = prompt('Haydovchi telefon raqami:') || '';
  try {
    await addLabo(raqami.trim(), haydovchi.trim(), telefon.trim());
    await fetchLabolar();
    renderTeamModal();
    showToast('Labo qo\'shildi ✓');
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('teamAddFilialBtn').onclick = async () => {
  const nomi = prompt('Yangi filial nomi:');
  if (!nomi || !nomi.trim()) return;
  try {
    await addFilial(nomi.trim());
    await fetchFiliallar();
    renderTeamModal();
    showToast("Filial qo'shildi ✓");
  } catch (err) {
    showToast(err.message, true);
  }
};

// ---------------- Toast ----------------
let toastTimer = null;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ---------------- Hisobot: astatka / kassa + zborshik / labo hikoya shaklida (7 kunlik) ----------------
function reportRangeDates() {
  const arr = [];
  for (let i = 0; i < REPORT_DAYS; i++) arr.push(toISO(addDays(currentStart, i)));
  return arr;
}

// Oxirgi 30 kun (bugungi kun bilan birga) — oylik hisobotlar uchun
function monthlyRangeDates() {
  const arr = [];
  const start = new Date();
  start.setDate(start.getDate() - 29);
  for (let i = 0; i < 30; i++) arr.push(toISO(addDays(start, i)));
  return arr;
}

function computeMoneyReport() {
  const rangeDates = reportRangeDates();

  // Kassa endi TO'LOV SANASI bo'yicha hisoblanadi (buyurtma sanasi emas) —
  // chunki bitta buyurtmaga bir necha marta, turli kunlarda qisman to'lov kirishi mumkin.
  const kassaByDate = {};
  loads.forEach((l) => {
    (l.tolovlar || []).forEach((t) => {
      kassaByDate[t.sana] = (kassaByDate[t.sana] || 0) + (Number(t.summa) || 0);
    });
  });

  const days = rangeDates.map((iso) => {
    const date = new Date(iso);
    const ordersForDay = loads.filter((l) => l.sana === iso);
    const astatkaKutilmoqda = ordersForDay.filter((l) => !l.tolandi).reduce((s, l) => s + Number(l.qoldiq ?? l.astatka ?? 0), 0);
    const kassa = kassaByDate[iso] || 0;
    return { iso, dayName: DAY_NAMES_BY_DOW[date.getDay()], soni: ordersForDay.length, astatkaKutilmoqda, kassa };
  });
  const umumiy = days.reduce((acc, d) => ({
    astatkaKutilmoqda: acc.astatkaKutilmoqda + d.astatkaKutilmoqda,
    kassa: acc.kassa + d.kassa,
    soni: acc.soni + d.soni,
  }), { astatkaKutilmoqda: 0, kassa: 0, soni: 0 });
  return { days, umumiy };
}

// Har bir zborshik/labo bo'yicha, kunlar kesimida qaysi zakazlar (nomlari) berilganini yig'ish
function computePeopleReport(getKey, getMeta, dateList) {
  const rangeDates = dateList || reportRangeDates();
  const map = new Map();
  loads.forEach((l) => {
    const key = getKey(l);
    if (!key || !rangeDates.includes(l.sana)) return;
    if (!map.has(key)) map.set(key, { meta: getMeta(l), perDayNames: {}, jami: 0 });
    const rec = map.get(key);
    if (!rec.perDayNames[l.sana]) rec.perDayNames[l.sana] = [];
    rec.perDayNames[l.sana].push(l.nomi || 'nomsiz');
    rec.jami += 1;
  });
  return { rangeDates, rows: Array.from(map.values()) };
}

function renderPeopleNarrative(report, icon, emptyText) {
  if (!report.rows.length) return `<div class="empty-day">${emptyText}</div>`;
  return report.rows.map((r) => {
    const dayLines = report.rangeDates
      .filter((iso) => r.perDayNames[iso])
      .map((iso) => {
        const names = r.perDayNames[iso];
        return `<div class="report-day-line"><b>${fmtShort(new Date(iso))}:</b> ${escapeHtml(names.join(', '))} <span class="muted">(${names.length} ta)</span></div>`;
      }).join('');
    return `
      <div class="report-person">
        <div class="report-person-head">${icon} ${escapeHtml(r.meta)} — jami ${r.jami} ta zakaz</div>
        <div class="report-person-days">${dayLines}</div>
      </div>
    `;
  }).join('');
}

function renderReport() {
  const { days, umumiy } = computeMoneyReport();
  const moneyRows = days.map((d) => `
    <tr>
      <td>${d.dayName}<br><span class="muted">${fmtShort(new Date(d.iso))}</span></td>
      <td class="mono">${d.soni}</td>
      <td class="mono">${fmtMoney(d.astatkaKutilmoqda)}</td>
      <td class="mono">${fmtMoney(d.kassa)}</td>
    </tr>
  `).join('');

  const zb = computePeopleReport((l) => l.zborshik?.id, (l) => `${l.zborshik.ism}${l.zborshik.telefon ? ' — ' + l.zborshik.telefon : ''}`);
  const lb = computePeopleReport((l) => l.labo?.id, (l) => `${l.labo.raqami} — ${l.labo.haydovchi}${l.labo.telefon ? ' — ' + l.labo.telefon : ''}`);

  const zborshikOptions = zborshiklar.map((z) => `<option value="${z.id}">${escapeHtml(z.ism)}</option>`).join('');
  const laboOptions = labolar.map((l) => `<option value="${l.id}">${escapeHtml(l.raqami)} — ${escapeHtml(l.haydovchi)}</option>`).join('');

  document.getElementById('reportBody').innerHTML = `
    <div class="report-print-head">
      <h3 class="report-subhead" style="margin:0;">💰 Astatka / Kassa (7 kunlik)</h3>
      <button class="ghost-btn small-btn" id="printKassaReportBtn">🖨️ Shu jadvalni chop etish</button>
    </div>
    <table class="report-table">
      <thead><tr><th>Kun</th><th>Zakazlar</th><th>Kutilayotgan astatka</th><th>Kassa (pul kirimi)</th></tr></thead>
      <tbody>${moneyRows}</tbody>
      <tfoot>
        <tr>
          <td>Umumiy (7 kun)</td>
          <td class="mono">${umumiy.soni}</td>
          <td class="mono">${fmtMoney(umumiy.astatkaKutilmoqda)}</td>
          <td class="mono">${fmtMoney(umumiy.kassa)}</td>
        </tr>
      </tfoot>
    </table>
    <p class="report-note">
      "Kutilayotgan astatka" — hali to'liq to'lanmagan zakazlarning qoldiq summasi.
      "Kassa" — aynan shu kunda kiritilgan to'lovlar (qisman yoki to'liq) yig'indisi.
    </p>

    <h3 class="report-subhead">🧰 Zborshiklar nima qildi (7 kunlik)</h3>
    ${renderPeopleNarrative(zb, '🧰', "Bu 7 kunda zborshik biriktirilgan zakaz yo'q")}

    <h3 class="report-subhead">🚚 Labo / haydovchilar nima tashidi (7 kunlik)</h3>
    ${renderPeopleNarrative(lb, '🚚', "Bu 7 kunda labo biriktirilgan zakaz yo'q")}

    <h3 class="report-subhead">🖨️ 1 oylik shaxsiy hisobot (har biriga alohida chop etish)</h3>
    <div class="quick-assign-row">
      <label style="flex:1;">Zborshik
        <select id="reportZborshikSelect">${zborshikOptions || '<option value="">— hali zborshik yo\'q —</option>'}</select>
      </label>
      <button class="ghost-btn small-btn" id="printZborshikReportBtn">🖨️ Chop etish</button>
    </div>
    <div class="quick-assign-row">
      <label style="flex:1;">Labo / haydovchi
        <select id="reportLaboSelect">${laboOptions || '<option value="">— hali labo yo\'q —</option>'}</select>
      </label>
      <button class="ghost-btn small-btn" id="printLaboReportBtn">🖨️ Chop etish</button>
    </div>
  `;
  document.getElementById('reportModal').classList.remove('hidden');

  document.getElementById('printKassaReportBtn').onclick = () => printKassaReport(days, umumiy);
  document.getElementById('printZborshikReportBtn').onclick = () => {
    const id = document.getElementById('reportZborshikSelect').value;
    const z = zborshiklar.find((x) => x.id === id);
    if (!z) return;
    printPersonMonthlyReport('zborshik', z, `${z.ism}${z.telefon ? ' — ' + z.telefon : ''}`);
  };
  document.getElementById('printLaboReportBtn').onclick = () => {
    const id = document.getElementById('reportLaboSelect').value;
    const l = labolar.find((x) => x.id === id);
    if (!l) return;
    printPersonMonthlyReport('labo', l, `${l.raqami} — ${l.haydovchi}${l.telefon ? ' — ' + l.telefon : ''}`);
  };
}

document.getElementById('reportBtn').onclick = renderReport;

// Kassa (7 kunlik) jadvalini chop etish
function printKassaReport(days, umumiy) {
  const rows = days.map((d) => `
    <tr>
      <td>${d.dayName} (${fmtShort(new Date(d.iso))})</td>
      <td>${d.soni}</td>
      <td>${fmtMoney(d.astatkaKutilmoqda)}</td>
      <td>${fmtMoney(d.kassa)}</td>
    </tr>`).join('');
  document.getElementById('printArea').innerHTML = `
    <h1>Kassa hisoboti — oxirgi 7 kun</h1>
    <table class="print-table">
      <tr><td>Kun</td><td>Zakazlar</td><td>Kutilayotgan astatka</td><td>Kassa (kirim)</td></tr>
      ${rows}
      <tr><td><b>Jami</b></td><td><b>${umumiy.soni}</b></td><td><b>${fmtMoney(umumiy.astatkaKutilmoqda)}</b></td><td><b>${fmtMoney(umumiy.kassa)}</b></td></tr>
    </table>
  `;
  window.print();
}

// Bitta zborshik yoki labo uchun 1 oylik hisobotni chop etish
function printPersonMonthlyReport(type, person, personLabel) {
  const dateList = monthlyRangeDates();
  const getKey = type === 'zborshik' ? (l) => l.zborshik?.id : (l) => l.labo?.id;
  const relevantLoads = loads.filter((l) => getKey(l) === person.id && dateList.includes(l.sana));

  const rows = relevantLoads
    .sort((a, b) => a.sana.localeCompare(b.sana))
    .map((l) => `
      <tr>
        <td>${l.sana}</td>
        <td>${escapeHtml(l.nomi || '—')}</td>
        <td>${escapeHtml(l.filial?.nomi || '—')}</td>
        <td>${escapeHtml(l.manzil?.hudud || '—')}</td>
        <td>${HOLAT_LABEL[l.holat] || l.holat}</td>
      </tr>`).join('');

  document.getElementById('printArea').innerHTML = `
    <h1>${type === 'zborshik' ? '🧰 Zborshik' : '🚚 Labo/haydovchi'} hisoboti — oxirgi 30 kun</h1>
    <p><b>${escapeHtml(personLabel)}</b></p>
    <table class="print-table">
      <tr><td><b>Sana</b></td><td><b>Buyurtma</b></td><td><b>Filial</b></td><td><b>Hudud</b></td><td><b>Holat</b></td></tr>
      ${rows || '<tr><td colspan="5">Bu davrda biriktirilgan zakaz yo\'q</td></tr>'}
    </table>
    <p style="margin-top:14px;"><b>Jami: ${relevantLoads.length} ta zakaz</b></p>
  `;
  window.print();
}

// ---------------- Kun-kun surish ----------------
document.getElementById('prevWeek').onclick = () => { currentStart = addDays(currentStart, -1); renderWeekLabel(); renderBoard(); };
document.getElementById('nextWeek').onclick = () => { currentStart = addDays(currentStart, 1); renderWeekLabel(); renderBoard(); };
document.getElementById('todayBtn').onclick = () => { currentStart = startOfDay(new Date()); renderWeekLabel(); renderBoard(); };

// ---------------- Xodimlar (ishchilar) — faqat egasi ----------------
async function apiJson(url, method, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchStaff() { staffList = isOwner() ? await (await fetch('/api/staff')).json() : []; }

function renderStaffList() {
  const box = document.getElementById('teamStaffList');
  box.innerHTML = staffList.length ? staffList.map((u) => {
    const permLabels = { add: "qo'shish", edit: 'tahrirlash', pay: 'pul qabul qilish', delete: "o'chirish", reorder: 'tartibni almashtirish', team: 'jamoani boshqarish' };
    const perms = Object.keys(permLabels).filter((k) => u.perms[k]).map((k) => permLabels[k]).join(', ') || "faqat ko'rish";
    return `<div class="team-item team-row"><div><b>${escapeHtml(u.name)}</b> <span class="muted">${escapeHtml(u.login)}${u.active ? '' : " · to'xtatilgan"}</span><div class="muted">${escapeHtml(perms)}</div></div><button class="ghost-btn small-btn" data-staff-edit="${u.id}">Tahrirlash</button></div>`;
  }).join('') : `<div class="empty-day">Hali xodim qo'shilmagan</div>`;
}

const staffModal = document.getElementById('staffModal');
let editingStaffId = null;
function openStaffModal(u) {
  editingStaffId = u ? u.id : null;
  document.getElementById('staffModalTitle').textContent = u ? 'Xodimni tahrirlash' : 'Yangi xodim';
  document.getElementById('s_name').value = u ? u.name : '';
  document.getElementById('s_login').value = u ? u.login : '';
  document.getElementById('s_password').value = '';
  document.getElementById('s_password').placeholder = u ? "o'zgartirish uchun yangi parol yozing" : 'kamida 6 belgi';
  document.getElementById('s_perm_add').checked = u ? u.perms.add : true;
  document.getElementById('s_perm_edit').checked = u ? u.perms.edit : true;
  document.getElementById('s_perm_pay').checked = u ? u.perms.pay : false;
  document.getElementById('s_perm_delete').checked = u ? u.perms.delete : false;
  document.getElementById('s_perm_reorder').checked = u ? u.perms.reorder : false;
  document.getElementById('s_perm_team').checked = u ? u.perms.team : false;
  document.getElementById('s_active').checked = u ? u.active : true;
  document.getElementById('s_active_row').style.display = u ? '' : 'none';
  document.getElementById('staffDeleteBtn').style.display = u ? '' : 'none';
  document.getElementById('staffError').textContent = '';
  teamModal.classList.add('hidden');
  staffModal.classList.remove('hidden');
}
document.getElementById('teamAddStaffBtn').onclick = () => openStaffModal(null);
document.getElementById('teamStaffList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-staff-edit]')?.dataset.staffEdit;
  if (id) openStaffModal(staffList.find((u) => u.id === id));
});
document.getElementById('staffForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('staffError');
  err.textContent = '';
  const body = {
    name: document.getElementById('s_name').value.trim(),
    login: document.getElementById('s_login').value.trim(),
    perms: {
      add: document.getElementById('s_perm_add').checked,
      edit: document.getElementById('s_perm_edit').checked,
      pay: document.getElementById('s_perm_pay').checked,
      delete: document.getElementById('s_perm_delete').checked,
      reorder: document.getElementById('s_perm_reorder').checked,
      team: document.getElementById('s_perm_team').checked,
    },
  };
  const pw = document.getElementById('s_password').value;
  try {
    if (editingStaffId) {
      if (pw) body.password = pw;
      body.active = document.getElementById('s_active').checked;
      await apiJson(`/api/staff/${editingStaffId}`, 'PUT', body);
    } else {
      body.password = pw;
      await apiJson('/api/staff', 'POST', body);
    }
    await fetchStaff();
    staffModal.classList.add('hidden');
    renderTeamModal();
    showToast('Xodim saqlandi ✓');
  } catch (ex) { err.textContent = ex.message; }
});
document.getElementById('staffDeleteBtn').onclick = async () => {
  if (!editingStaffId || !confirm("Bu xodimni o'chirasizmi? U darhol tizimdan chiqib ketadi.")) return;
  try {
    await callWithCode(`/api/staff/${editingStaffId}`, 'DELETE', null, 'delete');
    await fetchStaff();
    staffModal.classList.add('hidden');
    renderTeamModal();
    showToast("Xodim o'chirildi");
  } catch (ex) { document.getElementById('staffError').textContent = ex.message; }
};
staffModal.addEventListener('click', (e) => { if (e.target === staffModal) closeModals(); });

// ---------------- Zborshik: yaratish va login-parol ----------------
const zbModal = document.getElementById('zbModal');
let editingZbId = null;
function openZbModal(z) {
  editingZbId = z ? z.id : null;
  document.getElementById('zbModalTitle').textContent = z ? `${z.ism} — login-parol` : 'Yangi zborshik';
  document.getElementById('zb_person_row').style.display = z ? 'none' : '';
  document.getElementById('zb_ism').value = '';
  document.getElementById('zb_tel').value = '';
  document.getElementById('zb_login').value = z && z.login ? z.login : '';
  document.getElementById('zb_password').value = '';
  document.getElementById('zb_password').placeholder = z && z.login ? "o'zgartirish uchun yangi parol yozing" : 'kamida 6 belgi';
  document.getElementById('zb_active').checked = z ? z.loginActive !== false : true;
  document.getElementById('zb_active_row').style.display = z && z.login ? '' : 'none';
  document.getElementById('zbRemoveLoginBtn').style.display = z && z.login ? '' : 'none';
  document.getElementById('zbError').textContent = '';
  teamModal.classList.add('hidden');
  zbModal.classList.remove('hidden');
}
document.getElementById('teamZborshikList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-zb-login]')?.dataset.zbLogin;
  if (id) openZbModal(zborshiklar.find((z) => z.id === id));
});
document.getElementById('zbForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('zbError');
  err.textContent = '';
  const login = document.getElementById('zb_login').value.trim();
  const password = document.getElementById('zb_password').value;
  try {
    if (editingZbId) {
      const z = zborshiklar.find((x) => x.id === editingZbId);
      const body = { login, active: document.getElementById('zb_active').checked };
      if (password) body.password = password;
      if (!z.login && !password) throw new Error('Parolni kiriting');
      await apiJson(`/api/zborshiklar/${editingZbId}/login`, 'PUT', body);
    } else {
      const ism = document.getElementById('zb_ism').value.trim();
      if (!ism) throw new Error('Zborshik ismini kiriting');
      if ((login && !password) || (!login && password)) throw new Error("Login va parolni ikkalasini ham kiriting (yoki ikkalasini ham bo'sh qoldiring)");
      await addZborshik(ism, document.getElementById('zb_tel').value.trim(), login || undefined, password || undefined);
    }
    await fetchZborshiklar();
    zbModal.classList.add('hidden');
    renderTeamModal();
    showToast('Saqlandi ✓');
  } catch (ex) { err.textContent = ex.message; }
});
document.getElementById('zbRemoveLoginBtn').onclick = async () => {
  if (!editingZbId || !confirm("Bu zborshikning login-parolini o'chirasizmi? U endi kira olmaydi (zborshik ro'yxatda qoladi).")) return;
  try {
    await callWithCode(`/api/zborshiklar/${editingZbId}/login`, 'DELETE', null, 'delete');
    await fetchZborshiklar();
    zbModal.classList.add('hidden');
    renderTeamModal();
    showToast("Login o'chirildi");
  } catch (ex) { document.getElementById('zbError').textContent = ex.message; }
};
zbModal.addEventListener('click', (e) => { if (e.target === zbModal) closeModals(); });

// ---------------- Chiqish ----------------
document.getElementById('logoutBtn').onclick = async () => {
  await _origFetch('/api/auth/logout', { method: 'POST' });
  location.href = '/';
};

// ---------------- Sozlamalar: kodlarni o'rnatish / o'zgartirish (faqat egasi) ----------------
const CODE_KINDS = ['action', 'pay', 'delete'];
const CODE_NAMES = { action: 'Amal kodi', pay: 'Pul qabul qilish kodi', delete: "O'chirish kodi" };

async function openSettings() {
  settingsCode = '';
  // Xavfsizlik: amal kodi o'rnatilgan bo'lsa, Sozlamalarga faqat shu kod bilan kiriladi
  if (codeState.action) {
    const code = await askSecret('🔐 Sozlamalarga kirish uchun amal kodini kiriting');
    if (code === null) return;
    try {
      const res = await fetch('/api/codes/check', { headers: { 'X-Action-Code': code } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(d.error || "Kod noto'g'ri", true); return; }
    } catch { showToast('Server bilan aloqa yo\'q', true); return; }
    settingsCode = code;
  }
  CODE_KINDS.forEach((k) => {
    document.getElementById(`set_${k}1`).value = '';
    document.getElementById(`set_${k}2`).value = '';
    document.getElementById(`set_${k}_clear`).checked = false;
    document.getElementById(`set_${k}_clear_row`).style.display = codeState[k] ? '' : 'none';
    document.getElementById(`${k}CodeStatus`).textContent = codeState[k] ? "— o'rnatilgan ✓" : "— o'rnatilmagan";
  });
  document.getElementById('settingsError').textContent = '';
  document.getElementById('settingsModal').classList.remove('hidden');
}
document.getElementById('settingsBtn').onclick = openSettings;
document.getElementById('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeModals(); });

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('settingsError');
  err.textContent = '';
  const body = {};
  for (const k of CODE_KINDS) {
    const v1 = document.getElementById(`set_${k}1`).value.trim();
    const v2 = document.getElementById(`set_${k}2`).value.trim();
    if (document.getElementById(`set_${k}_clear`).checked) { body[`${k}Code`] = ''; continue; }
    if (!v1 && !v2) continue;
    if (!/^\d{4}$/.test(v1)) { err.textContent = `${CODE_NAMES[k]} aniq 4 ta raqamdan iborat bo'lsin`; return; }
    if (v1 !== v2) { err.textContent = `${CODE_NAMES[k]}: ikkala kiritilgan kod bir xil emas`; return; }
    body[`${k}Code`] = v1;
  }
  if (!Object.keys(body).length) { err.textContent = "Hech narsa o'zgartirilmadi"; return; }
  try {
    const res = await fetch('/api/codes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Action-Code': settingsCode },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Xatolik');
    codeState.action = !!data.codeEnabled;
    codeState.pay = !!data.payCodeEnabled;
    codeState.delete = !!data.deleteCodeEnabled;
    closeModals();
    showToast('Kodlar saqlandi ✓');
  } catch (ex) { err.textContent = ex.message; }
});

// ---------------- Zakaz tartibini kartochka tepasidan almashtirish ----------------
let moveTarget = null;
function openMoveModal(l) {
  moveTarget = l;
  const n = loads.filter((x) => x.sana === l.sana).length;
  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ') || 'Zakaz';
  document.getElementById('moveInfo').textContent = `${title}. Hozirgi raqami: ${l.tartib} (kunda jami ${n} ta zakaz).`;
  const inp = document.getElementById('moveInput');
  inp.min = 1; inp.max = n; inp.value = l.tartib;
  document.getElementById('moveError').textContent = '';
  document.getElementById('moveModal').classList.remove('hidden');
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}
function stepMove(delta) {
  const inp = document.getElementById('moveInput');
  const max = Number(inp.max) || 1;
  inp.value = Math.min(max, Math.max(1, (Math.floor(Number(inp.value)) || 1) + delta));
}
document.getElementById('moveUpBtn').onclick = () => stepMove(-1);
document.getElementById('moveDownBtn').onclick = () => stepMove(1);
document.getElementById('moveModal').addEventListener('click', (e) => { if (e.target.id === 'moveModal') closeModals(); });
document.getElementById('moveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!moveTarget) return;
  const err = document.getElementById('moveError');
  const pos = Math.floor(Number(document.getElementById('moveInput').value));
  if (!pos || pos < 1) { err.textContent = 'Tartib raqamini kiriting (1 dan boshlab)'; return; }
  try {
    const data = await apiJson(`/api/loads/${moveTarget.id}/move`, 'PUT', { tartib: pos });
    closeModals();
    await refresh();
    showToast(`Zakaz ${data.tartib}-o'ringa qo'yildi ✓`);
  } catch (ex) { err.textContent = ex.message; }
});

// ---------------- Jamoa: zborshik / labo / filialni o'chirish (o'chirish kodi bilan) ----------------
teamModal.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del-type]');
  if (!btn) return;
  const { delType, delId } = btn.dataset;
  const label = decodeURIComponent(btn.dataset.delLabel || '');
  if (!confirm(`"${label}" ni o'chirasizmi?`)) return;
  try {
    await callWithCode(`/api/${delType}/${delId}`, 'DELETE', null, 'delete');
    await Promise.all([fetchZborshiklar(), fetchLabolar(), fetchFiliallar()]);
    populateZborshiklar(zborshikSelect, '');
    populateLabolar(laboSelect, '');
    populateFiliallar(filialSelect, '');
    renderTeamModal();
    showToast("O'chirildi ✓");
  } catch (err) { showToast(err.message, true); }
});

// ---------------- Boot ----------------
async function refresh() { await fetchLoads(); renderWeekLabel(); renderBoard(); }
async function boot() {
  const meRes = await _origFetch('/api/auth/me');
  if (!meRes.ok) { location.href = '/'; return; }
  me = await meRes.json();
  codeState.action = !!me.codeEnabled;
  codeState.delete = !!me.deleteCodeEnabled;
  codeState.pay = !!me.payCodeEnabled;
  if (isOwner()) document.getElementById('settingsBtn').style.display = '';
  if (!hasPerm('team')) document.getElementById('teamBtn').style.display = 'none';
  if (me.role === 'zborshik') { location.href = '/zborshik.html'; return; }
  document.getElementById('userName').textContent = `${me.name}${isOwner() ? ' (egasi)' : ''}`;
  if (!hasPerm('add')) {
    document.getElementById('addLoadTopBtn').style.display = 'none';
  }
  await fetchTaxonomy();
  await fetchZborshiklar();
  await fetchLabolar();
  await fetchFiliallar();
  await fetchStaff();
  populateCategories('');
  populateColors('');
  populateZborshiklar(zborshikSelect, '');
  populateLabolar(laboSelect, '');
  populateFiliallar(filialSelect, '');
  await refresh();
}
boot().catch(() => showToast('Serverga ulanishda xatolik', true));
