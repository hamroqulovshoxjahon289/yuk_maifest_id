// Sotuvchi (do'kon) sahifasi: zakaz yuboradi (zalog bilan), egasi tasdiqlaydi
const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const money = (n) => Number(n || 0).toLocaleString('ru-RU');
const HOLAT_LABEL = { qizil: '🔴 Hali tayyor emas', sariq: '🟡 Yuklanmoqda', yashil: '🟢 Yuborildi' };
const YON_ICON = { matras: '🛏', mebel: '🛋', zapchast: '🔧' };
const DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

const _fetch = window.fetch.bind(window);
window.fetch = async (...a) => { const r = await _fetch(...a); if (r.status === 401) location.href = '/'; return r; };

let me = null;
let meta = { categories: [], matrasCategories: [], matrasTypes: [], filiallar: [], sklad: { yonalishlar: [], categories: [], models: [] }, perms: {} };
let orders = { pending: [], rejected: [], accepted: [] };
let editingId = null;
let items = [];
let pickYon = 'mebel';

async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 6000 : 3000);
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return iso || '—';
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}
function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

// ---------- Ro'yxat ----------
function itemsHtml(list) {
  if (!(list || []).length) return '<span class="muted">—</span>';
  return `<div class="s-items">${list.map((i) => `<div>${YON_ICON[i.yonalish] || '📦'} ${i.yonalish === 'matras' || !i.kategoriya ? '' : `${esc(i.kategoriya)} · `}<b>${esc(i.model)}</b> × ${i.soni}</div>`).join('')}</div>`;
}
function orderCard(o, kind) {
  const addr = [o.manzil?.hudud, o.manzil?.dom ? `dom ${o.manzil.dom}` : '', o.manzil?.padyez ? `${o.manzil.padyez}-padyez` : '', o.manzil?.etaj ? `${o.manzil.etaj}-etaj` : ''].filter(Boolean).join(', ');
  const zalogSum = kind === 'acc' ? o.zalog?.summa : o.zalogSumma;
  const zalogNote = kind === 'acc' ? o.zalog?.izoh : o.zalogIzoh;
  const row = (k, v, cls = '') => `<div class="zb-row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const when = kind === 'acc' ? `Yuborilgan: ${fmtTime(o.createdAt)}` : fmtTime(o.yangilandi || o.createdAt);
  return `<div class="zb-card s-card ${kind}" data-id="${esc(o.id)}">
    <div class="zb-title">${esc(o.nomi || '—')}</div>
    <div class="zb-cat">${esc(o.kategoriya?.nomi || '')} · 🕒 ${esc(when)}</div>
    ${kind === 'acc' ? row('Holat', HOLAT_LABEL[o.holat] || esc(o.holat)) : ''}
    ${row("Jo'natish sanasi", esc(dayLabel(o.sana)))}
    ${row('Mahsulotlar', itemsHtml(o.skladItems))}
    ${row('Manzil', esc(addr || '—'))}
    ${row('Astatka', `${money(o.astatka)} so'm`, 'mono')}
    ${zalogSum ? row('💵 Zalog', `<span class="s-zalog">${money(zalogSum)} so'm</span>${zalogNote ? `<div class="muted">${esc(zalogNote)}</div>` : ''}`) : ''}
    ${row('Telefon', esc([o.tel1, o.tel2].filter(Boolean).join(' · ') || '—'), 'mono')}
    ${o.filial?.nomi ? row('Filial', esc(o.filial.nomi)) : ''}
    ${o.izoh ? row('Izoh', esc(o.izoh)) : ''}
    ${kind === 'rad' ? `<div class="s-reason">❌ Egasi rad etdi${o.radSababi ? `: ${esc(o.radSababi)}` : ''}</div>` : ''}
    ${kind === 'pend' || kind === 'rad' ? `<div class="s-btns">
      <button class="ghost-btn small-btn" data-edit="${esc(o.id)}">${kind === 'rad' ? '✏️ Tuzatib qayta yuborish' : '✏️ Tahrirlash'}</button>
      <button class="danger-btn small-btn" data-del="${esc(o.id)}">${kind === 'rad' ? "🗑 O'chirish" : '↩ Bekor qilish'}</button>
    </div>` : ''}
  </div>`;
}
function render() {
  const sumPend = orders.pending.reduce((s, o) => s + (o.zalogSumma || 0), 0);
  const sumAcc = orders.accepted.reduce((s, o) => s + (o.zalog?.summa || 0), 0);
  $('sMain').innerHTML = `
    <div class="s-stats">
      <div class="s-stat"><b>${orders.pending.length}</b><span>Tasdiqlanmoqda</span></div>
      <div class="s-stat zal"><b>${money(sumAcc)}</b><span>Qabul qilingan zalog</span></div>
      <div class="s-stat zal"><b>${money(sumPend)}</b><span>Kutilayotgan zalog</span></div>
    </div>
    ${orders.rejected.length ? `<div class="s-sec bad">❌ Rad etilgan (${orders.rejected.length})</div>${orders.rejected.map((o) => orderCard(o, 'rad')).join('')}` : ''}
    <div class="s-sec">⏳ Egasi tasdiqlashini kutmoqda (${orders.pending.length})</div>
    ${orders.pending.length ? orders.pending.map((o) => orderCard(o, 'pend')).join('') : '<div class="zb-empty">Hozircha kutilayotgan zakaz yo\'q</div>'}
    <div class="s-sec ok">✅ Qabul qilingan zakazlar (${orders.accepted.length})</div>
    ${orders.accepted.length ? orders.accepted.map((o) => orderCard(o, 'acc')).join('') : '<div class="zb-empty">Hali qabul qilingan zakaz yo\'q</div>'}`;
}
async function loadOrders() { orders = await api('/api/sotuvchi/orders'); render(); }

$('sMain').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit]')?.dataset.edit;
  const del = e.target.closest('[data-del]')?.dataset.del;
  if (ed) { const o = [...orders.pending, ...orders.rejected].find((x) => x.id === ed); if (o) openForm(o); }
  if (del) {
    if (!confirm('Bu zakazni olib tashlaysizmi?')) return;
    try { await api(`/api/sotuvchi/orders/${del}`, 'DELETE'); toast('Olib tashlandi'); await loadOrders(); } catch (err) { toast(err.message, true); }
  }
});

// ---------- Forma ----------
const catSel = $('o_kategoriya');
function fill(select, list, placeholder, valueFn, labelFn) {
  select.innerHTML = '';
  const ph = document.createElement('option'); ph.value = ''; ph.textContent = placeholder; ph.disabled = true; select.appendChild(ph);
  list.forEach((x) => { const o = document.createElement('option'); o.value = valueFn(x); o.textContent = labelFn(x); select.appendChild(o); });
  select.value = '';
}
const modelInfo = (id) => { const m = meta.sklad.models.find((x) => x.id === id); return m ? { m, c: meta.sklad.categories.find((c) => c.id === m.categoryId) } : null; };

function toggleMatras() {
  const cat = meta.categories.find((c) => c.id === catSel.value);
  const ok = !!cat && meta.matrasCategories.some((m) => m.toLowerCase() === cat.name.toLowerCase());
  $('o_matrasRow').style.display = ok ? '' : 'none';
  if (!ok) { $('o_matras_bor').checked = false; $('o_matrasTuriWrap').style.display = 'none'; }
}
catSel.addEventListener('change', toggleMatras);
$('o_matras_bor').addEventListener('change', () => { $('o_matrasTuriWrap').style.display = $('o_matras_bor').checked ? '' : 'none'; });

function fillPickModels() {
  const models = pickYon === 'matras'
    ? meta.sklad.models.filter((m) => meta.sklad.categories.find((c) => c.id === m.categoryId)?.yonalish === 'matras').sort((a, b) => a.nomi.localeCompare(b.nomi, undefined, { numeric: true }))
    : meta.sklad.models.filter((m) => m.categoryId === $('o_pickCat').value);
  fill($('o_pickModel'), models, models.length ? 'Modelni tanlang' : "Model yo'q", (m) => m.id, (m) => `${m.nomi} (skladda: ${m.qoldiq})`);
}
function renderPicker() {
  $('o_pickTabs').innerHTML = meta.sklad.yonalishlar.map((y) => `<button type="button" class="sk-tab ${y.id === pickYon ? 'active' : ''}" data-y="${y.id}">${YON_ICON[y.id] || ''} ${esc(y.nomi)}</button>`).join('');
  $('o_pickCatLabel').style.display = pickYon === 'matras' ? 'none' : '';
  const cats = meta.sklad.categories.filter((c) => c.yonalish === pickYon && !c.yashirin);
  fill($('o_pickCat'), cats, cats.length ? 'Kategoriyani tanlang' : "Kategoriya yo'q", (c) => c.id, (c) => c.nomi);
  fillPickModels();
  $('o_pickQty').value = 1;
  renderPicked();
}
function renderPicked() {
  $('o_picked').innerHTML = items.map((it, idx) => {
    const info = modelInfo(it.modelId);
    const name = info ? `${YON_ICON[info.c?.yonalish] || '📦'} ${info.c?.yonalish === 'matras' ? '' : `${esc(info.c?.nomi || '')} · `}${esc(info.m.nomi)}` : `${esc(it.model || '')} (o'chirilgan)`;
    return `<div class="sk-line"><span class="sk-name">${name}</span><input type="number" min="1" step="1" value="${it.soni}" data-pi="${idx}" /><button type="button" class="danger-btn small-btn" data-prm="${idx}">✕</button></div>`;
  }).join('');
}
$('o_pickTabs').addEventListener('click', (e) => { const y = e.target.closest('[data-y]')?.dataset.y; if (y) { pickYon = y; renderPicker(); } });
$('o_pickCat').addEventListener('change', fillPickModels);
$('o_pickAdd').onclick = () => {
  const info = modelInfo($('o_pickModel').value);
  const soni = Math.floor(Number($('o_pickQty').value));
  if (!info) { toast('Modelni tanlang', true); return; }
  if (!(soni > 0)) { toast('Sonini kiriting (1 dan boshlab)', true); return; }
  const ex = items.find((i) => i.modelId === info.m.id);
  if (ex) ex.soni += soni; else items.push({ modelId: info.m.id, soni, model: info.m.nomi });
  $('o_pickQty').value = 1; $('o_pickModel').value = '';
  renderPicked();
};
$('o_picked').addEventListener('click', (e) => { const i = e.target.closest('[data-prm]')?.dataset.prm; if (i !== undefined) { items.splice(Number(i), 1); renderPicked(); } });
$('o_picked').addEventListener('change', (e) => { const i = e.target.dataset.pi; if (i === undefined) return; const v = Math.floor(Number(e.target.value)); if (v > 0) items[Number(i)].soni = v; renderPicked(); });

function openForm(o) {
  if (!meta.perms.add) { toast("Sizda zakaz qo'shishga ruxsat yo'q. Egasidan so'rang.", true); return; }
  editingId = o ? o.id : null;
  $('orderForm').reset();
  $('orderModalTitle').textContent = o ? (o.status === 'rad' ? 'Zakazni tuzatib qayta yuborish' : 'Zakazni tahrirlash') : 'Yangi zakaz';
  $('orderSubmitBtn').textContent = o ? '📤 Saqlab egasiga yuborish' : '📤 Egasiga yuborish';
  fill(catSel, meta.categories, 'Kategoriyani tanlang', (c) => c.id, (c) => c.name);
  fill($('o_filial'), meta.filiallar, '— tanlanmagan —', (f) => f.id, (f) => f.nomi);
  fill($('o_matras_turi'), meta.matrasTypes.map((t) => ({ t })), '— tanlang —', (x) => x.t, (x) => x.t);
  $('o_matras_turi').value = meta.matrasTypes[0] || '';
  items = o ? (o.skladItems || []).map((i) => ({ modelId: i.modelId, soni: i.soni, model: i.model })) : [];
  pickYon = 'mebel';
  renderPicker();
  $('o_sana').value = o ? o.sana : todayISO();
  if (o) {
    catSel.value = o.kategoriya?.id || '';
    $('o_nomi').value = o.nomi || '';
    $('o_filial').value = o.filial?.id || '';
    toggleMatras();
    if (o.matras?.bor) { $('o_matras_bor').checked = true; $('o_matrasTuriWrap').style.display = ''; $('o_matras_turi').value = o.matras.turi || meta.matrasTypes[0]; }
    $('o_izoh').value = o.izoh || '';
    $('o_hudud').value = o.manzil?.hudud || ''; $('o_dom').value = o.manzil?.dom || '';
    $('o_padyez').value = o.manzil?.padyez || ''; $('o_etaj').value = o.manzil?.etaj || '';
    $('o_astatka').value = o.astatka || '';
    $('o_zalog').value = o.zalogSumma || ''; $('o_zalogIzoh').value = o.zalogIzoh || '';
    $('o_tel1').value = o.tel1 || ''; $('o_tel2').value = o.tel2 || '';
  } else { toggleMatras(); }
  $('orderError').textContent = '';
  $('orderModal').classList.remove('hidden');
}
function closeForm() { $('orderModal').classList.add('hidden'); }
document.querySelectorAll('.close-modal').forEach((b) => b.addEventListener('click', closeForm));
$('orderModal').addEventListener('click', (e) => { if (e.target === $('orderModal')) closeForm(); });
$('newOrderBtn').onclick = () => openForm(null);

$('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('orderError'); err.textContent = '';
  if (!catSel.value) { err.textContent = 'Kategoriyani tanlang'; return; }
  const send = items.filter((i) => modelInfo(i.modelId)).map((i) => ({ modelId: i.modelId, soni: i.soni }));
  if (send.length < items.length) toast("O'chirilgan sklad modellari olib tashlandi", true);
  if (!$('o_nomi').value.trim() && !send.length) { err.textContent = 'Nomini yozing yoki sklad mahsulotini tanlang'; return; }
  const body = {
    kategoriyaId: catSel.value,
    nomi: $('o_nomi').value.trim(),
    matras: { bor: $('o_matras_bor').checked, turi: $('o_matras_bor').checked ? $('o_matras_turi').value : null },
    filialId: $('o_filial').value || null,
    izoh: $('o_izoh').value.trim(),
    sana: $('o_sana').value,
    manzil: { hudud: $('o_hudud').value.trim(), dom: $('o_dom').value.trim(), padyez: $('o_padyez').value.trim(), etaj: $('o_etaj').value.trim() },
    astatka: $('o_astatka').value,
    zalogSumma: $('o_zalog').value,
    zalogIzoh: $('o_zalogIzoh').value.trim(),
    tel1: $('o_tel1').value.trim(),
    tel2: $('o_tel2').value.trim(),
    skladItems: send,
  };
  $('orderSubmitBtn').disabled = true;
  try {
    if (editingId) await api(`/api/sotuvchi/orders/${editingId}`, 'PUT', body);
    else await api('/api/sotuvchi/orders', 'POST', body);
    closeForm();
    toast('Zakaz egasiga yuborildi ✓');
    await loadOrders();
  } catch (ex) { err.textContent = ex.message; }
  finally { $('orderSubmitBtn').disabled = false; }
});

$('refreshBtn').onclick = () => loadOrders().then(() => toast('Yangilandi')).catch((e) => toast(e.message, true));
$('logoutBtn').onclick = async () => { await _fetch('/api/auth/logout', { method: 'POST' }); location.href = '/'; };

(async function boot() {
  try {
    const meRes = await _fetch('/api/auth/me');
    if (!meRes.ok) { location.href = '/'; return; }
    me = await meRes.json();
    if (me.role !== 'sotuvchi') { location.href = '/'; return; }
    $('sName').textContent = me.name;
    meta = await api('/api/sotuvchi/meta');
    if (!meta.perms.add) $('newOrderBtn').style.display = 'none';
    await loadOrders();
    // Egasi qaror qilganda ro'yxat o'zi yangilanadi
    setInterval(() => { if ($('orderModal').classList.contains('hidden')) loadOrders().catch(() => {}); }, 30000);
  } catch (err) { toast('Serverga ulanishda xatolik', true); }
})();
