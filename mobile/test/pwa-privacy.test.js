'use strict';
// Guards the web app the shell loads: the root worker never stores personal API data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = path.join(__dirname, '..', '..', 'public');

test('root worker bypasses APIs and query URLs and only caches allowlisted files', async () => {
  const handlers = {}, writes = [];
  const context = { URL, Response, self: { location: { origin: 'https://club.test' }, addEventListener: (n, f) => { handlers[n] = f; } },
    caches: { match: async () => undefined, open: async () => ({ put: async (...a) => writes.push(a) }) },
    fetch: async () => new Response('x', { headers: { 'Cache-Control': 'no-store' } }) };
  vm.runInNewContext(fs.readFileSync(path.join(pub, 'sw.js'), 'utf8'), context);
  for (const p of ['/api/me', '/api/v9/qr', '/app.js?token=a', '/v9/index.html?embedded=1', '/private.json']) {
    let hit = false;
    handlers.fetch({ request: { method: 'GET', url: 'https://club.test' + p }, respondWith: () => { hit = true; } });
    assert.equal(hit, false, p);
  }
  let pending;
  handlers.fetch({ request: { method: 'GET', url: 'https://club.test/app.js' }, respondWith: p => { pending = p; }, waitUntil: p => p });
  await pending;
  assert.equal(writes.length, 0, 'no-store responses are not cached');
});

test('mobile shell meta and safe-area support are present', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(fs.readFileSync(path.join(pub, 'style.css'), 'utf8'), /safe-area-inset-bottom/);
});

test('QR scanner explains HTTPS and permission denial', () => {
  const js = fs.readFileSync(path.join(pub, 'v9', 'v9.js'), 'utf8');
  assert.match(js, /HTTPS/);
  assert.match(js, /NotAllowedError/);
  assert.match(js, /NotReadableError/);
  const K = require(path.join(pub, 'v9', 'v9-core.js'));
  assert.match(K.scanErrorText({ status: 422, message: 'QR geçersiz, kullanılmış veya süresi dolmuş' }), /yeni kodu/);
  assert.match(K.scanErrorText({ status: 403, message: 'Aktif üyelik gerekli' }), /Üyelik aktif değil/);
  assert.match(K.scanErrorText({ status: 0, offline: true }), /Bağlantı yok/);
});
