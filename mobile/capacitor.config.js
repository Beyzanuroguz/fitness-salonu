'use strict';
// FORM CLUB Capacitor configuration.
// Environment:
//   FORMCLUB_SERVER_URL       https address of the running FORM CLUB server (required for a usable build)
//   FORMCLUB_APP_ID           store bundle id, default com.formclub.app (placeholder, change before release)
//   FORMCLUB_ALLOW_CLEARTEXT  "1" only for LAN development over http://
// The backend (server.js, SQLite) is never copied into the app; webDir only holds the
// setup and offline pages.
const { serverFromEnv, appIdFromEnv } = require('./lib/server-url');

const server = serverFromEnv();

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: appIdFromEnv(),
  appName: 'FORM CLUB',
  webDir: 'www',
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

if (server) {
  config.server = {
    url: server.url,
    cleartext: server.cleartext,
    errorPath: 'offline.html'
  };
}

module.exports = config;
