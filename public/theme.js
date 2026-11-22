// Mavzu (tema) tanlash: 5 ta dizayn. Tanlov shu brauzerda saqlanadi (har kim o'ziniki).
// Sahifa chizilishidan OLDIN ishlaydi, shuning uchun "miltillash" bo'lmaydi.
(function () {
  var KEY = 'yuk-theme';
  var THEMES = [
    { id: 'klassik', nomi: 'Klassik', izoh: "Eski rang (dastlabki)", e: '🕰️', c: ['#ff7a45', '#a78bfa', '#38c987'], bg: '#1b1e25' },
    { id: 'quyosh', nomi: 'Quyosh', izoh: "Qorong'u · to'q sariq", e: '🌅', c: ['#ff7a45', '#ffb347', '#8b5cf6'], bg: '#0b0e14' },
    { id: 'okean', nomi: 'Okean', izoh: "Qorong'u · moviy", e: '🌊', c: ['#19b8ff', '#5eead4', '#6d7cff'], bg: '#071426' },
    { id: 'neon', nomi: 'Neon', izoh: "Qorong'u · pushti", e: '💜', c: ['#ff3fa4', '#b36bff', '#00e5ff'], bg: '#12081f' },
    { id: 'tabiat', nomi: 'Tabiat', izoh: "Qorong'u · yashil", e: '🌿', c: ['#22e59a', '#c6f432', '#14b8a6'], bg: '#07180f' },
    { id: 'olov', nomi: 'Olov', izoh: "Qorong'u · qizil", e: '🔥', c: ['#ff4136', '#ff9500', '#ffcc00'], bg: '#1e0c0a' },
    { id: 'uzum', nomi: 'Uzum', izoh: "Qorong'u · binafsha", e: '🍇', c: ['#a855f7', '#ec4899', '#6366f1'], bg: '#170e26' },
    { id: 'atirgul', nomi: 'Atirgul', izoh: "Qorong'u · atirgul", e: '🌹', c: ['#fb7185', '#fbbf24', '#f472b6'], bg: '#210d1a' },
    { id: 'kosmos', nomi: 'Kosmos', izoh: "Qorong'u · indigo", e: '🌌', c: ['#818cf8', '#38bdf8', '#c084fc'], bg: '#0d1230' },
    { id: 'limon', nomi: 'Limon', izoh: "Qorong'u · sariq", e: '🍋', c: ['#facc15', '#fb923c', '#a3e635'], bg: '#1a1808' },
    { id: 'firuza', nomi: 'Firuza', izoh: "Qorong'u · firuza", e: '💎', c: ['#2dd4bf', '#38bdf8', '#a78bfa'], bg: '#082422' },
    { id: 'grafit', nomi: 'Grafit', izoh: "Qorong'u · kumush", e: '⚫', c: ['#f4f4f5', '#a1a1aa', '#71717a'], bg: '#141416' },
    { id: 'yorugh', nomi: "Yorug'", izoh: 'Kunduzgi · to\'q sariq', e: '☀️', c: ['#ff5a1f', '#ff9f1c', '#7c3aed'], bg: '#f1f3fb' },
    { id: 'shaftoli', nomi: 'Shaftoli', izoh: 'Kunduzgi · pushti', e: '🌸', c: ['#ff4f87', '#ff9966', '#c026d3'], bg: '#fff0ec' },
    { id: 'osmon', nomi: 'Osmon', izoh: 'Kunduzgi · moviy', e: '🩵', c: ['#0a84ff', '#22c7ee', '#6366f1'], bg: '#e8f5ff' },
    { id: 'yalpiz', nomi: 'Yalpiz', izoh: 'Kunduzgi · yashil', e: '🍃', c: ['#10b981', '#84cc16', '#0ea5e9'], bg: '#eafbf2' }
  ];
  function valid(id) { return THEMES.some(function (t) { return t.id === id; }); }
  function get() { try { var v = localStorage.getItem(KEY); return valid(v) ? v : 'quyosh'; } catch (e) { return 'quyosh'; } }
  function apply(id) {
    document.documentElement.setAttribute('data-theme', id);
    var m = document.querySelector('meta[name="theme-color"]');
    var t = THEMES.filter(function (x) { return x.id === id; })[0];
    if (m && t) m.setAttribute('content', t.bg);
  }
  function set(id) { if (!valid(id)) return; try { localStorage.setItem(KEY, id); } catch (e) {} apply(id); mark(); }
  apply(get());

  var pop, fab;
  function mark() {
    if (!pop) return;
    var cur = get();
    pop.querySelectorAll('.th-opt').forEach(function (b) { b.classList.toggle('on', b.dataset.id === cur); });
  }
  function build() {
    if (fab || !document.body) return;
    fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'th-fab'; fab.title = 'Dizaynni tanlash'; fab.setAttribute('aria-label', 'Dizaynni tanlash'); fab.textContent = '🎨';
    pop = document.createElement('div');
    pop.className = 'th-pop hidden';
    pop.innerHTML = '<div class="th-title">🎨 Dizayn tanlang · ' + THEMES.length + ' ta</div><div class="th-grid">' + THEMES.map(function (t) {
      return (t.id === 'klassik' ? '<div class="th-grp">Qorong\'u dizaynlar</div>' : '') + (t.id === 'yorugh' ? '<div class="th-grp">Kunduzgi (oq fon) dizaynlar</div>' : '') + '<button type="button" class="th-opt" data-id="' + t.id + '"><span class="th-sw" style="background:' + t.bg + '">' +
        '<i style="background:' + t.c[0] + '"></i><i style="background:' + t.c[1] + '"></i><i style="background:' + t.c[2] + '"></i></span>' +
        '<span>' + t.e + ' ' + t.nomi + '<small>' + t.izoh + '</small></span><span class="th-check">✓</span></button>';
    }).join('') + '</div>';
    document.body.appendChild(pop); document.body.appendChild(fab);
    fab.addEventListener('click', function (e) { e.stopPropagation(); pop.classList.toggle('hidden'); });
    pop.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('.th-opt'); if (b) set(b.dataset.id);
    });
    document.addEventListener('click', function () { pop.classList.add('hidden'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') pop.classList.add('hidden'); });
    mark();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  window.YukTheme = { set: set, get: get, list: THEMES };
})();
