'use strict';
// Virtual turnstiles (simulation): gates, entry/exit, duplicates, rejections, roles, HTTP guards, real QR decode.
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
const createTurnstiles = require('../backend/turnstiles');
const { PREFIX } = createTurnstiles;

function fixture({ cooldownMs = 20000, scanLimit = 50 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE members(id INTEGER PRIMARY KEY,name TEXT,status TEXT NOT NULL DEFAULT 'Aktif',expires TEXT NOT NULL);
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,member_id INTEGER,trainer_id INTEGER);
    INSERT INTO members VALUES(1,'Synthetic One','Aktif','2099-12-31'),(2,'Synthetic Two','Aktif','2000-01-01');
    INSERT INTO users VALUES(1,'admin',NULL,NULL),(2,'member',1,NULL),(3,'member',2,NULL),(4,'teacher',NULL,1);`);
  let now = Date.parse('2026-11-17T09:00:00Z');
  const api = createTurnstiles(db, { clock: () => now, cooldownMs, scanLimit });
  const U = { admin: { id: 1, role: 'admin' }, member: { id: 2, role: 'member', member_id: 1 }, expired: { id: 3, role: 'member', member_id: 2 }, teacher: { id: 4, role: 'teacher', trainer_id: 1 } };
  let n = 0;
  const scan = (u, code, key = 'key-' + (++n) + '-abcdef') => api('POST', '/api/turnstiles/scan', { code, idempotency_key: key }, u);
  const codes = () => Object.fromEntries(api('GET', '/api/turnstiles', {}, U.admin).turnstiles.map(t => [t.id, t.qr]));
  return { db, api, U, scan, codes, tick: ms => { now += ms; }, status: s => assert.throws(s[0], e => e.status === s[1]) };
}
const forbidden = (fn, status) => assert.throws(fn, e => e.status === status);

test('three bidirectional gates with distinct fixed QR codes that carry no member data', () => {
  const f = fixture();
  const gates = f.api('GET', '/api/turnstiles', {}, f.U.admin).turnstiles;
  assert.deepEqual(gates.map(g => g.name), ['Turnike 1', 'Turnike 2', 'Turnike 3']);
  assert.ok(gates.every(g => g.active && new RegExp('^' + PREFIX + '[a-f0-9]{32}$').test(g.qr)));
  assert.equal(new Set(gates.map(g => g.qr)).size, 3);
  // Restart keeps the printed codes (seed is idempotent).
  createTurnstiles(f.db);
  assert.deepEqual(f.codes(), Object.fromEntries(gates.map(g => [g.id, g.qr])));
});

test('acceptance: Turnike 2 entry, duplicate blocked, Turnike 1 exit after cooldown, admin sees both, Turnike 3 same rules', () => {
  const f = fixture(), c = f.codes();
  const entry = f.scan(f.U.member, c[2]);
  assert.equal(entry.ok, true); assert.equal(entry.direction, 'in'); assert.equal(entry.turnstile, 'Turnike 2'); assert.equal(entry.simulation, true);
  let admin = f.api('GET', '/api/turnstiles', {}, f.U.admin);
  assert.equal(admin.inside_count, 1); assert.equal(admin.inside[0].member, 'Synthetic One');
  const again = f.scan(f.U.member, c[2]);
  assert.equal(again.ok, false); assert.equal(again.reason, 'too_soon');
  assert.equal(f.api('GET', '/api/turnstiles', {}, f.U.admin).inside_count, 1, 'duplicate did not flip presence');
  f.tick(20000);
  const exit = f.scan(f.U.member, c[1]);
  assert.equal(exit.ok, true); assert.equal(exit.direction, 'out'); assert.equal(exit.turnstile, 'Turnike 1');
  admin = f.api('GET', '/api/turnstiles', {}, f.U.admin);
  assert.equal(admin.inside_count, 0);
  const ok = admin.events.filter(e => e.result === 'ok');
  assert.deepEqual(ok.map(e => [e.turnstile, e.direction]), [['Turnike 1', 'out'], ['Turnike 2', 'in']]);
  assert.ok(admin.events.some(e => e.result === 'rejected' && e.reason === 'too_soon' && e.message));
  f.tick(20000); assert.equal(f.scan(f.U.member, c[3]).direction, 'in');
  assert.equal(f.scan(f.U.member, c[3]).reason, 'too_soon');
  f.tick(20000); assert.equal(f.scan(f.U.member, c[3]).direction, 'out');
  const mine = f.api('GET', '/api/turnstiles/me', {}, f.U.member);
  assert.equal(mine.inside, false); assert.equal(mine.events.filter(e => e.result === 'ok').length, 4);
});

test('idempotency key replays the stored outcome and never creates a second pass', () => {
  const f = fixture(), c = f.codes();
  const first = f.scan(f.U.member, c[1], 'retry-key-0001');
  f.tick(60000);
  const retry = f.scan(f.U.member, c[1], 'retry-key-0001');
  assert.equal(retry.replayed, true); assert.equal(retry.direction, 'in'); assert.equal(retry.at, first.at);
  assert.equal(f.db.prepare('SELECT count(*) n FROM gate_events').get().n, 1);
  assert.equal(f.api('GET', '/api/turnstiles/me', {}, f.U.member).inside, true);
  for (const key of [undefined, 'short', 'x'.repeat(65), 'bad key!!']) forbidden(() => f.api('POST', '/api/turnstiles/scan', { code: c[1], idempotency_key: key }, f.U.member), 400);
});

test('rejections: foreign, unknown and rotated codes, passive gate, expired membership; exit is never blocked by membership', () => {
  const f = fixture(), c = f.codes();
  assert.equal(f.scan(f.U.member, 'https://example.com').reason, 'invalid_code');
  assert.equal(f.scan(f.U.member, PREFIX + 'f'.repeat(32)).reason, 'unknown_code');
  f.api('POST', '/api/turnstiles/2/rotate', {}, f.U.admin);
  assert.notEqual(f.codes()[2], c[2]);
  assert.equal(f.scan(f.U.member, c[2]).reason, 'unknown_code', 'old printed code is revoked');
  f.api('PATCH', '/api/turnstiles/3', { active: false }, f.U.admin);
  assert.equal(f.scan(f.U.member, c[3]).reason, 'inactive');
  assert.equal(f.scan(f.U.expired, c[1]).reason, 'membership');
  assert.equal(f.db.prepare("SELECT count(*) n FROM gate_events WHERE result='ok'").get().n, 0);
  // A member who is inside when the membership lapses can still leave.
  assert.equal(f.scan(f.U.member, c[1]).direction, 'in');
  f.db.prepare("UPDATE members SET expires='2000-01-01' WHERE id=1").run(); f.tick(20000);
  assert.equal(f.scan(f.U.member, c[1]).direction, 'out');
  f.api('PATCH', '/api/turnstiles/3', { active: true }, f.U.admin);
  f.tick(20000); assert.equal(f.scan(f.U.member, f.codes()[3]).reason, 'membership');
  // Class credits and bookings are untouched by gate passes (separate tables).
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='bookings'").get().n, 0);
});

test('role isolation and per-user scan rate limit', () => {
  const f = fixture({ scanLimit: 3 }), c = f.codes();
  for (const u of [f.U.admin, f.U.teacher]) forbidden(() => f.scan(u, c[1]), 403);
  for (const u of [f.U.member, f.U.teacher]) {
    forbidden(() => f.api('GET', '/api/turnstiles', {}, u), 403);
    forbidden(() => f.api('PATCH', '/api/turnstiles/1', { active: false }, u), 403);
    forbidden(() => f.api('POST', '/api/turnstiles/1/rotate', {}, u), 403);
  }
  forbidden(() => f.api('GET', '/api/turnstiles/me', {}, f.U.admin), 403);
  forbidden(() => f.api('GET', '/api/turnstiles', {}, null), 401);
  forbidden(() => f.api('PATCH', '/api/turnstiles/9', { active: false }, f.U.admin), 404);
  forbidden(() => f.api('PATCH', '/api/turnstiles/1', { active: 'no' }, f.U.admin), 400);
  f.scan(f.U.member, c[1]); f.scan(f.U.member, c[1]); f.scan(f.U.member, c[1]);
  forbidden(() => f.scan(f.U.member, c[1]), 429);
  assert.equal(f.api('GET', '/api/turnstiles/me', {}, f.U.expired).events.length, 0, 'members see only their own passes');
});

test('printed gate QR decodes back to the exact gate code with the bundled scanner library', () => {
  const qrcode = require('../public/v9/vendor/qrcode.js'), jsQR = require('../public/v9/vendor/jsQR.js');
  const f = fixture();
  for (const code of Object.values(f.codes())) {
    const qr = qrcode(0, 'M'); qr.addData(code, 'Byte'); qr.make();
    const n = qr.getModuleCount(), s = 6, q = 4, W = (n + 2 * q) * s, px = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = (((r + q) * s + y) * W + (col + q) * s + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    assert.equal(jsQR(px, W, W)?.data, code);
  }
});

test('HTTP: session, CSRF, JSON-only, no CORS, static module under CSP, menu entries per role', async t => {
  process.env.NODE_ENV = 'test'; process.env.FITNESS_DB_PATH = ':memory:';
  const { once } = require('node:events'), fs = require('node:fs'), path = require('node:path');
  const { server, db } = require('../server');
  t.after(async () => { await new Promise(r => server.close(r)); db.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (p, method = 'GET', body, cookie, headers = {}) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await req('/api/turnstiles')).status, 401);
  const admin = (await req('/api/setup', 'POST', { username: 'gate-admin', password: 'isolated-password-123' })).headers.get('set-cookie').split(';')[0];
  const memberId = db.prepare("SELECT id FROM members WHERE status='Aktif' AND expires>=date('now') ORDER BY id LIMIT 1").get().id;
  assert.equal((await req('/api/users', 'POST', { username: 'gate-member', password: 'isolated-password-123', role: 'member', member_id: memberId }, admin)).status, 200);
  const member = (await req('/api/login', 'POST', { username: 'gate-member', password: 'isolated-password-123' })).headers.get('set-cookie').split(';')[0];
  const list = await req('/api/turnstiles', 'GET', null, admin);
  assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store'); assert.equal(list.headers.get('access-control-allow-origin'), null);
  const code = (await list.json()).turnstiles[1].qr;
  assert.equal((await req('/api/turnstiles', 'GET', null, member)).status, 403);
  assert.equal((await req('/api/turnstiles/scan', 'POST', { code, idempotency_key: 'http-key-0001' }, member, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await fetch(base + '/api/turnstiles/scan', { method: 'POST', headers: { cookie: member, 'Content-Type': 'text/plain' }, body: JSON.stringify({ code, idempotency_key: 'http-key-0002' }) })).status, 415);
  const pass = await req('/api/turnstiles/scan', 'POST', { code, idempotency_key: 'http-key-0003' }, member);
  assert.equal(pass.status, 200); assert.deepEqual(((({ ok, direction, turnstile }) => ({ ok, direction, turnstile }))(await pass.json())), { ok: true, direction: 'in', turnstile: 'Turnike 2' });
  assert.equal((await (await req('/api/turnstiles', 'GET', null, admin)).json()).inside_count, 1);
  assert.equal((await req('/api/turnstiles/2', 'PATCH', { active: false }, member)).status, 403);
  for (const p of ['/turnstiles/', '/turnstiles/turnstiles.js', '/turnstiles/turnstiles.css']) { const r = await req(p); assert.equal(r.status, 200, p); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); }
  const html = await (await req('/turnstiles/')).text();
  assert.doesNotMatch(html, /<script>|\son[a-z]+="/, 'no inline script or handlers');
  await req('/api/logout', 'POST', {}, member); assert.equal((await req('/api/turnstiles/me', 'GET', null, member)).status, 401);
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(app, /navItems\.admin\.push\(\['turnstiles','⇆','Turnikeler'\]\);navItems\.member\.push\(\['gate','⇆','Turnike QR Tara'\]\)/);
  assert.doesNotMatch(app, /navItems\.teacher\.push\(\['(?:turnstiles|gate)'/);
  const js = fs.readFileSync(path.join(__dirname, '../public/turnstiles/turnstiles.js'), 'utf8');
  assert.match(js, /SİMÜLASYON/); assert.match(js, /kopyalanabilir/); assert.match(js, /Kamera izni verilmedi/); assert.match(js, /desteklemiyor/); assert.match(js, /Bağlantı yok/);
});

test('UI renders admin gate cards with QR SVG and the member scanner with history (vm, no browser)', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const read = p => fs.readFileSync(path.join(__dirname, '../public', p), 'utf8');
  async function boot(role, routes, extra = {}) {
    const root = { innerHTML: '', addEventListener() {} };
    const ctx = { console, setTimeout, clearTimeout, setInterval: () => 0, URLSearchParams, Date, crypto: globalThis.crypto,
      document: { getElementById: id => id === 'gate-root' ? root : null, addEventListener() {}, hidden: false, querySelectorAll: () => [], body: { classList: { toggle() {} } } },
      navigator: { onLine: true, mediaDevices: { getUserMedia() {} }, userAgent: 'test', ...extra.navigator },
      fetch: async p => ({ ok: true, status: 200, json: async () => routes[p] }), addEventListener() {}, isSecureContext: extra.secure ?? true };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('v9/vendor/qrcode.js'), ctx); vm.runInContext(read('turnstiles/qr-camera.js'), ctx); vm.runInContext(read('turnstiles/turnstiles.js'), ctx);
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    return root.innerHTML;
  }
  const f = fixture(), c = f.codes();
  f.scan(f.U.member, c[2]);
  const adminHtml = await boot('admin', { '/api/me': { user: { role: 'admin' } }, '/api/turnstiles': f.api('GET', '/api/turnstiles', {}, f.U.admin) });
  assert.equal((adminHtml.match(/<svg viewBox/g) || []).length, 3);
  for (const s of ['Turnike 1', 'Turnike 3', 'SİMÜLASYON', 'kopyalanabilir', 'QR kimliğini yenile', 'Pasif yap', 'Tüm QR kodlarını yazdır', 'Synthetic One', 'Giriş']) assert.ok(adminHtml.includes(s), s);
  const memberRoutes = { '/api/me': { user: { role: 'member' } }, '/api/turnstiles/me': f.api('GET', '/api/turnstiles/me', {}, f.U.member) };
  const memberHtml = await boot('member', memberRoutes);
  for (const s of ['Şu an salondasın', 'ÇIKIŞ kaydedilir', 'Kamerayı aç', 'Turnike 2', 'Ders rezervasyonun']) assert.ok(memberHtml.includes(s), s);
  assert.match(await boot('member', memberRoutes, { navigator: { mediaDevices: undefined } }), /desteklemiyor/);
  assert.match(await boot('member', memberRoutes, { secure: false }), /HTTPS gerekli/);
  assert.match(await boot('member', memberRoutes, { navigator: { onLine: false } }), /Bağlantı yok/);
});

test('rejected gate scans retain one audit event per code, outcome and minute', () => {
  const f = fixture(), code = PREFIX + '0'.repeat(32);
  assert.equal(f.scan(f.U.member, code, 'unknown-first').reason, 'unknown_code');
  assert.equal(f.scan(f.U.member, code, 'unknown-again').reason, 'unknown_code');
  assert.equal(f.scan(f.U.member, code, 'unknown-again').replayed, true);
  forbidden(() => f.scan(f.U.member, f.codes()[1], 'unknown-again'), 409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM gate_events').get().n, 1);
  f.tick(60000);
  assert.equal(f.scan(f.U.member, code, 'unknown-later').reason, 'unknown_code');
  assert.equal(f.db.prepare('SELECT count(*) n FROM gate_events').get().n, 2);
});
