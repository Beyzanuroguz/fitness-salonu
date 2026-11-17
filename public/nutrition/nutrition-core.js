/* FORM CLUB Nutrition+ - pure helpers shared by the browser (window.NutritionCore) and node:test.
   No DOM, no network, no storage. Every nutrient value is either a finite number or null.
   null means "unknown": it is never silently replaced with 0. */
(function (global) {
'use strict';

const MEALS = Object.freeze([
  { id: 'breakfast', label: 'Kahvaltı' },
  { id: 'lunch', label: 'Öğle' },
  { id: 'dinner', label: 'Akşam' },
  { id: 'snack', label: 'Ara öğün' }
]);
const MEAL_IDS = MEALS.map(m => m.id);
// Display order and units. The first four are the core energy/macro values.
const NUTRIENTS = Object.freeze([
  { key: 'kcal', label: 'Enerji', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Karbonhidrat', unit: 'g' },
  { key: 'fat', label: 'Yağ', unit: 'g' },
  { key: 'sugar', label: 'Şeker', unit: 'g' },
  { key: 'fiber', label: 'Lif', unit: 'g' },
  { key: 'salt', label: 'Tuz', unit: 'g' }
]);
const KEYS = NUTRIENTS.map(n => n.key);
const MACROS = ['protein', 'carbs', 'fat'];
const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 };
const MAX_AMOUNT = 5000;

const round = (n, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };
// Accepts numbers or numeric strings (comma or dot decimals). Negative, empty or non-finite -> null.
function toNum(v) {
  if (v === null || v === undefined || String(v).trim() === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const known = v => typeof v === 'number' && Number.isFinite(v);

/* ---------- Products ---------- */
function sourceInfo(raw) {
  const s = String(raw.source || raw.source_name || '').trim();
  const lower = s.toLowerCase();
  if (raw.preview || lower === 'mock' || lower === 'preview') return { kind: 'preview', label: 'Örnek veri (önizleme)', detail: 'Gerçek ürün verisi değildir.' };
  if (lower === 'manual') return { kind: 'manual', label: 'Elle girildi', detail: 'Değerler kullanıcı tarafından girildi.' };
  if (lower === 'recipe') return { kind: 'recipe', label: 'Tarifim', detail: 'Malzemelerden hesaplandı.' };
  if (lower.includes('open food facts')) return { kind: 'openfoodfacts', label: 'Open Food Facts', detail: 'Topluluk tarafından etiketten derlenen açık veri (ODbL-1.0). Laboratuvar doğrulaması değildir.', url: safeUrl(raw.source_url), license: raw.source_license || 'ODbL-1.0' };
  if (s) return { kind: 'other', label: s.slice(0, 60), detail: '', url: safeUrl(raw.source_url), license: raw.source_license || '' };
  return { kind: 'unknown', label: 'Kaynak belirtilmemiş', detail: '' };
}
// Only absolute https links are shown; anything else is dropped rather than rendered as a link.
function safeUrl(u) {
  try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
}

/* Normalizes both the current V8 shape ({kcal_100g, protein_100g, ...}) and the expected
   Nutrition+ shape ({basis:'ml', per_100:{kcal,...}, servings:[...]}) into one object. */
function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nested = raw.per_100 || raw.nutrients_per_100 || raw.per100 || null;
  const per100 = {};
  for (const k of KEYS) {
    const alias = k === 'kcal' ? ['kcal', 'energy_kcal'] : [k];
    let v = null;
    if (nested && typeof nested === 'object') for (const a of alias) if (v === null) v = toNum(nested[a]);
    if (v === null) v = toNum(raw[k + '_100g'] ?? raw[k + '_100']);
    per100[k] = v;
  }
  const unit = String(raw.basis || raw.unit || raw.nutrition_unit || 'g').toLowerCase();
  const basis = unit === 'ml' ? 'ml' : 'g';
  const servings = Array.isArray(raw.servings) ? raw.servings.map(s => ({ label: String(s?.label || '').slice(0, 60), amount: toNum(s?.amount) })).filter(s => s.label && s.amount > 0 && s.amount <= MAX_AMOUNT) : [];
  const servingAmount = toNum(raw.serving_quantity ?? raw.serving_size);
  if (!servings.length && servingAmount > 0 && servingAmount <= MAX_AMOUNT) servings.push({ label: '1 porsiyon', amount: servingAmount });
  const barcode = /^\d{8,14}$/.test(String(raw.barcode || raw.code || raw.source_id || '')) ? String(raw.barcode || raw.code || raw.source_id) : '';
  const name = String(raw.name || raw.product_name || '').trim().slice(0, 200);
  if (!name) return null;
  return {
    id: Number.isSafeInteger(Number(raw.id)) && Number(raw.id) > 0 ? Number(raw.id) : null,
    sourceId: raw.source_id ? String(raw.source_id) : '',
    name,
    brand: String(raw.brand || raw.brands || '').trim().slice(0, 120),
    barcode,
    basis,
    supported:raw.basis!=='unsupported',
    detailsLoaded:raw.details_loaded!==false,
    per100,
    servings,
    source: sourceInfo(raw),
    retrievedAt: raw.retrieved_at || '',
    updatedAt: raw.updated_at || '',
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(i=>({name:String(i.name||''),amount:toNum(i.amount??i.grams??i.ml),unit:i.unit==='ml'?'ml':'g',source:sourceInfo(i),retrievedAt:i.retrieved_at||''})) : [],
    preview: !!raw.preview
  };
}
const missingKeys = product => KEYS.filter(k => !known(product?.per100?.[k]));
const coreComplete = product => ['kcal', ...MACROS].every(k => known(product?.per100?.[k]));

/* ---------- Portions ---------- */
function validAmount(v) {
  const n = toNum(v);
  return n !== null && n > 0 && n <= MAX_AMOUNT ? n : null;
}
// Scales per-100 values to an amount in the product's own basis (g or ml). Unknown stays unknown.
function portion(product, amount) {
  const a = validAmount(amount);
  if (a === null) throw Object.assign(Error('Miktar 0’dan büyük ve en fazla ' + MAX_AMOUNT + ' olmalı'), { code: 'amount' });
  const out = {};
  for (const k of KEYS) { const v = product?.per100?.[k]; out[k] = known(v) ? round(v * a / 100, 2) : null; }
  return out;
}
// Sums known values; counts how many items had each value unknown so the UI can say "en az".
function sumNutrients(items) {
  const totals = {}, unknown = {};
  for (const k of KEYS) { totals[k] = 0; unknown[k] = 0; }
  for (const item of items || []) for (const k of KEYS) {
    const v = item?.[k];
    if (known(v)) totals[k] += v; else unknown[k] += 1;
  }
  for (const k of KEYS) totals[k] = round(totals[k], 2);
  return { totals, unknown, partial: KEYS.some(k => unknown[k] > 0) };
}

/* ---------- Goals and progress ---------- */
function progress(consumed, goal) {
  const c = known(consumed) ? consumed : 0;
  const g = known(goal) && goal > 0 ? goal : null;
  if (g === null) return { pct: 0, remaining: null, over: false, hasGoal: false };
  return { pct: Math.min(100, round(c / g * 100, 1)), remaining: round(g - c, 0), over: c > g, hasGoal: true };
}
function ring(pct, radius = 52) {
  const c = 2 * Math.PI * radius;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return { circumference: round(c, 2), offset: round(c * (1 - p / 100), 2) };
}
// Default split 25/50/25 of energy; a user can override it on the body screen.
function macroTargets(kcal, split = { protein: 25, carbs: 50, fat: 25 }) {
  const k = toNum(kcal);
  if (!k) return { protein: null, carbs: null, fat: null };
  const total = MACROS.reduce((s, m) => s + (toNum(split[m]) || 0), 0);
  if (Math.abs(total - 100) > 0.5) throw Object.assign(Error('Makro oranlarının toplamı %100 olmalı'), { code: 'split' });
  return Object.fromEntries(MACROS.map(m => [m, Math.round(k * split[m] / 100 / KCAL_PER_GRAM[m])]));
}
function normalizeGoals(g) {
  const kcal = toNum(g?.kcal);
  if (!kcal || kcal < 800 || kcal > 6000) return null;
  const macros = {};
  for (const m of MACROS) { const v = toNum(g?.[m]); macros[m] = v!==null && v <= 1000 ? Math.round(v) : null; }
  if (MACROS.some(m => macros[m] === null)) Object.assign(macros, macroTargets(kcal));
  return { kcal: Math.round(kcal), ...macros };
}
function bmi(heightCm, weightKg) {
  const h = toNum(heightCm), w = toNum(weightKg);
  if (!h || !w || h < 50 || h > 250 || w < 1 || w > 500) return null;
  return round(w / (h / 100) ** 2, 1);
}
function bmiBand(value) {
  if (!known(value)) return '';
  if (value < 18.5) return 'Zayıf aralık';
  if (value < 25) return 'Normal aralık';
  if (value < 30) return 'Fazla kilolu aralık';
  return 'Obezite aralığı';
}

/* ---------- Dates (local calendar, Monday weeks) ---------- */
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null;
}
function addDays(s, n) { const d = parseDate(s); if (!d) return null; d.setDate(d.getDate() + n); return localDate(d); }
function weekStart(s) { const d = parseDate(s); if (!d) return null; d.setDate(d.getDate() - (d.getDay() + 6) % 7); return localDate(d); }
const DAY_SHORT = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
function dayLabel(s, today = localDate()) {
  if (s === today) return 'Bugün';
  if (s === addDays(today, -1)) return 'Dün';
  const d = parseDate(s);
  return d ? d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
}

/* ---------- Meals ---------- */
// mealOf: log -> meal id. Logs whose meal is unknown are kept visible under "unassigned".
function groupByMeal(logs, mealOf = l => l.meal) {
  const groups = Object.fromEntries([...MEAL_IDS, 'unassigned'].map(id => [id, []]));
  for (const log of logs || []) { const m = mealOf(log); (MEAL_IDS.includes(m) ? groups[m] : groups.unassigned).push(log); }
  return groups;
}
function guessMeal(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 18 && h < 23) return 'dinner';
  return 'snack';
}

/* ---------- Charts ---------- */
// Bars scaled against the larger of the goal and the highest day so the goal line is always on-chart.
function chartBars(daily, goalKcal, key = 'kcal') {
  const days = Array.isArray(daily) ? daily : [];
  const goal = known(goalKcal) && goalKcal > 0 ? goalKcal : 0;
  const max = Math.max(goal, ...days.map(d => known(toNum(d?.[key])) ? toNum(d[key]) : 0), 1);
  return {
    max,
    goalPct: goal ? round(goal / max * 100, 1) : null,
    bars: days.map(d => { const v = toNum(d?.[key]) || 0; return { date: d.date, value: round(v, 0), pct: round(v / max * 100, 1), over: goal > 0 && v > goal }; })
  };
}
function macroEnergyShare(totals) {
  const e = MACROS.map(m => (toNum(totals?.[m]) || 0) * KCAL_PER_GRAM[m]);
  const sum = e.reduce((a, b) => a + b, 0);
  return Object.fromEntries(MACROS.map((m, i) => [m, sum ? Math.round(e[i] / sum * 100) : 0]));
}
function periodSummary(history) {
  const daily = Array.isArray(history?.daily) ? history.daily : [];
  const logged = daily.filter(d => (toNum(d.kcal) || 0) > 0);
  const avg = k => logged.length ? round(logged.reduce((s, d) => s + (toNum(d[k]) || 0), 0) / logged.length, 0) : 0;
  return { loggedDays: logged.length, days: daily.length, avgKcal: avg('kcal'), avgProtein: avg('protein'), avgCarbs: avg('carbs'), avgFat: avg('fat') };
}

/* ---------- Recipes ---------- */
// Per-100 values of a recipe from its ingredients. If any ingredient's value is unknown, the
// recipe value is unknown too. cookedWeight lets the user account for water loss/gain.
function recipePer100(ingredients, cookedWeight) {
  const list = (ingredients || []).filter(i => i && i.product && validAmount(i.amount) !== null);
  if (!list.length) throw Object.assign(Error('En az bir malzeme gerekli'), { code: 'empty' });
  if(list.some(i=>i.product.basis==='ml')&&!cookedWeight)throw Error('Sıvı malzemeli tarif için ölçülmüş hazır ağırlık (g) gerekli');
  const raw = list.reduce((s, i) => s + validAmount(i.amount), 0);
  const weight = cookedWeight === undefined || cookedWeight === '' || cookedWeight === null ? raw : validAmount(cookedWeight);
  if (weight === null) throw Object.assign(Error('Pişmiş ağırlık geçersiz'), { code: 'weight' });
  const per100 = {};
  for (const k of KEYS) {
    let sum = 0, ok = true;
    for (const i of list) { const v = i.product.per100?.[k]; if (!known(v)) { ok = false; break; } sum += v * validAmount(i.amount) / 100; }
    per100[k] = ok ? round(sum / weight * 100, 2) : null;
  }
  return { per100, weight: round(weight, 1), rawWeight: round(raw, 1) };
}

/* ---------- Barcodes ---------- */
// GTIN-8/12/13/14 check digit. Returns 'ok', 'checksum' (format fine, digit mismatch) or 'format'.
function checkBarcode(input) {
  const s = String(input || '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return { status: 'format', code: s };
  const digits = s.split('').map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return { status: (10 - sum % 10) % 10 === check ? 'ok' : 'checksum', code: s };
}
const looksLikeBarcode = q => /^\d{8,14}$/.test(String(q || '').replace(/[\s-]/g, ''));

/* ---------- Errors ---------- */
// Single place that turns adapter/HTTP errors into a UI state.
function errorKind(err) {
  if (!err) return 'unknown';
  if (err.kind) return err.kind;
  const s = Number(err.status);
  if (err.offline || s === 0) return 'offline';
  if (s === 401) return 'session';
  if (s === 403) return 'forbidden';
  if (s === 404) return 'notFound';
  if (s === 422) return 'incomplete';
  if (s === 429) return 'rateLimit';
  if (s === 501) return 'unsupported';
  if (s === 502 || s === 503 || s === 504) return 'source';
  if (s >= 500) return 'server';
  if (s >= 400) return 'validation';
  return 'unknown';
}
const ERROR_TEXT = {
  offline: 'Bağlantı yok. İnternet gelince tekrar dene; kayıtların cihazda saklanmaz.',
  session: 'Oturum süren doldu. Devam etmek için yeniden giriş yap.',
  forbidden: 'Bu bilgiye erişim yetkin yok.',
  notFound: 'Aranan kayıt bulunamadı.',
  incomplete: 'Ürün bulundu ancak 100 g besin değerleri eksik ya da hacim (ml) bazlı.',
  rateLimit: 'Çok fazla istek gönderildi. Biraz bekleyip tekrar dene.',
  unsupported: 'Bu özellik sunucuda henüz etkin değil.',
  source: 'Besin kaynağına şu an ulaşılamıyor. Biraz sonra tekrar dene ya da ürünü elle ekle.',
  server: 'Sunucu isteği tamamlayamadı. Biraz sonra tekrar dene.'
};
function errorText(err) {
  const kind = errorKind(err);
  if (kind === 'validation') return String(err.message || 'Girilen bilgiyi kontrol et.');
  return ERROR_TEXT[kind] || String(err?.message || 'Beklenmeyen bir hata oluştu.');
}
// Camera failures -> [title, help]. Mirrors V9 QR wording so members see the same guidance.
function cameraErrorText(err) {
  const name = err?.name || '';
  if (name === 'InsecureContext') return ['Kamera için güvenli bağlantı (HTTPS) gerekli.', 'Uygulamayı https:// adresinden aç ya da barkodu elle gir.'];
  if (name === 'NoMediaDevices') return ['Bu tarayıcı kameraya erişemiyor.', 'Barkodu elle girebilirsin.'];
  if (name === 'NoBarcodeDetector') return ['Bu tarayıcı barkod okumayı desteklemiyor.', 'iOS Safari gibi bazı tarayıcılarda otomatik okuma yok. Barkodun altındaki rakamları elle gir.'];
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return ['Kamera izni verilmedi.', 'Tarayıcı veya telefon ayarlarından bu site için kamera iznini aç, sonra tekrar dene. İstersen barkodu elle gir.'];
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return ['Kullanılabilir kamera bulunamadı.', 'Barkodu elle girebilirsin.'];
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return ['Kamera başka bir uygulama tarafından kullanılıyor.', 'Diğer kamera uygulamalarını kapatıp tekrar dene.'];
  return ['Kamera açılamadı.', 'Tekrar dene ya da barkodu elle gir.'];
}

/* ---------- Formatting ---------- */
const NF = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
function fmt(v, unit = '', digits = 1) {
  if (!known(v)) return 'Bilinmiyor';
  const s = (digits === 0 ? NF0 : NF).format(v);
  return unit ? s + ' ' + unit : s;
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const api = {
  MEALS, MEAL_IDS, NUTRIENTS, KEYS, MACROS, KCAL_PER_GRAM, MAX_AMOUNT,
  toNum, known, round, safeUrl, sourceInfo, normalizeProduct, missingKeys, coreComplete,
  validAmount, portion, sumNutrients, progress, ring, macroTargets, normalizeGoals, bmi, bmiBand,
  localDate, parseDate, addDays, weekStart, dayLabel, DAY_SHORT,
  groupByMeal, guessMeal, chartBars, macroEnergyShare, periodSummary, recipePer100,
  checkBarcode, looksLikeBarcode, errorKind, errorText, cameraErrorText, fmt, esc
};
if (typeof module === 'object' && module.exports) module.exports = api;
else global.NutritionCore = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
