// Premium effektlar: to'lqin (ripple), kursor ortidan yuruvchi nur, raqamlar sanashi, tepa panel soyasi, kirish kartasi egilishi.
// Faqat ko'rinish uchun — sayt mantiqiga tegmaydi. Xato bo'lsa ham sayt ishlayveradi.
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // 1) Ripple: tugma bosilganda bosilgan joydan to'lqin tarqaladi
  var RIPPLE = '.primary-btn, .ghost-btn, .danger-btn, .pay-btn, .pk-chip, .sk-tab';
  document.addEventListener('pointerdown', function (e) {
    if (reduce) return;
    var b = e.target.closest && e.target.closest(RIPPLE);
    if (!b || b.disabled || b.classList.contains('bell-btn')) return;
    var r = b.getBoundingClientRect();
    var size = Math.max(r.width, r.height);
    var s = document.createElement('span');
    s.className = 'px-ripple';
    s.style.width = s.style.height = size + 'px';
    s.style.left = (e.clientX - r.left - size / 2) + 'px';
    s.style.top = (e.clientY - r.top - size / 2) + 'px';
    b.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
  }, { passive: true });

  // 2) Spotlight: kartochka ustida kursor ortidan yorug'lik yuradi
  if (fine && !reduce) {
    var SPOT = '.day-col, .load-card, .zb-card, .sk-cat, .sk-stat, .s-stat, .pk';
    var raf = 0, last = null;
    document.addEventListener('pointermove', function (e) {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var el = last.target.closest && last.target.closest(SPOT);
        if (!el) return;
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (last.clientX - r.left) + 'px');
        el.style.setProperty('--my', (last.clientY - r.top) + 'px');
      });
    }, { passive: true });
  }

  // 3) Raqamlar sanab chiqiladi (hisobot kartalari, sotuvchi statistikasi)
  function countUp(el) {
    if (el.dataset.cu) return;
    el.dataset.cu = '1';
    var txt = el.textContent.trim();
    if (!/^\d{1,7}$/.test(txt) || reduce) return;
    var to = Number(txt);
    if (to < 2) return;
    var t0 = performance.now(), dur = 700 + Math.min(600, to * 4);
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step); else el.textContent = txt;
    })(t0);
  }
  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches && root.matches('.sk-stat b, .s-stat b')) countUp(root);
    var list = root.querySelectorAll('.sk-stat b, .s-stat b');
    for (var i = 0; i < list.length; i++) countUp(list[i]);
  }
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
    }).observe(document.documentElement, { childList: true, subtree: true });
    scan(document.body || document.documentElement);
  } catch (e) { /* ko'rinish uchun xolos */ }

  // 4) Tepa panel: sahifa pastga siljiganda soya kuchayadi
  var bar = document.querySelector('.topbar, .zb-top');
  if (bar) {
    var onScroll = function () { bar.classList.toggle('px-scrolled', window.scrollY > 6); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // 5) Kirish kartasi: kursorga qarab biroz egiladi (faqat kompyuterda)
  var card = document.querySelector('.login-card');
  if (card && fine && !reduce) {
    document.addEventListener('pointermove', function (e) {
      var x = (e.clientX / window.innerWidth - 0.5), y = (e.clientY / window.innerHeight - 0.5);
      card.style.transform = 'rotateY(' + (x * 7).toFixed(2) + 'deg) rotateX(' + (-y * 7).toFixed(2) + 'deg)';
    }, { passive: true });
    document.addEventListener('pointerleave', function () { card.style.transform = ''; });
  }
})();
