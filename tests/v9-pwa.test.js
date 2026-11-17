// V9 PWA files: manifest, icons, service worker scope and caching rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const file = p => path.join(pub, p.replace(/^\//, ''));
const pngSize = p => { const b = fs.readFileSync(file(p)); assert.equal(b.toString('ascii', 1, 4), 'PNG', p); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };

test('manifest is installable: scope, start_url, standalone and PNG icons 192/512', () => {
  const m = JSON.parse(fs.readFileSync(file('/v9/manifest.webmanifest'), 'utf8'));
  assert.equal(m.scope, '/v9/');
  assert.ok(m.start_url.startsWith('/v9/'));
  assert.ok(fs.existsSync(file(m.start_url.split('#')[0])), 'start_url exists as a file (no directory index on the server)');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.theme_color && m.background_color);
  for (const icon of m.icons) {
    assert.ok(fs.existsSync(file(icon.src)), icon.src);
    if (icon.type === 'image/png') assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  }
  const sizes = m.icons.filter(i => i.type === 'image/png' && i.purpose !== 'maskable').map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const s of m.shortcuts) assert.ok(s.url.startsWith('/v9/'));
});

test('index links manifest, apple icon and every script it loads exists', () => {
  const html = fs.readFileSync(file('/v9/index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="\/v9\/manifest.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /viewport-fit=cover/);
  for (const [, src] of html.matchAll(/(?:src|href)="(\/v9\/[^"]+)"/g)) assert.ok(fs.existsSync(file(src)), src);
  assert.equal(pngSize('/v9/icons/apple-touch-icon.png'), '180x180');
});

test('service worker precaches existing files, never caches /api/ and stays inside /v9/', () => {
  const sw = fs.readFileSync(file('/v9/sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/SHELL_FILES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const p of list) { assert.ok(p.startsWith('/v9/'), p); assert.ok(fs.existsSync(file(p)), p); }
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)\) return;/);
  assert.match(sw, /if \(!url\.pathname\.startsWith\('\/v9\/'\)\) return;/);
  assert.match(sw, /SKIP_WAITING/);
  const js = fs.readFileSync(file('/v9/v9.js'), 'utf8');
  assert.match(js, /register\('\/v9\/sw\.js', \{ scope: '\/v9\/' \}\)/);
});

test('Legacy pages do not register independent service workers', () => {
  for (const page of ['v7.html', 'v8.html']) assert.doesNotMatch(fs.readFileSync(file(page), 'utf8'), /serviceWorker|manifest/);
});

test('worker bypasses personal APIs, unknown resources and query URLs at runtime', async () => {
  const vm = require('node:vm');
  const handlers = {}, writes = [];
  const context = {
    URL, Response,
    self: { location: { origin: 'https://club.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: { match: async () => undefined, open: async () => ({ put: async (...args) => writes.push(args) }) },
    fetch: async () => new Response('static', { headers: { 'Cache-Control': 'no-store' } })
  };
  vm.runInNewContext(fs.readFileSync(file('/v9/sw.js'), 'utf8'), context);
  for (const pathname of ['/api/v9/qr', '/api/v9/reminders', '/api/v9/teacher/reports/monthly', '/v9/profile.json', '/v9/v9.js?token=secret']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url: 'https://club.test' + pathname }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, pathname);
  }
  let pending;
  handlers.fetch({ request: { method: 'GET', url: 'https://club.test/v9/v9.js' }, respondWith: p => { pending = p; } });
  await pending;
  assert.equal(writes.length, 0, 'no-store responses never enter Cache Storage');
  context.fetch = async () => new Response('static');
  handlers.fetch({ request: { method: 'GET', url: 'https://club.test/v9/v9.js' }, respondWith: p => { pending = p; } });
  await pending;
  assert.equal(writes.length, 1, 'allowlisted static assets may be cached');
});
