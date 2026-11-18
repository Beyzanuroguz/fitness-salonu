/* FORM CLUB virtual lockers V1 (SIMULATION ONLY).
   Admin (#lockers): counts, locker cards with printable QR, assign, manual release, maintenance/passive, QR rotate, alerts, full log.
   Member (#lockerScan): scan a locker QR after a successful turnstile entry. Member (#locker): own locker, time, release. */
(() => {
'use strict';
const root = document.getElementById('locker-root');
const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const time = ms => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const clock = ms => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const PREFIX = 'FORMCLUB-LOCKER:1:', GATE_PREFIX = 'FORMCLUB-GATE:1:';
const SIM = '<div class="notice sim" role="note"><b>SİMÜLASYON</b>Bu sürüm sanal dolap kaydı tutar; gerçek kilit açılmaz. Dolap QR kodu kişisel veri veya kilit açma yetkisi taşımaz.</div>';
const key = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

async function api(path, options = {}) {
  const base = String(globalThis.FORMCLUB_CONFIG?.apiBase || '').replace(/\/+$/, '');
  const init = { method: options.method || 'GET', credentials: base ? 'include' : 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
  if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  let r;
  try { r = await fetch(base + path, init); }
  catch { throw Object.assign(Error('Bağlantı yok. Dolap işlemleri sunucuda onaylanır; bağlantı gelince tekrar dene.'), { status: 0, offline: true }); }
  let json; try { json = await r.json(); } catch { json = null; }
  if (!r.ok) throw Object.assign(Error(json?.error || `Sunucu hatası (${r.status})`), { status: r.status });
  return json;
}
const errorText = e => e.status === 401 ? 'Oturumun kapandı. Yeniden giriş yap.' : e.status === 429 ? 'Çok fazla deneme. Bir dakika sonra tekrar dene.' : e.message;
const top = hash => `<a class="btn" href="/#${hash}" target="_top">`;

let user = null;
async function boot() {
  try {
    user = (await api('/api/me')).user;
    if (!user) { root.innerHTML = '<div class="wrap"><div class="notice info"><b>Giriş gerekli</b><a href="/" target="_top" class="btn primary">Giriş yap</a></div></div>'; return; }
    if (user.role === 'admin') return Admin.start();
    if (user.role === 'member') return Member.start(location.hash === '#locker' ? 'mine' : 'scan');
    root.innerHTML = '<div class="wrap"><div class="notice info">Bu ekran yalnızca yönetici ve üye hesapları içindir.</div></div>';
  } catch (e) {
    root.innerHTML = `<div class="wrap"><div class="notice bad" role="alert"><b>Ekran açılamadı</b>${esc(errorText(e))}</div><button class="btn" data-act="retry-boot">Tekrar dene</button></div>`;
  }
}

function qrSvg(text) {
  const qr = window.qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  const n = qr.getModuleCount(), q = 4; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dolap QR kodu"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ---------- Admin ---------- */
const FORMS = {
  assign: ['Üye ata', 'Ata'], release: ['Dolabı manuel boşalt', 'Boşalt'], maintenance: ['Bakıma al', 'Bakıma al'],
  inactive: ['Pasif yap', 'Pasif yap'], available: ['Kullanıma aç', 'Kullanıma aç'], rotate: ['QR kimliğini yenile', 'Yenile'], resolve: ['Uyarıyı kapat', 'Kapat']
};
const Admin = {
  data: null, error: '', notice: '', form: null, filter: 'all', timer: 0, addKey: null,
  async start() { await this.load(); this.timer = setInterval(() => { if (!document.hidden && !this.form) this.load(); }, 15000); },
  async load() {
    try { this.data = await api('/api/lockers'); this.error = ''; } catch (e) { this.error = errorText(e); }
    this.render();
  },
  formHtml() {
    const f = this.form; if (!f) return '';
    const d = this.data, l = d.lockers.find(x => x.id === f.id), a = d.alerts.find(x => x.id === f.id);
    const [title, ok] = FORMS[f.kind];
    const subject = f.kind === 'resolve' ? `${esc(a?.member)} · ${esc(a?.locker)}` : esc(l?.label);
    const members = f.kind === 'assign' ? `<label for="lf-member">Üye</label><select id="lf-member"><option value="">Üye seçin</option>${d.members.map(m => `<option value="${m.id}"${f.member === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '';
    const reasonLabel = f.kind === 'resolve' ? 'Not (isteğe bağlı)' : 'Sebep (zorunlu, kayda geçer)';
    return `<section class="card form-card" id="locker-form" aria-labelledby="lf-h"><h2 id="lf-h">${title}: ${subject}</h2>
      ${f.kind === 'release' ? `<p class="muted small">${esc(l?.assignment?.member)} kullanıcısının tahsisi sonlandırılır. Fiziksel kilit açılmaz.</p>` : ''}
      ${f.kind === 'rotate' ? '<p class="muted small">Eski basılı QR artık çalışmaz; yenisini yazdırın. Mevcut tahsis korunur.</p>' : ''}
      ${members}<label for="lf-reason">${reasonLabel}</label><textarea id="lf-reason" maxlength="300">${esc(f.reason || '')}</textarea>
      ${f.error ? `<div class="notice bad" role="alert" style="margin-top:10px">${esc(f.error)}</div>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="form-ok" ${f.busy ? 'disabled' : ''}>${f.busy ? 'Kaydediliyor…' : ok}</button><button class="btn" data-act="form-cancel">Vazgeç</button></div></section>`;
  },
  render() {
    const d = this.data, f = this.form;
    // Keep unsaved form input across background refreshes.
    if (f) { const r = document.getElementById('lf-reason'), m = document.getElementById('lf-member'); if (r) f.reason = r.value; if (m) f.member = Number(m.value || 0); }
    if (!d) { root.innerHTML = `<div class="wrap">${this.error ? `<div class="notice bad" role="alert"><b>Dolaplar yüklenemedi</b>${esc(this.error)}</div><button class="btn" data-act="reload">Tekrar dene</button>` : '<p class="boot">Yükleniyor…</p>'}</div>`; return; }
    const c = d.counts, list = d.lockers.filter(l => this.filter === 'all' || l.state === this.filter);
    const stat = (k, label) => `<div class="stat s-${k}"><span class="muted small">${label}</span><strong>${c[k]}</strong></div>`;
    const filt = (k, label) => `<button class="btn" data-act="filter" data-f="${k}" aria-pressed="${this.filter === k}">${label}</button>`;
    const card = l => {
      const act = (kind, text, cls = '') => `<button class="btn ${cls}" data-act="form" data-kind="${kind}" data-id="${l.id}">${text}</button>`;
      const actions = [
        `<button class="btn" data-act="print" data-id="${l.id}">Yazdır</button>`,
        l.state === 'available' ? act('assign', 'Üye ata') : '',
        l.state === 'occupied' ? act('release', 'Manuel boşalt', 'danger') : '',
        l.state === 'available' ? act('maintenance', 'Bakıma al') : '',
        l.state === 'available' ? act('inactive', 'Pasif yap') : '',
        l.state === 'maintenance' || l.state === 'inactive' ? act('available', 'Kullanıma aç') : '',
        act('rotate', 'QR yenile', 'danger')
      ].join('');
      return `<section class="card gate-card locker-card st-${l.state}" id="gate-${l.id}" aria-labelledby="lk-h-${l.id}">
        <div class="row" style="justify-content:space-between"><h2 id="lk-h-${l.id}">${esc(l.label)}</h2><span><span class="pill st-${l.state}">${esc(l.state_label)}</span>${l.alert ? '<span class="pill alert">Uyarı</span>' : ''}</span></div>
        <div class="qr">${qrSvg(l.qr)}</div>
        <p class="muted small who print-hide">${l.assignment ? `<b>${esc(l.assignment.member)}</b><br>${esc(time(l.assignment.since))} · ${l.assignment.source === 'admin' ? 'yönetici atadı' : 'üye aldı'}` : 'Atanmış üye yok'}</p>
        <p class="code print-hide">Kod yenilendi: ${esc(time(l.code_rotated_at))}</p>
        <div class="row no-print">${actions}</div></section>`;
    };
    const ev = d.events.map(e => `<tr><td>${esc(time(e.at))}</td><td>${esc(e.locker || '—')}</td><td>${esc(e.member || '—')}</td><td>${esc(e.action_label)}${e.detail ? ` <span class="muted small">(${esc(e.detail)})</span>` : ''}</td><td>${e.result === 'ok' ? 'Tamam' : '<span class="rej">Reddedildi</span>'}</td><td>${esc(e.actor || '')} <span class="muted small">${e.actor_role === 'admin' ? 'yönetici' : 'üye'}</span></td><td class="reason">${esc(e.message || e.note || '')}</td></tr>`).join('');
    root.innerHTML = `<div class="wrap">
  <h1 class="no-print">Dolap Yönetimi</h1>
  ${SIM}
  ${d.ephemeral ? '<div class="notice info" role="note"><b>Demo ortamı</b>Sunucu yeniden başlayınca (uyku, yeniden dağıtım) dolap QR kimlikleri, tahsisler ve tüm dolap kayıtları sıfırlanır. Basılı demo kodlarını her oturumda bu ekrandan yeniden yazdırın.</div>' : ''}
  <div class="notice info" role="note"><b>Güvenlik sınırı</b>Dolap kodu sabittir ve kopyalanabilir. Üye yalnızca turnikeden giriş yaptıktan sonra dolap alabilir; aynı anda bir üyeye bir dolap, bir dolaba bir üye düşer. Kod sızarsa “QR yenile” ile eskisini geçersiz kılın.</div>
  ${this.error ? `<div class="notice bad" role="alert">Son işlem başarısız: ${esc(this.error)}</div>` : ''}
  ${this.notice ? `<div class="notice ok" role="status">${esc(this.notice)}</div>` : ''}
  <div class="stats no-print">${stat('available', 'Boş')}${stat('occupied', 'Dolu')}${stat('maintenance', 'Bakımda')}${stat('inactive', 'Pasif')}<div class="stat"><span class="muted small">Açık uyarı</span><strong>${d.alerts.length}</strong></div></div>
  ${this.formHtml()}
  ${d.alerts.length ? `<section class="card" aria-labelledby="al-h"><h2 id="al-h">Uyarılar: dolapla çıkış</h2><ul class="log">${d.alerts.map(a => `<li><span>${esc(a.message)}<br><span class="muted small">${esc(time(a.at))} · şu an ${a.inside ? 'içeride' : 'dışarıda'}</span></span><button class="btn" data-act="form" data-kind="resolve" data-id="${a.id}">Uyarıyı kapat</button></li>`).join('')}</ul></section>` : ''}
  <div class="row no-print" style="margin-bottom:12px"><button class="btn primary" data-act="add">Dolap ekle</button><button class="btn" data-act="print-all">Tüm QR kodlarını yazdır</button><button class="btn" data-act="reload">Yenile</button></div>
  <div class="filters no-print" role="group" aria-label="Dolap filtresi">${filt('all', 'Tümü')}${filt('available', 'Boş')}${filt('occupied', 'Dolu')}${filt('maintenance', 'Bakımda')}${filt('inactive', 'Pasif')}</div>
  <div class="grid locker-grid">${list.map(card).join('') || '<p class="muted">Bu filtrede dolap yok.</p>'}</div>
  <section class="card"><h2>Dolap işlem kayıtları</h2>${ev ? `<div class="table-wrap"><table><thead><tr><th>Zaman</th><th>Dolap</th><th>Üye</th><th>İşlem</th><th>Sonuç</th><th>Aktör</th><th>Sebep / not</th></tr></thead><tbody>${ev}</tbody></table></div>` : '<p class="muted">Henüz kayıt yok.</p>'}</section>
</div>`;
  },
  async act(t) {
    const a = t.dataset.act, id = Number(t.dataset.id);
    if (a === 'print' || a === 'print-all') {
      document.body.classList.toggle('print-one', a === 'print');
      document.querySelectorAll('.gate-card').forEach(c => c.classList.toggle('print-target', c.id === 'gate-' + id));
      return window.print();
    }
    if (a === 'filter') { this.filter = t.dataset.f; return this.render(); }
    if (a === 'form') { this.form = { kind: t.dataset.kind, id, key: key(), assignment: this.data.lockers.find(l => l.id === id)?.assignment?.id }; this.notice = ''; this.render(); document.getElementById('locker-form')?.scrollIntoView?.({ block: 'start' }); return; }
    if (a === 'form-cancel') { this.form = null; return this.render(); }
    if (a === 'add') {
      t.disabled = true;
      // Same key until the outcome is known, so a retry after a lost response cannot add a second locker.
      this.addKey = this.addKey || key();
      try { const r = await api('/api/lockers', { method: 'POST', body: { idempotency_key: this.addKey } }); this.addKey = null; this.notice = r.replayed ? 'Dolap eklendi.' : `${r.locker.label} eklendi. QR kodunu yazdırabilirsiniz.`; this.error = ''; }
      catch (e) { if (!e.offline) this.addKey = null; this.error = errorText(e); }
      return this.load();
    }
    if (a === 'form-ok') return this.submit();
  },
  async submit() {
    const f = this.form, reason = document.getElementById('lf-reason')?.value.trim() || '';
    const member = Number(document.getElementById('lf-member')?.value || 0);
    f.reason = reason; f.member = member;
    if (f.kind === 'assign' && !member) { f.error = 'Üye seçin.'; return this.render(); }
    if (f.kind !== 'resolve' && reason.length < 3) { f.error = 'Sebep en az 3 karakter olmalı.'; return this.render(); }
    f.busy = true; f.error = ''; this.render();
    const body = { idempotency_key: f.key, reason };
    const call = {
      assign: () => api(`/api/lockers/${f.id}/assign`, { method: 'POST', body: { ...body, member_id: member } }),
      release: () => api(`/api/lockers/${f.id}/release`, { method: 'POST', body: { ...body, assignment_id: f.assignment } }),
      rotate: () => api(`/api/lockers/${f.id}/rotate`, { method: 'POST', body }),
      resolve: () => api(`/api/lockers/alerts/${f.id}/resolve`, { method: 'POST', body: { idempotency_key: f.key, note: reason } })
    }[f.kind] || (() => api(`/api/lockers/${f.id}`, { method: 'PATCH', body: { ...body, status: f.kind } }));
    try {
      await call();
      this.notice = FORMS[f.kind][0] + ': kaydedildi.'; this.form = null; this.error = '';
    } catch (e) {
      f.busy = false; f.error = errorText(e);
      // Keep the same idempotency key only for network drops so a resend cannot apply twice.
      if (!e.offline) f.key = key();
      return this.render();
    }
    return this.load();
  }
};

/* ---------- Member ---------- */
const Member = {
  view: 'scan', me: null, error: '', result: null, pending: null, resume: 0, releasing: null, cam: null,
  async start(view) {
    this.view = view;
    this.cam = window.FormclubQrCamera.create({ videoId: 'locker-video', onCode: code => this.scanned(code), onChange: () => this.render() });
    await this.load();
  },
  async load() {
    try { this.me = await api('/api/lockers/me'); this.error = ''; } catch (e) { this.error = errorText(e); }
    this.render();
  },
  statusCard() {
    const m = this.me;
    if (!m) return '';
    const presence = `<div class="presence"><span class="dot ${m.inside ? 'in' : ''}" aria-hidden="true"></span>${m.inside ? 'Şu an salondasın' : 'Şu an dışarıdasın'}</div>`;
    const hint = m.locker ? `Dolabın: <b>${esc(m.locker.label)}</b> · ${esc(clock(m.locker.since))} itibarıyla.` : m.inside ? 'Boş bir dolabın QR kodunu okutarak dolabı alabilirsin.' : 'Dolap almak için önce turnikeden giriş yap (Turnike QR Tara).';
    return `<section class="card">${presence}<p class="muted small" style="margin:6px 0 0">${hint}</p></section>`;
  },
  alert() { return this.me?.alert ? `<div class="notice warn" role="alert"><b>Dolabın hâlâ sende</b>${esc(this.me.alert.message)}</div>` : ''; },
  render() {
    if (this.view === 'mine') return this.renderMine();
    const m = this.me, cam = this.cam, r = this.result, online = navigator.onLine !== false;
    const video = document.getElementById('locker-video');
    root.innerHTML = `<div class="wrap">
  ${SIM}
  ${this.error ? `<div class="notice bad" role="alert"><b>Durum alınamadı</b>${esc(this.error)}</div>` : ''}
  ${online ? '' : '<div class="notice bad" role="alert"><b>Bağlantı yok</b>Dolap işlemi sunucuda onaylanır. İnternet gelince tekrar okut.</div>'}
  ${this.alert()}
  ${this.statusCard()}
  ${m && !m.inside ? `<div class="notice info" role="note"><b>Önce turnike girişi</b>Dolap yalnızca başarılı turnike girişinden sonra alınabilir.<div class="row" style="margin-top:8px">${top('gate')}Turnike QR Tara</a></div></div>` : ''}
  <section class="card"><h2>Dolap QR Tara</h2><div class="scanner" id="scanner">${cam.view('Dolabın üzerindeki QR kodu çerçeveye getir.')}
    ${r ? `<div class="result ${r.ok ? 'ok' : 'bad'}" role="${r.ok ? 'status' : 'alert'}">${esc(r.title)}<div class="small" style="font-weight:600">${esc(r.detail)}</div></div>` : ''}</div>
    ${cam.error ? `<div class="notice bad" role="alert" style="margin-top:12px"><b>${esc(cam.error)}</b>${esc(cam.help)}</div>` : ''}
    ${this.pending ? `<div class="notice bad" role="alert" style="margin-top:12px"><b>İstek gönderilemedi</b>Aynı okutma tekrar gönderilir; çift kayıt oluşmaz.<div class="row" style="margin-top:8px"><button class="btn" data-act="resend">Tekrar gönder</button><button class="btn" data-act="discard">Vazgeç</button></div></div>` : ''}
    <div class="row" style="margin-top:12px">${cam.active ? '<button class="btn" data-act="cam-stop">Kamerayı kapat</button>' : ''}${m?.locker ? `${top('locker')}Dolabım</a>` : ''}</div></section>
</div>`;
    if (cam.active) { const v = document.getElementById('locker-video'); if (video && v) v.replaceWith(video); cam.attach(); }
  },
  renderMine() {
    const m = this.me, rel = this.releasing;
    const own = m?.events?.length ? `<ul class="log">${m.events.map(e => `<li><span>${e.result === 'ok' ? `${esc(e.action_label)} · ${esc(e.locker || '')}` : `<span class="rej">Reddedildi</span> · ${esc(e.message || '')}`}</span><span class="muted small">${esc(time(e.at))}</span></li>`).join('')}</ul>` : '<p class="muted">Henüz dolap işlemi yok.</p>';
    root.innerHTML = `<div class="wrap">
  ${SIM}
  ${this.error ? `<div class="notice bad" role="alert"><b>Durum alınamadı</b>${esc(this.error)}</div>` : ''}
  ${this.result ? `<div class="notice ${this.result.ok ? 'ok' : 'bad'}" role="${this.result.ok ? 'status' : 'alert'}"><b>${esc(this.result.title)}</b>${esc(this.result.detail)}</div>` : ''}
  ${this.alert()}
  <section class="card" aria-labelledby="mine-h"><h2 id="mine-h">Dolabım</h2>
  ${m?.locker ? `<div class="big">${esc(m.locker.label)}</div><p class="muted">Tahsis saati: <b>${esc(time(m.locker.since))}</b>${m.locker.source === 'admin' ? ' · resepsiyon atadı' : ''}</p>
    ${rel ? `<div class="notice warn" role="alert"><b>${esc(m.locker.label)} bırakılsın mı?</b>Eşyalarını aldığından emin ol. Bıraktıktan sonra dolap başka üyeye verilebilir.<div class="row" style="margin-top:8px"><button class="btn danger" data-act="release-ok" ${rel.busy ? 'disabled' : ''}>${rel.busy ? 'Bırakılıyor…' : 'Evet, bırak'}</button><button class="btn" data-act="release-cancel">Vazgeç</button></div></div>`
      : '<button class="btn danger" data-act="release">Dolabı bırak</button>'}`
    : `<p class="muted">Şu an sana ayrılmış bir dolap yok.</p><div class="row">${top('lockerScan')}Dolap QR Tara</a></div>`}
  </section>
  ${this.statusCard()}
  <section class="card"><h2>Dolap geçmişim</h2>${own}</section>
</div>`;
  },
  async scanned(code) {
    if (this.pending) return; // an unsent claim waits for resend or discard
    if (code.startsWith(GATE_PREFIX)) return this.show(false, 'Turnike kodu okundu', 'Turnike için “Turnike QR Tara” ekranını kullan.');
    if (!code.startsWith(PREFIX)) return this.show(false, 'Tanınmayan kod', 'Bu bir FORM CLUB dolap QR kodu değil.');
    if (navigator.onLine === false) return this.show(false, 'Bağlantı yok', 'Dolap işlemi sunucuda onaylanır. İnternet gelince tekrar okut.');
    this.pending = { code, key: key() };
    return this.send();
  },
  async send() {
    if (!this.pending) return;
    this.cam.busy = true;
    try {
      const r = await api('/api/lockers/claim', { method: 'POST', body: { code: this.pending.code, idempotency_key: this.pending.key } });
      this.pending = null;
      if (r.ok) { this.show(true, `${r.locker} senin`, `Tahsis saati ${clock(r.at)} · simülasyon, kilit açılmaz`); this.cam.stop(); }
      else this.show(false, 'Dolap alınamadı', r.message);
      this.load();
    } catch (e) {
      // Network failure: keep the same idempotency key so a resend can never create a second claim.
      if (!e.offline) this.pending = null;
      this.show(false, e.offline ? 'Bağlantı yok' : 'Dolap alınamadı', errorText(e));
    }
  },
  show(ok, title, detail) {
    this.cam.busy = true; this.result = { ok, title, detail };
    try { navigator.vibrate?.(ok ? 80 : [60, 60, 60]); } catch {}
    this.render();
    clearTimeout(this.resume);
    this.resume = setTimeout(() => { this.cam.busy = !!this.pending; this.result = null; this.render(); }, ok ? 5000 : 4000);
  },
  async release() {
    const rel = this.releasing; rel.busy = true; this.render();
    try {
      const r = await api('/api/lockers/me/release', { method: 'POST', body: { idempotency_key: rel.key, confirm: true, assignment_id: rel.assignment } });
      this.releasing = null;
      this.result = r.ok ? { ok: true, title: `${r.locker} bırakıldı`, detail: 'Dolap artık boş.' } : { ok: false, title: 'Bırakılamadı', detail: r.message };
    } catch (e) {
      rel.busy = false; if (!e.offline) rel.key = key();
      this.result = { ok: false, title: 'Bırakılamadı', detail: errorText(e) };
    }
    await this.load();
  }
};

root.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t || t.disabled) return;
  const a = t.dataset.act;
  if (a === 'retry-boot') return boot();
  if (a === 'reload') { Admin.notice = ''; return Admin.load(); }
  if (['print', 'print-all', 'filter', 'form', 'form-cancel', 'form-ok', 'add'].includes(a)) return Admin.act(t);
  if (a === 'cam-start') return Member.cam.start();
  if (a === 'cam-stop') { Member.cam.stop(); return Member.render(); }
  if (a === 'resend') return Member.send();
  if (a === 'discard') { Member.pending = null; Member.cam.busy = false; return Member.render(); }
  if (a === 'release') { Member.releasing = { key: key(), assignment: Member.me?.locker?.assignment_id }; Member.result = null; return Member.render(); }
  if (a === 'release-cancel') { Member.releasing = null; return Member.render(); }
  if (a === 'release-ok') return Member.release();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && Member.cam?.active) { Member.cam.stop(); Member.render(); } });
window.addEventListener('online', () => user?.role === 'member' ? Member.render() : user && Admin.load());
window.addEventListener('offline', () => user?.role === 'member' && Member.render());
boot();
})();
