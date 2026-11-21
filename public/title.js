// Zakaz sarlavhasi: "leyla orex 1 ta + sadaf oq 2 ta" — hamma ko'rsin deb sonlari nom yonida chiqadi.
// Matras qatorlari (mebelga biriktirilgan) sarlavhaga kirmaydi, ular pastda alohida ko'rinadi.
window.loadTitle = function (l) {
  var it = (l.skladItems || []).filter(function (i) { return !(i.yonalish === 'matras' && i.fromModelId); });
  if (!it.length) return l.nomi || '';
  return it.map(function (i) { return i.model + ' ' + i.soni + ' ta'; }).join(' + ');
};
