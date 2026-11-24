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
let editingPendingId = null; // sotuvchi zakazini tahrirlab tasdiqlash rejimi
let sellerList = [];

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
    throw httpError(data, res.status);
  }
}
function httpError(data, status) {
  const e = new Error((data && data.error) || 'Xatolik');
  e.data = data || {};
  e.status = status;
  return e;
}
// Skladda yetmasa so'raydi; tasdiqlansa force bilan qayta yuboradi. fn(force) — so'rovni bajaradigan funksiya.
async function withStockConfirm(fn) {
  try {
    return await fn(false);
  } catch (err) {
    if (err.data && err.data.skladKam) {
      if (!confirm(`${err.message}\n\nBaribir yuborilsinmi? (sklad qoldig'i minusga tushadi)`)) throw new Error('Bekor qilindi');
      return await fn(true);
    }
    throw err;
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
  if (!res.ok) throw httpError(data, res.status);
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
async function fetchZborshiklar() { zborshiklar = await (await fetch('/api/zborshiklar')).json(); }
async function addZborshik(ism, telefon, login, password) {
  const res = await fetch('/api/zborshiklar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ism, telefon, login, password }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchLabolar() { labolar = await (await fetch('/api/labolar')).json(); }
async function addLabo(raqami, haydovchi, telefon, login, password) {
  const res = await fetch('/api/labolar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raqami, haydovchi, telefon, login, password }) });
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
let editOrigNomi = ''; // tahrirlanayotgan eski zakazning nomi (yuk tanlanmagan bo'lsa saqlanib qoladi)
const zborshikSelect = document.getElementById('f_zborshik');
const laboSelect = document.getElementById('f_labo');
const filialSelect = document.getElementById('f_filial');
const zalogFilialSelect = document.getElementById('f_zalogFilial');
let zalogFilialTouched = false; // egasi zalog filialini qo'lda tanlagan bo'lsa, zakaz filialiga ergashmaydi
function populateZalogFilial(selectedId) {
  zalogFilialSelect.innerHTML = '<option value="">— zakaz filiali —</option>' + filiallar.map((f) => `<option value="${f.id}">${escapeHtml(f.nomi)}</option>`).join('');
  zalogFilialSelect.value = filiallar.some((f) => f.id === selectedId) ? selectedId : '';
}
zalogFilialSelect.addEventListener('change', () => { zalogFilialTouched = true; });
filialSelect.addEventListener('change', () => { if (!zalogFilialTouched && filiallar.some((f) => f.id === filialSelect.value)) zalogFilialSelect.value = filialSelect.value; });

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

function populateCategories() { /* kategoriya endi sklad kategoriyasidan olinadi (tanlash paneli) */ }
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
  if (select === filialSelect) populateZalogFilial(zalogFilialSelect.value || (zalogFilialTouched ? '' : selectedId)); // yangi filial qo'shilsa zalog ro'yxati ham yangilanadi
}

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
    loadTitle(l), l.manzil?.hudud, l.manzil?.dom, l.tel1, l.tel2,
    l.zborshik?.ism, l.zborshik?.telefon, l.labo?.raqami, l.labo?.haydovchi, l.labo?.telefon,
    l.kategoriya?.nomi, ...(l.skladItems || []).flatMap((i) => [i.model, i.kategoriya]),
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
    const isAdna = (l) => (l.kategoriya?.nomi || '').trim().toLowerCase() === ADNASPALNI_NAME; // birinchi model kategoriyasi
    const otherLoads = displayLoads.filter((l) => !isAdna(l));
    const adnaLoads = displayLoads.filter(isAdna);

    const head = document.createElement('div');
    head.className = 'day-col-head';
    head.innerHTML = `<span class="day-name">${DAY_NAMES_BY_DOW[date.getDay()]}</span><span class="day-date">${fmtShort(date)} · ${dayLoads.length}/${MAX_PER_DAY}</span>`;
    if (dayLoads.length) {
      const pb = document.createElement('button');
      pb.className = 'ghost-btn small-btn nk-day-btn';
      pb.textContent = '🖨️';
      pb.title = `Shu kunning hamma nakladnoylarini chop etish (${dayLoads.length} ta)`;
      pb.onclick = (ev) => { ev.stopPropagation(); printNakladnoy(dayLoads); };
      head.appendChild(pb);
    }
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

  const title = loadTitle(l);
  const meta = [];
  if (l.matras?.bor) meta.push(`🛏 ${l.matras.turi}`);
  (l.skladItems || []).slice(0, 3).forEach((i) => meta.push(`${YON_ICON[i.yonalish] || '📦'} ${i.model} ×${i.soni}`));
  if ((l.skladItems || []).length > 3) meta.push(`+${l.skladItems.length - 3} ta`);
  if (l.zborshik) meta.push(`🧰 ${l.zborshik.ism}`);
  if (l.labo) meta.push(`🚚 ${l.labo.raqami}`);
  if (isOwner() && l.zalog) meta.push(`💵 Zalog ${fmtMoney(l.zalog.summa)}${l.zalog.filial?.nomi ? ' · ' + l.zalog.filial.nomi : ''}`);
  if (isOwner() && l.sotuvchi) meta.push(`🛍 ${l.sotuvchi.ism}`);

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
  populateZborshiklar(zborshikSelect, '');
  populateLabolar(laboSelect, '');
  populateFiliallar(filialSelect, '');
  editOrigNomi = '';
  picker.setSklad(sklad);
  picker.reset();
  document.getElementById('f_sana').value = prefilledDate || toISO(new Date());
  formError.textContent = '';
  setZalogFields(null);
  document.getElementById('formSubmitBtn').textContent = 'Saqlash';
  formModal.classList.remove('hidden');
}

function openEditModal(l) {
  editingId = l.id;
  document.getElementById('formModalTitle').textContent = 'Yukni tahrirlash';
  editOrigNomi = l.nomi || '';
  populateZborshiklar(zborshikSelect, l.zborshik?.id || '');
  populateLabolar(laboSelect, l.labo?.id || '');
  populateFiliallar(filialSelect, l.filial?.id || '');

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
  document.getElementById('f_mijoz').value = l.mijoz || '';
  picker.setSklad(sklad);
  picker.setItems(l.skladItems || []);
  formError.textContent = '';
  setZalogFields(l.zalog || null);
  document.getElementById('formSubmitBtn').textContent = 'Saqlash';
  closeModals();
  formModal.classList.remove('hidden');
}

// Zalog maydoni faqat egasiga ko'rinadi
function setZalogFields(z) {
  document.getElementById('zalogRow').style.display = isOwner() ? '' : 'none';
  zalogFilialTouched = !!(z && z.filial && z.filial.id); // saqlangan zalog filiali bo'lsa — uni o'zgartirmaymiz
  populateZalogFilial((z && z.filial && z.filial.id) || filialSelect.value || '');
  document.getElementById('f_zalog').value = z && z.summa ? z.summa : '';
  document.getElementById('f_zalogIzoh').value = z && z.izoh ? z.izoh : '';
  document.getElementById('f_zalogSana').value = (z && z.sana) || toISO(new Date()); // zalog kiritilgan kun (standart: bugun)
}

function closeModals() {
  formModal.classList.add('hidden');
  document.getElementById('viewModal').classList.add('hidden');
  document.getElementById('reportModal').classList.add('hidden');
  document.getElementById('teamModal').classList.add('hidden');
  document.getElementById('staffModal').classList.add('hidden');
  document.getElementById('zbModal').classList.add('hidden');
  document.getElementById('loModal').classList.add('hidden');
  document.getElementById('skModal').classList.add('hidden');
  document.getElementById('matCfgModal').classList.add('hidden');
  document.getElementById('imgModal').classList.add('hidden');
  document.getElementById('notifModal').classList.add('hidden');
  document.getElementById('settingsModal').classList.add('hidden');
  document.getElementById('moveModal').classList.add('hidden');
  document.getElementById('sellerModal').classList.add('hidden');
  document.getElementById('pendingModal').classList.add('hidden');
  document.getElementById('pendingViewModal').classList.add('hidden');
  (window.__closeHooks || []).forEach((f) => { try { f(); } catch { /* e'tiborsiz */ } });
  editingPendingId = null;
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

  // Tanlangan, lekin "Zakazga qo'shish" bosilmagan model bo'lsa — o'zi qo'shiladi
  if (!picker.commitPending()) return;
  const { send: itemsToSend, dropped } = picker.getItems();
  if (dropped) showToast("O'chirilgan sklad modellari olib tashlandi", true);
  const izohVal = document.getElementById('f_izoh').value.trim();
  if (!itemsToSend.length && !izohVal && !editOrigNomi) { formError.textContent = "Yuk qo'shing: kategoriya → model tanlang (yoki tavsif yozing)"; return; }

  const manzil = {
    hudud: document.getElementById('f_hudud').value.trim(),
    dom: document.getElementById('f_dom').value.trim(),
    padyez: document.getElementById('f_padyez').value.trim(),
    etaj: document.getElementById('f_etaj').value.trim(),
  };
  const base = {
    nomi: itemsToSend.length ? '' : editOrigNomi, // yuk tanlangan bo'lsa, nom modellardan avtomatik olinadi
    zborshikId: zborshikSelect.value || null,
    laboId: laboSelect.value || null,
    filialId: filialSelect.value || null,
    izoh: izohVal,
    sana: document.getElementById('f_sana').value,
    holat: document.getElementById('f_holat').value,
    manzil,
    astatka: document.getElementById('f_astatka').value,
    tel1: document.getElementById('f_tel1').value.trim(),
    tel2: document.getElementById('f_tel2').value.trim(),
    mijoz: document.getElementById('f_mijoz').value.trim(),
    skladItems: itemsToSend,
  };
  if (isOwner()) {
    base.zalogSumma = document.getElementById('f_zalog').value;
    base.zalogIzoh = document.getElementById('f_zalogIzoh').value.trim();
    base.zalogSana = document.getElementById('f_zalogSana').value; // zalog olingan kun
    base.zalogFilialId = zalogFilialSelect.value || filialSelect.value || null; // zalogni olgan filial
  }

  try {
    if (editingPendingId) {
      // Sotuvchi zakazini tahrirlab tasdiqlash
      const pid = editingPendingId;
      await withStockConfirm((force) => callWithCode(`/api/pending/${pid}/approve`, 'POST', { ...base, force }));
      showToast("Zakaz tahrirlanib tasdiqlandi va jadvalga qo'shildi ✓");
      if (itemsToSend.length) fetchSklad().catch(() => {});
      closeModals();
      await refresh();
      pollPending();
      return;
    }
    if (editingId) {
      await withStockConfirm((force) => updateLoad(editingId, { ...base, force }));
      showToast('Yuk yangilandi ✓');
    } else {
      await withStockConfirm((force) => createLoad({ ...base, force }));
      showToast("Yuk qo'shildi ✓");
    }
    if (itemsToSend.length) fetchSklad().catch(() => {});
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
  const title = loadTitle(l);
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
    ${l.mijoz ? `<div class="view-row"><span class="k">Mijoz</span><span class="v">${escapeHtml(l.mijoz)}</span></div>` : ''}
    <div class="view-row"><span class="k">Filial</span><span class="v">${escapeHtml(l.filial?.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">To'lov holati</span><span class="v"><span class="status-pill"><span class="dot ${tolovHolatDot}"></span>${tolovHolatText}</span></span></div>
    <div class="view-row"><span class="k">Astatka (umumiy narx)</span><span class="v mono">${fmtMoney(l.astatka)} so'm</span></div>
    <div class="view-row"><span class="k">Jami to'langan</span><span class="v mono">${fmtMoney(jamiTolangan)} so'm</span></div>
    <div class="view-row"><span class="k">Qoldiq</span><span class="v mono" style="color:${qoldiq > 0 ? '#f87171' : '#4ade80'};">${fmtMoney(qoldiq)} so'm</span></div>
    <div class="view-row"><span class="k">To'lovlar tarixi</span><span class="v">${tolovTarixi}</span></div>
    <div class="view-row"><span class="k">Kategoriya</span><span class="v">${escapeHtml(l.kategoriya?.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">Nomi</span><span class="v">${escapeHtml(loadTitle(l) || '—')}</span></div>
    ${l.matras?.bor ? `<div class="view-row"><span class="k">Matras</span><span class="v">${escapeHtml(l.matras.turi)}</span></div>` : ''}
    ${(l.skladItems || []).length ? `<div class="view-row"><span class="k">Yuklar</span><span class="v">${(l.skladItems || []).map((i) => (i.yonalish === 'matras'
      ? `<span class="pk-line mat">🛏 <b>${escapeHtml(i.model)}</b> × ${i.soni}${i.fromModel ? ` <span class="sk-muted">(${escapeHtml(i.fromModel)} uchun)</span>` : ''}</span>`
      : `<span class="pk-line">🛋 ${i.kategoriya ? `${escapeHtml(i.kategoriya)} · ` : ''}<b>${escapeHtml(i.model)}</b> × ${i.soni}${i.matrasId ? '' : ' <span class="sk-muted">(matrassiz)</span>'}</span>`)).join('')}${(l.skladItems || []).some((i) => i.yonalish === 'matras') ? `<span class="sk-muted">${l.skladCut ? 'Matras skladdan ayirildi ✓' : 'Yuborilganda matras skladdan ayiriladi'}</span>` : ''}</span></div>` : ''}
    ${l.izoh ? `<div class="view-row"><span class="k">📝 Tavsif</span><span class="v">${escapeHtml(l.izoh)}</span></div>` : ''}
    ${isOwner() && l.sotuvchi ? `<div class="view-row"><span class="k">🛍 Sotuvchi</span><span class="v">${escapeHtml(l.sotuvchi.ism)}</span></div>` : ''}
    ${isOwner() && l.zalog ? `<div class="view-row"><span class="k">💵 Zalog</span><span class="v mono">${fmtMoney(l.zalog.summa)} so'm<br><span class="muted">${escapeHtml(l.zalog.sana || '')}${l.zalog.filial?.nomi ? ' · 🏬 ' + escapeHtml(l.zalog.filial.nomi) : ''}${l.zalog.kim ? ' · ' + escapeHtml(l.zalog.kim) : ''}${l.zalog.izoh ? ' · ' + escapeHtml(l.zalog.izoh) : ''}</span></span></div>` : ''}
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
      const wasCut = !!viewingLoad.skladCut;
      const updated = await withStockConfirm((force) => assignLoad(viewingLoad.id, { holat: btn.dataset.holat, force }));
      viewingLoad = updated;
      let msg = `Holat "${HOLAT_LABEL[btn.dataset.holat]}" ga almashtirildi ✓`;
      let warn = false;
      if (btn.dataset.holat === 'yashil') {
        if (updated.skladCut && !wasCut) msg += ` · 🛏 Skladdan ayirildi: ${updated.skladItems.filter((i) => i.yonalish === 'matras').map((i) => `${i.model} ×${i.soni}`).join(', ')}`;
      } else if (wasCut && !updated.skladCut) msg += ' · 📦 Sklad qaytarildi';
      showToast(msg, warn);
      await refresh();
      openViewModal(updated);
    } catch (err) {
      showToast(err.message, true);
    }
  };
});

// ---------------- NAKLADNOY: chap tomon zakaz ma'lumoti bilan to'ldiriladi, o'ng tomonda modellarning yuk jadvallari (Word shablondan) ----------------
// 1 mijoz = 1 nakladnoy; zakazda bir nechta model bo'lsa, o'ng tomonda hammasining yuklari. Tugma bosilganda bevosita chop etish oynasi ochiladi.
async function printNakladnoy(list) {
  list = (list || []).filter(Boolean);
  if (!list.length) { showToast("Nakladnoy uchun zakaz yo'q", true); return; }
  try {
    showToast('Nakladnoy tayyorlanmoqda…');
    const res = await fetch('/api/nakladnoy/html', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: list.map((l) => l.id) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Nakladnoy tayyorlanmadi');
    const p = data.page;
    let st = document.getElementById('nkPageStyle');
    if (!st) { st = document.createElement('style'); st.id = 'nkPageStyle'; document.head.appendChild(st); }
    st.textContent = `@media print { @page { size: ${p.w}mm ${p.h}mm; margin: ${p.mt}mm ${p.mr}mm ${p.mb}mm ${p.ml}mm; } }`;
    document.getElementById('printArea').innerHTML = data.html;
    document.body.classList.add('nk-printing');
    const done = () => { document.body.classList.remove('nk-printing'); document.getElementById('printArea').innerHTML = ''; st.textContent = ''; };
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    setTimeout(() => { if (document.body.classList.contains('nk-printing') && !document.hidden) done(); }, 120000);
  } catch (err) { showToast(err.message, true); }
}
// Word fayl sifatida yuklab olish (kerak bo'lsa Wordda tahrirlash uchun)
async function downloadNakladnoyWord(list) {
  list = (list || []).filter(Boolean);
  if (!list.length) return;
  try {
    const res = await fetch('/api/nakladnoy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: list.map((l) => l.id) }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Nakladnoy tayyorlanmadi'); }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = list.length === 1 ? `nakladnoy-${(list[0].mijoz || list[0].nomi || 'zakaz').replace(/[^\w\u0400-\u04FF-]+/g, '_').slice(0, 30)}-${list[0].sana}.docx` : `nakladnoy-${list[0].sana}-${list.length}ta.docx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) { showToast(err.message, true); }
}
document.getElementById('printLoadBtn').onclick = () => { if (viewingLoad) printNakladnoy([viewingLoad]); };
document.getElementById('wordLoadBtn').onclick = () => { if (viewingLoad) downloadNakladnoyWord([viewingLoad]); };

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
  const zbList = document.getElementById('teamZborshikList');
  zbList.innerHTML = zborshiklar.length
    ? zborshiklar.map((z) => `<div class="team-item team-row"><div><b>${escapeHtml(z.ism)}</b>${z.telefon ? ` <span class="muted">${escapeHtml(z.telefon)}</span>` : ''}${isOwner() ? (z.login ? `<div class="muted">🔑 ${escapeHtml(z.login)}${z.loginActive ? '' : " · to'xtatilgan"}</div>` : `<div class="muted">login yo'q</div>`) : ''}</div>${isOwner() ? `<button class="ghost-btn small-btn" data-zb-login="${z.id}">🔑 ${z.login ? 'Login' : 'Login berish'}</button>` : ''}${delBtn('zborshiklar', z.id, z.ism)}</div>`).join('')
    : `<div class="empty-day">Hali zborshik qo'shilmagan</div>`;

  const lbList = document.getElementById('teamLaboList');
  lbList.innerHTML = labolar.length
    ? labolar.map((l) => `<div class="team-item team-row"><div><b>${escapeHtml(l.raqami)}</b> — ${escapeHtml(l.haydovchi)}${l.telefon ? ` <span class="muted">${escapeHtml(l.telefon)}</span>` : ''}${isOwner() ? (l.login ? `<div class="muted">🔑 ${escapeHtml(l.login)}${l.loginActive ? '' : " · to'xtatilgan"}</div>` : `<div class="muted">login yo'q</div>`) : ''}</div>${isOwner() ? `<button class="ghost-btn small-btn" data-lo-login="${l.id}">🔑 ${l.login ? 'Login' : 'Login berish'}</button>` : ''}${delBtn('labolar', l.id, l.raqami)}</div>`).join('')
    : `<div class="empty-day">Hali labo qo'shilmagan</div>`;

  const filList = document.getElementById('teamFilialList');
  filList.innerHTML = filiallar.length
    ? filiallar.map((f) => `<div class="team-item team-row"><div><b>${escapeHtml(f.nomi)}</b></div>${delBtn('filiallar', f.id, f.nomi)}</div>`).join('')
    : `<div class="empty-day">Hali filial qo'shilmagan</div>`;

  document.getElementById('staffSection').classList.toggle('hidden', !isOwner());
  if (isOwner()) { renderStaffList(); renderSellerList(); }
  teamModal.classList.remove('hidden');
}


document.getElementById('teamBtn').onclick = renderTeamModal;

document.getElementById('teamAddZborshikBtn').onclick = () => openZbModal(null);

document.getElementById('teamAddLaboBtn').onclick = () => openLoModal(null);

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
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 7000 : 3500);
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
    rec.perDayNames[l.sana].push(loadTitle(l) || 'nomsiz');
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
    <div id="skReport"></div>
    <div id="matrasMonthReport"></div>
    <div id="zalogReport"></div>
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
  renderSkladReport();
  renderMatrasWeek();
  renderZalogReport();

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
        <td>${escapeHtml(loadTitle(l) || '—')}</td>
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

// ---------------- Labo: yaratish va shafyor login-paroli ----------------
const loModal = document.getElementById('loModal');
let editingLoId = null;
function openLoModal(l) {
  editingLoId = l ? l.id : null;
  document.getElementById('loModalTitle').textContent = l ? `${l.raqami} — shafyor login-paroli` : 'Yangi labo';
  document.getElementById('lo_person_row').style.display = l ? 'none' : '';
  document.getElementById('lo_raqami').value = '';
  document.getElementById('lo_haydovchi').value = '';
  document.getElementById('lo_tel').value = '';
  document.getElementById('lo_login').value = l && l.login ? l.login : '';
  document.getElementById('lo_password').value = '';
  document.getElementById('lo_password').placeholder = l && l.login ? "o'zgartirish uchun yangi parol yozing" : 'kamida 6 belgi';
  document.getElementById('lo_active').checked = l ? l.loginActive !== false : true;
  document.getElementById('lo_active_row').style.display = l && l.login ? '' : 'none';
  document.getElementById('loRemoveLoginBtn').style.display = l && l.login ? '' : 'none';
  document.getElementById('loError').textContent = '';
  teamModal.classList.add('hidden');
  loModal.classList.remove('hidden');
}
document.getElementById('teamLaboList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-lo-login]')?.dataset.loLogin;
  if (id) openLoModal(labolar.find((l) => l.id === id));
});
document.getElementById('loForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('loError');
  err.textContent = '';
  const login = document.getElementById('lo_login').value.trim();
  const password = document.getElementById('lo_password').value;
  try {
    if (editingLoId) {
      const l = labolar.find((x) => x.id === editingLoId);
      const body = { login, active: document.getElementById('lo_active').checked };
      if (password) body.password = password;
      if (!l.login && !password) throw new Error('Parolni kiriting');
      await apiJson(`/api/labolar/${editingLoId}/login`, 'PUT', body);
    } else {
      const raqami = document.getElementById('lo_raqami').value.trim();
      const haydovchi = document.getElementById('lo_haydovchi').value.trim();
      if (!raqami || !haydovchi) throw new Error('Labo raqami va shafyor ismini kiriting');
      if ((login && !password) || (!login && password)) throw new Error("Login va parolni ikkalasini ham kiriting (yoki ikkalasini ham bo'sh qoldiring)");
      await addLabo(raqami, haydovchi, document.getElementById('lo_tel').value.trim(), login || undefined, password || undefined);
    }
    await fetchLabolar();
    populateLabolar(laboSelect, '');
    loModal.classList.add('hidden');
    renderTeamModal();
    showToast('Saqlandi ✓');
  } catch (ex) { err.textContent = ex.message; }
});
document.getElementById('loRemoveLoginBtn').onclick = async () => {
  if (!editingLoId || !confirm("Bu shafyorning login-parolini o'chirasizmi? U endi kira olmaydi (labo ro'yxatda qoladi).")) return;
  try {
    await callWithCode(`/api/labolar/${editingLoId}/login`, 'DELETE', null, 'delete');
    await fetchLabolar();
    loModal.classList.add('hidden');
    renderTeamModal();
    showToast("Login o'chirildi");
  } catch (ex) { document.getElementById('loError').textContent = ex.message; }
};
loModal.addEventListener('click', (e) => { if (e.target === loModal) closeModals(); });

// ---------------- Sklad: Mebel (kategoriya → model, matras belgisi) + Matras (qoldiq hisobi) ----------------
const YON_ICON = { matras: '🛏', mebel: '🛋', zapchast: '🔧' };
const catOf = (m) => sklad.categories.find((c) => c.id === m.categoryId);
const YON_NOMI = { matras: 'Matras', mebel: 'Mebel' };
let sklad = { yonalishlar: [], categories: [], models: [] };
let skTab = 'mebel';   // Sklad oynasidagi tab: 'mebel' (kategoriya → model) yoki 'matras' (qoldiq)
let picker = null;     // yuk formasidagi tanlash paneli (pastda yaratiladi)

async function fetchSklad() {
  const res = await fetch('/api/sklad');
  if (res.ok) { sklad = await res.json(); if (picker) picker.setSklad(sklad); }
}
function modelInfo(id) {
  const m = sklad.models.find((x) => x.id === id);
  if (!m) return null;
  return { m, c: sklad.categories.find((x) => x.id === m.categoryId) };
}
const matrasList = () => sklad.models.filter((x) => catOf(x)?.yonalish === 'matras').sort((a, b) => a.nomi.localeCompare(b.nomi, undefined, { numeric: true }));
const tabsHtml = (active) => [['mebel', '🛋 Mebel — model va matras'], ['matras', '🛏 Matras — qoldiq']]
  .map(([id, label]) => `<button type="button" class="sk-tab ${id === active ? 'active' : ''}" data-y="${id}">${label}</button>`).join('');

// ----- Yuk formasidagi tanlash paneli: Kategoriya → Model → Matras → Zakazga qo'shish (umumiy modul: picker.js) -----
picker = createPicker(document.getElementById('pickerRoot'), { toast: (m, err) => showToast(m, err) });

// ----- Sklad oynasi -----
const skModal = document.getElementById('skModal');
const skManage = () => hasPerm('team');

function matrasBadge(x) {
  if (!x.matrasKetadi) return '<span class="sk-badge no">matras ketmaydi</span>';
  const names = (x.matrasIds || []).map((id) => sklad.models.find((k) => k.id === id)?.nomi).filter(Boolean);
  return `<span class="sk-badge yes">🛏 matras ketadi${names.length ? `: ${escapeHtml(names.join(', '))}` : ' · istalgan'}</span>`;
}
function skModelRow(x, m) {
  if (skTab === 'matras') {
    const q = Number(x.qoldiq) || 0;
    const btns = m
      ? `<button class="ghost-btn small-btn" data-sk="kirim" data-id="${x.id}">＋ Kirim</button><button class="ghost-btn small-btn" data-sk="fix" data-id="${x.id}" title="Sanab chiqib, qoldiqni to'g'rilash">✎ Sanoq</button><button class="ghost-btn small-btn" data-sk="renmodel" data-id="${x.id}" title="Nomini o'zgartirish">Aa</button><button class="danger-btn small-btn" data-sk="delmodel" data-id="${x.id}" title="O'chirish">🗑</button>`
      : '';
    return `<div class="sk-model"><span class="sk-mname">${escapeHtml(x.nomi)}</span><span class="sk-qty ${q <= 0 ? 'neg' : ''}">${q}</span>${btns}</div>`;
  }
  const thumb = x.rasm ? `<img class="sk-thumb" src="/api/sklad/models/${x.id}/rasm?v=${x.rasm.v}" alt="" data-view="${x.id}" loading="lazy" />` : '';
  const btns = m
    ? `<button class="ghost-btn small-btn" data-sk="cfgmat" data-id="${x.id}" title="Matras ketadimi, qaysi matras">🛏 Matras</button><button class="ghost-btn small-btn" data-sk="word" data-id="${x.id}" title="Nakladnoy Word fayli (.docx): chap tomonni sayt to'ldiradi, o'ng tomondagi yuklar o'zgarmaydi">📄 ${x.word ? 'Word ✓' : 'Word'}</button>${x.word ? `<button class="ghost-btn small-btn" data-sk="dlword" data-id="${x.id}" title="${escapeHtml(x.word.nomi)} — yuklab olish">⬇</button><button class="danger-btn small-btn" data-sk="delword" data-id="${x.id}" title="Word faylni olib tashlash">✕</button>` : ''}<button class="ghost-btn small-btn" data-sk="photo" data-id="${x.id}">📷 ${x.rasm ? 'Almashtirish' : 'Surat'}</button>${x.rasm ? `<button class="ghost-btn small-btn" data-sk="delphoto" data-id="${x.id}" title="Suratni olib tashlash">✕ Surat</button>` : ''}<button class="ghost-btn small-btn" data-sk="renmodel" data-id="${x.id}" title="Nomini o'zgartirish">Aa</button><button class="danger-btn small-btn" data-sk="delmodel" data-id="${x.id}" title="O'chirish">🗑</button>`
    : '';
  return `<div class="sk-model">${thumb}<span class="sk-mname">${escapeHtml(x.nomi)}<br>${matrasBadge(x)}</span>${btns}</div>`;
}
function renderSkladModal() {
  document.getElementById('skTabs').innerHTML = tabsHtml(skTab);
  const m = skManage();
  let html = '';
  if (skTab === 'matras') {
    const models = matrasList();
    const total = models.reduce((sum, x) => sum + (Number(x.qoldiq) || 0), 0);
    html = (m ? `<button class="ghost-btn" data-sk="addmatras">➕ Yangi matras modeli</button>` : '')
      + `<div class="sk-cat"><div class="sk-cat-head"><b class="sk-grow">Matraslar <span class="sk-muted">${models.length} model · jami ${total} dona</span></b></div>
        ${models.map((x) => skModelRow(x, m)).join('') || `<div class="empty-day">Hali matras modeli yo'q${m ? ": «➕ Yangi matras modeli» ni bosing" : ''}</div>`}
      </div>
      <p class="report-note">Sklad faqat matras qoldig'ini hisoblaydi. Mebel modellari soni hisoblanmaydi.</p>`;
  } else {
    const cats = sklad.categories.filter((c) => c.yonalish === 'mebel' && !c.yashirin);
    html = m ? `<button class="ghost-btn" data-sk="addcat">➕ Yangi kategoriya</button>` : '';
    html += cats.map((c) => {
      const models = sklad.models.filter((x) => x.categoryId === c.id);
      return `<div class="sk-cat">
        <div class="sk-cat-head"><b class="sk-grow">${escapeHtml(c.nomi)} <span class="sk-muted">${models.length} model</span></b>
          ${m ? `<button class="ghost-btn small-btn" data-sk="addmodel" data-id="${c.id}">＋ Model</button><button class="ghost-btn small-btn" data-sk="rencat" data-id="${c.id}" title="Nomini o'zgartirish">✎</button><button class="danger-btn small-btn" data-sk="delcat" data-id="${c.id}" title="Kategoriyani o'chirish">🗑</button>` : ''}
        </div>
        ${models.map((x) => skModelRow(x, m)).join('') || `<div class="empty-day">Hali model yo'q${m ? ": «＋ Model» ni bosing" : ''}</div>`}
      </div>`;
    }).join('') || `<div class="empty-day">Hali kategoriya yo'q${m ? ": «➕ Yangi kategoriya» ni bosing" : ''}</div>`;
  }
  document.getElementById('skBody').innerHTML = html;
}
async function openSkladModal() {
  await fetchSklad();
  renderSkladModal();
  document.getElementById('skHist').open = false;
  skModal.classList.remove('hidden');
}
document.getElementById('skladBtn').onclick = openSkladModal;
skModal.addEventListener('click', (e) => { if (e.target === skModal) closeModals(); });
document.getElementById('skTabs').addEventListener('click', (e) => {
  const y = e.target.closest('[data-y]')?.dataset.y;
  if (y) { skTab = y; renderSkladModal(); }
});

// ----- Modelga matras ketishini belgilash oynasi -----
const matCfgModal = document.getElementById('matCfgModal');
let cfgModelId = null;
function openMatCfg(modelId) {
  const x = sklad.models.find((k) => k.id === modelId);
  if (!x) return;
  cfgModelId = modelId;
  document.getElementById('mcTitle').textContent = `🛏 ${x.nomi}: matras`;
  document.getElementById('mcKetadi').checked = !!x.matrasKetadi;
  const list = matrasList();
  document.getElementById('mcList').innerHTML = list.length
    ? list.map((mm) => `<label class="mc-item"><input type="checkbox" value="${mm.id}" ${(x.matrasIds || []).includes(mm.id) ? 'checked' : ''} /><span>${escapeHtml(mm.nomi)}</span></label>`).join('')
    : '<div class="empty-day">Matras modeli yo\'q. Avval «🛏 Matras — qoldiq» bo\'limida matras qo\'shing.</div>';
  document.getElementById('mcWrap').classList.toggle('pk-hide', !x.matrasKetadi);
  matCfgModal.classList.remove('hidden');
}
document.getElementById('mcKetadi').addEventListener('change', (e) => document.getElementById('mcWrap').classList.toggle('pk-hide', !e.target.checked));
document.getElementById('mcSave').onclick = async () => {
  const ketadi = document.getElementById('mcKetadi').checked;
  const ids = [...document.querySelectorAll('#mcList input:checked')].map((i) => i.value);
  try {
    await apiJson(`/api/sklad/models/${cfgModelId}/matras`, 'PUT', { ketadi, ids });
    await fetchSklad();
    renderSkladModal();
    matCfgModal.classList.add('hidden');
    showToast('Saqlandi ✓');
  } catch (err) { showToast(err.message, true); }
};
document.getElementById('mcCancel').onclick = () => matCfgModal.classList.add('hidden');
matCfgModal.addEventListener('click', (e) => { if (e.target === matCfgModal) matCfgModal.classList.add('hidden'); });

const askNum = (text, def) => {
  const v = prompt(text, def === undefined ? '' : String(def));
  if (v === null) return null;
  const n = Math.floor(Number(String(v).replace(/\s/g, '')));
  return Number.isFinite(n) ? n : NaN;
};
document.getElementById('skBody').addEventListener('click', async (e) => {
  const view = e.target.closest('[data-view]');
  if (view) {
    const m = sklad.models.find((x) => x.id === view.dataset.view);
    if (m) showPhoto(`/api/sklad/models/${m.id}/rasm?v=${m.rasm ? m.rasm.v : ''}`, m.nomi);
    return;
  }
  const btn = e.target.closest('[data-sk]');
  if (!btn) return;
  const act = btn.dataset.sk;
  const id = btn.dataset.id;
  const model = sklad.models.find((x) => x.id === id);
  const cat = sklad.categories.find((x) => x.id === id);
  try {
    if (act === 'addcat') {
      const nomi = prompt('Yangi kategoriya nomi (masalan: Spalni, Shkaf, Divan):');
      if (!nomi || !nomi.trim()) return;
      await apiJson('/api/sklad/categories', 'POST', { yonalish: 'mebel', nomi: nomi.trim() });
    } else if (act === 'rencat') {
      const nomi = prompt('Kategoriya yangi nomi:', cat.nomi);
      if (!nomi || !nomi.trim() || nomi.trim() === cat.nomi) return;
      await apiJson(`/api/sklad/categories/${id}`, 'PUT', { nomi: nomi.trim() });
    } else if (act === 'delcat') {
      if (!confirm(`"${cat.nomi}" kategoriyasi va ichidagi hamma modellar o'chadi. Davom etasizmi?`)) return;
      await callWithCode(`/api/sklad/categories/${id}`, 'DELETE', null, 'delete');
    } else if (act === 'addmodel') {
      const nomi = prompt(`"${cat.nomi}" uchun yangi model nomi:`);
      if (!nomi || !nomi.trim()) return;
      const created = await apiJson('/api/sklad/models', 'POST', { categoryId: id, nomi: nomi.trim() });
      await fetchSklad();
      renderSkladModal();
      showToast('Model qo\'shildi ✓ — endi unga matras ketishini belgilang');
      openMatCfg(created.id); // darrov: matras ketadimi, qaysi matras
      return;
    } else if (act === 'addmatras') {
      const nomi = prompt("Yangi matras modeli nomi (masalan: 160x200 ortopedik):");
      if (!nomi || !nomi.trim()) return;
      const q = askNum("Hozir skladda nechta bor? (bo'sh yoki 0 — yo'q)", 0);
      if (q === null) return;
      await apiJson('/api/sklad/models', 'POST', { yonalish: 'matras', nomi: nomi.trim(), qoldiq: q > 0 ? q : 0 });
    } else if (act === 'renmodel') {
      const nomi = prompt('Model yangi nomi:', model.nomi);
      if (!nomi || !nomi.trim() || nomi.trim() === model.nomi) return;
      await apiJson(`/api/sklad/models/${id}`, 'PUT', { nomi: nomi.trim() });
    } else if (act === 'delmodel') {
      if (!confirm(`"${model.nomi}" modelini o'chirasizmi? (eski zakazlarda nomi saqlanib qoladi)`)) return;
      await callWithCode(`/api/sklad/models/${id}`, 'DELETE', null, 'delete');
    } else if (act === 'kirim') {
      const n = askNum(`"${model.nomi}" skladga nechta keldi?`);
      if (n === null) return;
      if (!(n > 0)) { showToast("Sonni to'g'ri kiriting", true); return; }
      await apiJson(`/api/sklad/models/${id}/kirim`, 'POST', { soni: n });
    } else if (act === 'cfgmat') {
      openMatCfg(id);
      return;
    } else if (act === 'photo') {
      photoModelId = id;
      skFile.click();
      return;
    } else if (act === 'word') {
      wordModelId = id;
      skWordFile.click();
      return;
    } else if (act === 'dlword') {
      window.open(`/api/sklad/models/${id}/word/file`, '_blank');
      return;
    } else if (act === 'delword') {
      if (!confirm(`"${model.nomi}" Word faylini olib tashlaysizmi?`)) return;
      await apiJson(`/api/sklad/models/${id}/word`, 'DELETE');
    } else if (act === 'delphoto') {
      if (!confirm(`"${model.nomi}" suratini olib tashlaysizmi?`)) return;
      await apiJson(`/api/sklad/models/${id}/rasm`, 'DELETE');
    } else if (act === 'fix') {
      const n = askNum(`"${model.nomi}" skladda aslida nechta bor? (sanab chiqqaningiz)`, model.qoldiq);
      if (n === null) return;
      if (!(n >= 0)) { showToast("Sonni to'g'ri kiriting", true); return; }
      await apiJson(`/api/sklad/models/${id}/qoldiq`, 'PUT', { qoldiq: n });
    }
    await fetchSklad();
    renderSkladModal();
    showToast('Saqlandi ✓');
  } catch (err) {
    if (err.message !== 'Bekor qilindi') showToast(err.message, true);
  }
});

const TUR_LABEL = { kirim: '📥 Kirim', chiqim: '📤 Yuborildi', qaytarish: '↩️ Qaytarildi', tuzatish: '✎ Sanoq' };
document.getElementById('skHist').addEventListener('toggle', async (e) => {
  if (!e.target.open) return;
  const box = document.getElementById('skHistBody');
  box.innerHTML = '<div class="sk-muted" style="padding:8px 0">Yuklanmoqda…</div>';
  try {
    const list = await apiJson('/api/sklad/harakat?limit=40', 'GET');
    box.innerHTML = list.length ? list.map((h) => `<div class="sk-hrow"><span>${TUR_LABEL[h.tur] || h.tur} · <b>${escapeHtml(h.model)}</b>${h.loadNomi ? ` <span class="sk-muted">(${escapeHtml(h.loadNomi)})</span>` : ''}<br><span class="sk-muted">${fmtCreated(h.vaqt)} · ${escapeHtml(h.kim || '')}</span></span><span class="${h.delta > 0 ? 'plus' : 'minus'}">${h.delta > 0 ? '+' : ''}${h.delta}</span></div>`).join('') : '<div class="sk-muted" style="padding:8px 0">Hali harakat yo\'q</div>';
  } catch (err) { box.innerHTML = `<div class="sk-muted">${escapeHtml(err.message)}</div>`; }
});

// ----- Model surati (faqat Mebel, ixtiyoriy) -----
let photoModelId = null;
const skFile = document.getElementById('skFile');
const imgModal = document.getElementById('imgModal');
function showPhoto(src, cap) {
  document.getElementById('imgModalImg').src = src;
  document.getElementById('imgModalCap').textContent = cap || '';
  imgModal.classList.remove('hidden');
}
imgModal.addEventListener('click', () => { imgModal.classList.add('hidden'); document.getElementById('imgModalImg').removeAttribute('src'); });
// Telefon suratini kichraytiramiz (1280px, JPEG) — tez yuklanadi va joy egallamaydi
function resizeImage(file, maxSide = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // shaffof PNG qora bo'lib qolmasin
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => { URL.revokeObjectURL(url); if (b) resolve(b); else reject(new Error("Suratni o'qib bo'lmadi")); }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bu formatdagi suratni o'qib bo'lmadi. JPG yoki PNG tanlang.")); };
    img.src = url;
  });
}
let wordModelId = null;
const skWordFile = document.getElementById('skWordFile');
skWordFile.addEventListener('change', async () => {
  const f = skWordFile.files[0];
  skWordFile.value = '';
  if (!f || !wordModelId) return;
  if (!/\.docx$/i.test(f.name)) { showToast("Faqat .docx (Word) fayl tanlang. Eski .doc bo'lsa, Word'da «Saqlash → .docx» qiling", true); return; }
  try {
    showToast('Word yuklanmoqda…');
    const res = await fetch(`/api/sklad/models/${wordModelId}/word`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Word yuklanmadi');
    await fetchSklad();
    renderSkladModal();
    showToast(data.word && data.word.chap === false ? "Word saqlandi, lekin chap tomon (накладной: «ТЕЛ ОФИСА» qatori) topilmadi — mijoz ma'lumotlari to'ldirilmaydi" : 'Word saqlandi ✓', data.word && data.word.chap === false);
  } catch (err) { showToast(err.message, true); }
});
skFile.addEventListener('change', async () => {
  const f = skFile.files[0];
  skFile.value = '';
  if (!f || !photoModelId) return;
  try {
    showToast('Surat yuklanmoqda…');
    const blob = await resizeImage(f);
    const res = await fetch(`/api/sklad/models/${photoModelId}/rasm`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Surat yuklanmadi');
    await fetchSklad();
    renderSkladModal();
    showToast('Surat saqlandi ✓');
  } catch (err) { showToast(err.message, true); }
});

// ----- Hisobot: bugun qancha matras ketdi, qancha kerak, skladda nechta qoldi (faqat matras) -----
async function renderSkladReport() {
  const box = document.getElementById('skReport');
  if (!box) return;
  box.innerHTML = '<div class="sk-muted">Sklad hisoboti yuklanmoqda…</div>';
  let r;
  try { r = await apiJson('/api/sklad/hisobot', 'GET'); } catch (err) { box.innerHTML = ''; return; }
  const day = r.days.find((d) => d.sana === r.today);
  const bor = (m) => (m.skladda === null ? 0 : m.skladda);       // o'chirilgan model = skladda yo'q
  const kamOf = (m) => Math.max(0, m.qoldi - bor(m));            // hali ketmagan qismi skladda yetmasa
  const matras = day ? day.yonalishlar.matras : null;
  const matKam = matras ? matras.modellar.filter((m) => kamOf(m) > 0) : [];
  const alert = matKam.length ? `<div class="sk-alert">
      <div class="sk-alert-title">🔴 Bugunga kerak matraslar — skladda yetmaydi</div>
      ${matKam.map((m) => `<div class="sk-alert-row"><b>${escapeHtml(m.model)}</b>: kerak ${m.qoldi} ta, skladda ${bor(m)} ta → <b>${kamOf(m)} ta yetmaydi</b></div>`).join('')}
    </div>` : '';

  const matrasBlock = () => {
    const head = `${YON_ICON.matras} Matras — bugun`;
    if (!matras || !matras.jami) return `<div class="sk-rep-block big"><div class="sk-rep-head">${head}</div><div class="sk-muted">Bugun matras yozilmagan</div></div>`;
    const sent = matras.modellar.filter((m) => m.ketdi > 0);
    const need = matras.modellar.filter((m) => m.qoldi > 0);
    const row = (m, right) => `<div class="sk-list-row"><span><b>${escapeHtml(m.model)}</b></span><span class="sk-r">${right}</span></div>`;
    return `<div class="sk-rep-block big">
      <div class="sk-rep-head">${head}</div>
      <div class="sk-stats">
        <div class="sk-stat need"><b>${matras.jami}</b><span>Bugunga kerak</span></div>
        <div class="sk-stat go"><b>${matras.ketdi}</b><span>Ketdi</span></div>
        <div class="sk-stat"><b>${matras.qoldi}</b><span>Hali ketishi kerak</span></div>
      </div>
      <div class="sk-list-title">✅ Bugun ketgan matraslar</div>
      ${sent.length ? sent.map((m) => row(m, `${m.ketdi} ta`)).join('') : '<div class="sk-muted">Hali matras ketmagan</div>'}
      <div class="sk-list-title">📋 Bugunga kerak matraslar (hali ketmagan)</div>
      ${need.length ? need.map((m) => row(m, `kerak ${m.qoldi} ta · skladda ${bor(m)} · ${kamOf(m) ? `<span class="sk-bad">⚠ ${kamOf(m)} ta yetmaydi</span>` : '<span class="sk-good">✔ yetadi</span>'}`)).join('') : '<div class="sk-muted">Hammasi yuborilgan 🎉</div>'}
    </div>`;
  };

  const dayRows = [...r.days].reverse().map((d) => {
    const y = d.yonalishlar.matras;
    return `<tr><td>${DAY_NAMES_BY_DOW[new Date(d.sana).getDay()]}<br><span class="sk-muted">${fmtShort(new Date(d.sana))}${d.sana === r.today ? ' · bugun' : ''}</span></td><td class="mono">${y.ketdi}<span class="sk-muted"> / ${y.jami}</span></td></tr>`;
  }).join('');
  box.innerHTML = `
    <h3 class="report-subhead" style="margin-top:0">🏬 Matras sklad hisoboti</h3>
    ${alert}
    ${matrasBlock()}
    ${r.days.length ? `<h3 class="report-subhead">📅 Kunlar bo'yicha matras: ketdi / kerak</h3>
    <div class="report-scroll"><table class="report-table"><thead><tr><th>Kun</th><th>🛏 Matras</th></tr></thead><tbody>${dayRows}</tbody></table></div>
    <p class="report-note">«Ketdi» — "Yuborildi" bo'lgan yuklardagi matras soni. «Kerak» — o'sha kunga yozilgan jami matras. Oxirgi 7 kun va keyingi 2 kun ko'rsatiladi. Mebel modellari hisoblanmaydi.</p>` : ''}
  `;
}

// ---------------- Bildirishnomalar (faqat xodimlar uchun) ----------------
const bellBtn = document.getElementById('bellBtn');
const bellBadge = document.getElementById('bellBadge');
const notifModal = document.getElementById('notifModal');
const BASE_TITLE = document.title;
let notifKnown = null; // ko'rilgan id'lar (birinchi yuklashda eski xabarlar uchun toast chiqmasin)
let notifItems = [];

function renderBell(unread) {
  bellBadge.textContent = unread > 99 ? '99+' : String(unread);
  bellBadge.classList.toggle('hidden', !unread);
  document.title = unread ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
}
function systemNotify(n) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(n.matn, { body: n.tafsilot, tag: n.id });
  } catch { /* ba'zi telefonlarda sahifadan tizim xabari ochilmaydi — ekrandagi xabar baribir chiqadi */ }
}
async function pollNotifs() {
  let data;
  try {
    const r = await fetch('/api/bildirishnoma');
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  notifItems = data.items;
  const fresh = notifKnown ? data.items.filter((n) => !n.oqilgan && !notifKnown.has(n.id)) : [];
  notifKnown = new Set(data.items.map((n) => n.id));
  renderBell(data.unread);
  if (!notifModal.classList.contains('hidden')) renderNotifList();
  if (fresh.length) {
    const n = fresh[0]; // eng yangisi
    showToast(`🔔 ${n.matn}${fresh.length > 1 ? ` (+${fresh.length - 1} ta yana)` : ''}`);
    systemNotify(n);
    await refresh(); // yangi zakaz jadvalda darhol ko'rinsin
  }
}
function renderNotifList() {
  document.getElementById('notifList').innerHTML = notifItems.length
    ? notifItems.map((n) => `<div class="notif-item ${n.oqilgan ? '' : 'unread'}" data-nid="${n.id}">
        <div class="notif-title">${n.oqilgan ? '' : '<span class="notif-dot"></span>'}${escapeHtml(n.matn)}</div>
        <div class="sk-muted">${escapeHtml(n.tafsilot)}</div>
        <div class="sk-muted">${fmtCreated(n.vaqt)}${n.kim ? ` · ${escapeHtml(n.kim)}` : ''}</div>
      </div>`).join('')
    : '<div class="empty-day">Hozircha bildirishnoma yo\'q</div>';
}
async function markNotifsRead(ids) {
  await fetch('/api/bildirishnoma/oqildi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids ? { ids } : {}) }).catch(() => {});
  await pollNotifs();
}
async function openLoadFromNotif(n) {
  let l = loads.find((x) => x.id === n.loadId);
  if (!l) { await refresh(); l = loads.find((x) => x.id === n.loadId); }
  if (!l) { showToast("Bu zakaz topilmadi (o'chirilgan bo'lishi mumkin)", true); return; }
  closeModals();
  const [y, m, d] = l.sana.split('-').map(Number);
  currentStart = new Date(y, m - 1, d);
  renderWeekLabel();
  renderBoard();
  openViewModal(l);
}
bellBtn.onclick = async () => {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* mayli */ }
  await pollNotifs();
  renderNotifList();
  notifModal.classList.remove('hidden');
};
document.getElementById('notifList').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-nid]');
  if (!el) return;
  const n = notifItems.find((x) => x.id === el.dataset.nid);
  if (!n) return;
  if (!n.oqilgan) { n.oqilgan = true; markNotifsRead([n.id]); }
  await openLoadFromNotif(n);
});
document.getElementById('notifReadAll').onclick = () => markNotifsRead(null);
notifModal.addEventListener('click', (e) => { if (e.target === notifModal) closeModals(); });
function initNotifs() {
  bellBtn.style.display = '';
  pollNotifs();
  setInterval(pollNotifs, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNotifs(); });
}

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
  const title = loadTitle(l) || 'Zakaz';
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

// ============================================================
//  SOTUVCHILAR (do'kon): login-parol berish — faqat egasi
// ============================================================
async function fetchSellers() { sellerList = isOwner() ? await (await fetch('/api/sotuvchilar')).json() : []; }
function renderSellerList() {
  const box = document.getElementById('teamSellerList');
  box.innerHTML = sellerList.length ? sellerList.map((u) => `<div class="team-item team-row"><div><b>${escapeHtml(u.name)}</b> <span class="muted">${escapeHtml(u.login)}${u.active ? '' : " · to'xtatilgan"}</span><div class="muted">${u.perms.add ? "zakaz qo'sha oladi" : "zakaz qo'shishga ruxsat yo'q"}</div></div><button class="ghost-btn small-btn" data-seller-edit="${u.id}">Tahrirlash</button></div>`).join('')
    : `<div class="empty-day">Hali sotuvchi qo'shilmagan</div>`;
}
const sellerModal = document.getElementById('sellerModal');
let editingSellerId = null;
function openSellerModal(u) {
  editingSellerId = u ? u.id : null;
  document.getElementById('sellerModalTitle').textContent = u ? 'Sotuvchini tahrirlash' : 'Yangi sotuvchi';
  document.getElementById('se_name').value = u ? u.name : '';
  document.getElementById('se_login').value = u ? u.login : '';
  document.getElementById('se_password').value = '';
  document.getElementById('se_password').placeholder = u ? "o'zgartirish uchun yangi parol yozing" : 'kamida 6 belgi';
  document.getElementById('se_perm_add').checked = u ? u.perms.add : true;
  document.getElementById('se_active').checked = u ? u.active : true;
  document.getElementById('se_active_row').style.display = u ? '' : 'none';
  document.getElementById('sellerDeleteBtn').style.display = u ? '' : 'none';
  document.getElementById('sellerError').textContent = '';
  teamModal.classList.add('hidden');
  sellerModal.classList.remove('hidden');
}
document.getElementById('teamAddSellerBtn').onclick = () => openSellerModal(null);
document.getElementById('teamSellerList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-seller-edit]')?.dataset.sellerEdit;
  if (id) openSellerModal(sellerList.find((u) => u.id === id));
});
document.getElementById('sellerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('sellerError');
  err.textContent = '';
  const body = {
    name: document.getElementById('se_name').value.trim(),
    login: document.getElementById('se_login').value.trim(),
    perms: { add: document.getElementById('se_perm_add').checked },
  };
  const pw = document.getElementById('se_password').value;
  try {
    if (editingSellerId) {
      if (pw) body.password = pw;
      body.active = document.getElementById('se_active').checked;
      await apiJson(`/api/sotuvchilar/${editingSellerId}`, 'PUT', body);
    } else {
      body.password = pw;
      await apiJson('/api/sotuvchilar', 'POST', body);
    }
    await fetchSellers();
    sellerModal.classList.add('hidden');
    renderTeamModal();
    showToast('Sotuvchi saqlandi ✓');
  } catch (ex) { err.textContent = ex.message; }
});
document.getElementById('sellerDeleteBtn').onclick = async () => {
  if (!editingSellerId || !confirm("Bu sotuvchini o'chirasizmi? U darhol tizimdan chiqib ketadi. Avval qabul qilingan zakaz va zalog yozuvlari saqlanib qoladi.")) return;
  try {
    await callWithCode(`/api/sotuvchilar/${editingSellerId}`, 'DELETE', null, 'delete');
    await fetchSellers();
    sellerModal.classList.add('hidden');
    renderTeamModal();
    showToast("Sotuvchi o'chirildi");
  } catch (ex) { document.getElementById('sellerError').textContent = ex.message; }
};
sellerModal.addEventListener('click', (e) => { if (e.target === sellerModal) closeModals(); });

// ============================================================
//  KUTILAYOTGAN ZAKAZLAR (sotuvchilardan): tekshirish -> ✔ yoki tahrirlab ✔
// ============================================================
const pendingBtn = document.getElementById('pendingBtn');
const pendingBadge = document.getElementById('pendingBadge');
let pendingKnown = null;
let pendingItems = [];
let viewingPending = null;

async function pollPending() {
  if (!isOwner()) return;
  try {
    const { count } = await apiJson('/api/pending/count', 'GET');
    pendingBadge.textContent = count > 99 ? '99+' : String(count);
    pendingBadge.classList.toggle('hidden', !count);
    if (pendingKnown !== null && count > pendingKnown) showToast(`📥 Tasdiqlash uchun yangi zakaz keldi (jami ${count} ta)`);
    pendingKnown = count;
    if (!document.getElementById('pendingModal').classList.contains('hidden')) await loadPendingList();
  } catch { /* tarmoq xatosi — keyingi safar */ }
}
function initPending() {
  pendingBtn.style.display = '';
  pollPending();
  setInterval(pollPending, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPending(); });
}
async function loadPendingList() {
  pendingItems = await apiJson('/api/pending', 'GET');
  const box = document.getElementById('pendingList');
  box.innerHTML = pendingItems.length ? pendingItems.map((p) => {
    const items = (p.skladItems || []).slice(0, 3).map((i) => `${i.model} ×${i.soni}`).join(', ') + ((p.skladItems || []).length > 3 ? ` +${p.skladItems.length - 3}` : '');
    return `<div class="team-item team-row pend-row" data-pid="${p.id}" style="cursor:pointer"><div><b>${escapeHtml(p.nomi || items || '—')}</b> <span class="muted">${escapeHtml(p.kategoriya?.nomi || '')}</span><div class="muted">🛍 ${escapeHtml(p.sotuvchi?.ism || '')} · 📅 ${escapeHtml(p.sana)} · 🕒 ${escapeHtml(fmtCreated(p.createdAt))}${p.zalogSumma ? ` · 💵 ${fmtMoney(p.zalogSumma)}` : ''}</div>${items ? `<div class="muted">📦 ${escapeHtml(items)}</div>` : ''}</div><span class="ghost-btn small-btn">Ochish ›</span></div>`;
  }).join('') : `<div class="empty-day">Hozircha kutilayotgan zakaz yo'q 🎉</div>`;
}
pendingBtn.onclick = async () => {
  try { await loadPendingList(); } catch (err) { showToast(err.message, true); return; }
  document.getElementById('pendingModal').classList.remove('hidden');
};
document.getElementById('pendingModal').addEventListener('click', (e) => {
  if (e.target.id === 'pendingModal') { closeModals(); return; }
  const id = e.target.closest('[data-pid]')?.dataset.pid;
  if (id) openPendingView(pendingItems.find((p) => p.id === id));
});
document.getElementById('pendingViewModal').addEventListener('click', (e) => { if (e.target.id === 'pendingViewModal') document.getElementById('pendingViewModal').classList.add('hidden'); });
document.querySelector('#pendingViewModal .pv-close').onclick = () => document.getElementById('pendingViewModal').classList.add('hidden');

function openPendingView(p) {
  if (!p) return;
  viewingPending = p;
  const addr = [p.manzil?.hudud, p.manzil?.dom ? `dom ${p.manzil.dom}` : '', p.manzil?.padyez ? `${p.manzil.padyez}-padyez` : '', p.manzil?.etaj ? `${p.manzil.etaj}-etaj` : ''].filter(Boolean).join(', ') || '—';
  const row = (k, v) => `<div class="view-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  document.getElementById('pvTitle').textContent = p.nomi || (p.skladItems || []).map((i) => i.model).join(', ') || 'Zakaz';
  document.getElementById('pvBody').innerHTML = `
    <div class="view-created">🛍 Sotuvchi: <b>${escapeHtml(p.sotuvchi?.ism || '—')}</b> · 🕒 ${fmtCreated(p.createdAt)}</div>
    ${row("Jo'natish sanasi", escapeHtml(p.sana))}
    ${row('Kategoriya', escapeHtml(p.kategoriya?.nomi || '—'))}
    ${row('Nomi', escapeHtml(p.nomi || '—'))}
    ${p.matras?.bor ? row('Matras', escapeHtml(p.matras.turi)) : ''}
    ${row('Yuklar', (p.skladItems || []).length ? p.skladItems.map((i) => `${YON_ICON[i.yonalish] || '📦'} ${i.yonalish === 'matras' ? '' : `${escapeHtml(i.kategoriya)} · `}<b>${escapeHtml(i.model)}</b> × ${i.soni}${i.fromModel ? ` <span class="sk-muted">(${escapeHtml(i.fromModel)} uchun)</span>` : ''}`).join('<br>') : '<span class="sk-muted">Yuk tanlanmagan (faqat tavsif)</span>')}
    ${row('Manzil', escapeHtml(addr))}
    ${row('Astatka', `${fmtMoney(p.astatka)} so'm`)}
    ${p.zalogSumma ? row('💵 Zalog', `<b>${fmtMoney(p.zalogSumma)} so'm</b>${p.zalogIzoh ? `<br><span class="muted">${escapeHtml(p.zalogIzoh)}</span>` : ''}${p.kunSana ? `<br><span class="muted">${escapeHtml(p.kunSana)}</span>` : ''}`) : ''}
    ${row('1-telefon', escapeHtml(p.tel1 || '—'))}
    ${row('2-telefon', escapeHtml(p.tel2 || '—'))}
    ${row('Filial', escapeHtml(p.filial?.nomi || '—'))}
    ${p.izoh ? row('📝 Tavsif', escapeHtml(p.izoh)) : ''}
  `;
  document.getElementById('pendingViewModal').classList.remove('hidden');
}

document.getElementById('pvApproveBtn').onclick = async () => {
  const p = viewingPending;
  if (!p) return;
  try {
    await withStockConfirm((force) => callWithCode(`/api/pending/${p.id}/approve`, 'POST', { force }));
    showToast("✔ Zakaz tasdiqlandi va jadvalga qo'shildi");
    document.getElementById('pendingViewModal').classList.add('hidden');
    await refresh();
    await pollPending();
    await loadPendingList();
  } catch (err) { showToast(err.message, true); }
};
document.getElementById('pvRejectBtn').onclick = async () => {
  const p = viewingPending;
  if (!p) return;
  const sabab = prompt('Rad etish sababi (sotuvchiga ko\'rinadi, ixtiyoriy):');
  if (sabab === null) return;
  try {
    await apiJson(`/api/pending/${p.id}/reject`, 'POST', { sabab });
    showToast('Zakaz rad etildi');
    document.getElementById('pendingViewModal').classList.add('hidden');
    await pollPending();
    await loadPendingList();
  } catch (err) { showToast(err.message, true); }
};
document.getElementById('pvEditBtn').onclick = () => {
  const p = viewingPending;
  if (!p) return;
  const pseudo = {
    kategoriya: p.kategoriya, nomi: p.nomi, matras: p.matras, izoh: p.izoh, sana: p.sana, holat: 'qizil',
    manzil: p.manzil, astatka: p.astatka, tel1: p.tel1, tel2: p.tel2, filial: p.filial, zborshik: null, labo: null,
    mijoz: p.mijoz, skladItems: p.skladItems, zalog: p.zalogSumma ? { summa: p.zalogSumma, izoh: p.zalogIzoh, sana: p.kunSana, filial: p.zalogFilialId ? { id: p.zalogFilialId } : (p.filial || null) } : null,
  };
  openEditModal(pseudo);               // formani to'ldiradi (va boshqa oynalarni yopadi)
  editingId = null;
  editingPendingId = p.id;             // closeModals() uni tozalaydi, shuning uchun shu yerda o'rnatamiz
  document.getElementById('formModalTitle').textContent = `Tekshirish va tasdiqlash — sotuvchi: ${p.sotuvchi?.ism || ''}`;
  document.getElementById('formSubmitBtn').textContent = '✔ Tahrirlab tasdiqlash';
};

// ============================================================
//  HISOBOT: 1 haftalik MATRAS (qaysi matras qancha kerak bo'ldi, qancha ketdi, skladda qancha qoldi) + chop etish
//  Faqat matras hisoblanadi. Mebel modellari hisobga kirmaydi.
// ============================================================
function matrasWeekData(from, to) {
  const models = new Map();
  const orders = [];
  const dayKeys = [];
  for (let d = new Date(`${from}T00:00:00`); toISO(d) <= to && dayKeys.length < 62; d = addDays(d, 1)) dayKeys.push(toISO(d));
  loads.forEach((l) => {
    if (!l.sana || l.sana < from || l.sana > to) return;
    const sent = l.holat === 'yashil';
    (l.skladItems || []).filter((i) => i.yonalish === 'matras').forEach((i) => {
      if (!models.has(i.modelId)) {
        const m = sklad.models.find((x) => x.id === i.modelId);
        models.set(i.modelId, { model: i.model, jami: 0, ketdi: 0, qoldi: 0, zakaz: 0, skladda: m ? (Number(m.qoldiq) || 0) : null, days: {} });
      }
      const r = models.get(i.modelId);
      r.jami += i.soni; r.zakaz += 1;
      if (sent) r.ketdi += i.soni; else r.qoldi += i.soni;
      const dd = r.days[l.sana] || (r.days[l.sana] = { jami: 0, ketdi: 0 });
      dd.jami += i.soni; if (sent) dd.ketdi += i.soni;
      orders.push({ sana: l.sana, tartib: l.tartib || 0, nomi: l.nomi || '—', hudud: l.manzil?.hudud || '', filial: l.filial?.nomi || '', model: i.model, mebel: i.fromModel || '', soni: i.soni, sent });
    });
  });
  orders.sort((a, b) => a.sana.localeCompare(b.sana) || a.tartib - b.tartib || a.model.localeCompare(b.model));
  const rows = [...models.values()].sort((a, b) => b.jami - a.jami || a.model.localeCompare(b.model, undefined, { numeric: true }));
  const sum = rows.reduce((s, r) => ({ jami: s.jami + r.jami, ketdi: s.ketdi + r.ketdi, qoldi: s.qoldi + r.qoldi }), { jami: 0, ketdi: 0, qoldi: 0 });
  return { rows, orders, sum, dayKeys };
}
const matYetmaydi = (r) => (r.skladda === null ? r.qoldi : Math.max(0, r.qoldi - r.skladda));

function matrasWeekTables(d, forPrint) {
  const cls = forPrint ? 'print-table' : 'report-table';
  const sumRows = d.rows.map((r) => {
    const kam = matYetmaydi(r);
    return `<tr><td><b>${escapeHtml(r.model)}</b></td><td class="mono">${r.zakaz}</td><td class="mono">${r.jami}</td><td class="mono">${r.ketdi}</td><td class="mono">${r.qoldi}</td><td class="mono"><b>${r.skladda === null ? '—' : r.skladda}</b>${kam ? ` <span class="${forPrint ? '' : 'sk-bad'}">⚠ ${kam} yetmaydi</span>` : ''}</td></tr>`;
  }).join('');
  // Kunlar bo'yicha: har bir matras har kuni nechta ketdi (kerak)
  const showDays = d.dayKeys.length <= 14 && d.rows.length > 0;
  const dayHead = d.dayKeys.map((k) => `<th>${DAY_NAMES_BY_DOW[new Date(`${k}T00:00:00`).getDay()].slice(0, 3)}<br><span class="muted">${k.slice(5)}</span></th>`).join('');
  const dayRows = d.rows.map((r) => `<tr><td><b>${escapeHtml(r.model)}</b></td>${d.dayKeys.map((k) => { const x = r.days[k]; return `<td class="mono">${x ? `<b>${x.ketdi}</b><span class="muted"> / ${x.jami}</span>` : '<span class="muted">·</span>'}</td>`; }).join('')}</tr>`).join('');
  const orderRows = d.orders.map((o) => `<tr><td>${escapeHtml(o.sana)}</td><td>${escapeHtml(o.nomi)}${o.filial ? `<br><span class="muted">${escapeHtml(o.filial)}</span>` : ''}</td><td>${escapeHtml(o.hudud || '—')}</td><td>${escapeHtml(o.model)}</td><td class="mono">${o.soni}</td><td>${o.sent ? '✅ Ketdi' : '📋 Kerak'}</td></tr>`).join('');
  return `
    <table class="${cls}"><thead><tr><th>Matras</th><th>Zakazlar</th><th>Jami kerak</th><th>Ketdi</th><th>Hali ketmagan</th><th>Skladda qoldi</th></tr></thead>
      <tbody>${sumRows || '<tr><td colspan="6">Bu davrda matras yozilgan zakaz yo\'q</td></tr>'}</tbody>
      ${d.rows.length ? `<tfoot><tr><td><b>Jami</b></td><td></td><td class="mono"><b>${d.sum.jami}</b></td><td class="mono"><b>${d.sum.ketdi}</b></td><td class="mono"><b>${d.sum.qoldi}</b></td><td></td></tr></tfoot>` : ''}
    </table>
    ${showDays ? `<h4 style="margin:16px 0 6px">Kunlar bo'yicha: ketdi / kerak</h4>
    <div class="${forPrint ? '' : 'report-scroll'}"><table class="${cls}"><thead><tr><th>Matras</th>${dayHead}</tr></thead><tbody>${dayRows}</tbody></table></div>` : ''}
    ${d.orders.length ? `<h4 style="margin:16px 0 6px">Qaysi zakazga qaysi matras</h4>
    <div class="${forPrint ? '' : 'report-scroll'}"><table class="${cls}"><thead><tr><th>Sana</th><th>Zakaz</th><th>Hudud</th><th>Matras</th><th>Soni</th><th>Holat</th></tr></thead><tbody>${orderRows}</tbody></table></div>` : ''}`;
}

function renderMatrasWeek() {
  const box = document.getElementById('matrasMonthReport');
  if (!box) return;
  const prev = { from: document.getElementById('matFrom')?.value, to: document.getElementById('matTo')?.value };
  const from = prev.from || toISO(addDays(new Date(), -6));
  const to = prev.to || toISO(new Date());
  const d = matrasWeekData(from, to);
  const span = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
  box.innerHTML = `
    <div class="report-print-head">
      <h3 class="report-subhead" style="margin:0;">🛏 Matras — 1 haftalik hisobot</h3>
      <button class="ghost-btn small-btn" id="matPrintBtn">🖨️ Chop etish</button>
    </div>
    <div class="mat-presets">
      <button type="button" class="sk-tab ${span === 7 ? 'active' : ''}" data-days="7">1 hafta</button>
      <button type="button" class="sk-tab ${span === 14 ? 'active' : ''}" data-days="14">2 hafta</button>
      <button type="button" class="sk-tab ${span === 30 ? 'active' : ''}" data-days="30">1 oy</button>
    </div>
    <div class="quick-assign-row" style="margin:8px 0">
      <label>Qaysi sanadan<input type="date" id="matFrom" value="${from}" /></label>
      <label>Qaysi sanagacha<input type="date" id="matTo" value="${to}" /></label>
    </div>
    <div class="sk-stats">
      <div class="sk-stat need"><b>${d.sum.jami}</b><span>Jami kerak bo'ldi</span></div>
      <div class="sk-stat go"><b>${d.sum.ketdi}</b><span>Ketdi</span></div>
      <div class="sk-stat"><b>${d.sum.qoldi}</b><span>Hali ketmagan</span></div>
    </div>
    <div class="report-scroll">${matrasWeekTables(d, false)}</div>
    <p class="report-note">Standart: oxirgi 7 kun. «Jami kerak» — shu kunlarga yozilgan matraslar, «Ketdi» — «Yuborildi» bo'lganlari, «Hali ketmagan» — hali yuborilmaganlari, «Skladda qoldi» — hozirgi sklad qoldig'i. Faqat matras hisoblanadi, mebel modellari hisobga kirmaydi.</p>`;
  document.getElementById('matFrom').onchange = renderMatrasWeek;
  document.getElementById('matTo').onchange = renderMatrasWeek;
  box.querySelectorAll('[data-days]').forEach((b) => {
    b.onclick = () => {
      document.getElementById('matTo').value = toISO(new Date());
      document.getElementById('matFrom').value = toISO(addDays(new Date(), -(Number(b.dataset.days) - 1)));
      renderMatrasWeek();
    };
  });
  document.getElementById('matPrintBtn').onclick = () => {
    const f = document.getElementById('matFrom').value; const t = document.getElementById('matTo').value;
    const dd = matrasWeekData(f, t);
    document.getElementById('printArea').innerHTML = `<h1>🛏 Matras hisoboti</h1><p><b>${escapeHtml(f)} — ${escapeHtml(t)}</b></p>
      <p>Jami kerak: <b>${dd.sum.jami}</b> · Ketdi: <b>${dd.sum.ketdi}</b> · Hali ketmagan: <b>${dd.sum.qoldi}</b></p>${matrasWeekTables(dd, true)}`;
    window.print();
  };
}

// ============================================================
//  HISOBOT: ZALOG (faqat egasi) — sotuvchilar kesimida
// ============================================================
const zalogFilialName = (l) => l.zalog?.filial?.nomi || l.filial?.nomi || '— filial belgilanmagan —';
function zalogData(from, to, filialId) {
  const list = loads.filter((l) => l.zalog && l.zalog.summa && (l.zalog.sana || l.sana) >= from && (l.zalog.sana || l.sana) <= to
      && (!filialId || (l.zalog.filial?.id || l.filial?.id) === filialId))
    .sort((a, b) => String(a.zalog.sana || a.sana).localeCompare(String(b.zalog.sana || b.sana)));
  const bySeller = new Map();
  const byFilial = new Map();
  list.forEach((l) => {
    const name = l.sotuvchi?.ism || l.zalog.kim || 'Egasi';
    if (!bySeller.has(name)) bySeller.set(name, { name, soni: 0, jami: 0 });
    const r = bySeller.get(name); r.soni += 1; r.jami += Number(l.zalog.summa) || 0;
    const fn = zalogFilialName(l);
    if (!byFilial.has(fn)) byFilial.set(fn, { name: fn, soni: 0, jami: 0 });
    const q = byFilial.get(fn); q.soni += 1; q.jami += Number(l.zalog.summa) || 0;
  });
  const jami = list.reduce((sum, l) => sum + (Number(l.zalog.summa) || 0), 0);
  return { list, sellers: [...bySeller.values()].sort((a, b) => b.jami - a.jami), filiallar: [...byFilial.values()].sort((a, b) => b.jami - a.jami), jami };
}
function zalogTables(d, forPrint) {
  const cls = forPrint ? 'print-table' : 'report-table';
  const sumRows = (arr) => arr.map((r) => `<tr><td><b>${escapeHtml(r.name)}</b></td><td class="mono">${r.soni}</td><td class="mono">${fmtMoney(r.jami)}</td></tr>`).join('');
  const foot = (arr) => (arr.length ? `<tfoot><tr><td><b>Jami</b></td><td></td><td class="mono"><b>${fmtMoney(d.jami)}</b></td></tr></tfoot>` : '');
  const rows = d.list.map((l) => `<tr><td>${escapeHtml(l.zalog.sana || '')}</td><td><b>${escapeHtml(zalogFilialName(l))}</b></td><td>${escapeHtml(l.sotuvchi?.ism || l.zalog.kim || 'Egasi')}</td><td>${escapeHtml(l.mijoz || l.nomi || '—')}</td><td>${escapeHtml(l.sana)}</td><td class="mono">${fmtMoney(l.zalog.summa)}</td><td>${escapeHtml(l.zalog.izoh || '')}</td></tr>`).join('');
  return `
    <h4 style="margin:6px 0">🏬 Filiallar bo'yicha (qaysi filial zalog oldi)</h4>
    <table class="${cls}"><thead><tr><th>Filial</th><th>Zakazlar</th><th>Zalog yig'indisi</th></tr></thead>
      <tbody>${sumRows(d.filiallar) || '<tr><td colspan="3">Bu davrda zalog yo\'q</td></tr>'}</tbody>${foot(d.filiallar)}
    </table>
    <h4 style="margin:16px 0 6px">🛍 Sotuvchilar bo'yicha</h4>
    <table class="${cls}"><thead><tr><th>Sotuvchi</th><th>Zakazlar</th><th>Zalog yig'indisi</th></tr></thead>
      <tbody>${sumRows(d.sellers) || '<tr><td colspan="3">Bu davrda zalog yo\'q</td></tr>'}</tbody>${foot(d.sellers)}
    </table>
    ${d.list.length ? `<h4 style="margin:16px 0 6px">Zalog yozuvlari</h4><div class="${forPrint ? '' : 'report-scroll'}"><table class="${cls}"><thead><tr><th>Zalog sanasi</th><th>Zalog olgan filial</th><th>Sotuvchi</th><th>Mijoz / zakaz</th><th>Jo'natish</th><th>Summa</th><th>Izoh</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
}
function renderZalogReport() {
  const box = document.getElementById('zalogReport');
  if (!box || !isOwner()) return;
  const from = document.getElementById('zalFrom')?.value || toISO(addDays(new Date(), -29));
  const to = document.getElementById('zalTo')?.value || toISO(new Date());
  const fil = document.getElementById('zalFilial')?.value || '';
  const d = zalogData(from, to, fil);
  const filName = fil ? (filiallar.find((f) => f.id === fil)?.nomi || '') : 'Hamma filiallar';
  box.innerHTML = `
    <div class="report-print-head">
      <h3 class="report-subhead" style="margin:0;">💵 Zalog hisoboti (filial va sotuvchilar)</h3>
      <button class="ghost-btn small-btn" id="zalPrintBtn">🖨️ Chop etish</button>
    </div>
    <div class="quick-assign-row" style="margin:8px 0">
      <label>🏬 Filial
        <select id="zalFilial"><option value="">Hamma filiallar</option>${filiallar.map((f) => `<option value="${f.id}" ${f.id === fil ? 'selected' : ''}>${escapeHtml(f.nomi)}</option>`).join('')}</select>
      </label>
      <label>Qaysi sanadan<input type="date" id="zalFrom" value="${from}" /></label>
      <label>Qaysi sanagacha<input type="date" id="zalTo" value="${to}" /></label>
    </div>
    <div class="report-scroll">${zalogTables(d, false)}</div>
    <p class="report-note">Zalog zakazning jo'natish kuniga emas, balki zalog kiritilgan (olingan) kunga yoziladi. «Zalogni qaysi filial oldi» zakaz formasida tanlanadi (standart — zakaz filiali). Zalog olinmagan zakazlar bu hisobotda ko'rinmaydi. Bu ma'lumotni xodimlar, zborshik va shafyorlar ko'rmaydi. Excel faylda ham «Zalog» varag'i bor.</p>`;
  document.getElementById('zalFrom').onchange = renderZalogReport;
  document.getElementById('zalTo').onchange = renderZalogReport;
  document.getElementById('zalFilial').onchange = renderZalogReport;
  document.getElementById('zalPrintBtn').onclick = () => {
    const f = document.getElementById('zalFrom').value; const t = document.getElementById('zalTo').value;
    const fl = document.getElementById('zalFilial').value;
    const dd = zalogData(f, t, fl);
    document.getElementById('printArea').innerHTML = `<h1>💵 Zalog hisoboti</h1><p><b>${escapeHtml(f)} — ${escapeHtml(t)} · ${escapeHtml(filName)}</b></p>${zalogTables(dd, true)}`;
    window.print();
  };
}

// ---------------- Boot ----------------
async function refresh() { await Promise.all([fetchLoads(), fetchSklad().catch(() => {})]); renderWeekLabel(); renderBoard(); }
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
  if (me.role === 'labo') { location.href = '/labo.html'; return; }
  if (me.role === 'sotuvchi') { location.href = '/sotuvchi.html'; return; }
  document.getElementById('userName').textContent = `${me.name}${isOwner() ? ' (egasi)' : ''}`;
  if (me.role === 'ishchi') initNotifs(); // bildirishnomalar faqat xodimlarga
  if (!hasPerm('add')) {
    document.getElementById('addLoadTopBtn').style.display = 'none';
  }
  await fetchTaxonomy();
  await fetchZborshiklar();
  await fetchLabolar();
  await fetchFiliallar();
  await fetchStaff();
  await fetchSellers();
  await fetchSklad().catch(() => {});
  populateCategories('');
  populateZborshiklar(zborshikSelect, '');
  populateLabolar(laboSelect, '');
  populateFiliallar(filialSelect, '');
  await refresh();
  if (isOwner()) initPending(); // sotuvchilardan kelgan zakazlar faqat egasiga
  if (isOwner()) { const s = document.createElement('script'); s.src = '/owner-extra.js'; document.head.appendChild(s); } // faqat egasiga beriladigan qo'shimcha bo'limlar
}
boot().catch(() => showToast('Serverga ulanishda xatolik', true));
