// Kuzatuv jurnali interfeysi. Bu fayl faqat EGASI (admin) sessiyasiga beriladi (server: /owner-extra.js),
// shuning uchun xodimlar, zborshik, shafyor va sotuvchilar uni umuman yuklab ola olmaydi.
(function () {
  if (typeof isOwner !== 'function' || !isOwner()) return;
  const style = document.createElement('style');
  style.textContent = "\n/* ---------- Kuzatuv jurnali (yashirin, faqat egasi) ---------- */\n.audit-modal { max-width: 760px; }\n.au-tabs { display: flex; gap: 6px; margin-bottom: 14px; }\n.au-tab { flex: 1; padding: 9px 6px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text-dim); font-weight: 700; cursor: pointer; font-family: inherit; }\n.au-tab.active { background: var(--accent); color: #0b0d10; border-color: var(--accent); }\n.au-person { background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }\n.au-person.off { opacity: .65; }\n.au-person-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }\n.au-role { display: inline-block; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: var(--panel); border: 1px solid var(--border); color: var(--text-dim); margin-left: 6px; }\n.au-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--text-faint); margin-right: 6px; }\n.au-dot.on { background: var(--green); box-shadow: 0 0 8px var(--green); }\n.au-line { font-size: 12.5px; color: var(--text-dim); margin-top: 5px; }\n.au-line b { color: var(--text); }\n.au-warn { color: var(--red); font-weight: 800; }\n.au-devs { margin-top: 8px; font-size: 12px; color: var(--text-dim); }\n.au-devs summary { cursor: pointer; font-weight: 700; }\n.au-devs div { padding: 3px 0; border-bottom: 1px dashed var(--border); }\n.au-ev { background: var(--panel-2); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }\n.au-ev.danger { border-left-color: var(--red); background: #ff5c5c10; }\n.au-ev.quiet { border-left-color: var(--border); }\n.au-ev-top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 12px; color: var(--text-dim); }\n.au-ev-top .au-time { margin-left: auto; font-family: 'JetBrains Mono', monospace; }\n.au-text { font-weight: 700; margin-top: 4px; font-size: 14px; word-break: break-word; }\n.au-oz { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }\n.au-oz th, .au-oz td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border); vertical-align: top; word-break: break-word; }\n.au-oz th { color: var(--text-faint); font-size: 11px; text-transform: uppercase; }\n.au-oz .old { color: var(--red); text-decoration: line-through; text-decoration-color: #ff5c5c88; }\n.au-oz .new { color: var(--green); font-weight: 700; }\n.au-dev { font-size: 11.5px; color: var(--text-faint); margin-top: 6px; }\n";
  document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend', "<!-- ============ KUZATUV JURNALI (yashirin, faqat egasi, alohida kod bilan) ============ -->\n<div id=\"auditModal\" class=\"modal-overlay hidden\" style=\"z-index:1200\">\n  <div class=\"modal audit-modal\">\n    <div class=\"modal-head\">\n      <h2>\ud83d\udd75\ufe0f Kuzatuv jurnali</h2>\n      <button class=\"icon-btn\" id=\"auditCloseBtn\" type=\"button\">\u2715</button>\n    </div>\n    <div class=\"modal-body\">\n      <div id=\"auditGate\" class=\"hidden\">\n        <p class=\"muted-note\" id=\"auditGateText\"></p>\n        <div class=\"field-row\">\n          <label>Kuzatuv kodi\n            <input type=\"password\" id=\"auditCodeInput\" inputmode=\"numeric\" maxlength=\"8\" autocomplete=\"new-password\" placeholder=\"\u2022\u2022\u2022\u2022\" />\n          </label>\n        </div>\n        <div class=\"field-row\" id=\"auditCode2Row\" style=\"display:none\">\n          <label>Kodni takrorlang\n            <input type=\"password\" id=\"auditCodeInput2\" inputmode=\"numeric\" maxlength=\"8\" autocomplete=\"new-password\" placeholder=\"\u2022\u2022\u2022\u2022\" />\n          </label>\n        </div>\n        <p class=\"form-error\" id=\"auditGateError\"></p>\n        <div class=\"modal-actions\"><button type=\"button\" class=\"primary-btn\" id=\"auditGateBtn\">Ochish</button></div>\n      </div>\n      <div id=\"auditMain\" class=\"hidden\">\n        <div class=\"au-tabs\">\n          <button type=\"button\" class=\"au-tab active\" data-au=\"people\">\ud83d\udc65 Odamlar</button>\n          <button type=\"button\" class=\"au-tab\" data-au=\"log\">\ud83d\udd52 Jurnal</button>\n          <button type=\"button\" class=\"au-tab\" data-au=\"code\">\ud83d\udd10 Kod</button>\n        </div>\n        <div id=\"auditPeople\"></div>\n        <div id=\"auditLogPane\" class=\"hidden\">\n          <div class=\"field-row\">\n            <label>Kim\n              <select id=\"auFilterUser\"><option value=\"\">Hammasi</option></select>\n            </label>\n            <label>Nima\n              <select id=\"auFilterTur\">\n                <option value=\"\">Hammasi</option>\n                <option value=\"kirish\">Kirish / chiqish / faollik</option>\n                <option value=\"zakaz\">Zakazlar</option>\n                <option value=\"pul\">Pul</option>\n                <option value=\"sklad\">Sklad va suratlar</option>\n                <option value=\"jamoa\">Jamoa, kodlar, eksport</option>\n              </select>\n            </label>\n          </div>\n          <div class=\"field-row\">\n            <label>Qaysi sanadan<input type=\"date\" id=\"auFrom\" /></label>\n            <label>Qaysi sanagacha<input type=\"date\" id=\"auTo\" /></label>\n          </div>\n          <div class=\"field-row\">\n            <label>Qidirish (ism, zakaz, matn, IP)<input type=\"text\" id=\"auQ\" placeholder=\"masalan: Test yuk\" /></label>\n            <label class=\"checkbox-label\" style=\"align-self:flex-end\"><input type=\"checkbox\" id=\"auDanger\" /> Faqat xavfli amallar</label>\n          </div>\n          <button type=\"button\" class=\"ghost-btn small-btn\" id=\"auApplyBtn\">\ud83d\udd0e Ko'rsatish</button>\n          <div id=\"auditEvents\" style=\"margin-top:12px\"></div>\n          <button type=\"button\" class=\"ghost-btn small-btn hidden\" id=\"auMoreBtn\" style=\"margin-top:10px\">Yana yuklash</button>\n        </div>\n        <div id=\"auditCodePane\" class=\"hidden\">\n          <p class=\"muted-note\">Kuzatuv kodini faqat siz bilasiz. Kodni o'zgartirish uchun eskisini bilish shart emas, chunki siz hozir kod bilan kirgansiz. Kod 4\u20138 raqam.</p>\n          <div class=\"field-row\">\n            <label>Yangi kod<input type=\"password\" id=\"auNewCode\" inputmode=\"numeric\" maxlength=\"8\" autocomplete=\"new-password\" /></label>\n            <label>Takrorlang<input type=\"password\" id=\"auNewCode2\" inputmode=\"numeric\" maxlength=\"8\" autocomplete=\"new-password\" /></label>\n          </div>\n          <p class=\"form-error\" id=\"auCodeError\"></p>\n          <div class=\"modal-actions\"><button type=\"button\" class=\"primary-btn\" id=\"auCodeSaveBtn\">Kodni saqlash</button></div>\n        </div>\n      </div>\n    </div>\n  </div>\n</div>\n\n");

// ============================================================
//  KUZATUV JURNALI — yashirin, faqat egasi, alohida kod bilan
//  Ochish: logotipni (◈) 5 marta ketma-ket bosing yoki Ctrl+Alt+K
// ============================================================
const AU_ICON = { kirish: '🔑', kirish_xato: '🚫', chiqish: '🚪', faollik: '👀', yuk_qoshdi: '➕', yuk_tahrir: '✏️', yuk_ochirdi: '🗑', holat: '🚦', tayinlash: '🧰', tartib: '↕️', pul: '💰', pul_bekor: '⛔', sklad: '🏬', surat: '📷', jamoa: '👥', kod: '🔐', xavf: '⚠️', eksport: '📤', sotuvchi_zakaz: '🛍', sotuvchi_tahrir: '🛍✏️', sotuvchi_bekor: '🛍🗑', tasdiq: '✅', rad: '❌' };
const AU_QUIET = ['faollik', 'chiqish'];
let auditCode = ''; // kuzatuv kodi faqat xotirada, oyna yopilsa o'chadi
let auditTimer = null;
let auCursor = '';
let auPeopleCache = [];

(window.__closeHooks = window.__closeHooks || []).push(closeAudit);
const auModal = document.getElementById('auditModal');
function closeAudit() {
  if (!auModal) return;
  auModal.classList.add('hidden');
  auditCode = '';
  clearTimeout(auditTimer);
  document.getElementById('auditMain').classList.add('hidden');
  document.getElementById('auditEvents').innerHTML = '';
  document.getElementById('auditPeople').innerHTML = '';
}
function auBump() { clearTimeout(auditTimer); auditTimer = setTimeout(closeAudit, 10 * 60 * 1000); } // 10 daqiqa harakatsiz bo'lsa o'zi yopiladi
async function auFetch(url) {
  const res = await fetch(url, { headers: { 'X-Audit-Code': auditCode } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Xatolik'); e.auditCode = !!data.auditCode; e.auditSetup = !!data.auditSetup; throw e; }
  auBump();
  return data;
}
function agoText(iso) {
  if (!iso) return 'hali yo\'q';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'hozirgina';
  if (m < 60) return `${m} daqiqa oldin`;
  if (m < 1440) return `${Math.floor(m / 60)} soat oldin`;
  return `${Math.floor(m / 1440)} kun oldin`;
}
function devText(q) {
  if (!q) return '—';
  const parts = [q.tur, q.model, q.os, q.brauzer].filter(Boolean);
  const extra = [q.ekran ? `ekran ${q.ekran}` : '', q.ip ? `IP ${q.ip}` : ''].filter(Boolean);
  return `${parts.join(' · ')}${extra.length ? ' · ' + extra.join(' · ') : ''}`;
}
function auIcon(q) { return q && q.tur === 'Telefon' ? '📱' : q && q.tur === 'Planshet' ? '📟' : '💻'; }

async function openAudit() {
  if (!isOwner()) return;
  closeModals();
  const gate = document.getElementById('auditGate');
  const err = document.getElementById('auditGateError');
  err.textContent = '';
  document.getElementById('auditCodeInput').value = '';
  document.getElementById('auditCodeInput2').value = '';
  document.getElementById('auditMain').classList.add('hidden');
  gate.classList.remove('hidden');
  let codeSet = true;
  try { codeSet = (await apiJson('/api/audit/status', 'GET')).codeSet; } catch (e) { showToast(e.message, true); return; }
  gate.dataset.mode = codeSet ? 'enter' : 'setup';
  document.getElementById('auditCode2Row').style.display = codeSet ? 'none' : '';
  document.getElementById('auditGateBtn').textContent = codeSet ? 'Ochish' : 'Kodni o\'rnatish va ochish';
  document.getElementById('auditGateText').textContent = codeSet
    ? 'Kuzatuv jurnalini ochish uchun kodni kiriting.'
    : "Kuzatuv jurnali hali yoqilmagan. Avval o'zingiz maxfiy kod o'ylab toping (4–8 raqam). Bu kodni faqat siz bilasiz, xodimlar bu bo'limni ko'rmaydi.";
  auModal.classList.remove('hidden');
  setTimeout(() => document.getElementById('auditCodeInput').focus(), 50);
}
async function auditEnter() {
  const gate = document.getElementById('auditGate');
  const err = document.getElementById('auditGateError');
  err.textContent = '';
  const code = document.getElementById('auditCodeInput').value.trim();
  if (!/^\d{4,8}$/.test(code)) { err.textContent = 'Kod 4 dan 8 gacha raqam bo\'lsin'; return; }
  try {
    if (gate.dataset.mode === 'setup') {
      if (code !== document.getElementById('auditCodeInput2').value.trim()) { err.textContent = 'Ikkala kod bir xil emas'; return; }
      await apiJson('/api/audit/code', 'POST', { kod: code });
      showToast('Kuzatuv kodi o\'rnatildi ✓');
    }
    auditCode = code;
    auPeopleCache = await auFetch('/api/audit/people');
    gate.classList.add('hidden');
    document.getElementById('auditMain').classList.remove('hidden');
    renderAuPeople();
    fillAuUsers();
    auTab('people');
  } catch (e) { auditCode = ''; err.textContent = e.message; }
}
document.getElementById('auditGateBtn').onclick = auditEnter;
['auditCodeInput', 'auditCodeInput2'].forEach((id) => document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') auditEnter(); }));
document.getElementById('auditCloseBtn').onclick = closeAudit;
auModal.addEventListener('click', (e) => { if (e.target === auModal) closeAudit(); });

// Yashirin ochish yo'llari
let brandTaps = [];
document.querySelector('.brand-mark')?.addEventListener('click', () => {
  if (!isOwner()) return;
  const now = Date.now();
  brandTaps = brandTaps.filter((t) => now - t < 2500);
  brandTaps.push(now);
  if (brandTaps.length >= 5) { brandTaps = []; openAudit(); }
});
document.addEventListener('keydown', (e) => { if (isOwner() && e.ctrlKey && e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openAudit(); } });

function auTab(name) {
  document.querySelectorAll('.au-tab').forEach((b) => b.classList.toggle('active', b.dataset.au === name));
  document.getElementById('auditPeople').classList.toggle('hidden', name !== 'people');
  document.getElementById('auditLogPane').classList.toggle('hidden', name !== 'log');
  document.getElementById('auditCodePane').classList.toggle('hidden', name !== 'code');
}
document.querySelectorAll('.au-tab').forEach((b) => b.addEventListener('click', async () => {
  auTab(b.dataset.au);
  if (b.dataset.au === 'people') { try { auPeopleCache = await auFetch('/api/audit/people'); renderAuPeople(); } catch (e) { auHandleErr(e); } }
  if (b.dataset.au === 'log' && !document.getElementById('auditEvents').innerHTML) loadAuEvents(true);
}));
function auHandleErr(e) {
  if (e.auditCode) { closeAudit(); showToast('Kuzatuv kodi qayta so\'raladi', true); } else showToast(e.message, true);
}

function renderAuPeople() {
  const box = document.getElementById('auditPeople');
  box.innerHTML = auPeopleCache.map((p) => {
    const online = p.oxirgiFaollik && Date.now() - new Date(p.oxirgiFaollik).getTime() < 10 * 60000;
    const devs = (p.qurilmalar || []).map((d) => `<div>${auIcon(d)} ${escapeHtml(devText(d))} <span class="muted">· ${d.soni} marta · oxirgi: ${escapeHtml(fmtCreated(d.oxirgi))}</span></div>`).join('');
    return `<div class="au-person ${p.faol ? '' : 'off'}">
      <div class="au-person-top"><div><span class="au-dot ${online ? 'on' : ''}"></span><b>${escapeHtml(p.ism)}</b><span class="au-role">${escapeHtml(p.rolNomi)}</span>${p.faol ? '' : ' <span class="au-warn">· to\'xtatilgan</span>'}</div>
        <button class="ghost-btn small-btn" data-au-user="${p.id}">Jurnalini ko'rish ›</button></div>
      <div class="au-line">Oxirgi kirish: <b>${p.oxirgiKirish ? escapeHtml(fmtCreated(p.oxirgiKirish)) : '—'}</b> · Oxirgi faollik: <b>${p.oxirgiFaollik ? escapeHtml(fmtCreated(p.oxirgiFaollik)) + ' (' + agoText(p.oxirgiFaollik) + ')' : '—'}</b></div>
      <div class="au-line">Oxirgi qurilma: ${p.qurilma ? `${auIcon(p.qurilma)} <b>${escapeHtml(devText(p.qurilma))}</b>` : '—'}</div>
      <div class="au-line">Bugun amallar: <b>${p.bugun}</b>${p.xatoUrinish7kun ? ` · <span class="au-warn">noto'g'ri parol urinishlari (7 kun): ${p.xatoUrinish7kun}</span>` : ''}${p.xavfli30kun ? ` · <span class="au-warn">xavfli amallar (30 kun): ${p.xavfli30kun}</span>` : ''}</div>
      ${devs ? `<details class="au-devs"><summary>Qaysi qurilmalardan kirgan (oxirgi 30 kun): ${(p.qurilmalar || []).length} ta</summary>${devs}</details>` : ''}
    </div>`;
  }).join('') || '<div class="empty-day">Ma\'lumot yo\'q</div>';
}
document.getElementById('auditPeople').addEventListener('click', (e) => {
  const id = e.target.closest('[data-au-user]')?.dataset.auUser;
  if (!id) return;
  document.getElementById('auFilterUser').value = id;
  auTab('log');
  loadAuEvents(true);
});
function fillAuUsers() {
  const sel = document.getElementById('auFilterUser');
  sel.innerHTML = '<option value="">Hammasi</option>' + auPeopleCache.map((p) => `<option value="${p.id}">${escapeHtml(p.ism)} (${escapeHtml(p.rolNomi)})</option>`).join('');
}

function auEventHtml(e) {
  const oz = (e.oz || []).length ? `<table class="au-oz"><thead><tr><th>Maydon</th><th>Oldin</th><th>Keyin</th></tr></thead><tbody>${e.oz.map((o) => `<tr><td>${escapeHtml(o.m)}</td><td class="old">${escapeHtml(o.oldin)}</td><td class="new">${escapeHtml(o.keyin)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<div class="au-ev ${e.xavf ? 'danger' : AU_QUIET.includes(e.tur) ? 'quiet' : ''}">
    <div class="au-ev-top"><span>${AU_ICON[e.tur] || '•'}</span><b>${escapeHtml(e.kim.ism)}</b><span class="au-role">${escapeHtml(e.kim.rol === 'owner' ? 'Admin (ega)' : ({ ishchi: 'Xodim', zborshik: 'Zborshik', labo: 'Shafyor (labo)', sotuvchi: 'Sotuvchi' }[e.kim.rol] || e.kim.rol))}</span><span class="au-time">${escapeHtml(fmtCreated(e.t))}</span></div>
    <div class="au-text">${escapeHtml(e.matn)}</div>${oz}
    <div class="au-dev">${auIcon(e.q)} ${escapeHtml(devText(e.q))}</div>
  </div>`;
}
async function loadAuEvents(reset) {
  const box = document.getElementById('auditEvents');
  if (reset) { auCursor = ''; box.innerHTML = '<div class="empty-day">Yuklanmoqda…</div>'; }
  const qs = new URLSearchParams({ limit: '60' });
  const set = (k, v) => { if (v) qs.set(k, v); };
  set('user', document.getElementById('auFilterUser').value);
  set('tur', document.getElementById('auFilterTur').value);
  set('from', document.getElementById('auFrom').value);
  set('to', document.getElementById('auTo').value);
  set('q', document.getElementById('auQ').value.trim());
  if (document.getElementById('auDanger').checked) qs.set('xavf', '1');
  if (!reset && auCursor) qs.set('before', auCursor);
  try {
    const data = await auFetch(`/api/audit/events?${qs}`);
    const html = data.events.map(auEventHtml).join('');
    if (reset) box.innerHTML = html || '<div class="empty-day">Bu filtr bo\'yicha yozuv topilmadi</div>';
    else box.insertAdjacentHTML('beforeend', html);
    if (data.events.length) auCursor = data.events[data.events.length - 1].t;
    document.getElementById('auMoreBtn').classList.toggle('hidden', !data.hasMore);
  } catch (e) { auHandleErr(e); }
}
document.getElementById('auApplyBtn').onclick = () => loadAuEvents(true);
document.getElementById('auMoreBtn').onclick = () => loadAuEvents(false);
document.getElementById('auQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAuEvents(true); });

document.getElementById('auCodeSaveBtn').onclick = async () => {
  const err = document.getElementById('auCodeError'); err.textContent = '';
  const a = document.getElementById('auNewCode').value.trim(); const b = document.getElementById('auNewCode2').value.trim();
  if (!/^\d{4,8}$/.test(a)) { err.textContent = "Kod 4 dan 8 gacha raqam bo'lsin"; return; }
  if (a !== b) { err.textContent = 'Ikkala kod bir xil emas'; return; }
  try {
    const res = await fetch('/api/audit/code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Audit-Code': auditCode }, body: JSON.stringify({ kod: a }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Xatolik');
    auditCode = a;
    document.getElementById('auNewCode').value = ''; document.getElementById('auNewCode2').value = '';
    showToast('Kuzatuv kodi o\'zgartirildi ✓');
  } catch (ex) { err.textContent = ex.message; }
};

})();
