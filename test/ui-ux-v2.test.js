'use strict';
// UI/UX V2 regressions: "Ana Sayfa" naming, Istanbul date/time display, reservations picker, separate Members and
// Renewals screens, renewal history API (no payment created), mobile table cards, QR print layout.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const pub = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(pub, f), 'utf8');
const T = require('../public/datetime.js');

test('date/time: tr-TR, Europe/Istanbul, naive class times are never shifted', () => {
  assert.equal(T.dateTime('2026-11-18T07:30:00', { weekday: true }), '18 Kasım 2026 Çarşamba · 07:30');
  assert.equal(`Spinning · ${T.dateTime('2026-11-18T07:30:00', { weekday: true })}`, 'Spinning · 18 Kasım 2026 Çarşamba · 07:30');
  assert.equal(T.time('2026-11-18T07:30'), '07:30');
  assert.equal(T.date('2026-11-23'), '23 Kasım 2026');
  // SQLite CURRENT_TIMESTAMP is UTC: 07:30Z is 10:30 in Istanbul (UTC+3, no DST).
  assert.equal(T.dateTime(T.fromSqlUtc('2026-11-18 07:30:00')), '18 Kasım 2026 · 10:30');
  assert.equal(T.dateTime(Date.parse('2026-11-18T21:30:00Z')), '19 Kasım 2026 · 00:30', 'instants convert to the Istanbul day');
  // Same output whatever the device or server time zone is.
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const out = execFileSync(process.execPath, ['-e', "const T=require(process.argv[1]);process.stdout.write(T.dateTime('2026-11-18T07:30:00',{weekday:true})+'|'+T.dateTime(T.fromSqlUtc('2026-11-18 07:30:00'))+'|'+T.nowKey(Date.parse('2026-11-18T05:00:00Z')))", require.resolve('../public/datetime.js')], { env: { ...process.env, TZ } }).toString();
    assert.equal(out, '18 Kasım 2026 Çarşamba · 07:30|18 Kasım 2026 · 10:30|2026-11-18T08:00', TZ);
  }
  const now = Date.parse('2026-11-18T05:00:00Z'); // 08:00 in Istanbul
  assert.equal(T.isPast('2026-11-18T07:30:00', now), true);
  assert.equal(T.isPast('2026-11-18T08:30:00', now), false);
  assert.equal(T.isPast('2026-11-18T08:00:00', now + 30000), true, 'past within its start minute');
  assert.equal(T.isPast('2026-11-18T08:00:30', now), false);
  assert.equal(T.daysUntil('2026-11-25', now), 7);
  assert.equal(T.daysUntil('2026-11-17', now), -1);
  assert.equal(T.daysUntil('2026-11-19', Date.parse('2026-11-18T21:30:00Z')), 0, 'after Istanbul midnight the 19th is today');
  assert.equal(T.date(''), '—'); assert.equal(T.dateTime('not a date'), '—');
});

/* ---------- app.js in a VM (stub DOM, fake fetch, real datetime.js) ---------- */
const istanbulDay = n => { const d = T.wall(Date.now() + n * 86400000); return `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };
function boot({ role = 'admin', hash = '#members', state = {}, renewals = [] } = {}) {
  const el = id => ({ id, hidden: false, textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, focus() {}, remove() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const app = el('app'), listeners = {};
  const user = { id: 5, username: 'syn', role, member_id: role === 'member' ? 1 : null, trainer_id: role === 'teacher' ? 1 : null };
  const S = { members: [], classes: [], bookings: [], trainers: [{ id: 1, name: 'Eğitmen', specialty: 'Pilates' }], payments: [], checkins: [], measurements: [], announcements: [], ...state };
  const fetch = async url => {
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (url === '/api/me') return json({ user, setup: false });
    if (url === '/api/state') return json(S);
    if (url === '/api/members/renewals') return json(renewals);
    if (url === '/api/v6/analytics') return json({ monthly: [], scores: [] });
    if (url.startsWith('/api/v6/settings')) return json({});
    return json([]);
  };
  const ctx = {
    FormClubDashboard: { defaults: () => ({}), render: () => '<div class="fc-dashboard"></div>', selection() {} },
    FormClubEnergy: require('../public/energy.js'),
    document: { body: { classList: { add() {}, remove() {}, toggle() {} }, contains: () => true }, getElementById: id => id === 'app' ? app : el(id), querySelector: () => null, querySelectorAll: () => [], addEventListener: (n, fn) => (listeners[n] ||= []).push(fn) },
    window: { addEventListener() {} }, addEventListener() {}, navigator: { onLine: true }, location: { hash, pathname: '/' }, history: { replaceState() {} },
    sessionStorage: { clear() {}, getItem: () => null, setItem() {}, removeItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch, setTimeout: () => 0, clearTimeout() {}, console, URLSearchParams, Intl, Date
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('datetime.js'), ctx);
  vm.runInContext(read('app.js'), ctx);
  const settle = () => new Promise(r => setImmediate(r));
  const until = async re => { for (let i = 0; i < 60 && !re.test(app.innerHTML); i++) await settle(); return app.innerHTML; };
  const change = async (id, value) => { for (const fn of listeners.change || []) fn({ target: { id, value, dataset: {}, closest: () => null, matches: () => false } }); await settle(); return app.innerHTML; };
  return { app, ctx, until, change };
}
const MEMBERS = () => [
  { id: 1, name: 'Süresi Geçmiş Üye', phone: '05550000001', email: '', plan: 'Aylık', credits: 0, expires: istanbulDay(-5), status: 'Aktif' },
  { id: 2, name: 'Yedi Gün Üye', phone: '05550000002', email: 'yedi@example.test', plan: 'Aylık', credits: 3, expires: istanbulDay(3), status: 'Aktif' },
  { id: 3, name: 'Otuz Gün Üye', phone: '05550000003', email: '', plan: 'Pilates', credits: 5, expires: istanbulDay(20), status: 'Aktif' },
  { id: 4, name: 'Uzun Vadeli Üye', phone: '05550000004', email: '', plan: 'Yıllık', credits: 40, expires: istanbulDay(200), status: 'Aktif' },
  { id: 5, name: 'Pasif Üye', phone: '05550000005', email: '', plan: 'Aylık', credits: 0, expires: istanbulDay(90), status: 'Pasif' }
];

test('"Genel bakış" is now "Ana Sayfa" with a house icon for every role; page ids and routing unchanged', () => {
  const app = read('app.js');
  assert.match(app, /\['overview','⌂','Ana Sayfa'\]/);
  assert.match(app, /\['home','⌂','Ana Sayfa'\]/);
  assert.match(app, /\['today','⌂','Ana Sayfa'\]/);
  assert.match(app, /overview:'Ana Sayfa'/); assert.match(app, /home:'Ana Sayfa'/); assert.match(app, /today:'Ana Sayfa'/);
  assert.match(app, /role==='admin'\?'overview':role==='teacher'\?'today':'home'/, 'default routes kept');
  for (const f of ['app.js', 'v7.js', 'dashboard.js', 'v9/v9.js']) assert.doesNotMatch(read(f), /Genel bakış/, f);
});

test('Members and Renewals show different content; renewals are expiry-driven with filters and history', async () => {
  const m = boot({ hash: '#members', state: { members: MEMBERS() } });
  let html = await m.until(/Üyeler <span class="muted">/);
  for (const x of MEMBERS()) assert.ok(html.includes(x.name), 'members list shows everyone: ' + x.name);
  assert.match(html, /id="searchInput"/); assert.match(html, /<select id="memberStatus">/); assert.match(html, /yedi@example\.test/);
  assert.match(html, /\+ Yeni üye/); assert.match(html, /Düzenle/); assert.doesNotMatch(html, /Kalan gün/);
  html = await m.change('memberStatus', 'Pasif');
  assert.ok(html.includes('Pasif Üye') && !html.includes('Uzun Vadeli Üye'), 'status filter');

  const history = [{ id: 1, member_id: 2, member: 'Yedi Gün Üye', old_expires: '2026-10-01', new_expires: '2026-11-01', credits: 8, actor: 'syn-admin', created_at: '2026-10-01 07:30:00' }];
  const r = boot({ hash: '#renewals', state: { members: MEMBERS() }, renewals: history });
  html = await r.until(/Üyelik yenileme <span class="muted">/);
  assert.notEqual(html, m.app.innerHTML);
  for (const name of ['Süresi Geçmiş Üye', 'Yedi Gün Üye', 'Otuz Gün Üye', 'Pasif Üye']) assert.ok(html.includes(name), name);
  assert.ok(!html.includes('Uzun Vadeli Üye'), 'members far from expiry are not renewal work');
  for (const s of ['Süresi dolmuş', '7 gün içinde bitiyor', '30 gün içinde bitiyor', 'Yenileme bekliyor', 'Kalan gün', '5 gün geçti', '3 gün', 'renew:2', 'ödeme kaydı oluşturmaz', 'Son yenilemeler', '1 Ekim 2026 · 10:30', 'syn-admin'])
    assert.ok(html.includes(s), s);
  assert.ok(html.indexOf('Süresi Geçmiş Üye') < html.indexOf('Yedi Gün Üye'), 'most urgent first');
  html = await r.change('renewFilter', 'd7');
  assert.ok(html.includes('Yedi Gün Üye') && !html.includes('Otuz Gün Üye') && !html.includes('Süresi Geçmiş Üye'));
  assert.match(html, /<option value="d7" selected>7 gün içinde bitiyor \(1\)<\/option>/);
});

test('reservations: readable Turkish times, chronological, past classes hidden, grouped by day with a day filter', async () => {
  const classes = [
    { id: 1, title: 'Spinning', trainer_id: 1, starts_at: '2099-05-05T07:30:00', studio: 'Stüdyo 2', capacity: 10 },
    { id: 2, title: 'Eski Ders', trainer_id: 1, starts_at: '2020-01-01T09:00:00', studio: 'Stüdyo 1', capacity: 10 },
    { id: 3, title: 'Pilates', trainer_id: 1, starts_at: '2099-05-04T18:00:00', studio: 'Stüdyo 1', capacity: 10 },
    { id: 4, title: 'Yoga', trainer_id: 1, starts_at: '2099-05-05T06:15:00', studio: 'Stüdyo 1', capacity: 10 }
  ];
  const bookings = [{ id: 9, member_id: 1, class_id: 2, member: 'Ada Üye', class_title: 'Eski Ders', starts_at: '2020-01-01T09:00:00', status: 'attended' }];
  const t = boot({ hash: '#reservations', state: { members: MEMBERS(), classes, bookings } });
  let html = await t.until(/adminBooking/);
  assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'no raw ISO date anywhere');
  assert.match(html, /<optgroup label="4 Mayıs 2099 Pazartesi"><option value="3">18:00 · Pilates \(Stüdyo 1\)<\/option><\/optgroup><optgroup label="5 Mayıs 2099 Salı"><option value="4">06:15 · Yoga \(Stüdyo 1\)<\/option><option value="1">07:30 · Spinning \(Stüdyo 2\)<\/option><\/optgroup>/);
  assert.doesNotMatch(html.split('Rezervasyon oluştur')[0], /Eski Ders/, 'past class not offered for a new booking');
  assert.match(html, /Eski Ders[\s\S]*1 Ocak 2020 Çarşamba · 09:00[\s\S]*Katıldı/, 'past bookings still listed, status in Turkish');
  t.ctx.document.querySelector = sel => sel === '#adminBooking [name=member_id]' ? { value: '3' } : null;
  html = await t.change('resDay', '2099-05-05');
  assert.match(html, /<option value="3" selected>Otuz Gün Üye<\/option>/, 'chosen member survives a day change');
  assert.doesNotMatch(html, /value="3">18:00 · Pilates/); assert.match(html, /value="4">06:15 · Yoga/);
  assert.match(html, /<option value="2099-05-05" selected>5 Mayıs 2099 Salı<\/option>/);
  // Other screens no longer print raw ISO class times.
  const app = read('app.js');
  assert.doesNotMatch(app, /starts_at\.slice\(0,16\)/);
  assert.doesNotMatch(app, /\$\{h\([a-z]\.created_at\)\}/);
});

test('mobile tables: rows become labelled cards at 768px and below; desktop tables untouched', () => {
  const css = read('table-cards.css');
  assert.match(css, /@media \(max-width:768px\)\{/);
  assert.match(css, /table\.fc-stack thead\{position:absolute!important/);
  assert.match(css, /table\.fc-stack td::before\{content:attr\(data-label\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.doesNotMatch(css.replace(/@media \(max-width:768px\)\{[\s\S]*\}\s*$/, ''), /fc-stack/, 'all stacking rules are inside the mobile query');
  for (const page of ['index.html', 'v9/index.html', 'nutrition/index.html', 'turnstiles/index.html', 'lockers/index.html']) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="\/table-cards\.css">/, page); assert.match(html, /<script src="\/table-cards\.js"><\/script>/, page);
  }
  // Label copying, run against a minimal table object.
  const cell = () => { const o = { attrs: {}, colSpan: 1, hasAttribute(n) { return n in this.attrs; }, setAttribute(n, v) { this.attrs[n] = v; } }; o.classList = { add: c => { o.c = c; } }; return o; };
  const row = [cell(), cell(), cell()], wide = cell(); wide.colSpan = 3;
  const table = { dataset: {}, classList: { list: [], add(c) { this.list.push(c); } }, tHead: { rows: [{ cells: [{ textContent: 'Üye' }, { textContent: ' Bitiş ' }, { textContent: 'İşlem' }] }] }, tBodies: [{ rows: [{ cells: row }, { cells: [wide] }] }] };
  const off = { dataset: { stack: 'off' }, classList: { list: [], add(c) { this.list.push(c); } }, tHead: table.tHead, tBodies: [] };
  const ctx = { document: { querySelectorAll: () => [table, off], documentElement: {}, addEventListener() {} }, window: {}, setTimeout };
  vm.createContext(ctx); vm.runInContext(read('table-cards.js'), ctx);
  assert.deepEqual(row.map(c => c.attrs['data-label']), ['Üye', 'Bitiş', 'İşlem']);
  assert.equal(wide.c, 'fc-full'); assert.deepEqual(table.classList.list, ['fc-stack']); assert.deepEqual(off.classList.list, []);
});

test('QR print layout: ~8 cm single code with a large name, 2-column A4 sheet for "print all", no controls', () => {
  const css = read('turnstiles/turnstiles.css'), print = css.slice(css.indexOf('@media print{'));
  assert.match(css, /@page\{size:A4;margin:12mm\}/);
  assert.match(print, /\.no-print,\.notice,\.stats,\.card:not\(\.gate-card\),\.print-hide,h1\{display:none!important\}/);
  assert.match(print, /\.grid\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(print, /body\.print-one \.gate-card \.qr\{width:84mm!important;height:84mm;padding:2mm\}/, '80 mm code inside a 2 mm white margin');
  assert.match(print, /body\.print-one \.gate-card h2,body\.print-one \.gate-card \.lk-title h2\{font-size:36pt!important/);
  assert.match(print, /\.gate-card \.qr\{order:1;/); assert.match(print, /\.gate-card \.lk-card-head\{order:2;/, 'name printed under the code');
  assert.match(print, /break-inside:avoid/);
  assert.match(read('lockers/lockers.css'), /@media print\{\.lk-card-foot,\.locker-card \.pill,\.lk-icons,\.lk-notes,\.lk-filterbar,\.lk-alerts\{display:none!important\}/);
});

test('HTTP: renewal records history for admins only and never creates a payment', async t => {
  process.env.NODE_ENV = 'test'; process.env.FITNESS_DB_PATH = ':memory:';
  const { once } = require('node:events');
  const { server, db } = require('../server');
  t.after(async () => { await new Promise(r => server.close(r)); db.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (p, method = 'GET', body, cookie) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const admin = (await req('/api/setup', 'POST', { username: 'renew-admin', password: 'isolated-password-123' })).headers.get('set-cookie').split(';')[0];
  const member = db.prepare('SELECT id,expires FROM members ORDER BY id LIMIT 1').get();
  await req('/api/users', 'POST', { username: 'renew-member', password: 'isolated-password-123', role: 'member', member_id: member.id }, admin);
  const mc = (await req('/api/login', 'POST', { username: 'renew-member', password: 'isolated-password-123' })).headers.get('set-cookie').split(';')[0];
  const payments = db.prepare('SELECT count(*) n FROM payments').get().n;
  assert.equal((await req(`/api/members/${member.id}/renew`, 'POST', { expires: '2099-01-31', credits: 12 }, admin)).status, 200);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, payments, 'renewal is not a payment');
  const list = await (await req('/api/members/renewals', 'GET', null, admin)).json();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].member_id, list[0].old_expires, list[0].new_expires, list[0].credits, list[0].actor], [member.id, member.expires, '2099-01-31', 12, 'renew-admin']);
  assert.equal((await req('/api/members/renewals', 'GET', null, mc)).status, 403);
  assert.equal((await req('/api/members/renewals')).status, 401);
  assert.equal((await req(`/api/members/${member.id}/renew`, 'POST', { expires: '2000-01-01', credits: 1 }, admin)).status, 400);
  assert.equal((await (await req('/api/members/renewals', 'GET', null, admin)).json()).length, 1, 'rejected renewal leaves no history');
  for (const p of ['/datetime.js', '/table-cards.js', '/table-cards.css']) assert.equal((await req(p)).status, 200, p);
});
