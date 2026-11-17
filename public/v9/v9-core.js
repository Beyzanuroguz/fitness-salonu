/* FORM CLUB V9 - pure helpers shared by the browser (window.V9Core) and node:test.
   All V9 API knowledge lives here so a contract change from the backend is a one-file edit.
   Uses the canonical member QR/reminder and teacher monthly report API. */
(function (global) {
'use strict';
const ENDPOINTS = {
  qr: '/api/v9/qr',
  checkin: '/api/v9/qr/verify',
  notifications: '/api/v9/reminders',
  notificationRead: '/api/v9/reminders/read',
  trainerReport: '/api/v9/teacher/reports/monthly'
};
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad = v => String(v).padStart(2, '0');

// Opaque 32-byte token; the server stores only its SHA-256 hash.
function isToken(value) {
  const s = String(value || '').trim();
  return /^[a-f0-9]{64}$/.test(s);
}
function normalizeQR(r) {
  if (!r || !isToken(r.token)) throw Error('Sunucu geçersiz QR yanıtı verdi');
  const ttl = num(r.expires_in);
  return { token: String(r.token), expiresIn: ttl > 0 && ttl <= 600 ? ttl : 60 };
}
// Refresh a few seconds early so the member never shows an expired code at the turnstile.
function refreshDelayMs(expiresIn, leadSeconds = 5) {
  return Math.max(1000, (num(expiresIn) - leadSeconds) * 1000);
}

// The backend answers unknown routes with "Endpoint bulunamadı" (status 400 from the V6 router, 404 from V9).
function isMissingApi(error) {
  return !!error && (error.status === 404 || /endpoint bulunamad/i.test(String(error.message || '')));
}
function scanErrorText(error) {
  if (!error) return 'Bilinmeyen hata';
  if (error.status === 409) return 'Bu QR daha önce kullanıldı. Üyeden yeni kodu göstermesini iste.';
  if (error.status === 401) return 'Oturumun kapanmış. Yeniden giriş yap.';
  // 403 on verify means either a non-admin scanner or an inactive/expired membership.
  if (error.status === 403) return /aktif üyelik/i.test(String(error.message || '')) ? 'Üyelik aktif değil veya süresi dolmuş. Giriş verilmedi.' : 'QR okutma yetkin yok.';
  if (error.status === 422) return String(error.message || 'QR geçersiz') + '. Üyeden ekrandaki yeni kodu göstermesini iste.';
  if (error.offline || error.status === 0) return 'Bağlantı yok, kod doğrulanamadı. Bağlantı gelince tekrar okut.';
  return String(error.message || 'QR doğrulanamadı');
}

function noticeKind(id) {
  const prefix = String(id || '').split(':')[0];
  if (prefix === 'membership' || prefix === 'expiry' || prefix === 'member-expiry') return 'expiry';
  if (prefix === 'class' || prefix === 'booking' || prefix === 'teacher-class') return 'class';
  if (prefix === 'payment' || prefix === 'admin-payment') return 'payment';
  return 'other';
}
// Unread first, then the soonest date first; ties keep server order.
function normalizeNotifications(list) {
  if (list && Array.isArray(list.reminders)) list = list.reminders.map(n => ({ ...n, title: n.message, detail: n.title || (n.amount == null ? '' : `${n.amount} ₺`), date: n.due_at }));
  return (Array.isArray(list) ? list : [])
    .filter(n => n && n.id != null && n.title)
    .map((n, i) => ({ id: String(n.id), title: String(n.title), detail: String(n.detail || ''), date: String(n.date || ''), read: n.read === true, kind: noticeKind(n.id), i }))
    .sort((a, b) => Number(a.read) - Number(b.read) || a.date.localeCompare(b.date) || a.i - b.i)
    .map(({ i, ...n }) => n);
}
const unreadCount = list => (Array.isArray(list) ? list : []).filter(n => !n.read).length;

// "2026-11-18" or "2026-11-18T18:30" -> local calendar parts, no timezone shifting.
function parseLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value || ''));
  if (!m) return null;
  return { date: new Date(+m[1], +m[2] - 1, +m[3]), time: m[4] ? `${m[4]}:${m[5]}` : '' };
}
function relativeDay(value, now = new Date()) {
  const p = parseLocal(value);
  if (!p) return '';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((p.date - today) / 86400000);
  const word = diff === 0 ? 'Bugün' : diff === 1 ? 'Yarın' : diff === -1 ? 'Dün' : diff > 1 ? `${diff} gün sonra` : `${-diff} gün önce`;
  return p.time ? `${word} ${p.time}` : word;
}

function monthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}
function shiftMonth(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
// Oldest first, ending with (year, month).
function monthsBack(year, month, count) {
  return Array.from({ length: count }, (_, i) => shiftMonth(year, month, i - count + 1));
}
function reportQuery(year, month) {
  const q = new URLSearchParams({ month: `${year}-${pad(month)}` });
  return `${ENDPOINTS.trainerReport}?${q}`;
}
function normalizeReport(r) {
  if (!r || typeof r !== 'object') throw Error('Sunucu geçersiz rapor yanıtı verdi');
  if (typeof r.month === 'string') {
    const [year, month] = r.month.split('-').map(Number);
    r = { ...r, year, month, attendance: r.attended, completed_classes: null, classes: (r.classes || []).map(c => ({ ...c, reservations: c.booked })) };
  }
  const classes = (Array.isArray(r.classes) ? r.classes : []).map(c => ({
    id: c.id, title: String(c.title || 'Ders'), starts_at: String(c.starts_at || ''),
    capacity: num(c.capacity), reservations: num(c.reservations), attended: num(c.attended)
  }));
  const completed = r.completed_classes == null ? classes.filter(c => Date.parse(c.starts_at + (/Z$|[+-]\d\d:\d\d$/.test(c.starts_at) ? '' : '+03:00')) <= Date.now()).length : num(r.completed_classes);
  const doneReservations = classes.slice(0, completed).reduce((s, c) => s + c.reservations, 0);
  return {
    trainer: r.trainer && typeof r.trainer === 'object' ? { id: r.trainer.id, name: String(r.trainer.name || '') } : { id: null, name: '' },
    year: num(r.year), month: num(r.month),
    class_count: num(r.class_count), completed_classes: completed,
    attendance: num(r.attendance), occupancy_percent: num(r.occupancy_percent),
    // Show-up rate among reservations of classes that already took place (classes are ordered by start time).
    show_rate: r.attendance_percent !== undefined ? r.attendance_percent : doneReservations ? Math.round(100 * num(r.attendance) / doneReservations) : null,
    classes
  };
}
function niceMax(value) {
  const v = Math.max(1, num(value));
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * step).find(m => m >= v);
}
function shortDate(value) {
  const p = parseLocal(value);
  return p ? `${pad(p.date.getDate())}.${pad(p.date.getMonth() + 1)}${p.time ? ' ' + p.time : ''}` : '';
}

const api = { ENDPOINTS, isToken, normalizeQR, refreshDelayMs, isMissingApi, scanErrorText, noticeKind, normalizeNotifications, unreadCount, parseLocal, relativeDay, monthLabel, shiftMonth, monthsBack, reportQuery, normalizeReport, niceMax, shortDate };
if (typeof module === 'object' && module.exports) module.exports = api; else global.V9Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
