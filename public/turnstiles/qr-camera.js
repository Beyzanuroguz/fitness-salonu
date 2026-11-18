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
function create({ videoId = 'qr-video', onCode, onChange }) {
  const cam = { active: false, starting: false, error: '', help: '', busy: false, stream: null, detector: null, loop: 0, canvas: null, last: '', lastAt: 0, gen: 0 };
  const video = () => document.getElementById(videoId);
  cam.start = async () => {
    Object.assign(cam, { error: '', help: '', starting: true }); onChange();
    try {
      try { cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
      catch (e) { if (e?.name === 'OverconstrainedError') cam.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); else throw e; }
    } catch (e) { [cam.error, cam.help] = cameraError(e); cam.starting = false; return onChange(); }
    cam.detector = null;
    try { if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) cam.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch {}
    if (!cam.detector && !window.jsQR) {
      try { await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/v9/vendor/jsQR.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
      catch { cam.stop(); Object.assign(cam, { error: 'QR çözücü yüklenemedi.', help: ' Bağlantını kontrol edip tekrar dene.' }); return onChange(); }
    }
    Object.assign(cam, { starting: false, active: true });
    onChange();
  };
  // Call after every render: re-binds the live stream to the (possibly new) video element.
  cam.attach = () => {
    const v = video(); if (!cam.active || !v || !cam.stream) return;
    if (v.srcObject !== cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); }
    clearTimeout(cam.loop); cam.loop = setTimeout(frame, 300);
  };
  async function frame() {
    const v = video(), gen = cam.gen; if (!cam.active || !v || document.hidden) return;
    if (!cam.busy && v.readyState >= 2) {
      let text = '';
      try {
        if (cam.detector) text = (await cam.detector.detect(v))[0]?.rawValue || '';
        else if (window.jsQR) {
          const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
          const cv = cam.canvas = cam.canvas || document.createElement('canvas'); cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, w, h);
          text = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data || '';
        }
      } catch {}
      // Detection is async: drop the frame if the camera was stopped or the page hidden meanwhile.
      if (gen !== cam.gen || !cam.active) return;
      const code = String(text).trim(), now = Date.now();
      // The camera sees the same code many times per second; one read per code every 5 s.
      if (code && !document.hidden && !cam.busy && !(code === cam.last && now - cam.lastAt < 5000)) { cam.last = code; cam.lastAt = now; await onCode(code); }
    }
    cam.loop = setTimeout(frame, 200);
  }
  cam.stop = () => { cam.gen++; clearTimeout(cam.loop); cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null; cam.active = false; };
  cam.view = startLabel => cam.active ? `<video id="${videoId}" playsinline muted autoplay aria-label="Kamera görüntüsü"></video><div class="reticle" aria-hidden="true"></div>` : `<div class="placeholder">${placeholder(cam, startLabel)}</div>`;
  return cam;
}
window.FormclubQrCamera = { create, cameraError };
})();
