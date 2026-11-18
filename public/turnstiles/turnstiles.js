/* FORM CLUB virtual turnstiles (SIMULATION ONLY).
   #turnstiles: admin view with the three gate QR codes, presence and pass log.
   #gate: member scans a gate QR with the phone camera; the server decides entry or exit. */
(() => {
'use strict';
const root = document.getElementById('gate-root');
const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const $ = id => document.getElementById(id);
const time = ms => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const PREFIX = 'FORMCLUB-GATE:1:';
const DIR = { in: 'Giriş', out: 'Çıkış' };

async function api(path, options = {}) {
  const base = String(globalThis.FORMCLUB_CONFIG?.apiBase || '').replace(/\/+$/, '');
  const init = { method: options.method || 'GET', credentials: base ? 'include' : 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
  if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  let r;
  try { r = await fetch(base + path, init); }
  catch { throw Object.assign(Error('Bağlantı yok. Geçiş sunucuda onaylanır; bağlantı gelince tekrar dene.'), { status: 0, offline: true }); }
  let json; try { json = await r.json(); } catch { json = null; }
  if (!r.ok) throw Object.assign(Error(json?.error || `Sunucu hatası (${r.status})`), { status: r.status });
  return json;
}
const errorText = e => e.status === 401 ? 'Oturumun kapandı. Yeniden giriş yap.' : e.status === 429 ? 'Çok fazla deneme. Bir dakika sonra tekrar dene.' : e.message;
const SIM = '<div class="notice sim" role="note"><b>SİMÜLASYON</b>Bu sürüm sanal turnike kaydı tutar; gerçek kapı, turnike veya röle açılmaz.</div>';

let user = null;
async function boot() {
  try {
    user = (await api('/api/me')).user;
    if (!user) { root.innerHTML = '<div class="wrap"><div class="notice info"><b>Giriş gerekli</b><a href="/" target="_top" class="btn primary">Giriş yap</a></div></div>'; return; }
    if (user.role === 'admin') return Admin.start();
    if (user.role === 'member') return Gate.start();
    root.innerHTML = '<div class="wrap"><div class="notice info">Bu ekran yalnızca yönetici ve üye hesapları içindir.</div></div>';
  } catch (e) {
    root.innerHTML = `<div class="wrap"><div class="notice bad" role="alert"><b>Ekran açılamadı</b>${esc(errorText(e))}</div><button class="btn" data-act="retry-boot">Tekrar dene</button></div>`;
  }
}

/* ---------- QR rendering (vendor qrcode.js, same encoder as the member entry QR) ---------- */
function qrSvg(text) {
  const qr = window.qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  const n = qr.getModuleCount(), q = 4; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Turnike QR kodu"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ---------- Admin ---------- */
const Admin = {
  data: null, error: '', timer: 0, busy: false,
  async start() { await this.load(); this.timer = setInterval(() => { if (!document.hidden) this.load(); }, 10000); },
  async load() {
    try { this.data = await api('/api/turnstiles'); this.error = ''; } catch (e) { this.error = errorText(e); }
    this.render();
  },
  render() {
    const d = this.data;
    if (!d) { root.innerHTML = `<div class="wrap">${this.error ? `<div class="notice bad" role="alert"><b>Turnikeler yüklenemedi</b>${esc(this.error)}</div><button class="btn" data-act="reload">Tekrar dene</button>` : '<p class="boot">Yükleniyor…</p>'}</div>`; return; }
    const ev = d.events.map(e => `<tr><td>${esc(time(e.at))}</td><td>${esc(e.member)}</td><td>${esc(e.turnstile || '—')}</td><td>${e.direction ? `<span class="dir-${e.direction}">${DIR[e.direction]}</span>` : '—'}</td><td>${e.result === 'ok' ? 'Onaylandı' : '<span class="rej">Reddedildi</span>'}</td><td class="reason">${esc(e.message || '')}</td></tr>`).join('');
    root.innerHTML = `<div class="wrap">
  <h1 class="no-print">Turnikeler</h1>
  ${SIM}
  <div class="notice info" role="note"><b>Güvenlik sınırı</b>Turnike QR kodları sabittir ve kopyalanabilir (fotoğraf, ekran görüntüsü). Kodun okutulması üyenin salonda olduğunu kanıtlamaz; yalnızca oturum açmış üyenin beyanını kaydeder. Kod sızarsa “QR kimliğini yenile” ile eskisini geçersiz kıl ve yenisini yazdır.</div>
  ${this.error ? `<div class="notice bad" role="alert">Son yenileme başarısız: ${esc(this.error)}</div>` : ''}
  <div class="stats"><div class="stat"><span class="muted small">İçerideki kişi</span><strong>${d.inside_count}</strong></div><div class="stat"><span class="muted small">Aktif turnike</span><strong>${d.turnstiles.filter(t => t.active).length}/${d.turnstiles.length}</strong></div><div class="stat"><span class="muted small">Tekrar okutma beklemesi</span><strong>${d.cooldown_seconds} sn</strong></div></div>
  <div class="row no-print" style="margin-bottom:14px"><button class="btn" data-act="print-all">Tüm QR kodlarını yazdır</button><button class="btn" data-act="reload">Yenile</button></div>
  <div class="grid">${d.turnstiles.map(t => `<section class="card gate-card${t.active ? '' : ' off'}" id="gate-${t.id}" aria-labelledby="gate-h-${t.id}">
    <div class="row" style="justify-content:space-between"><h2 id="gate-h-${t.id}">${esc(t.name)}</h2><span class="pill ${t.active ? 'on' : 'off'} print-hide">${t.active ? 'Aktif' : 'Pasif'}</span></div>
    <p class="muted small">Giriş ve çıkış · FORM CLUB uygulamasında “Turnike QR Tara” ile okut.</p>
    <div class="qr">${qrSvg(t.qr)}</div>
    <p class="code print-hide">${esc(t.qr)}<br>Kod yenilendi: ${esc(time(t.code_rotated_at))}</p>
    <div class="row no-print"><button class="btn" data-act="print" data-id="${t.id}">Yazdır</button><button class="btn" data-act="toggle" data-id="${t.id}" data-active="${t.active ? '0' : '1'}">${t.active ? 'Pasif yap' : 'Aktif yap'}</button><button class="btn danger" data-act="rotate" data-id="${t.id}">QR kimliğini yenile</button></div>
  </section>`).join('')}</div>
  <section class="card"><h2>İçeridekiler (${d.inside_count})</h2>${d.inside.length ? `<ul class="log">${d.inside.map(p => `<li><span>${esc(p.member)}</span><span class="muted small">${esc(p.turnstile || '')} · ${esc(time(p.since))}</span></li>`).join('')}</ul>` : '<p class="muted">Şu an içeride kimse yok.</p>'}</section>
  <section class="card"><h2>Son geçişler ve retler</h2>${ev ? `<div class="table-wrap"><table><thead><tr><th>Zaman</th><th>Üye</th><th>Turnike</th><th>Yön</th><th>Sonuç</th><th>Neden</th></tr></thead><tbody>${ev}</tbody></table></div>` : '<p class="muted">Henüz kayıt yok.</p>'}</section>
</div>`;
  },
  async act(t) {
    const id = t.dataset.id;
    if (t.dataset.act === 'print' || t.dataset.act === 'print-all') {
      document.body.classList.toggle('print-one', t.dataset.act === 'print');
      document.querySelectorAll('.gate-card').forEach(c => c.classList.toggle('print-target', c.id === 'gate-' + id));
      return window.print();
    }
    if (t.dataset.act === 'rotate' && !window.confirm('Bu turnikenin QR kodu yenilenecek. Basılı eski kod artık çalışmaz. Devam edilsin mi?')) return;
    t.disabled = true;
    try {
      if (t.dataset.act === 'rotate') await api(`/api/turnstiles/${id}/rotate`, { method: 'POST', body: {} });
      if (t.dataset.act === 'toggle') await api(`/api/turnstiles/${id}`, { method: 'PATCH', body: { active: t.dataset.active === '1' } });
    } catch (e) { this.error = errorText(e); }
    await this.load();
  }
};

/* ---------- Member gate scanner ---------- */
const Gate = {
  me: null, error: '', warning: null, cam: { active: false, starting: false, error: '', help: '' }, result: null, busy: false,
  last: '', lastAt: 0, pending: null, stream: null, detector: null, loop: 0, resume: 0, canvas: null,
  async start() { await this.load(); },
  async load() {
    try { this.me = await api('/api/turnstiles/me'); this.error = ''; } catch (e) { this.error = errorText(e); }
    this.render();
  },
  render() {
    const secure = window.isSecureContext, supported = !!navigator.mediaDevices?.getUserMedia;
    const online = navigator.onLine !== false, m = this.me, c = this.cam, r = this.result;
    let placeholder;
    if (!secure) placeholder = '<b>Kamera için HTTPS gerekli.</b><br>Telefon tarayıcıları kamerayı yalnızca https:// adreslerinde açar.';
    else if (!supported) placeholder = '<b>Bu cihaz veya tarayıcı kamera erişimini desteklemiyor.</b><br>Güncel Chrome (Android) ya da Safari (iPhone) ile dene veya resepsiyona başvur.';
    else placeholder = `Turnikenin üzerindeki QR kodu çerçeveye getir.<br><button class="btn primary" data-act="cam-start" style="margin-top:12px" ${c.starting ? 'disabled' : ''}>${c.starting ? 'Kamera açılıyor…' : c.error ? 'Tekrar dene' : 'Kamerayı aç'}</button>`;
    const html = `<div class="wrap">
  ${SIM}
  ${this.error ? `<div class="notice bad" role="alert"><b>Durum alınamadı</b>${esc(this.error)}</div>` : ''}
  ${online ? '' : '<div class="notice bad" role="alert"><b>Bağlantı yok</b>Geçiş sunucuda onaylanır. İnternet gelince tekrar okut.</div>'}
  ${this.warning ? `<div class="notice bad" role="alert"><b>Dolabın hâlâ sende</b>${esc(this.warning.message)}<div class="row" style="margin-top:8px"><a class="btn" href="/#locker" target="_top">Dolabım</a><button class="btn" data-act="warn-ok">Anladım</button></div></div>` : m?.inside && m?.locker ? `<div class="notice info" role="note"><b>${esc(m.locker.label)} sende</b>Çıkmadan önce “Dolabım” ekranından dolabı bırakmayı unutma. Çıkışın engellenmez.</div>` : ''}
  <section class="card"><div class="presence"><span class="dot ${m?.inside ? 'in' : ''}" aria-hidden="true"></span>${m ? (m.inside ? 'Şu an salondasın' : 'Şu an dışarıdasın') : 'Durum bilinmiyor'}</div>
    <p class="muted small" style="margin:6px 0 0">${m?.inside ? 'Herhangi bir turnikeyi okutunca ÇIKIŞ kaydedilir.' : 'Herhangi bir turnikeyi okutunca GİRİŞ kaydedilir.'} Ders rezervasyonun veya ders hakkın etkilenmez.</p></section>
  <section class="card"><div class="scanner" id="scanner">${c.active ? '<video id="gate-video" playsinline muted autoplay aria-label="Kamera görüntüsü"></video><div class="reticle" aria-hidden="true"></div>' : `<div class="placeholder">${placeholder}</div>`}
    ${r ? `<div class="result ${r.ok ? 'ok' : 'bad'}" role="${r.ok ? 'status' : 'alert'}">${esc(r.title)}<div class="small" style="font-weight:600">${esc(r.detail)}</div></div>` : ''}</div>
    ${c.error ? `<div class="notice bad" role="alert" style="margin-top:12px"><b>${esc(c.error)}</b>${esc(c.help)}</div>` : ''}
    ${this.pending ? `<div class="notice bad" role="alert" style="margin-top:12px"><b>Geçiş gönderilemedi</b>Aynı okutma tekrar gönderilir; çift kayıt oluşmaz.<div class="row" style="margin-top:8px"><button class="btn" data-act="resend">Tekrar gönder</button><button class="btn" data-act="discard">Vazgeç</button></div></div>` : ''}
    <div class="row" style="margin-top:12px">${c.active ? '<button class="btn" data-act="cam-stop">Kamerayı kapat</button>' : ''}</div></section>
  <section class="card"><h2>Geçiş geçmişim</h2>${m?.events?.length ? `<ul class="log">${m.events.map(e => `<li><span>${e.result === 'ok' ? `<span class="dir-${e.direction}">${DIR[e.direction]}</span> · ${esc(e.turnstile)}` : `<span class="rej">Reddedildi</span> · ${esc(e.message || '')}`}</span><span class="muted small">${esc(time(e.at))}</span></li>`).join('')}</ul>` : '<p class="muted">Henüz geçiş yok.</p>'}</section>
</div>`;
    const video = $('gate-video');
    root.innerHTML = html;
    if (c.active) { const v = $('gate-video'); if (video && v) v.replaceWith(video); this.attach(); }
  },
  async startCamera() {
    Object.assign(this.cam, { error: '', help: '', starting: true }); this.render();
    try {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
      catch (e) { if (e?.name === 'OverconstrainedError') this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); else throw e; }
    } catch (e) { [this.cam.error, this.cam.help] = cameraError(e); this.cam.starting = false; return this.render(); }
    this.detector = null;
    try { if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) this.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch {}
    if (!this.detector && !window.jsQR) {
      try { await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/v9/vendor/jsQR.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
      catch { this.stopCamera(); Object.assign(this.cam, { error: 'QR çözücü yüklenemedi.', help: 'Bağlantını kontrol edip tekrar dene.' }); return this.render(); }
    }
    Object.assign(this.cam, { starting: false, active: true });
    this.render();
  },
  attach() {
    const v = $('gate-video'); if (!v || !this.stream) return;
    if (v.srcObject !== this.stream) { v.srcObject = this.stream; v.play().catch(() => {}); }
    clearTimeout(this.loop); this.loop = setTimeout(() => this.frame(), 300);
  },
  async frame() {
    const v = $('gate-video'); if (!this.cam.active || !v || document.hidden) return;
    if (!this.busy && v.readyState >= 2) {
      let text = '';
      try {
        if (this.detector) text = (await this.detector.detect(v))[0]?.rawValue || '';
        else if (window.jsQR) {
          const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
          const cv = this.canvas = this.canvas || document.createElement('canvas'); cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, w, h);
          text = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data || '';
        }
      } catch {}
      if (text) await this.scanned(text);
    }
    this.loop = setTimeout(() => this.frame(), 200);
  },
  stopCamera() { clearTimeout(this.loop); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.cam.active = false; },
  async scanned(raw) {
    const code = String(raw).trim(), now = Date.now();
    // The camera sees the same code many times per second; one read per code every 5 s.
    if (code === this.last && now - this.lastAt < 5000) return;
    this.last = code; this.lastAt = now;
    if (!code.startsWith(PREFIX)) return this.show(false, 'Tanınmayan kod', 'Bu bir FORM CLUB turnike QR kodu değil.');
    if (navigator.onLine === false) return this.show(false, 'Bağlantı yok', 'Geçiş sunucuda onaylanır. İnternet gelince tekrar okut.');
    this.pending = { code, key: crypto.randomUUID() };
    return this.send();
  },
  async send() {
    if (!this.pending) return;
    this.busy = true;
    try {
      const r = await api('/api/turnstiles/scan', { method: 'POST', body: { code: this.pending.code, idempotency_key: this.pending.key } });
      this.pending = null;
      if (r.locker_warning) this.warning = r.locker_warning;
      if (r.ok) this.show(true, `${DIR[r.direction].toUpperCase()} kaydedildi`, `${r.turnstile} · ${new Date(r.at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })} · simülasyon`);
      else this.show(false, 'Geçiş reddedildi', r.message);
      if (r.ok) this.stopCamera();
      this.load();
    } catch (e) {
      // Network failure: keep the same idempotency key so a resend can never create a second pass.
      if (!e.offline) this.pending = null;
      this.show(false, e.offline ? 'Bağlantı yok' : 'Geçiş yapılamadı', errorText(e));
    }
  },
  show(ok, title, detail) {
    this.busy = true; this.result = { ok, title, detail };
    try { navigator.vibrate?.(ok ? 80 : [60, 60, 60]); } catch {}
    this.render();
    clearTimeout(this.resume);
    this.resume = setTimeout(() => { this.busy = false; this.result = null; this.render(); }, ok ? 4000 : 3500);
  }
};
function cameraError(e) {
  const n = e?.name || '';
  const steps = /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone: Ayarlar › Safari › Kamera › İzin Ver, sonra “Tekrar dene”.' : 'Adres çubuğundaki kilit simgesi › İzinler › Kamera › İzin ver, sonra “Tekrar dene”.';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return ['Kamera izni verilmedi.', ' ' + steps];
  if (n === 'NotFoundError') return ['Bu cihazda kamera bulunamadı.', ' Resepsiyona başvur.'];
  if (n === 'NotReadableError') return ['Kamera başka bir uygulama tarafından kullanılıyor.', ' O uygulamayı kapatıp tekrar dene.'];
  if (n === 'SecurityError') return ['Kamera bu sayfada engellendi.', ' Sayfayı HTTPS adresinden aç.'];
  return ['Kamera açılamadı.', ' ' + (e?.message || n)];
}

root.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t || t.disabled) return;
  const a = t.dataset.act;
  if (a === 'retry-boot') return boot();
  if (a === 'reload') return Admin.load();
  if (['print', 'print-all', 'toggle', 'rotate'].includes(a)) return Admin.act(t);
  if (a === 'cam-start') return Gate.startCamera();
  if (a === 'cam-stop') { Gate.stopCamera(); return Gate.render(); }
  if (a === 'resend') return Gate.send();
  if (a === 'discard') { Gate.pending = null; return Gate.render(); }
  if (a === 'warn-ok') { Gate.warning = null; return Gate.render(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && Gate.cam.active) { Gate.stopCamera(); Gate.render(); } });
window.addEventListener('online', () => user?.role === 'member' ? Gate.render() : user && Admin.load());
window.addEventListener('offline', () => user?.role === 'member' && Gate.render());
boot();
})();
