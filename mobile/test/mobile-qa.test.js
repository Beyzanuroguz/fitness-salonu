'use strict';
// Mobile QA regressions found with headless Chrome at 360-430 px (see feature/mobile-qa report).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pub = path.join(__dirname, '..', '..', 'public');
const read = f => fs.readFileSync(path.join(pub, f), 'utf8');

test('hidden attribute wins over .btn display, so the PWA install button stays hidden until a prompt exists', () => {
  assert.match(read('style.css'), /\[hidden\]\{display:none!important\}/);
  assert.match(read('app.js'), /<button class="btn" id="install-app" hidden>/);
  assert.match(read('app.js'), /b\.hidden=false/, 'shown only from showInstallPrompt()');
});

test('phone touch targets: chips, small buttons, checkboxes and selects', () => {
  assert.match(read('style.css'), /@media\(max-width:680px\)\{\.chip\{min-height:44px\}/);
  assert.match(read('v9/v9.css'), /@media \(max-width:680px\)\{\.btn\.small\{min-height:44px;min-width:44px\}\}/);
  assert.match(read('nutrition/nutrition.css'), /@media \(max-width:680px\)\{\.btn\.small\{min-height:44px\}\}/);
  assert.match(read('dashboard.css'), /\.fc-filter-inputs select\{font-size:16px;min-height:44px\}/, 'no iOS zoom on focus');
});
