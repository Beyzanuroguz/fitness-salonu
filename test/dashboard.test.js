const { test } = require('node:test');
const assert = require('node:assert/strict');
const dashboard = require('../public/dashboard');
const now = new Date(2026, 0, 20, 12);
function fixture() {
  return {
    state: {
      stats: { active: 2, todayEntries: 7 },
      members: [
        { id: 1, name: '<Deneme>', status: 'Aktif', expires: '2026-01-25', plan: 'Aylık' },
        { id: 2, name: 'Pasif', status: 'Pasif', expires: '2026-01-23' },
        { id: 3, name: 'Geçmiş', status: 'Aktif', expires: '2026-01-19' }
      ],
      payments: [
        { amount: 100, status: 'Ödendi', due_date: '2026-01-10', paid_at: '2026-01-09' },
        { amount: 50, status: 'Ödendi', due_date: '2026-01-11', paid_at: '2026-01-12' },
        { amount: 25, status: 'Ödendi', due_date: '2026-01-12', paid_at: null },
        { amount: 200, status: 'Bekliyor', due_date: '2026-01-15' },
        { amount: 300, status: 'Bekliyor', due_date: '2025-12-10' }
      ],
      bookings: [
        { starts_at: '2026-01-09T12:00:00', status: 'attended' },
        { starts_at: '2026-01-09T14:00:00', status: 'absent' },
        { starts_at: '2026-01-09T15:00:00', status: 'reserved' }
      ],
      classes: [
        { title: 'Pilates', starts_at: '2026-01-10T12:00:00', booked: 9, capacity: 10 },
        { title: 'Pilates', starts_at: '2026-01-11T12:00:00', booked: 1, capacity: 30 }
      ]
    },
    analytics: { monthly: [
      { month: '2024-01', collected: 400, attended: 3, marked: 4 },
      { month: '2025-12', collected: 100, attended: 2, marked: 4 },
      { month: '2026-01', collected: 175, attended: 1, marked: 2 }
    ], scores: [] }
  };
}

test('dashboard derives KPIs and weighted occupancy from supplied API records', () => {
  const { state, analytics } = fixture();
  const data = dashboard.model(state, analytics, dashboard.defaults(now), now);
  assert.equal(data.active, 2); assert.equal(data.entries, 7);
  assert.equal(data.pending, 500); assert.equal(data.monthRevenue, 175);
  assert.equal(data.expiring.length, 1); assert.equal(data.expiring[0].id, 1);
  assert.equal(data.occupancy[0].rate, 25); // 10/40, not the average of percentages.
  assert.equal(data.occupancyPartial, false);
  assert.deepEqual(data.payment, { total: 4, onTime: 1, late: 1, unknown: 1, pending: 1, score: 25 });
});

test('monthly comparisons cross year boundaries and use actual daily payments and marked attendance', () => {
  const { state, analytics } = fixture();
  const data = dashboard.model(state, analytics, dashboard.defaults(now), now);
  assert.equal(data.previousKey, '2025-12');
  assert.equal(data.current.collected, 175); assert.equal(data.previous.collected, 100);
  assert.equal(data.current.attendance, 50);
  assert.equal(data.paired[8].current.collected, 100);
  assert.equal(data.paired[8].current.attendance, 50);
  assert.equal(data.paired[11].current.collected, 75);
  assert.equal(data.paired[30].current.collected, null); // Future day is not invented zero.
});

test('year and month controls update period data and distinguish missing dates and zero records', () => {
  const { state, analytics } = fixture();
  const options = dashboard.defaults(now);
  dashboard.selection(options, 'mode', 'yearly');
  const annual = dashboard.model(state, analytics, options, now);
  assert.equal(annual.previousKey, '2025'); assert.equal(annual.previous.collected, 100);
  assert.equal(annual.paired.length, 12); assert.equal(annual.paired[0].current.collected, 175);
  assert.equal(annual.paired[1].current.collected, null);
  assert.equal(annual.occupancyPartial, false);
  dashboard.selection(options, 'year', '2024'); dashboard.selection(options, 'month', '2');
  dashboard.selection(options, 'mode', 'monthly');
  const leap = dashboard.model(state, analytics, options, now);
  assert.equal(leap.key, '2024-02'); assert.equal(leap.paired.length, 31);
  assert.equal(leap.paired[28].current.collected, 0);
  assert.equal(leap.paired[29].current, null); // February 30 is not a zero day.
  assert.equal(leap.current.attendance, null); // No marked attendance is not 0%.
  assert.equal(leap.occupancyPartial, true);
  dashboard.selection(options, 'compare', false);
  assert.equal(dashboard.model(state, analytics, options, now).paired.length, 29);
});

test('analytics failure remains unavailable rather than showing fabricated financial zeros', () => {
  const { state } = fixture();
  const data = dashboard.model(state, null, dashboard.defaults(now), now);
  assert.equal(data.available, false); assert.equal(data.current.collected, null);
  assert.equal(data.monthRevenue, null);
  const html = dashboard.render(state, null, dashboard.defaults(now), 'HTTP 503', now);
  assert.match(html, /role="alert"/); assert.match(html, /HTTP 503/);
  assert.match(html, /Tahsilat verisi kullanılamıyor/);
  assert.equal(data.pending, 500); // Other successful API records remain useful.
});

test('shared rendering escapes API content, exposes table alternatives and previous period toggle', () => {
  const { state, analytics } = fixture();
  const html = dashboard.render(state, analytics, dashboard.defaults(now), '', now);
  assert.match(html, /&lt;Deneme&gt;/); assert.doesNotMatch(html, /<Deneme>/);
  for (const field of ['year', 'month', 'mode', 'compare']) assert.ok(html.includes(`data-dashboard="${field}"`));
  assert.match(html, /Grafik verilerini tablo olarak göster/);
  const options = { ...dashboard.defaults(now), compare: false };
  assert.doesNotMatch(dashboard.render(state, analytics, options, '', now), /fc-bar-previous/);
});

test('main app opens the dashboard on administrator login and filter events redraw it', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { state, analytics } = fixture();
  const app = { innerHTML: '' }, events = new Map();
  let analyticsUnavailable = false;
  const context = vm.createContext({
    window: { addEventListener() {} }, navigator: { onLine: true }, location: { hash: '' },
    FormClubDashboard: dashboard,
    document: {
      getElementById: id => id === 'app' ? app : null,
      addEventListener: (name, handler) => { const list = events.get(name) || []; list.push(handler); events.set(name, list); }
    },
    fetch: async url => {
      const data = {
        '/api/me': { user: { id: 9, username: 'admin-test', role: 'admin' } },
        '/api/state': { ...state, trainers: [], announcements: [], measurements: [], checkins: [] },
        '/api/leads': [], '/api/v6/settings': {}, '/api/v6/community': [],
        '/api/v6/analytics': analytics, '/api/v6/foods': [], '/api/v6/food-logs?member_id=1': []
      };
      const failed = url === '/api/v6/analytics' && analyticsUnavailable;
      return { ok: !failed, json: async () => failed ? { error: 'Analitik test hatası' } : data[url] };
    }
  });
  const code = fs.readFileSync(require.resolve('../public/app.js'), 'utf8').replace(/refresh\(\);\s*$/, 'globalThis.ready=refresh();');
  vm.runInContext(code, context); await context.ready;
  assert.match(app.innerHTML, /fc-dashboard/); assert.match(app.innerHTML, /Aylık tahsilat/);
  await vm.runInContext("page='insights';account=null;refresh()", context);
  assert.match(app.innerHTML, /fc-dashboard/); // A fresh admin login resets the previous page.
  for (const handler of events.get('change')) handler({ target: { dataset: { dashboard: 'mode' }, type: 'select-one', value: 'yearly' } });
  assert.match(app.innerHTML, /Yıllık tahsilat/);
  analyticsUnavailable = true;
  await vm.runInContext('refresh()', context);
  assert.match(app.innerHTML, /Analitik test hatası/); assert.match(app.innerHTML, /Tahsilat verisi kullanılamıyor/);
  analyticsUnavailable = false;
  await vm.runInContext('refresh()', context);
  assert.doesNotMatch(app.innerHTML, /Analitik test hatası/);
});

test('V7 general view uses the same dashboard and existing read-only API endpoints', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { state, analytics } = fixture();
  const root = { innerHTML: '', querySelectorAll: () => [] }, requests = [];
  const context = vm.createContext({
    FormClubDashboard: dashboard,
    document: { getElementById: id => id === 'v7-root' ? root : null },
    fetch: async (url, options) => {
      requests.push([url, options]);
      const data = { '/api/me': { user: { id: 9, username: 'admin-test', role: 'admin' } }, '/api/state': state, '/api/v6/analytics': analytics, '/api/v6/settings': {} };
      return { ok: true, json: async () => data[url] };
    }
  });
  const code = fs.readFileSync(require.resolve('../public/v7.js'), 'utf8').replace(/init\(\);\s*\}\)\(\);\s*$/, 'globalThis.ready=init();\n})();');
  vm.runInContext(code, context); await context.ready;
  assert.match(root.innerHTML, /fc-dashboard/);
  assert.match(root.innerHTML, /Öğrenci devamlılığı/);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(([, options]) => !options.method || options.method === 'GET'));
});
