/* FORM CLUB phone camera QR reader, shared by scan screens (same approach as the turnstile scanner).
   Native BarcodeDetector when available (Android Chrome), bundled jsQR otherwise (iPhone Safari).
   Usage: const cam = FormclubQrCamera.create({ videoId, onCode, onChange }); cam.start(); cam.attach(); cam.stop(). */
(() => {
'use strict';
function cameraError(e) {
  const n = e?.name || '';
  const steps = /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone: Ayarlar › Safari › Kamera › İzin Ver, sonra “Tekrar dene”.' : 'Adres çubuğundaki kilit simgesi › İzinler › Kamera › İzin ver, sonra “Tekrar dene”.';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return ['Kamera izni verilmedi.', ' ' + steps];
  if (n === 'NotFoundError') return ['Bu cihazda kamera bulunamadı.', ' Resepsiyona başvur.'];
  if (n === 'NotReadableError') return ['Kamera başka bir uygulama tarafından kullanılıyor.', ' O uygulamayı kapatıp tekrar dene.'];
  if (n === 'SecurityError') return ['Kamera bu sayfada engellendi.', ' Sayfayı HTTPS adresinden aç.'];
  return ['Kamera açılamadı.', ' ' + (e?.message || n)];
}
function placeholder(state, startLabel) {
  if (!window.isSecureContext) return '<b>Kamera için HTTPS gerekli.</b><br>Telefon tarayıcıları kamerayı yalnızca https:// adreslerinde açar.';
  if (!navigator.mediaDevices?.getUserMedia) return '<b>Bu cihaz veya tarayıcı kamera erişimini desteklemiyor.</b><br>Güncel Chrome (Android) ya da Safari (iPhone) ile dene veya resepsiyona başvur.';
  return `${startLabel}<br><button class="btn primary" data-act="cam-start" style="margin-top:12px" ${state.starting ? 'disabled' : ''}>${state.starting ? 'Kamera açılıyor…' : state.error ? 'Tekrar dene' : 'Kamerayı aç'}</button>`;
}
const formats = {
  entry: /^[a-f0-9]{64}$/,
  gate: /^FORMCLUB-GATE:1:[a-f0-9]{32}$/,
  locker: /^FORMCLUB-LOCKER:1:[a-f0-9]{32}$/
};

function create({ videoId, accepts, onCode, onChange, repeatMs = 5000, busy = () => false }) {
  const cam = { active: false, starting: false, error: '', help: '', busy: false, stream: null, detector: null };
  const video = () => document.getElementById(videoId);
  const recent = new Map();
  let generation = 0, timer = 0, running = false, canvas, context;
  let candidate = '', hits = 0, latched = '', misses = 0;

  cam.start = async () => {
    if (cam.starting || cam.active) return;
    const gen = ++generation;
    Object.assign(cam, { error: '', help: '', starting: true });
    onChange();
    const ask = video => navigator.mediaDevices.getUserMedia({ video, audio: false });
    try {
      let stream;
      try { stream = await ask({ facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }); }
      catch (e) {
        if (!['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(e?.name)) throw e;
        stream = await ask(true);
      }
      if (gen !== generation || document.hidden) {
        stream.getTracks().forEach(t => t.stop());
        if (gen === generation) cam.stop();
        return;
      }
      cam.stream = stream;
    } catch (e) {
      if (gen !== generation) return;
      [cam.error, cam.help] = cameraError(e);
      cam.starting = false;
      return onChange(e);
    }
    let detector = null;
    try {
      if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code'))
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {}
    if (!detector && !window.jsQR) {
      try {
        await new Promise((ok, no) => {
          const script = document.createElement('script');
          script.src = '/v9/vendor/jsQR.js';
          script.onload = ok;
          script.onerror = () => { script.remove(); no(); };
          document.head.appendChild(script);
        });
      } catch {
        if (gen !== generation) return;
        cam.stop();
        Object.assign(cam, { error: 'QR çözücü yüklenemedi.', help: ' Bağlantını kontrol edip tekrar dene.' });
        return onChange();
      }
    }
    if (gen !== generation) return;
    Object.assign(cam, { starting: false, active: true, detector });
    onChange();
  };

  function schedule() {
    if (cam.active && !timer && !running) {
      timer = setTimeout(() => {
        timer = 0;
        void frame();
      }, 160);
    }
  }

  // Bind after render, keeping the existing video and its stream whenever possible.
  cam.attach = () => {
    const v = video();
    if (!cam.active || !v || !cam.stream) return;
    if (v.srcObject !== cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); }
    schedule();
  };

  async function decode(v) {
    if (cam.detector) {
      const codes = await cam.detector.detect(v);
      return codes.length === 1 ? codes[0].rawValue : '';
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    context.drawImage(v, 0, 0, w, h);
    return window.jsQR(context.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data;
  }

  async function frame() {
    const v = video(), gen = generation;
    if (!cam.active || !v || document.hidden) return;
    running = true;
    try {
      if (cam.busy || busy() || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
      let text;
      try { text = await decode(v); } catch {}
      if (gen !== generation || document.hidden || v !== video() || cam.busy || busy()) return;
      const code = String(text ?? '').trim();
      const valid = accepts(code);
      if (latched && code !== latched && ++misses >= 3) latched = '';
      if (code === latched) misses = 0;
      if (!valid) { candidate = ''; hits = 0; return; }
      if (candidate !== code) { candidate = code; hits = 0; }
      if (++hits < 2 || code === latched) return;
      // Rearm only after the code leaves the frame. A short cache also covers intermittent reads.
      latched = code;
      misses = 0;
      const now = Date.now();
      for (const [value, until] of recent) if (until <= now) recent.delete(value);
      if (recent.has(code)) return;
      recent.set(code, now + repeatMs);
      await onCode(code);
    } finally {
      running = false;
      schedule();
    }
  }

  cam.stop = () => {
    generation++;
    clearTimeout(timer);
    timer = 0;
    candidate = '';
    hits = 0;
    cam.stream?.getTracks().forEach(t => t.stop());
    Object.assign(cam, { stream: null, active: false, starting: false });
  };
  cam.view = startLabel => cam.active ? `<video id="${videoId}" playsinline muted autoplay aria-label="Kamera görüntüsü"></video><div class="reticle" aria-hidden="true"></div>` : `<div class="placeholder">${placeholder(cam, startLabel)}</div>`;
  return cam;
}
window.FormclubQrCamera = { create, cameraError, formats };
})();
