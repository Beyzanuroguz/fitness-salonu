// V8 frontend <-> V6 backend contract test. Runs a copy of server.js in a temp dir so the real database is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repo = path.join(__dirname, '..');
let dir, proc, base;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formclub-v8-'));
  fs.copyFileSync(path.join(repo, 'server.js'), path.join(dir, 'server.js'));
  fs.cpSync(path.join(repo, 'public'), path.join(dir, 'public'), { recursive: true });
  const port = 3900 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/me'); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw Error('server did not start');
});
test.after(() => { proc?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, json: await r.json() };
  };
}

test('V8 static files are served', async () => {
  for (const f of ['/v8.html', '/v8.js', '/v8-calc.js', '/v8.css']) assert.equal((await fetch(base + f)).status, 200, f);
});

test('food catalogue, diary and delete flow matches V8 usage', async () => {
  const admin = client(), member = client();
  assert.equal((await admin('/api/setup', 'POST', { username: 'admin', password: 'admin-pass-123' })).status, 200);
  const state = (await admin('/api/state')).json;
  const memberId = state.members[0].id;
  assert.equal((await admin('/api/users', 'POST', { username: 'uye1', password: 'uye-pass-1234', role: 'member', member_id: memberId })).status, 200);
  assert.equal((await member('/api/login', 'POST', { username: 'uye1', password: 'uye-pass-1234' })).status, 200);

  // Catalogue starts empty: no seeded food values.
  assert.deepEqual((await member('/api/v6/foods')).json, []);
  const created = await member('/api/v6/foods', 'POST', { name: 'Test ürünü', kcal_100g: 120, protein_100g: 22.5, carbs_100g: 0, fat_100g: 2.6 });
  assert.equal(created.status, 200);
  const foods = (await member('/api/v6/foods')).json;
  assert.deepEqual(Object.keys(foods[0]).sort(), ['carbs_100g', 'created_by', 'fat_100g', 'id', 'kcal_100g', 'name', 'protein_100g']);

  // Portion mode sends grams = count x portion size.
  const log = await member('/api/v6/food-logs', 'POST', { product_id: created.json.id, grams: 45, consumed_on: '2026-11-16' });
  assert.equal(log.status, 200);
  const logs = (await member('/api/v6/food-logs')).json;
  assert.equal(logs.length, 1);
  for (const k of ['id', 'consumed_on', 'grams', 'name', 'kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g']) assert.ok(k in logs[0], k);

  // Admin reads a member's diary with ?member_id= and can log on their behalf.
  assert.equal((await admin(`/api/v6/food-logs?member_id=${memberId}`)).json.length, 1);
  assert.equal((await admin('/api/v6/food-logs', 'POST', { member_id: memberId, product_id: created.json.id, grams: 100, consumed_on: '2026-11-15' })).status, 200);

  assert.equal((await member(`/api/v6/food-logs/${log.json.id}`, 'DELETE')).status, 200);
  assert.equal((await member('/api/v6/food-logs')).json.length, 1);
  assert.equal((await member('/api/v6/food-logs', 'POST', { product_id: created.json.id, grams: 0, consumed_on: '2026-11-16' })).status, 400);
});
