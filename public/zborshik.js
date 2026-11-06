const HOLAT_LABEL = { qizil: '🔴 Hali tayyor emas', sariq: '🟡 Yuklanmoqda', yashil: '🟢 Yuborildi' };
const DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const money = (n) => Number(n || 0).toLocaleString('ru-RU');
const tel = (n) => (n ? `<a href="tel:${esc(String(n).replace(/[^\d+]/g, ''))}">${esc(n)}</a>` : '—');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}

function card(l) {
  const addr = [l.manzil?.hudud, l.manzil?.dom ? `dom ${l.manzil.dom}` : '', l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '', l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : ''].filter(Boolean).join(', ');
  const row = (k, v, cls = '') => `<div class="zb-row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const tolov = l.tolandi ? "To'liq to'langan" : ((l.jamiTolangan || 0) > 0 ? `Qisman (${money(l.jamiTolangan)} so'm)` : "To'lanmagan");
  return `
    <div class="zb-card ${esc(l.holat)}">
      <div class="zb-title">${esc(l.nomi || '—')}</div>
      <div class="zb-cat">${esc(l.kategoriya?.nomi || '')}${l.matras?.bor ? ` · 🛏 ${esc(l.matras.turi)}` : ''}</div>
      ${row('Holat', HOLAT_LABEL[l.holat] || esc(l.holat))}
      ${row('Manzil', esc(addr || '—'))}
      ${row('Telefon 1', tel(l.tel1), 'mono')}
      ${l.tel2 ? row('Telefon 2', tel(l.tel2), 'mono') : ''}
      ${row('Astatka', `${money(l.astatka)} so'm`, 'mono')}
      ${row("To'lov", esc(tolov))}
      ${(l.jamiTolangan || 0) > 0 && !l.tolandi ? row('Qoldiq', `${money(l.qoldiq)} so'm`, 'mono') : ''}
      ${l.filial?.nomi ? row('Filial', esc(l.filial.nomi)) : ''}
      ${l.labo ? row('Labo', `${esc(l.labo.raqami)} · ${esc(l.labo.haydovchi || '')}<br>${tel(l.labo.telefon)}`) : ''}
      ${l.izoh ? row('Izoh', esc(l.izoh)) : ''}
    </div>`;
}

function group(list) {
  const map = new Map();
  list.forEach((l) => { if (!map.has(l.sana)) map.set(l.sana, []); map.get(l.sana).push(l); });
  return [...map.entries()];
}

async function load() {
  const res = await fetch('/api/my-loads');
  if (res.status === 401) { location.href = '/'; return; }
  const loads = await res.json();
  const today = todayISO();
  const upcoming = loads.filter((l) => l.sana >= today);
  const past = loads.filter((l) => l.sana < today).sort((a, b) => b.sana.localeCompare(a.sana)).slice(0, 40);

  let html = '';
  if (!upcoming.length) html += `<div class="zb-empty">Hozircha sizga biriktirilgan zakaz yo'q.<br>Yangi zakaz biriktirilsa, shu yerda ko'rinadi.</div>`;
  group(upcoming).forEach(([iso, items]) => {
    html += `<div class="zb-day ${iso === today ? 'today' : ''}">${iso === today ? 'Bugun · ' : ''}${esc(dayLabel(iso))} · ${items.length} ta</div>${items.map(card).join('')}`;
  });
  if (past.length) {
    html += `<details class="zb-old"><summary>Oldingi zakazlar (${past.length})</summary>${group(past).map(([iso, items]) => `<div class="zb-day">${esc(dayLabel(iso))}</div>${items.map(card).join('')}`).join('')}</details>`;
  }
  $('zbList').innerHTML = html;
}

$('refreshBtn').onclick = () => load();
$('logoutBtn').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/'; };

(async function boot() {
  const me = await fetch('/api/auth/me');
  if (!me.ok) { location.href = '/'; return; }
  const u = await me.json();
  if (u.role !== 'zborshik') { location.href = '/'; return; }
  $('zbName').textContent = u.name;
  await load();
  setInterval(load, 60000); // har daqiqada yangilanadi
})();
