'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateServerUrl, serverFromEnv, appIdFromEnv } = require('../lib/server-url');

test('https server URLs are normalized without trailing slash', () => {
  assert.deepEqual(validateServerUrl('https://club.example.com/'), { url: 'https://club.example.com', origin: 'https://club.example.com', hostname: 'club.example.com', cleartext: false });
  assert.throws(()=>validateServerUrl('https://club.example.com/app/'));
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

test('staging and release require matching HTTPS origin and disallow cleartext overrides',()=>{
 const stage={FORMCLUB_BUILD_ENV:'staging',FORMCLUB_SERVER_URL:'https://staging.example.com',FORMCLUB_EXPECTED_ORIGIN:'https://staging.example.com',FORMCLUB_APP_ID:'com.formclub.app.staging'};
 assert.equal(serverFromEnv(stage).cleartext,false);
 for(const change of [{FORMCLUB_SERVER_URL:''},{FORMCLUB_EXPECTED_ORIGIN:''},{FORMCLUB_EXPECTED_ORIGIN:'https://live.example.com'},{FORMCLUB_ALLOW_CLEARTEXT:'1'},{FORMCLUB_APP_ID:'com.formclub.app'},{FORMCLUB_SERVER_URL:'https://staging.example.com/app'}])assert.throws(()=>serverFromEnv({...stage,...change}));
 assert.equal(serverFromEnv({...stage,FORMCLUB_BUILD_ENV:'production',FORMCLUB_APP_ID:'com.formclub.app'}).origin,stage.FORMCLUB_EXPECTED_ORIGIN);
});
test('invalid mobile URLs never echo possible credentials in diagnostics',()=>{
 assert.throws(()=>validateServerUrl('https://username:secret@['),e=>!e.message.includes('secret'));
});
