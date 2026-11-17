// Canonical backend contract with real SQLite identities and frontend helpers.
process.env.NODE_ENV = 'test';
process.env.FITNESS_DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../public/v9/v9-core');
const { db } = require('../server');
test.after(() => db.close());

test('canonical QR, reminders and report responses fit the frontend without widening roles', () => {
  const now = Date.parse('2028-02-28T09:00:00+03:00');
  const route = require('../backend/v9')(db, () => now);
  db.exec(`INSERT INTO users(id,username,password_hash,role,member_id,trainer_id) VALUES
    (901,'contract-member','unused','member',1,NULL),
    (902,'contract-admin','unused','admin',NULL,NULL),
    (903,'contract-teacher','unused','teacher',NULL,1);
    UPDATE members SET expires='2028-03-01',status='Aktif' WHERE id=1;
    INSERT INTO sessions VALUES('contract-session',901,9999999999999);
    DELETE FROM bookings; DELETE FROM classes; DELETE FROM payments;
    INSERT INTO classes(id,title,trainer_id,starts_at,capacity) VALUES
    (101,'Own',1,'2028-02-28T10:00:00',10),(102,'Other',2,'2028-02-28T10:00:00',20);
    INSERT INTO bookings(member_id,class_id,status) VALUES(1,101,'reserved'),(2,101,'attended'),(3,101,'absent');
    INSERT INTO payments(member_id,amount,status,due_date) VALUES(1,450,'Bekliyor','2028-02-28');`);
  const member = { ...db.prepare('SELECT * FROM users WHERE id=901').get(), session_hash: 'contract-session' };
  const admin = db.prepare('SELECT * FROM users WHERE id=902').get();
  const teacher = db.prepare('SELECT * FROM users WHERE id=903').get();
  const call = (method, path, body = {}, user = member) => route(method, path, body, user);
  const qr = K.normalizeQR(call('POST', K.ENDPOINTS.qr));
  assert.equal(qr.expiresIn, 60);
  assert.ok(K.isToken(qr.token));
  for (const user of [member, teacher]) assert.throws(() => call('POST', K.ENDPOINTS.checkin, { token: qr.token }, user), e => e.status === 403);
  assert.equal(call('POST', K.ENDPOINTS.checkin, { token: qr.token }, admin).ok, true);
  assert.throws(() => call('POST', K.ENDPOINTS.checkin, { token: qr.token }, admin), e => e.status === 422);
  const notes = K.normalizeNotifications(call('GET', K.ENDPOINTS.notifications));
  assert.deepEqual(new Set(notes.map(n => n.kind)), new Set(['expiry', 'class', 'payment']));
  assert.ok(notes.every(n => n.title && n.date && !n.read));
  call('POST', K.ENDPOINTS.notificationRead, { id: notes[0].id });
  assert.equal(K.unreadCount(K.normalizeNotifications(call('GET', K.ENDPOINTS.notifications))), notes.length - 1);
  for (const user of [admin, teacher]) assert.throws(() => call('GET', K.ENDPOINTS.notifications, {}, user), e => e.status === 403);
  const url = new URL(K.reportQuery(2028, 2), 'http://test');
  const report = K.normalizeReport(call('GET', url.pathname, Object.fromEntries(url.searchParams), teacher));
  assert.deepEqual(report.classes.map(c => c.id), [101]);
  assert.equal(report.classes[0].reservations, 2);
  assert.equal(report.attendance, 1);
  assert.equal(report.show_rate, 50);
  assert.equal(report.month, 2);
  for (const user of [admin, member]) assert.throws(() => call('GET', url.pathname, { month: '2028-02' }, user), e => e.status === 403);
  assert.throws(() => call('GET', url.pathname, { month: '2028-02', trainer_id: 2 }, teacher), e => e.status === 403);
});
