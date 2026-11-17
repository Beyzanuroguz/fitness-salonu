const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.FITNESS_DB_PATH = ':memory:';
const { server, db } = require('../server');
let base;
test.before(async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
test('V9 explicit and directory entry points serve the actual homepage', async () => {
  const expected = fs.readFileSync(path.join(__dirname, '../public/v9/index.html'), 'utf8');
  for (const url of ['/v9/index.html', '/v9/', '/v9', '/v9/index.html?source=test']) {
    const r = await fetch(base + url);
    assert.equal(r.status, 200, url);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(await r.text(), expected);
  }
});
test('V7, V8 and root static entry points remain available', async () => {
  for (const url of ['/', '/v7.html', '/v7.js', '/v7.css', '/v8.html', '/v8.js', '/v8.css', '/v9/v9.js', '/v9/v9.css'])
    assert.equal((await fetch(base + url)).status, 200, url);
});
test('missing files and malformed paths fail without exposing files outside public', async () => {
  for (const url of ['/v9/missing.html', '/v9/%ZZ', '/%2e%2e%2fserver.js', '/v9/%2e%2e%2f%2e%2e%2fserver.js']) {
    const response = await new Promise((resolve, reject) => {
      http.get(base + url, r => { let body=''; r.on('data', c => body+=c); r.on('end', () => resolve({status:r.statusCode,body})); }).on('error', reject);
    });
    assert.ok([403,404].includes(response.status), url);
    assert.ok(['Yasak','Bulunamadı'].includes(response.body));
  }
});
