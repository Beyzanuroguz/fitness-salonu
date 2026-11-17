/* FORM CLUB V8 — pure nutrition/health calculations. Shared by the browser (window.V8Calc) and node:test. */
(function (global) {
'use strict';
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const round1 = v => Math.round(v * 10) / 10;
const pad = v => String(v).padStart(2, '0');
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = iso => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return Number.isNaN(+d) ? null : d; };
const addDays = (iso, days) => { const d = parseISO(iso); d.setDate(d.getDate() + days); return localISO(d); };

// Food rows come from /api/v6/foods: values are per 100 g, entered from the product label.
function nutrientsFor(food, grams) {
  const g = num(grams);
  if (!food || !(g > 0)) return null;
  const f = k => round1(num(food[k] || 0) * g / 100);
  return { grams: round1(g), kcal: Math.round(num(food.kcal_100g) * g / 100), protein: f('protein_100g'), carbs: f('carbs_100g'), fat: f('fat_100g') };
}
// Portion size is supplied by the user (e.g. from the package); no built-in portion presets are invented.
function gramsFromPortion(count, portionGrams) {
  const c = num(count), p = num(portionGrams);
  if (!(c > 0) || !(p > 0)) return null;
  return round1(c * p);
}
const logKcal = l => num(l.grams) * num(l.kcal_100g) / 100;

// Turkish-aware, accent-insensitive matching: "gogsu" finds "Tavuk göğsü".
function normalize(text) {
  return String(text || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function searchFoods(foods, query) {
  const list = Array.isArray(foods) ? foods : [];
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return list.slice();
  return list
    .map(f => ({ f, name: normalize(f.name) }))
    .filter(x => terms.every(t => x.name.includes(t)))
    .sort((a, b) => Number(!a.name.startsWith(terms[0])) - Number(!b.name.startsWith(terms[0])) || a.name.localeCompare(b.name, 'tr'))
    .map(x => x.f);
}

// Products from /api/v8/foods/search are logged through the V6 catalogue (max 100-char names).
// Reuse an existing catalogue row with the same name and the same per-100 g values instead of duplicating it.
const MACROS = ['kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g'];
function catalogName(product) { return String(product?.name || '').trim().slice(0, 100).trim(); }
function findCatalogMatch(foods, product) {
  const name = normalize(catalogName(product));
  if (!name) return null;
  return (Array.isArray(foods) ? foods : []).find(f => normalize(f.name) === name && MACROS.every(k => Math.abs(num(f[k] || 0) - num(product[k] || 0)) < 1e-6)) || null;
}

function dailyTotals(logs) {
  const map = new Map();
  for (const l of Array.isArray(logs) ? logs : []) {
    const day = String(l.consumed_on || '').slice(0, 10);
    if (!day) continue;
    const t = map.get(day) || { date: day, kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    const g = num(l.grams) / 100;
    t.kcal += num(l.kcal_100g) * g; t.protein += num(l.protein_100g || 0) * g; t.carbs += num(l.carbs_100g || 0) * g; t.fat += num(l.fat_100g || 0) * g; t.count++;
    map.set(day, t);
  }
  return map;
}
// One row per calendar day; days without records get kcal 0 and hasData false (not an estimate).
function daySeries(logs, startISO, days) {
  const totals = dailyTotals(logs);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(startISO, i), t = totals.get(date);
    return { date, kcal: t ? Math.round(t.kcal) : 0, hasData: !!t };
  });
}
function weekStart(iso) { const d = parseISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localISO(d); }
function monthStart(iso) { return String(iso).slice(0, 7) + '-01'; }
function daysInMonth(iso) { const d = parseISO(monthStart(iso)); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function shiftMonth(iso, delta) { const d = parseISO(monthStart(iso)); d.setMonth(d.getMonth() + delta); return localISO(d); }

// Average over days that actually have records in the last `days` days ending at endISO.
function dailyAverage(logs, endISO, days = 7) {
  const series = daySeries(logs, addDays(endISO, -(days - 1)), days).filter(x => x.hasData);
  if (!series.length) return { value: null, days: 0 };
  return { value: Math.round(series.reduce((s, x) => s + x.kcal, 0) / series.length), days: series.length };
}
// Average weekly total over the last `weeks` Monday-based weeks (current included) that contain records.
function weeklyAverage(logs, endISO, weeks = 4) {
  const totals = dailyTotals(logs), first = weekStart(endISO), sums = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(first, -7 * w);
    let kcal = 0, has = false;
    for (let i = 0; i < 7; i++) { const day = addDays(start, i); if (day > endISO) break; const t = totals.get(day); if (t) { kcal += t.kcal; has = true; } }
    if (has) sums.push(kcal);
  }
  if (!sums.length) return { value: null, weeks: 0 };
  return { value: Math.round(sums.reduce((a, b) => a + b, 0) / sums.length), weeks: sums.length };
}

// BMI: kg / m². Categories follow WHO adult cut-offs.
function bmi(weightKg, heightCm) {
  const w = num(weightKg), h = num(heightCm);
  if (!(w >= 20 && w <= 350) || !(h >= 100 && h <= 250)) return null;
  return round1(w / ((h / 100) ** 2));
}
function bmiCategory(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 18.5) return { key: 'under', label: 'Zayıf' };
  if (value < 25) return { key: 'normal', label: 'Normal' };
  if (value < 30) return { key: 'over', label: 'Fazla kilolu' };
  return { key: 'obese', label: 'Obez' };
}
const ACTIVITY = [
  { key: 'sedentary', factor: 1.2, label: 'Hareketsiz (masa başı, egzersiz yok)' },
  { key: 'light', factor: 1.375, label: 'Hafif aktif (haftada 1-3 gün egzersiz)' },
  { key: 'moderate', factor: 1.55, label: 'Orta aktif (haftada 3-5 gün egzersiz)' },
  { key: 'active', factor: 1.725, label: 'Çok aktif (haftada 6-7 gün egzersiz)' },
  { key: 'very', factor: 1.9, label: 'Aşırı aktif (yoğun antrenman veya fiziksel iş)' }
];
// Mifflin-St Jeor resting energy estimate for adults.
function bmr({ sex, weight, height, age }) {
  const w = num(weight), h = num(height), a = num(age);
  if (!['female', 'male'].includes(sex) || !(w >= 20 && w <= 350) || !(h >= 100 && h <= 250) || !(a >= 18 && a <= 100)) return null;
  return Math.round(10 * w + 6.25 * h - 5 * a + (sex === 'male' ? 5 : -161));
}
function tdee(profile) {
  const base = bmr(profile), act = ACTIVITY.find(x => x.key === profile.activity);
  if (base == null || !act) return null;
  return { bmr: base, factor: act.factor, tdee: Math.round(base * act.factor) };
}

const api = { nutrientsFor, gramsFromPortion, logKcal, normalize, searchFoods, catalogName, findCatalogMatch, dailyTotals, daySeries, weekStart, monthStart, daysInMonth, shiftMonth, addDays, localISO, parseISO, dailyAverage, weeklyAverage, bmi, bmiCategory, ACTIVITY, bmr, tdee };
if (typeof module === 'object' && module.exports) module.exports = api; else global.V8Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
