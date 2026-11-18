'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require.resolve('../../public/turnstiles/qr-camera.js'), 'utf8');

function scanner(native, format) {
  const timers = new Map(), sent = [];
  let clock = 0, timer = 0, raw = '', stopped = 0, reads = 0;
  const video = { videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {} };
  const canvas = { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [] }) }) };
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const navigator = { mediaDevices: { getUserMedia: async () => stream } };
  const window = native ? { BarcodeDetector: class {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { reads++; return raw ? [{ rawValue: raw }] : []; }
  } } : { jsQR: () => { reads++; return { data: raw }; } };
  vm.runInNewContext(source, {
    window, navigator, document: { getElementById: () => video, createElement: () => canvas },
    Date: { now: () => clock }, setTimeout: fn => { timers.set(++timer, fn); return timer; },
    clearTimeout: id => timers.delete(id)
  });
  const { create, formats } = window.FormclubQrCamera;
  const cam = create({ videoId: 'video', accepts: value => formats[format].test(value), onCode: code => sent.push(code), onChange() {} });
  return {
    cam, sent, navigator, stream, stopped: () => stopped, reads: () => reads,
    async frame(code, elapsed = 160) {
      raw = code;
      clock += elapsed;
      assert.equal(timers.size, 1);
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

for (const [name, native, format, prefix, length] of [
  ['Android native gate', true, 'gate', 'FORMCLUB-GATE:1:', 32],
  ['iPhone software locker', false, 'locker', 'FORMCLUB-LOCKER:1:', 32],
  ['iPhone software entry', false, 'entry', '', 64]
]) {
  test(name + ' waits for two complete reads and suppresses a held code', async () => {
    const f = scanner(native, format);
    const code = prefix + 'a'.repeat(length), other = prefix + 'b'.repeat(length);
    await f.cam.start();
    f.cam.attach();
    f.cam.attach();
    for (const raw of [prefix, code.slice(0, -1), code.slice(0, -1), code, '', other, code]) await f.frame(raw);
    assert.deepEqual(f.sent, []);
    await f.frame(code);
    await f.frame(code, 10000);
    await f.frame(code, 10000);
    assert.deepEqual(f.sent, [code]);
    for (const raw of ['', '', '', other, other]) await f.frame(raw);
    assert.deepEqual(f.sent, [code, other]);
    assert.ok(f.reads() > 0);
    f.cam.stop();
    assert.equal(f.stopped(), 1);
  });
}

test('closing a pending camera stops a permission grant that resolves later', async () => {
  const f = scanner(false, 'entry');
  let grant;
  f.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const opening = f.cam.start();
  f.cam.stop();
  grant(f.stream);
  await opening;
  assert.equal(f.cam.active, false);
  assert.equal(f.cam.starting, false);
  assert.equal(f.stopped(), 1);
});
