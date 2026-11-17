/* FORM CLUB V9 - member QR, staff QR scanner, notification centre, trainer performance, PWA install.
   Talks to /api/me, /api/state and the V9 endpoints in v9-core.js. V7/V8 screens are linked, not changed. */
(() => {
'use strict';
const K = window.V9Core;
const root = document.getElementById('v9-root');

/* ---------- Small helpers ---------- */
const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const int = v => Math.round(Number(v || 0)).toLocaleString('tr-TR');
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('v9:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('v9:' + k, v); } catch {} }
};
const ICONS = {
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  chart: '<path d="M3 3v18h18M8 17V10M13 17V6M18 17v-4"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const NOTE_ICON = { expiry: 'clock', class: 'calendar', payment: 'card', other: 'bell' };

let toastTimer = 0;
function toast(message, bad = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

async function api(path, options = {}) {
  const base = String(globalThis.FORMCLUB_CONFIG?.apiBase || '').replace(/\/+$/, '');
  const init = { credentials: base ? 'include' : 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, ...options };
  if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  let response;
  try { response = await fetch(base + path, init); }
  catch { throw Object.assign(Error(navigator.onLine === false ? 'Çevrimdışısın. Bağlantı gelince tekrar dene.' : 'Sunucuya bağlanılamadı.'), { status: 0, offline: true }); }
  let json; try { json = await response.json(); } catch { throw Object.assign(Error(`API yanıtı okunamadı (${response.status})`), { status: response.status }); }
  if (!response.ok) throw Object.assign(Error(json?.error || `Sunucu hatası (${response.status})`), { status: response.status });
  return json;
}
const missingApiText = 'Bu özellik sunucuda henüz etkin değil. Backend güncellemesi yayımlandığında otomatik çalışır.';

/* ---------- State ---------- */
const S = {
  user: null, role: '', state: null, view: '',
  online: navigator.onLine !== false,
  notes: [], notesLoaded: false, notesError: '', notesMissing: false, noteFilter: 'all',
  qr: { token: '', expiresAt: 0, ttl: 60, loading: false, error: '', status: 0, missing: false },
  qrBig: false,
  scan: { active: false, busy: false, starting: false, permission: '', result: null, history: [], last: '', lastAt: 0, engine: '', error: '', errorHelp: '' },
  report: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, trainerId: null, data: null, trend: [], loading: false, error: '', missing: false },
  install: { prompt: null, installed: false },
  sw: { waiting: null }
};
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const staff = () => S.role === 'admin' || S.role === 'teacher';

function pages() {
  const list = [];
  if (S.role === 'member') list.push(['qr', 'QR kodum', 'qr']);
  if (S.role === 'admin') list.push(['scan', 'QR okut', 'scan']);
  if (staff()) list.push(['performance', 'Performans', 'chart']);
  list.push(['notifications', 'Bildirimler', 'bell']);
  list.push(['more', 'Diğer', 'more']);
  return list;
}
const TITLES = {
  qr: ['ÜYE GİRİŞİ', 'QR giriş kodun'],
  scan: ['RESEPSİYON', 'QR okut'],
  performance: ['EĞİTMEN', 'Performans'],
  notifications: ['BİLDİRİM MERKEZİ', 'Bildirimler'],
  more: ['UYGULAMA', 'Diğer']
};

/* ---------- Boot ---------- */
async function init() {
  try {
    const me = await api('/api/me');
    if (!me?.user?.role) return renderLoggedOut();
    S.user = me.user; S.role = me.user.role;
    try { S.state = await api('/api/state'); } catch { S.state = null; }
    if (S.role === 'admin') S.report.trainerId = trainers()[0]?.id ?? null;
    if (S.role === 'teacher') S.report.trainerId = S.user.trainer_id ?? null;
    go(location.hash.slice(1), true);
    loadNotifications();
    startNotePolling();
  } catch (e) {
    renderFatal(e.offline ? 'Çevrimdışısın. İnternet bağlantısı gelince sayfa otomatik yenilenir.' : e.message);
  }
}
const trainers = () => Array.isArray(S.state?.trainers) ? S.state.trainers : [];
function renderLoggedOut() {
  root.innerHTML = `<main class="main"><div class="brand">FORM <strong>CLUB</strong></div><section class="card" style="margin-top:24px"><h2>Giriş gerekli</h2><p class="muted">Bu ekranı kullanmak için önce FORM CLUB hesabınla giriş yap.</p><a class="btn primary block" href="/" target="_top">Giriş yap</a></section></main>`;
}
function renderFatal(message) {
  root.innerHTML = `<main class="main"><div class="brand">FORM <strong>CLUB</strong></div><div class="notice bad" style="margin-top:24px" role="alert"><div class="grow"><b>Ekran açılamadı</b><br>${esc(message)}</div></div><button class="btn" id="retry-boot">${icon('refresh')} Tekrar dene</button></main>`;
}

/* ---------- Routing / render ---------- */
function go(view, replace = false) {
  const links = pages();
  if (!links.some(p => p[0] === view)) view = links[0][0];
  const prev = S.view;
  if (prev === 'scan' && view !== 'scan') stopCamera();
  if (prev === 'qr' && view !== 'qr') stopQR();
  S.view = view;
  const hash = '#' + view;
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  render();
  if (view === 'qr') startQR();
  if (view === 'scan') checkCameraPermission();
  if (view === 'performance' && !S.report.data && !S.report.loading) loadReport();
  if (view === 'notifications') loadNotifications();
  window.scrollTo(0, 0);
}
function navItems(cls) {
  const unread = K.unreadCount(S.notes);
  return pages().map(([id, name, ic]) => `<a href="#${id}" class="${cls}" data-go="${id}" ${S.view === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(name)}</span>${id === 'notifications' && unread ? `<span class="badge" aria-label="${unread} okunmamış">${unread > 99 ? '99+' : unread}</span>` : ''}</a>`).join('');
}
function render() {
  const [eyebrow, title] = TITLES[S.view];
  const unread = K.unreadCount(S.notes);
  const canInstall = !isStandalone() && !S.install.installed && (S.install.prompt || isIOS());
  root.innerHTML = `<div class="shell">
  <aside class="side" aria-label="Menü"><div class="brand">FORM <strong>CLUB</strong></div><nav>${navItems('navlink')}</nav>
    <div class="side-bottom"><a href="/v8.html">Beslenme</a><a href="/v7.html">Stüdyo paneli</a><a href="/">Ana uygulama</a><span class="footnote" style="padding:8px 12px">${esc(S.user.username || '')} · ${esc(roleName())}</span></div></aside>
  <header class="topbar"><div class="brand">FORM <strong>CLUB</strong></div><span class="spacer"></span>
    ${S.online ? '' : `<span class="pill" style="background:var(--warn-bg);color:var(--warn)"><span class="offline-dot"></span>Çevrimdışı</span>`}
    ${canInstall ? `<button class="iconbtn" id="install-top" aria-label="Uygulamayı yükle">${icon('download')}<span class="mobile-hide">Yükle</span></button>` : ''}
    <a class="iconbtn" href="#notifications" data-go="notifications" aria-label="Bildirimler${unread ? `, ${unread} okunmamış` : ''}">${icon('bell')}${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</a>
  </header>
  <main class="main" id="main">
    ${S.sw.waiting ? `<div class="banner" role="status"><div class="grow"><b>Yeni sürüm hazır</b>Güncellemek için yenile.</div><button class="btn small primary" id="sw-update">Yenile</button></div>` : ''}
    ${installBanner()}
    <header class="head"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><div class="subtitle">${esc(new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div></header>
    ${body()}
  </main>
  <nav class="tabbar" aria-label="Sekmeler">${navItems('tab')}</nav>
</div>`;
  afterRender();
}
function roleName() { return { admin: 'Yönetici', teacher: 'Eğitmen', member: 'Üye' }[S.role] || S.role; }
function body() {
  if (S.view === 'qr') return qrView();
  if (S.view === 'scan') return scanView();
  if (S.view === 'performance') return perfView();
  if (S.view === 'notifications') return notesView();
  return moreView();
}
function afterRender() {
  if (S.view === 'qr') paintQR();
  if (S.view === 'performance') bindCharts();
  if (S.view === 'scan' && S.scan.active) attachStream();
}

/* ---------- Install experience ---------- */
function installBanner() {
  if (isStandalone() || S.install.installed || store.get('install-dismissed') === '1' || S.view === 'more') return '';
  if (S.install.prompt) return `<div class="banner"><img class="icon" src="/v9/icons/icon-192.png" alt=""><div class="grow"><b>FORM CLUB'ı yükle</b>Ana ekrandan tek dokunuşla aç, QR kodun hep elinin altında olsun.</div><button class="btn small primary" id="install-banner">Yükle</button><button class="x" id="install-dismiss" aria-label="Kapat">×</button></div>`;
  if (isIOS()) return `<div class="banner"><img class="icon" src="/v9/icons/icon-192.png" alt=""><div class="grow"><b>Ana ekrana ekle</b>Safari'de ${icon('share').replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-2px"')} Paylaş, sonra “Ana Ekrana Ekle”.</div><button class="x" id="install-dismiss" aria-label="Kapat">×</button></div>`;
  return '';
}
async function promptInstall() {
  const p = S.install.prompt;
  if (!p) { if (isIOS()) go('more'); return; }
  S.install.prompt = null;
  p.prompt();
  try { const choice = await p.userChoice; if (choice?.outcome === 'accepted') toast('Uygulama yükleniyor…'); } catch {}
  render();
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.install.prompt = e; if (S.user) render(); });
window.addEventListener('appinstalled', () => { S.install.installed = true; S.install.prompt = null; toast('FORM CLUB ana ekrana eklendi.'); if (S.user) render(); });

/* ---------- Member QR ---------- */
let qrTimer = 0, tickTimer = 0, wakeLock = null;
function qrView() {
  const q = S.qr;
  if (q.missing) return `<div class="notice info">${esc(missingApiText)}</div>`;
  if (!q.token && !S.online) return `<div class="notice warn qr-state" role="alert">${icon('alert')}<div class="grow"><b>Bağlantı yok</b><br>QR kodu sunucudan alınır. İnternet bağlantısı gelince kod otomatik hazırlanır.</div></div><button class="btn block" data-qr-refresh disabled>${icon('refresh')} Bağlantı bekleniyor…</button>`;
  if (q.error && !q.token) {
    const login = q.status === 401;
    return `<div class="notice bad qr-state" role="alert">${icon('alert')}<div class="grow"><b>${login ? 'Oturum kapandı' : q.status === 403 ? 'QR kodu oluşturulamadı' : q.status === 429 ? 'Çok fazla deneme' : 'Kod alınamadı'}</b><br>${esc(login ? 'Güvenlik için yeniden giriş yapman gerekiyor.' : q.status === 403 ? q.error + '. Üyeliğini resepsiyonda kontrol ettir.' : q.error)}${!login && q.status !== 403 && q.retryAt > Date.now() ? '<br><span class="muted">Otomatik olarak tekrar denenecek.</span>' : ''}</div></div>${login ? '<a class="btn primary block" href="/" target="_top">Giriş yap</a>' : `<button class="btn block" data-qr-refresh>${icon('refresh')} Tekrar dene</button>`}`;
  }
  const me = (S.state?.members || [])[0];
  return `<section class="card qr-card${S.qrBig ? ' big' : ''}" id="qr-card"><div class="qr-wrap">
    <p class="muted qr-help">Resepsiyondaki yöneticiye göster. Kod her ${q.ttl} saniyede yenilenir ve tek kullanımlıktır.</p>
    <div class="qr-frame" id="qr-frame" role="img" aria-label="Giriş QR kodu"><div class="qr-overlay" id="qr-overlay">${q.loading && !q.token ? '<span class="spinner" aria-hidden="true"></span><span>Kod hazırlanıyor…</span>' : ''}</div></div>
    <div class="countdown" id="qr-count" aria-hidden="true"></div>
    <p class="sr" id="qr-live" role="status" aria-live="polite"></p>
    ${q.error && S.online ? `<div class="notice bad qr-inline" role="alert"><div class="grow">Yeni kod alınamadı: ${esc(q.error)}${q.retryAt > Date.now() ? '<br><span class="muted">Otomatik olarak tekrar denenecek.</span>' : ''}</div></div>` : ''}
    ${S.online ? '' : '<p class="qr-offline" role="status"><span class="offline-dot"></span>Çevrimdışı · mevcut kod süresi bitene kadar geçerli, yenisi bağlantı gelince alınır.</p>'}
    <div class="qr-actions"><button class="btn" data-qr-refresh ${q.loading || !S.online ? 'disabled' : ''}>${icon('refresh')} Yeni kod al</button><button class="btn ghost" id="qr-big" aria-pressed="${S.qrBig ? 'true' : 'false'}">${S.qrBig ? 'Küçült' : 'Büyüt'}</button></div>
    ${me ? `<div class="member-meta"><div><span>Üye</span><b>${esc(me.name)}</b></div><div><span>Üyelik bitişi</span><b>${esc(me.expires || '—')}</b></div><div><span>Paket</span><b>${esc(me.plan || '—')}</b></div><div><span>Ders kredisi</span><b>${esc(me.credits ?? '—')}</b></div></div>` : ''}
  </div></section>
  <p class="footnote">Ekran parlaklığını artırmak okutmayı hızlandırır. Bu ekran açıkken telefonun ekranı kararmaz (destekleyen tarayıcılarda). Kodun ekran görüntüsü işe yaramaz: süresi dolunca geçersiz olur.</p>`;
}
// Announce code state changes once for screen readers; the visual countdown stays silent.
let qrSpoken = '';
function sayQR(text) { const el = $('qr-live'); if (el && text !== qrSpoken) { qrSpoken = text; el.textContent = text; } }
function qrSvg(token) {
  const qr = window.qrcode(0, 'M');
  qr.addData(token, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b100d"/></svg>`;
}
function paintQR() {
  const frame = $('qr-frame');
  if (!frame || !S.qr.token) return;
  const overlay = $('qr-overlay');
  frame.querySelector('svg')?.remove();
  frame.insertAdjacentHTML('afterbegin', qrSvg(S.qr.token));
  if (overlay) overlay.innerHTML = '';
  tickQR();
}
function tickQR() {
  const el = $('qr-count'), frame = $('qr-frame');
  if (!el || !frame) return;
  const left = Math.max(0, Math.ceil((S.qr.expiresAt - Date.now()) / 1000));
  const stale = !S.qr.token || left === 0;
  frame.classList.toggle('stale', stale);
  const overlay = $('qr-overlay');
  if (overlay && stale && S.qr.token) {
    const html = S.qr.loading ? '<span class="spinner" aria-hidden="true"></span><span>Yeni kod alınıyor…</span>'
      : S.online ? `<span>Kodun süresi doldu</span><button class="btn primary" data-qr-refresh>${icon('refresh')} Yeni kod al</button>`
      : '<span>Kodun süresi doldu<br>Çevrimdışı · bağlantı gelince yenilenir</span>';
    if (overlay.dataset.state !== html) { overlay.innerHTML = html; overlay.dataset.state = html; }
  } else if (overlay && !stale && overlay.dataset.state) { overlay.innerHTML = ''; overlay.dataset.state = ''; }
  if (stale && S.qr.token) sayQR(S.online ? 'Kodun süresi doldu. Yeni kod al düğmesine dokun.' : 'Kodun süresi doldu. Bağlantı yok.');
  else if (left === 10) sayQR('Kodun 10 saniye geçerliliği kaldı.');
  const C = 2 * Math.PI * 16, frac = S.qr.ttl ? left / S.qr.ttl : 0;
  el.innerHTML = `<svg class="ring ${left <= 10 ? 'low' : ''}" viewBox="0 0 38 38" aria-hidden="true"><circle class="track" cx="19" cy="19" r="16"/><circle class="arc" cx="19" cy="19" r="16" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(2)}"/></svg><span>${stale ? (S.qr.loading ? 'Yeni kod alınıyor…' : 'Kodun süresi doldu') : `Kod <b>${left}</b> sn geçerli`}</span>`;
}
async function fetchQR() {
  if (S.qr.loading) return;
  clearTimeout(qrTimer);
  S.qr.loading = true;
  if (S.view === 'qr' && S.qr.token) tickQR();
  try {
    const r = K.normalizeQR(await api(K.ENDPOINTS.qr, { method: 'POST', body: {} }));
    Object.assign(S.qr, { token: r.token, ttl: r.expiresIn, expiresAt: Date.now() + r.expiresIn * 1000, error: '', status: 0, missing: false, loading: false, retries: 0, retryAt: 0 });
    if (S.view === 'qr') { if (!$('qr-frame') || !$('qr-card')) render(); else paintQR(); sayQR(`Yeni giriş kodu hazır. ${r.expiresIn} saniye geçerli.`); }
    qrTimer = setTimeout(() => { if (S.view === 'qr' && !document.hidden) fetchQR(); }, K.refreshDelayMs(r.expiresIn));
  } catch (e) {
    S.qr.loading = false;
    S.qr.missing = K.isMissingApi(e);
    S.qr.error = e.message;
    S.qr.status = e.status || 0;
    // A rejected session or membership invalidates the visible code too.
    if (e.status === 401 || e.status === 403) S.qr.token = '';
    // Server or network hiccup while online: retry 3 s, 6 s, 12 s … up to 30 s. Rate limits wait longer.
    else if (!S.qr.missing && S.online && S.view === 'qr') {
      S.qr.retries = (S.qr.retries || 0) + 1;
      const wait = e.status === 429 ? 30000 : Math.min(30000, 3000 * 2 ** (S.qr.retries - 1));
      S.qr.retryAt = Date.now() + wait;
      qrTimer = setTimeout(() => { if (S.view === 'qr' && !document.hidden) fetchQR(); }, wait);
    }
    // Membership problems (403) are not retried automatically; network problems retry when back online.
    if (S.view === 'qr') { if (S.qr.token && e.offline) tickQR(); else render(); }
  }
}
function startQR() {
  if (S.role !== 'member') return;
  clearInterval(tickTimer);
  tickTimer = setInterval(tickQR, 1000);
  if (!S.qr.token || S.qr.expiresAt - Date.now() < 6000) fetchQR(); else { paintQR(); qrTimer = setTimeout(fetchQR, Math.max(1000, S.qr.expiresAt - Date.now() - 5000)); }
  requestWakeLock();
}
function stopQR() { clearTimeout(qrTimer); clearInterval(tickTimer); releaseWakeLock(); }
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock && !document.hidden) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { wakeLock = null; }
}
function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }

/* ---------- Staff scanner ---------- */
let stream = null, detector = null, loopTimer = 0, canvas = null, resumeTimer = 0;
function scanView() {
  const s = S.scan;
  const secure = window.isSecureContext;
  const camSupported = !!navigator.mediaDevices?.getUserMedia;
  const resultHtml = s.result ? `<div class="scan-result ${s.result.ok ? 'ok' : 'bad'}" role="${s.result.ok ? 'status' : 'alert'}">${icon(s.result.ok ? 'check' : 'alert')}<div><span class="big">${esc(s.result.title)}</span>${esc(s.result.detail)}</div></div>` : '';
  return `<div class="grid two">
  <section class="card">
    <div class="scanner" id="scanner">
      ${s.active ? `<video id="scan-video" playsinline muted autoplay aria-label="Kamera görüntüsü"></video><div class="reticle" aria-hidden="true"></div>${s.busy ? '' : '<div class="scanline" aria-hidden="true"></div>'}` : `<div class="placeholder">${icon('camera')}${cameraHelp(secure, camSupported)}${secure && camSupported ? `<button class="btn primary" id="cam-start" ${s.starting ? 'disabled' : ''}>${icon('camera')} ${s.starting ? 'Kamera açılıyor…' : s.error ? 'Tekrar dene' : 'Kamerayı aç'}</button>` : ''}</div>`}
      ${resultHtml}
    </div>
    ${s.error ? `<div class="notice bad" role="alert" style="margin-top:12px"><div class="grow">${esc(s.error)}${s.errorHelp ? `<br><span class="muted">${esc(s.errorHelp)}</span>` : ''}</div></div>` : ''}
    ${S.online ? '' : '<div class="notice warn" role="status" style="margin-top:12px"><div class="grow"><b>Bağlantı yok.</b> Kodlar sunucuda doğrulanır; bağlantı gelene kadar giriş onaylanamaz.</div></div>'}
    <div class="row" style="margin-top:12px;justify-content:space-between">${s.active ? `<button class="btn" id="cam-stop">Kamerayı kapat</button>${s.torch ? `<button class="btn ghost" id="cam-torch" aria-pressed="${s.torchOn ? 'true' : 'false'}">${s.torchOn ? 'Feneri kapat' : 'Feneri aç'}</button>` : ''}<span class="footnote">${s.engine === 'native' ? 'Yerel QR algılayıcı' : 'Yazılım QR çözücü'}</span>` : ''}</div>
    <form id="manual-form" style="margin-top:12px" autocomplete="off"><label class="field" for="manual-token">Kod ile doğrula (USB / Bluetooth okuyucu da kullanılabilir)</label><div class="manual" style="margin-top:6px"><input id="manual-token" name="token" inputmode="text" autocapitalize="off" spellcheck="false" placeholder="QR içeriği"><button class="btn primary" ${s.busy ? 'disabled' : ''}>Doğrula</button></div></form>
  </section>
  <section class="card"><div class="cardtop"><h2>Son okutmalar</h2><span class="pill">${s.history.filter(h => h.ok).length} giriş</span></div>
    ${s.history.length ? `<ul class="history">${s.history.map(h => `<li><span class="dot ${h.ok ? 'ok' : 'bad'}" aria-hidden="true"></span><span class="who"><b>${esc(h.title)}</b>${h.ok ? '' : `<br><span class="muted">${esc(h.detail)}</span>`}</span><time>${esc(h.time)}</time></li>`).join('')}</ul>` : '<div class="empty">Bu oturumda henüz okutma yok.</div>'}
    <p class="footnote">Liste yalnızca bu cihazda, sayfa açıkken tutulur. Her QR 60 saniye geçerlidir ve bir kez kullanılabilir.</p>
  </section></div>`;
}
function cameraHelp(secure, supported) {
  if (!secure) return `<div><b>Kamera için güvenli bağlantı (HTTPS) gerekli.</b><br>Telefon tarayıcıları kamerayı yalnızca https:// ile başlayan adreslerde açar${location.protocol === 'http:' ? ` (şu an: ${esc(location.host)} http üzerinden açık)` : ''}. Yöneticinden HTTPS adresini iste. Bu arada kodu aşağıya elle veya USB okuyucuyla girebilirsin.</div>`;
  if (!supported) return '<div>Bu tarayıcı kamera erişimini desteklemiyor. Güncel Chrome veya Safari kullan ya da kodu aşağıya elle veya USB okuyucuyla gir.</div>';
  if (S.scan.permission === 'denied') return `<div><b>Kamera izni kapalı.</b><br>${esc(permissionSteps())}</div>`;
  return '<div>Üyenin telefonundaki QR kodu çerçeveye getir.</div>';
}
function permissionSteps() {
  if (isIOS()) return 'iPhone: Ayarlar › Safari › Kamera › İzin Ver; ya da adres çubuğundaki “aA” › Web Sitesi Ayarları › Kamera. Ana ekrana eklenmiş uygulamada Ayarlar’dan izin verip uygulamayı yeniden aç.';
  if (/android/i.test(navigator.userAgent)) return 'Android: adres çubuğundaki kilit simgesi › İzinler › Kamera › İzin ver. Ardından “Tekrar dene”ye dokun.';
  return 'Adres çubuğundaki kilit veya kamera simgesinden bu site için kameraya izin ver, ardından “Tekrar dene”ye bas.';
}
// Map getUserMedia failures to actionable Turkish messages.
function cameraError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return ['Kamera izni verilmedi.', permissionSteps()];
  if (name === 'SecurityError') return ['Kamera bu sayfada engellendi.', 'Sayfayı HTTPS adresinden aç. Uygulama içinde açıksan ana sayfadan yeniden dene.'];
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return ['Bu cihazda kamera bulunamadı.', 'Kodu aşağıya elle veya USB okuyucuyla girebilirsin.'];
  if (name === 'NotReadableError' || name === 'TrackStartError') return ['Kamera başka bir uygulama tarafından kullanılıyor.', 'Kamerayı kullanan uygulamayı kapatıp “Tekrar dene”ye dokun.'];
  if (name === 'AbortError') return ['Kamera başlatılamadı.', 'Birkaç saniye sonra tekrar dene.'];
  return ['Kamera açılamadı: ' + (e?.message || name || e), ''];
}
async function checkCameraPermission() {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' });
    if (!status) return;
    const apply = () => { const was = S.scan.permission; S.scan.permission = status.state; if (was !== status.state && S.view === 'scan' && !S.scan.active) updateScanUI(); };
    apply();
    status.onchange = apply;
  } catch {} // Safari and Firefox may not expose the camera permission name.
}
async function startCamera() {
  S.scan.error = ''; S.scan.errorHelp = ''; S.scan.starting = true; updateScanUI();
  const ask = video => navigator.mediaDevices.getUserMedia({ video, audio: false });
  try {
    try { stream = await ask({ facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }); }
    catch (e) { if (e?.name === 'OverconstrainedError' || e?.name === 'ConstraintNotSatisfiedError') stream = await ask(true); else throw e; }
  } catch (e) {
    [S.scan.error, S.scan.errorHelp] = cameraError(e);
    if (e?.name === 'NotAllowedError') S.scan.permission = 'denied';
    S.scan.starting = false;
    return S.view === 'scan' ? render() : undefined;
  }
  if (S.view !== 'scan') { stream.getTracks().forEach(t => t.stop()); stream = null; S.scan.starting = false; return; }
  await setupDetector();
  S.scan.permission = 'granted'; S.scan.starting = false; S.scan.torchOn = false;
  try { S.scan.torch = !!stream.getVideoTracks()[0]?.getCapabilities?.().torch; } catch { S.scan.torch = false; }
  S.scan.active = true;
  render();
}
async function setupDetector() {
  detector = null;
  try {
    if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      S.scan.engine = 'native';
      return;
    }
  } catch {}
  S.scan.engine = 'js';
  if (!window.jsQR) await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/v9/vendor/jsQR.js'; s.onload = resolve; s.onerror = () => reject(Error('QR çözücü yüklenemedi')); document.head.appendChild(s); }).catch(e => { S.scan.error = e.message; });
}
function attachStream() {
  const video = $('scan-video');
  if (!video || !stream) return;
  video.srcObject = stream;
  video.play().catch(() => {});
  clearTimeout(loopTimer);
  loopTimer = setTimeout(scanFrame, 300);
}
async function scanFrame() {
  const video = $('scan-video');
  if (!S.scan.active || !video || document.hidden) return;
  if (!S.scan.busy && video.readyState >= 2) {
    let text = '';
    try {
      if (detector) {
        const codes = await detector.detect(video);
        text = codes[0]?.rawValue || '';
      } else if (window.jsQR) {
        const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
        canvas = canvas || document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        text = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data || '';
      }
    } catch {}
    if (text) await submitToken(text);
  }
  loopTimer = setTimeout(scanFrame, 200);
}
function stopCamera() {
  clearTimeout(loopTimer); clearTimeout(resumeTimer);
  stream?.getTracks().forEach(t => t.stop());
  stream = null; S.scan.active = false; S.scan.busy = false;
}
async function submitToken(raw) {
  const token = String(raw || '').trim();
  const now = Date.now();
  // The camera sees the same code many times per second; ignore repeats for 4 s.
  if (token === S.scan.last && now - S.scan.lastAt < 4000) return;
  S.scan.last = token; S.scan.lastAt = now;
  if (!token) return;
  if (!K.isToken(token)) return showResult({ ok: false, title: 'Tanınmayan kod', detail: 'Bu bir FORM CLUB giriş QR kodu değil.' });
  if (!S.online) return showResult({ ok: false, title: 'Bağlantı yok', detail: K.scanErrorText({ status: 0, offline: true }) });
  S.scan.busy = true; updateScanUI();
  try {
    const r = await api(K.ENDPOINTS.checkin, { method: 'POST', body: { token } });
    const at = r.checked_in_at ? new Date(r.checked_in_at) : new Date();
    showResult({ ok: true, title: r.member || 'Giriş onaylandı', detail: `Giriş onaylandı · ${at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` });
  } catch (e) {
    showResult({ ok: false, title: K.isMissingApi(e) ? 'Özellik sunucuda etkin değil' : 'Giriş reddedildi', detail: K.isMissingApi(e) ? missingApiText : K.scanErrorText(e) });
  }
}
function showResult(result) {
  S.scan.busy = true;
  S.scan.result = result;
  S.scan.history.unshift({ ...result, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  S.scan.history = S.scan.history.slice(0, 20);
  try { navigator.vibrate?.(result.ok ? 80 : [60, 60, 60]); } catch {}
  updateScanUI();
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { S.scan.busy = false; S.scan.result = null; updateScanUI(); }, result.ok ? 2200 : 3200);
}
// Re-render only the scanner page while keeping the <video> element (and its stream) alive.
function updateScanUI() {
  if (S.view !== 'scan') return;
  const video = $('scan-video');
  const focus = document.activeElement?.id, value = $('manual-token')?.value || '';
  const main = $('main');
  if (!main) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = scanView();
  const oldGrid = main.querySelector('.grid.two'), newGrid = tmp.firstElementChild;
  if (video && newGrid.querySelector('#scan-video')) newGrid.querySelector('#scan-video').replaceWith(video);
  oldGrid.replaceWith(newGrid);
  const input = $('manual-token'); if (input) { input.value = value; if (focus === 'manual-token') input.focus(); }
  if (!video && S.scan.active) attachStream();
}

/* ---------- Notifications ---------- */
let noteTimer = 0;
async function loadNotifications() {
  try {
    S.notes = K.normalizeNotifications(await api(S.role==='member'?K.ENDPOINTS.notifications:'/api/v9/staff/notifications'));
    S.notesLoaded = true; S.notesError = ''; S.notesMissing = false;
  } catch (e) {
    S.notesLoaded = true; S.notesMissing = K.isMissingApi(e); S.notesError = e.message;
  }
  try { const n = K.unreadCount(S.notes); if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch {}
  refreshChrome();
}
function startNotePolling() {
  clearInterval(noteTimer);
  noteTimer = setInterval(() => { if (!document.hidden && S.online) loadNotifications(); }, 60000);
}
// Update badges and the notification page without disturbing camera or QR state.
function refreshChrome() {
  if (!S.user || !$('main')) return;
  if (S.view === 'notifications') return render();
  const unread = K.unreadCount(S.notes);
  document.querySelectorAll('[data-go="notifications"]').forEach(a => {
    a.querySelector('.badge')?.remove();
    if (unread) a.insertAdjacentHTML('beforeend', `<span class="badge">${unread > 99 ? '99+' : unread}</span>`);
  });
}
function notesView() {
  if (S.notesMissing) return `<div class="notice info">${esc(missingApiText)}</div>`;
  if (!S.notesLoaded) return '<div class="empty">Bildirimler yükleniyor…</div>';
  const unread = K.unreadCount(S.notes);
  const list = S.noteFilter === 'unread' ? S.notes.filter(n => !n.read) : S.notes;
  return `${S.notesError ? `<div class="notice bad" role="alert"><div class="grow">${esc(S.notesError)}</div><button class="btn small" id="notes-reload">Tekrar dene</button></div>` : ''}
  <section class="card"><div class="cardtop"><div class="seg" role="group" aria-label="Filtre" style="min-width:220px"><button data-filter="all" aria-pressed="${S.noteFilter === 'all'}">Tümü (${S.notes.length})</button><button data-filter="unread" aria-pressed="${S.noteFilter === 'unread'}">Okunmamış (${unread})</button></div>${unread ? `<button class="btn small" id="read-all">${icon('check')} Tümünü okundu yap</button>` : ''}</div>
  ${list.length ? `<ul class="notes">${list.map(n => `<li class="note ${n.read ? '' : 'unread'}"><span class="ico ${n.kind}">${icon(NOTE_ICON[n.kind])}</span><div class="body"><b>${n.read ? '' : '<span class="new" aria-label="Yeni"></span>'}${esc(n.title)}</b><p>${esc(n.detail)}</p>${n.date ? `<time datetime="${esc(n.date)}">${esc(K.relativeDay(n.date))}</time>` : ''}</div>${n.read ? '' : `<button class="btn small ghost" data-read="${esc(n.id)}" aria-label="${esc(n.title)} okundu olarak işaretle">Okundu</button>`}</li>`).join('')}</ul>` : `<div class="empty">${S.noteFilter === 'unread' ? 'Okunmamış bildirim yok.' : 'Şu an bildirim yok. Yaklaşan ders, ödeme ve üyelik hatırlatmaları burada görünür.'}</div>`}
  </section><p class="footnote">Bildirimler her dakika yenilenir.</p>`;
}
async function markRead(ids) {
  try {
    for (const id of ids) await api(S.role==='member'?K.ENDPOINTS.notificationRead:'/api/v9/staff/notifications/read', { method: 'POST', body: { id } });
    S.notes = S.notes.map(n => ids.includes(n.id) ? { ...n, read: true } : n);
  } catch (e) { toast(e.message, true); }
  loadNotifications();
}

/* ---------- Trainer performance ---------- */
let reportSeq = 0;
async function loadReport() {
  const r = S.report, seq = ++reportSeq;
  if (r.trainerId == null || r.trainerId === '') { r.error = S.role === 'teacher' ? 'Hesabına bağlı eğitmen kaydı yok. Yöneticiden hesabını bir eğitmenle eşleştirmesini iste.' : 'Raporu görmek için önce bir eğitmen ekle.'; r.data = null; return render(); }
  r.loading = true; r.error = ''; if (S.view === 'performance') render();
  const trainerId = S.role === 'admin' ? r.trainerId : null;
  try {
    const months = K.monthsBack(r.year, r.month, 6);
    const results = await Promise.all(months.map(m => api(S.role==='admin'?'/api/v9/admin/reports/monthly?month='+m.year+'-'+String(m.month).padStart(2,'0')+'&trainer_id='+trainerId:K.reportQuery(m.year,m.month)).then(K.normalizeReport)));
    if (seq !== reportSeq) return;
    r.data = results.at(-1); r.trend = results; r.missing = false;
  } catch (e) {
    if (seq !== reportSeq) return;
    r.data = null; r.trend = []; r.missing = K.isMissingApi(e); r.error = e.message;
  }
  r.loading = false;
  if (S.view === 'performance') render();
}
function perfView() {
  const r = S.report, d = r.data;
  const now = new Date(), isCurrent = r.year === now.getFullYear() && r.month === now.getMonth() + 1;
  const picker = S.role === 'admin' ? `<label class="sr" for="trainer-pick">Eğitmen</label><select class="select" id="trainer-pick" style="max-width:260px">${trainers().map(t => `<option value="${t.id}" ${String(t.id) === String(r.trainerId) ? 'selected' : ''}>${esc(t.name)}</option>`).join('') || '<option value="">Eğitmen yok</option>'}</select>` : '';
  const controls = `<div class="row section" style="justify-content:space-between">${picker}<div class="monthnav"><button class="btn small" data-month="-1" aria-label="Önceki ay">←</button><b>${esc(K.monthLabel(r.year, r.month))}</b><button class="btn small" data-month="1" aria-label="Sonraki ay" ${isCurrent ? 'disabled' : ''}>→</button></div></div>`;
  if (r.missing) return controls + `<div class="notice info">${esc(missingApiText)}</div>`;
  if (r.error) return controls + `<div class="notice bad" role="alert"><div class="grow">${esc(r.error)}</div><button class="btn small" id="report-reload">Tekrar dene</button></div>`;
  if (!d) return controls + `<div class="empty">${r.loading ? 'Rapor yükleniyor…' : 'Rapor yok.'}</div>`;
  const kpi = (label, value, foot) => `<article class="card kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="foot">${esc(foot)}</div></article>`;
  return `${controls}
  ${S.role === 'admin' && d.trainer.name ? '' : d.trainer.name ? `<p class="muted" style="margin:-4px 0 12px">${esc(d.trainer.name)}</p>` : ''}
  <div class="kpis">${kpi('Ders', int(d.class_count), `${int(d.completed_classes)} tamamlandı`)}${kpi('Katılım', int(d.attendance), 'Geldi işaretlenen üyeler')}${kpi('Doluluk', `%${int(d.occupancy_percent)}`, 'Rezervasyon / kapasite')}${kpi('Gelme oranı', d.show_rate == null ? '—' : `%${int(d.show_rate)}`, 'Geldi / yoklaması işaretlenen')}</div>
  <section class="card section"><div class="cardtop"><h2>Ders bazında rezervasyon ve katılım</h2>${r.loading ? '<span class="pill">Yenileniyor…</span>' : ''}</div>
    ${d.classes.length ? `<div class="legend"><span><i style="background:var(--s-res)"></i>Rezervasyon</span><span><i style="background:var(--s-att)"></i>Katılım</span><span><i class="cap"></i>Kapasite</span></div><div class="chart" id="chart-classes">${classChart(d.classes)}</div>
    <details style="margin-top:10px"><summary>Tablo görünümü</summary><div class="tablewrap"><table><thead><tr><th>Ders</th><th>Tarih</th><th>Kapasite</th><th>Rezervasyon</th><th>Katılım</th></tr></thead><tbody>${d.classes.map(c => `<tr><td>${esc(c.title)}</td><td>${esc(K.shortDate(c.starts_at))}</td><td>${int(c.capacity)}</td><td>${int(c.reservations)}</td><td>${int(c.attended)}</td></tr>`).join('')}</tbody></table></div></details>` : '<div class="empty">Bu ay için planlanmış ders yok.</div>'}
  </section>
  <div class="grid two"><section class="card"><h2>Doluluk · son 6 ay</h2><div class="chart" id="chart-occ">${trendChart(r.trend, 'occupancy_percent', v => `%${int(v)}`, 100)}</div></section>
  <section class="card"><h2>Katılım · son 6 ay</h2><div class="chart" id="chart-att">${trendChart(r.trend, 'attendance', v => int(v))}</div></section></div>
  <p class="footnote">Doluluk, aydaki tüm derslerin (gelecek dersler dahil) rezervasyonlarının toplam kapasiteye oranıdır. Katılım “geldi” işaretlenen üyeleri sayar. Gelme oranı, geldi ve gelmedi olarak işaretlenen yoklamalar üzerinden hesaplanır.</p>`;
}
// Grouped bars per class (reservations, attended) with a dashed capacity tick. One y-axis (people).
function classChart(classes) {
  const H = 220, top = 16, bottom = 40, left = 34, col = 46, w = left + classes.length * col + 8;
  const max = K.niceMax(Math.max(4, ...classes.map(c => Math.max(c.capacity, c.reservations, c.attended))));
  const y = v => top + (H - top - bottom) * (1 - v / max), base = y(0);
  const ticks = Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  let s = `<svg width="${Math.max(w, 300)}" height="${H}" role="img" aria-label="Ders bazında rezervasyon ve katılım sütun grafiği">`;
  s += ticks.map(t => `<line class="grid-line" x1="${left}" x2="${w}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-text" x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${int(t)}</text>`).join('');
  classes.forEach((c, i) => {
    const x = left + i * col + 6, bw = 15;
    const bar = (v, dx, color) => { const h = Math.max(v ? 2 : 0, base - y(v)); return h ? `<path d="M${x + dx} ${base}v${-(h - 4)}a4 4 0 0 1 4 -4h${bw - 8}a4 4 0 0 1 4 4v${h - 4}z" fill="${color}"/>` : ''; };
    s += bar(c.reservations, 0, 'var(--s-res)') + bar(c.attended, bw + 2, 'var(--s-att)');
    s += `<line x1="${x - 3}" x2="${x + bw * 2 + 5}" y1="${y(c.capacity)}" y2="${y(c.capacity)}" stroke="#8da090" stroke-width="2" stroke-dasharray="3 3"/>`;
    const p = K.parseLocal(c.starts_at);
    s += `<text class="axis-text" x="${x + bw + 1}" y="${H - bottom + 16}" text-anchor="middle">${p ? p.date.getDate() : ''}</text><text class="axis-text" x="${x + bw + 1}" y="${H - bottom + 30}" text-anchor="middle" style="font-size:10px">${esc(p?.time || '')}</text>`;
    s += `<rect class="hit" tabindex="0" x="${x - 5}" y="${top}" width="${col - 2}" height="${H - top - bottom + 34}" data-tip="${esc(JSON.stringify({ t: c.title, d: K.shortDate(c.starts_at), k: [['Kapasite', c.capacity], ['Rezervasyon', c.reservations], ['Katılım', c.attended]] }))}"><title>${esc(c.title)} ${esc(K.shortDate(c.starts_at))}: ${c.reservations} rezervasyon, ${c.attended} katılım, kapasite ${c.capacity}</title></rect>`;
  });
  s += `<line x1="${left}" x2="${w}" y1="${base}" y2="${base}" stroke="#405043"/></svg>`;
  return s;
}
// Single-series monthly trend: line + markers, value labelled on the last point only.
function trendChart(trend, key, fmt, fixedMax) {
  if (!trend.length) return '<div class="empty">Veri yok.</div>';
  const W = 320, H = 170, top = 18, bottom = 28, left = 36, right = 14;
  const values = trend.map(t => t[key]);
  const max = fixedMax || K.niceMax(Math.max(4, ...values)); // >= 4 keeps the 0 / half / max ticks whole numbers
  const x = i => left + (W - left - right) * (trend.length === 1 ? 0.5 : i / (trend.length - 1));
  const y = v => top + (H - top - bottom) * (1 - v / max);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const label = t => new Date(t.year, t.month - 1, 1).toLocaleDateString('tr-TR', { month: 'short' });
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W * 1.6}px" role="img" aria-label="Son 6 ay ${key === 'attendance' ? 'katılım' : 'doluluk'} çizgi grafiği">`;
  s += (Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max]).map(t => `<line class="grid-line" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-text" x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
  s += `<polyline points="${pts}" fill="none" stroke="var(--s-res)" stroke-width="2" stroke-linejoin="round"/>`;
  s += trend.map((t, i) => `<circle cx="${x(i)}" cy="${y(values[i])}" r="4" fill="var(--s-res)" stroke="var(--card)" stroke-width="2"/><text class="axis-text" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(label(t))}</text><rect class="hit" tabindex="0" x="${x(i) - 18}" y="${top - 6}" width="36" height="${H - top - bottom + 12}" data-tip="${esc(JSON.stringify({ t: K.monthLabel(t.year, t.month), k: [[key === 'attendance' ? 'Katılım' : 'Doluluk', fmt(values[i])], ['Ders', t.class_count]] }))}"/>`).join('');
  const li = values.length - 1;
  s += `<text class="val-text" x="${x(li) - 6}" y="${y(values[li]) - 9}" text-anchor="end">${esc(fmt(values[li]))}</text></svg>`;
  return s;
}
function bindCharts() {
  document.querySelectorAll('.chart').forEach(chart => {
    const show = el => {
      let data; try { data = JSON.parse(el.dataset.tip); } catch { return; }
      hide();
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.innerHTML = `<b>${esc(data.t)}</b>${data.d ? `<div class="muted">${esc(data.d)}</div>` : ''}${data.k.map(([k, v]) => `<div class="k"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}`;
      chart.appendChild(tip);
      const box = el.getBoundingClientRect(), cb = chart.getBoundingClientRect();
      let left = box.left - cb.left + chart.scrollLeft + box.width / 2 - tip.offsetWidth / 2;
      left = Math.max(chart.scrollLeft + 4, Math.min(left, chart.scrollLeft + chart.clientWidth - tip.offsetWidth - 4));
      tip.style.left = left + 'px';
      tip.style.top = '4px';
    };
    const hide = () => chart.querySelector('.tip')?.remove();
    chart.addEventListener('pointerover', e => { const t = e.target.closest('[data-tip]'); if (t) show(t); });
    chart.addEventListener('pointerleave', hide);
    chart.addEventListener('focusin', e => { const t = e.target.closest('[data-tip]'); if (t) show(t); });
    chart.addEventListener('focusout', hide);
  });
}

/* ---------- More ---------- */
function moreView() {
  const installed = isStandalone() || S.install.installed;
  let install;
  if (installed) install = `<p class="muted" style="margin:0">${icon('check').replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;color:var(--ok)"')} Uygulama olarak çalışıyor.</p>`;
  else if (S.install.prompt) install = `<p class="muted" style="margin-top:0">Ana ekrana ekle; tam ekran açılır, QR kodun tek dokunuşla hazır olur.</p><button class="btn primary block" id="install-more">${icon('download')} Uygulamayı yükle</button>`;
  else if (isIOS()) install = `<p class="muted" style="margin-top:0">iPhone / iPad'de Safari ile:</p><ol class="ios-steps"><li>Alttaki ${icon('share').replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-2px"')} <b>Paylaş</b> düğmesine dokun.</li><li><b>Ana Ekrana Ekle</b>'yi seç.</li><li>Sağ üstte <b>Ekle</b>'ye dokun.</li></ol>`;
  else install = '<p class="muted" style="margin:0">Tarayıcının menüsünden “Uygulamayı yükle” veya “Ana ekrana ekle” seçeneğini kullan. Seçenek görünmüyorsa sayfayı HTTPS üzerinden aç.</p>';
  return `<div class="grid two"><section class="card"><h2>Uygulama</h2>${install}</section>
  <section class="card"><h2>Diğer ekranlar</h2><div class="links"><a href="/v8.html">Beslenme ve sağlık <span>→</span></a><a href="/v7.html">Stüdyo paneli <span>→</span></a><a href="/">Ana uygulama <span>→</span></a></div></section>
  <section class="card"><h2>Hesap</h2><p class="muted" style="margin-top:0">${esc(S.user.username || '')} · ${esc(roleName())}</p><button class="btn" id="logout">Çıkış yap</button></section></div>`;
}

/* ---------- Events ---------- */
root.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-go],[data-qr-refresh],[data-filter],[data-read],[data-month],button[id],a[id]');
  if (!t || t.disabled) return;
  if (t.dataset.go) { ev.preventDefault(); return go(t.dataset.go); }
  if (t.hasAttribute('data-qr-refresh')) { S.qr.error = ''; return fetchQR(); }
  if (t.dataset.filter) { S.noteFilter = t.dataset.filter; return render(); }
  if (t.dataset.read) { t.disabled = true; return markRead([t.dataset.read]); }
  if (t.dataset.month) { Object.assign(S.report, K.shiftMonth(S.report.year, S.report.month, Number(t.dataset.month))); return loadReport(); }
  switch (t.id) {
    case 'retry-boot': root.innerHTML = '<div class="loading">Yeniden deneniyor…</div>'; return init();
    case 'install-top': case 'install-banner': case 'install-more': return promptInstall();
    case 'install-dismiss': store.set('install-dismissed', '1'); return render();
    case 'sw-update': S.sw.waiting?.postMessage({ type: 'SKIP_WAITING' }); return;
    case 'cam-start': t.disabled = true; return startCamera();
    case 'qr-big': S.qrBig = !S.qrBig; render(); return $('qr-big')?.focus();
    case 'cam-stop': stopCamera(); return render();
    case 'cam-torch': {
      const track = stream?.getVideoTracks()[0];
      try { await track.applyConstraints({ advanced: [{ torch: !S.scan.torchOn }] }); S.scan.torchOn = !S.scan.torchOn; }
      catch { S.scan.torch = false; toast('Fener bu cihazda kullanılamıyor.', true); }
      return updateScanUI();
    }
    case 'notes-reload': return loadNotifications();
    case 'read-all': t.disabled = true; return markRead(S.notes.filter(n => !n.read).map(n => n.id));
    case 'report-reload': return loadReport();
    case 'logout': try { await api('/api/logout', { method: 'POST', body: {} }); } catch {} location.href = '/'; return;
  }
});
root.addEventListener('change', ev => {
  if (ev.target.id === 'trainer-pick') { S.report.trainerId = Number(ev.target.value) || null; loadReport(); }
});
root.addEventListener('submit', ev => {
  if (ev.target.id !== 'manual-form') return;
  ev.preventDefault();
  const input = $('manual-token');
  const value = input?.value || '';
  if (input) input.value = ''; // cleared before submitToken re-renders and copies the field value
  S.scan.last = ''; // manual entry is always intentional
  submitToken(value);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.qrBig && S.view === 'qr') { S.qrBig = false; render(); } });
window.addEventListener('popstate', () => { if (S.user) go(location.hash.slice(1), true); });
document.addEventListener('visibilitychange', () => {
  if (!S.user) return;
  if (document.hidden) {
    if (S.view === 'qr') { clearTimeout(qrTimer); releaseWakeLock(); }
    if (S.view === 'scan' && S.scan.active) { stopCamera(); render(); }
    return;
  }
  if (S.view === 'qr') startQR();
  loadNotifications();
});
const setOnline = on => { S.online = on; if (!S.user) return on && init(); render(); if (on && S.view === 'qr') startQR(); if (on) loadNotifications(); };
window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

/* ---------- Service worker ---------- */
if (!globalThis.FORMCLUB_CONFIG?.native && !new URLSearchParams(location.search).has('embedded') && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/v9/sw.js', { scope: '/v9/' });
      const watch = worker => worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { S.sw.waiting = worker; if (S.user) render(); } });
      if (reg.waiting && navigator.serviceWorker.controller) { S.sw.waiting = reg.waiting; if (S.user) render(); }
      reg.addEventListener('updatefound', () => watch(reg.installing));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && S.sw.waiting) { reloading = true; location.reload(); } });
    } catch {}
  });
}

init();
})();
