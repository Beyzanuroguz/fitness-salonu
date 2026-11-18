/* FORM CLUB virtual lockers V1 (SIMULATION ONLY).
   Admin (#lockers): counts, locker cards with printable QR, assign, manual release, maintenance/passive, QR rotate, alerts, full log.
   Member (#lockerScan): scan a locker QR after a successful turnstile entry. Member (#locker): own locker, time, release. */
(() => {
'use strict';
const root = document.getElementById('locker-root');
const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const time = ms => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const clock = ms => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const ROLE = { admin: 'Yönetici', teacher: 'Eğitmen', member: 'Üye' };
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
    const hash = location.hash;
    if (user.role === 'admin' && hash !== '#locker' && hash !== '#lockerScan') return Admin.start();
    if (ROLE[user.role]) return Personal.start(hash === '#locker' ? 'mine' : 'scan');
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
  assign: ['Kullanıcı ata', 'Ata'], release: ['Dolabı manuel boşalt', 'Boşalt'], maintenance: ['Bakıma al', 'Bakıma al'],
  inactive: ['Pasif yap', 'Pasif yap'], available: ['Kullanıma aç', 'Kullanıma aç'], rotate: ['QR kimliğini yenile', 'Yenile'], resolve: ['Uyarıyı kapat', 'Kapat']
};
// Per state: the one action shown on the card, and everything in its "more" menu.
const MAIN = { available: 'assign', occupied: 'release', maintenance: 'available', inactive: 'available' };
const MENU = { available: ['assign', 'maintenance', 'inactive'], occupied: ['release'], maintenance: ['available', 'inactive'], inactive: ['available', 'maintenance'] };
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  print: svg('<path d="M7 9V3h10v6"/><path d="M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  rotate: svg('<path d="M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4z"/><path d="M20 15.5a4.5 4.5 0 1 1-1.3-3.2"/><path d="M20 11.5v3h-3"/>'),
  more: svg('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>')
};
const iconBtn = (act, icon, label, title, attrs = '', cls = '') => `<button type="button" class="icon-btn${cls}" data-act="${act}" ${attrs} aria-label="${esc(label)}" title="${esc(title)}">${icon}</button>`;
// "Dolap 1" is shown as "Dolap 01" on cards; stored names and logs stay unchanged.
const cardName = label => label.replace(/^Dolap (\d)$/, 'Dolap 0$1');
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
    const options = [
      ...d.members.map(m => ({ value: String(m.id), label: m.name })),
      ...(d.staff || []).map(u => ({ value: 'staff-' + u.id, label: u.name + ' · ' + ROLE[u.role] }))
    ];
    const members = f.kind === 'assign' ? `<label for="lf-member">Kullanıcı</label><select id="lf-member"><option value="">Kullanıcı seçin</option>${options.map(u => `<option value="${u.value}"${f.member === u.value ? ' selected' : ''}>${esc(u.label)}</option>`).join('')}</select>` : '';
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
    if (f) { const r = document.getElementById('lf-reason'), m = document.getElementById('lf-member'); if (r) f.reason = r.value; if (m) f.member = m.value; }
    if (!d) { root.innerHTML = `<div class="wrap">${this.error ? `<div class="notice bad" role="alert"><b>Dolaplar yüklenemedi</b>${esc(this.error)}</div><button class="btn" data-act="reload">Tekrar dene</button>` : '<p class="boot">Yükleniyor…</p>'}</div>`; return; }
    const c = d.counts, list = d.lockers.filter(l => this.filter === 'all' || l.state === this.filter);
    const stat = (k, label, n = c[k]) => `<div class="lk-stat s-${k}"><span>${label}</span><strong>${n}</strong></div>`;
    const opt = (k, label, n) => `<option value="${k}"${this.filter === k ? ' selected' : ''}>${label} (${n})</option>`;
    const card = l => {
      const name = esc(l.label), menu = MENU[l.state].map(k => `<button type="button" class="lk-menu-item${k === 'release' ? ' danger' : ''}" data-act="form" data-kind="${k}" data-id="${l.id}">${FORMS[k][0]}</button>`).join('');
      const main = MAIN[l.state];
      return `<section class="card gate-card locker-card st-${l.state}" id="gate-${l.id}" aria-labelledby="lk-h-${l.id}">
        <header class="lk-card-head"><div class="lk-title"><h2 id="lk-h-${l.id}">${esc(cardName(l.label))}</h2><span class="pill st-${l.state}">${esc(l.state_label)}</span>${l.alert ? '<span class="pill alert">Uyarı</span>' : ''}</div>
          <div class="lk-icons no-print">${iconBtn('print', ICON.print, `${name} QR kodunu yazdır`, 'Yazdır', `data-id="${l.id}"`)}${iconBtn('form', ICON.rotate, `${name} QR kimliğini yenile`, 'QR yenile', `data-kind="rotate" data-id="${l.id}"`)}
          <details class="lk-menu"><summary class="icon-btn" aria-label="${name} için diğer işlemler" title="Diğer işlemler">${ICON.more}</summary><div class="lk-menu-list">${menu}</div></details></div></header>
        <div class="qr">${qrSvg(l.qr)}</div>
        <footer class="lk-card-foot print-hide"><div class="lk-who">${l.assignment ? `<b title="${esc(l.assignment.member)}">${esc(l.assignment.member)}</b><span>${esc(time(l.assignment.since))} · ${l.assignment.source === 'admin' ? 'yönetici atadı' : 'üye aldı'}</span>` : '<b class="muted">Atanmamış</b><span>Kod yenilendi: ' + esc(time(l.code_rotated_at)) + '</span>'}</div>
          <button type="button" class="btn small${main === 'release' ? ' danger' : ''} no-print" data-act="form" data-kind="${main}" data-id="${l.id}">${FORMS[main][0]}</button></footer></section>`;
    };
    const ev = d.events.map(e => `<tr><td>${esc(time(e.at))}</td><td>${esc(e.locker || '—')}</td><td>${esc(e.member || '—')}${e.owner_role ? ` <span class="muted small">${esc(ROLE[e.owner_role])}</span>` : ''}</td><td>${esc(e.action_label)}${e.detail ? ` <span class="muted small">(${esc(e.detail)})</span>` : ''}</td><td>${e.result === 'ok' ? 'Tamam' : '<span class="rej">Reddedildi</span>'}</td><td>${esc(e.actor || '')} <span class="muted small">${esc(ROLE[e.actor_role])}</span></td><td class="reason">${esc(e.message || e.note || '')}</td></tr>`).join('');
    root.innerHTML = `<div class="wrap lk-admin">
  <div class="lk-head"><h1>Dolap Yönetimi</h1><div class="lk-toolbar no-print" role="group" aria-label="Dolap işlemleri">${iconBtn('print-all', ICON.print, 'Tüm QR kodlarını yazdır', 'Tüm QR kodlarını yazdır')}${iconBtn('reload', ICON.refresh, 'Listeyi yenile', 'Listeyi yenile')}${iconBtn('add', ICON.plus, 'Dolap ekle', 'Yeni dolap ekle', '', ' primary')}</div></div>
  ${this.error ? `<div class="notice bad" role="alert">Son işlem başarısız: ${esc(this.error)}</div>` : ''}
  ${this.notice ? `<div class="notice ok" role="status">${esc(this.notice)}</div>` : ''}
  ${this.formHtml()}
  <div class="lk-stats no-print">${stat('available', 'Boş')}${stat('occupied', 'Dolu')}${stat('maintenance', 'Bakımda')}${stat('inactive', 'Pasif')}${stat('alerts', 'Açık uyarı', d.alerts.length)}</div>
  ${d.alerts.length ? `<section class="card lk-alerts" aria-labelledby="al-h"><h2 id="al-h">Uyarılar: dolapla çıkış</h2><ul class="log">${d.alerts.map(a => `<li><span>${esc(a.message)}<br><span class="muted small">${esc(time(a.at))} · şu an ${a.inside ? 'içeride' : 'dışarıda'}</span></span><button class="btn small" data-act="form" data-kind="resolve" data-id="${a.id}">Uyarıyı kapat</button></li>`).join('')}</ul></section>` : ''}
  <div class="lk-filterbar no-print"><label for="lk-filter">Durum</label><select id="lk-filter">${opt('all', 'Tümü', d.lockers.length)}${opt('available', 'Boş', c.available)}${opt('occupied', 'Dolu', c.occupied)}${opt('maintenance', 'Bakımda', c.maintenance)}${opt('inactive', 'Pasif', c.inactive)}</select><span class="lk-count" role="status" aria-live="polite">${list.length} dolap</span></div>
  <div class="grid locker-grid">${list.map(card).join('') || '<p class="muted">Bu filtrede dolap yok.</p>'}</div>
  <section class="card"><h2>Dolap işlem kayıtları</h2>${ev ? `<div class="table-wrap"><table><thead><tr><th>Zaman</th><th>Dolap</th><th>Kullanıcı</th><th>İşlem</th><th>Sonuç</th><th>Aktör</th><th>Sebep / not</th></tr></thead><tbody>${ev}</tbody></table></div>` : '<p class="muted">Henüz kayıt yok.</p>'}</section>
  <details class="card lk-notes no-print"><summary>Bilgilendirme ve Güvenlik Notları</summary>
    <div class="notice sim" role="note"><b>SİMÜLASYON</b>Bu sürüm sanal dolap kaydı tutar; gerçek kilit açılmaz. Dolap QR kodu kişisel veri veya kilit açma yetkisi taşımaz.</div>
    ${d.ephemeral ? '<div class="notice info" role="note"><b>Demo ortamı</b>Sunucu yeniden başlayınca (uyku, yeniden dağıtım) dolap QR kimlikleri, tahsisler ve tüm dolap kayıtları sıfırlanır. Basılı demo kodlarını her oturumda bu ekrandan yeniden yazdırın.</div>' : ''}
    <div class="notice info" role="note"><b>Güvenlik sınırı</b>Dolap kodu sabittir ve kopyalanabilir. Üyeler turnikeden giriş yaptıktan sonra dolap alabilir. Yönetici ve eğitmenler kendi oturumlarıyla dolap alabilir. Her kullanıcı aynı anda bir dolap kullanabilir. Kod sızarsa “QR yenile” ile eskisini geçersiz kılın.</div>
  </details>
</div>`;
  },
  async act(t) {
    const a = t.dataset.act, id = Number(t.dataset.id);
    if (a === 'print-all' && this.filter !== 'all') { this.filter = 'all'; this.render(); }
    if (a === 'print' || a === 'print-all') {
      document.body.classList.toggle('print-one', a === 'print');
      document.querySelectorAll('.gate-card').forEach(c => c.classList.toggle('print-target', c.id === 'gate-' + id));
      return window.print();
    }
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
    const member = document.getElementById('lf-member')?.value || '';
    f.reason = reason; f.member = member;
    if (f.kind === 'assign' && !member) { f.error = 'Kullanıcı seçin.'; return this.render(); }
    if (f.kind !== 'resolve' && reason.length < 3) { f.error = 'Sebep en az 3 karakter olmalı.'; return this.render(); }
    f.busy = true; f.error = ''; this.render();
    const body = { idempotency_key: f.key, reason };
    const call = {
      assign: () => api(`/api/lockers/${f.id}/assign`, { method: 'POST', body: { ...body, ...(member.startsWith('staff-') ? { owner_user_id: Number(member.slice(6)) } : { member_id: Number(member) }) } }),
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

/* ---------- Self-service ---------- */
const Personal = {
  view: 'scan', me: null, error: '', result: null, pending: null, resume: 0, releasing: null, cam: null,
  async start(view) {
    this.view = view;
    this.cam = window.FormclubQrCamera.create({
      videoId: 'locker-video',
      accepts: code => window.FormclubQrCamera.formats.locker.test(code) || window.FormclubQrCamera.formats.gate.test(code),
      busy: () => this.sending || !!this.pending || !!this.result || !this.me,
      onCode: code => this.scanned(code),
      onChange: () => this.render()
    });
    await this.load();
  },
  async load() {
    try { this.me = await api('/api/lockers/me'); this.error = ''; } catch (e) { this.error = errorText(e); }
    this.render();
  },
  statusCard() {
    const m = this.me;
    if (!m) return '';
    const presence = !m.requires_entry ? '<div class="presence">Personel hesabı · turnike girişi gerekmez</div>' : `<div class="presence"><span class="dot ${m.inside ? 'in' : ''}" aria-hidden="true"></span>${m.inside ? 'Şu an salondasın' : 'Şu an dışarıdasın'}</div>`;
    const hint = m.locker ? `Dolabın: <b>${esc(m.locker.label)}</b> · ${esc(clock(m.locker.since))} itibarıyla.` : (!m.requires_entry || m.inside) ? 'Boş bir dolabın QR kodunu okutarak dolabı alabilirsin.' : 'Dolap almak için önce turnikeden giriş yap (Turnike QR Tara).';
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
  ${m?.requires_entry && !m.inside ? `<div class="notice info" role="note"><b>Önce turnike girişi</b>Dolap yalnızca başarılı turnike girişinden sonra alınabilir.<div class="row" style="margin-top:8px">${top('gate')}Turnike QR Tara</a></div></div>` : ''}
  <section class="card"><h2>Dolap QR Tara</h2><div class="scanner" id="scanner">${cam.view(this.qrRelease ? 'Bırakmak için kendi dolabının QR kodunu çerçeveye getir.' : 'Dolabın üzerindeki QR kodu çerçeveye getir.')}
    ${r ? `<div class="result ${r.ok ? 'ok' : 'bad'}" role="${r.ok ? 'status' : 'alert'}">${esc(r.title)}<div class="small" style="font-weight:600">${esc(r.detail)}</div></div>` : ''}</div>
    ${cam.error ? `<div class="notice bad" role="alert" style="margin-top:12px"><b>${esc(cam.error)}</b>${esc(cam.help)}</div>` : ''}
    ${this.pending ? `<div class="notice bad" role="alert" style="margin-top:12px"><b>İstek gönderilemedi</b>Aynı okutma tekrar gönderilir; çift kayıt oluşmaz.<div class="row" style="margin-top:8px"><button class="btn" data-act="resend">Tekrar gönder</button><button class="btn" data-act="discard">Vazgeç</button></div></div>` : ''}
    <div class="row" style="margin-top:12px">${cam.active ? '<button class="btn" data-act="cam-stop">Kamerayı kapat</button>' : ''}${m?.locker && !this.qrRelease ? '<button class="btn" data-act="qr-release">QR ile bırak</button>' : ''}
    ${this.qrRelease ? '<span class="muted small">Bırakmak için kendi dolabının QR kodunu okut.</span><button class="btn" data-act="qr-cancel">Bırakmayı iptal et</button>' : ''}
    ${m?.locker ? `${top('locker')}Dolabım</a>` : ''}</div></section>
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
    ${rel ? `<div class="notice warn" role="alert"><b>${esc(m.locker.label)} bırakılsın mı?</b>Eşyalarını aldığından emin ol. Bıraktıktan sonra dolap başka kullanıcıya verilebilir.<div class="row" style="margin-top:8px"><button class="btn danger" data-act="release-ok" ${rel.busy ? 'disabled' : ''}>${rel.busy ? 'Bırakılıyor…' : 'Evet, bırak'}</button><button class="btn" data-act="release-cancel">Vazgeç</button></div></div>`
      : `<div class="row">${top('lockerScan')}Dolap QR Tara</a><button class="btn danger" data-act="release">Dolabı bırak</button></div>`}`
    : `<p class="muted">Şu an sana ayrılmış bir dolap yok.</p><div class="row">${top('lockerScan')}Dolap QR Tara</a></div>`}
  </section>
  ${this.statusCard()}
  <section class="card"><h2>Dolap geçmişim</h2>${own}</section>
</div>`;
  },
  async scanned(code) {
    if (this.pending) return; // an unsent claim waits for resend or discard
    if (window.FormclubQrCamera.formats.gate.test(code)) return this.show(false, 'Turnike kodu okundu', 'Turnike için “Turnike QR Tara” ekranını kullan.');
    if (navigator.onLine === false) return this.show(false, 'Bağlantı yok', 'Dolap işlemi sunucuda onaylanır. İnternet gelince tekrar okut.');
    this.pending = { code, key: key(), assignment: this.qrRelease };
    return this.send();
  },
  async send() {
    if (!this.pending || this.sending) return;
    const { code, key: idempotency_key, assignment } = this.pending;
    const path = assignment ? '/api/lockers/me/release' : '/api/lockers/claim';
    const body = { code, idempotency_key };
    if (assignment) Object.assign(body, { confirm: true, assignment_id: assignment });
    this.sending = true;
    try {
      const r = await api(path, { method: 'POST', body });
      this.pending = null;
      if (r.ok) {
        this.qrRelease = null;
        this.cam.stop();
        this.show(true, assignment ? `${r.locker} bırakıldı` : `${r.locker} senin`,
          assignment ? 'Dolap artık boş.' : `Tahsis saati ${clock(r.at)} · simülasyon`);
      } else this.show(false, assignment ? 'Dolap bırakılamadı' : 'Dolap alınamadı', r.message);
      await this.load();
    } catch (e) {
      // A network retry carries the same operation, assignment and idempotency key.
      if (!e.offline) this.pending = null;
      if (e.status === 409 && assignment) { this.qrRelease = null; await this.load(); }
      this.show(false, e.offline ? 'Bağlantı yok' : 'Dolap işlemi yapılamadı', errorText(e));
    } finally {
      this.sending = false;
    }
  },
  show(ok, title, detail) {
    this.result = { ok, title, detail };
    try { navigator.vibrate?.(ok ? 80 : [60, 60, 60]); } catch {}
    this.render();
    clearTimeout(this.resume);
    this.resume = setTimeout(() => { this.result = null; this.render(); }, ok ? 5000 : 4000);
  },
  async release() {
    const rel = this.releasing; if (rel.busy) return; rel.busy = true; this.render();
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

root.addEventListener('change', ev => {
  if (ev.target.id === 'lk-filter') { Admin.filter = ev.target.value; Admin.render(); document.getElementById('lk-filter')?.focus(); }
});
// Only one "more" menu open at a time; outside click or Escape closes it.
const closeMenus = keep => document.querySelectorAll?.('details.lk-menu[open]').forEach(m => { if (m !== keep) m.open = false; });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { const open = document.querySelector?.('details.lk-menu[open]'); if (open) { open.open = false; open.querySelector('summary')?.focus(); } } });
root.addEventListener('click', ev => {
  closeMenus(ev.target.closest?.('details.lk-menu'));
  const t = ev.target.closest('[data-act]'); if (!t || t.disabled) return;
  const a = t.dataset.act;
  if (a === 'retry-boot') return boot();
  if (a === 'reload') { Admin.notice = ''; return Admin.load(); }
  if (['print', 'print-all', 'form', 'form-cancel', 'form-ok', 'add'].includes(a)) return Admin.act(t);
  if (a === 'cam-start') return Personal.cam.start();
  if (a === 'cam-stop') { Personal.cam.stop(); return Personal.render(); }
  if (a === 'resend') return Personal.send();
  if (a === 'qr-release' && !Personal.pending && !Personal.sending) {
    Personal.qrRelease = Personal.me?.locker?.assignment_id;
    Personal.result = null;
    return Personal.render();
  }
  if (a === 'qr-cancel' && !Personal.pending && !Personal.sending) { Personal.qrRelease = null; return Personal.render(); }
  if (a === 'discard' && !Personal.sending) { Personal.pending = null; return Personal.render(); }
  if (a === 'release') { Personal.releasing = { key: key(), assignment: Personal.me?.locker?.assignment_id }; Personal.result = null; return Personal.render(); }
  if (a === 'release-cancel') { Personal.releasing = null; return Personal.render(); }
  if (a === 'release-ok') return Personal.release();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && (Personal.cam?.active || Personal.cam?.starting)) { Personal.cam.stop(); Personal.render(); } });
window.addEventListener('online', () => Personal.cam ? Personal.load() : user?.role === 'admin' && Admin.load());
window.addEventListener('offline', () => Personal.cam && Personal.render());
boot();
})();
