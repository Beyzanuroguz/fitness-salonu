'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { bundleWeb } = require('../lib/web-bundle');

const publicDir = path.join(__dirname, '..', '..', 'public');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'formclub-bundle-'));

test('bundle copies only public files, drops service workers and writes native config', () => {
  const out = path.join(tmp(), 'web');
  const result = bundleWeb({ publicDir, outDir: out, apiUrl: 'https://api.example.com/' });
  assert.equal(result.apiBase, 'https://api.example.com');
  for (const f of ['index.html', 'app.js', 'v9/index.html', 'v9/v9.js', 'v8.html']) assert.ok(fs.existsSync(path.join(out, f)), f);
  for (const f of ['sw.js', 'v9/sw.js', 'server.js', 'backend']) assert.equal(fs.existsSync(path.join(out, f)), false, f);
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(out, 'runtime-config.js'), 'utf8'), ctx);
  assert.deepEqual({ ...ctx.window.FORMCLUB_CONFIG }, { apiBase: 'https://api.example.com', native: true });
  // The web server's own copy keeps same-origin defaults.
  const web = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'runtime-config.js'), 'utf8'), web);
  assert.deepEqual({ ...web.window.FORMCLUB_CONFIG }, { apiBase: '', native: false });
});

test('bundle refuses insecure API URLs and secret-looking files', () => {
  assert.throws(() => bundleWeb({ publicDir, outDir: path.join(tmp(), 'web'), apiUrl: 'http://api.example.com' }));
  const fake = tmp();
  fs.writeFileSync(path.join(fake, 'index.html'), '');
  fs.writeFileSync(path.join(fake, 'runtime-config.js'), '');
  fs.writeFileSync(path.join(fake, 'fitness.sqlite'), '');
  assert.throws(() => bundleWeb({ publicDir: fake, outDir: path.join(tmp(), 'web'), apiUrl: 'https://api.example.com' }), /sqlite/);
});

test('web pages load runtime-config.js before app code and API calls use its base', () => {
  for (const [page, first] of [['index.html', '/dashboard.js'], ['v8.html', '/v8-calc.js'], ['v9/index.html', '/v9/vendor/qrcode.js']]) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.ok(html.indexOf('/runtime-config.js') > 0 && html.indexOf('/runtime-config.js') < html.indexOf(first), page);
  }
  for (const f of ['app.js', 'v8.js', 'v9/v9.js']) assert.match(fs.readFileSync(path.join(publicDir, f), 'utf8'), /FORMCLUB_CONFIG\?\.apiBase/, f);
});

test('bundle cannot delete its source or parent directory',()=>{
 const root=tmp(),source=path.join(root,'public');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'index.html'),'sentinel');
 try{for(const out of [root,source,path.join(source,'nested')])assert.throws(()=>bundleWeb({publicDir:source,outDir:out,apiUrl:'https://api.example.com'}),/separate/);assert.equal(fs.readFileSync(path.join(source,'index.html'),'utf8'),'sentinel')}finally{fs.rmSync(root,{recursive:true,force:true})}
});
