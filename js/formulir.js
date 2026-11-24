/* E-IASMKP — Unduh "Formulir Kriteria" (xlsx) dari template referensi 2025.
 * Template = berkas Excel asli (CHECKLIST / GAP ANALYSIS / PICA); yang diubah hanya isi sel.
 * Berjalan di browser (JSZip global) dan Node (untuk uji). Tanpa server, tanpa data keluar dari perangkat.
 *
 * Formulir.build(JSZip, templateBuffer, data) -> Promise<Uint8Array>
 *   data = { nilai: { KODE: {n:number|undefined, na:bool} }, maks: { KODE: number }, pica: [{nomor,uraian,akar,koreksi,pic,target,status}] }
 */
(function (root) {
  'use strict';
  var KODE = /^[IVX]+\.\d+(\.\d+)?$/;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function colNum(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + c.charCodeAt(i) - 64; return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  /* ---------- sel ---------- */
  function cellRe(ref) { return new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)'); }
  function styleOf(attrs) { var m = /\ss="(\d+)"/.exec(attrs || ''); return m ? ' s="' + m[1] + '"' : ''; }
  function setCell(xml, ref, c) {
    var re = cellRe(ref), m = re.exec(xml), s = m ? styleOf(m[1]) : '', out;
    if (c === null) out = '<c r="' + ref + '"' + s + '/>';
    else if (c.f !== undefined) out = '<c r="' + ref + '"' + s + (c.str ? ' t="str"' : (c.err ? ' t="e"' : '')) + '><f>' + esc(c.f) + '</f>' + (c.v === undefined ? '' : '<v>' + esc(c.v) + '</v>') + '</c>';
    else if (typeof c.v === 'number') out = '<c r="' + ref + '"' + s + '><v>' + c.v + '</v></c>';
    else out = '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.v) + '</t></is></c>';
    if (!m) throw new Error('Sel ' + ref + ' tidak ada di template');
    return xml.replace(re, function () { return out; });
  }

  /* ---------- model + evaluator rumus ---------- */
  function parseSheet(xml, sst) {
    var cells = {};
    xml.replace(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (_, ref, at, body) {
      if (!body) return '';
      var f = /<f[^>]*>([^<]*)<\/f>/.exec(body), v = /<v>([^<]*)<\/v>/.exec(body), is = /<t[^>]*>([^<]*)<\/t>/.exec(body), o = {};
      if (f) o.f = f[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (/t="s"/.test(at) && v) o.v = sst[+v[1]]; else if (/t="inlineStr"/.test(at) && is) o.v = is[1]; else if (v && !/t="(str|e)"/.test(at)) o.v = Number(v[1]);
      if (!f || o.v !== undefined) cells[ref] = o; else cells[ref] = o;
      return '';
    });
    return cells;
  }
  function Evaluator(sheets) {
    var memo = {}, busy = {};
    function val(sh, ref) {
      var key = sh + '!' + ref; if (key in memo) return memo[key];
      var c = (sheets[sh] || {})[ref]; if (!c) return (memo[key] = '');
      if (c.f === undefined) return (memo[key] = c.v === undefined ? '' : c.v);
      if (busy[key]) throw new Error('#REF!'); busy[key] = 1;
      try { memo[key] = evalF(sh, c.f); } catch (e) { memo[key] = { err: e.message || '#VALUE!' }; }
      delete busy[key]; return memo[key];
    }
    function range(sh, a, b) {
      var ma = /^([A-Z]+)(\d+)$/.exec(a), mb = /^([A-Z]+)(\d+)$/.exec(b), out = [];
      for (var r = +ma[2]; r <= +mb[2]; r++) for (var c = colNum(ma[1]); c <= colNum(mb[1]); c++) out.push(val(sh, colName(c) + r));
      return out;
    }
    function evalF(sh, f) {
      var p = 0, s = f;
      function ws() { while (s[p] === ' ') p++; }
      function num(x) { if (x && x.err) throw new Error(x.err); if (x === '' || x === undefined) return 0; if (typeof x === 'number') return x; throw new Error('#VALUE!'); }
      function expr() { return cmp(); }
      function cmp() { var l = add(); ws(); if (s[p] === '=') { p++; var r = add(); return (String(l).toUpperCase() === String(r).toUpperCase()) ? 1 : 0; } return l; }
      function add() { var l = mul(); for (;;) { ws(); if (s[p] === '+') { p++; l = num(l) + num(mul()); } else if (s[p] === '-') { p++; l = num(l) - num(mul()); } else return l; } }
      function mul() { var l = un(); for (;;) { ws(); if (s[p] === '*') { p++; l = num(l) * num(un()); } else if (s[p] === '/') { p++; var d = num(un()); if (d === 0) throw new Error('#DIV/0!'); l = num(l) / d; } else return l; } }
      function un() { ws(); if (s[p] === '-') { p++; return -num(un()); } return atom(); }
      function atom() {
        ws(); var m;
        if (s[p] === '(') { p++; var v = expr(); ws(); p++; return v; }
        if (s[p] === '"') { var e = s.indexOf('"', p + 1), t = s.slice(p + 1, e); p = e + 1; return t; }
        var rest = s.slice(p);
        if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest))) { p += m[0].length; return Number(m[0]); }
        if ((m = /^(SUM|IF|COUNTIF)\(/.exec(rest))) { p += m[0].length; return call(m[1]); }
        if ((m = /^(?:('[^']+'|[A-Za-z_]+)!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/.exec(rest))) {
          p += m[0].length; var shn = m[1] ? m[1].replace(/'/g, '') : sh;
          if (m[4]) return { rng: range(shn, m[2] + m[3], m[4] + m[5]) };
          return val(shn, m[2] + m[3]);
        }
        throw new Error('#NAME?');
      }
      function args() { var a = []; ws(); if (s[p] === ')') { p++; return a; } for (;;) { a.push(expr()); ws(); if (s[p] === ',') { p++; continue; } if (s[p] === ')') { p++; return a; } throw new Error('#VALUE!'); } }
      function call(fn) {
        if (fn === 'IF') { // evaluasi malas
          var c = expr(); ws(); p++; var a = expr(); ws(); var b = ''; if (s[p] === ',') { p++; b = expr(); } ws(); p++;
          return (c === true || (typeof c === 'number' && c !== 0)) ? a : b;
        }
        var a2 = args();
        if (fn === 'SUM') { var t = 0; a2.forEach(function (x) { if (x && x.rng) x.rng.forEach(function (y) { if (y && y.err) throw new Error(y.err); if (typeof y === 'number') t += y; }); else t += num(x); }); return t; }
        if (fn === 'COUNTIF') { var n = 0, key = String(a2[1]).toUpperCase(); a2[0].rng.forEach(function (y) { if (typeof y === 'string' && y !== '' && y.toUpperCase() === key) n++; }); return n; }
      }
      var res = expr(); return res && res.rng ? 0 : res;
    }
    return { val: val };
  }
  function cachedCell(c, ev, sh, ref) { // → {f, v, str, err}
    var r = ev.val(sh, ref), o = { f: c.f };
    if (r && r.err) { o.err = 1; o.v = r.err; } else if (typeof r === 'string') { o.str = 1; o.v = r; } else o.v = r;
    return o;
  }
  function recalcSheet(xml, sh, cells, ev) { // tulis ulang <v> semua sel berumus
    return xml.replace(/<c r="([A-Z]+\d+)"([^>]*?)>(<f[^>]*>[^<]*<\/f>|<f[^>]*\/>)(?:<v>[^<]*<\/v>)?<\/c>/g, function (all, ref, at) {
      var c = cells[ref]; if (!c || c.f === undefined) return all;
      var o = cachedCell(c, ev, sh, ref), s = styleOf(at);
      return '<c r="' + ref + '"' + s + (o.str ? ' t="str"' : (o.err ? ' t="e"' : '')) + '><f>' + esc(o.f) + '</f><v>' + esc(o.v) + '</v></c>';
    });
  }

  /* ---------- peta baris CHECKLIST ---------- */
  function mapRows(xml, sst) {
    var rows = [], re = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, m;
    while ((m = re.exec(xml))) {
      var o = { r: +m[1], c: {} };
      m[2].replace(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (_, col, at, b) {
        if (!b) return ''; var v = /<v>([^<]*)<\/v>/.exec(b), f = /<f/.test(b);
        o.c[col] = { s: v ? (/t="s"/.test(at) ? sst[+v[1]] : v[1]) : '', f: f }; return '';
      });
      rows.push(o);
    }
    var out = {}, byR = {};
    rows.forEach(function (o) { byR[o.r] = o; });
    rows.forEach(function (o) {
      var D = (o.c.D && String(o.c.D.s).trim()) || '', C = (o.c.C && String(o.c.C.s).trim()) || '';
      if (o.r < 8 || (!o.c.I && !o.c.J)) return;
      if (KODE.test(D) && o.c.J) out[D] = { r: o.r, t: 'leaf' };                                   // sub-sub elemen (J/L)
      else if (KODE.test(C) && o.c.D && !KODE.test(D) && o.c.I) {                                   // sub elemen: induk (punya anak) atau tanpa anak (I/K)
        var nx = byR[o.r + 1], nd = nx && nx.c.D ? String(nx.c.D.s).trim() : '';
        if (!(KODE.test(nd) && nd.indexOf(C + '.') === 0)) out[C] = { r: o.r, t: 'sub' };
      }
    });
    return out;
  }

  function serial(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); if (!m) return null; return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5); }
  function rowHeight(texts) { var lines = 1; texts.forEach(function (t) { var w = t[1], s = String(t[0] || ''); var l = 0; s.split(/\n/).forEach(function (p) { l += Math.max(1, Math.ceil(p.length / w)); }); if (l > lines) lines = l; }); return Math.min(400, Math.max(30, lines * 15 + 6)); }

  function build(JSZip, tpl, d) {
    return JSZip.loadAsync(tpl).then(function (z) {
      var get = function (p) { return z.file(p).async('string'); };
      return Promise.all([get('xl/sharedStrings.xml'), get('xl/worksheets/sheet1.xml'), get('xl/worksheets/sheet2.xml'), get('xl/worksheets/sheet3.xml'), get('xl/workbook.xml'), get('xl/charts/chart1.xml'), get('[Content_Types].xml'), get('xl/_rels/workbook.xml.rels')]).then(function (a) {
        var sst = (a[0].match(/<si>[\s\S]*?<\/si>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); });
        var s1 = a[1], s2 = a[2], s3 = a[3], wb = a[4], ch = a[5], ct = a[6], rels = a[7];
        var map = mapRows(s1, sst), nilai = d.nilai || {}, maks = d.maks || {};

        /* --- CHECKLIST: nilai audit + N/A (ditentukan auditor) + nilai maks --- */
        Object.keys(map).forEach(function (kode) {
          var m = map[kode], n = nilai[kode] || {}, leaf = m.t === 'leaf', vc = leaf ? 'L' : 'K', mc = leaf ? 'J' : 'I', r = m.r, mx = maks[kode];
          if (mx === undefined) return;
          s1 = setCell(s1, mc + r, { f: 'IF(' + vc + r + '="N/A","N/A",' + mx + ')' });
          if (n.na) s1 = setCell(s1, vc + r, { v: 'N/A' });
          else if (typeof n.n === 'number' && isFinite(n.n)) s1 = setCell(s1, vc + r, { v: n.n });
          else s1 = setCell(s1, vc + r, null);
        });

        /* --- GAP ANALYSIS: rumus asli dipertahankan (dijadikan eksplisit) --- */
        s2 = s2.replace(/<f t="shared"[^>]*\/>/g, '').replace(/<f t="shared"[^>]*>([^<]*)<\/f>/g, '<f>$1</f>');
        for (var i = 5; i <= 11; i++) s2 = setCell(s2, 'F' + i, { f: 'SUM(E' + i + '/D' + i + ')' });

        /* --- PICA --- */
        var P = d.pica || [], head = s3.slice(0, s3.indexOf('<row r="6"')), rows6 = /<row r="6"[\s\S]*?<\/row>/.exec(s3)[0], tail = s3.slice(s3.indexOf('</sheetData>'));
        var body = '', n = P.length, last = Math.max(7, 6 + n);
        P.forEach(function (p, i) {
          var r = 7 + i, t = serial(p.target), h = rowHeight([[p.uraian, 55], [p.akar, 30], [p.koreksi, 38], [p.pic, 14]]);
          body += '<row r="' + r + '" spans="2:9" ht="' + h + '" customHeight="1"><c r="B' + r + '" s="4"><v>' + (i + 1) + '</v></c>' +
            '<c r="C' + r + '" s="4" t="inlineStr"><is><t xml:space="preserve">' + esc(p.nomor || '') + '</t></is></c>' +
            ['D:131:uraian', 'E:131:akar', 'F:131:koreksi', 'G:128:pic'].map(function (q) { q = q.split(':'); return '<c r="' + q[0] + r + '" s="' + q[1] + '" t="inlineStr"><is><t xml:space="preserve">' + esc(p[q[2]] || '') + '</t></is></c>'; }).join('') +
            (t === null ? '<c r="H' + r + '" s="129"/>' : '<c r="H' + r + '" s="129"><v>' + t + '</v></c>') +
            '<c r="I' + r + '" s="130" t="inlineStr"><is><t>' + (p.status === 'Closed' ? 'Closed' : 'Open') + '</t></is></c></row>';
        });
        if (!n) body = '<row r="7" spans="2:9"><c r="B7" s="4"/><c r="C7" s="4"/><c r="D7" s="131"/><c r="E7" s="131"/><c r="F7" s="131"/><c r="G7" s="128"/><c r="H7" s="129"/><c r="I7" s="130"/></row>';
        head = head.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="B2:I' + last + '"/>');
        tail = tail.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, '').replace(/<autoFilter ref="[^"]*"/, '<autoFilter ref="B6:I' + last + '"').replace(/sqref="I7:I\d+"/, 'sqref="I7:I' + last + '"');
        s3 = head + rows6 + body + tail;
        s3 = setCell(s3, 'I2', { f: 'COUNTIF(I7:I' + last + ',"Open")' });
        s3 = setCell(s3, 'I3', { f: 'COUNTIF(I7:I' + last + ',"Closed")' });

        /* --- hitung ulang nilai tersimpan (cache) agar benar di semua pembaca --- */
        var sheets = { CHECKLIST: parseSheet(s1, sst), 'GAP ANALYSIS': parseSheet(s2, sst), PICA: parseSheet(s3, sst) };
        // sel sel-berumus pada sheet yg baru dibuat via setCell sudah ber-<f>; parseSheet menangkapnya
        var ev = Evaluator(sheets);
        s1 = recalcSheet(s1, 'CHECKLIST', sheets.CHECKLIST, ev); s2 = recalcSheet(s2, 'GAP ANALYSIS', sheets['GAP ANALYSIS'], ev); s3 = recalcSheet(s3, 'PICA', sheets.PICA, ev);
        /* --- cache grafik radar --- */
        var pts = ''; for (var k = 5; k <= 11; k++) { var v = ev.val('GAP ANALYSIS', 'F' + k); pts += '<c:pt idx="' + (k - 5) + '"><c:v>' + (typeof v === 'number' ? v : 0) + '</c:v></c:pt>'; }
        ch = ch.replace(/(<c:f>'GAP ANALYSIS'!\$F\$5:\$F\$11<\/c:f><c:numCache><c:formatCode>[^<]*<\/c:formatCode><c:ptCount val="7"\/>)[\s\S]*?(<\/c:numCache>)/, function (_, h, t) { return h + pts + t; });
        /* --- calcChain dibuang, hitung ulang saat dibuka --- */
        wb = wb.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
        ct = ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''); rels = rels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, '');
        z.remove('xl/calcChain.xml');
        z.file('xl/worksheets/sheet1.xml', s1); z.file('xl/worksheets/sheet2.xml', s2); z.file('xl/worksheets/sheet3.xml', s3);
        z.file('xl/workbook.xml', wb); z.file('xl/charts/chart1.xml', ch); z.file('[Content_Types].xml', ct); z.file('xl/_rels/workbook.xml.rels', rels);
        return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      });
    });
  }
  root.Formulir = { build: build, _map: mapRows, _eval: Evaluator, _parse: parseSheet };
  if (typeof module !== 'undefined') module.exports = root.Formulir;
})(typeof window !== 'undefined' ? window : globalThis);
