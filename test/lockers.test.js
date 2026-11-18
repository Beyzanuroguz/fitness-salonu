'use strict';
// Virtual lockers V1 (simulation): seeding, QR content, turnstile gating, one-active limits, idempotency,
// real two-connection concurrency, release, admin interventions with reason/actor/time, exit warnings, roles, HTTP, UI.
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const createLockers = require('../backend/lockers'), createTurnstiles = require('../backend/turnstiles');
const { PREFIX } = createLockers;

const SCHEMA = `CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY,name TEXT,status TEXT NOT NULL DEFAULT 'Aktif',expires TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT,role TEXT,member_id INTEGER,trainer_id INTEGER);
  INSERT OR IGNORE INTO members VALUES(1,'Synthetic One','Aktif','2099-12-31'),(2,'Synthetic Two','Aktif','2099-12-31'),(3,'Synthetic Expired','Aktif','2000-01-01');
  INSERT OR IGNORE INTO users VALUES(1,'syn-admin','admin',NULL,NULL),(2,'syn-one','member',1,NULL),(3,'syn-two','member',2,NULL),(4,'syn-expired','member',3,NULL),(5,'syn-teacher','teacher',NULL,1);`;
const U = { admin: { id: 1, role: 'admin' }, one: { id: 2, role: 'member', member_id: 1 }, two: { id: 3, role: 'member', member_id: 2 },
  expired: { id: 4, role: 'member', member_id: 3 }, teacher: { id: 5, role: 'teacher', trainer_id: 1 } };

function fixture({ actionLimit = 100, file = ':memory:' } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;' + SCHEMA);
  let now = Date.parse('2026-11-18T09:00:00Z');
  const clock = () => now;
  const lockers = createLockers(db, { clock, actionLimit });
  const gates = createTurnstiles(db, { clock, cooldownMs: 20000, scanLimit: 100, locker: lockers.gate });
  let n = 0;
  const k = () => 'key-' + (++n) + '-abcdef';
  const gateCode = id => gates('GET', '/api/turnstiles', {}, U.admin).turnstiles[id - 1].qr;
  const pass = u => { const r = gates('POST', '/api/turnstiles/scan', { code: gateCode(1), idempotency_key: k() }, u); now += 20000; return r; };
  const list = () => lockers('GET', '/api/lockers', {}, U.admin);
  const qr = id => list().lockers.find(l => l.id === id).qr;
  const claim = (u, code, key = k()) => lockers('POST', '/api/lockers/claim', { code, idempotency_key: key }, u);
  const mineId = u => lockers('GET', '/api/lockers/me', {}, u).locker?.assignment_id ?? 999999;
  const release = (u, key = k()) => lockers('POST', '/api/lockers/me/release', { idempotency_key: key, confirm: true, assignment_id: mineId(u) }, u);
  const onLocker = id => list().lockers.find(l => l.id === id).assignment?.id;
  return { db, lockers, gates, pass, list, qr, claim, release, onLocker, k, tick: ms => { now += ms; } };
}
const status = (fn, code) => assert.throws(fn, e => e.status === code, 'expected HTTP ' + code);

test('20 seeded lockers with unique scannable QR ids that carry no personal data; restart keeps them; admin can add', () => {
  const f = fixture(), d = f.list();
  assert.equal(d.lockers.length, 20);
  assert.deepEqual(d.counts, { available: 20, occupied: 0, maintenance: 0, inactive: 0 });
  assert.equal(new Set(d.lockers.map(l => l.qr)).size, 20);
  for (const l of d.lockers) assert.match(l.qr, new RegExp('^' + PREFIX.replace(/[:]/g, '\\:') + '[a-f0-9]{32}$'));
  assert.deepEqual(d.lockers.map(l => l.label).slice(0, 3), ['Dolap 1', 'Dolap 2', 'Dolap 3']);
  createLockers(f.db);
  assert.deepEqual(f.list().lockers.map(l => l.qr), d.lockers.map(l => l.qr), 'restart keeps printed codes');
  const add = f.lockers('POST', '/api/lockers', { idempotency_key: 'add-locker-0001' }, U.admin);
  assert.equal(add.locker.label, 'Dolap 21');
  assert.equal(f.lockers('POST', '/api/lockers', { idempotency_key: 'add-locker-0001' }, U.admin).replayed, true, 'double tap adds one locker');
  assert.equal(f.lockers('POST', '/api/lockers', { label: 'Kadın 1' }, U.admin).locker.label, 'Kadın 1');
  status(() => f.lockers('POST', '/api/lockers', { label: 'Kadın 1' }, U.admin), 409);
  status(() => f.lockers('POST', '/api/lockers', { label: '<b>x</b>' }, U.admin), 400);
  assert.equal(f.list().lockers.length, 22);
  assert.ok(f.list().events.some(e => e.action === 'create' && e.actor === 'syn-admin'));
});

test('claim needs a successful turnstile entry (gate_presence) and an active membership; clear Turkish reasons', () => {
  const f = fixture();
  let r = f.claim(U.one, f.qr(1));
  assert.equal(r.ok, false); assert.equal(r.reason, 'not_inside'); assert.match(r.message, /turnikeden giriş/);
  assert.equal(f.claim(U.one, 'https://example.com').reason, 'invalid_code');
  assert.equal(f.claim(U.one, f.gates('GET', '/api/turnstiles', {}, U.admin).turnstiles[0].qr).reason, 'gate_code');
  assert.equal(f.claim(U.one, PREFIX + 'f'.repeat(32)).reason, 'unknown_code');
  assert.equal(f.pass(U.one).direction, 'in');
  r = f.claim(U.one, f.qr(1));
  assert.equal(r.ok, true); assert.equal(r.locker, 'Dolap 1'); assert.equal(r.simulation, true);
  const me = f.lockers('GET', '/api/lockers/me', {}, U.one);
  assert.equal(me.inside, true); assert.equal(me.locker.label, 'Dolap 1'); assert.equal(typeof me.locker.since, 'number');
  assert.equal(f.claim(U.one, f.qr(1)).reason, 'already_yours');
  assert.equal(f.claim(U.one, f.qr(2)).reason, 'has_locker', 'one active locker per member');
  // Expired membership: the gate refuses entry, so the locker is refused too; force presence to prove the membership check.
  assert.equal(f.pass(U.expired).reason, 'membership');
  f.db.prepare('INSERT INTO gate_presence(member_id,inside,changed_at) VALUES(3,1,0)').run();
  assert.equal(f.claim(U.expired, f.qr(3)).reason, 'membership');
  assert.equal(f.list().counts.occupied, 1);
});

test('one active assignment per locker; second member gets "occupied"; idempotent replay; DB constraint is the backstop', () => {
  const f = fixture();
  f.pass(U.one); f.pass(U.two);
  const first = f.claim(U.one, f.qr(5), 'same-key-0001');
  assert.equal(first.ok, true);
  const replay = f.claim(U.one, f.qr(5), 'same-key-0001');
  assert.equal(replay.replayed, true); assert.equal(replay.ok, true); assert.equal(replay.at, first.at);
  assert.equal(f.db.prepare("SELECT count(*) n FROM locker_events WHERE action='claim'").get().n, 1);
  const other = f.claim(U.two, f.qr(5));
  assert.equal(other.ok, false); assert.equal(other.reason, 'occupied'); assert.match(other.message, /dolu/);
  status(() => f.release(U.one, 'same-key-0001'), 409);
  status(() => f.claim(U.one, f.qr(6), 'same-key-0001'), 409, 'same key with a different QR is refused, not replayed');
  for (const key of [undefined, 'short', 'x'.repeat(65), 'bad key!!']) status(() => f.lockers('POST', '/api/lockers/claim', { code: f.qr(6), idempotency_key: key }, U.two), 400);
  const ins = (locker, member) => f.db.prepare("INSERT INTO locker_assignments(locker_id,member_id,source,started_by,started_at) VALUES(?,?,'admin',1,0)").run(locker, member);
  assert.throws(() => ins(5, 2), /UNIQUE/);
  assert.throws(() => ins(6, 1), /UNIQUE/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM locker_assignments WHERE ended_at IS NULL').get().n, 1);
});

test('concurrency: two members on two separate DB connections claim the same locker at the same instant; exactly one wins', async () => {
  const { Worker } = require('node:worker_threads');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formclub-locker-')), file = path.join(dir, 'isolated.sqlite');
  try {
    const f = fixture({ file });
    f.db.exec('PRAGMA journal_mode=WAL');
    f.pass(U.one); f.pass(U.two);
    const code = f.qr(7);
    f.db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(8));
    const src = `const { workerData: w, parentPort } = require('node:worker_threads'); const { DatabaseSync } = require('node:sqlite');
      // Start-up runs one at a time (as one server process would); only the claims race.
      while (Atomics.load(w.barrier, 1) !== w.turn) {}
      const db = new DatabaseSync(w.file); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
      const lockers = require(w.mod)(db, { clock: () => Date.parse('2026-11-18T10:00:00Z') });
      Atomics.add(w.barrier, 1, 1);
      Atomics.add(w.barrier, 0, 1); while (Atomics.load(w.barrier, 0) < 2) {}
      let out; try { out = lockers('POST', '/api/lockers/claim', { code: w.code, idempotency_key: 'race-key-' + w.user.id }, w.user); }
      catch (e) { out = { error: e.message }; } finally { db.close(); }
      parentPort.postMessage(out);`;
    const run = (user, turn) => new Promise((ok, no) => { const w = new Worker(src, { eval: true, workerData: { file, mod: require.resolve('../backend/lockers'), code, user, barrier, turn } }); w.once('message', ok); w.once('error', no); });
    const results = await Promise.all([run(U.one, 0), run(U.two, 1)]);
    assert.ok(results.every(r => !r.error), JSON.stringify(results));
    assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
    assert.equal(results.find(r => !r.ok).reason, 'occupied');
    const db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout=5000');
    assert.equal(db.prepare('SELECT count(*) n FROM locker_assignments WHERE locker_id=7 AND ended_at IS NULL').get().n, 1);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('member release needs confirmation, is idempotent, frees the locker; members cannot touch other lockers', () => {
  const f = fixture();
  f.pass(U.one); f.pass(U.two);
  f.claim(U.one, f.qr(2));
  status(() => f.lockers('POST', '/api/lockers/me/release', { idempotency_key: 'rel-key-0001' }, U.one), 400);
  status(() => f.lockers('POST', '/api/lockers/me/release', { idempotency_key: 'rel-key-0001', confirm: true }, U.one), 400);
  status(() => f.lockers('POST', '/api/lockers/me/release', { idempotency_key: 'rel-key-0001', confirm: true, assignment_id: 424242 }, U.one), 409);
  // Another member has no way to release, assign or see someone else's locker.
  assert.equal(f.release(U.two).reason, 'no_locker');
  for (const [m, p, b] of [['GET', '/api/lockers', {}], ['POST', '/api/lockers/2/release', { reason: 'deneme' }], ['POST', '/api/lockers/2/assign', { member_id: 2, reason: 'deneme' }],
    ['PATCH', '/api/lockers/2', { status: 'inactive', reason: 'deneme' }], ['POST', '/api/lockers/2/rotate', { reason: 'deneme' }], ['POST', '/api/lockers', {}]]) {
    status(() => f.lockers(m, p, b, U.two), 403);
    status(() => f.lockers(m, p, b, U.teacher), 403);
  }
  const mineTwo = f.lockers('GET', '/api/lockers/me', {}, U.two);
  assert.equal(mineTwo.locker, null);
  assert.ok(mineTwo.events.every(e => e.member !== 'Synthetic One'), 'members see only their own events');
  assert.ok(mineTwo.events.every(e => !('note' in e) && !('actor' in e)), 'admin notes and actor names stay internal');
  const body = { idempotency_key: 'rel-key-0002', confirm: true, assignment_id: f.lockers('GET', '/api/lockers/me', {}, U.one).locker.assignment_id };
  const r = f.lockers('POST', '/api/lockers/me/release', body, U.one);
  assert.equal(r.ok, true); assert.equal(r.locker, 'Dolap 2');
  assert.equal(f.lockers('POST', '/api/lockers/me/release', body, U.one).replayed, true);
  assert.equal(f.release(U.one).reason, 'no_locker');
  assert.equal(f.list().counts.occupied, 0);
  assert.equal(f.claim(U.two, f.qr(2)).ok, true, 'released locker can be claimed by another member');
});

test('admin interventions: reason required, actor and time stored; maintenance/passive block claims; rotation revokes old QR', () => {
  const f = fixture();
  f.pass(U.one); f.pass(U.two);
  status(() => f.lockers('PATCH', '/api/lockers/3', { status: 'maintenance' }, U.admin), 400);
  status(() => f.lockers('PATCH', '/api/lockers/3', { status: 'broken', reason: 'test sebep' }, U.admin), 400);
  assert.equal(f.lockers('PATCH', '/api/lockers/3', { status: 'maintenance', reason: 'Menteşe gevşek' }, U.admin).locker.state, 'maintenance');
  assert.equal(f.lockers('PATCH', '/api/lockers/4', { status: 'inactive', reason: 'Kullanım dışı' }, U.admin).locker.state_label, 'Pasif');
  assert.equal(f.claim(U.one, f.qr(3)).reason, 'maintenance');
  assert.equal(f.claim(U.one, f.qr(4)).reason, 'inactive');
  status(() => f.lockers('POST', '/api/lockers/3/assign', { member_id: 1, reason: 'resepsiyon' }, U.admin), 409);
  const old = f.qr(5);
  f.lockers('POST', '/api/lockers/5/rotate', { reason: 'Kod sızdı' }, U.admin);
  assert.equal(f.claim(U.one, old).reason, 'unknown_code', 'old printed code is revoked');
  // Manual assignment and release.
  status(() => f.lockers('POST', '/api/lockers/6/assign', { member_id: 1 }, U.admin), 400);
  assert.equal(f.lockers('POST', '/api/lockers/6/assign', { member_id: 1, reason: 'Resepsiyon talebi' }, U.admin).locker.assignment.member, 'Synthetic One');
  status(() => f.lockers('POST', '/api/lockers/7/assign', { member_id: 1, reason: 'İkinci dolap' }, U.admin), 409);
  status(() => f.lockers('POST', '/api/lockers/6/assign', { member_id: 2, reason: 'Dolu dolap' }, U.admin), 409);
  status(() => f.lockers('PATCH', '/api/lockers/6', { status: 'maintenance', reason: 'Dolu iken' }, U.admin), 409);
  assert.equal(f.lockers('GET', '/api/lockers/me', {}, U.one).locker.source, 'admin');
  const held = f.onLocker(6);
  status(() => f.lockers('POST', '/api/lockers/6/release', { reason: 'Eski ekran', assignment_id: held + 1 }, U.admin), 409);
  assert.equal(f.lockers('POST', '/api/lockers/6/release', { reason: 'Üye anahtarı bıraktı', assignment_id: held, idempotency_key: 'adm-rel-0001' }, U.admin).locker.state, 'available');
  assert.equal(f.lockers('POST', '/api/lockers/6/release', { reason: 'Üye anahtarı bıraktı', assignment_id: held, idempotency_key: 'adm-rel-0001' }, U.admin).replayed, true);
  status(() => f.lockers('POST', '/api/lockers/7/rotate', { reason: 'Başka işlem', idempotency_key: 'adm-rel-0001' }, U.admin), 409);
  status(() => f.lockers('POST', '/api/lockers/6/release', { reason: 'Tekrar', assignment_id: held }, U.admin), 409);
  status(() => f.lockers('PATCH', '/api/lockers/999', { status: 'inactive', reason: 'yok' }, U.admin), 404);
  const ev = f.list().events;
  for (const [action, note] of [['status', 'Menteşe gevşek'], ['rotate', 'Kod sızdı'], ['admin_assign', 'Resepsiyon talebi'], ['admin_release', 'Üye anahtarı bıraktı']]) {
    const e = ev.find(x => x.action === action && x.note === note);
    assert.ok(e, action); assert.equal(e.actor, 'syn-admin'); assert.equal(e.actor_role, 'admin'); assert.equal(typeof e.at, 'number'); assert.ok(e.action_label);
  }
  assert.equal(ev.find(x => x.action === 'status' && x.note === 'Menteşe gevşek').detail, 'Boş → Bakımda');
  assert.deepEqual(f.list().counts, { available: 18, occupied: 0, maintenance: 1, inactive: 1 });
});

test('exit with a locker: gate never blocks, exit is recorded, locker stays assigned, admin alert and member warning; release resolves', () => {
  const f = fixture();
  f.pass(U.one);
  f.claim(U.one, f.qr(9));
  const gateMe = f.gates('GET', '/api/turnstiles/me', {}, U.one);
  assert.equal(gateMe.locker.label, 'Dolap 9', 'gate screen knows the member still holds a locker');
  const exit = f.pass(U.one);
  assert.equal(exit.ok, true); assert.equal(exit.direction, 'out');
  assert.match(exit.locker_warning.message, /Dolap 9 hâlâ sende/);
  assert.equal(f.gates('GET', '/api/turnstiles/me', {}, U.one).inside, false, 'gate_presence flipped to outside');
  const d = f.list();
  assert.equal(d.lockers.find(l => l.id === 9).state, 'occupied', 'assignment kept');
  assert.equal(d.alerts.length, 1); assert.match(d.alerts[0].message, /Synthetic One turnikeden çıktı, Dolap 9/);
  assert.ok(d.events.some(e => e.action === 'exit_warning'));
  const me = f.lockers('GET', '/api/lockers/me', {}, U.one);
  assert.equal(me.inside, false); assert.match(me.alert.message, /hâlâ sende/);
  // Re-entry keeps the same locker; exit without a locker has no warning.
  assert.equal(f.pass(U.one).locker_warning, null);
  assert.equal(f.release(U.one).ok, true);
  assert.equal(f.list().alerts.length, 0, 'member release resolves the alert');
  assert.equal(f.pass(U.one).locker_warning, null);
  // Admin can also close an alert manually.
  f.pass(U.two); f.claim(U.two, f.qr(10)); f.pass(U.two);
  const al = f.list().alerts[0];
  f.lockers('POST', `/api/lockers/alerts/${al.id}/resolve`, { note: 'Telefonla arandı' }, U.admin);
  assert.equal(f.list().alerts.length, 0);
  status(() => f.lockers('POST', `/api/lockers/alerts/${al.id}/resolve`, {}, U.admin), 409);
  assert.equal(f.list().lockers.find(l => l.id === 10).state, 'occupied');
  // A failing locker hook never undoes the exit itself.
  f.pass(U.two);
  f.db.exec("CREATE TRIGGER boom BEFORE INSERT ON locker_alerts BEGIN SELECT RAISE(ABORT,'boom'); END");
  const err = console.error; console.error = () => {};
  try { const out = f.pass(U.two); assert.equal(out.ok, true); assert.equal(out.direction, 'out'); assert.equal(out.locker_warning, null); }
  finally { console.error = err; }
  assert.equal(f.gates('GET', '/api/turnstiles/me', {}, U.two).inside, false);
});

test('per-user claim rate limit and unauthenticated access', () => {
  const f = fixture({ actionLimit: 3 });
  for (let i = 0; i < 3; i++) f.claim(U.one, 'x');
  status(() => f.claim(U.one, 'x'), 429);
  status(() => f.lockers('GET', '/api/lockers/me', {}, null), 401);
  status(() => f.lockers('GET', '/api/lockers/me', {}, U.admin), 403);
  status(() => f.lockers('GET', '/api/lockers/nope', {}, U.admin), 404);
});

test('printed locker QR decodes back to the exact locker code with the bundled scanner library', () => {
  const qrcode = require('../public/v9/vendor/qrcode.js'), jsQR = require('../public/v9/vendor/jsQR.js');
  for (const { qr: code } of fixture().list().lockers.slice(0, 3)) {
    const qr = qrcode(0, 'M'); qr.addData(code, 'Byte'); qr.make();
    const n = qr.getModuleCount(), s = 6, q = 4, W = (n + 2 * q) * s, px = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = (((r + q) * s + y) * W + (col + q) * s + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    assert.equal(jsQR(px, W, W)?.data, code);
  }
});

test('HTTP: session, CSRF, JSON-only, concurrent requests, static module under CSP, menu entries per role', async t => {
  process.env.NODE_ENV = 'test'; process.env.FITNESS_DB_PATH = ':memory:';
  const { once } = require('node:events');
  const { server, db } = require('../server');
  t.after(async () => { await new Promise(r => server.close(r)); db.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (p, method = 'GET', body, cookie, headers = {}) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await req('/api/lockers')).status, 401);
  const admin = (await req('/api/setup', 'POST', { username: 'locker-admin', password: 'isolated-password-123' })).headers.get('set-cookie').split(';')[0];
  const ids = db.prepare("SELECT id FROM members WHERE status='Aktif' AND expires>=date('now') ORDER BY id LIMIT 2").all().map(r => r.id);
  const cookies = [];
  for (const [i, id] of ids.entries()) {
    assert.equal((await req('/api/users', 'POST', { username: 'locker-member-' + i, password: 'isolated-password-123', role: 'member', member_id: id }, admin)).status, 200);
    cookies.push((await req('/api/login', 'POST', { username: 'locker-member-' + i, password: 'isolated-password-123' })).headers.get('set-cookie').split(';')[0]);
  }
  const list = await req('/api/lockers', 'GET', null, admin);
  assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store'); assert.equal(list.headers.get('access-control-allow-origin'), null);
  const data = await list.json();
  assert.equal(data.lockers.length, 20); assert.equal(data.ephemeral, false);
  const code = data.lockers[0].qr;
  assert.equal((await req('/api/lockers', 'GET', null, cookies[0])).status, 403);
  assert.equal((await req('/api/lockers/claim', 'POST', { code, idempotency_key: 'http-lock-0001' }, cookies[0], { origin: 'https://evil.test' })).status, 403);
  assert.equal((await req('/api/lockers/claim', 'POST', { code, idempotency_key: 'http-lock-0001' }, cookies[0], { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await fetch(base + '/api/lockers/claim', { method: 'POST', headers: { cookie: cookies[0], 'Content-Type': 'text/plain' }, body: JSON.stringify({ code, idempotency_key: 'http-lock-0002' }) })).status, 415);
  assert.equal((await (await req('/api/lockers/claim', 'POST', { code, idempotency_key: 'http-lock-0003' }, cookies[0])).json()).reason, 'not_inside');
  const gate = (await (await req('/api/turnstiles', 'GET', null, admin)).json()).turnstiles[0].qr;
  for (const [i, c] of cookies.entries()) assert.equal((await (await req('/api/turnstiles/scan', 'POST', { code: gate, idempotency_key: 'http-gate-000' + i }, c)).json()).direction, 'in');
  const both = await Promise.all(cookies.map((c, i) => req('/api/lockers/claim', 'POST', { code, idempotency_key: 'http-race-000' + i }, c).then(r => r.json())));
  assert.equal(both.filter(r => r.ok).length, 1, JSON.stringify(both)); assert.equal(both.find(r => !r.ok).reason, 'occupied');
  assert.equal((await (await req('/api/lockers', 'GET', null, admin)).json()).counts.occupied, 1);
  for (const p of ['/lockers/', '/lockers/lockers.js', '/lockers/lockers.css', '/turnstiles/qr-camera.js']) { const r = await req(p); assert.equal(r.status, 200, p); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); }
  const html = await (await req('/lockers/')).text();
  assert.doesNotMatch(html, /<script>|\son[a-z]+="/, 'no inline script or handlers');
  await req('/api/logout', 'POST', {}, cookies[0]); assert.equal((await req('/api/lockers/me', 'GET', null, cookies[0])).status, 401);
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(app, /navItems\.admin\.push\(\['lockers','▦','Dolap Yönetimi'\]\);navItems\.member\.push\(\['lockerScan','▦','Dolap QR Tara'\],\['locker','▣','Dolabım'\]\)/);
  assert.doesNotMatch(app, /navItems\.teacher\.push\(\['(?:lockers|lockerScan|locker)'/);
  assert.match(app, /navItems\.member\.push\(\['gate','⇆','Turnike QR Tara'\]\)/, 'turnstile entry kept');
  assert.match(app, /\['entry','scan','performance','notifications'\]\.includes\(page\)/, 'legacy QR entry kept');
});

test('UI renders admin locker management and member scan / my-locker views (vm, no browser)', async () => {
  const vm = require('node:vm');
  const read = p => fs.readFileSync(path.join(__dirname, '../public', p), 'utf8');
  async function boot(routes, { hash = '', secure = true, navigator = {} } = {}) {
    const root = { innerHTML: '', addEventListener() {} };
    const ctx = { console, setTimeout, clearTimeout, setInterval: () => 0, URLSearchParams, Date, crypto: globalThis.crypto, location: { hash },
      document: { getElementById: id => id === 'locker-root' ? root : null, addEventListener() {}, hidden: false, querySelectorAll: () => [], body: { classList: { toggle() {} } } },
      navigator: { onLine: true, mediaDevices: { getUserMedia() {} }, userAgent: 'test', ...navigator },
      fetch: async p => ({ ok: true, status: 200, json: async () => routes[p] }), addEventListener() {}, isSecureContext: secure };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const file of ['v9/vendor/qrcode.js', 'turnstiles/qr-camera.js', 'lockers/lockers.js']) vm.runInContext(read(file), ctx);
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    return root.innerHTML;
  }
  const f = fixture();
  f.pass(U.one); f.claim(U.one, f.qr(4)); f.pass(U.one);
  f.lockers('PATCH', '/api/lockers/2', { status: 'maintenance', reason: 'Menteşe' }, U.admin);
  const adminHtml = await boot({ '/api/me': { user: { role: 'admin' } }, '/api/lockers': f.list() });
  assert.equal((adminHtml.match(/aria-label="Dolap QR kodu"/g) || []).length, 20);
  for (const s of ['Dolap Yönetimi', 'SİMÜLASYON', 'Boş', 'Dolu', 'Bakımda', 'Pasif', 'Açık uyarı', 'Synthetic One turnikeden çıktı', 'Dolap ekle', 'Tüm QR kodlarını yazdır',
    'manuel boşalt', 'Üye ata', 'QR yenile', 'Dolap işlem kayıtları', 'Menteşe', 'Dolapla çıkış uyarısı', 'kopyalanabilir']) assert.ok(adminHtml.includes(s), s);
  // UI/UX V2: compact header icons, dropdown filter with counts, card icons + more menu, notes collapsed at the bottom.
  for (const s of ['aria-label="Tüm QR kodlarını yazdır"', 'aria-label="Listeyi yenile"', 'aria-label="Dolap ekle"', '<select id="lk-filter">', '>Tümü (20)</option>', '>Bakımda (1)</option>',
    'aria-label="Dolap 1 QR kodunu yazdır"', 'aria-label="Dolap 1 QR kimliğini yenile"', 'aria-label="Dolap 1 için diğer işlemler"', '>Dolap 01</h2>', 'Atanmamış', '20 dolap']) assert.ok(adminHtml.includes(s), s);
  for (const b of adminHtml.match(/<button type="button" class="icon-btn[^>]*>/g)) { assert.match(b, /aria-label="[^"]+"/); assert.match(b, /title="[^"]+"/); }
  assert.doesNotMatch(adminHtml, /data-act="filter"/, 'old filter buttons removed');
  assert.match(adminHtml, /<details class="card lk-notes no-print"><summary>Bilgilendirme ve Güvenlik Notları<\/summary>/);
  assert.ok(adminHtml.indexOf('lk-notes') > adminHtml.indexOf('Dolap işlem kayıtları'), 'notes sit at the bottom');
  assert.ok(adminHtml.indexOf('SİMÜLASYON') > adminHtml.indexOf('locker-grid'), 'simulation note no longer above the content');
  assert.ok(adminHtml.indexOf('Uyarılar: dolapla çıkış') < adminHtml.indexOf('locker-grid'), 'actionable alerts stay near the top');
  const ephemeral = await boot({ '/api/me': { user: { role: 'admin' } }, '/api/lockers': { ...f.list(), ephemeral: true } });
  assert.match(ephemeral, /yeniden başlayınca .*sıfırlanır/);
  const routes = { '/api/me': { user: { role: 'member' } }, '/api/lockers/me': f.lockers('GET', '/api/lockers/me', {}, U.one) };
  const mine = await boot(routes, { hash: '#locker' });
  for (const s of ['Dolabım', 'Dolap 4', 'Tahsis saati', 'Dolabı bırak', 'Dolabın hâlâ sende', 'Dolap geçmişim', 'Dolap alındı']) assert.ok(mine.includes(s), s);
  const scan = await boot(routes, { hash: '#lockerScan' });
  for (const s of ['Dolap QR Tara', 'Kamerayı aç', 'Şu an dışarıdasın', 'Önce turnike girişi', 'href="/#gate"']) assert.ok(scan.includes(s), s);
  assert.match(await boot(routes, { hash: '#lockerScan', secure: false }), /HTTPS gerekli/);
  assert.match(await boot(routes, { hash: '#lockerScan', navigator: { mediaDevices: undefined } }), /desteklemiyor/);
  assert.match(await boot(routes, { hash: '#lockerScan', navigator: { onLine: false } }), /Bağlantı yok/);
  // Turnstile member screen warns about a held locker before and after exit.
  const gateJs = read('turnstiles/turnstiles.js');
  assert.match(gateJs, /Dolabın hâlâ sende/); assert.match(gateJs, /Çıkışın engellenmez/); assert.match(gateJs, /locker_warning/);
});
