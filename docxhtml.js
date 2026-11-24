// Word (.docx) XML elementlarini (paragraf, jadval) brauzerda chop etish uchun HTML'ga aylantiradi.
// Faqat nakladnoyda kerak bo'ladigan imkoniyatlar: shrift/o'lcham/qalin/chiziq, tekislash, oraliqlar, jadval, chegara, fon, birlashgan kataklar.
const { DOMParser } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const els = (n) => Array.from(n.childNodes).filter((c) => c.nodeType === 1);
const kids = (n, name) => els(n).filter((c) => c.localName === name && c.namespaceURI === W);
const first = (n, name) => (n ? kids(n, name)[0] || null : null);
const attr = (e, name) => (e ? e.getAttributeNS(W, name) || e.getAttribute('w:' + name) || '' : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const on = (e) => !!e && !/^(0|false|off|none)$/i.test(attr(e, 'val') || 'on'); // <w:b/> yoki <w:b w:val="1"/> — yoqilgan
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pt = (twips) => `${(num(twips) / 20).toFixed(2)}pt`;
const safeFont = (f) => String(f || '').replace(/[^\w\u0400-\u04FF .-]/g, '').trim();
const safeColor = (c) => (/^[0-9A-Fa-f]{6}$/.test(c || '') ? `#${c}` : null);

// ---------- styles.xml ----------
function parseStyles(xml) {
  const out = { defR: {}, defP: {}, styles: {}, defParaId: null };
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const dd = first(root, 'docDefaults');
  if (dd) {
    const rp = first(first(dd, 'rPrDefault'), 'rPr'); if (rp) out.defR = readR(rp);
    const pp = first(first(dd, 'pPrDefault'), 'pPr'); if (pp) out.defP = readP(pp);
  }
  kids(root, 'style').forEach((st) => {
    const id = attr(st, 'styleId');
    const rec = { type: attr(st, 'type'), basedOn: attr(first(st, 'basedOn'), 'val'), p: first(st, 'pPr') ? readP(first(st, 'pPr')) : {}, r: first(st, 'rPr') ? readR(first(st, 'rPr')) : {}, tbl: null };
    const tp = first(st, 'tblPr');
    if (tp) rec.tbl = { borders: readBorders(first(tp, 'tblBorders')), mar: readMar(first(tp, 'tblCellMar')) };
    out.styles[id] = rec;
    if (rec.type === 'paragraph' && attr(st, 'default') === '1') out.defParaId = id;
  });
  return out;
}
function chain(styles, id) { // eskisidan yangisiga
  const list = []; const seen = new Set();
  let cur = id;
  while (cur && styles.styles[cur] && !seen.has(cur)) { seen.add(cur); list.unshift(styles.styles[cur]); cur = styles.styles[cur].basedOn; }
  return list;
}

// ---------- xususiyatlarni o'qish ----------
function readR(rPr) {
  const r = {};
  const f = first(rPr, 'rFonts'); if (f) { const n = attr(f, 'ascii') || attr(f, 'hAnsi') || attr(f, 'cs'); if (n) r.font = safeFont(n); }
  const b = first(rPr, 'b'); if (b) r.b = on(b);
  const i = first(rPr, 'i'); if (i) r.i = on(i);
  const u = first(rPr, 'u'); if (u) r.u = attr(u, 'val') !== 'none';
  const s = first(rPr, 'strike'); if (s) r.strike = on(s);
  const caps = first(rPr, 'caps'); if (caps) r.caps = on(caps);
  const sz = first(rPr, 'sz'); if (sz) r.sz = num(attr(sz, 'val')) / 2;
  const c = first(rPr, 'color'); if (c) { const col = safeColor(attr(c, 'val')); if (col) r.color = col; }
  const hl = first(rPr, 'highlight'); if (hl) { const m = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', lightGray: '#d3d3d3', darkGray: '#a9a9a9' }[attr(hl, 'val')]; if (m) r.bg = m; }
  const sh = first(rPr, 'shd'); if (sh) { const fill = safeColor(attr(sh, 'fill')); if (fill) r.bg = fill; }
  const v = first(rPr, 'vanish'); if (v) r.vanish = on(v);
  return r;
}
function readP(pPr) {
  const p = {};
  const jc = first(pPr, 'jc'); if (jc) p.jc = attr(jc, 'val');
  const sp = first(pPr, 'spacing');
  if (sp) {
    if (attr(sp, 'before') !== '') p.before = num(attr(sp, 'before'));
    if (attr(sp, 'after') !== '') p.after = num(attr(sp, 'after'));
    if (attr(sp, 'line') !== '') { p.line = num(attr(sp, 'line')); p.lineRule = attr(sp, 'lineRule') || 'auto'; }
  }
  const ind = first(pPr, 'ind');
  if (ind) {
    const l = attr(ind, 'left') || attr(ind, 'start'); const r = attr(ind, 'right') || attr(ind, 'end');
    if (l !== '') p.left = num(l); if (r !== '') p.right = num(r);
    if (attr(ind, 'firstLine') !== '') p.firstLine = num(attr(ind, 'firstLine'));
    if (attr(ind, 'hanging') !== '') p.firstLine = -num(attr(ind, 'hanging'));
  }
  const pb = first(pPr, 'pBdr');
  if (pb) p.bdr = readBorders(pb);
  const mark = first(pPr, 'rPr'); if (mark) p.mark = readR(mark);
  const ps = first(pPr, 'pStyle'); if (ps) p.style = attr(ps, 'val');
  return p;
}
function readBorders(b) {
  if (!b) return null;
  const o = {};
  ['top', 'left', 'bottom', 'right', 'start', 'end', 'insideH', 'insideV'].forEach((k) => {
    const e = first(b, k); if (!e) return;
    const style = attr(e, 'val');
    o[k === 'start' ? 'left' : k === 'end' ? 'right' : k] = { style, sz: num(attr(e, 'sz'), 4), color: attr(e, 'color') };
  });
  return o;
}
function readMar(m) {
  if (!m) return null;
  const o = {};
  ['top', 'left', 'bottom', 'right', 'start', 'end'].forEach((k) => { const e = first(m, k); if (e) o[k === 'start' ? 'left' : k === 'end' ? 'right' : k] = num(attr(e, 'w')); });
  return o;
}
const merge = (...objs) => Object.assign({}, ...objs.filter(Boolean));

function borderCss(b) {
  if (!b || !b.style || /^(nil|none)$/i.test(b.style)) return 'none';
  const w = Math.max(0.5, b.sz / 8);
  const col = safeColor(b.color) || '#000';
  const st = /double/i.test(b.style) ? 'double' : /dot/i.test(b.style) ? 'dotted' : /dash/i.test(b.style) ? 'dashed' : 'solid';
  return `${st === 'double' ? Math.max(w, 2.25) : w}pt ${st} ${col}`;
}

// ---------- paragraf ----------
function runsHtml(p, base) {
  let html = '';
  const walk = (node, inheritedR) => {
    els(node).forEach((c) => {
      if (c.namespaceURI !== W) return;
      if (c.localName === 'r') {
        const rp = first(c, 'rPr');
        const r = merge(base, inheritedR, rp ? readR(rp) : null);
        if (r.vanish) return;
        let inner = '';
        els(c).forEach((t) => {
          if (t.namespaceURI !== W) return;
          if (t.localName === 't') inner += esc(t.textContent);
          else if (t.localName === 'tab') inner += '<span style="display:inline-block;width:2em"></span>';
          else if (t.localName === 'br') { const ty = attr(t, 'type'); if (!ty || ty === 'textWrapping') inner += '<br>'; }
          else if (t.localName === 'noBreakHyphen') inner += '&#8209;';
        });
        if (!inner) return;
        const css = [];
        if (r.font) css.push(`font-family:'${r.font}',Calibri,Carlito,Arial,sans-serif`);
        if (r.sz) css.push(`font-size:${r.sz}pt`);
        if (r.b) css.push('font-weight:700');
        if (r.i) css.push('font-style:italic');
        const dec = [r.u ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ');
        if (dec) css.push(`text-decoration:${dec}`);
        if (r.caps) css.push('text-transform:uppercase');
        if (r.color) css.push(`color:${r.color}`);
        if (r.bg) css.push(`background:${r.bg}`);
        html += `<span style="${css.join(';')}">${inner}</span>`;
      } else if (['hyperlink', 'smartTag', 'sdt', 'sdtContent', 'ins', 'fldSimple'].includes(c.localName)) walk(c, inheritedR);
    });
  };
  walk(p, null);
  return html;
}
function paraHtml(p, ctx) {
  const direct = first(p, 'pPr') ? readP(first(p, 'pPr')) : {};
  const stChain = chain(ctx.styles, direct.style || ctx.styles.defParaId);
  const tblP = ctx.tableP || null;
  const pp = merge(ctx.styles.defP, tblP, ...stChain.map((s) => s.p), direct);
  const rBase = merge(ctx.styles.defR, ...stChain.map((s) => s.r));
  const mark = merge(rBase, direct.mark);
  const css = [];
  const align = { center: 'center', right: 'right', both: 'justify', distribute: 'justify', end: 'right' }[pp.jc] || 'left';
  css.push(`text-align:${align}`);
  css.push(`margin:${pt(pp.before || 0)} 0 ${pt(pp.after || 0)} 0`);
  const sizePt = mark.sz || 11;
  if (pp.line) {
    if (pp.lineRule === 'auto') css.push(`line-height:${(pp.line / 240).toFixed(3)}`);
    else css.push(`line-height:${pt(pp.line)}`);
  } else css.push('line-height:1');
  if (pp.left) css.push(`padding-left:${pt(pp.left)}`);
  if (pp.right) css.push(`padding-right:${pt(pp.right)}`);
  if (pp.firstLine) css.push(`text-indent:${pt(pp.firstLine)}`);
  css.push(`font-size:${sizePt}pt`);
  css.push('white-space:pre-wrap'); // boshidagi bo'shliqlar (masalan «Доставка__» ni surish) saqlansin
  if (pp.bdr) ['top', 'bottom', 'left', 'right'].forEach((k) => { if (pp.bdr[k]) css.push(`border-${k}:${borderCss(pp.bdr[k])}`); });
  let inner = runsHtml(p, rBase);
  if (!inner.replace(/<[^>]+>/g, '').trim() && !/<br/.test(inner)) inner = '<span style="font-size:' + sizePt + 'pt">&#8203;</span>'; // bo'sh paragraf ham o'z balandligini saqlasin
  return `<p style="${css.join(';')}">${inner}</p>`;
}

// ---------- jadval ----------
function tableHtml(tbl, ctx) {
  const tPr = first(tbl, 'tblPr');
  const styleId = tPr && first(tPr, 'tblStyle') ? attr(first(tPr, 'tblStyle'), 'val') : null;
  const stChain = chain(ctx.styles, styleId);
  const stTbl = stChain.map((s) => s.tbl).filter(Boolean);
  const tableBorders = merge(...stTbl.map((s) => s.borders), tPr ? readBorders(first(tPr, 'tblBorders')) : null);
  const mar = merge({ left: 108, right: 108, top: 0, bottom: 0 }, ...stTbl.map((s) => s.mar), tPr ? readMar(first(tPr, 'tblCellMar')) : null);
  const tableP = merge(ctx.tableP, ...stChain.map((s) => s.p));
  const inner = { ...ctx, tableP };
  const grid = first(tbl, 'tblGrid') ? kids(first(tbl, 'tblGrid'), 'gridCol').map((g) => num(attr(g, 'w'))) : [];
  const ind = tPr && first(tPr, 'tblInd') && attr(first(tPr, 'tblInd'), 'type') !== 'nil' ? num(attr(first(tPr, 'tblInd'), 'w')) : 0;
  const rows = kids(tbl, 'tr');

  // Katak koordinatalari (gridSpan / vMerge uchun)
  const cellsInfo = rows.map((tr) => {
    let col = 0;
    return kids(tr, 'tc').map((tc) => {
      const tcPr = first(tc, 'tcPr');
      const span = tcPr && first(tcPr, 'gridSpan') ? Math.max(1, num(attr(first(tcPr, 'gridSpan'), 'val'), 1)) : 1;
      const vm = tcPr && first(tcPr, 'vMerge');
      const info = { tc, tcPr, col, span, vm: vm ? (attr(vm, 'val') === 'restart' ? 'restart' : 'cont') : null, rowspan: 1 };
      col += span;
      return info;
    });
  });
  cellsInfo.forEach((row, ri) => row.forEach((c) => {
    if (c.vm !== 'restart') return;
    for (let r = ri + 1; r < cellsInfo.length; r += 1) {
      const nxt = cellsInfo[r].find((x) => x.col === c.col && x.vm === 'cont');
      if (!nxt) break; nxt.skip = true; c.rowspan += 1;
    }
  }));

  const totalW = grid.reduce((a, b) => a + b, 0) || 0;
  let html = `<table style="border-collapse:collapse;table-layout:fixed;${totalW ? `width:${pt(totalW)};` : ''}${ind ? `margin-left:${pt(ind)};` : ''}">`;
  if (grid.length) html += '<colgroup>' + grid.map((g) => `<col style="width:${pt(g)}">`).join('') + '</colgroup>';
  rows.forEach((tr, ri) => {
    const trPr = first(tr, 'trPr');
    const h = trPr && first(trPr, 'trHeight') ? num(attr(first(trPr, 'trHeight'), 'val')) : 0;
    html += `<tr${h ? ` style="height:${pt(h)}"` : ''}>`;
    cellsInfo[ri].forEach((c) => {
      if (c.skip) return;
      const cb = c.tcPr ? readBorders(first(c.tcPr, 'tcBorders')) : null;
      const last = ri === rows.length - 1; const lastCol = c.col + c.span >= grid.length;
      const side = (k) => {
        if (cb && cb[k]) return cb[k];
        if (tableBorders) {
          if (k === 'top') return ri === 0 ? tableBorders.top : tableBorders.insideH;
          if (k === 'bottom') return last ? tableBorders.bottom : tableBorders.insideH;
          if (k === 'left') return c.col === 0 ? tableBorders.left : tableBorders.insideV;
          if (k === 'right') return lastCol ? tableBorders.right : tableBorders.insideV;
        }
        return null;
      };
      const css = ['vertical-align:' + ({ center: 'middle', bottom: 'bottom' }[c.tcPr && first(c.tcPr, 'vAlign') ? attr(first(c.tcPr, 'vAlign'), 'val') : ''] || 'top')];
      ['top', 'right', 'bottom', 'left'].forEach((k) => css.push(`border-${k}:${borderCss(side(k))}`));
      css.push(`padding:${pt(mar.top || 0)} ${pt(mar.right)} ${pt(mar.bottom || 0)} ${pt(mar.left)}`);
      const shd = c.tcPr && first(c.tcPr, 'shd'); const fill = shd ? safeColor(attr(shd, 'fill')) : null;
      if (fill) css.push(`background:${fill}`);
      css.push('overflow:hidden');
      const content = els(c.tc).map((n) => (n.localName === 'p' ? paraHtml(n, inner) : n.localName === 'tbl' ? tableHtml(n, inner) : '')).join('') || '<p style="margin:0;font-size:11pt">&#8203;</p>';
      html += `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''} style="${css.join(';')}">${content}</td>`;
    });
    html += '</tr>';
  });
  return html + '</table>';
}

// Elementlar ro'yxati -> HTML. styles: shu elementlar olingan hujjatning uslublari
function toHtml(nodes, styles) {
  const ctx = { styles, tableP: null };
  return nodes.map((n) => (n.localName === 'p' ? paraHtml(n, ctx) : n.localName === 'tbl' ? tableHtml(n, ctx) : '')).join('');
}

module.exports = { parseStyles, toHtml };
