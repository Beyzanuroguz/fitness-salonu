'use strict';
// FORM CLUB Capacitor configuration.
//
// FORMCLUB_MODE=remote (default)
//   FORMCLUB_SERVER_URL       https address of the FORM CLUB server the shell opens.
//                             Without it only the bundled setup page (www/) opens.
// FORMCLUB_MODE=bundled
//   FORMCLUB_API_URL          https API origin; web files come from mobile/build/web
//                             (npm run bundle). Needs backend CORS/session support first.
// Common:
//   FORMCLUB_APP_ID           store bundle id, default com.formclub.app (placeholder)
//   FORMCLUB_ALLOW_CLEARTEXT  "1" only for LAN development over http://
// The backend (server.js, SQLite) is never copied into the app.
const { serverFromEnv, appIdFromEnv, validateServerUrl } = require('./lib/server-url');

const mode = process.env.FORMCLUB_MODE || 'remote';
if (!['remote', 'bundled'].includes(mode)) throw Error('FORMCLUB_MODE remote veya bundled olmalı: ' + mode);

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: appIdFromEnv(),
  appName: 'FORM CLUB',
  webDir: mode === 'bundled' ? 'build/web' : 'www',
  backgroundColor: '#0b100d',
  loggingBehavior: 'none',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0b100d',
    preferredContentMode: 'mobile'
  },
  android: {
    backgroundColor: '#0b100d',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

if (mode === 'remote') {
  const server = serverFromEnv();
  if (server) {
    config.server = {
      url: server.url,
      cleartext: server.cleartext,
      errorPath: 'offline.html'
    };
  }
} else {
  if((process.env.FORMCLUB_BUILD_ENV||'development')!=='development')throw Error('Bundled mode is experimental; staging/production release is blocked');
  // Validated here so a misconfigured build fails before `cap sync`.
  validateServerUrl(process.env.FORMCLUB_API_URL, { allowCleartext: process.env.FORMCLUB_ALLOW_CLEARTEXT === '1' });
  // Local origins: https://localhost (Android), capacitor://localhost (iOS).
  config.server = { androidScheme: 'https' };
}

module.exports = config;
