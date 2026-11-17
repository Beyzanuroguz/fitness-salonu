'use strict';
// Validates the FORM CLUB web server address the native shell loads.
// The app keeps its session in same-origin cookies, so the shell must load the
// real server origin (no bundled copy talking cross-origin to the API).

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

function validateServerUrl(raw, { allowCleartext = false } = {}) {
  const value = String(raw || '').trim();
  if (!value) throw Error('FORMCLUB_SERVER_URL boş. Örnek: https://uygulama.ornek-salon.com');
  let url;
  try { url = new URL(value); } catch { throw Error('FORMCLUB_SERVER_URL geçerli bir adres değil'); }
  if (url.username || url.password) throw Error('Sunucu adresi kullanıcı adı veya şifre içeremez.');
  if (url.search || url.hash) throw Error('Sunucu adresi sorgu (?…) veya # içeremez; oturum veya token adrese yazılmaz.');
  if (url.protocol === 'http:') {
    if (!allowCleartext) throw Error('Sunucu adresi https:// olmalı. Kamera, çerez güvenliği ve mağaza kuralları HTTPS ister.');
    if (!PRIVATE_HOST.test(url.hostname)) throw Error('http:// yalnızca yerel ağ geliştirmesi için izinlidir (localhost, 10.x, 192.168.x, 172.16-31.x, .local).');
  } else if (url.protocol !== 'https:') {
    throw Error('Desteklenmeyen protokol: ' + url.protocol);
  }
  if(url.pathname!=='/')throw Error('Sunucu adresi yalnız köken olmalı; alt dizin desteklenmiyor.');
  const path = '';
  return { url: url.origin + path, origin: url.origin, hostname: url.hostname, cleartext: url.protocol === 'http:' };
}

// Reads the environment once; null means "no server configured" (the bundled setup page opens).
function serverFromEnv(env = process.env) {
  const mode=env.FORMCLUB_BUILD_ENV||'development';
  if(!['development','staging','production'].includes(mode))throw Error('Invalid FORMCLUB_BUILD_ENV');
  const locked=mode!=='development';
  if(locked&&env.FORMCLUB_ALLOW_CLEARTEXT==='1')throw Error('Staging/release cleartext disabled');
  if (!env.FORMCLUB_SERVER_URL){if(locked)throw Error('Staging/release server URL required');return null;}
  const server=validateServerUrl(env.FORMCLUB_SERVER_URL, { allowCleartext: !locked&&env.FORMCLUB_ALLOW_CLEARTEXT === '1' });
  if(locked){
    if(!env.FORMCLUB_EXPECTED_ORIGIN||validateServerUrl(env.FORMCLUB_EXPECTED_ORIGIN).origin!==server.origin)throw Error('Expected HTTPS origin must match server URL');
    if(mode==='staging'&&!appIdFromEnv(env).endsWith('.staging'))throw Error('Separate .staging app id required');
  }
  return server;
}

function appIdFromEnv(env = process.env) {
  const id = env.FORMCLUB_APP_ID || 'com.formclub.app';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(id)) throw Error('FORMCLUB_APP_ID ters alan adı biçiminde olmalı (ör. com.salonadi.app): ' + id);
  return id;
}

module.exports = { validateServerUrl, serverFromEnv, appIdFromEnv };
