/* FORM CLUB date/time display. Business time zone: Europe/Istanbul, locale tr-TR.
   Data semantics (checked against server.js):
   - Class times (classes.starts_at) are naive wall-clock strings "YYYY-MM-DDTHH:MM[:SS]" entered in salon time.
     They are shown as-is, never shifted by the browser's or server's time zone.
   - Date-only values (expires, due_date) are calendar days.
   - SQLite CURRENT_TIMESTAMP columns (created_at) are UTC "YYYY-MM-DD HH:MM:SS"; use fromSqlUtc() first.
   - Numbers are epoch milliseconds; strings with Z or an offset are instants. Both are converted to Istanbul. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FormClubTime = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const TZ = 'Europe/Istanbul';
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const pad = n => String(n).padStart(2, '0');
let parts;
function wall(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const m = NAIVE.exec(v.trim());
    if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), time: m[4] !== undefined };
  }
  const t = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  parts = parts || new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(parts.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, time: true };
}
// Calendar names come from a UTC noon date built from the Istanbul fields, so no zone can shift the day.
const asDay = w => new Date(Date.UTC(w.y, w.mo - 1, w.d, 12));
const hm = w => pad(w.h) + ':' + pad(w.mi);
const key = w => `${w.y}-${pad(w.mo)}-${pad(w.d)}T${hm(w)}`;
const fullKey = w => key(w) + ':' + pad(w.s || 0);
function date(v, { weekday = false, month = 'long' } = {}) {
  const w = wall(v); if (!w) return '—';
  return asDay(w).toLocaleDateString('tr-TR', { timeZone: 'UTC', day: 'numeric', month, year: 'numeric', ...(weekday ? { weekday: 'long' } : {}) });
}
const dateTime = (v, o) => { const w = wall(v); return w ? date(v, o) + (w.time ? ' · ' + hm(w) : '') : '—'; };
const time = v => { const w = wall(v); return w && w.time ? hm(w) : '—'; };
const dayKey = v => { const w = wall(v); return w ? key(w).slice(0, 10) : ''; };
const nowKey = (now = Date.now()) => key(wall(now));
// A class is past once its start second has passed (seconds included, so it is not "upcoming" for its whole start minute).
const isPast = (v, now = Date.now()) => { const w = wall(v); return !!w && fullKey(w) < fullKey(wall(now)); };
// Whole days from today (Istanbul) to a calendar day; negative when it already passed.
const daysUntil = (v, now = Date.now()) => { const w = wall(v), n = wall(now); return w ? Math.round((asDay(w) - asDay(n)) / 86400000) : null; };
const fromSqlUtc = v => { const m = typeof v === 'string' && /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(v.trim()); return m ? Date.parse(m[1] + 'T' + m[2] + 'Z') : v; };
return { TZ, wall, date, dateTime, time, dayKey, nowKey, isPast, daysUntil, fromSqlUtc };
});
