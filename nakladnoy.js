// Nakladnoy (Word): modelning .docx faylidagi CHAP tomon (накладной: mijoz ma'lumotlari) sayt ma'lumoti bilan to'ldiriladi,
// O'NG tomon (yuklar jadvallari) o'zgartirilmaydi. Zakazda bir nechta model bo'lsa — nakladnoy bitta,
// o'ng tomonda hamma modellarning yuk jadvallari ketma-ket chiqadi.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { parseStyles, toHtml } = require('./docxhtml');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const els = (node) => Array.from(node.childNodes).filter((n) => n.nodeType === 1);
const kids = (node, name) => els(node).filter((n) => n.localName === name && n.namespaceURI === W);
const first = (node, name) => kids(node, name)[0] || null;
const textOf = (node) => Array.from(node.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
const isEmptyEl = (n) => n.localName === 'p' && !textOf(n).trim() && !n.getElementsByTagNameNS(W, 'drawing').length && !n.getElementsByTagNameNS(W, 'pict').length;
const norm = (s) => String(s || '').replace(/[^A-Za-zА-Яа-яЁё0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

// RPR ichidagi elementlar tartibi (Word qat'iy tartibni yaxshi ko'radi): w:u shulardan oldin turadi
const AFTER_U = ['effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];

async function loadDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error("Bu Word (.docx) fayl emas yoki buzilgan");
  const xml = await f.async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('Word faylda matn topilmadi');
  const all = els(body);
  const sectPr = all.filter((n) => n.localName === 'sectPr').pop() || null;
  const content = all.filter((n) => n.localName !== 'sectPr');
  // Chap tomon oxiri — "ТЕЛ ОФИСА" qatori (yo'q bo'lsa "ПРЕДЛОЖЕНИЕ И ЖАЛОБЫ" ostidagi chiziqlar)
  let end = -1;
  content.forEach((n, i) => { if (/ТЕЛ\s*ОФИС|TEL\s*OFIS/i.test(textOf(n))) end = i; });
  if (end < 0) {
    const j = content.findIndex((n) => /ЖАЛОБ/i.test(textOf(n)));
    if (j >= 0) { end = j; while (end + 1 < content.length && /^[_\s]+$/.test(textOf(content[end + 1])) && textOf(content[end + 1]).trim()) end += 1; }
  }
  const left = end >= 0 ? content.slice(0, end + 1) : [];
  let right = content.slice(end + 1);
  while (right.length && isEmptyEl(right[0])) right.shift();
  while (right.length && isEmptyEl(right[right.length - 1])) right.pop();
  const stF = zip.file('word/styles.xml');
  const styles = parseStyles(stF ? await stF.async('string') : '');
  return { zip, doc, body, sectPr, left, right, styles, hasLeft: left.length > 0 };
}

// Yuklashda tekshirish uchun: chap tomon topildimi, o'ng tomonda nechta element bor
async function analyze(buf) {
  const d = await loadDocx(buf);
  const text = d.right.map(textOf).join(' ').trim();
  return { chap: d.hasLeft, ong: d.right.length, matn: text.length };
}

// ---------- kataklarni to'ldirish ----------
function newRun(doc, text, rPrSrc, underline) {
  const r = doc.createElementNS(W, 'w:r');
  if (rPrSrc) {
    const rpr = rPrSrc.cloneNode(true);
    if (underline && !first(rpr, 'u')) {
      const u = doc.createElementNS(W, 'w:u'); u.setAttributeNS(W, 'w:val', 'single');
      const before = els(rpr).find((c) => AFTER_U.includes(c.localName));
      if (before) rpr.insertBefore(u, before); else rpr.appendChild(u);
    }
    r.appendChild(rpr);
  } else if (underline) {
    const rpr = doc.createElementNS(W, 'w:rPr'); const u = doc.createElementNS(W, 'w:u'); u.setAttributeNS(W, 'w:val', 'single'); rpr.appendChild(u); r.appendChild(rpr);
  }
  const t = doc.createElementNS(W, 'w:t');
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}
// Katak (tc) ichiga matn yozadi: katakning paragraf belgisi (¶) formati ishlatiladi
function setCellText(doc, tc, text, minSize) {
  if (!text) return;
  let p = first(tc, 'p');
  if (!p) { p = doc.createElementNS(W, 'w:p'); tc.appendChild(p); }
  kids(p, 'r').forEach((r) => p.removeChild(r));
  const pPr = first(p, 'pPr');
  const mark = pPr ? first(pPr, 'rPr') : null;
  const rPr = mark ? mark.cloneNode(true) : null;
  if (rPr) els(rPr).filter((c) => ['del', 'ins', 'moveFrom', 'moveTo'].includes(c.localName)).forEach((c) => rPr.removeChild(c));
  if (rPr && minSize) {
    ['sz', 'szCs'].forEach((n) => { const e = first(rPr, n); if (e && Number(e.getAttributeNS(W, 'val')) < minSize) e.setAttributeNS(W, 'w:val', String(minSize)); });
  }
  p.appendChild(newRun(doc, text, rPr, false));
}
// "ВОДИТЕЛЬ________" kabi qator: tagiga chizilgan nom yoziladi, qolgan chiziq saqlanadi
function fillLine(doc, p, value) {
  if (!value) return;
  const runs = kids(p, 'r');
  const full = textOf(p);
  const m = full.match(/^(.*?)(_{3,})\s*$/);
  if (!m) return;
  const label = m[1];
  const n = m[2].length;
  const rPr = runs.length ? first(runs[0], 'rPr') : null;
  runs.forEach((r) => p.removeChild(r));
  const v = ` ${value} `;
  const rest = Math.max(2, n - Math.round(v.length * 1.6));
  p.appendChild(newRun(doc, label.replace(/\s*$/, ' '), rPr, false));
  p.appendChild(newRun(doc, v, rPr, true));
  p.appendChild(newRun(doc, '_'.repeat(rest), rPr, false));
}

function fillLeft(doc, left, v) {
  const byLabel = { 'МОДЕЛЬ': v.model, 'ТЕЛ 1': v.tel1, 'ТЕЛ 2': v.tel2, 'АДРЕС': v.adres, 'ОСТАТКА': v.ostatka, 'ОСТАТОК': v.ostatka };
  left.forEach((n) => {
    if (n.localName === 'tbl') {
      const rows = kids(n, 'tr');
      rows.forEach((tr, ri) => {
        const cells = kids(tr, 'tc');
        if (cells.length >= 2) {
          const key = norm(textOf(cells[0]));
          if (Object.prototype.hasOwnProperty.call(byLabel, key) && !textOf(cells[1]).trim()) setCellText(doc, cells[1], byLabel[key]);
        }
        // Sana jadvali: ДЕНЬ | МЕСЯЦ | ГОД -> keyingi qator
        if (cells.length === 3 && norm(textOf(cells[0])) === 'ДЕНЬ' && norm(textOf(cells[1])) === 'МЕСЯЦ' && rows[ri + 1]) {
          const next = kids(rows[ri + 1], 'tc');
          if (next.length === 3) { setCellText(doc, next[0], v.kun, 20); setCellText(doc, next[1], v.oy, 20); setCellText(doc, next[2], v.yil, 20); }
        }
      });
    } else if (n.localName === 'p') {
      const t = norm(textOf(n));
      if (t.startsWith('ВОДИТЕЛЬ')) fillLine(doc, n, v.haydovchi);
      else if (t.startsWith('УСТАНОВЩИК')) fillLine(doc, n, v.ustanovshik);
      else if (t.startsWith('КЛИЕНТ')) fillLine(doc, n, v.mijoz);
    }
  });
}

// ---------- qo'shish yordamchilari ----------
function cleanForImport(node) {
  // Boshqa hujjatdan ko'chirilganda: rasmlar (relationship kerak) tushiriladi, takrorlanuvchi paraId lar olib tashlanadi
  const kill = [];
  const walk = (n) => {
    if (n.nodeType !== 1) return;
    if (n.namespaceURI === W && (n.localName === 'drawing' || n.localName === 'pict' || n.localName === 'object')) { kill.push(n); return; }
    if (n.hasAttributeNS && n.hasAttributeNS(W14, 'paraId')) n.removeAttributeNS(W14, 'paraId');
    if (n.hasAttributeNS && n.hasAttributeNS(W14, 'textId')) n.removeAttributeNS(W14, 'textId');
    Array.from(n.attributes || []).forEach((a) => { if (a.name === 'w14:paraId' || a.name === 'w14:textId') n.removeAttribute(a.name); });
    Array.from(n.childNodes).forEach(walk);
  };
  walk(node);
  kill.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
}
function plainPara(doc, text, opts = {}) {
  const p = doc.createElementNS(W, 'w:p');
  const pPr = doc.createElementNS(W, 'w:pPr');
  const sp = doc.createElementNS(W, 'w:spacing'); sp.setAttributeNS(W, 'w:after', '0'); sp.setAttributeNS(W, 'w:line', '240'); sp.setAttributeNS(W, 'w:lineRule', 'auto');
  pPr.appendChild(sp); p.appendChild(pPr);
  if (text) {
    const r = doc.createElementNS(W, 'w:r');
    const rpr = doc.createElementNS(W, 'w:rPr');
    if (opts.bold) rpr.appendChild(doc.createElementNS(W, 'w:b'));
    const sz = doc.createElementNS(W, 'w:sz'); sz.setAttributeNS(W, 'w:val', String(opts.size || 24)); rpr.appendChild(sz);
    r.appendChild(rpr);
    const t = doc.createElementNS(W, 'w:t'); t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.appendChild(doc.createTextNode(text)); r.appendChild(t);
    p.appendChild(r);
  }
  return p;
}
function tinyPara(doc) {
  const p = doc.createElementNS(W, 'w:p');
  const pPr = doc.createElementNS(W, 'w:pPr');
  const sp = doc.createElementNS(W, 'w:spacing');
  ['before', 'after'].forEach((k) => sp.setAttributeNS(W, 'w:' + k, '0'));
  sp.setAttributeNS(W, 'w:line', '20'); sp.setAttributeNS(W, 'w:lineRule', 'exact');
  pPr.appendChild(sp);
  const rpr = doc.createElementNS(W, 'w:rPr'); const sz = doc.createElementNS(W, 'w:sz'); sz.setAttributeNS(W, 'w:val', '2'); rpr.appendChild(sz); pPr.appendChild(rpr);
  p.appendChild(pPr);
  return p;
}
// O'ng tomon boshiga USTUN SINISHI qo'yamiz: yuklar doim o'ng ustun tepasidan boshlanadi
function addColumnBreak(doc, firstEl) {
  const br = doc.createElementNS(W, 'w:r');
  const b = doc.createElementNS(W, 'w:br'); b.setAttributeNS(W, 'w:type', 'column'); br.appendChild(b);
  if (firstEl && firstEl.localName === 'p') {
    const pPr = first(firstEl, 'pPr');
    if (pPr) { if (pPr.nextSibling) firstEl.insertBefore(br, pPr.nextSibling); else firstEl.appendChild(br); }
    else firstEl.insertBefore(br, firstEl.firstChild);
    return null;
  }
  const p = plainPara(doc, '');
  p.appendChild(br);
  return p; // chaqiruvchi shuni elementdan oldin qo'yadi
}

const sanaParts = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? { kun: m[3], oy: m[2], yil: m[1] } : { kun: '', oy: '', yil: '' }; };
const money = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

// Zakazlarni tayyorlash: chap tomon to'ldiriladi, o'ng tomon (yuk jadvallari) o'zgartirilmay olinadi.
// loads: zakazlar; modelDocx(modelId) -> Buffer | null (shu modelning Word fayli)
async function prepare(loads, modelDocx) {
  const cache = new Map();
  const get = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const buf = modelDocx(id);
    let d = null;
    if (buf) { try { d = await loadDocx(buf); } catch { d = null; } }
    cache.set(id, d);
    return d;
  };
  const orders = [];
  for (const l of loads) {
    const merged = [];
    (l.skladItems || []).forEach((i) => {
      if (i.yonalish === 'matras') return;
      const key = i.modelId || i.model;
      const ex = merged.find((m) => m.key === key);
      if (ex) ex.soni += Number(i.soni) || 0; else merged.push({ key, modelId: i.modelId, model: i.model, soni: Number(i.soni) || 0 });
    });
    const parts = [];
    for (const m of merged) parts.push({ ...m, d: m.modelId ? await get(m.modelId) : null });
    orders.push({ l, parts });
  }
  const baseAny = orders.flatMap((o) => o.parts).map((p) => p.d).find((d) => d);
  if (!baseAny) {
    const e = new Error("Zakazdagi modellarga Word fayl biriktirilmagan. Avval Sklad → Mebel → model → «📄 Word» orqali nakladnoy faylini yuklang");
    e.status = 400; throw e;
  }
  const items = orders.map((o) => {
    const withDoc = o.parts.find((p) => p.d);
    const src = withDoc ? withDoc.d : baseAny; // chap tomon: zakazdagi birinchi Word faylidan
    const l = o.l;
    const modelText = o.parts.map((p) => (p.soni > 1 ? `${p.model} ×${p.soni}` : p.model)).join(', ') || l.nomi || '';
    const addr = [l.manzil && l.manzil.hudud, [l.manzil && l.manzil.dom ? `dom ${l.manzil.dom}` : '', l.manzil && l.manzil.padyez ? `${l.manzil.padyez}-padyez` : '', l.manzil && l.manzil.etaj ? `${l.manzil.etaj}-etaj` : ''].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    const d = sanaParts(l.sana);
    const vals = {
      model: modelText, tel1: l.tel1 || '', tel2: l.tel2 || '', adres: addr,
      ostatka: l.astatka ? money(l.astatka) : '', kun: d.kun, oy: d.oy, yil: d.yil,
      mijoz: l.mijoz || '', ustanovshik: (l.zborshik && l.zborshik.ism) || '', haydovchi: (l.labo && l.labo.haydovchi) || '',
    };
    const leftClones = src.left.map((n) => src.doc.importNode(n, true));
    fillLeft(src.doc, leftClones, vals);
    leftClones.forEach(cleanForImport);
    const right = [];
    o.parts.forEach((p) => {
      if (p.d) p.d.right.forEach((n) => { const c = p.d.doc.importNode(n, true); cleanForImport(c); right.push({ node: c, d: p.d }); });
      else right.push({ note: `${p.model} — Word fayl biriktirilmagan` });
    });
    return { src, leftClones, right };
  });
  return { baseAny, items };
}

// Word fayl (.docx): hamma zakaz bitta faylda, har biri alohida varaqdan
async function build(loads, modelDocx) {
  const { baseAny, items } = await prepare(loads, modelDocx);
  // Chiqish hujjati: birinchi Word fayl asos (uslublar, sahifa sozlamalari shundan)
  const out = await loadDocx(await baseAny.zip.generateAsync({ type: 'nodebuffer' }));
  const outBody = out.body;
  els(outBody).forEach((n) => outBody.removeChild(n));
  const sectTemplate = out.sectPr ? out.sectPr.cloneNode(true) : null;
  const tmpl = out.doc;

  items.forEach((it, oi) => {
    it.leftClones.forEach((n) => outBody.appendChild(tmpl.importNode(n, true)));
    const rightNodes = it.right.map((r) => (r.node ? tmpl.importNode(r.node, true) : plainPara(tmpl, r.note, { bold: true, size: 24 })));
    if (rightNodes.length) {
      const lead = addColumnBreak(tmpl, rightNodes[0]);
      if (lead) outBody.appendChild(lead);
      rightNodes.forEach((n) => outBody.appendChild(n));
    }
    if (oi < items.length - 1) {
      const p = plainPara(tmpl, '');
      if (sectTemplate) { const pPr = first(p, 'pPr'); pPr.appendChild(tmpl.importNode(sectTemplate, true)); }
      outBody.appendChild(p);
    } else {
      outBody.appendChild(tinyPara(tmpl));
    }
  });
  if (sectTemplate) outBody.appendChild(sectTemplate);

  let xml = new XMLSerializer().serializeToString(out.doc);
  xml = XML_DECL + xml.replace(/^<\?xml[^>]*\?>\s*/, ''); // deklaratsiya faqat bitta va eng boshida bo'lsin
  out.zip.file('word/document.xml', xml);
  // Papka yozuvlarisiz yangi ZIP (Word'ni bezovta qilmasin): faqat fayllar ko'chiriladi, [Content_Types].xml birinchi
  const clean = new JSZip();
  const names = Object.keys(out.zip.files).filter((n) => !out.zip.files[n].dir).sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
  for (const n of names) clean.file(n, await out.zip.files[n].async('nodebuffer'), { createFolders: false });
  return clean.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Brauzerdan chop etish uchun HTML: har bir zakaz — alohida varaq (chap: to'ldirilgan nakladnoy, o'ng: yuk jadvallari)
async function buildHtml(loads, modelDocx) {
  const { baseAny, items } = await prepare(loads, modelDocx);
  const sp = baseAny.sectPr;
  const g = (name, a, d) => { const e = sp && first(sp, name); const v = e ? Number(e.getAttributeNS(W, a) || e.getAttribute('w:' + a)) : NaN; return Number.isFinite(v) ? v : d; };
  const pw = g('pgSz', 'w', 16838); const ph = g('pgSz', 'h', 11906);
  const mT = g('pgMar', 'top', 400); const mR = g('pgMar', 'right', 400); const mB = g('pgMar', 'bottom', 400); const mL = g('pgMar', 'left', 400);
  const gap = g('cols', 'space', 708);
  const colW = (pw - mL - mR - gap) / 2;
  const t = (v) => (v / 20).toFixed(2);
  const mm = (v) => (v * 25.4 / 1440).toFixed(2);
  const sheets = items.map((it) => {
    const left = toHtml(it.leftClones, it.src.styles);
    const right = it.right.map((r) => (r.node ? toHtml([r.node], r.d.styles) : `<p style="margin:6pt 0;font:700 12pt Arial,sans-serif">${String(r.note).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)).join('');
    return `<section class="nk-sheet" style="width:${t(pw - mL - mR)}pt"><div class="nk-col" style="width:${t(colW)}pt">${left}</div><div class="nk-col" style="width:${t(colW)}pt;margin-left:${t(gap)}pt">${right}</div></section>`;
  });
  return { html: sheets.join(''), page: { w: mm(pw), h: mm(ph), mt: mm(mT), mr: mm(mR), mb: mm(mB), ml: mm(mL) } };
}

module.exports = { build, buildHtml, analyze };
