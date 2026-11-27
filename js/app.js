/* =====================================================================
   E-IASMKP — Frontend statis (GitHub Pages) + REST API Google Apps Script
   SPA murni · optimistic UI · antrean idempoten (localStorage) · fetch dedupe ·
   polling adaptif berbasis versi data · PWA (offline render dari snapshot).
   ===================================================================== */
'use strict';

/* ---------------------------- Utilitas dasar ---------------------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const nowIso = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
const todayIso = () => nowIso().slice(0, 10);
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtD = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + ' ' + BLN[+m[2] - 1] + ' ' + m[1] : '-'; };
const fmtDT = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? fmtD(iso) + ', ' + m[4] + ':' + m[5] : fmtD(iso); };
const daysTo = iso => { if (!iso) return null; const a = new Date(String(iso).slice(0, 10) + 'T00:00:00'), b = new Date(todayIso() + 'T00:00:00'); return Math.round((a - b) / 864e5); };
const pct = (n, d) => d ? n / d * 100 : 0;
const f1 = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const f0 = n => String(Math.round(n));
const debounce = (fn, ms) => { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; };
const lc = s => String(s || '').trim().toLowerCase();
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kuota/penyimpanan diblokir → abaikan */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } }
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { } }
};
const ROLE_LABEL = { ADMIN: 'Admin HSE/SMKP', LEAD: 'Lead Auditor', AUDITOR: 'Auditor Internal', AUDITEE: 'Auditee / PIC', PJO: 'PJO / Manajemen' };
const KAT = { Kritikal: 'crit', Mayor: 'maj', Minor: 'min', OFI: 'info' };

/* ------------------------------- State -------------------------------- */
const S = {
  token: null, user: null, d: null,         // d = data bootstrap
  nilai: {},                                // { auditId: { kode: {n, c, s} } }
  audit: null, page: 'dashboard', el: null, // audit aktif, halaman, elemen aktif (checklist)
  dirty: {}, filters: { t: { q: '', kat: '', el: '', st: '', lok: '', dep: '' }, p: { tab: 'all' }, m: { tab: 'kriteria', q: '' }, u: { q: '' } },
  openRows: {}, upl: [], sync: 'ok', loaded: false, dv: null
};
const Q = { items: [], busy: false, timer: null };

/* Tabel → kunci array di S.d dan kunci unik */
const TBL = {
  Audit: ['audits', 'ID'], Penugasan: ['penugasan', 'ID'], Temuan: ['temuan', 'ID'], Tindak_Lanjut: ['pica', 'ID'],
  Praktik_Baik: ['praktik', 'ID'], Pertemuan: ['pertemuan', 'ID'], Kehadiran: ['kehadiran', 'ID'], Respon_Audit: ['respon', 'ID'],
  Bukti: ['bukti', 'ID'], M_Kriteria: ['kriteria', 'Kode']
};

/* ------------------------------ Jaringan (REST) ------------------------------ */
// POST wajib text/plain agar tidak memicu preflight CORS (GAS menolak OPTIONS). Token di body, bukan URL.
const GAS_OK = () => typeof GAS_URL === 'string' && /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]+\/exec$/.test(GAS_URL);
const TOK = {
  get() { try { return localStorage.getItem('iasmkp_tok'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('iasmkp_tok', v); } catch (e) { } },
  del() { try { localStorage.removeItem('iasmkp_tok'); } catch (e) { } }
};
const API_TIMEOUT = 45000;
const READS = /^(bootstrap|ver|filePreview|deScan)$/;
const _inflight = {}; let _epoch = 0;
async function apiRaw(action, payload) {
  if (!GAS_OK()) return { success: false, net: true, message: 'GAS_URL belum diisi di js/config.js.' };
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), API_TIMEOUT);
  try {
    const res = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: S.token, payload: payload || {} }), signal: ctl.signal, redirect: 'follow' });
    const r = await res.json(); return r || { success: false, net: true, message: 'Respons kosong.' };
  } catch (e) { return { success: false, net: true, message: e && e.name === 'AbortError' ? 'Server lambat merespons.' : 'Tidak terhubung ke server.' }; }
  finally { clearTimeout(tm); }
}
/** Pembacaan identik yang sedang berjalan berbagi satu promise; tulis menaikkan epoch (tak ada berbagi lintas tulis). */
function api(action, payload) {
  const isRead = READS.test(action); if (!isRead) _epoch++;
  const k = isRead ? _epoch + '|' + action + '|' + JSON.stringify(payload || {}) : null;
  if (k && _inflight[k]) return _inflight[k];
  const p = apiRaw(action, payload).then(r => { if (!isRead) trackVer(r); return r; });
  if (k) { _inflight[k] = p; const done = () => { delete _inflight[k]; }; p.then(done, done); }
  return p;
}
/** Versi data: tulis kita sendiri tidak memicu unduh ulang, tulis orang lain terdeteksi lewat polling 'ver'. */
function trackVer(r) { if (r && r.dv) { if (!S.dv || r.dvp === S.dv) S.dv = r.dv; } return r; }

/* --------------------------- Toast / Modal / Dialog --------------------------- */
function toast(msg, type, ms) {
  const el = document.createElement('div'); el.className = 'toast ' + (type || '');
  el.innerHTML = '<span class="ms sm">' + (type === 'ok' ? 'check_circle' : type === 'err' ? 'error' : type === 'warn' ? 'warning' : 'info') + '</span><span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms || 3600);
}
function openModal(html, opt) {
  opt = opt || {}; closeModal();
  const ov = document.createElement('div'); ov.className = 'overlay' + (opt.drawer ? ' drawer-ov' : ''); ov.id = 'ovl';
  ov.innerHTML = opt.drawer ? '<div class="drawer" role="dialog" aria-modal="true">' + html + '</div>'
    : '<div class="modal ' + (opt.wide ? 'wide' : opt.sm ? 'sm' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  ov.addEventListener('mousedown', e => { if (e.target === ov && !opt.sticky) closeModal(); });
  $('#layer').appendChild(ov);
  const f = $('input:not([type=hidden]),textarea,select', ov); if (f && !opt.drawer && window.innerWidth > 700) f.focus();
  return ov;
}
function closeModal() { const o = $('#ovl'), had = S.drawer; if (o) o.remove(); S.drawer = null; if (had && S.d) go(S.page); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function mHead(title, icon) { return '<div class="m-head"><h3 class="flex"><span class="ms">' + (icon || 'edit_note') + '</span>' + esc(title) + '</h3><button class="iconbtn" onclick="closeModal()" aria-label="Tutup"><span class="ms">close</span></button></div>'; }
function dialog(title, body, okLabel, okClass) {
  return new Promise(res => {
    const ov = openModal(mHead(title, 'help') + '<div class="m-body">' + body + '</div><div class="m-foot"><button class="btn ghost" id="dgNo">Batal</button><button class="btn ' + (okClass || 'primary') + '" id="dgOk">' + esc(okLabel || 'OK') + '</button></div>', { sm: true, sticky: true });
    $('#dgNo', ov).onclick = () => { closeModal(); res(null); };
    $('#dgOk', ov).onclick = () => { const v = $('#dgIn', ov); const val = v ? v.value.trim() : true; closeModal(); res(val === '' ? null : val); };
  });
}
const confirmBox = (title, msg, ok, cls) => dialog(title, '<div>' + msg + '</div>', ok, cls);

/* --------------------- Indeks & data turunan (lokal) --------------------- */
function krMap() { if (!S._kr) { S._kr = {}; S.d.kriteria.forEach(k => S._kr[k.Kode] = k); } return S._kr; }
function elMap() { const m = {}; S.d.elemen.forEach(e => m[e.Kode] = e); return m; }
const rootOf = kode => String(kode).split('.')[0];
const subOf = kode => String(kode).split('.').slice(0, 2).join('.');
const unitKr = () => S.d.kriteria.filter(k => k.Unit && k.Aktif);
function auditById(id) { return S.d.audits.find(a => a.ID === id) || null; }
function curAudit() { return auditById(S.audit); }
function nilaiOf(aid) { return S.nilai[aid] || (S.nilai[aid] = {}); }
const isNA = (aid, kode) => { const v = (S.nilai[aid] || {})[kode]; return !!(v && v.a); };
function nmap(aid) { const o = {}, n = nilaiOf(aid); Object.keys(n).forEach(k => { if (n[k].n !== '' && n[k].n !== null && n[k].n !== undefined) o[k] = n[k].n; }); return o; }
const P = k => (S.d && S.d.params && S.d.params[k]) || '';

/* ----------------------- Skor & kategori (cermin server) ----------------------- */
function hitungSkor(aid) {
  const nm = nmap(aid); let total = 0; const per = [];
  S.d.elemen.forEach(e => {
    let mx = 0, sk = 0, terisi = 0, n = 0;
    unitKr().forEach(k => {
      if (k.Elemen !== e.Kode || isNA(aid, k.Kode)) return;
      n++; mx += k.NilaiMaks;
      const v = nm[k.Kode]; if (v !== undefined) { sk += Math.max(0, Math.min(k.NilaiMaks, Number(v))); terisi++; }
    });
    const p = mx ? sk / mx : 0; total += p * e.Bobot;
    per.push({ kode: e.Kode, nama: e.Nama, bobot: e.Bobot, max: mx, skor: sk, persen: p * 100, terisi, butir: n });
  });
  return { total: total * 100, per, terisi: per.reduce((a, b) => a + b.terisi, 0), butir: per.reduce((a, b) => a + b.butir, 0) };
}
function persenSub(aid) {
  const nm = nmap(aid), m = {};
  unitKr().forEach(k => {
    if (isNA(aid, k.Kode)) return; const s = subOf(k.Kode); m[s] = m[s] || { mx: 0, sk: 0, terisi: 0 };
    m[s].mx += k.NilaiMaks; const v = nm[k.Kode]; if (v !== undefined) { m[s].sk += Math.min(k.NilaiMaks, Number(v)); m[s].terisi++; }
  });
  Object.keys(m).forEach(s => m[s].persen = m[s].mx ? m[s].sk / m[s].mx * 100 : 0);
  return m;
}
function usulKategori(t) {
  const a = auditById(t.AuditID); if (!a) return { kategori: 'Minor', alasan: '' };
  const sp = persenSub(a.ID), s = subOf(t.Kode), info = sp[s];
  const aS = Number(P('AMBANG_MAYOR_SKOR') || 50), aL = Number(P('AMBANG_MAYOR_LOKASI') || 30);
  if (info && info.terisi > 0 && info.persen < aS) return { kategori: 'Mayor', alasan: 'Skor sub-elemen ' + s + ' = ' + f0(info.persen) + '% (< ' + aS + '%)' };
  const lok = {};
  S.d.temuan.forEach(x => { if (x.AuditID === t.AuditID && x.ID !== t.ID && subOf(x.Kode) === s && x.Kategori !== 'Kritikal' && x.Kategori !== 'Mayor' && x.Lokasi) lok[lc(nLok(x.Lokasi))] = 1; });
  if (t.Lokasi) lok[lc(nLok(t.Lokasi))] = 1;
  const n = Object.keys(lok).length, tot = Number(a.JumlahLokasi) || 0;
  if (tot > 0 && n / tot * 100 > aL) return { kategori: 'Mayor', alasan: 'Temuan minor sub-elemen ' + s + ' di ' + n + ' dari ' + tot + ' lokasi (> ' + aL + '%)' };
  return { kategori: 'Minor', alasan: 'Ketidaksesuaian terhadap peraturan/standar' };
}

/* ------------------------------ Hak akses (cermin) ------------------------------ */
const role = () => S.user ? S.user.role : '';
const isR = (...r) => r.indexOf(role()) > -1;
function assignedEls(aid) {
  const mine = (S.d.penugasan || []).filter(p => p.AuditID === aid && lc(p.Email) === lc(S.user.email));
  const set = {}; mine.forEach(p => { const s = String(p.Elemen || '*'); if (s === '*') set['*'] = 1; else s.split(',').forEach(z => set[z.trim()] = 1); }); return set;
}
function canScore(aid, kode) {
  const a = auditById(aid); if (!a || a.Status !== 'Berjalan') return false;
  if (isR('LEAD')) return true;
  if (isR('AUDITOR')) { const s = assignedEls(aid); return !!(s['*'] || s[rootOf(kode)]); }
  return false;
}
const canAudit = () => isR('ADMIN', 'LEAD');
const canTemuan = () => isR('LEAD', 'AUDITOR');

/* -------------------- Penyimpanan lokal (snapshot + antrean) -------------------- */
const persistQ = () => ls.set('iasmkp_q', Q.items);
function snapshot() { if (!S.d) return; ls.set('iasmkp_snap', { user: S.user, d: S.d, nilai: S.nilai, audit: S.audit, dv: S.dv, t: Date.now() }); }
const snapSoon = debounce(snapshot, 700);

/** Terapkan perubahan ke state lokal (dipakai untuk optimistic update & replay antrean). */
function applyLocal(t, r, del) {
  if (t === 'Penilaian') {
    const n = nilaiOf(r.AuditID);
    n[r.Kode] = { n: r.Nilai === '' ? '' : Number(r.Nilai), c: r.Catatan !== undefined ? r.Catatan : (n[r.Kode] ? n[r.Kode].c : ''), s: r.Selesai !== undefined ? r.Selesai : (n[r.Kode] ? n[r.Kode].s : 0), a: r.NA !== undefined ? (Number(r.NA) ? 1 : 0) : (n[r.Kode] ? n[r.Kode].a : 0), al: r.AlasanNA !== undefined ? r.AlasanNA : (n[r.Kode] ? n[r.Kode].al : '') };
    return;
  }
  const def = TBL[t]; if (!def) return;
  const arr = S.d[def[0]], key = def[1], i = arr.findIndex(x => x[key] === r[key]);
  if (del) { if (i > -1) arr.splice(i, 1); } else if (i > -1) Object.assign(arr[i], r); else arr.push(Object.assign({}, r));
  if (t === 'M_Kriteria') S._kr = null;
}
/** Optimistic: update UI SEKARANG, antre simpan ke server di latar belakang. */
function save(t, r, del) {
  applyLocal(t, r, del);
  Q.items.push({ t, r: JSON.parse(JSON.stringify(r)), del: !!del }); persistQ();
  setSync('pending'); clearTimeout(Q.timer); Q.timer = setTimeout(flush, 900); snapSoon();
}
async function flush() {
  if (Q.busy || !Q.items.length || !S.token) return;
  Q.busy = true; const batch = Q.items.splice(0, Q.items.length); persistQ(); setSync('saving');
  const r = await api('save', { items: batch });
  Q.busy = false;
  if (r.code === 'AUTH') { Q.items = batch.concat(Q.items); persistQ(); sessionExpired(); return; }
  if (!r.success && r.net) { Q.items = batch.concat(Q.items); persistQ(); setSync('offline'); clearTimeout(Q.timer); Q.timer = setTimeout(flush, 8000); return; }
  const rej = r.data && r.data.rejected;
  if (rej && rej.length) { toast(rej[0].msg + (rej.length > 1 ? ' (+' + (rej.length - 1) + ' lainnya)' : ''), 'err', 5200); await resync(); }
  else if (!r.success) { toast(r.message || 'Gagal menyimpan.', 'err', 5200); await resync(); }
  setSync(Q.items.length ? 'pending' : 'ok'); if (Q.items.length) flush();
}
function setSync(st) {
  S.sync = st; const el = $('#sync'); if (!el) return; el.className = 'sync ' + st;
  const nf = S.upl.filter(u => u.st === 'wait').length; $('#syncT').textContent = st === 'ok' ? (window.innerWidth > 700 ? 'Tersimpan otomatis' : 'Tersimpan') : st === 'saving' ? 'Menyimpan…' : st === 'pending' ? 'Perubahan lokal…' : 'Offline · ' + Q.items.length + ' antrean' + (nf ? ' + ' + nf + ' foto' : '');
}
window.addEventListener('online', () => { if (Q.items.length) flush(); flushUploads(); });
window.addEventListener('offline', () => { toast('Tidak ada sinyal. Perubahan dan foto disimpan di HP, dikirim otomatis saat sinyal kembali.', 'warn', 6000); setSync('offline'); });
window.addEventListener('beforeunload', () => { persistQ(); snapshot(); });

/* ----------------------- Bootstrap & sinkronisasi ----------------------- */
function ingest(data) {
  S.d = data; S.user = data.user; S._kr = null; if (data.dv) S.dv = data.dv; if (!S.d.dokumen) S.d.dokumen = [];
  const nn = {}; (data.penilaian || []).forEach(x => { (nn[x[0]] = nn[x[0]] || {})[x[1]] = { n: x[2], c: x[3] || '', s: x[6] ? 1 : 0, a: x[7] ? 1 : 0, al: x[8] || '' }; });
  S.nilai = nn; delete S.d.penilaian;
  try { brandFromParams(); } catch (e) { }
  // replay perubahan yang belum terkirim di atas data server (agar tidak "kembali" sesaat)
  Q.items.forEach(it => { try { applyLocal(it.t, it.r, it.del); } catch (e) { } });
  const sv = ls.get('iasmkp_audit');
  const ok = id => !!auditById(id);
  S.audit = ok(S.audit) ? S.audit : ok(sv) ? sv : ((S.d.audits.find(a => a.Status === 'Berjalan') || S.d.audits[S.d.audits.length - 1] || {}).ID || null);
  S.el = S.el || (S.d.elemen[0] && S.d.elemen[0].Kode);
}
async function resync(force) {
  const r = await api('bootstrap', force || !S.d ? { force: 1 } : { dv: S.dv }); if (r.code === 'AUTH') return sessionExpired();
  if (r.net) { setSync('offline'); return; }
  if (r.success && r.data.unchanged) { if (r.data.dv) S.dv = r.data.dv; if (r.data.user) { S.user = r.data.user; } snapshot(); return; }
  if (r.success) { ingest(r.data); paintUser(); renderAll(); snapshot(); if (S.sync === 'offline') setSync('ok'); }
}
/** Polling murah (aksi 'ver'): aktif 20 dtk, diam 60 dtk, berhenti saat tab tersembunyi / sedang mengetik / ada antrean. */
let _lastAct = Date.now(), _pollT = null;
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { _lastAct = Date.now(); }, { passive: true }));
function typing() { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('.page')); }
async function pollVer() {
  clearTimeout(_pollT);
  try {
    if (S.token && S.d && document.visibilityState === 'visible' && navigator.onLine !== false && !Q.items.length && !Q.busy && !typing()) {
      const r = await api('ver'); if (r.code === 'AUTH') { sessionExpired(); return; }
      if (r.success && r.data.dv && r.data.dv !== S.dv) await resync(); else if (r.net) setSync('offline'); else if (r.success && S.sync === 'offline') setSync('ok');
    }
  } catch (e) { /* abaikan */ }
  _pollT = setTimeout(pollVer, Date.now() - _lastAct < 60000 ? 20000 : 60000);
}
function sessionExpired() { toast('Sesi berakhir. Masuk kembali — perubahan lokal tetap aman.', 'warn', 5000); S.token = null; TOK.del(); showLogin(); }

/* ----------------------------- Navigasi SPA ----------------------------- */
const NAV = [
  ['dashboard', 'Dashboard', 'grid_view', ['ADMIN', 'LEAD', 'AUDITOR', 'AUDITEE', 'PJO']],
  ['jadwal', 'Jadwal & Penugasan', 'event_available', ['ADMIN', 'LEAD', 'AUDITOR', 'PJO']],
  ['checklist', 'Checklist Audit', 'fact_check', ['ADMIN', 'LEAD', 'AUDITOR', 'PJO']],
  ['temuan', 'Temuan (Non-Conform)', 'warning', ['ADMIN', 'LEAD', 'AUDITOR', 'AUDITEE', 'PJO']],
  ['pica', 'Tindak Lanjut PICA', 'task_alt', ['ADMIN', 'LEAD', 'AUDITOR', 'AUDITEE', 'PJO']],
  ['laporan', 'Laporan Audit', 'description', ['ADMIN', 'LEAD', 'AUDITOR', 'PJO']],
  ['master', 'Master Data SMKP', 'database', ['ADMIN', 'LEAD', 'AUDITOR', 'PJO']],
  ['users', 'Manajemen Pengguna', 'manage_accounts', ['ADMIN']]
];
function renderNav() {
  $('#nav').innerHTML = NAV.filter(n => n[3].indexOf(role()) > -1).map(n =>
    '<a data-pg="' + n[0] + '" tabindex="0" role="link"><span class="ms">' + n[2] + '</span><span class="truncate">' + n[1] + '</span>' + (n[0] === 'pica' ? picaBadge() : '') + '</a>').join('');
}
function picaBadge() { const n = overduePica().length; return n ? '<span class="badge">' + n + '</span>' : ''; }
const REND = { dashboard: () => rDashboard(), jadwal: () => rJadwal(), checklist: () => rChecklist(), temuan: () => rTemuan(), pica: () => rPica(), laporan: () => rLaporan(), master: () => rMaster(), users: () => rUsers() };

/** Pindah halaman: tanpa server, tanpa reload. Render hanya bila data berubah (dirty). */
function go(pg) {
  if (!S.d) return;
  const ok = NAV.some(n => n[0] === pg && n[3].indexOf(role()) > -1); if (!ok) pg = 'dashboard';
  S.page = pg;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + pg));
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.pg === pg));
  if (S.dirty[pg] !== false) { try { REND[pg](); } catch (e) { console.error(e); toast('Gagal menampilkan halaman: ' + e.message, 'err'); } S.dirty[pg] = false; }
  closeNav(); window.scrollTo(0, 0); ss.set('iasmkp_pg', pg);
}
function renderAll() { renderNav(); renderAuditSel(); S.dirty = {}; go(S.page || 'dashboard'); }
/** Tandai semua halaman kotor, render halaman aktif segera. */
function touch() { S.dirty = {}; S.dirty[S.page] = true; go(S.page); renderNav(); $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.pg === S.page)); snapSoon(); }
const openNav = () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; };
const closeNav = () => { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; };
function renderAuditSel() {
  const sel = $('#auditSel'); if (!S.d) return;
  sel.innerHTML = S.d.audits.length ? S.d.audits.map(a => '<option value="' + esc(a.ID) + '"' + (a.ID === S.audit ? ' selected' : '') + '>' + esc(a.Nama) + ' · ' + esc(a.Status) + '</option>').join('') : '<option>Belum ada audit</option>';
}

/* ------------------------------ Login / Sesi ------------------------------ */
function showLogin() { $('#app').hidden = true; $('#view-login').hidden = false; $('#boot').hidden = true; closeModal(); $('#lgPass').value = ''; setTimeout(() => $('#lgEmail').focus(), 50); }
function showApp() { $('#view-login').hidden = true; $('#app').hidden = false; $('#boot').hidden = true; }
/* ---- Identitas tampilan (nama, teks, logo) — diatur Admin di Master Data → Logo & identitas ---- */
let BR = {};
function applyBrand(b) {
  if (!b || !b.nama) return; BR = Object.assign({}, BR, b);
  $$('.br-nama').forEach(e => { e.textContent = BR.nama; });
  $$('.br-kata').forEach(e => { e.textContent = String(BR.nama).replace(/^(PT|CV)\.?\s+/i, '').toUpperCase(); });
  $$('.br-sub').forEach(e => { e.textContent = BR.sub || ''; });
  $$('.br-teks').forEach(e => { e.textContent = (BR.teks || '') + (BR.tag ? ' ' : ''); if (BR.tag) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = BR.tag; e.appendChild(t); } });
  $$('img.br-logo').forEach(i => { const src = BR.logo || './logo.png'; if (i.getAttribute('src') !== src) i.src = src; });
  try { document.title = BR.nama + ' — SMKP'; } catch (e) { }
}
async function fetchBrand() {
  if (!GAS_OK()) return;
  try { const r = await (await fetch(GAS_URL + '?action=branding', { cache: 'no-store' })).json(); if (r.success) { BR = {}; applyBrand(r.data); ls.set('iasmkp_brand', r.data); } } catch (e) { }
}
function brandFromParams() {
  if (!S.d || !S.d.params || !S.d.params.NAMA_PERUSAHAAN) return;
  const baru = Object.prototype.hasOwnProperty.call(S.d.params, 'TEKS_HEADER');  // server lama belum punya parameter ini → pakai bawaan
  const b = { nama: P('NAMA_HEADER') || P('NAMA_PERUSAHAAN'), teks: baru ? P('TEKS_HEADER') : 'SMKP System', tag: baru ? P('TAG_HEADER') : '185/2019', sub: baru ? P('SUB_LOGIN') : 'Jasa Pertambangan (IUJP)', logoId: P('LOGO_ID') };
  const ganti = (BR.logoId || '') !== b.logoId; if (ganti) b.logo = '';
  applyBrand(b); if (ganti) fetchBrand(); else ls.set('iasmkp_brand', BR);
}
function paintBrand(b) {
  const adm = isR('ADMIN'); if (!adm) { b.innerHTML = ''; return; }
  const F = [['NAMA_HEADER', 'Nama pada header (kosong = sama dengan Nama perusahaan)'], ['TEKS_HEADER', 'Teks kecil di bawah nama (header aplikasi)'], ['TAG_HEADER', 'Label kecil di samping teks (boleh kosong)'], ['SUB_LOGIN', 'Teks di bawah nama pada halaman masuk']];
  b.innerHTML = '<div class="card"><div class="sec-t">Logo</div><div class="flex" style="gap:16px;align-items:center;flex-wrap:wrap"><div class="mark logo" style="width:84px;height:84px;background:#fff;box-shadow:0 0 0 1px var(--line,#d5d9e4)"><img class="br-logo" src="' + esc(BR.logo || './logo.png') + '" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain"></div>' +
    '<div><div class="flex" style="gap:8px;flex-wrap:wrap"><button class="btn primary" id="lgUp"><span class="ms">upload</span>Unggah logo</button>' + (P('LOGO_ID') ? '<button class="btn ghost" id="lgDel"><span class="ms">restart_alt</span>Kembalikan logo bawaan</button>' : '') + '</div><input type="file" id="lgFile" accept="image/*" hidden>' +
    '<div class="muted sm" style="margin-top:6px">PNG/JPG/WebP, latar transparan lebih baik. Logo dipakai di header, halaman masuk, verifikasi dokumen, dan <b>kop laporan Word</b>.</div></div></div>' +
    '<div class="banner info" style="margin-top:12px"><span class="ms">info</span><div>Pada laporan Word, logo menggantikan gambar logo di template. Template mana pun yang diunggah akan dikenali otomatis bila gambar logonya muncul berulang; untuk kepastian, beri \u201cTeks alternatif\u201d berisi kata LOGO pada gambar logo di Word (klik kanan gambar → Edit Teks Alternatif). Ukuran menyesuaikan kotak logo di template dengan rasio terjaga.</div></div></div>' +
    '<div class="card mt16" style="margin-top:12px"><div class="sec-t">Identitas pada aplikasi</div><div class="rowlist">' + F.map(m => '<div class="field"><label class="label">' + esc(m[1]) + '</label><div class="flex"><input class="input" data-k="' + m[0] + '" value="' + esc(P(m[0])) + '"><button class="btn sm primary" data-k="' + m[0] + '" data-l="0" onclick="saveParam(this)">Simpan</button></div></div>').join('') + '</div></div>';
  $('#lgUp').onclick = () => $('#lgFile').click();
  $('#lgFile').onchange = function () {
    const f = this.files[0]; this.value = ''; if (!f) return; if (!/^image\//.test(f.type)) { toast('Pilih berkas gambar (PNG/JPG/WebP).', 'err'); return; }
    const im = new Image(), url = URL.createObjectURL(f);
    im.onload = async () => {
      const m = 512, k = Math.min(1, m / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const r = await api('uploadLogo', { b64: c.toDataURL('image/png').split(',')[1] });
      if (r.success) { S.d.params.LOGO_ID = r.data.logoId; BR = {}; applyBrand(r.data); ls.set('iasmkp_brand', r.data); toast('Logo tersimpan.', 'ok'); snapSoon(); paintBrand(b); } else toast(r.message, 'err', 6000);
    };
    im.onerror = () => { URL.revokeObjectURL(url); toast('Gambar tidak dapat dibaca.', 'err'); }; im.src = url;
  };
  if ($('#lgDel')) $('#lgDel').onclick = async () => { const c = await confirmBox('Kembalikan logo bawaan?', 'Logo yang diunggah dihapus. Header dan laporan memakai logo bawaan/templatenya lagi.', 'Kembalikan', 'orange'); if (!c) return; const r = await api('hapusLogo'); if (r.success) { S.d.params.LOGO_ID = ''; BR = {}; applyBrand(r.data); ls.set('iasmkp_brand', r.data); toast(r.message, 'ok'); snapSoon(); paintBrand(b); } else toast(r.message, 'err'); };
}
function paintUser() {
  const u = S.user; $('#uName').textContent = u.nama; $('#uRole').textContent = ROLE_LABEL[u.role] || u.role;
  $('#uAvatar').textContent = String(u.nama || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  $('#btnQuickNC').hidden = !canTemuan();
}
async function doLogin(e) {
  e.preventDefault(); const em = $('#lgEmail').value.trim(), pw = $('#lgPass').value, err = $('#lgErr'), btn = $('#lgBtn');
  err.hidden = true; if (!em || !pw) { err.textContent = 'Isi email dan kata sandi.'; err.hidden = false; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px"></span><span>Memeriksa…</span>';
  const r = await api('login', { email: em, password: pw });
  btn.disabled = false; btn.innerHTML = '<span class="ms">login</span><span>Masuk</span>';
  if (!r.success) { err.textContent = r.message || 'Gagal masuk.'; err.hidden = false; return; }
  S.token = r.data.token; TOK.set(S.token); S.dv = null; S.user = r.data.user;
  const old = ls.get('iasmkp_snap'); if (old && old.user && lc(old.user.email) !== lc(S.user.email)) { ls.del('iasmkp_snap'); Q.items = []; persistQ(); }
  $('#boot').hidden = false; await loadData(true);
  if (r.data.user.mustChange) setTimeout(() => pwModal(true), 400);
}
async function loadData(fresh) {
  const r = await api('bootstrap', { force: 1 });
  if (r.code === 'AUTH') { sessionExpired(); return false; }
  if (!r.success) { toast(r.message || 'Gagal memuat data.', 'err', 6000); if (!S.d) showLogin(); return false; }
  ingest(r.data); paintUser(); showApp(); S.page = fresh ? 'dashboard' : (ss.get('iasmkp_pg') || 'dashboard'); renderAll(); snapshot();
  if (Q.items.length) flush(); pollVer(); return true;
}
async function logout() {
  if (pendTotal()) { const ok = await confirmBox('Perubahan belum terkirim', 'Masih ada ' + Q.items.length + ' perubahan dan ' + waitFoto() + ' foto menunggu sinkron. Keluar sekarang menyimpannya di perangkat ini sampai Anda masuk lagi dengan akun yang sama; jangan hapus data browser.', 'Keluar', 'orange'); if (!ok) return; }
  await api('logout'); clearTimeout(_pollT); S.token = null; TOK.del(); ss.del('iasmkp_pg'); ls.del('iasmkp_snap'); S.d = null; showLogin();
}
function pwModal(force) {
  const ov = openModal(mHead('Ganti kata sandi', 'key') + '<div class="m-body">' + (force ? '<div class="banner"><span class="ms">info</span><div>Akun Anda memakai kata sandi sementara. Buat kata sandi baru (min. 8 karakter).</div></div>' : '') +
    '<div class="field"><label class="label">Kata sandi lama</label><input class="input" id="pwOld" type="password" autocomplete="current-password"></div><div class="field"><label class="label">Kata sandi baru</label><input class="input" id="pwNew" type="password" autocomplete="new-password"></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">' + (force ? 'Nanti' : 'Batal') + '</button><button class="btn primary" id="pwGo">Simpan</button></div>', { sm: true });
  $('#pwGo', ov).onclick = async () => {
    const r = await api('changePassword', { lama: $('#pwOld').value, baru: $('#pwNew').value });
    if (r.success) { if (r.data && r.data.token) { S.token = r.data.token; TOK.set(S.token); } toast('Kata sandi diganti.', 'ok'); S.user.mustChange = false; closeModal(); } else toast(r.message, 'err', 5000);
  };
}

/* ------------------------------ Unggah bukti ------------------------------ */
/** Kompres foto di browser (maks 1400px, JPEG 0,72) sebelum dikirim → payload kecil. */
function compressImage(file) {
  return new Promise(res => {
    if (!/^image\//.test(file.type)) { const fr = new FileReader(); fr.onload = () => res({ b64: String(fr.result).split(',')[1], mime: file.type, name: file.name, size: file.size, preview: null }); fr.readAsDataURL(file); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1400, sc = Math.min(1, MAX / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.72); URL.revokeObjectURL(url);
      res({ b64: data.split(',')[1], mime: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg', size: Math.round(data.length * 0.75), preview: data });
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
function pickFile(opts, cb) {
  const inp = $('#fileIn'); inp.value = ''; inp.accept = 'image/*,application/pdf'; if (opts.camera) inp.setAttribute('capture', 'environment'); else inp.removeAttribute('capture');
  inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) cb(f); };
  inp.click();
}
/* Antrean foto/berkas offline: disimpan di IndexedDB HP, dikirim otomatis saat sinyal ada. Server idempoten menurut ID. */
const UQ = {
  db: null,
  open() { return new Promise(res => { if (this.db) return res(this.db); try { const rq = indexedDB.open('iasmkp-up', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('u', { keyPath: 'id' }); rq.onsuccess = () => { this.db = rq.result; res(this.db); }; rq.onerror = () => res(null); } catch (e) { res(null); } }); },
  async tx(mode, fn) { const db = await this.open(); if (!db) return null; return new Promise(res => { try { const t = db.transaction('u', mode), rq = fn(t.objectStore('u')); t.oncomplete = () => res(rq && rq.result !== undefined ? rq.result : true); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); } }); },
  put(rec) { return this.tx('readwrite', s => s.put(rec)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  all() { return this.tx('readonly', s => s.getAll()).then(r => Array.isArray(r) ? r : []); }
};
const waitFoto = () => S.upl.filter(u => u.st === 'wait').length;
const pendTotal = () => Q.items.length + waitFoto();
function syncIdle() { if (S.sync === 'offline' && !pendTotal() && navigator.onLine !== false) setSync('ok'); else if (S.sync === 'offline') setSync('offline'); }
async function uploadEvidence(file, ctx) {
  if (file.size > 20 * 1024 * 1024) { toast('Berkas terlalu besar (maks 20 MB sebelum kompres).', 'err'); return; }
  const c = await compressImage(file); if (!c) { toast('Berkas tidak dapat dibaca.', 'err'); return; }
  if (c.b64.length > 7400000) { toast('Berkas masih terlalu besar setelah kompres (maks ± 5 MB).', 'err'); return; }
  const rec = { id: uid(), name: c.name, mime: c.mime, b64: c.b64, ctx, preview: c.preview, ts: Date.now(), user: lc((S.user || {}).email) };
  const persisted = !!(await UQ.put(rec));
  const item = { id: rec.id, name: c.name, preview: c.preview, st: 'up', ctx };
  S.upl.push(item); repaintEvidence(ctx);
  await sendUpload(item, rec, persisted);
}
async function sendUpload(item, rec, persisted) {
  if (item.sending) return; item.sending = true; item.st = 'up'; repaintEvidence(item.ctx);
  try {
    const r = await api('upload', Object.assign({ id: rec.id, name: rec.name, mime: rec.mime, b64: rec.b64 }, rec.ctx));
    if (r.success) { if (!S.d.bukti.some(b => b.ID === r.data.ID)) S.d.bukti.push(r.data); S.upl = S.upl.filter(x => x !== item); await UQ.del(rec.id); toast('Bukti tersimpan di Drive.', 'ok'); }
    else if (r.code === 'AUTH') { item.st = 'wait'; sessionExpired(); }
    else if (r.net) {
      if (persisted) { item.st = 'wait'; setSync('offline'); toast('Belum ada sinyal. Foto disimpan di HP dan dikirim otomatis nanti.', 'warn', 5000); }
      else { S.upl = S.upl.filter(x => x !== item); toast('Gagal mengunggah dan penyimpanan lokal tidak tersedia. Ulangi saat ada sinyal.', 'err', 6000); }
    } else { S.upl = S.upl.filter(x => x !== item); await UQ.del(rec.id); toast((rec.name || 'Berkas') + ': ' + (r.message || 'Gagal mengunggah.'), 'err', 6000); }
  } finally { item.sending = false; }
  repaintEvidence(item.ctx); snapSoon(); syncIdle();
}
let _upBusy = false;
async function flushUploads() {
  if (_upBusy || !S.token || !S.user || navigator.onLine === false) return; _upBusy = true;
  try {
    if (Q.items.length) { await flush(); if (Q.items.length) return; } // data teks (temuan/PICA) harus tiba lebih dulu
    const me = lc(S.user.email), recs = (await UQ.all()).filter(r => r.user === me).sort((x, y) => x.ts - y.ts);
    for (const rec of recs) {
      let item = S.upl.find(x => x.id === rec.id);
      if (!item) { item = { id: rec.id, name: rec.name, preview: rec.preview, st: 'wait', ctx: rec.ctx }; S.upl.push(item); }
      await sendUpload(item, rec, true); if (item.st === 'wait') break; // masih offline atau sesi habis
    }
  } finally { _upBusy = false; }
  syncIdle();
}
setInterval(() => { if (S.token && navigator.onLine !== false && document.visibilityState === 'visible') flushUploads(); }, 20000);
async function loadPendingUploads() {
  const me = lc((S.user || {}).email || ((ls.get('iasmkp_snap') || {}).user || {}).email); if (!me) return;
  (await UQ.all()).filter(r => r.user === me).forEach(rec => { if (!S.upl.some(x => x.id === rec.id)) S.upl.push({ id: rec.id, name: rec.name, preview: rec.preview, st: 'wait', ctx: rec.ctx }); });
  if (waitFoto()) { setSync(navigator.onLine === false ? 'offline' : S.sync); flushUploads(); }
}
/** Tombol "Siapkan offline": muat ulang data penuh, pastikan tersimpan di HP, minta penyimpanan permanen. */
async function prepOffline() {
  if (navigator.onLine === false) { toast('Perlu sinyal untuk menyiapkan data offline.', 'warn'); return; }
  toast('Menyiapkan data untuk offline…', 'info');
  await flush(); await flushUploads(); await resync(true); snapshot();
  let persist = null; try { if (navigator.storage && navigator.storage.persist) persist = await navigator.storage.persist(); } catch (e) { }
  let sw = false; try { sw = !!(navigator.serviceWorker && await navigator.serviceWorker.getRegistration()); } catch (e) { }
  const a = curAudit(), nT = a ? S.d.temuan.filter(t => t.AuditID === a.ID).length : 0, nB = a ? Object.keys(S.nilai[a.ID] || {}).length : 0;
  const ok = !!S.d && sw;
  toast((ok ? 'Siap offline' : 'Belum sepenuhnya siap') + (a ? ' · ' + a.Nama + ': ' + nB + ' butir dinilai, ' + nT + ' temuan' : '') + '. Aplikasi tersimpan: ' + (sw ? 'ya' : 'belum (buka ulang dengan sinyal)') + ' · Penyimpanan permanen: ' + (persist === null ? 'tidak didukung' : persist ? 'ya' : 'belum diizinkan browser') + '. Jangan logout sebelum label menunjukkan Tersimpan.', ok ? 'ok' : 'warn', 9000);
}
function evidenceOf(ctx) { return S.d.bukti.filter(b => (ctx.temuanId ? b.TemuanID === ctx.temuanId : (b.AuditID === ctx.auditId && b.Kode === ctx.kode && !b.TemuanID)) && (!ctx.tindakId || b.TindakID === ctx.tindakId)); }
function evidenceHtml(ctx, canAdd) {
  const key = esc(JSON.stringify(ctx));
  const items = evidenceOf(ctx).map(b => '<div class="ev" data-bid="' + esc(b.ID) + '" onclick="previewBukti(this.dataset.bid)"><span class="ms">' + (/pdf/.test(b.Mime) ? 'picture_as_pdf' : 'image') + '</span><span class="truncate nm sm b">' + esc(b.Nama) + '</span></div>').join('');
  const up = S.upl.filter(u => JSON.stringify(u.ctx) === JSON.stringify(ctx)).map(u => '<div class="ev up">' + (u.preview ? '<img src="' + u.preview + '" alt="" width="32" height="32" style="object-fit:cover;border-radius:4px">' : '<span class="ms">upload_file</span>') + '<span class="sm">' + (u.st === 'wait' ? 'Menunggu sinyal…' : 'Mengunggah…') + '</span></div>').join('');
  const add = canAdd ? '<button class="ev btn ghost sm" data-ctx="' + key + '" onclick="addEvidence(this,true)"><span class="ms sm">photo_camera</span>Foto</button><button class="ev btn ghost sm" data-ctx="' + key + '" onclick="addEvidence(this,false)"><span class="ms sm">attach_file</span>Berkas</button>' : '';
  return '<div class="evid" data-evctx="' + key + '">' + items + up + add + (!items && !up && !canAdd ? '<span class="muted sm">Belum ada bukti.</span>' : '') + '</div>';
}
function addEvidence(btn, cam) { const ctx = JSON.parse(btn.dataset.ctx); pickFile({ camera: cam }, f => uploadEvidence(f, ctx)); }
function repaintEvidence(ctx) {
  const k = JSON.stringify(ctx);
  $$('[data-evctx]').forEach(el => { try { if (JSON.stringify(JSON.parse(el.dataset.evctx)) === k) el.outerHTML = evidenceHtml(ctx, el.querySelector('.btn') !== null); } catch (e) { } });
}
async function previewBukti(id) {
  const b = S.d.bukti.find(x => x.ID === id); if (!b) return;
  const ov = openModal(mHead(b.Nama, 'visibility') + '<div class="m-body" id="pvBody" style="min-height:140px;align-items:center;justify-content:center"><div class="spin"></div></div><div class="m-foot"><a class="btn ghost" target="_blank" rel="noopener" href="' + esc(b.Url) + '">Buka di Drive</a><button class="btn primary" onclick="closeModal()">Tutup</button></div>', { wide: true });
  const r = await api('filePreview', { id });
  const body = $('#pvBody', ov); if (!body) return;
  if (!r.success) { body.innerHTML = '<div class="banner crit">' + esc(r.message) + '</div>'; return; }
  const d = r.data;
  if (d.besar) body.innerHTML = '<div class="muted">Berkas besar — buka melalui Drive.</div>';
  else if (/^image\//.test(d.mime)) body.innerHTML = '<img src="' + d.dataUrl + '" alt="' + esc(d.nama) + '" style="max-width:100%;max-height:70vh;border-radius:8px">';
  else if (/pdf/.test(d.mime)) body.innerHTML = '<iframe title="' + esc(d.nama) + '" src="' + d.dataUrl + '" style="width:100%;height:70vh;border:0"></iframe>';
  else body.innerHTML = '<a class="btn primary" download="' + esc(d.nama) + '" href="' + d.dataUrl + '">Unduh berkas</a>';
}


/* ============================ DASHBOARD ============================ */
function emptyBox(icon, title, msg, btn) {
  return '<div class="card empty"><span class="ms">' + icon + '</span><div class="b" style="font-size:16px;color:var(--text)">' + esc(title) + '</div><div>' + esc(msg) + '</div>' + (btn || '') + '</div>';
}
// Fase tindak lanjut per temuan: rencana (belum ada rencana) → pelaksanaan (rencana terisi, menunggu bukti) → review (bukti diajukan) → closed.
function picaFase(t) {
  if (t.Status === 'Closed') return 'closed';
  const rows = S.d.pica.filter(p => p.TemuanID === t.ID);
  if (rows.some(p => p.Status === 'Diajukan')) return 'review';
  if (rows.some(p => p.Koreksi && p.Korektif && p.Target)) return 'pelaksanaan';
  return 'rencana';
}
function picaStats(aid) {
  const ts = S.d.temuan.filter(t => t.AuditID === aid && t.Kategori !== 'OFI'), r = { total: ts.length, closed: 0, review: 0, open: 0, overdue: 0, rencana: 0, pelaksanaan: 0 };
  ts.forEach(t => {
    const over = t.Tenggat && daysTo(t.Tenggat) < 0 && t.Status !== 'Closed', f = picaFase(t);
    if (f === 'closed') r.closed++; else if (f === 'review') r.review++; else { r.open++; r[f]++; }
    if (over) r.overdue++;
  });
  return r;
}
function overduePica() { const a = curAudit(); if (!a || !S.d) return []; return S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Closed' && t.Tenggat && daysTo(t.Tenggat) < 0); }
function counts(aid) { const c = { Kritikal: 0, Mayor: 0, Minor: 0, OFI: 0, draft: 0 }, g = { Kritikal: {}, Mayor: {}, Minor: {} }; S.d.temuan.forEach(t => { if (t.AuditID !== aid) return; if (!t.Kategori) c.draft++; else if (g[t.Kategori]) g[t.Kategori][subOf(t.Kode)] = 1; else c[t.Kategori] = (c[t.Kategori] || 0) + 1; }); ['Kritikal', 'Mayor', 'Minor'].forEach(k => { c[k] = Object.keys(g[k]).length; }); return c; } // Kritikal/Mayor/Minor dihitung per sub-elemen
function statusChip(s) { return '<span class="chip ' + ({ Draft: '', Berjalan: 'ok', Review: 'maj', Disetujui: 'info' }[s] || '') + '">' + esc(s) + '</span>'; }
function katChip(k, usulan) { return k ? '<span class="chip ' + KAT[k] + '">' + esc(k) + '</span>' : '<span class="chip mute" title="Usulan sistem">' + (usulan ? 'Usulan: ' + esc(usulan) : 'Belum ditetapkan') + '</span>'; }
function donutSvg(p, c1, c2) {
  const R = 15.9155, dash = Math.max(0, Math.min(100, p));
  return '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="' + R + '" fill="none" stroke="' + (c2 || 'var(--soft-2)') + '" stroke-width="3.5"/><circle cx="18" cy="18" r="' + R + '" fill="none" stroke="' + c1 + '" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="' + dash + ' 100"/></svg>';
}
function radarSvg(per) {
  const n = per.length, W = 400, H = 320, cx = 200, cy = 160, R = 88; let g = '', pts = [], lb = '';
  const wrap = t => { const w = String(t || '').split(' '), L = []; let c = ''; w.forEach(x => { if ((c + ' ' + x).trim().length > 15 && c) { L.push(c); c = x; } else c = (c + ' ' + x).trim(); }); if (c) L.push(c); return L; };
  [0.25, 0.5, 0.75, 1].forEach(f => { g += '<polygon fill="none" stroke="var(--line)" points="' + per.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return (cx + R * f * Math.cos(a)).toFixed(1) + ',' + (cy + R * f * Math.sin(a)).toFixed(1); }).join(' ') + '"/>'; });
  per.forEach((e, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n, v = Math.max(0, Math.min(100, e.persen)) / 100, c = Math.cos(a), sn = Math.sin(a);
    g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * c).toFixed(1) + '" y2="' + (cy + R * sn).toFixed(1) + '" stroke="var(--line)"/>';
    pts.push([cx + R * v * c, cy + R * v * sn]);
    const anc = Math.abs(c) < 0.25 ? 'middle' : (c > 0 ? 'start' : 'end'), L = wrap(String(e.nama || e.kode).toUpperCase()), lx = cx + (R + 12) * c, ly = cy + (R + 12) * sn;
    const y0 = sn < -0.5 ? ly - 4 - (L.length - 1) * 11 - 14 : (sn > 0.5 ? ly + 8 : ly - (L.length - 1) * 5.5);
    lb += '<text text-anchor="' + anc + '" class="rl">' + L.map((t, k) => '<tspan x="' + lx.toFixed(1) + '" y="' + (y0 + k * 11).toFixed(1) + '">' + esc(t) + '</tspan>').join('') + '<tspan class="rp" x="' + lx.toFixed(1) + '" y="' + (y0 + L.length * 11 + 1).toFixed(1) + '">' + (Math.round(e.persen * 10) / 10).toLocaleString('id-ID', { minimumFractionDigits: 1 }) + '%</tspan></text>';
  });
  const dots = pts.map(q => '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3.5" fill="var(--blue)" stroke="#fff" stroke-width="1"/>').join('');
  return '<svg class="radar" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Radar pencapaian per elemen" style="width:100%;max-width:420px;margin:0 auto;display:block">' + g + '<polygon points="' + pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '" fill="rgba(31,63,208,.18)" stroke="var(--blue)" stroke-width="2"/>' + dots + lb + '</svg>';
}
function rDashboard() {
  const el = $('#page-dashboard'), a = curAudit();
  if (!a) { el.innerHTML = '<div class="ph"><div><h1>Dashboard</h1></div></div>' + emptyBox('event', 'Belum ada audit', 'Buat audit pertama di menu Jadwal & Penugasan.', canAudit() ? '<div class="mt16"><button class="btn primary" onclick="go(\'jadwal\');auditModal()">Buat audit</button></div>' : ''); return; }
  const auditee = isR('AUDITEE'), sk = hitungSkor(a.ID), c = counts(a.ID), ps = picaStats(a.ID), tot = c.Kritikal + c.Mayor + c.Minor;
  const prev = S.d.audits.filter(x => x.ID !== a.ID && Number(x.Tahun) < Number(a.Tahun) && x.Status === 'Disetujui').sort((x, y) => y.Tahun - x.Tahun)[0];
  const prevSk = prev ? hitungSkor(prev.ID).total : null;
  const dl = (() => { const ds = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Closed' && t.Tenggat).map(t => String(t.Tenggat).slice(0, 10)).sort(); return ds.length ? { iso: ds[0], left: daysTo(ds[0]), n: ds.length } : null; })();
  const nTg = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Closed' && !t.Tenggat).length;
  let h = '<div class="card" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-bottom:12px"><div class="grow" style="min-width:240px"><div class="flex wrap mb8">' + statusChip(a.Status) + '<span class="chip mute">Kepdirjen 185.K/37.04/DJB/2019</span>' + (a.LingkupLokasi ? '<span class="muted sm">• ' + esc(a.LingkupLokasi) + '</span>' : '') + '</div><h1 style="font-size:22px;line-height:30px">' + esc(a.Nama) + '</h1><div class="muted">' + fmtD(a.TglMulai) + ' – ' + fmtD(a.TglSelesai) + '</div></div>' +
    (dl ? '<div class="banner' + (dl.left < 0 ? ' crit' : '') + '"><span class="ms lg">hourglass_top</span><div><b>Tenggat PICA terdekat ' + fmtD(dl.iso) + '</b><span class="sm">' + (dl.left < 0 ? 'Terlambat ' + (-dl.left) + ' hari' : dl.left + ' hari lagi') + ' · ditetapkan auditor · ' + dl.n + ' temuan belum Closed</span></div></div>'
      : (nTg ? '<div class="banner info"><span class="ms">info</span><div><b>' + nTg + ' temuan belum punya tenggat</b><span class="sm">Auditor menetapkan tenggat per temuan di rincian temuan.</span></div></div>' : '')) + '</div>';
  h += '<div class="grid g4">';
  if (!auditee) h += '<div class="card kpi"><div class="k-top"><span>Pencapaian Total SMKP</span><span class="ico"><span class="ms">verified_user</span></span></div><div class="big num">' + f1(sk.total) + '%</div><div class="bar mt8"><i class="f-navy" style="width:' + Math.min(100, sk.total) + '%"></i></div><div class="sub"><span>' + (sk.terisi < sk.butir ? 'Sementara · ' + sk.terisi + '/' + sk.butir + ' butir terisi' : 'Semua butir terisi') + '</span>' + (prevSk !== null ? '<span>vs ' + esc(prev.Tahun) + ' (' + f1(prevSk) + '%)</span>' : '') + '</div></div>';
  h += '<div class="card kpi"><div class="k-top"><span>Total Temuan (per sub-elemen)</span><span class="ico" style="background:var(--maj-bg);color:var(--maj)"><span class="ms">report_problem</span></span></div><div class="big num">' + tot + '<small>sub-elemen</small></div><div class="grid" style="grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px"><div class="chip crit" style="justify-content:center;flex-direction:column;padding:4px"><b>' + c.Kritikal + '</b>KRITIKAL</div><div class="chip maj" style="justify-content:center;flex-direction:column;padding:4px"><b>' + c.Mayor + '</b>MAYOR</div><div class="chip min" style="justify-content:center;flex-direction:column;padding:4px"><b>' + c.Minor + '</b>MINOR</div></div><div class="sub"><span>OFI: ' + c.OFI + '</span><span>' + (c.draft ? c.draft + ' menunggu penetapan' : 'Semua ditetapkan') + '</span></div></div>';
  h += '<div class="card kpi"><div class="k-top"><span>Tindak Lanjut PICA</span><span class="ico" style="background:var(--ok-bg);color:var(--ok)"><span class="ms">task_alt</span></span></div><div class="big num">' + f0(pct(ps.closed, ps.total)) + '%<small>' + ps.closed + ' / ' + ps.total + ' selesai</small></div><div class="bar mt8"><i class="f-ok" style="width:' + pct(ps.closed, ps.total) + '%"></i><i class="f-or" style="width:' + pct(ps.review, ps.total) + '%"></i></div><div class="sub"><span style="color:var(--ok)">● ' + ps.closed + ' Closed</span><span style="color:var(--maj)">● ' + (ps.open + ps.review) + ' Berjalan</span><span style="color:var(--crit)"><b>● ' + ps.overdue + ' Overdue</b></span></div></div>';
  if (!auditee) h += '<div class="card kpi"><div class="k-top"><span>Kriteria Terisi</span><span class="ico"><span class="ms">checklist_rtl</span></span></div><div class="big num">' + sk.terisi + '<small>/ ' + sk.butir + ' butir</small></div><div class="bar mt8"><i class="f-blue" style="width:' + pct(sk.terisi, sk.butir) + '%"></i></div><div class="sub"><span>Progres ' + f1(pct(sk.terisi, sk.butir)) + '%</span><span>7 elemen</span></div></div>';
  h += '</div><div class="grid split mt16" style="margin-top:12px">';
  if (!auditee) {
    h += '<div class="card"><div class="card-h"><div><h3 class="flex"><span class="ms" style="color:var(--blue)">equalizer</span>Pencapaian per Elemen SMKP</h3><div class="muted sm">Bobot elemen sesuai Kepdirjen 185.K/37.04/DJB/2019</div></div></div><div class="rowlist">' +
      sk.per.map(e => { const low = e.terisi > 0 && e.persen < 50; return '<div class="act" style="flex-direction:column;gap:6px;' + (low ? 'background:var(--maj-bg)' : '') + '"><div class="flex between wrap"><span class="b">' + e.kode + '. ' + esc(e.nama) + ' <span class="muted sm">(bobot ' + f0(e.bobot * 100) + '%)</span></span><span class="num"><b style="color:' + (low ? 'var(--maj)' : 'inherit') + '">' + f1(e.persen) + '%</b> <span class="muted sm">' + e.skor + '/' + e.max + ' poin</span></span></div><div class="bar tall"><i class="' + (low ? 'f-or' : 'f-navy') + '" style="width:' + Math.min(100, e.persen) + '%"></i></div>' + (low ? '<div class="sm" style="color:var(--maj)"><span class="ms sm">info</span> Di bawah 50% — periksa sub-elemen yang memicu temuan Mayor.</div>' : '') + '</div>'; }).join('') + '</div></div>';
    h += '<div class="grid" style="align-content:start"><div class="card"><div class="card-h"><h3>Kelengkapan Checklist</h3></div><div class="donut">' + donutSvg(pct(sk.terisi, sk.butir), 'var(--primary)') + '<div class="mid">' + f0(pct(sk.terisi, sk.butir)) + '%<small>' + sk.terisi + ' / ' + sk.butir + ' butir</small></div></div></div><div class="card"><div class="card-h"><h3>Radar Elemen</h3></div>' + radarSvg(sk.per) + '</div></div>';
  }
  h += '</div><div class="grid split-r" style="margin-top:12px">';
  // Hotspot lokasi
  const hot = {}; S.d.temuan.forEach(t => { if (t.AuditID === a.ID && t.Kategori && t.Lokasi) hot[t.Lokasi] = (hot[t.Lokasi] || 0) + 1; });
  const hl = Object.keys(hot).map(k => [k, hot[k]]).sort((x, y) => y[1] - x[1]).slice(0, 5), mx = hl.length ? hl[0][1] : 1;
  h += '<div class="card"><div class="card-h"><h3 class="flex"><span class="ms" style="color:var(--crit)">location_on</span>Area dengan Temuan Terbanyak</h3></div>' + (hl.length ? '<div class="hot">' + hl.map(x => '<div><div class="flex between b sm"><span>' + esc(x[0]) + '</span><span>' + x[1] + ' temuan</span></div><div class="bar thin mt8"><i class="f-or" style="width:' + pct(x[1], mx) + '%"></i></div></div>').join('') + '</div>' : '<div class="empty" style="padding:16px">Belum ada temuan berlokasi.</div>') + '<div class="banner mt16" style="margin-top:12px"><span class="ms">gavel</span><div class="sm">Aturan Kepdirjen: sub-elemen bernilai &lt; ' + (P('AMBANG_MAYOR_SKOR') || 50) + '% atau temuan minor di &gt; ' + (P('AMBANG_MAYOR_LOKASI') || 30) + '% lokasi disarankan menjadi <b style="display:inline">Mayor</b>.</div></div></div>';
  // Aktivitas
  let acts = [];
  if (S.d.logs && S.d.logs.length) acts = S.d.logs.slice(0, 7).map(l => ({ ic: 'history', t: esc(l.Aksi.replace(/_/g, ' ')), s: esc(l.Email) + ' · ' + esc(l.Objek), ts: l.TS }));
  else acts = S.d.temuan.filter(t => t.AuditID === a.ID).sort((x, y) => String(y.TS).localeCompare(String(x.TS))).slice(0, 6).map(t => ({ ic: 'warning', t: esc(t.Nomor) + ' · ' + esc(t.Kategori || 'Draft'), s: esc(String(t.Uraian).slice(0, 80)), ts: t.TS }));
  h += '<div class="card"><div class="card-h"><h3 class="flex"><span class="ms" style="color:var(--blue)">history</span>Aktivitas Terbaru</h3></div><div class="rowlist">' + (acts.length ? acts.map(x => '<div class="act"><span class="ico"><span class="ms sm">' + x.ic + '</span></span><div class="grow"><div class="b sm">' + x.t + '</div><div class="muted sm clamp2">' + x.s + '</div><div class="muted" style="font-size:11px">' + fmtDT(x.ts) + '</div></div></div>').join('') : '<div class="empty" style="padding:16px">Belum ada aktivitas.</div>') + '</div>' +
    '<div class="sec-t mt16" style="margin-top:16px">Aksi cepat</div><div class="rowlist">' +
    (canTemuan() ? '<button class="btn primary block" onclick="go(\'checklist\')"><span class="ms">play_circle</span>Lanjutkan checklist</button><button class="btn warn block" onclick="temuanModal()"><span class="ms">add_alert</span>Catat temuan ketidaksesuaian</button>' : '') +
    (!auditee ? '<button class="btn ghost block" onclick="downloadFormulir()"><span class="ms">table_view</span>Unduh formulir kriteria (Excel)</button><button class="btn ghost block" onclick="exportCsv()"><span class="ms">csv</span>Unduh rekap nilai (CSV)</button>' : '<button class="btn primary block" onclick="go(\'pica\')"><span class="ms">task_alt</span>Isi tindak lanjut PICA</button>') + '</div></div></div>';
  el.innerHTML = h;
}
/** Formulir Kriteria (xlsx) — dibuat dari template Excel referensi 2025, seluruhnya di browser. */
function loadJs_(src) { return new Promise((ok, no) => { const e = document.createElement('script'); e.src = src; e.onload = ok; e.onerror = () => no(new Error('Gagal memuat ' + src)); document.head.appendChild(e); }); }
async function downloadFormulir() {
  const a = curAudit(); if (!a) return;
  try {
    toast('Menyiapkan formulir Excel…');
    if (!window.JSZip) await loadJs_('./js/vendor/jszip.min.js');
    if (!window.Formulir) await loadJs_('./js/formulir.js');
    const tr = await fetch('./tpl/Formulir_Kriteria_SMKP.xlsx'); if (!tr.ok) throw new Error('Template formulir tidak ditemukan');
    const nl = nilaiOf(a.ID), nilai = {}, maks = {};
    unitKr().forEach(k => { const x = nl[k.Kode] || {}; maks[k.Kode] = k.NilaiMaks; nilai[k.Kode] = isNA(a.ID, k.Kode) ? { na: true } : { n: (x.n === '' || x.n == null) ? undefined : Number(x.n) }; });
    const pica = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Draft').map(t => {
      const ps = S.d.pica.filter(p => p.TemuanID === t.ID), j = f => ps.map(p => p[f]).filter(Boolean).join('\n');
      const tg = ps.map(p => p.Target).filter(Boolean).sort().pop() || '';
      return { nomor: t.Nomor || ('HP ' + t.Kode), uraian: t.Uraian, akar: t.AkarMasalah, koreksi: j('Koreksi') + (ps.some(p => p.Korektif) ? '\n' + j('Korektif') : ''), pic: ps.map(p => p.PIC).filter(Boolean).filter((v, i, r) => r.indexOf(v) === i).join('\n'), target: String(tg).slice(0, 10), status: t.Status === 'Closed' ? 'Closed' : 'Open' };
    });
    const out = await Formulir.build(window.JSZip, await tr.arrayBuffer(), { nilai, maks, pica });
    const u = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), l = document.createElement('a');
    l.href = u; l.download = 'Formulir_Penilaian_SMKP_' + a.Tahun + '.xlsx'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000);
  } catch (e) { toast('Gagal membuat formulir: ' + (e.message || e)); }
}
/** Formulir Kriteria (xlsx) — sama persis dengan formulir referensi 2025; diisi di browser dari template. */
let _xlLoad = null;
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Gagal memuat ' + src)); document.head.appendChild(s); }); }
async function downloadFormulir() {
  const a = curAudit(); if (!a) return; toast('Menyiapkan formulir Excel…', 'info');
  try {
    if (!window.Formulir || !window.JSZip) await (_xlLoad = _xlLoad || Promise.all([loadScript('./js/vendor/jszip.min.js'), loadScript('./js/formulir.js')]));
    const r = await fetch('./tpl/Formulir_Kriteria_SMKP.xlsx'); if (!r.ok) throw new Error('Template formulir tidak ditemukan');
    const nil = {}, maks = {}, no = nilaiOf(a.ID);
    unitKr().forEach(k => { maks[k.Kode] = k.NilaiMaks; const v = no[k.Kode] || {}; nil[k.Kode] = { na: isNA(a.ID, k.Kode), n: (v.n === '' || v.n === null || v.n === undefined) ? undefined : Number(v.n) }; });
    const pica = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Draft').sort((x, y) => String(x.Nomor).localeCompare(String(y.Nomor), 'id', { numeric: true })).map(t => {
      const ps = S.d.pica.filter(p => p.TemuanID === t.ID), j = f => ps.map(p => p[f]).filter(Boolean).join('\n');
      const tg = ps.map(p => p.Target).filter(Boolean).sort().pop() || t.Tenggat || '';
      return { nomor: t.Nomor || ('HP ' + t.Kode), uraian: t.Uraian, akar: t.AkarMasalah, koreksi: [j('Koreksi'), j('Korektif')].filter(Boolean).join('\n'), pic: j('PIC'), target: String(tg).slice(0, 10), status: t.Status === 'Closed' ? 'Closed' : 'Open' };
    });
    const bin = await window.Formulir.build(window.JSZip, await r.arrayBuffer(), { nilai: nil, maks, pica });
    const u = URL.createObjectURL(new Blob([bin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), l = document.createElement('a');
    l.href = u; l.download = 'Formulir_Kriteria_SMKP_' + a.Tahun + '.xlsx'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000);
    toast('Formulir Excel diunduh', 'ok');
  } catch (e) { toast('Gagal membuat formulir: ' + e.message, 'err'); }
}
/** Rekap nilai → CSV (dibuat di browser, tanpa server). */
function exportCsv() {
  const a = curAudit(); if (!a) return; const nm = nmap(a.ID), rows = [['Kode', 'Elemen', 'Butir', 'Nilai Maks', 'Nilai Audit']];
  unitKr().forEach(k => rows.push([k.Kode, k.Elemen, k.Nama, isNA(a.ID, k.Kode) ? 'N/A' : k.NilaiMaks, isNA(a.ID, k.Kode) ? 'N/A' : (nm[k.Kode] === undefined ? '' : nm[k.Kode])]));
  const sk = hitungSkor(a.ID); rows.push([]); sk.per.forEach(e => rows.push(['Elemen ' + e.kode, e.nama, 'Bobot ' + e.bobot, e.skor + '/' + e.max, f1(e.persen) + '%'])); rows.push(['TOTAL SMKP', '', '', '', f1(sk.total) + '%']);
  const csv = '﻿' + rows.map(r => r.map(c => '"' + String(c === undefined ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), l = document.createElement('a'); l.href = u; l.download = 'Rekap-Nilai-SMKP-' + a.Tahun + '.csv'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000);
}

/* ======================= JADWAL & PENUGASAN ======================= */
const PERAN = ['Lead Auditor', 'Auditor', 'Pemandu', 'Pengamat', 'Tenaga Ahli'];
function rJadwal() {
  const el = $('#page-jadwal'), a = curAudit();
  let h = '<div class="ph"><div><div class="crumb">SMKP Minerba / <b>Jadwal</b></div><h1>Jadwal & Penugasan</h1><p>Periode audit, tim auditor, dan pembagian elemen.</p></div><div class="actions">' + (canAudit() ? '<button class="btn primary" onclick="auditModal()"><span class="ms">add_circle</span>Audit baru</button>' : '') + '</div></div>';
  if (!S.d.audits.length) { el.innerHTML = h + emptyBox('event', 'Belum ada audit', canAudit() ? 'Klik “Audit baru” untuk membuat periode audit.' : 'Menunggu Admin/Lead Auditor membuat audit.'); return; }
  h += '<div class="grid g2">' + S.d.audits.slice().sort((x, y) => String(y.TglMulai || y.Tahun).localeCompare(String(x.TglMulai || x.Tahun))).map(x => {
    const sk = hitungSkor(x.ID), on = x.ID === S.audit;
    return '<div class="card" style="' + (on ? 'border-color:var(--blue);box-shadow:0 0 0 1px var(--blue)' : '') + '"><div class="flex between wrap"><div class="b" style="font-size:15px">' + esc(x.Nama) + '</div>' + statusChip(x.Status) + '</div><div class="muted sm mt8">' + esc(x.Jenis || 'Internal') + ' · Tahun ' + esc(x.Tahun) + ' · ' + fmtD(x.TglMulai) + ' – ' + fmtD(x.TglSelesai) + '</div><div class="muted sm">' + esc(x.LingkupLokasi || '-') + ' · ' + (x.JumlahLokasi || 0) + ' lokasi</div>' +
      '<div class="flex between mt8"><span class="sm muted">Skor ' + (sk.terisi < sk.butir ? 'sementara ' : '') + '<b class="num" style="color:var(--text)">' + f1(sk.total) + '%</b></span><span class="sm muted">' + sk.terisi + '/' + sk.butir + ' butir</span></div><div class="bar thin mt8"><i class="f-blue" style="width:' + pct(sk.terisi, sk.butir) + '%"></i></div>' +
      '<div class="flex wrap mt16" style="margin-top:12px"><button class="btn sm ' + (on ? 'ghost' : 'primary') + '" data-id="' + esc(x.ID) + '" onclick="pickAudit(this.dataset.id)">' + (on ? 'Audit aktif' : 'Jadikan aktif') + '</button>' + auditActions(x) + '</div></div>';
  }).join('') + '</div>';
  if (a) {
    const pen = S.d.penugasan.filter(p => p.AuditID === a.ID);
    h += '<div class="card mt16" style="margin-top:16px"><div class="card-h"><h3 class="flex"><span class="ms" style="color:var(--blue)">groups</span>Tim & Penugasan — ' + esc(a.Nama) + '</h3>' + (canAudit() && a.Status !== 'Disetujui' ? '<button class="btn sm primary" onclick="penModal()"><span class="ms sm">person_add</span>Tambah</button>' : '') + '</div>' +
      (pen.length ? '<div class="table-wrap"><table class="t"><thead><tr><th>Nama</th><th>Peran</th><th>Elemen</th><th>Lokasi / Area</th><th></th></tr></thead><tbody>' + pen.map(p => '<tr><td><div class="b">' + esc(p.Nama || p.Email) + '</div><div class="muted sm">' + esc(p.Email) + '</div></td><td>' + esc(p.Peran) + '</td><td>' + (String(p.Elemen || '*') === '*' ? 'Semua' : esc(p.Elemen)) + '</td><td>' + esc(p.Lokasi || '-') + '</td><td style="text-align:right;white-space:nowrap">' + (canAudit() && a.Status !== 'Disetujui' ? '<button class="iconbtn" data-id="' + esc(p.ID) + '" onclick="penModal(this.dataset.id)" aria-label="Ubah"><span class="ms">edit</span></button><button class="iconbtn" data-id="' + esc(p.ID) + '" onclick="delPen(this.dataset.id)" aria-label="Hapus"><span class="ms">delete</span></button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty" style="padding:16px">Belum ada penugasan. Tambahkan Lead Auditor dan auditor beserta elemen yang dipegang.</div>') +
      '<div class="hint">Auditor hanya dapat menilai elemen yang ditugaskan kepadanya. Peran mengikuti Kepdirjen: Lead Auditor, Auditor, Pemandu, Pengamat, Tenaga Ahli.</div></div>';
  }
  el.innerHTML = h;
}
function auditActions(x) {
  let b = '';
  if (canAudit() && x.Status !== 'Disetujui') b += '<button class="btn sm ghost" data-id="' + esc(x.ID) + '" onclick="auditModal(this.dataset.id)"><span class="ms sm">edit</span>Ubah</button>';
  if (x.Status === 'Draft' && canAudit()) b += '<button class="btn sm ok" data-id="' + esc(x.ID) + '" onclick="setAuditStatus(this.dataset.id,\'Berjalan\')"><span class="ms sm">play_arrow</span>Mulai</button>';
  if (x.Status === 'Berjalan' && isR('LEAD')) b += '<button class="btn sm orange" data-id="' + esc(x.ID) + '" onclick="setAuditStatus(this.dataset.id,\'Review\')"><span class="ms sm">lock</span>Kirim ke Review</button>';
  if (x.Status === 'Review' && isR('LEAD')) b += '<button class="btn sm warn" data-id="' + esc(x.ID) + '" onclick="setAuditStatus(this.dataset.id,\'Berjalan\')"><span class="ms sm">lock_open</span>Buka kunci</button>';
  if (x.Status === 'Review' && isR('PJO', 'ADMIN')) b += '<button class="btn sm ok" data-id="' + esc(x.ID) + '" onclick="setAuditStatus(this.dataset.id,\'Disetujui\')"><span class="ms sm">verified</span>Setujui</button>';
  return b;
}
function pickAudit(id) { S.audit = id; ls.set('iasmkp_audit', id); renderAuditSel(); touch(); }
async function setAuditStatus(id, to, extra) {
  const a = auditById(id); if (!a) return; const old = a.Status; let p = { id, status: to };
  if (to === 'Review') { const ok = await confirmBox('Kirim ke Review?', 'Nilai akan <b>dikunci</b>. Hanya Lead Auditor yang dapat membukanya kembali (tercatat di log).', 'Kirim ke Review', 'orange'); if (!ok) return; }
  if (to === 'Disetujui') { const ok = await confirmBox('Setujui audit?', 'Setelah disetujui, seluruh data audit terkunci permanen.', 'Setujui', 'ok'); if (!ok) return; }
  if (old === 'Review' && to === 'Berjalan') { const al = await dialog('Buka kunci nilai', '<label class="label" for="dgIn">Alasan membuka kunci (wajib, masuk log)</label><textarea class="textarea" id="dgIn"></textarea>', 'Buka kunci', 'warn'); if (!al) return; p.alasan = al; }
  a.Status = to; touch();            // optimistic
  let r = await api('setStatus', p);
  if (r.code === 'BELUM_LENGKAP') {
    const al = await dialog('Checklist belum lengkap', '<div class="mb8">' + esc(r.message) + '</div><label class="label" for="dgIn">Alasan kirim paksa (wajib)</label><textarea class="textarea" id="dgIn"></textarea>', 'Kirim paksa', 'orange');
    if (al) { p.force = true; p.alasan = al; a.Status = to; touch(); r = await api('setStatus', p); } else { a.Status = old; touch(); return; }
  }
  if (r.success) toast('Status audit: ' + to, 'ok'); else { a.Status = old; touch(); toast(r.message || 'Gagal mengubah status.', 'err', 5000); }
}
function auditModal(id) {
  const a = id ? auditById(id) : {}, ov = openModal(mHead(id ? 'Ubah audit' : 'Audit baru', 'event') + '<div class="m-body">' +
    '<div class="field"><label class="label">Nama audit *</label><input class="input" id="auN" value="' + esc(a.Nama || '') + '" placeholder="Audit Internal SMKP 2026"></div>' +
    '<div class="grid g2"><div class="field"><label class="label">Tahun</label><input class="input" id="auY" type="number" inputmode="numeric" value="' + esc(a.Tahun || new Date().getFullYear()) + '"></div><div class="field"><label class="label">Jenis</label><select class="select" id="auJ"><option>Internal</option><option' + (a.Jenis === 'Eksternal' ? ' selected' : '') + '>Eksternal</option></select></div></div>' +
    '<div class="grid g2"><div class="field"><label class="label">Tanggal mulai</label><input class="input" id="auM" type="date" value="' + esc(a.TglMulai || '') + '"></div><div class="field"><label class="label">Tanggal selesai</label><input class="input" id="auS" type="date" value="' + esc(a.TglSelesai || '') + '"></div></div>' +
    '<div class="grid g2"><div class="field"><label class="label">Pertemuan pembukaan</label><input class="input" id="auB" type="date" value="' + esc(a.TglPembukaan || '') + '"></div><div class="field"><label class="label">Pertemuan penutupan</label><input class="input" id="auT" type="date" value="' + esc(a.TglPenutupan || '') + '"></div></div>' +
    '<div class="field"><label class="label">Lingkup lokasi / area</label><textarea class="textarea" id="auL" placeholder="Satu baris per area. Awali # untuk judul area, ## untuk sub-judul, tanpa tanda = butir. Contoh:&#10;# Area operasional luar tambang&#10;## Departemen HSE&#10;Workshop">' + esc(a.LingkupLokasi || '') + '</textarea></div>' +
    '<div class="field"><label class="label">Jumlah lokasi yang diaudit</label><input class="input" id="auJL" type="number" inputmode="numeric" min="0" value="' + esc(a.JumlahLokasi || '') + '"><div class="hint">Dipakai aturan Mayor: temuan minor pada satu sub-elemen di &gt; 30% lokasi.</div></div></div>' +
    '<div class="m-foot">' + (id && isR('ADMIN') ? '<button class="btn ghost" id="auDel" style="margin-right:auto;color:var(--crit)"><span class="ms sm">delete</span>Hapus audit ini</button>' : '') + '<button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="auGo">Simpan</button></div>', { wide: true });
  if ($('#auDel', ov)) $('#auDel', ov).onclick = async () => { const n = window.prompt('HAPUS AUDIT BESERTA SEMUA DATANYA (temuan, PICA, penilaian, bukti). Cadangan dibuat otomatis, audit lain tidak tersentuh.\n\nKetik nama audit persis untuk melanjutkan:\n' + a.Nama); if (n === null) return; const r = await api('hapusAudit', { id: a.ID, konfirmasi: n }); if (r.success) { S.audit = null; ls.set('iasmkp_audit', ''); closeModal(); await resync(true); renderAuditSel(); toast('Audit dihapus. Cadangan dibuat di Drive.', 'ok', 5000); } else toast(r.message, 'err', 6000); };
  $('#auGo', ov).onclick = () => {
    const nama = $('#auN').value.trim(); if (!nama) { toast('Nama audit wajib diisi.', 'err'); return; }
    const rec = { ID: a.ID || uid(), Nama: nama, Tahun: Number($('#auY').value) || new Date().getFullYear(), Jenis: $('#auJ').value, TglMulai: $('#auM').value, TglSelesai: $('#auS').value, TglPembukaan: $('#auB').value, TglPenutupan: $('#auT').value, LingkupLokasi: $('#auL').value.trim(), JumlahLokasi: Number($('#auJL').value) || 0 };
    if (!a.ID) { rec.Status = 'Draft'; rec.DibuatOleh = S.user.email; rec.TglDibuat = nowIso(); }
    save('Audit', rec); if (!a.ID) { S.audit = rec.ID; ls.set('iasmkp_audit', rec.ID); } closeModal(); renderAuditSel(); touch(); toast('Audit disimpan.', 'ok');
  };
}
function penModal(id) {
  const a = curAudit(), p = id ? S.d.penugasan.find(x => x.ID === id) : {}, sel = String(p.Elemen || '*') === '*' ? null : String(p.Elemen).split(',').map(s => s.trim());
  const users = S.d.users.filter(u => u.Aktif && ['LEAD', 'AUDITOR'].indexOf(u.Role) > -1);
  const ov = openModal(mHead(id ? 'Ubah penugasan' : 'Tambah anggota tim', 'person_add') + '<div class="m-body">' +
    '<div class="field"><label class="label">Auditor *</label><select class="select" id="pnU">' + users.map(u => '<option value="' + esc(u.Email) + '"' + (lc(p.Email) === lc(u.Email) ? ' selected' : '') + '>' + esc(u.Nama) + ' — ' + ROLE_LABEL[u.Role] + '</option>').join('') + '</select>' + (users.length ? '' : '<div class="hint">Belum ada pengguna Lead Auditor/Auditor. Tambahkan di Manajemen Pengguna.</div>') + '</div>' +
    '<div class="field"><label class="label">Peran dalam tim</label><select class="select" id="pnP">' + PERAN.map(r => '<option' + (p.Peran === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></div>' +
    '<div class="field"><label class="label">Elemen yang dipegang</label><label class="check"><input type="checkbox" id="pnAll"' + (sel === null ? ' checked' : '') + '> Semua elemen</label><div class="flex wrap" id="pnEls">' + S.d.elemen.map(e => '<label class="check" style="min-width:90px"><input type="checkbox" value="' + e.Kode + '"' + (sel && sel.indexOf(e.Kode) > -1 ? ' checked' : '') + '> ' + e.Kode + '</label>').join('') + '</div></div>' +
    '<div class="field"><label class="label">Lokasi / area</label><input class="input" id="pnL" value="' + esc(p.Lokasi || '') + '"></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="pnGo">Simpan</button></div>');
  $('#pnGo', ov).onclick = () => {
    const em = $('#pnU').value; if (!em) { toast('Pilih auditor.', 'err'); return; }
    const u = S.d.users.find(x => lc(x.Email) === lc(em)), els = $('#pnAll').checked ? '*' : $$('#pnEls input:checked').map(i => i.value).join(',');
    if (!els) { toast('Pilih minimal satu elemen.', 'err'); return; }
    save('Penugasan', { ID: p.ID || uid(), AuditID: a.ID, Email: lc(em), Nama: u ? u.Nama : em, Peran: $('#pnP').value, Elemen: els, Lokasi: $('#pnL').value.trim(), Catatan: '' }); closeModal(); touch();
  };
}
function delPen(id) { const p = S.d.penugasan.find(x => x.ID === id); if (!p) return; save('Penugasan', { ID: id }, true); touch(); }

/* =========================== CHECKLIST =========================== */
function parseRubrik(s) { const o = {}; String(s || '').split('|').forEach(x => { const m = x.match(/^\s*(\d+)\s*=\s*([\s\S]*)$/); if (m) o[m[1]] = m[2].trim(); }); return o; }
/** Rubrik penilaian per butir (dari Kepdirjen 185.K/37.04/DJB/2019); klik tingkat = isi nilai. */
function rubDet(k, rub, val, can) {
  const ks = Object.keys(rub).sort(); if (!ks.length) return '';
  const sel = val !== '' && rub[val] !== undefined;
  return '<details class="rub-d"' + (val === '' ? ' open' : '') + '><summary><span class="ms sm">rule</span> Rubrik penilaian 0–' + ks[ks.length - 1] + (sel ? ' · nilai terpilih ' + val : '') + '</summary><div class="rub">' +
    ks.map(i => '<div class="rub-i' + (String(val) === i ? ' on' : '') + (can ? ' pick' : '') + '"' + (can ? ' data-k="' + esc(k.Kode) + '" data-v="' + i + '" onclick="setScore(this.dataset.k,this.dataset.v)" title="Klik untuk memberi nilai ' + i + '"' : '') + '><b>Nilai ' + i + '</b><span>' + esc(rub[i]) + '</span></div>').join('') + '</div></details>';
}
/** Auditor menetapkan butir N/A (wajib beralasan) atau membatalkannya. */
function naModal(kode, set) {
  const a = curAudit(); if (!canScore(a.ID, kode)) { toast('Anda tidak dapat mengubah butir ini (status audit/penugasan).', 'warn'); return; }
  const cur = nilaiOf(a.ID)[kode] || {}, k = krMap()[kode];
  const done = al => { save('Penilaian', { ID: a.ID + '|' + kode, AuditID: a.ID, Kode: kode, Nilai: '', Catatan: cur.c || '', Selesai: cur.s || 0, NA: set ? 1 : 0, AlasanNA: set ? al : '' }); afterScore(kode); toast(set ? 'Butir ' + kode + ' ditandai N/A — tidak dihitung dalam skor.' : 'N/A dibatalkan; butir kembali dinilai.', 'ok'); };
  if (!set) { done(''); return; }
  const ov = openModal(mHead('Tandai butir N/A', 'block') + '<div class="m-body"><div class="muted sm"><b>' + esc(kode) + '</b> — ' + esc(k.Nama) + '</div><div class="field mt8" style="margin-top:12px"><label class="label" for="naAl">Alasan tidak berlaku *</label><textarea class="textarea" id="naAl" placeholder="Contoh: perusahaan tidak mengelola gudang bahan peledak pada site ini"></textarea></div><div class="muted sm">Butir N/A tidak dihitung pada nilai maksimum maupun nilai audit, dan ditulis sebagai N/A di formulir kriteria. Nilai yang sudah diisi pada butir ini dikosongkan.</div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="naGo">Tandai N/A</button></div>', { sm: true });
  $('#naGo', ov).onclick = () => { const al = $('#naAl', ov).value.trim(); if (!al) { toast('Alasan N/A wajib diisi.', 'warn'); return; } closeModal(); done(al); };
}
/** Daftar temuan yang sudah dicatat pada satu butir — tampil di Checklist agar nilai ditetapkan dengan gambaran lengkap. */
function temuanButirHtml(aid, kode) {
  const ts = S.d.temuan.filter(t => t.AuditID === aid && t.Kode === kode); if (!ts.length) return '';
  return '<div class="detail" style="margin-top:10px;background:var(--soft)"><div class="sm b" style="margin-bottom:6px"><span class="ms sm">warning</span> ' + ts.length + ' temuan pada butir ini</div>' + ts.map(t => '<div class="click" style="padding:6px 0;border-top:1px solid var(--line,#e3e7f0);cursor:pointer" data-id="' + esc(t.ID) + '" onclick="openTemuan(this.dataset.id)"><div class="flex wrap"><span class="chip ' + (KAT[t.Kategori] || 'mute') + '">' + esc(t.Kategori || 'Draft') + '</span><b class="sm">' + esc(t.Nomor) + '</b><span class="sm muted">' + esc(nLok(t.Lokasi) || 'lokasi belum diisi') + (t.Departemen ? ' · ' + esc(t.Departemen) : '') + '</span></div><div class="sm" style="margin-top:2px">' + esc(String(t.Uraian || '').slice(0, 160)) + (String(t.Uraian || '').length > 160 ? '…' : '') + '</div></div>').join('') + '</div>';
}
function rowHtml(k, child) {
  const a = curAudit(), v = nilaiOf(a.ID)[k.Kode], val = v && v.n !== '' && v.n !== undefined ? v.n : '', can = canScore(a.ID, k.Kode), open = S.openRows[k.Kode];
  const rub0 = parseRubrik(k.Rubrik), nA = isNA(a.ID, k.Kode), nAl = v && v.al ? v.al : '';
  if (nA) return '<div class="crit-row na' + (child ? ' child' : '') + '" id="row-' + esc(k.Kode) + '"><div class="crit-top"><div class="grow"><span class="crit-code">' + esc(k.Kode) + '</span><div class="crit-name">' + esc(k.Nama) + '</div><div class="sm muted" style="margin-top:4px"><b>N/A — tidak berlaku.</b> Alasan auditor: ' + esc(nAl || '-') + '</div></div><div class="flex"><span class="chip mute">N/A</span>' + (can ? '<button class="btn sm ghost" data-k="' + esc(k.Kode) + '" onclick="naModal(this.dataset.k,false)">Batalkan N/A</button>' : '') + '</div></div>' + rubDet(k, rub0, '', false) + '</div>';
  const rub = rub0, hasRub = Object.keys(rub).length;
  let seg = '<div class="seg" style="grid-template-columns:repeat(' + (k.NilaiMaks + 1) + ',1fr)" role="radiogroup" aria-label="Nilai ' + esc(k.Kode) + '">';
  for (let i = 0; i <= k.NilaiMaks; i++) seg += '<button type="button" role="radio" aria-checked="' + (val === i) + '" class="' + (val === i ? 'on' : '') + '" data-k="' + esc(k.Kode) + '" data-v="' + i + '" onclick="setScore(this.dataset.k,this.dataset.v)"' + (can ? '' : ' disabled') + '>' + i + '</button>';
  seg += '</div>';
  const note = v && v.c ? v.c : '';
  return '<div class="crit-row' + (child ? ' child' : '') + (val !== '' ? ' done' : '') + '" id="row-' + esc(k.Kode) + '"><div class="crit-top"><div class="grow"><span class="crit-code">' + esc(k.Kode) + '</span> <span class="chip mute">Maks ' + k.NilaiMaks + '</span><div class="crit-name">' + esc(k.Nama) + '</div></div>' +
    '<div class="flex"><label class="sm muted" for="in-' + esc(k.Kode) + '">Nilai audit</label><input class="input num" id="in-' + esc(k.Kode) + '" style="width:72px;text-align:center;font-weight:700" type="number" inputmode="numeric" min="0" max="' + k.NilaiMaks + '" step="1" value="' + val + '" data-k="' + esc(k.Kode) + '" onchange="typeScore(this)"' + (can ? '' : ' disabled') + ' placeholder="–"></div></div>' + seg +
    rubDet(k, rub, val, can) +
    temuanButirHtml(a.ID, k.Kode) +
    '<div class="flex wrap mt8" style="margin-top:10px"><button class="btn sm ghost" data-k="' + esc(k.Kode) + '" onclick="toggleRow(this.dataset.k)"><span class="ms sm">' + (open ? 'expand_less' : 'edit_note') + '</span>Catatan & bukti' + (note || evidenceOf({ auditId: a.ID, kode: k.Kode }).length ? ' •' : '') + '</button>' +
    (can ? '<button class="btn sm ghost" data-k="' + esc(k.Kode) + '" onclick="naModal(this.dataset.k,true)" title="Butir tidak berlaku pada objek audit ini"><span class="ms sm">block</span>Tandai N/A</button>' : '') +
    (canTemuan() && a.Status !== 'Disetujui' ? '<button class="btn sm warn" data-k="' + esc(k.Kode) + '" onclick="temuanModal({kode:this.dataset.k})"><span class="ms sm">warning</span>Buat temuan</button>' : '') + (v && v.s ? '<span class="chip ok"><span class="ms sm">check</span>Selesai diperiksa</span>' : '') + '</div>' +
    (open ? '<div class="detail"><label class="label" for="nt-' + esc(k.Kode) + '">Catatan lapangan & fakta temuan</label><textarea class="textarea" id="nt-' + esc(k.Kode) + '" data-k="' + esc(k.Kode) + '" onchange="saveNote(this)"' + (can ? '' : ' disabled') + ' placeholder="Identitas sarana, nomor lambung, personel yang diwawancara…">' + esc(note) + '</textarea><div class="label mt8" style="margin-top:10px">Bukti objektif</div>' + evidenceHtml({ auditId: a.ID, kode: k.Kode }, can || isR('LEAD', 'AUDITOR')) +
      (can ? '<label class="check mt8"><input type="checkbox" data-k="' + esc(k.Kode) + '" onchange="markDone(this)"' + (v && v.s ? ' checked' : '') + '> Tandai selesai diperiksa</label>' : '') + '</div>' : '') + '</div>';
}
/** Sebaran temuan per sub-elemen: dasar aturan Mayor (> ambang % lokasi). Lokasi/departemen dicatat pada tiap temuan. */
function sebaranSub(aid, sub) {
  const a = auditById(aid), tot = Number(a && a.JumlahLokasi) || 0, aL = Number(P('AMBANG_MAYOR_LOKASI') || 30), lok = {}, dep = {}; let nT = 0;
  S.d.temuan.forEach(x => { if (x.AuditID !== aid || subOf(x.Kode) !== sub || x.Kategori === 'OFI') return; nT++; if (x.Lokasi) lok[lc(nLok(x.Lokasi))] = nLok(x.Lokasi); if (x.Departemen) dep[lc(x.Departemen)] = x.Departemen; });
  const n = Object.keys(lok).length;
  return { nT, n, tot, aL, lokasi: Object.keys(lok).map(k => lok[k]), dept: Object.keys(dep).map(k => dep[k]), lewat: tot > 0 && n / tot * 100 > aL };
}
function sebaranHtml(sub) {
  const b = sebaranSub(curAudit().ID, sub); if (!b.nT) return '';
  return '<div class="sm muted" style="margin-top:6px"><span class="chip ' + (b.lewat ? 'maj' : 'mute') + '"><span class="ms sm">location_on</span>Temuan di ' + b.n + (b.tot ? ' dari ' + b.tot : '') + ' lokasi' + (b.tot ? ' (' + f0(b.n / b.tot * 100) + '%)' : '') + (b.lewat ? ' · > ' + b.aL + '% → Mayor' : '') + '</span> ' +
    (b.lokasi.length ? esc(b.lokasi.join(', ')) : '<i>lokasi belum diisi pada temuan</i>') + (b.dept.length ? ' · Dept: ' + esc(b.dept.join(', ')) : '') + '</div>';
}
function subHead(s, grp) {
  const a = curAudit(), sp = persenSub(a.ID)[s.Kode] || { mx: 0, sk: 0, terisi: 0, persen: 0 }, low = sp.terisi > 0 && sp.persen < Number(P('AMBANG_MAYOR_SKOR') || 50);
  return '<div class="grow"><span class="s-code">Sub-elemen ' + esc(s.Kode) + '</span> ' + (low ? '<span class="chip maj"><span class="ms sm">warning</span>&lt; ' + (P('AMBANG_MAYOR_SKOR') || 50) + '% → potensi Mayor</span>' : '') + '<div class="s-name">' + esc(s.Nama) + '</div>' + sebaranHtml(s.Kode) + '</div><div class="s-score"><div class="muted sm">Realisasi</div><b class="num">' + sp.sk + '</b><span class="muted sm"> / ' + sp.mx + ' (' + f0(sp.persen) + '%)</span></div>';
}
function rChecklist() {
  const el = $('#page-checklist'), a = curAudit();
  if (!a) { el.innerHTML = '<div class="ph"><div><h1>Checklist Audit</h1></div></div>' + emptyBox('fact_check', 'Belum ada audit aktif', 'Buat atau pilih audit di Jadwal & Penugasan.'); return; }
  if (!S.d.elemen.some(e => e.Kode === S.el)) S.el = S.d.elemen[0].Kode;
  const locked = a.Status !== 'Berjalan';
  const pills = S.d.elemen.map(e => { const sk = hitungSkor(a.ID).per.find(x => x.kode === e.Kode); return '<button class="elpill' + (e.Kode === S.el ? ' on' : '') + '" data-e="' + e.Kode + '" onclick="pickEl(this.dataset.e)">' + (sk.terisi < sk.butir ? '<span class="dot"></span>' : '<span class="ms sm">check</span>') + 'Elemen ' + e.Kode + ': ' + esc(e.Nama) + '</button>'; }).join('');
  el.innerHTML = '<div class="stick"><div class="flex between wrap"><div class="muted sm"><b>AUDIT LAPANGAN</b> › ' + esc(a.Nama) + '</div><div class="flex wrap">' + statusChip(a.Status) + '<button class="btn sm ghost" onclick="toggleEmpty()"><span class="ms sm" style="color:var(--orange)">filter_alt</span><span id="emptyBtn"></span></button>' + (isR('LEAD') && a.Status === 'Berjalan' ? '<button class="btn sm navy" onclick="setAuditStatus(\'' + esc(a.ID) + '\',\'Review\')"><span class="ms sm">lock</span><span class="hide-sm">Kunci nilai (Review)</span></button>' : '') + '</div></div><div class="ticker" id="ticker"></div><div class="elpills">' + pills + '</div></div>' +
    (locked ? '<div class="banner' + (a.Status === 'Draft' ? ' info' : '') + '" style="margin-bottom:12px"><span class="ms">' + (a.Status === 'Draft' ? 'info' : 'lock') + '</span><div><b>Nilai dalam mode baca</b><span class="sm">' + (a.Status === 'Draft' ? 'Audit masih Draft. Mulai audit dari Jadwal & Penugasan.' : 'Audit berstatus ' + esc(a.Status) + ' — nilai terkunci.') + '</span></div></div>' : (isR('AUDITOR') && !assignedEls(a.ID)['*'] && !Object.keys(assignedEls(a.ID)).length ? '<div class="banner" style="margin-bottom:12px"><span class="ms">info</span><div><b>Belum ada elemen yang ditugaskan</b><span class="sm">Minta Lead Auditor menugaskan elemen kepada Anda.</span></div></div>' : '')) +
    '<div id="clBody"></div>';
  paintCl();
}
function paintCl() {
  const a = curAudit(); if (!a) return; const nm = nmap(a.ID);
  const ks = S.d.kriteria.filter(k => k.Elemen === S.el && k.Aktif).sort((x, y) => x.Urutan - y.Urutan), subs = ks.filter(k => k.Level === 'sub');
  let h = '';
  subs.forEach(s => {
    const kids = ks.filter(k => k.Induk === s.Kode), rows = s.Unit ? [s] : kids, vis = S.onlyEmpty ? rows.filter(r => !isNA(a.ID, r.Kode) && nm[r.Kode] === undefined) : rows;
    if (S.onlyEmpty && !vis.length) return;
    h += '<details class="sub" id="sub-' + esc(s.Kode) + '" open><summary id="sh-' + esc(s.Kode) + '">' + subHead(s) + '<span class="ms">expand_more</span></summary>' + vis.map(r => rowHtml(r, !s.Unit)).join('') + '</details>';
  });
  $('#clBody').innerHTML = h || emptyBox('task_alt', 'Semua butir sudah dinilai', 'Tidak ada butir tersisa pada elemen ini.');
  paintTicker();
}
function paintTicker() {
  const a = curAudit(); if (!a || !$('#ticker')) return; const sk = hitungSkor(a.ID), e = sk.per.find(x => x.kode === S.el), low = e.terisi > 0 && e.persen < 50;
  $('#ticker').innerHTML = '<div><div class="muted sm b" style="text-transform:uppercase">Skor realisasi elemen ' + e.kode + '</div><div class="flex" style="align-items:baseline"><span class="big num">' + e.skor + '</span><span class="muted"> / ' + e.max + ' poin</span><span class="chip ' + (low ? 'maj' : 'info') + '">' + f1(e.persen) + '%</span></div><div class="muted sm">' + e.terisi + ' / ' + e.butir + ' butir terisi</div></div><div class="grow" style="max-width:420px"><div class="flex between sm muted"><span>Pencapaian elemen</span><span>Total SMKP ' + (sk.terisi < sk.butir ? 'sementara ' : '') + '<b class="num" style="color:var(--text)">' + f1(sk.total) + '%</b></span></div><div class="bar tall mt8"><i class="' + (low ? 'f-or' : 'f-navy') + '" style="width:' + Math.min(100, e.persen) + '%"></i></div></div>';
  $('#emptyBtn').textContent = S.onlyEmpty ? 'Tampilkan semua' : 'Filter belum dinilai (' + (e.butir - e.terisi) + ')';
}
function pickEl(k) { S.el = k; $$('.elpill').forEach(b => b.classList.toggle('on', b.dataset.e === k)); paintCl(); window.scrollTo({ top: 0 }); }
function toggleEmpty() { S.onlyEmpty = !S.onlyEmpty; paintCl(); }
function afterScore(kode) {
  S.dirty = { checklist: false };           // halaman lain dihitung ulang saat dibuka
  const k = krMap()[kode], row = document.getElementById('row-' + kode); if (row) row.outerHTML = rowHtml(k, !!k.Induk);
  const s = krMap()[subOf(kode)], sh = document.getElementById('sh-' + subOf(kode)); if (sh && s) { sh.innerHTML = subHead(s) + '<span class="ms">expand_more</span>'; sh.parentElement.classList.toggle('low', /Mayor/.test(sh.innerHTML)); }
  paintTicker(); renderNav(); $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.pg === S.page));
  const pill = $('.elpill.on'); const sk = hitungSkor(S.audit).per.find(x => x.kode === S.el); if (pill && sk) pill.firstElementChild.outerHTML = sk.terisi < sk.butir ? '<span class="dot"></span>' : '<span class="ms sm">check</span>';
}
function setScore(kode, v) {
  const a = curAudit(); if (!canScore(a.ID, kode)) { toast('Anda tidak dapat mengubah nilai ini (status audit/penugasan).', 'warn'); return; }
  const k = krMap()[kode]; v = Number(v); if (isNaN(v) || v < 0 || v > k.NilaiMaks) { toast('Nilai ' + kode + ' harus 0–' + k.NilaiMaks, 'err'); afterScore(kode); return; }
  const cur = nilaiOf(a.ID)[kode] || {}; if (cur.n === v) return;
  save('Penilaian', { ID: a.ID + '|' + kode, AuditID: a.ID, Kode: kode, Nilai: v, Catatan: cur.c || '', Selesai: cur.s || 0, NA: 0, AlasanNA: '' });
  afterScore(kode);
  const sp = persenSub(a.ID)[subOf(kode)]; if (sp && sp.persen < Number(P('AMBANG_MAYOR_SKOR') || 50) && sp.terisi > 0 && v < k.NilaiMaks) toast('Sub-elemen ' + subOf(kode) + ' kini ' + f0(sp.persen) + '% (< 50%) — pertimbangkan temuan Mayor.', 'warn', 4200);
}
function typeScore(inp) {
  const kode = inp.dataset.k, a = curAudit(), k = krMap()[kode];
  if (inp.value === '') { const cur = nilaiOf(a.ID)[kode]; if (cur && cur.n !== '') { save('Penilaian', { ID: a.ID + '|' + kode, AuditID: a.ID, Kode: kode, Nilai: '', Catatan: cur.c || '', Selesai: 0, NA: 0, AlasanNA: '' }); afterScore(kode); } return; }
  setScore(kode, inp.value);
}
function toggleRow(k) { S.openRows[k] = !S.openRows[k]; const kk = krMap()[k]; document.getElementById('row-' + k).outerHTML = rowHtml(kk, !!kk.Induk); }
function saveNote(ta) {
  const kode = ta.dataset.k, a = curAudit(), cur = nilaiOf(a.ID)[kode] || {};
  save('Penilaian', { ID: a.ID + '|' + kode, AuditID: a.ID, Kode: kode, Nilai: cur.n === undefined ? '' : cur.n, Catatan: ta.value, Selesai: cur.s || 0, NA: cur.a ? 1 : 0, AlasanNA: cur.al || '' }); S.dirty = { checklist: false };
}
function markDone(cb) {
  const kode = cb.dataset.k, a = curAudit(), cur = nilaiOf(a.ID)[kode] || {};
  save('Penilaian', { ID: a.ID + '|' + kode, AuditID: a.ID, Kode: kode, Nilai: cur.n === undefined ? '' : cur.n, Catatan: cur.c || '', Selesai: cb.checked ? 1 : 0, NA: cur.a ? 1 : 0, AlasanNA: cur.al || '' }); afterScore(kode);
}


/* ============================== TEMUAN ============================== */
function kriNama(kode) { const k = krMap()[kode]; return k ? k.Nama : kode; }
const nLok = l => String(l || '').replace(/^\s*#+\s*/, '').trim();
function lokasiOptions(aid) {
  const a = auditById(aid), set = {}; String((a && a.LingkupLokasi) || '').split(/[,\n;]/).forEach(x => { x = x.replace(/^\s*#+\s*/, '').trim(); if (x) set[x] = 1; });
  S.d.temuan.forEach(t => { const l = String(t.Lokasi || '').replace(/^\s*#+\s*/, '').trim(); if (l) set[l] = 1; }); return Object.keys(set);
}
function deptOptions() { const set = {}; S.d.users.forEach(u => { deptList(u.Departemen).forEach(d => { set[d] = 1; }); }); S.d.temuan.forEach(t => { if (t.Departemen) set[t.Departemen] = 1; }); return Object.keys(set); }
function canEditT(t) {
  const a = auditById(t.AuditID); if (!a || a.Status === 'Disetujui') return false;
  return isR('LEAD') || (isR('AUDITOR') && lc(t.Oleh) === lc(S.user.email));
}
function temuanStatusChip(t) {
  if (!t.Kategori) return '<span class="chip mute">Menunggu penetapan</span>';
  if (t.Kategori === 'OFI') return '<span class="chip info">OFI</span>';
  const over = t.Tenggat && daysTo(t.Tenggat) < 0 && t.Status !== 'Closed';
  if (t.Status === 'Closed') return '<span class="chip ok"><span class="ms sm">check_circle</span>Closed</span>';
  if (over) return '<span class="chip crit"><span class="ms sm">report</span>Overdue ' + (-daysTo(t.Tenggat)) + ' hr</span>';
  if (t.Status === 'Review') return '<span class="chip maj"><span class="ms sm">hourglass_top</span>Review</span>';
  return '<span class="chip min"><span class="ms sm">hourglass_top</span>Open</span>';
}
function tenggatMassal() {
  const a = curAudit(), v = ($('#tgMassal') || {}).value; if (!a) return; if (!v) { toast('Pilih tanggal tenggat dulu.', 'err'); return; }
  const l = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Closed' && !t.Tenggat && (isR('LEAD', 'ADMIN') || (isR('AUDITOR') && t.Oleh === S.user.email)));
  if (!l.length) return; if (!confirm('Tetapkan tenggat ' + fmtD(v) + ' untuk ' + l.length + ' temuan?')) return;
  l.forEach(t => save('Temuan', { ID: t.ID, AuditID: t.AuditID, Tenggat: v })); toast(l.length + ' temuan diberi tenggat ' + fmtD(v) + '.'); rTemuan();
}
function rTemuan() {
  const el = $('#page-temuan'), a = curAudit();
  let h = '<div class="ph"><div><div class="crumb">SMKP Minerba / <b>Kepdirjen 185.K/37.04/DJB/2019</b> / Ketidaksesuaian</div><h1>Temuan Ketidaksesuaian & Rekomendasi</h1><p>' + (a ? esc(a.Nama) : 'Belum ada audit') + '</p></div><div class="actions">' + (canTemuan() && a ? '<button class="btn primary" onclick="temuanModal()"><span class="ms">add_circle</span>Catat temuan baru</button>' : '') + '</div></div>';
  if (!a) { el.innerHTML = h + emptyBox('warning', 'Belum ada audit', 'Pilih atau buat audit terlebih dahulu.'); return; }
  const c = counts(a.ID), all = S.d.temuan.filter(t => t.AuditID === a.ID);
  const stat = (k, ic, cls, sub) => '<div class="card kpi"><div class="k-top"><span class="chip ' + cls + '"><span class="ms sm">' + ic + '</span>' + k + '</span></div><div class="big num">' + (c[k] || 0) + (k === 'OFI' ? '' : '<small>sub-elemen</small>') + '</div><div class="sub"><span>' + sub + '</span></div></div>';
  h += '<div class="grid g4">' + stat('Kritikal', 'emergency_home', 'crit', 'Potensi fatality') + stat('Mayor', 'warning', 'maj', 'Skor &lt; ' + (P('AMBANG_MAYOR_SKOR') || 50) + '% / &gt; ' + (P('AMBANG_MAYOR_LOKASI') || 30) + '% lokasi') + stat('Minor', 'error_outline', 'min', 'Tidak sesuai peraturan/standar') + stat('OFI', 'tips_and_updates', 'info', 'Peluang perbaikan (opsional)') + '</div>';
  if (c.draft && canTemuan()) h += '<div class="banner mt16" style="margin-top:12px"><span class="ms">pending_actions</span><div><b>' + c.draft + ' temuan menunggu penetapan kategori</b><span class="sm">' + (isR('LEAD') ? 'Buka temuan untuk menetapkan Kritikal/Mayor/Minor.' : 'Lead Auditor akan menetapkan kategori final.') + '</span></div></div>';
  const tgKosong = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Closed' && !t.Tenggat && (isR('LEAD', 'ADMIN') || (isR('AUDITOR') && t.Oleh === S.user.email)));
  if (tgKosong.length && isR('LEAD', 'AUDITOR', 'ADMIN')) h += '<div class="banner mt16" style="margin-top:12px;flex-wrap:wrap"><span class="ms">event</span><div style="flex:1;min-width:220px"><b>' + tgKosong.length + ' temuan belum punya tenggat perbaikan</b><span class="sm">Tenggat wajib sebelum audit dikunci (Review). Kamu bisa menetapkan satu tanggal sekaligus untuk semua yang kosong, lalu mengubah per temuan bila perlu.</span></div><div class="flex" style="gap:8px"><input class="input" type="date" id="tgMassal" style="width:auto"><button class="btn primary sm" type="button" onclick="tenggatMassal()">Terapkan ke ' + tgKosong.length + ' temuan</button></div></div>';
  const f = S.filters.t, locs = lokasiOptions(a.ID), deps = deptFilterOpts(a.ID);
  h += '<div class="card mt16" style="margin-top:12px"><div class="filters"><div class="searchbox"><span class="ms">search</span><input class="input" id="tQ" placeholder="Cari nomor, kriteria, uraian…" value="' + esc(f.q) + '" oninput="tFilter()" aria-label="Cari temuan"></div>' +
    '<select class="select" id="tK" onchange="tFilter()" aria-label="Kategori"><option value="">Kategori: semua</option>' + ['Kritikal', 'Mayor', 'Minor', 'OFI', 'Draft'].map(k => '<option' + (f.kat === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select>' +
    '<select class="select" id="tE" onchange="tFilter()" aria-label="Elemen"><option value="">Elemen: I–VII</option>' + S.d.elemen.map(e => '<option value="' + e.Kode + '"' + (f.el === e.Kode ? ' selected' : '') + '>' + e.Kode + ' ' + esc(e.Nama) + '</option>').join('') + '</select>' +
    (isR('AUDITEE') ? '' : '<select class="select" id="tD" onchange="tFilter()" aria-label="Departemen"><option value="">Departemen: semua</option>' + deps.map(d => '<option value="' + esc(d.k) + '"' + (f.dep === d.k ? ' selected' : '') + '>' + esc(d.n) + '</option>').join('') + '</select>') +
    '<select class="select" id="tL" onchange="tFilter()" aria-label="Lokasi"><option value="">Area: semua</option>' + locs.map(l => '<option' + (f.lok === l ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
    '<select class="select" id="tS" onchange="tFilter()" aria-label="Status"><option value="">Status: semua</option>' + [['Open', 'Open'], ['Review', 'Review'], ['Closed', 'Closed'], ['Overdue', 'Overdue']].map(s => '<option value="' + s[0] + '"' + (f.st === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></div></div>';
  h += '<div class="mt16" style="margin-top:12px" id="tList"></div>';
  el.innerHTML = h; paintTemuanList();
}
const tFilter = debounce(() => {
  S.filters.t = { q: $('#tQ').value, kat: $('#tK').value, el: $('#tE').value, lok: $('#tL').value, st: $('#tS').value, dep: $('#tD') ? $('#tD').value : '' }; paintTemuanList();
}, 120);
function deptFilterOpts(aid) {
  const m = {}, cnt = {}; let none = 0;
  S.d.temuan.forEach(t => { if (t.AuditID !== aid) return; const k = nDept(t.Departemen); if (!k) { none++; return; } if (!m[k]) m[k] = String(t.Departemen).trim(); cnt[k] = (cnt[k] || 0) + 1; });
  const r = Object.keys(m).sort().map(k => ({ k, n: m[k] + ' (' + cnt[k] + ')' })); if (none) r.push({ k: '__none', n: '(tanpa departemen) (' + none + ')' }); return r;
}
function paintTemuanList() {
  const a = curAudit(), f = S.filters.t, q = lc(f.q); if (!$('#tList')) return;
  const list = S.d.temuan.filter(t => t.AuditID === a.ID).filter(t => {
    if (f.kat === 'Draft' ? t.Kategori : (f.kat && t.Kategori !== f.kat)) return false;
    if (f.dep && (f.dep === '__none' ? nDept(t.Departemen) : nDept(t.Departemen) !== f.dep)) return false; if (f.el && rootOf(t.Kode) !== f.el) return false; if (f.lok && t.Lokasi !== f.lok) return false;
    if (f.st) { const over = t.Tenggat && daysTo(t.Tenggat) < 0 && t.Status !== 'Closed'; if (f.st === 'Overdue' ? !over : t.Status !== f.st) return false; }
    if (q && (t.Nomor + ' ' + t.Kode + ' ' + kriNama(t.Kode) + ' ' + t.Uraian + ' ' + t.Lokasi + ' ' + t.Departemen).toLowerCase().indexOf(q) < 0) return false; return true;
  }).sort((x, y) => String(y.TS).localeCompare(String(x.TS)));
  if (!list.length) { $('#tList').innerHTML = emptyBox('inbox', 'Tidak ada temuan', S.d.temuan.some(t => t.AuditID === a.ID) ? 'Ubah filter pencarian.' : isR('AUDITEE') ? hintAuditee() : 'Temuan baru dicatat dari checklist atau tombol “Catat temuan baru”.'); return; }
  const rows = list.map(t => '<tr class="click" data-id="' + esc(t.ID) + '" onclick="openTemuan(this.dataset.id)"><td><div class="b">' + esc(t.Nomor) + '</div><div class="muted sm">' + fmtD(t.TglTemuan) + '</div></td><td style="max-width:220px"><div class="b" style="color:var(--blue)">' + esc(t.Kode) + '</div><div class="sm clamp2">' + esc(kriNama(t.Kode)) + '</div><div class="muted sm truncate"><span class="ms sm">location_on</span>' + esc(t.Lokasi || '-') + '</div></td><td style="max-width:300px"><div class="clamp2">' + esc(t.Uraian) + '</div>' + (t.Departemen ? '<div class="muted sm">Dept: ' + esc(t.Departemen) + '</div>' : '') + '</td><td>' + katChip(t.Kategori, t.KategoriUsulan) + '</td><td>' + temuanStatusChip(t) + (t.Tenggat && t.Kategori !== 'OFI' ? '<div class="muted sm mt8">Tenggat ' + fmtD(t.Tenggat) + '</div>' : '') + '</td><td><span class="ms muted">chevron_right</span></td></tr>').join('');
  const cards = list.map(t => '<div class="card" data-id="' + esc(t.ID) + '" onclick="openTemuan(this.dataset.id)" style="cursor:pointer;margin-bottom:8px"><div class="flex between wrap"><b>' + esc(t.Nomor) + '</b>' + katChip(t.Kategori, t.KategoriUsulan) + '</div><div class="muted sm mt8"><b style="color:var(--blue)">' + esc(t.Kode) + '</b> · ' + esc(kriNama(t.Kode)) + '</div><div class="clamp2 mt8" style="margin-top:6px">' + esc(t.Uraian) + '</div><div class="flex between wrap mt8"><span class="muted sm"><span class="ms sm">location_on</span>' + esc(t.Lokasi || '-') + '</span>' + temuanStatusChip(t) + '</div></div>').join('');
  $('#tList').innerHTML = '<div class="only-desk table-wrap"><table class="t"><thead><tr><th>No. Temuan</th><th>Kriteria & Lokasi</th><th>Uraian</th><th>Kategori</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="only-mob">' + cards + '</div><div class="muted sm mt8" style="margin-top:8px">Menampilkan ' + list.length + ' temuan</div>';
}
function temuanForm(t, ro) {
  const d = ro ? ' disabled' : '', why = [1, 2, 3, 4, 5].map(i => '<div class="field"' + (i > 3 && !t['Why' + i] ? ' data-extra="1" hidden' : '') + '><label class="label">Mengapa #' + i + (i <= 3 ? '' : ' <span class="muted" style="font-weight:400">(opsional)</span>') + '</label><input class="input" data-f="Why' + i + '" value="' + esc(t['Why' + i] || '') + '" oninput="akarLive()" onchange="tField(this)"' + d + '></div>').join('');
  return '<div class="grid g2"><div class="field"><label class="label">Lokasi / area</label><input class="input" list="dlLok" data-f="Lokasi" value="' + esc(t.Lokasi || '') + '" onchange="tField(this)"' + d + '><datalist id="dlLok">' + lokasiOptions(t.AuditID).map(l => '<option value="' + esc(l) + '">').join('') + '</datalist></div><div class="field"><label class="label">Departemen auditee (PIC)</label><input class="input" list="dlDept" data-f="Departemen" value="' + esc(t.Departemen || '') + '" onchange="tField(this)"' + d + '><datalist id="dlDept">' + deptOptions().map(l => '<option value="' + esc(l) + '">').join('') + '</datalist></div></div>' +
    (t.Kategori !== 'OFI' ? '<div class="field"><label class="label">PIC ditunjuk auditor <span class="muted" style="font-weight:400">— nama otomatis terisi di formulir PICA (auditee masih boleh menggantinya)</span></label><select class="select" data-f="PICDitunjuk" onchange="tField(this)"' + d + '><option value="">— belum ditunjuk —</option>' + picOpts(t).map(u => '<option value="' + esc(u.Nama) + '"' + (u.Nama === t.PICDitunjuk ? ' selected' : '') + '>' + esc(u.Nama) + '</option>').join('') + (t.PICDitunjuk && !picOpts(t).some(u => u.Nama === t.PICDitunjuk) ? '<option selected>' + esc(t.PICDitunjuk) + '</option>' : '') + '</select>' + (t.Departemen && !picOpts(t).length ? '<div class="muted sm mt8">Belum ada akun auditee di departemen “' + esc(t.Departemen) + '”.</div>' : '') + '</div>' : '') +
    (t.Kategori && t.Kategori !== 'OFI' ? '<div class="field"><label class="label">Tenggat perbaikan (ditetapkan auditor) — dasar status overdue PICA</label><input class="input" type="date" data-f="Tenggat" value="' + esc(String(t.Tenggat || '').slice(0, 10)) + '" onchange="tField(this)"' + (isR('LEAD', 'AUDITOR') ? d : ' disabled') + '></div>' : '') +
    '<div class="field"><label class="label">Uraian ketidaksesuaian (fakta objektif)</label><textarea class="textarea" data-f="Uraian" onchange="tField(this)"' + d + '>' + esc(t.Uraian || '') + '</textarea></div>' +
    '<div class="field"><label class="label">Persyaratan / acuan yang tidak dipenuhi</label><textarea class="textarea" data-f="Persyaratan" onchange="tField(this)"' + d + '>' + esc(t.Persyaratan || '') + '</textarea></div>' +
    '<details class="detail"><summary class="b" style="cursor:pointer;min-height:36px;display:flex;align-items:center">Analisis akar masalah (5-Why)</summary><div class="mt8" style="display:grid;gap:8px">' + why + (ro ? '' : '<button class="btn sm ghost" type="button" onclick="whyTambah(this)" ' + (t.Why4 && t.Why5 ? 'hidden' : '') + '>+ Tambah &quot;Mengapa&quot; (maks. 5)</button>') + '<div class="muted" style="font-size:12px">Minimal 3 level &quot;Mengapa&quot;. Berhenti bila jawabannya sudah berupa penyebab sistem/proses (prosedur, pengawasan, sumber daya), bukan kesalahan orang.</div><div class="field"><label class="label">Akar masalah inti <span class="muted" style="font-weight:400">— terisi otomatis dari "Mengapa" terakhir; boleh diedit</span></label><textarea class="textarea" data-f="AkarMasalah" data-auto="' + (!t.AkarMasalah || String(t.AkarMasalah).trim() === akarAuto(t) ? '1' : '0') + '" oninput="this.dataset.auto=\'0\'" onchange="tField(this)"' + d + '>' + esc(t.AkarMasalah || akarAuto(t)) + '</textarea>' + (ro ? '' : '<button class="btn sm ghost mt8" type="button" onclick="akarSusun(this)">Susun ulang dari 5-Why</button>') + '</div></div></details>';
}
function openTemuan(id) {
  const t = S.d.temuan.find(x => x.ID === id); if (!t) return;
  const ro = !canEditT(t), us = usulKategori(t), a = auditById(t.AuditID), locked = a && a.Status === 'Disetujui';
  let kat = '';
  if (isR('LEAD') && !locked) kat = '<div class="card flat" style="background:var(--soft)"><div class="sec-t">Penetapan kategori (Lead Auditor)</div><div class="muted sm">Usulan sistem: <b style="color:var(--text)">' + esc(us.kategori) + '</b> — ' + esc(us.alasan) + '. Kritikal dipilih manual (potensi fatality).</div><div class="flex wrap mt8" style="margin-top:8px">' + ['Kritikal', 'Mayor', 'Minor', 'OFI'].map(k => '<button class="btn sm ' + (t.Kategori === k ? KAT[k] === 'crit' ? 'danger' : KAT[k] === 'maj' ? 'orange' : 'primary' : 'ghost') + '" data-id="' + esc(id) + '" data-k="' + k + '" onclick="setKategori(this.dataset.id,this.dataset.k)">' + k + '</button>').join('') + '</div></div>';
  else kat = '<div class="flex wrap">' + katChip(t.Kategori, t.KategoriUsulan) + temuanStatusChip(t) + '</div>';
  const pica = S.d.pica.filter(p => p.TemuanID === id);
  const html = '<div class="m-head"><h3 class="flex"><span class="chip ' + (KAT[t.Kategori] || '') + '">' + esc(t.Kategori || 'Draft') + '</span>' + esc(t.Nomor) + '</h3><button class="iconbtn" onclick="closeModal()" aria-label="Tutup"><span class="ms">close</span></button></div><div class="m-body">' +
    '<div class="card flat" style="background:var(--soft)"><div class="sec-t">Kriteria SMKP · Elemen ' + esc(rootOf(t.Kode)) + '</div><div class="b"><span style="color:var(--blue)">' + esc(t.Kode) + '</span> — ' + esc(kriNama(t.Kode)) + '</div><div class="muted sm mt8">Temuan ' + fmtD(t.TglTemuan) + ' · oleh ' + esc(t.Oleh) + (t.Kategori && t.Kategori !== 'OFI' ? (t.Tenggat ? ' · tenggat ' + fmtD(t.Tenggat) : ' · <b style="color:var(--crit)">tenggat belum ditetapkan</b>') : '') + '</div></div>' + kat + temuanForm(t, ro) +
    '<div><div class="sec-t">Bukti visual lapangan</div>' + evidenceHtml({ auditId: t.AuditID, temuanId: id, kode: t.Kode }, !ro || isR('LEAD', 'AUDITOR')) + '</div>' +
    (t.Kategori !== 'OFI' ? '<div><div class="flex between"><div class="sec-t" style="margin:0">Tindak lanjut (PICA)</div>' + picaAddBtn(t) + '</div><div class="rowlist mt8" style="margin-top:8px">' + (pica.length ? pica.map(p => picaRowHtml(p, t)).join('') : '<div class="muted sm">Belum ada tindakan koreksi/korektif.</div>') + '</div></div>' : '') +
    (!locked && ((isR('LEAD')) || (isR('AUDITOR') && t.Status === 'Draft' && lc(t.Oleh) === lc(S.user.email))) ? '<div class="flex" style="justify-content:flex-end"><button class="btn sm ghost" style="color:var(--crit)" data-id="' + esc(id) + '" onclick="delTemuan(this.dataset.id)"><span class="ms sm">delete</span>Hapus temuan</button></div>' : '') + '</div>';
  openModal(html, { drawer: true }); S.drawer = id; akarBackfill(t);
}
function akarBackfill(t) { if (!t || !canEditT(t) || String(t.AkarMasalah || '').trim()) return; const v = akarAuto(t); if (!v) return; t.AkarMasalah = v; save('Temuan', { ID: t.ID, AuditID: t.AuditID, AkarMasalah: v }); }
function refreshDrawer() { if (S.drawer && $('#ovl')) { const sc = $('#ovl .drawer').scrollTop; openTemuan(S.drawer); const d = $('#ovl .drawer'); if (d) d.scrollTop = sc; } }
function whyTambah(btn) { const h = document.querySelector('[data-extra][hidden]'); if (h) { h.hidden = false; const i = h.querySelector('input'); if (i) i.focus(); } if (!document.querySelector('[data-extra][hidden]')) btn.hidden = true; }
function akarLive() { const ta = document.querySelector('[data-f="AkarMasalah"]'); if (!ta || ta.dataset.auto !== '1') return; const w = [...document.querySelectorAll('input[data-f^="Why"]')].map(i => i.value.trim()).filter(Boolean); ta.value = w.length ? w[w.length - 1] : ''; }
function akarAuto(t) { const w = [1, 2, 3, 4, 5].map(i => String(t['Why' + i] || '').trim()).filter(Boolean); return w.length ? w[w.length - 1] : ''; }
function akarSusun(btn) { const t = S.d.temuan.find(x => x.ID === S.drawer); if (!t || !canEditT(t)) return; const v = akarAuto(t); t.AkarMasalah = v; const ta = document.querySelector('[data-f="AkarMasalah"]'); if (ta) ta.value = v; save('Temuan', { ID: t.ID, AuditID: t.AuditID, AkarMasalah: v }); toast('Akar masalah disusun dari jawaban 5-Why terakhir.'); }
function tField(inp) {
  const id = S.drawer, t = S.d.temuan.find(x => x.ID === id); if (!t || !canEditT(t)) return;
  const r = { ID: id, AuditID: t.AuditID }; r[inp.dataset.f] = inp.value;
  if (/^Why[1-5]$/.test(inp.dataset.f)) { // akar masalah inti ikut otomatis selama belum diubah manual
    const lama = akarAuto(t), cur = String(t.AkarMasalah || '').trim(); t[inp.dataset.f] = inp.value; const baru = akarAuto(t);
    if (!cur || cur === lama) { r.AkarMasalah = baru; t.AkarMasalah = baru; const ta = document.querySelector('[data-f="AkarMasalah"]'); if (ta) ta.value = baru; }
  }
  if (inp.dataset.f === 'Uraian' && !inp.value.trim()) { toast('Uraian tidak boleh kosong.', 'err'); inp.value = t.Uraian; return; }
  save('Temuan', r); t.KategoriUsulan = usulKategori(t).kategori; S.dirty = {}; S.dirty.temuan = true; if (S.page === 'temuan') paintTemuanList(); if (inp.dataset.f === 'Departemen') setTimeout(refreshDrawer, 0);
  if (inp.dataset.f === 'Tenggat' || inp.dataset.f === 'PICDitunjuk') { toast((inp.dataset.f === 'Tenggat' ? 'Tenggat disimpan: ' + (inp.value ? fmtD(inp.value) : 'dikosongkan') : 'PIC ditunjuk disimpan: ' + (inp.value || 'dikosongkan')), 'ok'); touch(); setTimeout(refreshDrawer, 0); }
}
function setKategori(id, k) {
  const t = S.d.temuan.find(x => x.ID === id), a = auditById(t.AuditID); if (!t) return;
  const r = { ID: id, AuditID: t.AuditID, Kategori: k };
  if (!t.Kategori || t.Status === 'Draft') { r.Status = k === 'OFI' ? 'Closed' : 'Open'; }
  save('Temuan', r); touch(); refreshDrawer(); toast('Kategori ditetapkan: ' + k, 'ok');
}
async function delTemuan(id) {
  const ok = await confirmBox('Hapus temuan?', 'Temuan dan tindak lanjutnya akan dihapus.', 'Hapus', 'danger'); if (!ok) return;
  const t = S.d.temuan.find(x => x.ID === id); S.d.pica.filter(p => p.TemuanID === id).forEach(p => save('Tindak_Lanjut', { ID: p.ID, TemuanID: id }, true));
  save('Temuan', { ID: id, AuditID: t.AuditID }, true); closeModal(); touch(); toast('Temuan dihapus.', 'ok');
}
/** Modal catat temuan baru (dari tombol atau butir checklist). */
function temuanModal(opt) {
  opt = opt || {}; const a = curAudit(); if (!a) { toast('Pilih audit dahulu.', 'warn'); return; } if (a.Status === 'Disetujui') { toast('Audit sudah disetujui.', 'warn'); return; }
  const ks = S.d.kriteria.filter(k => k.Unit && k.Aktif).sort((x, y) => x.Urutan - y.Urutan), files = [];
  const ov = openModal(mHead('Catat temuan ketidaksesuaian', 'add_task') + '<div class="m-body">' +
    '<div class="field"><label class="label">Butir kriteria SMKP *</label><select class="select" id="nwK">' + ks.map(k => '<option value="' + esc(k.Kode) + '"' + (opt.kode === k.Kode ? ' selected' : '') + '>' + esc(k.Kode) + ' — ' + esc(k.Nama.slice(0, 90)) + '</option>').join('') + '</select></div>' +
    '<div class="grid g2"><div class="field"><label class="label">Lokasi / area</label><input class="input" id="nwL" list="dlLok2" placeholder="Contoh: Workshop Pit 3"><datalist id="dlLok2">' + lokasiOptions(a.ID).map(l => '<option value="' + esc(l) + '">').join('') + '</datalist></div><div class="field"><label class="label">Departemen auditee (PIC)</label><input class="input" id="nwD" list="dlDept2"><datalist id="dlDept2">' + deptOptions().map(l => '<option value="' + esc(l) + '">').join('') + '</datalist></div></div>' +
    '<div class="field"><label class="label">Uraian ketidaksesuaian (fakta objektif) *</label><textarea class="textarea" id="nwU" placeholder="Kondisi yang ditemukan, data alat/dokumen…"></textarea></div>' +
    '<div class="field"><label class="label">Persyaratan / acuan yang tidak dipenuhi</label><textarea class="textarea" id="nwP" placeholder="Pasal peraturan, prosedur, atau standar"></textarea></div>' +
    '<div id="nwHint" class="banner info"></div>' +
    (isR('LEAD') ? '<div class="field"><label class="label">Tetapkan kategori (opsional)</label><div class="flex wrap" id="nwKat">' + ['Kritikal', 'Mayor', 'Minor', 'OFI'].map(k => '<button type="button" class="btn sm ghost" data-k="' + k + '">' + k + '</button>').join('') + '</div></div>' : '') +
    '<div class="field"><label class="label">Bukti foto / dokumen</label><div class="flex wrap"><button type="button" class="btn ghost sm" id="nwFoto"><span class="ms sm">photo_camera</span>Ambil foto</button><button type="button" class="btn ghost sm" id="nwFile"><span class="ms sm">attach_file</span>Pilih berkas</button><span class="muted sm" id="nwFl">Belum ada berkas</span></div></div></div>' +
    '<div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="nwGo"><span class="ms">save</span>Simpan temuan</button></div>', { wide: true });
  let kat = '';
  const hint = () => { const us = usulKategori({ AuditID: a.ID, Kode: $('#nwK').value, Lokasi: $('#nwL').value }); $('#nwHint').innerHTML = '<span class="ms">lightbulb</span><div><b>Usulan sistem: ' + us.kategori + '</b><span class="sm">' + esc(us.alasan) + '. Kategori final ditetapkan Lead Auditor.</span></div>'; };
  $('#nwK').onchange = hint; $('#nwL').oninput = debounce(hint, 150); hint();
  $$('#nwKat button', ov).forEach(b => b.onclick = () => { kat = kat === b.dataset.k ? '' : b.dataset.k; $$('#nwKat button', ov).forEach(x => x.className = 'btn sm ' + (x.dataset.k === kat ? 'primary' : 'ghost')); });
  const addF = cam => pickFile({ camera: cam }, f => { files.push(f); $('#nwFl').textContent = files.length + ' berkas dipilih'; });
  $('#nwFoto').onclick = () => addF(true); $('#nwFile').onclick = () => addF(false);
  $('#nwGo', ov).onclick = () => {
    const u = $('#nwU').value.trim(); if (!u) { toast('Uraian temuan wajib diisi.', 'err'); return; }
    const k = $('#nwK').value, n = S.d.temuan.filter(t => t.AuditID === a.ID).reduce((m, t) => { const x = /(\d+)$/.exec(String(t.Nomor || '')); return x && +x[1] > m ? +x[1] : m; }, 0) + 1;
    const rec = { ID: uid(), AuditID: a.ID, Nomor: 'HP-' + String(n).padStart(3, '0'), Kode: k, Lokasi: $('#nwL').value.trim(), Departemen: $('#nwD').value.trim(), Uraian: u, Persyaratan: $('#nwP').value.trim(), Kategori: '', Status: 'Draft', Oleh: S.user.email, TS: nowIso(), TglTemuan: todayIso() };
    rec.KategoriUsulan = usulKategori(rec).kategori;
    save('Temuan', Object.assign({}, rec, isR('LEAD') ? { Kategori: undefined } : {}));
    if (kat && isR('LEAD')) setKategori(rec.ID, kat);
    files.forEach(f => uploadEvidence(f, { auditId: a.ID, temuanId: rec.ID, kode: k }));
    closeModal(); touch(); toast('Temuan ' + rec.Nomor + ' dicatat.', 'ok'); if (S.page !== 'temuan' && S.page !== 'checklist') go('temuan');
  };
}

/* ============================== PICA ============================== */
function picaStChip(s) { return '<span class="chip ' + ({ Open: 'min', Direncanakan: 'info', Diajukan: 'maj', Terverifikasi: 'ok', Ditolak: 'crit' }[s] || '') + '">' + esc(s) + '</span>'; }
function nDept(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function deptList(v) { return String(v || '').split(/[;\n|]+/).map(s => s.trim()).filter(Boolean); }
function deptCocok(dt, da) { const n = nDept(dt); return !!n && deptList(da).some(d => nDept(d) === n); }
function hintAuditee() { const d = S.user.dept; return d ? 'Yang tampil hanya temuan departemen “' + d + '” sejak dicatat auditor (kolom Departemen pada temuan harus sama dengan departemen akunmu).' : 'Akunmu belum punya departemen. Minta Admin mengisi Departemen di menu Pengguna.'; }
function canPicaEdit(t, p) {
  if (!t || t.Status === 'Closed') return false; const a = auditById(t.AuditID); if (!a) return false; // tindak lanjut berlanjut setelah laporan disetujui
  if (p && p.Status === 'Terverifikasi') return false;
  if (isR('AUDITEE')) return deptCocok(t.Departemen, S.user.dept) && (!p || ['Open', 'Direncanakan', 'Ditolak'].indexOf(p.Status) > -1);
  return isR('LEAD', 'AUDITOR');
}
const auditDisetujui = t => { const a = auditById(t.AuditID); return !!a && a.Status === 'Disetujui'; };
function picaAddBtn(t) { return canPicaEdit(t) ? '<button class="btn sm primary" data-id="' + esc(t.ID) + '" onclick="picaModal(this.dataset.id)"><span class="ms sm">add_task</span>' + (auditDisetujui(t) ? 'Isi rencana & bukti' : 'Isi rencana tindak lanjut') + '</button>' : ''; }
function picaRowHtml(p, t) {
  const apr = auditDisetujui(t), rencanaOk = !!(p.Koreksi && p.Korektif && p.Target);
  let b = ''; if (canPicaEdit(t, p)) b += '<button class="btn sm ' + (apr && rencanaOk ? 'primary' : 'ghost') + '" data-t="' + esc(t.ID) + '" data-id="' + esc(p.ID) + '" onclick="picaModal(this.dataset.t,this.dataset.id)"><span class="ms sm">' + (apr && rencanaOk ? 'upload_file' : 'edit') + '</span>' + (apr ? (rencanaOk ? 'Unggah bukti & ajukan' : 'Lengkapi & ajukan') : 'Ubah rencana') + '</button>';
  if (p.Status === 'Diajukan' && isR('LEAD', 'AUDITOR')) b += '<button class="btn sm ok" data-id="' + esc(p.ID) + '" onclick="verifyPica(this.dataset.id,true)"><span class="ms sm">verified</span>Setujui</button><button class="btn sm warn" data-id="' + esc(p.ID) + '" onclick="verifyPica(this.dataset.id,false)"><span class="ms sm">replay</span>Tolak</button>';
  const over = p.Target && daysTo(p.Target) < 0 && p.Status !== 'Terverifikasi';
  return '<div class="card flat" style="background:var(--soft)"><div class="flex between wrap">' + picaStChip(p.Status) + (over ? '<span class="chip crit">Target lewat</span>' : '') + '</div><dl class="kv mt8" style="margin-top:8px"><dt>Koreksi</dt><dd>' + esc(p.Koreksi || '-') + '</dd><dt>Korektif</dt><dd>' + esc(p.Korektif || '-') + '</dd><dt>PIC</dt><dd>' + esc(p.PIC || '-') + (t.PICDitunjuk && p.PIC && p.PIC !== t.PICDitunjuk ? ' <span class="muted sm">(ditunjuk auditor: ' + esc(t.PICDitunjuk) + ', PIC diubah)</span>' : '') + '</dd><dt>Target</dt><dd>' + fmtD(p.Target) + '</dd>' + (p.CatatanVerif ? '<dt>Catatan</dt><dd style="color:var(--crit)">' + esc(p.CatatanVerif) + '</dd>' : '') + '</dl>' + (p.Status === 'Direncanakan' && !apr ? '<div class="muted sm mt8" style="margin-top:8px">Rencana tersimpan dan akan tercantum dalam laporan. Bukti pelaksanaan diajukan setelah audit disetujui.</div>' : '') + '<div class="mt8" style="margin-top:8px">' + evidenceHtml({ auditId: t.AuditID, temuanId: t.ID, tindakId: p.ID, kode: t.Kode }, false) + '</div>' + (b ? '<div class="flex wrap mt8" style="margin-top:8px">' + b + '</div>' : '') + '</div>';
}
function recalcLocal() {
  S.d.temuan.forEach(t => {
    if (!t.Kategori || t.Kategori === 'OFI' || t.Status === 'Draft') return; const mine = S.d.pica.filter(p => p.TemuanID === t.ID);
    t.Status = mine.length && mine.every(p => p.Status === 'Terverifikasi') ? 'Closed' : mine.some(p => p.Status === 'Diajukan') ? 'Review' : 'Open';
  });
}
function savePica(rec) { save('Tindak_Lanjut', rec); recalcLocal(); touch(); if (S.drawer) refreshDrawer(); }
function picField(t, p, dis) {
  const o = picOpts(t), cur = p.PIC || picDefault(t);
  if (dis) return '<input class="input" id="pcP" value="' + esc(cur) + '" disabled>';
  if (!o.length) return '<input class="input" id="pcP" value="' + esc(cur) + '" placeholder="Belum ada auditee di departemen ini — ketik nama PIC">';
  const names = o.map(u => u.Nama), lain = cur && names.indexOf(cur) < 0;
  return '<select class="select" id="pcS" onchange="picPilih(this)"><option value="">— Pilih PIC —</option>' + o.map(u => '<option value="' + esc(u.Nama) + '"' + (u.Nama === cur ? ' selected' : '') + '>' + esc(u.Nama) + '</option>').join('') + '<option value="__lain"' + (lain ? ' selected' : '') + '>Lainnya (ketik manual)…</option></select>' +
    '<input class="input mt8" id="pcP" style="margin-top:8px' + (lain ? '' : ';display:none') + '" value="' + esc(lain ? cur : (cur || '')) + '" placeholder="Nama PIC"' + '>';
}
function picPilih(sel) { const i = $('#pcP'); if (sel.value === '__lain') { i.style.display = ''; i.value = ''; i.focus(); } else { i.style.display = 'none'; i.value = sel.value; } }
function picOpts(t) { return S.d.users.filter(u => u.Role === 'AUDITEE' && Number(u.Aktif) !== 0 && deptCocok(t.Departemen, u.Departemen)); }
function picDefault(t) { if (t.PICDitunjuk) return t.PICDitunjuk; if (isR('AUDITEE')) return S.user.nama; const o = picOpts(t); return o.length === 1 ? o[0].Nama : ''; }
function picaModal(tid, pid) {
  const t = S.d.temuan.find(x => x.ID === tid), p = pid ? S.d.pica.find(x => x.ID === pid) : {}; if (!t) return;
  const aprv = auditDisetujui(t), adaRencana = !!(p.Koreksi && p.Korektif && p.Target), kunci = aprv && adaRencana, dis = kunci ? ' disabled' : '';
  const id = p.ID || uid(), ctx = { auditId: t.AuditID, temuanId: tid, tindakId: id, kode: t.Kode };
  const info = aprv
    ? '<div class="banner info"><span class="ms">task_alt</span><div><b>Tahap 2 — Pelaksanaan</b><span class="sm">' + (kunci ? 'Rencana di bawah sudah tercantum dalam laporan yang disetujui dan tidak dapat diubah. ' : 'Rencana belum lengkap — lengkapi dahulu. ') + 'Unggah bukti pelaksanaan, lalu ajukan ke auditor untuk diverifikasi.</span></div></div>'
    : '<div class="banner info"><span class="ms">edit_note</span><div><b>Tahap 1 — Rencana tindak lanjut</b><span class="sm">Rencana ini akan dicantumkan dalam laporan audit. Bukti pelaksanaan diunggah nanti, setelah laporan disetujui.</span></div></div>';
  const ov = openModal(mHead((aprv ? 'Pelaksanaan tindak lanjut — ' : 'Rencana tindak lanjut — ') + t.Nomor, 'assignment_turned_in') + '<div class="m-body"><div class="card flat" style="background:var(--soft)"><div class="b sm">' + esc(t.Kode) + ' · ' + esc(kriNama(t.Kode)) + '</div><div class="sm mt8" style="margin-top:6px">' + esc(t.Uraian) + '</div></div>' + info +
    (p.Status === 'Ditolak' && p.CatatanVerif ? '<div class="banner crit"><span class="ms">replay</span><div><b>Ditolak auditor</b><span class="sm">' + esc(p.CatatanVerif) + '</span></div></div>' : '') +
    '<div class="field"><label class="label">Tindakan koreksi langsung (correction) *</label><textarea class="textarea" id="pcK"' + dis + ' placeholder="Tindakan segera memperbaiki kondisi di lokasi…">' + esc(p.Koreksi || '') + '</textarea></div>' +
    '<div class="field"><label class="label">Tindakan pencegahan berulang (corrective) *</label><textarea class="textarea" id="pcC"' + dis + ' placeholder="Sistem/prosedur agar tidak terulang…">' + esc(p.Korektif || '') + '</textarea></div>' +
    '<div class="grid g2"><div class="field"><label class="label">Penanggung jawab (PIC) *' + (kunci ? '' : ' <span class="muted" style="font-weight:400">— otomatis dari departemen ' + esc(t.Departemen || '-') + '</span>') + '</label>' + picField(t, p, kunci) + '</div><div class="field"><label class="label">Target selesai *</label><input class="input" id="pcT" type="date"' + dis + ' value="' + esc(p.Target || t.Tenggat || '') + '"></div></div>' +
    (aprv ? '<div class="field"><label class="label">Bukti pelaksanaan *</label><div id="pcEv">' + evidenceHtml(ctx, true) + '</div></div>' : '') +
    '</div><div class="m-foot">' + (kunci ? '' : '<button class="btn ghost" id="pcDr">Simpan draf</button>') + '<button class="btn primary" id="pcGo"><span class="ms">' + (aprv ? 'send' : 'save') + '</span>' + (aprv ? 'Ajukan bukti ke auditor' : 'Simpan rencana') + '</button></div>', { wide: true });
  const collect = st => { const k = $('#pcK').value.trim(), c = $('#pcC').value.trim(), pp = $('#pcP').value.trim(), tg = $('#pcT').value;
    if (st !== 'Open' && (!k || !c || !pp || !tg)) { toast('Lengkapi koreksi, korektif, PIC, dan target terlebih dahulu.', 'err'); return; }
    if (st === 'Diajukan' && !evidenceOf(ctx).length) { toast('Unggah minimal satu bukti pelaksanaan (foto/berkas) sebelum mengajukan.', 'err'); return; }
    const pdt = Object.assign({ ID: id, TemuanID: tid, AuditID: t.AuditID, Koreksi: k, Korektif: c, PIC: pp, PICEmail: isR('AUDITEE') ? S.user.email : ((picOpts(t).find(u => u.Nama === pp) || {}).Email || p.PICEmail || ''), Target: tg, Status: st, Oleh: p.Oleh || S.user.email }, st === 'Diajukan' ? { CatatanVerif: '' } : {});
    savePica(pdt); closeModal(); toast(st === 'Diajukan' ? 'Bukti pelaksanaan diajukan ke auditor.' : st === 'Direncanakan' ? 'Rencana tindak lanjut tersimpan dan akan tercantum dalam laporan.' : 'Draf tersimpan.', 'ok'); };
  if ($('#pcDr', ov)) $('#pcDr', ov).onclick = () => collect('Open'); $('#pcGo', ov).onclick = () => collect(aprv ? 'Diajukan' : 'Direncanakan');
}
async function verifyPica(id, ok) {
  const p = S.d.pica.find(x => x.ID === id); if (!p) return; const base = { ID: id, TemuanID: p.TemuanID, AuditID: p.AuditID };
  if (p.Status !== 'Diajukan') { toast('Hanya tindak lanjut yang sudah diajukan beserta bukti yang dapat diverifikasi.', 'err'); return; }
  if (lc(p.Oleh) === lc(S.user.email)) { toast('Kamu tidak dapat memverifikasi PICA yang kamu isi/ajukan sendiri. Minta Auditor atau Lead lain.', 'err'); return; }
  if (ok && !evidenceOf({ temuanId: p.TemuanID, tindakId: id }).length) { toast('Belum ada bukti perbaikan yang diunggah untuk PICA ini.', 'err'); return; }
  if (ok) { const c = await confirmBox('Setujui tindak lanjut?', 'Bukti memenuhi persyaratan. Bila seluruh tindakan terverifikasi, temuan menjadi Closed.', 'Setujui', 'ok'); if (!c) return; savePica(Object.assign(base, { Status: 'Terverifikasi', VerifOleh: S.user.email, VerifTS: nowIso(), CatatanVerif: '' })); toast('Terverifikasi.', 'ok'); }
  else { const c = await dialog('Tolak / minta revisi', '<label class="label" for="dgIn">Catatan revisi untuk PIC *</label><textarea class="textarea" id="dgIn"></textarea>', 'Kembalikan ke PIC', 'warn'); if (!c) return; savePica(Object.assign(base, { Status: 'Ditolak', CatatanVerif: c, VerifOleh: S.user.email, VerifTS: nowIso() })); toast('Dikembalikan ke PIC.', 'warn'); }
}
function rPica() {
  const el = $('#page-pica'), a = curAudit();
  let h = '<div class="ph"><div><div class="crumb"><b>Kepdirjen 185.K/37.04/DJB/2019</b> · Lampiran II PICA</div><h1>Tindak Lanjut & PICA</h1><p>Plan · Implement · Check · Action — ' + (a ? esc(a.Nama) : '') + '</p></div></div>';
  if (!a) { el.innerHTML = h + emptyBox('task_alt', 'Belum ada audit', 'Pilih audit terlebih dahulu.'); return; }
  const ts = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori !== 'OFI'), ps = picaStats(a.ID), tab = S.filters.p.tab;
  const m = (lbl, n, cls, sub) => '<div class="card kpi" style="padding:12px"><div class="k-top"><span class="sm">' + lbl + '</span><span class="chip ' + cls + '">●</span></div><div class="big num" style="font-size:28px;line-height:34px">' + n + '<small>' + sub + '</small></div></div>';
  h += '<div class="grid g5">' + m('Belum ada rencana', ps.rencana, 'min', 'temuan') + m('Rencana terisi', ps.pelaksanaan, 'info', 'temuan') + m('Menunggu verifikasi', ps.review, 'maj', 'temuan') + m('Selesai (Closed)', ps.closed, 'ok', 'terverifikasi') + '<div class="card kpi" style="padding:12px;background:var(--crit-bg);color:var(--crit)"><div class="k-top" style="color:var(--crit)"><span class="sm">Lewat tenggat</span><span class="chip crit">Warning</span></div><div class="big num" style="font-size:28px;line-height:34px">' + ps.overdue + '<small style="color:var(--crit)">temuan</small></div></div></div>';
  const dp = {}; ts.forEach(t => { const k = t.Departemen || '(tanpa departemen)', x = dp[k] = dp[k] || { n: 0, c: 0, r: 0, rc: 0, pl: 0, od: 0 }; x.n++; { const f = picaFase(t); if (f === 'closed') x.c++; else if (f === 'review') x.r++; else if (f === 'pelaksanaan') x.pl++; else x.rc++; } if (t.Tenggat && daysTo(t.Tenggat) < 0 && t.Status !== 'Closed') x.od++; });
  if (ts.length) h += '<div class="card mt16" style="margin-top:12px"><div class="sec-t">Progres tindak lanjut per departemen</div><div class="table-wrap"><table class="t"><thead><tr><th>Departemen</th><th>Temuan</th><th>Belum ada rencana</th><th>Rencana terisi</th><th>Menunggu verifikasi</th><th>Selesai</th><th>Overdue</th><th style="min-width:130px">Progres</th></tr></thead><tbody>' + Object.keys(dp).sort().map(k => { const x = dp[k], pc = pct(x.c, x.n); return '<tr><td class="b">' + esc(k) + '</td><td>' + x.n + '</td><td>' + x.rc + '</td><td>' + x.pl + '</td><td>' + x.r + '</td><td>' + x.c + '</td><td' + (x.od ? ' style="color:var(--crit);font-weight:700"' : '') + '>' + x.od + '</td><td><div class="bar"><i style="background:var(--ok,#1a9d5c);width:' + pc + '%"></i></div><span class="sm muted">' + f0(pc) + '%</span></td></tr>'; }).join('') + '</tbody></table></div></div>';
  const T = [['all', 'Semua', ts.length], ['rencana', 'Belum ada rencana', ps.rencana], ['pelaksanaan', 'Rencana terisi', ps.pelaksanaan], ['review', 'Menunggu verifikasi', ps.review], ['closed', 'Selesai', ps.closed], ['overdue', 'Overdue', ps.overdue]];
  h += '<div class="tabs mt16" style="margin-top:12px">' + T.map(x => '<button class="tab' + (tab === x[0] ? ' on' : '') + '" data-t="' + x[0] + '" onclick="picaTab(this.dataset.t)">' + x[1] + '<span class="cnt">' + x[2] + '</span></button>').join('') + '</div><div id="pList" class="rowlist mt16" style="margin-top:12px"></div>';
  h += '<div class="stepbar"><div class="flex"><div class="ring"><svg viewBox="0 0 36 36" width="48" height="48">' + donutSvg(pct(ps.closed, ps.total), 'var(--orange)', 'rgba(255,255,255,.2)').replace(/<svg[^>]*>|<\/svg>/g, '') + '</svg><b>' + f0(pct(ps.closed, ps.total)) + '%</b></div><div><div class="b">Penyelesaian PICA: ' + f1(pct(ps.closed, ps.total)) + '%</div><div class="sm" style="color:#B2C5FF">' + ps.closed + ' dari ' + ps.total + ' temuan Closed</div></div></div><div class="sm" style="color:#B2C5FF">Tenggat tindak lanjut ' + (P('TENGGAT_HARI') || 30) + ' hari setelah penutupan audit</div></div>';
  el.innerHTML = h; paintPicaList();
}
function picaTab(t) { S.filters.p.tab = t; $$('#page-pica .tab').forEach(b => b.classList.toggle('on', b.dataset.t === t)); paintPicaList(); }
function paintPicaList() {
  const a = curAudit(), tab = S.filters.p.tab; if (!$('#pList')) return;
  const ts = S.d.temuan.filter(t => t.AuditID === a.ID && t.Kategori !== 'OFI').filter(t => { const over = t.Tenggat && daysTo(t.Tenggat) < 0 && t.Status !== 'Closed'; return tab === 'all' || (tab === 'overdue' && over) || (tab === 'rencana' && picaFase(t) === 'rencana') || (tab === 'pelaksanaan' && picaFase(t) === 'pelaksanaan') || (tab === 'review' && picaFase(t) === 'review') || (tab === 'closed' && t.Status === 'Closed'); })
    .sort((x, y) => { const o = { Kritikal: 0, Mayor: 1, Minor: 2 }; return o[x.Kategori] - o[y.Kategori] || String(x.Tenggat).localeCompare(String(y.Tenggat)); });
  if (!ts.length) { $('#pList').innerHTML = emptyBox('task_alt', 'Tidak ada item', isR('AUDITEE') && !ts.length ? hintAuditee() : 'Belum ada temuan pada kategori ini.'); return; }
  $('#pList').innerHTML = ts.map(t => {
    const rows = S.d.pica.filter(p => p.TemuanID === t.ID), over = t.Tenggat && daysTo(t.Tenggat) < 0 && t.Status !== 'Closed';
    return '<div class="card pica-card ' + (t.Status === 'Closed' ? 'cl' : over ? 'over' : t.Status === 'Review' ? 'rev' : '') + '"><div class="flex between wrap"><div class="flex wrap"><span class="chip ' + KAT[t.Kategori] + '">' + t.Kategori.toUpperCase() + '</span><b>' + esc(t.Nomor) + '</b>' + temuanStatusChip(t) + '</div><button class="btn sm ghost" data-id="' + esc(t.ID) + '" onclick="openTemuan(this.dataset.id)"><span class="ms sm">open_in_new</span>Detail</button></div>' +
      '<h3 class="mt8" style="margin-top:8px">' + esc(String(t.Uraian).slice(0, 140)) + '</h3><div class="muted sm">Elemen ' + esc(rootOf(t.Kode)) + ' · ' + esc(t.Kode) + ' ' + esc(kriNama(t.Kode)) + ' · ' + esc(t.Lokasi || '-') + '</div><div class="grid g2 mt8" style="margin-top:8px;background:var(--soft);padding:10px;border-radius:8px"><div><div class="muted sm">PIC / Departemen</div><b>' + (t.PICDitunjuk ? esc(t.PICDitunjuk) + ' · ' : '') + esc(t.Departemen || '-') + '</b></div><div><div class="muted sm">Tenggat</div><b style="color:' + (over ? 'var(--crit)' : 'inherit') + '">' + fmtD(t.Tenggat) + '</b></div></div>' +
      '<div class="rowlist mt8" style="margin-top:8px">' + (rows.length ? rows.map(p => picaRowHtml(p, t)).join('') : '<div class="muted sm">Belum ada rencana tindak lanjut.</div>') + '</div><div class="flex wrap mt8" style="margin-top:8px">' + picaAddBtn(t) + '</div></div>';
  }).join('');
}


/* ============================== LAPORAN ============================== */
const roLap = a => !a || a.Status === 'Disetujui' || !isR('LEAD', 'ADMIN');
function pertOf(aid, jenis) { return S.d.pertemuan.find(p => p.AuditID === aid && p.Jenis === jenis); }
function rLaporan() {
  const el = $('#page-laporan'), a = curAudit();
  let h = '<div class="ph"><div><div class="crumb">Kepdirjen 185.K/37.04/DJB/2019 · Bagian Pelaporan</div><h1>Laporan Audit Internal</h1><p>' + (a ? esc(a.Nama) : '') + '</p></div></div>';
  if (!a) { el.innerHTML = h + emptyBox('description', 'Belum ada audit', 'Pilih audit terlebih dahulu.'); return; }
  const sk = hitungSkor(a.ID), tm = S.d.temuan.filter(t => t.AuditID === a.ID), draft = tm.filter(t => !t.Kategori).length;
  const open = tm.filter(t => t.Kategori && t.Kategori !== 'OFI' && t.Status !== 'Closed').length;
  const pr = S.d.praktik.filter(x => x.AuditID === a.ID), buka = pertOf(a.ID, 'Pembukaan'), tutup = pertOf(a.ID, 'Penutupan');
  const hd = j => S.d.kehadiran.filter(x => x.AuditID === a.ID && x.Jenis === j).length, rs = S.d.respon.filter(x => x.AuditID === a.ID);
  const ck = (ok, t, s, warn) => '<div class="flex" style="gap:10px;padding:8px 0;align-items:flex-start"><span class="ms" style="color:var(--' + (ok ? 'ok' : warn ? 'maj' : 'muted') + ')">' + (ok ? 'check_circle' : warn ? 'error' : 'radio_button_unchecked') + '</span><div><div class="b">' + t + '</div><div class="muted sm">' + s + '</div></div></div>';
  const inReview = a.Status === 'Review' || a.Status === 'Disetujui';
  h += '<div class="grid g2"><div class="card"><div class="sec-t">Kesiapan laporan</div>' +
    ck(inReview, 'Status audit: ' + esc(a.Status), 'Dokumen dibuat setelah audit berstatus Review (nilai terkunci).') +
    ck(sk.terisi === sk.butir, 'Penilaian ' + sk.terisi + ' / ' + sk.butir + ' butir', 'Butir N/A tidak dihitung.', true) +
    ck(!draft, draft ? draft + ' temuan belum ditetapkan kategorinya' : 'Semua temuan sudah berkategori', 'Lead Auditor menetapkan kategori final.', !!draft) +
    ck(!open, open ? open + ' temuan belum Closed' : 'Semua temuan Closed', 'Tidak menghalangi pembuatan laporan; status tampil di Lampiran II.', !!open) +
    ck(pr.length > 0, pr.length + ' praktik baik', 'Bagian 5.1.1 laporan.', !pr.length) +
    ck(!!(buka && buka.Tanggal) && !!(tutup && tutup.Tanggal), 'Pertemuan pembukaan & penutupan', 'Lampiran III dan IV (daftar hadir: ' + hd('Pembukaan') + ' / ' + hd('Penutupan') + ').', !(buka && tutup)) +
    ck(rs.length > 0, rs.length + ' respon perusahaan', 'Lampiran VI.', !rs.length) + '</div>' +
    '<div class="card"><div class="sec-t">Tingkat pencapaian (5.2)</div><div class="num" style="font:800 40px var(--f-head);color:var(--navy)">' + f1(sk.total) + '%</div><div class="muted sm">Σ (persentase elemen × bobot) — dihitung dari nilai yang diisi auditor.</div><div class="mt16" style="margin-top:12px">' +
    sk.per.map(p => '<div class="flex between sm" style="padding:4px 0"><span>' + esc(p.kode) + '. ' + esc(p.nama) + ' <span class="muted">(' + f0(p.bobot * 100) + '%)</span></span><b class="num">' + f1(p.persen) + '%</b></div>').join('') + '</div></div></div>';
  /* generate */
  const dks = (S.d.dokumen || []).filter(x => x.AuditID === a.ID).sort((x, y) => String(y.Dibuat).localeCompare(String(x.Dibuat)));
  const terbit = dks.find(x => x.Status === 'TERBIT'), draf = dks.find(x => x.Status === 'DRAF'), ditarik = dks.filter(x => x.Status === 'DITARIK');
  const canGen = isR('LEAD', 'ADMIN') && inReview && !terbit, canExp = isR('LEAD', 'ADMIN', 'PJO') && a.LaporanDocUrl;
  const canTerbit = isR('LEAD', 'ADMIN') && a.Status === 'Disetujui' && !!draf, canTarik = isR('LEAD', 'ADMIN') && !!terbit, canScan = isR('LEAD', 'ADMIN');
  const cur = terbit || draf, vUrl = k => location.href.split('#')[0] + '#/verifikasi/' + k;
  const lnk = (u, t, ic) => u ? '<a class="btn ghost sm" href="' + esc(u) + '" target="_blank" rel="noopener"><span class="ms sm">' + ic + '</span>' + t + '</a>' : '';
  const tplOk = !!P('TEMPLATE_DOCX_ID');
  h += '<div class="card mt16" style="margin-top:12px"><div class="sec-t">Dokumen laporan</div><div class="muted sm">Laporan disusun dari <b>template .docx</b> yang meniru Laporan Internal Audit SMKP 2025 (sampul, daftar isi, tabel per sub-elemen, grafik radar, tanda tangan, Lampiran I–VI). ' + (tplOk ? '<span class="chip ok">Template terpasang</span>' : '<span class="chip maj">Template belum diunggah — memakai format cadangan Google Docs</span>') + '</div>' +
    (isR('ADMIN') ? '<div class="flex wrap mt8" style="margin-top:10px"><label class="btn ghost" style="cursor:pointer"><span class="ms">upload_file</span>' + (tplOk ? 'Ganti template .docx' : 'Unggah template .docx') + '<input type="file" id="lpTpl" accept=".docx" hidden></label></div>' : '') +
    (why => why.length ? '<div class="banner info mt8" style="margin-top:10px"><span class="ms">lock</span><div><b>Tombol laporan belum aktif karena:</b><span class="sm">' + why.join('<br>') + '</span></div></div>' : '')([
      !isR('LEAD', 'ADMIN') ? '• Pembuatan &amp; penerbitan laporan hanya untuk Lead Auditor / Admin (peranmu: ' + esc(ROLE_LABEL[S.user.role]) + ').' : '',
      isR('LEAD', 'ADMIN') && !inReview && !terbit ? '• “Buat draf laporan” aktif saat status audit <b>Review</b> (sekarang: ' + esc(a.Status) + '). Ubah status di Jadwal &amp; Penugasan setelah penilaian selesai.' : '',
      isR('LEAD', 'ADMIN') && a.Status !== 'Disetujui' ? '• “Terbitkan (unggah PDF final)” aktif setelah audit berstatus <b>Disetujui</b> dan ada draf.' : '',
      isR('LEAD', 'ADMIN') && a.Status === 'Disetujui' && !draf && !terbit ? '• Belum ada draf laporan; buat draf lebih dulu (status audit harus Review).' : '',
      !a.LaporanDocUrl ? '• Tombol PDF/Docx aktif setelah draf laporan dibuat.' : '',
      !tplOk ? '• Template .docx belum terpasang (Admin: “Unggah template .docx”).' : ''
    ].filter(Boolean)) +
    '<div class="flex wrap mt8" style="margin-top:10px"><button class="btn primary" id="lpGen"' + (canGen ? '' : ' disabled') + '><span class="ms">auto_awesome</span>' + (a.LaporanDocUrl ? 'Buat ulang draf' : 'Buat draf laporan') + '</button>' +
    '<button class="btn ghost" id="lpPdf"' + (canExp ? '' : ' disabled') + '><span class="ms">picture_as_pdf</span>PDF (draf)</button><button class="btn ghost" id="lpDocx"' + (canExp ? '' : ' disabled') + '><span class="ms">article</span>Ekspor Docx</button></div>' +
    '<div class="flex wrap mt8" style="margin-top:10px"><button class="btn orange" id="lpTerbit"' + (canTerbit ? '' : ' disabled') + ' title="Hanya untuk audit berstatus Disetujui"><span class="ms">verified</span>Terbitkan (unggah PDF final)</button><button class="btn ghost" id="lpTarik"' + (canTarik ? '' : ' hidden') + '><span class="ms">undo</span>Tarik dokumen</button><button class="btn ghost" id="lpScan"' + (canScan ? '' : ' hidden') + '><span class="ms">manage_search</span>Pindai placeholder template</button></div>' +
    (cur ? '<div class="banner' + (terbit ? ' ok' : '') + ' mt8" style="margin-top:10px"><span class="ms">' + (terbit ? 'verified' : 'edit_document') + '</span><div><strong>' + esc(cur.Status) + '</strong> · ' + esc(cur.Nomor) + (terbit ? ' · terbit ' + fmtDT(terbit.Terbit) : '') + '<br><span class="sm">Kode verifikasi: <b class="num">' + esc(cur.KodeVerifikasi) + '</b>' + (terbit ? ' · SHA-256 ' + esc(String(cur.HashPdf).slice(0, 16)) + '…' : '') + '</span>' + (terbit ? '<br><a class="sm" href="' + esc(vUrl(cur.KodeVerifikasi)) + '" target="_blank" rel="noopener">Buka halaman verifikasi publik</a>' : '') + '</div></div>' : '') + (ditarik.length ? '<div class="muted sm mt8" style="margin-top:6px">Pernah ditarik: ' + ditarik.map(x => esc(x.Nomor)).join(', ') + '</div>' : '') +
    '<div class="flex wrap mt8" style="margin-top:10px" id="lpLinks">' + lnk(a.LaporanDocUrl, 'Buka draf (.docx)', 'open_in_new') + lnk(a.LaporanPdfUrl, 'Unduh PDF', 'download') + lnk(a.LaporanDocxUrl, 'Unduh Docx', 'download') + '</div><div id="lpMsg" class="muted sm mt8" style="margin-top:8px">' + (a.LaporanTS ? 'Terakhir dibuat ' + fmtDT(a.LaporanTS) : (inReview ? '' : 'Ubah status audit ke Review di menu Jadwal & Penugasan.')) + '</div></div>';
  /* editor isi laporan */
  const ro = roLap(a) && !isR('AUDITOR', 'AUDITEE'), edP = isR('LEAD', 'AUDITOR', 'ADMIN') && a.Status !== 'Disetujui', edL = !roLap(a);
  const pm = j => { const p = pertOf(a.ID, j); return '<div class="card flat" style="background:var(--soft)"><div class="flex between"><b>Pertemuan ' + j.toLowerCase() + '</b>' + (edL ? '<button class="btn sm ghost" data-j="' + j + '" onclick="pertModal(this.dataset.j)"><span class="ms sm">edit</span>Ubah</button>' : '') + '</div><div class="muted sm mt8" style="margin-top:6px">' + (p && p.Tanggal ? fmtD(p.Tanggal) + ' · ' + esc(p.Tempat || '-') : 'Belum diisi') + '</div><div class="muted sm">Peserta tercatat: ' + hd(j) + '</div>' + (edL ? '<button class="btn sm ghost mt8" style="margin-top:6px" data-j="' + j + '" onclick="hadirModal(this.dataset.j)"><span class="ms sm">group_add</span>Daftar hadir</button>' : '') + '</div>'; };
  h += '<div class="grid g2 mt16" style="margin-top:12px"><div class="card"><div class="flex between"><div class="sec-t" style="margin:0">Praktik baik (5.1.1)</div>' + (edP ? '<button class="btn sm primary" onclick="praktikModal()"><span class="ms sm">add</span>Tambah</button>' : '') + '</div><div class="rowlist mt8" style="margin-top:8px">' +
    (pr.length ? pr.map(x => '<div class="card flat" style="background:var(--soft)"><div class="flex between"><span class="chip info">Sub-elemen ' + esc(x.Kode) + '</span>' + (edP ? '<button class="iconbtn" data-id="' + esc(x.ID) + '" onclick="delRow(\'Praktik_Baik\',this.dataset.id)" aria-label="Hapus"><span class="ms sm">delete</span></button>' : '') + '</div><div class="sm mt8" style="margin-top:6px">' + esc(x.Uraian) + '</div></div>').join('') : '<div class="muted sm">Belum ada praktik baik.</div>') + '</div></div>' +
    '<div class="card"><div class="sec-t">Pertemuan & daftar hadir (Lampiran III–IV)</div><div class="rowlist">' + pm('Pembukaan') + pm('Penutupan') + '</div></div></div>' +
    '<div class="card mt16" style="margin-top:12px"><div class="flex between"><div class="sec-t" style="margin:0">Respon perusahaan terhadap pelaksanaan audit (Lampiran VI)</div>' + (isR('LEAD', 'ADMIN', 'AUDITEE') && a.Status !== 'Disetujui' ? '<button class="btn sm primary" onclick="responModal()"><span class="ms sm">add</span>Tambah</button>' : '') + '</div><div class="rowlist mt8" style="margin-top:8px">' +
    (rs.length ? rs.map(x => '<div class="card flat" style="background:var(--soft)"><div class="sm">' + esc(x.Uraian) + '</div><div class="muted sm mt8" style="margin-top:4px">' + esc(x.Oleh) + ' · ' + fmtD(x.TS) + '</div></div>').join('') : '<div class="muted sm">Belum ada respon.</div>') + '</div></div>';
  el.innerHTML = h;
  const run = async (btn, fn) => { const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:16px;height:16px;border-width:2px"></span>Memproses…'; await fn(); btn.innerHTML = old; btn.disabled = false; };
  const upd = d => { Object.assign(a, d); S.dirty = {}; S.dirty.laporan = true; go('laporan'); snapSoon(); };
  if (canGen) $('#lpGen').onclick = function () { run(this, async () => { const r = await api('generateReport', { auditId: a.ID }); if (r.success) { await resync(true); toast('Draf ' + r.data.nomor + ' dibuat.' + ((r.data.peringatan || [])[0] ? ' ' + r.data.peringatan[0] : ''), (r.data.peringatan || []).length ? 'warn' : 'ok', 6000); } else toast(r.message, 'err', 6000); }); };
  if (canTerbit) $('#lpTerbit').onclick = function () { const b = this;
    const ov = openModal(mHead('Terbitkan laporan', 'verified') + '<div class="m-body"><div class="muted sm">Buka draf .docx di Word, perbarui daftar isi (F9), lalu <b>Simpan sebagai PDF</b> dan unggah di sini. Server menghitung hash SHA-256 dari PDF itu dan menyegelnya; dokumen lalu dibekukan. Perubahan sesudahnya hanya lewat <b>Tarik dokumen</b>.</div><div class="field mt8" style="margin-top:12px"><label class="label">PDF final laporan (disarankan)</label><input type="file" id="tbPdf" accept="application/pdf" class="input"></div><div class="muted sm">Tanpa berkas, server mencoba mengonversi sendiri (tampilan bisa berbeda dari Word).</div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn orange" id="tbGo">Terbitkan</button></div>', { sm: true });
    $('#tbGo', ov).onclick = () => { const f = $('#tbPdf', ov).files[0]; closeModal(); run(b, async () => {
      let pdfB64 = ''; if (f) { if (f.size > 20e6) { toast('PDF terlalu besar (maks 20 MB).', 'err'); return; } pdfB64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(f); }); }
      const r = await api('terbitLaporan', { auditId: a.ID, pdfB64 }); if (r.success) { await resync(true); toast('Laporan TERBIT: ' + r.data.nomor, 'ok', 6000); } else toast(r.message, 'err', 6000); }); }; };
  if (canTarik) $('#lpTarik').onclick = function () { dialog('Tarik dokumen terbit', '<div class="field"><label class="label">Alasan penarikan *</label><textarea class="textarea" id="dgIn"></textarea></div>', 'Tarik', 'orange').then(al => { if (al) api('tarikLaporan', { auditId: a.ID, alasan: al }).then(async r => { if (r.success) { await resync(true); toast('Dokumen ditarik. Buat draf baru bila perlu.', 'ok'); } else toast(r.message, 'err', 6000); }); }); };
  if (isR('ADMIN') && $('#lpTpl')) $('#lpTpl').onchange = function () { const f = this.files[0]; if (!f) return; if (f.size > 12e6) { toast('Template terlalu besar (maks 12 MB).', 'err'); return; } const fr = new FileReader(); fr.onload = async () => { const r = await api('uploadTemplate', { b64: String(fr.result).split(',')[1] }); if (r.success) { S.d.params.TEMPLATE_DOCX_ID = r.data.id; toast(r.message + ' ' + r.data.skalar + ' placeholder, ' + r.data.blok + ' blok, ' + r.data.baris + ' baris berulang.' + (r.data.tidakDikenal.length ? ' Tidak dikenal: ' + r.data.tidakDikenal.slice(0, 4).join(', ') : ''), r.data.tidakDikenal.length ? 'warn' : 'ok', 7000); go('laporan'); } else toast(r.message, 'err', 7000); }; fr.readAsDataURL(f); };
  if (canScan) $('#lpScan').onclick = function () { run(this, async () => { const r = await api('deScan', {}); if (!r.success) { toast(r.message, 'err', 6000); return; } const d = r.data;
    const rows = d.ada ? (d.kunci.map(k => '<tr><td><code>{{' + esc(k.kunci) + (k.pengubah.length ? '|' + esc(k.pengubah.join('|')) : '') + '}}</code></td><td>' + (k.dikenal ? '<span class="chip ok">dikenal</span>' : '<span class="chip crit">tidak dikenal</span>') + '</td></tr>').join('') || '<tr><td colspan="2" class="muted">Tidak ada placeholder.</td></tr>') : '';
    openModal(mHead('Pindai template', 'manage_search') + '<div class="m-body">' + (d.ada ? '<div class="muted sm">Template: <b>' + esc(d.nama) + '</b>. ' + esc(r.message) + (d.blokTidakDidukung.length ? ' Sintaks blok belum didukung: ' + esc(d.blokTidakDidukung.join(', ')) + '.' : '') + '</div><table class="tbl mt8" style="margin-top:8px"><tbody>' + rows + '</tbody></table>' : '<div class="muted">' + esc(r.message) + '</div>') +
      '<div class="sec-t mt16" style="margin-top:14px">Placeholder yang tersedia</div><div class="sm">' + d.tersedia.map(k => '<div><code>{{' + esc(k.kunci) + '}}</code> — ' + esc(k.arti) + '</div>').join('') + '</div><div class="muted sm mt8" style="margin-top:8px">Pengubah: |kapital |kecil |judul |ribuan |rupiah |tanggal |bawaan:teks</div></div><div class="m-foot"><button class="btn primary" onclick="closeModal()">Tutup</button></div>', { wide: true }); }); };
  const ex = (id, f, key) => { if (canExp) $(id).onclick = function () { run(this, async () => { const r = await api('exportReport', { auditId: a.ID, format: f }); if (r.success) { const d = {}; d[key] = r.data[key]; upd(d); toast('Berkas ' + f.toUpperCase() + ' siap.', 'ok'); } else toast(r.message, 'err', 6000); }); }; };
  ex('#lpPdf', 'pdf', 'LaporanPdfUrl'); ex('#lpDocx', 'docx', 'LaporanDocxUrl');
}
function delRow(t, id) { const a = curAudit(); save(t, { ID: id, AuditID: a.ID }, true); touch(); toast('Dihapus.', 'ok'); }
function praktikModal() {
  const a = curAudit(); const ov = openModal(mHead('Tambah praktik baik', 'thumb_up') + '<div class="m-body"><div class="field"><label class="label">Sub-elemen</label><select class="select" id="pbK">' + S.d.elemen.map(e => '<optgroup label="' + e.Kode + '. ' + esc(e.Nama) + '">' + S.d.kriteria.filter(k => k.Elemen === e.Kode && k.Aktif && (k.Level === 'sub' || k.Level === 'subsub')).sort((x, y) => x.Urutan - y.Urutan).map(k => '<option value="' + k.Kode + '">' + k.Kode + ' ' + esc(String(k.Nama).slice(0, 70)) + '</option>').join('') + '</optgroup>').join('') + '</select></div><div class="field"><label class="label">Uraian *</label><textarea class="textarea" id="pbU"></textarea></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="pbGo">Simpan</button></div>', { sm: true });
  $('#pbGo', ov).onclick = () => { const u = $('#pbU').value.trim(); if (!u) { toast('Uraian wajib diisi.', 'err'); return; } save('Praktik_Baik', { ID: uid(), AuditID: a.ID, Kode: $('#pbK').value, Uraian: u, Oleh: S.user.email, TS: nowIso() }); closeModal(); touch(); toast('Tersimpan.', 'ok'); };
}
function responModal() {
  const a = curAudit(); const ov = openModal(mHead('Respon perusahaan', 'forum') + '<div class="m-body"><div class="field"><label class="label">Tanggapan terhadap pelaksanaan audit *</label><textarea class="textarea" id="rsU"></textarea></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="rsGo">Simpan</button></div>', { sm: true });
  $('#rsGo', ov).onclick = () => { const u = $('#rsU').value.trim(); if (!u) { toast('Isi tanggapan.', 'err'); return; } save('Respon_Audit', { ID: uid(), AuditID: a.ID, Uraian: u, Oleh: S.user.email, TS: nowIso() }); closeModal(); touch(); toast('Tersimpan.', 'ok'); };
}
function pertModal(j) {
  const a = curAudit(), p = pertOf(a.ID, j) || {};
  const ov = openModal(mHead('Pertemuan ' + j.toLowerCase(), 'event') + '<div class="m-body"><div class="field"><label class="label">Tanggal</label><input class="input" type="date" id="ptT" value="' + esc(p.Tanggal || (j === 'Pembukaan' ? a.TglPembukaan : a.TglPenutupan) || '') + '"></div><div class="field"><label class="label">Tempat</label><input class="input" id="ptP" value="' + esc(p.Tempat || '') + '"></div><div class="field"><label class="label">Catatan</label><textarea class="textarea" id="ptC">' + esc(p.Catatan || '') + '</textarea></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="ptGo">Simpan</button></div>', { sm: true });
  $('#ptGo', ov).onclick = () => { save('Pertemuan', { ID: p.ID || uid(), AuditID: a.ID, Jenis: j, Tanggal: $('#ptT').value, Tempat: $('#ptP').value.trim(), Catatan: $('#ptC').value.trim() }); closeModal(); touch(); toast('Tersimpan.', 'ok'); };
}
function hadirModal(j) {
  const a = curAudit(), list = () => S.d.kehadiran.filter(x => x.AuditID === a.ID && x.Jenis === j);
  const draw = () => { $('#hdL').innerHTML = list().length ? list().map(x => '<div class="flex between" style="padding:6px 0"><span class="sm"><b>' + esc(x.Nama) + '</b> · ' + esc(x.Jabatan || '-') + ' · ' + esc(x.Perusahaan || '-') + '</span><button class="iconbtn" data-id="' + esc(x.ID) + '" aria-label="Hapus"><span class="ms sm">close</span></button></div>').join('') : '<div class="muted sm">Belum ada peserta.</div>';
    $$('#hdL button').forEach(b => b.onclick = () => { save('Kehadiran', { ID: b.dataset.id, AuditID: a.ID }, true); draw(); S.dirty.laporan = true; }); };
  const ov = openModal(mHead('Daftar hadir pertemuan ' + j.toLowerCase(), 'groups') + '<div class="m-body"><div id="hdL"></div><div class="grid g2"><div class="field"><label class="label">Nama</label><input class="input" id="hdN"></div><div class="field"><label class="label">Jabatan</label><input class="input" id="hdJ"></div></div><div class="field"><label class="label">Perusahaan</label><input class="input" id="hdP" value="' + esc(P('NAMA_PERUSAHAAN')) + '"></div><button class="btn primary sm" id="hdAdd"><span class="ms sm">add</span>Tambah peserta</button></div><div class="m-foot"><button class="btn ghost" onclick="closeModal();touch()">Selesai</button></div>', { wide: true });
  $('#hdAdd', ov).onclick = () => { const n = $('#hdN').value.trim(); if (!n) { toast('Nama wajib diisi.', 'err'); return; } save('Kehadiran', { ID: uid(), AuditID: a.ID, Jenis: j, Nama: n, Jabatan: $('#hdJ').value.trim(), Perusahaan: $('#hdP').value.trim() }); $('#hdN').value = ''; $('#hdJ').value = ''; draw(); S.dirty.laporan = true; $('#hdN').focus(); };
  draw();
}

/* ============================== MASTER DATA ============================== */
const PARAM_META = [
  ['AMBANG_MAYOR_SKOR', 'Ambang Mayor — nilai sub-elemen (% dari maksimum)', 1], ['AMBANG_MAYOR_LOKASI', 'Ambang Mayor — temuan minor di satu sub-elemen (% lokasi)', 1], ['TENGGAT_HARI', 'Tenggat tindak lanjut (hari setelah penutupan audit)', 1],
  ['NAMA_PERUSAHAAN', 'Nama perusahaan', 0], ['ALAMAT_PERUSAHAAN', 'Alamat', 0], ['NO_IUJP', 'Nomor IUJP', 0], ['PJO_NAMA', 'Nama PJO (pengesah laporan)', 0], ['KOTA_LAPORAN', 'Kota penandatanganan laporan', 0], ['URL_FRONTEND', 'URL aplikasi di GitHub Pages (untuk tautan verifikasi dokumen)', 0], ['NAMA_SITE', 'Nama site / klien tempat audit (mis. PT Kaltim Prima Coal)', 0], ['ALAMAT_SITE', 'Alamat site office (kosong = sama dengan alamat perusahaan)', 0], ['JUMLAH_PEKERJA', 'Jumlah tenaga kerja di site', 0], ['PERIODE_TINJAUAN', 'Periode tinjauan (mis. 28 Desember 2024 sampai dengan 7 Desember 2025)', 0], ['PENGESAH_INTERNAL', 'Diketahui oleh — internal (satu baris per orang: Nama | Jabatan)', 0, 'ta'], ['PENGESAH_EKSTERNAL', 'Diketahui oleh — pihak klien (satu baris per orang: Nama | Jabatan)', 0, 'ta'], ['DISTRIBUSI', 'Distribusi laporan (satu baris per penerima)', 0, 'ta'], ['TEMPLATE_DOC_ID', 'ID Google Docs template (cadangan; template .docx diunggah di menu Laporan)', 0]
];
function rMaster() {
  const el = $('#page-master'), f = S.filters.m, adm = isR('ADMIN');
  const T = [['kriteria', 'Kriteria', S.d.kriteria.length], ['elemen', 'Elemen & bobot', S.d.elemen.length], ['param', 'Parameter', PARAM_META.length]]; if (adm) { T.push(['brand', 'Logo & identitas', '']); T.push(['impor', 'Impor data', '']); }
  if (!T.some(x => x[0] === f.tab)) f.tab = 'kriteria';
  let h = '<div class="ph"><div><div class="crumb">Kepdirjen 185.K/37.04/DJB/2019 · Lampiran I</div><h1>Master Data SMKP</h1><p>Kriteria, bobot elemen, dan parameter aturan kategori temuan.</p></div></div><div class="tabs">' + T.map(x => '<button class="tab' + (f.tab === x[0] ? ' on' : '') + '" data-t="' + x[0] + '" onclick="masterTab(this.dataset.t)">' + x[1] + (x[2] !== '' ? '<span class="cnt">' + x[2] + '</span>' : '') + '</button>').join('') + '</div><div id="mBody" class="mt16" style="margin-top:12px"></div>';
  el.innerHTML = h; paintMaster();
}
function masterTab(t) { S.filters.m.tab = t; S.dirty.master = true; rMaster(); }
function paintMaster() {
  const f = S.filters.m, b = $('#mBody'), adm = isR('ADMIN');
  if (f.tab === 'elemen') {
    const tot = S.d.elemen.reduce((s, e) => s + Number(e.Bobot), 0);
    b.innerHTML = '<div class="card table-wrap"><table class="t"><thead><tr><th>Kode</th><th>Elemen</th><th>Bobot</th><th>Butir dinilai</th><th>Nilai maks.</th></tr></thead><tbody>' + S.d.elemen.map(e => { const ks = unitKr().filter(k => k.Elemen === e.Kode && !k.NA); return '<tr><td class="b">' + esc(e.Kode) + '</td><td>' + esc(e.Nama) + '</td><td class="num">' + f0(e.Bobot * 100) + '%</td><td class="num">' + ks.length + '</td><td class="num">' + ks.reduce((s, k) => s + k.NilaiMaks, 0) + '</td></tr>'; }).join('') + '</tbody><tfoot><tr><td></td><td class="b">Total bobot</td><td class="b num">' + f0(tot * 100) + '%</td><td></td><td></td></tr></tfoot></table></div><div class="muted sm mt8" style="margin-top:8px">Bobot elemen mengikuti Kepdirjen dan dikunci (hanya baca).</div>'; return;
  }
  if (f.tab === 'param') {
    b.innerHTML = '<div class="card"><div class="rowlist">' + PARAM_META.map(m => '<div class="field"><label class="label">' + esc(m[1]) + (m[2] ? ' <span class="chip maj" style="margin-left:6px"><span class="ms sm">lock</span>Regulasi</span>' : '') + '</label><div class="flex">' + (m[3] === 'ta' ? '<textarea class="textarea" rows="3" data-k="' + m[0] + '"' + (adm ? '' : ' disabled') + '>' + esc(P(m[0])) + '</textarea>' : '<input class="input" data-k="' + m[0] + '" value="' + esc(P(m[0])) + '"' + (adm ? '' : ' disabled') + '>') + (adm ? '<button class="btn sm primary" data-k="' + m[0] + '" data-l="' + m[2] + '" onclick="saveParam(this)">Simpan</button>' : '') + '</div></div>').join('') + '</div></div>'; return;
  }
  if (f.tab === 'brand' && adm) { paintBrand(b); return; }
  if (f.tab === 'impor' && adm) { paintImpor(b); return; }
  b.innerHTML = '<div class="card"><div class="filters"><div class="searchbox"><span class="ms">search</span><input class="input" id="mQ" placeholder="Cari kode atau uraian kriteria…" value="' + esc(f.q) + '" oninput="mFilter()" aria-label="Cari kriteria"></div><select class="select" id="mE" onchange="mFilter()" aria-label="Elemen"><option value="">Semua elemen</option>' + S.d.elemen.map(e => '<option value="' + e.Kode + '"' + (f.el === e.Kode ? ' selected' : '') + '>' + e.Kode + '. ' + esc(e.Nama) + '</option>').join('') + '</select></div></div><div id="mList" class="mt16" style="margin-top:12px"></div>';
  paintKriteria();
}
const mFilter = debounce(() => { S.filters.m.q = $('#mQ').value; S.filters.m.el = $('#mE').value; paintKriteria(); }, 120);
function paintKriteria() {
  const f = S.filters.m, q = lc(f.q), adm = isR('ADMIN'); if (!$('#mList')) return;
  const ls_ = S.d.kriteria.filter(k => (!f.el || k.Elemen === f.el) && (!q || (k.Kode + ' ' + k.Nama).toLowerCase().indexOf(q) > -1)).sort((a, b) => a.Urutan - b.Urutan).slice(0, 250);
  $('#mList').innerHTML = '<div class="card table-wrap"><table class="t"><thead><tr><th>Kode</th><th>Kriteria</th><th>Maks.</th><th>Rubrik 0–4</th><th></th></tr></thead><tbody>' + ls_.map(k => '<tr><td class="b" style="color:var(--blue);white-space:nowrap">' + esc(k.Kode) + '</td><td style="max-width:420px"><div class="' + (k.Unit ? '' : 'b') + '">' + esc(k.Nama) + '</div>' + (k.NA ? '<span class="chip mute">N/A</span>' : '') + '</td><td class="num">' + (k.Unit && !k.NA ? k.NilaiMaks : '–') + '</td><td>' + (k.Rubrik ? '<span class="chip ok">Terisi</span>' : '<span class="muted sm">Belum</span>') + '</td><td>' + (adm && k.Unit ? '<button class="iconbtn" data-k="' + esc(k.Kode) + '" onclick="kriModal(this.dataset.k)" aria-label="Ubah"><span class="ms sm">edit</span></button>' : '') + '</td></tr>').join('') + '</tbody></table></div><div class="muted sm mt8" style="margin-top:8px">' + ls_.length + ' baris' + (ls_.length === 250 ? ' (dibatasi 250; persempit pencarian)' : '') + '</div>';
}
function kriModal(kode) {
  const k = krMap()[kode], rub = String(k.Rubrik || '');
  const ov = openModal(mHead('Ubah kriteria ' + kode, 'edit_note') + '<div class="m-body"><div class="field"><label class="label">Uraian kriteria</label><textarea class="textarea" id="krN">' + esc(k.Nama) + '</textarea></div><div class="grid g2"><div class="field"><label class="label">Nilai maksimum</label><input class="input" type="number" min="0" step="any" id="krM" value="' + esc(k.NilaiMaks) + '"></div><div class="field"><label class="label">Referensi pasal</label><input class="input" id="krR" value="' + esc(k.Referensi || '') + '"></div></div><div class="field"><label class="label">Rubrik nilai (format: 0=uraian|1=uraian|…)</label><textarea class="textarea" id="krB" placeholder="0=Belum ada…|1=…">' + esc(rub) + '</textarea></div><div class="banner info"><span class="ms">info</span><div>Rubrik 0–4 belum diisi dari Kepdirjen; isi dari dokumen resmi agar muncul di checklist.</div></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Batal</button><button class="btn primary" id="krGo">Simpan</button></div>', { wide: true });
  $('#krGo', ov).onclick = () => { const m = Number($('#krM').value); if (isNaN(m) || m < 0) { toast('Nilai maksimum tidak valid.', 'err'); return; } save('M_Kriteria', { Kode: kode, Nama: $('#krN').value.trim(), NilaiMaks: m, Referensi: $('#krR').value.trim(), Rubrik: $('#krB').value.trim() }); closeModal(); touch(); toast('Kriteria disimpan.', 'ok'); };
}
async function saveParam(btn) {
  const k = btn.dataset.k, inp = $('[data-k="' + k + '"]:not(button)'), v = inp.value.trim(); let konf = false;
  if (btn.dataset.l === '1') { const c = await confirmBox('Ubah parameter regulasi?', 'Parameter ini bersumber dari Kepdirjen 185.K/37.04/DJB/2019. Perubahan memengaruhi usulan kategori dan tenggat seluruh audit, dan tercatat di log.', 'Ya, ubah', 'orange'); if (!c) { inp.value = P(k); return; } konf = true; }
  const r = await api('saveParam', { Kunci: k, Nilai: v, konfirmasi: konf });
  if (r.success) { S.d.params[k] = v; if (/^(NAMA_HEADER|NAMA_PERUSAHAAN|TEKS_HEADER|TAG_HEADER|SUB_LOGIN)$/.test(k)) brandFromParams(); toast('Parameter disimpan.', 'ok'); snapSoon(); S.dirty = {}; S.dirty.master = false; } else toast(r.message, 'err', 5000);
}
/* ---- Impor (gas-migrasi-database) ---- */
const IMP_SHEETS = ['Users', 'Audit', 'Penugasan', 'Penilaian', 'Temuan', 'Tindak_Lanjut', 'Praktik_Baik', 'Pertemuan', 'Kehadiran', 'Respon_Audit'];
function paintImpor(b) {
  b.innerHTML = '<div class="card"><div class="sec-t">Impor data dari app lama</div><div class="banner info"><span class="ms">info</span><div>Spreadsheet sumber hanya dibaca. Impor aman diulang (tanpa baris ganda) dan dapat dijalankan lagi sebelum cutover untuk menangkap data baru. Gunakan akun Google yang sama agar ID file Drive tetap valid.</div></div>' +
    '<div class="field mt8" style="margin-top:10px"><label class="label">URL atau ID spreadsheet app lama</label><input class="input" id="imSrc" placeholder="https://docs.google.com/spreadsheets/d/…"></div><div class="field"><label class="label">Sheet yang diimpor</label><div class="flex wrap">' + IMP_SHEETS.map(s => '<label class="flex" style="gap:6px;min-height:36px"><input type="checkbox" class="imCk" value="' + s + '" checked> ' + s + '</label>').join('') + '</div></div>' +
    '<label class="flex" style="gap:6px;min-height:36px"><input type="checkbox" id="imOv" checked> Perbarui data yang sudah ada bila diizinkan aturan (keputusan di app ini tidak ditimpa)</label>' +
    '<div class="flex wrap mt8" style="margin-top:10px"><button class="btn ghost" id="imScan"><span class="ms">manage_search</span>Pindai (dry-run)</button><button class="btn primary" id="imRun"><span class="ms">move_down</span>Jalankan impor</button></div><div id="imOut" class="mt16" style="margin-top:14px"></div></div>' +
    '<div class="card mt16" style="margin-top:12px"><div class="sec-t">Data audit 2025</div><div class="muted sm">Memuat nilai formulir TW 2025 (total harus 61,0%) sebagai data uji. Aman diulang.</div><button class="btn ghost mt8" style="margin-top:8px" id="imSeed"><span class="ms">database</span>Muat data 2025</button></div>';
  const pay = () => ({ source: $('#imSrc').value.trim(), sheets: $$('.imCk').filter(c => c.checked).map(c => c.value), overwrite: $('#imOv').checked });
  const show = r => {
    if (!r.success) { $('#imOut').innerHTML = '<div class="banner crit"><span class="ms">error</span><div>' + esc(r.message) + '</div></div>'; return; }
    const d = r.data, rep = d.report || {};
    $('#imOut').innerHTML = '<div class="b">' + (d.dryRun ? 'Hasil pindai (belum menulis apa pun)' : 'Impor selesai') + ' — ' + esc((d.source && d.source.name) || '') + '</div><div class="card table-wrap mt8" style="margin-top:8px"><table class="t"><thead><tr><th>Data</th><th>Di sumber</th><th>Ditambah</th><th>Diperbarui</th><th>Dilewati</th></tr></thead><tbody>' + Object.keys(rep).map(k => '<tr><td class="b">' + esc(k) + (rep[k].note ? ' <span class="muted sm">(' + esc(rep[k].note) + ')</span>' : '') + '</td><td class="num">' + rep[k].source + '</td><td class="num">' + rep[k].inserted + '</td><td class="num">' + rep[k].updated + '</td><td class="num">' + rep[k].skipped + '</td></tr>').join('') + '</tbody></table></div>' +
      ((d.warnings || []).length ? '<div class="banner mt8" style="margin-top:8px"><span class="ms">warning</span><div><b>Peringatan</b>' + d.warnings.map(w => '<span class="sm">' + esc(w) + '</span>').join('') + '</div></div>' : '');
  };
  const busy = (btn, fn) => async () => { const o = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:16px;height:16px;border-width:2px"></span>Memproses…'; try { await fn(); } finally { btn.innerHTML = o; btn.disabled = false; } };
  $('#imScan').onclick = busy($('#imScan'), async () => { const p = pay(); if (!p.source) { toast('Isi URL/ID spreadsheet sumber.', 'err'); return; } show(await api('importScan', p)); });
  $('#imRun').onclick = busy($('#imRun'), async () => { const p = pay(); if (!p.source) { toast('Isi URL/ID spreadsheet sumber.', 'err'); return; } const c = await confirmBox('Jalankan impor?', 'Data dari spreadsheet sumber akan ditambahkan ke app ini. Sebaiknya Pindai dahulu.', 'Jalankan', 'primary'); if (!c) return; const r = await api('importRun', p); show(r); if (r.success) { await resync(true); toast('Impor selesai.', 'ok'); } });
  $('#imSeed').onclick = busy($('#imSeed'), async () => { const c = await confirmBox('Muat data audit 2025?', 'Audit TW 2025 akan dibuat/diperbarui dari formulir Excel.', 'Muat', 'primary'); if (!c) return; const r = await api('seed2025'); if (r.success) { await resync(true); toast('Data 2025 dimuat.', 'ok'); } else toast(r.message, 'err', 5000); });
}

/* ============================== PENGGUNA ============================== */
function rUsers() {
  const el = $('#page-users'), q = lc(S.filters.u.q);
  const list = S.d.users.filter(u => !q || (u.Email + ' ' + u.Nama + ' ' + u.Departemen).toLowerCase().indexOf(q) > -1);
  el.innerHTML = '<div class="ph"><div><div class="crumb">Administrasi</div><h1>Manajemen Pengguna</h1><p>Akun, peran, dan departemen auditee. Kata sandi sementara dibuat otomatis.</p></div><div class="actions"><button class="btn primary" onclick="userModal()"><span class="ms">person_add</span>Tambah pengguna</button></div></div>' +
    '<div class="card"><div class="filters"><div class="searchbox"><span class="ms">search</span><input class="input" id="uQ" placeholder="Cari nama, email, departemen…" value="' + esc(S.filters.u.q) + '" oninput="uFilter()" aria-label="Cari pengguna"></div></div></div><div id="uList" class="mt16" style="margin-top:12px"></div>';
  paintUsers();
}
const uFilter = debounce(() => { S.filters.u.q = $('#uQ').value; paintUsers(); }, 120);
function paintUsers() {
  const q = lc(S.filters.u.q), list = S.d.users.filter(u => !q || (u.Email + ' ' + u.Nama + ' ' + u.Departemen).toLowerCase().indexOf(q) > -1); if (!$('#uList')) return;
  $('#uList').innerHTML = '<div class="card table-wrap"><table class="t"><thead><tr><th>Pengguna</th><th>Peran</th><th>Departemen</th><th>Status</th><th></th></tr></thead><tbody>' + list.map(u => '<tr><td><div class="b">' + esc(u.Nama) + '</div><div class="muted sm">' + esc(u.Email) + '</div></td><td>' + esc(ROLE_LABEL[u.Role] || u.Role) + '</td><td>' + esc(u.Departemen || '-') + '</td><td>' + (u.Aktif ? '<span class="chip ok">Aktif</span>' : '<span class="chip mute">Nonaktif</span>') + '</td><td style="white-space:nowrap"><button class="iconbtn" data-e="' + esc(u.Email) + '" onclick="userModal(this.dataset.e)" aria-label="Ubah"><span class="ms sm">edit</span></button><button class="iconbtn" data-e="' + esc(u.Email) + '" onclick="resetPw(this.dataset.e)" aria-label="Reset sandi" title="Reset kata sandi"><span class="ms sm">lock_reset</span></button></td></tr>').join('') + '</tbody></table></div>';
}
function tmpPwBox(email, pw) { return '<div class="banner"><span class="ms">key</span><div><b>Kata sandi sementara untuk ' + esc(email) + '</b><span class="b" style="font:700 20px var(--f-head);letter-spacing:.04em;user-select:all">' + esc(pw) + '</span><span class="sm">Salin dan berikan kepada pengguna. Hanya tampil sekali; pengguna wajib menggantinya saat masuk.</span></div></div>'; }
function userModal(email) {
  const u = email ? S.d.users.find(x => lc(x.Email) === lc(email)) : { Aktif: 1, Role: 'AUDITOR' };
  const ov = openModal(mHead(email ? 'Ubah pengguna' : 'Tambah pengguna', 'person') + '<div class="m-body"><div class="field"><label class="label">Email (akun masuk) *</label><input class="input" id="usE" type="email" value="' + esc(u.Email || '') + '"' + (email ? ' disabled' : '') + '></div><div class="field"><label class="label">Nama lengkap *</label><input class="input" id="usN" value="' + esc(u.Nama || '') + '"></div><div class="grid g2"><div class="field"><label class="label">Peran</label><select class="select" id="usR">' + Object.keys(ROLE_LABEL).map(r => '<option value="' + r + '"' + (u.Role === r ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>').join('') + '</select></div><div class="field"><label class="label">Departemen (untuk Auditee; beberapa seksi dipisah titik koma)</label><input class="input" id="usD" placeholder="Contoh: HSE; Civil Work" list="dlDept3" value="' + esc(u.Departemen || '') + '"><datalist id="dlDept3">' + deptOptions().map(d => '<option value="' + esc(d) + '">').join('') + '</datalist></div></div><div class="field"><label class="label">No. register auditor (tampil di laporan)</label><input class="input" id="usReg" value="' + esc(u.NoReg || '') + '"></div><label class="flex" style="gap:6px;min-height:36px"><input type="checkbox" id="usA"' + (u.Aktif ? ' checked' : '') + '> Akun aktif</label><div id="usOut"></div></div><div class="m-foot"><button class="btn ghost" onclick="closeModal()">Tutup</button><button class="btn primary" id="usGo">Simpan</button></div>', { wide: true });
  $('#usGo', ov).onclick = async function () {
    const b = this; b.disabled = true;
    const r = await api('saveUser', { Email: $('#usE').value.trim(), Nama: $('#usN').value.trim(), Role: $('#usR').value, Departemen: $('#usD').value.trim(), NoReg: $('#usReg').value.trim(), Aktif: $('#usA').checked ? 1 : 0 });
    b.disabled = false; if (!r.success) { toast(r.message, 'err', 5000); return; }
    await resync(true); toast(r.message, 'ok');
    if (r.data && r.data.passwordSementara) { $('#usOut').innerHTML = tmpPwBox(r.data.email, r.data.passwordSementara); b.hidden = true; } else closeModal();
  };
}
async function resetPw(email) {
  const c = await confirmBox('Reset kata sandi?', 'Kata sandi sementara baru dibuat untuk ' + esc(email) + '. Kata sandi lama tidak berlaku lagi.', 'Reset', 'orange'); if (!c) return;
  const r = await api('resetPassword', { email }); if (!r.success) { toast(r.message, 'err', 5000); return; }
  openModal(mHead('Kata sandi sementara', 'key') + '<div class="m-body">' + tmpPwBox(email, r.data.passwordSementara) + '</div><div class="m-foot"><button class="btn primary" onclick="closeModal()">Selesai</button></div>', { sm: true });
}

/* ============================== EVENT & BOOT ============================== */
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('iasmkp_theme', t); } catch (e) { } const b = $('#btnTheme .ms'); if (b) b.textContent = t === 'dark' ? 'light_mode' : 'dark_mode'; }
function wire() {
  $('#nav').addEventListener('click', e => { const a = e.target.closest('a[data-pg]'); if (a) go(a.dataset.pg); });
  $('#nav').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.pg) { e.preventDefault(); go(e.target.dataset.pg); } });
  $('#loginForm').addEventListener('submit', doLogin);
  $('#btnMenu').onclick = openNav; $('#scrim').onclick = closeNav;
  $('#btnLogout').onclick = logout; $('#btnPw').onclick = () => pwModal(false);
  $('#btnTheme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  $('#auditSel').onchange = function () { if (this.value && auditById(this.value)) pickAudit(this.value); };
  $('#btnQuickNC').onclick = () => temuanModal();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.d) { _lastAct = Date.now(); pollVer(); } });
  window.addEventListener('online', () => { if (S.token && S.d) pollVer(); });
}
(function boot() {
  let th = 'light'; try { th = localStorage.getItem('iasmkp_theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { }
  const start = () => {
    wire(); setTheme(th); initPwa(); warmUp(); applyBrand(ls.get('iasmkp_brand')); fetchBrand();
    if (publicRoute()) return;
    S.token = TOK.get(); Q.items = ls.get('iasmkp_q') || []; loadPendingUploads();
    const snap = ls.get('iasmkp_snap');
    if (S.token && snap && snap.d && snap.user) {      // render instan dari cache lokal, lalu segarkan di latar belakang
      S.d = snap.d; S.user = snap.user; S.nilai = snap.nilai || {}; S.audit = snap.audit; S.dv = snap.dv || null; if (!S.d.dokumen) S.d.dokumen = []; Q.items.forEach(it => { try { applyLocal(it.t, it.r, it.del); } catch (e) { } });
      S.page = ss.get('iasmkp_pg') || 'dashboard'; paintUser(); showApp(); renderAll(); setSync(Q.items.length ? 'pending' : 'ok');
      resync(true).then(() => { if (Q.items.length) flush(); pollVer(); }); return;  // selalu ambil data segar sekali per pembukaan (salinan lokal bisa usang)
    }
    if (S.token) { loadData(false).then(ok => { if (!ok && !S.d) showLogin(); }); return; }
    showLogin(); if (!GAS_OK()) { const e = $('#lgErr'); e.textContent = 'GAS_URL belum diisi di js/config.js — lihat PANDUAN.'; e.hidden = false; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* ===================== PWA, pemanasan, verifikasi publik ===================== */
function warmUp() { if (GAS_OK()) { try { fetch(GAS_URL + '?action=ping', { cache: 'no-store' }).catch(() => { }); } catch (e) { } } }
let _installEv = null;
function initPwa() {
  const bo = $('#btnOffline'); if (bo) bo.onclick = prepOffline;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
  const btn = $('#btnInstall'), standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _installEv = e; if (btn) btn.hidden = false; });
  window.addEventListener('appinstalled', () => { if (btn) btn.hidden = true; toast('Aplikasi terpasang di layar utama.', 'ok'); });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  if (btn) {
    if (ios) btn.hidden = false;
    btn.onclick = async () => {
      if (_installEv) { _installEv.prompt(); await _installEv.userChoice.catch(() => { }); _installEv = null; btn.hidden = true; }
      else openModal(mHead('Pasang di HP', 'install_mobile') + '<div class="m-body"><p>Di iPhone/iPad (Safari): ketuk <b>Bagikan</b> lalu <b>Tambah ke Layar Utama</b>.</p><p class="muted sm">Di Android (Chrome): menu ⋮ → <b>Instal aplikasi</b>.</p></div><div class="m-foot"><button class="btn primary" onclick="closeModal()">Mengerti</button></div>', { sm: true });
    };
  }
}
/** Rute publik #/verifikasi/KODE — tanpa login. */
function publicRoute() {
  const m = String(location.hash || '').match(/^#\/verifikasi\/?([A-Za-z0-9-]*)/); if (!m) return false;
  $('#boot').hidden = true; $('#app').hidden = true; $('#view-login').hidden = true; $('#view-verif').hidden = false;
  const inp = $('#vfKode'), out = $('#vfOut'); inp.value = m[1] || '';
  const go = async () => {
    const kode = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (kode.length !== 20) { out.innerHTML = '<div class="banner warn"><span class="ms">info</span><div>Kode verifikasi terdiri dari 20 karakter.</div></div>'; return; }
    out.innerHTML = '<div class="muted"><span class="spin" style="width:16px;height:16px;border-width:2px"></span> Memeriksa…</div>';
    let r; try { r = await (await fetch(GAS_URL + '?action=verifikasi&kode=' + encodeURIComponent(kode))).json(); } catch (e) { out.innerHTML = '<div class="banner crit"><span class="ms">error</span><div>Tidak dapat terhubung ke server verifikasi.</div></div>'; return; }
    if (!r.success) { out.innerHTML = '<div class="banner crit"><span class="ms">cancel</span><div><b>Tidak valid.</b> ' + esc(r.message) + '</div></div>'; return; }
    const d = r.data, okk = d.valid;
    out.innerHTML = '<div class="banner ' + (okk ? 'ok' : 'crit') + '"><span class="ms">' + (okk ? 'verified' : 'gpp_bad') + '</span><div><strong>' + (okk ? 'DOKUMEN ASLI — TERBIT' : 'TIDAK VALID — ' + esc(d.status)) + '</strong>' + (d.catatan ? '<br>' + esc(d.catatan) : '') + '</div></div>' +
      '<div class="card mt8" style="margin-top:10px"><div class="rowlist"><div><span class="muted sm">Dokumen</span><br><b>' + esc(d.judul) + '</b></div><div><span class="muted sm">Nomor</span><br><b>' + esc(d.nomor) + '</b></div><div><span class="muted sm">Perusahaan</span><br><b>' + esc(d.perusahaan) + '</b></div><div><span class="muted sm">Diterbitkan</span><br><b>' + fmtDT(d.terbit) + '</b></div><div><span class="muted sm">SHA-256 berkas PDF</span><br><code style="word-break:break-all;font-size:12px">' + esc(d.hash) + '</code></div></div></div>';
  };
  $('#vfGo').onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); }; if (inp.value) go();
  window.addEventListener('hashchange', () => location.reload(), { once: true });
  return true;
}
