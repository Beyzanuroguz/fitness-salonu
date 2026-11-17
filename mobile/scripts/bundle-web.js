'use strict';
// Builds mobile/build/web from ../public for FORMCLUB_MODE=bundled.
// Requires FORMCLUB_API_URL (https). The backend itself stays on the server.
const path = require('node:path');
const { bundleWeb } = require('../lib/web-bundle');

try {
  const result = bundleWeb({
    publicDir: path.join(__dirname, '..', '..', 'public'),
    outDir: path.join(__dirname, '..', 'build', 'web'),
    apiUrl: process.env.FORMCLUB_API_URL,
    allowCleartext: process.env.FORMCLUB_ALLOW_CLEARTEXT === '1'
  });
  console.log(`build/web: ${result.files} dosya, API: ${result.apiBase}`);
  console.warn('NOT: Gömülü mod, backend tarafında CORS ve çapraz köken oturum desteği gerektirir (mobile/README.md).');
} catch (error) {
  console.error('Paketleme hatası: ' + error.message);
  process.exit(1);
}
