// V9 frontend pure helpers (public/v9/v9-core.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../public/v9/v9-core.js');

test('QR token shape matches the backend check and refresh happens before expiry', () => {
  assert.equal(K.isToken('eyJtIjoxfQ.abc_DEF-123'), true);
  for (const bad of ['', 'no-dot', 'a.b.c', 'a .b', 'a.b=', 'x'.repeat(1499) + '.b']) assert.equal(K.isToken(bad), false, bad);
  assert.deepEqual(K.normalizeQR({ token: 'abc.def', expires_in: 60 }), { token: 'abc.def', expiresIn: 60 });
  assert.equal(K.normalizeQR({ token: 'abc.def' }).expiresIn, 60);
  assert.throws(() => K.normalizeQR({ token: '<script>' }));
  assert.equal(K.refreshDelayMs(60), 55000);
  assert.equal(K.refreshDelayMs(3), 1000);
});

test('missing V9 routes and scan errors become readable Turkish messages', () => {
  assert.equal(K.isMissingApi({ status: 400, message: 'Endpoint bulunamadı' }), true);
  assert.equal(K.isMissingApi({ status: 404, message: 'x' }), true);
  assert.equal(K.isMissingApi({ status: 400, message: 'QR süresi dolmuş' }), false);
  assert.match(K.scanErrorText({ status: 409, message: 'Bu QR daha önce kullanıldı' }), /daha önce kullanıldı/);
  assert.equal(K.scanErrorText({ status: 400, message: 'QR süresi dolmuş' }), 'QR süresi dolmuş');
});

test('notifications: unread first, then soonest; kinds from id prefixes', () => {
  const list = K.normalizeNotifications([
    { id: 'payment:1', title: 'Bekleyen ödeme', detail: '300 ₺', date: '2026-11-20', read: true },
    { id: 'booking:4', title: 'Yaklaşan ders', detail: 'Pilates', date: '2026-11-18T18:30', read: false },
    { id: 'expiry:2026-11-17', title: 'Üyeliğin bitiyor', detail: '', date: '2026-11-17', read: false },
    { id: null, title: 'bozuk' }, null
  ]);
  assert.deepEqual(list.map(n => n.id), ['expiry:2026-11-17', 'booking:4', 'payment:1']);
  assert.deepEqual(list.map(n => n.kind), ['expiry', 'class', 'payment']);
  assert.equal(K.unreadCount(list), 2);
  assert.equal(K.noticeKind('admin-payment:3'), 'payment');
  assert.equal(K.noticeKind('teacher-class:9'), 'class');
  assert.equal(K.noticeKind('member-expiry:1:2026-11-20'), 'expiry');
});

test('relative day labels use local calendar days', () => {
  const now = new Date(2026, 10, 17, 9, 0);
  assert.equal(K.relativeDay('2026-11-17', now), 'Bugün');
  assert.equal(K.relativeDay('2026-11-18T18:30', now), 'Yarın 18:30');
  assert.equal(K.relativeDay('2026-11-16', now), 'Dün');
  assert.equal(K.relativeDay('2026-11-24', now), '7 gün sonra');
  assert.equal(K.relativeDay('bozuk', now), '');
});

test('trainer report: month math, query string, derived show rate', () => {
  assert.deepEqual(K.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(K.monthsBack(2026, 2, 3), [{ year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 }]);
  assert.equal(K.reportQuery(2026, 11, 3), '/api/v9/trainer-report?year=2026&month=11&trainer_id=3');
  assert.equal(K.reportQuery(2026, 11, null), '/api/v9/trainer-report?year=2026&month=11');
  const r = K.normalizeReport({ trainer: { id: 1, name: 'Ece' }, year: 2026, month: 11, class_count: 3, completed_classes: 2, attendance: 6, occupancy_percent: 50,
    classes: [{ id: 1, title: 'A', starts_at: '2026-11-02T10:00', capacity: 10, reservations: 4, attended: 3 }, { id: 2, title: 'B', starts_at: '2026-11-09T10:00', capacity: 10, reservations: 4, attended: 3 }, { id: 3, title: 'C', starts_at: '2026-11-30T10:00', capacity: 10, reservations: 7, attended: 0 }] });
  assert.equal(r.show_rate, 75); // 6 attended of 8 reservations in the two finished classes
  assert.equal(K.normalizeReport({ classes: [] }).show_rate, null);
  assert.throws(() => K.normalizeReport(null));
  assert.equal(K.niceMax(7), 10);
  assert.equal(K.niceMax(12), 20);
  assert.equal(K.niceMax(0), 1);
  assert.equal(K.shortDate('2026-11-02T10:00'), '02.11 10:00');
});
