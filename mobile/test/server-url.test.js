'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateServerUrl, serverFromEnv, appIdFromEnv } = require('../lib/server-url');

test('https server URLs are normalized without trailing slash', () => {
  assert.deepEqual(validateServerUrl('https://club.example.com/'), { url: 'https://club.example.com', origin: 'https://club.example.com', hostname: 'club.example.com', cleartext: false });
  assert.equal(validateServerUrl('https://club.example.com/app/').url, 'https://club.example.com/app');
});

test('unsafe server URLs are rejected', () => {
  for (const bad of ['', 'club.example.com', 'ftp://club.example.com', 'https://u:p@club.example.com', 'https://club.example.com/?token=x', 'https://club.example.com/#a', 'http://club.example.com'])
    assert.throws(() => validateServerUrl(bad), bad);
});

test('http is allowed only for LAN development with explicit opt-in', () => {
  assert.throws(() => validateServerUrl('http://192.168.1.20:3000'));
  assert.equal(validateServerUrl('http://192.168.1.20:3000', { allowCleartext: true }).cleartext, true);
  assert.throws(() => validateServerUrl('http://example.com', { allowCleartext: true }));
});

test('environment helpers', () => {
  assert.equal(serverFromEnv({}), null);
  assert.equal(serverFromEnv({ FORMCLUB_SERVER_URL: 'https://a.example' }).url, 'https://a.example');
  assert.equal(appIdFromEnv({}), 'com.formclub.app');
  assert.throws(() => appIdFromEnv({ FORMCLUB_APP_ID: 'bad id' }));
});
