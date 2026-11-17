// V9 frontend <-> backend contract. Runs the real backend/v9.js (or, until it is merged,
// the copy on origin/feature/v9-suite) against the main server's schema and feeds the
// responses through the same helpers the V9 UI uses. Skips when no V9 backend is available.
process.env.NODE_ENV = 'test';
process.env.FITNESS_DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const K = require('../public/v9/v9-core.js');

const repo = path.join(__dirname, '..');
function backendSource() {
  const local = path.join(repo, 'backend', 'v9.js');
  if (fs.existsSync(local)) return local;
  try {
    const src = execFileSync('git', ['show', 'origin/feature/v9-suite:backend/v9.js'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formclub-v9-contract-'));
    fs.writeFileSync(path.join(dir, 'v9.js'), src);
    return path.join(dir, 'v9.js');
  } catch { return null; }
}
const source = backendSource();

test('V9 API responses fit the frontend helpers', { skip: source ? false : 'backend/v9.js not available' }, async () => {
  const { db } = require('../server');
  const route = require(source)(db);
  const pad = n => String(n).padStart(2, '0');
  const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date(), soon = new Date(Date.now() + 3 * 86400000), past = new Date(Date.now() - 86400000), tomorrow = new Date(Date.now() + 86400000);

  const member = Number(db.prepare("INSERT INTO members(name,expires,status) VALUES('Kontrat Üye',?,'Aktif')").run(day(soon)).lastInsertRowid);
  const trainer = Number(db.prepare("INSERT INTO trainers(name,specialty) VALUES('Kontrat Eğitmen','Pilates')").run().lastInsertRowid);
  const doneClass = Number(db.prepare('INSERT INTO classes(title,trainer_id,starts_at,capacity) VALUES(?,?,?,10)').run('Sabah Pilates', trainer, day(past) + 'T09:00').lastInsertRowid);
  const nextClass = Number(db.prepare('INSERT INTO classes(title,trainer_id,starts_at,capacity) VALUES(?,?,?,10)').run('Akşam Pilates', trainer, day(tomorrow) + 'T18:30').lastInsertRowid);
  db.prepare("INSERT INTO bookings(member_id,class_id,status) VALUES(?,?,'attended')").run(member, doneClass);
  db.prepare("INSERT INTO bookings(member_id,class_id,status) VALUES(?,?,'reserved')").run(member, nextClass);
  db.prepare("INSERT INTO payments(member_id,amount,due_date) VALUES(?,450,?)").run(member, day(now));

  const memberUser = { id: 901, role: 'member', member_id: member };
  const adminUser = { id: 902, role: 'admin' };
  const teacherUser = { id: 903, role: 'teacher', trainer_id: trainer };

  // Member QR -> staff scan, single use.
  const qr = K.normalizeQR(await route('GET', '/api/v9/qr', {}, memberUser));
  assert.equal(qr.expiresIn, 60);
  assert.ok(K.isToken(qr.token));
  const ok = await route('POST', '/api/v9/checkin', { token: qr.token }, teacherUser);
  assert.equal(ok.ok, true);
  assert.equal(ok.member, 'Kontrat Üye');
  assert.ok(!Number.isNaN(Date.parse(ok.checked_in_at)));
  const replay = await Promise.resolve().then(() => route('POST', '/api/v9/checkin', { token: qr.token }, adminUser)).catch(e => e);
  assert.equal(replay.status, 409);
  assert.match(K.scanErrorText(replay), /daha önce kullanıldı/);
  const forged = await Promise.resolve().then(() => route('POST', '/api/v9/checkin', { token: qr.token.slice(0, -2) + 'AA' }, adminUser)).catch(e => e);
  assert.equal(forged.status, 400);
  const memberScan = await Promise.resolve().then(() => route('POST', '/api/v9/checkin', { token: qr.token }, memberUser)).catch(e => e);
  assert.equal(memberScan.status, 403);
  assert.equal((await Promise.resolve().then(() => route('GET', '/api/v9/qr', {}, adminUser)).catch(e => e)).status, 403);

  // Notifications for each role, then mark one read.
  const mine = K.normalizeNotifications(await route('GET', '/api/v9/notifications', {}, memberUser));
  assert.deepEqual(new Set(mine.map(n => n.kind)), new Set(['expiry', 'class', 'payment']));
  for (const n of mine) { assert.equal(typeof n.title, 'string'); assert.equal(n.read, false); assert.ok(K.relativeDay(n.date)); }
  assert.deepEqual(await route('POST', '/api/v9/notifications/read', { id: mine[0].id }, memberUser), { ok: true });
  const after = K.normalizeNotifications(await route('GET', '/api/v9/notifications', {}, memberUser));
  assert.equal(K.unreadCount(after), mine.length - 1);
  assert.equal(after.at(-1).read, true);
  assert.ok(K.normalizeNotifications(await route('GET', '/api/v9/notifications', {}, adminUser)).some(n => n.kind === 'expiry'));
  assert.ok(K.normalizeNotifications(await route('GET', '/api/v9/notifications', {}, teacherUser)).some(n => n.kind === 'class'));

  // Trainer report via the exact query string the UI builds.
  const ask = (user, trainerId, y = now.getFullYear(), m = now.getMonth() + 1) => {
    const url = new URL(K.reportQuery(y, m, trainerId), 'http://x');
    return route('GET', url.pathname, Object.fromEntries(url.searchParams), user);
  };
  const months = new Set([past, tomorrow].map(d => `${d.getFullYear()}-${d.getMonth() + 1}`));
  let classes = 0, attendance = 0;
  for (const key of months) {
    const [y, m] = key.split('-').map(Number);
    const r = K.normalizeReport(await ask(adminUser, trainer, y, m));
    assert.equal(r.trainer.name, 'Kontrat Eğitmen');
    for (const c of r.classes) for (const f of ['capacity', 'reservations', 'attended']) assert.equal(typeof c[f], 'number');
    classes += r.class_count; attendance += r.attendance;
    assert.deepEqual(K.normalizeReport(await ask(teacherUser, null, y, m)).classes.map(c => c.id), r.classes.map(c => c.id));
  }
  assert.equal(classes, 2);
  assert.equal(attendance, 1);
  assert.equal((await Promise.resolve().then(() => ask(adminUser, null)).catch(e => e)).status, 400);
  assert.equal((await Promise.resolve().then(() => ask(memberUser, trainer)).catch(e => e)).status, 403);
});
