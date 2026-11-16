const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const createNutrition = require('../backend/nutrition');

function fixture(fetcher) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3)');
  const handle = createNutrition(db, fetcher);
  return { db, call: (method, path, body = {}, user = { id: 1, member_id: 1 }) => handle(method, '/api/v8' + path, body, user) };
}
const food = { name: 'Test yulaf', kcal_100g: 400, protein_100g: 10, carbs_100g: 60, fat_100g: 8 };
const offProduct = { code: '12345678', product_name: 'Provider fixture', nutrition_data_per: '100g', nutriments: { 'energy-kcal_100g': 250, proteins_100g: 8, carbohydrates_100g: 42, fat_100g: 5 } };
const status = expected => error => error.status === expected;

test('manual product, portions, macro totals, deletion and immutable source', async t => {
  const { db, call } = fixture(); t.after(() => db.close());
  const p = await call('POST', '/foods', { ...food, source: 'USDA', source_url: 'forged' });
  assert.equal(p.source, 'manual'); assert.equal(p.source_url, null);
  const a = await call('POST', '/food-logs', { product_id: p.id, grams: 150, consumed_on: '2026-11-16' });
  await call('POST', '/food-logs', { product_id: p.id, grams: 25, consumed_on: '2026-11-16' });
  const history = await call('GET', '/nutrition/history', { date: '2026-11-16' });
  assert.deepEqual(history.totals, { kcal: 700, protein: 17.5, carbs: 105, fat: 14 });
  assert.equal(history.logs[0].nutrients.kcal, 600);
  await call('DELETE', '/food-logs/' + a.id);
  assert.equal((await call('GET', '/nutrition/history', { date: '2026-11-16' })).totals.kcal, 100);
});

test('strict owner isolation also applies to administrators, spoofed IDs and deletes', async t => {
  const { db, call } = fixture(); t.after(() => db.close());
  const product = await call('POST', '/foods', food);
  const log = await call('POST', '/food-logs', { product_id: product.id, grams: 100, consumed_on: '2026-11-16' });
  for (const role of ['member', 'admin', 'teacher']) {
    const other = { id: 2, member_id: 2, role };
    assert.deepEqual(await call('GET', '/foods', {}, other), []);
    assert.equal((await call('GET', '/nutrition/history', { date: '2026-11-16' }, other)).logs.length, 0);
    await assert.rejects(call('POST', '/food-logs', { product_id: product.id, grams: 100, consumed_on: '2026-11-16' }, other), status(404));
    await assert.rejects(call('DELETE', '/food-logs/' + log.id, {}, other), status(404));
    await assert.rejects(call('GET', '/nutrition/history', { user_id: 1 }, other), status(403));
    await assert.rejects(call('GET', '/nutrition/history', { member_id: 1 }, other), status(403));
  }
  await assert.rejects(call('GET', '/foods', {}, null), status(401));
});

test('calendar week and month averages include days without records, year boundaries and leap days', async t => {
  const { db, call } = fixture(); t.after(() => db.close());
  const p = await call('POST', '/foods', food);
  for (const consumed_on of ['2024-02-01', '2024-02-29', '2024-03-01', '2025-12-29', '2026-01-04', '2026-01-05']) {
    await call('POST', '/food-logs', { product_id: p.id, grams: 100, consumed_on });
  }
  const month = await call('GET', '/nutrition/history', { period: 'monthly', date: '2024-02-29' });
  assert.equal(month.days, 29); assert.equal(month.totals.kcal, 800); assert.equal(month.average_daily_kcal, 27.59);
  assert.equal(month.daily[1].kcal, 0);
  const week = await call('GET', '/nutrition/history', { period: 'weekly', date: '2026-01-04' });
  assert.equal(week.start, '2025-12-29'); assert.equal(week.end, '2026-01-04');
  assert.equal(week.totals.kcal, 800); assert.equal(week.average_daily_kcal, 114.29);
  const empty = await call('GET', '/nutrition/history', { period: 'monthly', date: '2026-04-16' });
  assert.equal(empty.days, 30); assert.equal(empty.average_daily_kcal, 0);
});

test('invalid dates, portions and nutrient values never create records', async t => {
  const { db, call } = fixture(); t.after(() => db.close());
  const p = await call('POST', '/foods', food);
  for (const grams of [0, -1, 5001, null, '', true, {}, 'NaN', Infinity]) {
    await assert.rejects(call('POST', '/food-logs', { product_id: p.id, grams, consumed_on: '2026-11-16' }), status(400));
  }
  for (const consumed_on of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', 'invalid']) {
    await assert.rejects(call('POST', '/food-logs', { product_id: p.id, grams: 100, consumed_on }), status(400));
  }
  for (const value of [-1, 1001, null, undefined, true]) await assert.rejects(call('POST', '/foods', { ...food, kcal_100g: value }), status(400));
  await assert.rejects(call('GET', '/nutrition/history', { period: 'yearly' }), status(400));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v8_food_logs').get().n, 0);
});

test('real provider contract, filtering, cache and selection refetch prevent client nutrient forgery', async t => {
  let calls = 0;
  const { db, call } = fixture(async (url, options) => {
    calls++;
    assert.ok(options.signal); assert.match(options.headers['User-Agent'], /FORM-CLUB/);
    return { ok: true, json: async () => String(url).includes('/api/v2/product/') ? { product: offProduct } : { hits: [{ code: offProduct.code }, { code: offProduct.code }, null, { code: '../invalid' }] } };
  });
  t.after(() => db.close());
  const search = await call('GET', '/foods/search', { q: 'yulaf' });
  assert.equal(search.products.length, 1);
  await call('GET', '/foods/search', { q: 'YULAF' }); assert.equal(calls, 2);
  const p = await call('POST', '/foods/select', { source_id: '12345678', kcal_100g: 999 });
  assert.equal(calls, 3); assert.equal(p.kcal_100g, 250); assert.equal(p.protein_100g, 8);
  assert.equal(p.source, 'Open Food Facts'); assert.equal(p.source_license, 'ODbL-1.0');
  assert.equal(p.source_url, 'https://world.openfoodfacts.org/product/12345678');
  assert.ok(Number.isFinite(Date.parse(p.retrieved_at)));
});

test('provider failures, timeouts, missing products and invalid source IDs', async t => {
  for (const provider of [async () => { throw Error('network'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } })]) {
    const { db, call } = fixture(provider);
    try { await assert.rejects(call('GET', '/foods/search', { q: 'test' }), status(502)); } finally { db.close(); }
  }
  const { db, call } = fixture(async () => ({ ok: true, json: async () => ({ product: {} }) }));
  t.after(() => db.close());
  await assert.rejects(call('POST', '/foods/select', { source_id: '12345678' }), status(422));
  await assert.rejects(call('POST', '/foods/select', { source_id: '../example' }), status(400));
  for (const product of [{ ...offProduct, nutriments: {} }, { ...offProduct, nutrition_data_per: '100ml' }, { ...offProduct, product_quantity_unit: 'ml' }]) {
    const invalid = fixture(async () => ({ ok: true, json: async () => ({ product }) }));
    try { await assert.rejects(invalid.call('POST', '/foods/select', { source_id: offProduct.code }), status(422)); } finally { invalid.db.close(); }
  }
  for (const [provider, message] of [
    [async () => ({ ok: false, status: 503 }), /HTTP 503/],
    [async () => { throw Object.assign(Error('timeout'), { name: 'TimeoutError' }); }, /zaman aşımına/],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }), /geçersiz JSON/],
    [async () => ({ ok: true, json: async () => ({ unexpected: [] }) }), /geçersiz arama/]
  ]) {
    const errorCase = fixture(provider);
    try {
      await assert.rejects(errorCase.call('GET', '/foods/search', { q: 'test' }), error => error.status === 502 && message.test(error.message));
      assert.equal(errorCase.db.prepare('SELECT COUNT(*) n FROM v8_foods').get().n, 0);
    } finally { errorCase.db.close(); }
  }
});

test('BMI and Mifflin-St Jeor estimates validate adult parameters and goal adjustments', async t => {
  const { db, call } = fixture(); t.after(() => db.close());
  assert.deepEqual(await call('POST', '/nutrition/bmi', { height_cm: 180, weight_kg: 80 }), { bmi: 24.69 });
  const inputs = { height_cm: 180, weight_kg: 80, age: 30, sex: 'male', activity: 'moderate', goal: 'maintain' };
  const estimate = await call('POST', '/nutrition/estimate', inputs);
  assert.equal(estimate.bmr, 1780); assert.equal(estimate.maintenance_kcal, 2759); assert.equal(estimate.target_kcal, 2759);
  assert.equal((await call('POST', '/nutrition/estimate', { ...inputs, goal: 'lose' })).target_kcal, 2459);
  assert.equal((await call('POST', '/nutrition/estimate', { ...inputs, goal: 'gain', sex: 'female' })).bmr, 1614);
  for (const invalid of [{ age: 17 }, { age: 30.5 }, { height_cm: 0 }, { weight_kg: null }, { activity: 'unknown' }, { goal: '__proto__' }, { sex: 'unknown' }]) {
    await assert.rejects(call('POST', '/nutrition/estimate', { ...inputs, ...invalid }), status(400));
  }
});
