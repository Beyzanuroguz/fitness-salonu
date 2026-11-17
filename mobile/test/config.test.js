'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = env => {
  const keys = ['FORMCLUB_SERVER_URL', 'FORMCLUB_APP_ID', 'FORMCLUB_ALLOW_CLEARTEXT', 'FORMCLUB_MODE', 'FORMCLUB_API_URL'], saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  const file = require.resolve('../capacitor.config.js');
  delete require.cache[file];
  try { return require(file); } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

test('without a server URL the bundled setup page is used', () => {
  const c = load({});
  assert.equal(c.webDir, 'www');
  assert.equal(c.server, undefined);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'www', 'index.html')));
});

test('with a server URL the shell loads it over https only, with an offline page', () => {
  const c = load({ FORMCLUB_SERVER_URL: 'https://club.example.com' });
  assert.equal(c.server.url, 'https://club.example.com');
  assert.equal(c.server.cleartext, false);
  assert.deepEqual(c.server.allowNavigation, ['club.example.com']);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'www', c.server.errorPath)));
  assert.equal(c.android.allowMixedContent, false);
  assert.equal(c.android.webContentsDebuggingEnabled, false);
  assert.throws(() => load({ FORMCLUB_SERVER_URL: 'http://club.example.com' }));
});

test('bundled mode serves build/web locally and requires an https API URL', () => {
  const c = load({ FORMCLUB_MODE: 'bundled', FORMCLUB_API_URL: 'https://api.example.com' });
  assert.equal(c.webDir, 'build/web');
  assert.equal(c.server.url, undefined);
  assert.equal(c.server.androidScheme, 'https');
  assert.throws(() => load({ FORMCLUB_MODE: 'bundled' }));
  assert.throws(() => load({ FORMCLUB_MODE: 'bundled', FORMCLUB_API_URL: 'http://api.example.com' }));
  assert.throws(() => load({ FORMCLUB_MODE: 'other' }));
});

test('mobile package never bundles the backend or databases', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(__dirname, '..', 'www'));
  for (const f of files) assert.doesNotMatch(f, /server\.js$|\.sqlite|\.db$|backend/, f);
});
