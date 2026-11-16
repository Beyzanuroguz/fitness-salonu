const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('test mode refuses the application database before opening SQLite', () => {
  for (const database of ['', path.resolve(__dirname, '../fitness.sqlite')]) {
    const child = spawnSync(process.execPath, ['-e', "require('./server')"], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'test', FITNESS_DB_PATH: database }, encoding: 'utf8'
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Testler ayrı FITNESS_DB_PATH gerektirir/);
  }
});

test('HTTP login, authorization, V8 persistence, logout and V7 regression', async t => {
  process.env.NODE_ENV = 'test';
  process.env.FITNESS_DB_PATH = ':memory:';
  const { server, db } = require('../server');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, method = 'GET', body, cookie) {
    const response = await fetch(base + url, { method, headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request('/api/v8/foods')).status, 401);
  const admin = await request('/api/setup', 'POST', { username: 'admin-test', password: 'test-password-123' });
  assert.equal(admin.status, 200);
  for (const [username, member_id] of [['member-one', 1], ['member-two', 2]]) {
    assert.equal((await request('/api/users', 'POST', { username, password: 'test-password-123', role: 'member', member_id }, admin.cookie)).status, 200);
  }
  const one = await request('/api/login', 'POST', { username: 'member-one', password: 'test-password-123' });
  const two = await request('/api/login', 'POST', { username: 'member-two', password: 'test-password-123' });
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  const p = await request('/api/v8/foods', 'POST', { name: 'HTTP test', kcal_100g: 100, protein_100g: 10, carbs_100g: 10, fat_100g: 2 }, one.cookie);
  assert.equal(p.status, 200);
  const log = await request('/api/v8/food-logs', 'POST', { product_id: p.body.id, grams: 200, consumed_on: '2026-11-16' }, one.cookie);
  assert.equal(log.status, 200);
  const history = await request('/api/v8/nutrition/history?period=weekly&date=2026-11-16', 'GET', undefined, one.cookie);
  assert.equal(history.body.totals.kcal, 200); assert.equal(history.body.average_daily_kcal, 28.57);
  for (const cookie of [two.cookie, admin.cookie]) {
    assert.equal((await request('/api/v8/nutrition/history?date=2026-11-16', 'GET', undefined, cookie)).body.logs.length, 0);
    assert.equal((await request('/api/v8/food-logs/' + log.body.id, 'DELETE', {}, cookie)).status, 404);
  }
  assert.equal((await request('/api/v8/nutrition/history?user_id=1', 'GET', undefined, one.cookie)).status, 403);
  assert.equal((await request('/api/v8/foods', 'POST', null, one.cookie)).status, 400);
  assert.equal((await request('/api/v8/nonexistent', 'GET', undefined, one.cookie)).status, 404);
  const state = await request('/api/state', 'GET', undefined, one.cookie);
  assert.equal(state.status, 200); assert.equal(state.body.members.length, 1); assert.equal(state.body.members[0].id, 1);
  assert.equal((await request('/api/leads', 'GET', undefined, admin.cookie)).status, 200);
  assert.equal((await request('/api/v6/settings', 'GET', undefined, one.cookie)).status, 200);
  const legacy = await request('/api/v6/foods', 'POST', { name: 'V7 test', kcal_100g: 100 }, one.cookie);
  assert.equal(legacy.status, 200);
  assert.equal((await request('/api/v6/food-logs', 'POST', { product_id: legacy.body.id, member_id: 1, grams: 100, consumed_on: '2026-11-16' }, one.cookie)).status, 200);
  assert.equal((await request('/api/v6/food-logs', 'GET', undefined, two.cookie)).body.length, 0);
  assert.equal((await request('/api/v6/food-logs?member_id=1', 'GET', undefined, two.cookie)).body.length, 0);
  assert.equal((await fetch(base + '/v7.html')).status, 200);
  await request('/api/logout', 'POST', {}, one.cookie);
  assert.equal((await request('/api/v8/foods', 'GET', undefined, one.cookie)).status, 401);
});
