const $ = (id) => document.getElementById(id);
// Kirish xavfsizligi uchun qurilma haqida qisqa ma'lumot (ekran, til, vaqt mintaqasi) — egasi ko'ra oladi
function deviceInfo() {
  try {
    return { ekran: `${screen.width}x${screen.height}`, til: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, platforma: navigator.platform };
  } catch { return {}; }
}

// Tablar
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('loginPane').classList.toggle('hidden', t.dataset.tab !== 'login');
  $('newPane').classList.toggle('hidden', t.dataset.tab !== 'new');
}));

// Login-parol
$('loginPane').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  $('loginBtn').disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: $('login').value, password: $('password').value, device: deviceInfo() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Xatolik');
    location.href = data.redirect;
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginBtn').disabled = false;
  }
});

// Google
async function onGoogle(resp) {
  $('googleError').textContent = '';
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential, device: deviceInfo() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Xatolik');
    location.href = data.redirect;
  } catch (err) {
    $('googleError').textContent = err.message;
  }
}

(async function initGoogle() {
  const cfg = await (await fetch('/api/auth/config')).json();
  if (!cfg.googleClientId) {
    $('googleError').textContent = "Google orqali kirish hali sozlanmagan (serverda GOOGLE_CLIENT_ID kerak).";
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = () => {
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogle });
    google.accounts.id.renderButton($('googleBtn'), { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', width: 300 });
  };
  s.onerror = () => { $('googleError').textContent = "Google xizmatiga ulanib bo'lmadi. Internetni tekshiring."; };
  document.head.appendChild(s);
})();
