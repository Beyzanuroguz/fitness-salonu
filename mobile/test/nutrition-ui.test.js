'use strict';
// Nutrition+ frontend tests: portion maths, unknown values, API adapter errors, camera/barcode
// states, CSP safety, responsive CSS and the live V8 contract against an in-memory server.
// No real customer database is opened: the server is loaded with FITNESS_DB_PATH=:memory:.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const pub = path.join(__dirname, '..', '..', 'public');
const dir = path.join(pub, 'nutrition');
const C = require(path.join(dir, 'nutrition-core.js'));
const A = require(path.join(dir, 'nutrition-api.js'));
const V = require(path.join(dir, 'nutrition-views.js'));
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const today = C.localDate();

/* ---------- Portion calculation ---------- */
test('portion scales per-100 values to grams and millilitres', () => {
  const oats = C.normalizeProduct({ name: 'Yulaf', kcal_100g: 372, protein_100g: 13.5, carbs_100g: 58.7, fat_100g: 7 });
  assert.deepEqual(
    Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map(k => [k, C.portion(oats, 40)[k]])),
    { kcal: 148.8, protein: 5.4, carbs: 23.48, fat: 2.8 });
  assert.equal(C.portion(oats, '150,5').kcal, 559.86);
  const milk = C.normalizeProduct({ name: 'Süt', basis: 'ml', per_100: { kcal: 46, protein: 3.2, carbs: 4.7, fat: 1.5 }, servings: [{ label: '1 bardak', amount: 200 }] });
  assert.equal(milk.basis, 'ml');
  assert.equal(C.portion(milk, milk.servings[0].amount).kcal, 92);
  for (const bad of [0, -5, '', 'abc', 5001, null]) assert.throws(() => C.portion(oats, bad), /Miktar/);
});

test('unknown nutrient values stay unknown and are shown as Bilinmiyor', () => {
  const p = C.normalizeProduct({ name: 'Çikolata', kcal_100g: 579, protein_100g: 7.8, carbs_100g: null, fat_100g: '', sugar_100g: 28 });
  assert.equal(p.per100.carbs, null);
  assert.equal(p.per100.fat, null);
  assert.deepEqual(C.missingKeys(p), ['carbs', 'fat', 'fiber', 'salt']);
  assert.equal(C.coreComplete(p), false);
  const part = C.portion(p, 50);
  assert.equal(part.carbs, null);
  assert.equal(part.kcal, 289.5);
  assert.equal(C.fmt(part.carbs, 'g'), 'Bilinmiyor');
  const sum = C.sumNutrients([part, { kcal: 100, protein: 1, carbs: 10, fat: 1 }]);
  assert.equal(sum.totals.carbs, 10);
  assert.equal(sum.unknown.carbs, 1);
  assert.equal(sum.partial, true);
  // Negative or non-numeric values from a source are never coerced to 0.
  assert.equal(C.toNum(-1), null);
  assert.equal(C.toNum('x'), null);
  assert.equal(C.toNum(true), null);
});

test('goals, ring and macro targets', () => {
  assert.deepEqual(C.macroTargets(2000), { protein: 125, carbs: 250, fat: 56 });
  assert.throws(() => C.macroTargets(2000, { protein: 50, carbs: 50, fat: 50 }), /%100/);
  assert.equal(C.normalizeGoals({ kcal: 500 }), null);
  assert.deepEqual(C.normalizeGoals({ kcal: '2200', protein: '150' }), { kcal: 2200, protein: 138, carbs: 275, fat: 61 });
  assert.deepEqual(C.progress(2500, 2000), { pct: 100, remaining: -500, over: true, hasGoal: true });
  assert.equal(C.progress(500, null).hasGoal, false);
  const r = C.ring(25);
  assert.ok(Math.abs(r.offset - r.circumference * 0.75) < 0.02);
  assert.equal(C.bmi(180, 80), 24.7);
  assert.equal(C.bmiBand(24.7), 'Normal aralık');
});

test('recipes: per-100 from ingredients, cooked weight and unknown propagation', () => {
  const a = C.normalizeProduct({ name: 'A', kcal_100g: 100, protein_100g: 10, carbs_100g: 10, fat_100g: 2 });
  const b = C.normalizeProduct({ name: 'B', kcal_100g: 300, protein_100g: 0, carbs_100g: 50, fat_100g: 10 });
  const r = C.recipePer100([{ product: a, amount: 100 }, { product: b, amount: 100 }]);
  assert.equal(r.per100.kcal, 200);
  assert.equal(C.recipePer100([{ product: a, amount: 100 }, { product: b, amount: 100 }], 100).per100.kcal, 400);
  const c = C.normalizeProduct({ name: 'C', kcal_100g: 50, protein_100g: 1, carbs_100g: null, fat_100g: 0 });
  assert.equal(C.recipePer100([{ product: a, amount: 100 }, { product: c, amount: 50 }]).per100.carbs, null);
  assert.throws(() => C.recipePer100([]), /malzeme/);
});

test('dates use local calendar and Monday weeks; charts include the goal line', () => {
  assert.equal(C.weekStart('2026-11-19'), '2026-11-16');
  assert.equal(C.weekStart('2026-11-22'), '2026-11-16');
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(C.parseDate('2026-02-30'), null);
  const c = C.chartBars([{ date: 'a', kcal: 1000 }, { date: 'b', kcal: 2500 }], 2000);
  assert.equal(c.max, 2500);
  assert.equal(c.goalPct, 80);
  assert.equal(c.bars[1].over, true);
  assert.deepEqual(C.periodSummary({ daily: [{ kcal: 0 }, { kcal: 1000, protein: 50 }, { kcal: 2000, protein: 100 }] }).avgKcal, 1500);
  const groups = C.groupByMeal([{ meal: 'lunch' }, { meal: null }, { meal: 'x' }]);
  assert.equal(groups.lunch.length, 1);
  assert.equal(groups.unassigned.length, 2);
});

/* ---------- Barcode and camera permission states ---------- */
test('barcode check digits and formats', () => {
  assert.equal(C.checkBarcode('3017620422003').status, 'ok');     // EAN-13
  assert.equal(C.checkBarcode('96385074').status, 'ok');          // EAN-8
  assert.equal(C.checkBarcode('036000291452').status, 'ok');      // UPC-A
  assert.equal(C.checkBarcode('3017 6204-22003').code, '3017620422003');
  assert.equal(C.checkBarcode('3017620422004').status, 'checksum');
  for (const bad of ['123', 'abcdefgh', '12345678901', '']) assert.equal(C.checkBarcode(bad).status, 'format');
  assert.equal(C.looksLikeBarcode('8690000000017'), true);
  assert.equal(C.looksLikeBarcode('yulaf'), false);
});

test('camera errors map to actionable messages with a manual fallback', () => {
  const cases = { NotAllowedError: /izni verilmedi/, PermissionDeniedError: /izni verilmedi/, NotFoundError: /bulunamadı/, NotReadableError: /başka bir uygulama/, InsecureContext: /HTTPS/, NoBarcodeDetector: /desteklemiyor/, NoMediaDevices: /kameraya erişemiyor/, Whatever: /açılamadı/ };
  for (const [name, re] of Object.entries(cases)) {
    const [title, help] = C.cameraErrorText({ name });
    assert.match(title, re, name);
    assert.ok(help.length > 10, name);
  }
  assert.match(C.cameraErrorText({ name: 'NotAllowedError' })[1], /elle/);
  const js = read('nutrition.js');
  for (const s of ['isSecureContext', 'BarcodeDetector', 'getSupportedFormats', 'getUserMedia', 'stopCamera', 'visibilitychange', 'torch']) assert.ok(js.includes(s), s);
});

test('scan view: permission denied, not found, network error and manual entry', () => {
  const base = { caps: A.LIVE_CAPS, scan: { active: false, starting: false, manual: '', check: '', lookup: { loading: false, error: null } } };
  const denied = V.scan({ ...base, scan: { ...base.scan, error: C.cameraErrorText({ name: 'NotAllowedError' }) } });
  assert.match(denied, /Kamera izni verilmedi/);
  assert.match(denied, /data-form="barcode"/);
  assert.match(denied, /inputmode="numeric"/);
  const notFound = V.scan({ ...base, scan: { ...base.scan, lookup: { error: { status: 422, kind: 'notFoundBarcode' } } } });
  assert.match(notFound, /Ürün bulunamadı/);
  assert.match(notFound, /manual-food-barcode/);
  const offline = V.scan({ ...base, scan: { ...base.scan, lookup: { error: { status: 0, offline: true } } } });
  assert.match(offline, /Bağlantı yok/);
  assert.match(offline, /scan-retry/);
  const source = V.scan({ ...base, scan: { ...base.scan, lookup: { error: { status: 502 } } } });
  assert.match(source, /Besin kaynağına şu an ulaşılamıyor/);
  assert.match(V.scan({ ...base, scan: { ...base.scan, check: 'checksum' } }), /Kontrol hanesi/);
});

/* ---------- API adapter ---------- */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const hit = routes(url, init);
    if (hit instanceof Error) throw hit;
    const [status, body] = hit;
    return { ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw SyntaxError('x'); return body; } };
  };
  fn.calls = calls;
  return fn;
}

test('adapter maps HTTP failures to UI error kinds', async () => {
  const mk = (status, body) => A.createNutritionApi({ contract:'v8', fetchImpl: fakeFetch(() => [status, body]) });
  const kind = async (api, fn) => { try { await fn(api); assert.fail('no error'); } catch (e) { return C.errorKind(e); } };
  assert.equal(await kind(mk(401, { error: 'Oturum' }), a => a.history('daily', today)), 'session');
  assert.equal(await kind(mk(200, { user: null }), a => a.me()), 'session');
  assert.equal(await kind(mk(502, { error: 'x' }), a => a.search('yulaf')), 'source');
  assert.equal(await kind(mk(429, { error: 'x' }), a => a.search('yulaf')), 'rateLimit');
  assert.equal(await kind(mk(500, undefined), a => a.foods()), 'server');
  assert.equal(await kind(mk(422, { error: 'x' }), a => a.barcode('3017620422003')), 'notFoundBarcode');
  assert.equal(await kind(mk(200, { daily: 'bad' }), a => a.history('daily', today)), 'server');
  const offline = A.createNutritionApi({ contract:'v8', fetchImpl: fakeFetch(() => TypeError('net')), online: () => false });
  assert.equal(await kind(offline, a => a.foods()), 'offline');
  // Features V8 does not have are reported, not guessed.
  const live = mk(200, {});
  for (const f of ['favorites', 'toggleFavorite', 'measurements', 'addMeasurement']) assert.equal(await kind(live, a => a[f]()), 'unsupported', f);
  assert.equal(await kind(live, a => a.search('a')), 'validation');
  assert.equal(await kind(live, a => a.barcode('12')), 'validation');
  assert.equal(await kind(live, a => a.addLog({ productId: 1, amount: 0, date: today })), 'validation');
  assert.equal(await kind(live, a => a.createFood({ name: 'x', per100: { kcal: 1, protein: 1, carbs: null, fat: 1 } })), 'validation');
  assert.match(C.errorText({ status: 401 }), /yeniden giriş/);
  assert.match(C.errorText({ status: 400, message: 'Geçersiz tarih' }), /Geçersiz tarih/);
});

test('adapter sends JSON, cookies and API base exactly as the existing V8 client does', async () => {
  const f = fakeFetch((url, init) => url.includes('/food-logs/') ? [200, { ok: true }] : url.includes('/food-logs') ? [200, { id: 9 }] : [200, { products: [{ name: 'Yulaf', kcal_100g: 1, protein_100g: 1, carbs_100g: 1, fat_100g: 1, source: 'Open Food Facts', source_id: '3017620422003', source_url: 'javascript:alert(1)' }], attribution: 'Open Food Facts — ODbL-1.0' }]);
  const api = A.createNutritionApi({ contract:'v8', fetchImpl: f, base: 'https://api.example.com/' });
  const r = await api.search('yulaf ezmesi');
  assert.equal(f.calls[0].url, 'https://api.example.com/api/v8/foods/search?q=yulaf%20ezmesi');
  assert.equal(f.calls[0].init.credentials, 'include');
  assert.equal(f.calls[0].init.cache, 'no-store');
  assert.equal(r.products[0].source.kind, 'openfoodfacts');
  assert.equal(r.products[0].source.url, '', 'non-https source links are dropped');
  assert.equal(r.products[0].id, null, 'search results must be selected before logging');
  await api.addLog({ productId: 3, amount: '150', date: today, meal: 'lunch' });
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { product_id: 3, grams: 150, consumed_on: today, meal: 'lunch' });
  await api.deleteLog(9);
  assert.equal(f.calls[2].init.method, 'DELETE');
  assert.equal(f.calls[2].init.headers['Content-Type'], 'application/json', 'CSRF guard needs JSON on DELETE');
  const same = A.createNutritionApi({ contract:'v8', fetchImpl: fakeFetch(() => [200, []]) });
  await same.foods();
  assert.ok(!Object.values(A.ENDPOINTS).some(e => /key|token|secret/i.test(e)));
});

test('preview data only on localhost with ?preview=mock, never native or deployed', async () => {
  assert.equal(A.resolveMode({ hostname: 'localhost', search: '?preview=mock' }, {}), 'preview');
  assert.equal(A.resolveMode({ hostname: '127.0.0.1', search: '?preview=mock' }, {}), 'preview');
  assert.equal(A.resolveMode({ hostname: 'club.example.com', search: '?preview=mock' }, {}), 'live');
  assert.equal(A.resolveMode({ hostname: 'localhost', search: '?preview=mock' }, { native: true }), 'live');
  assert.equal(A.resolveMode({ hostname: 'localhost', search: '' }, {}), 'live');
  const api = A.createNutritionApi({ contract:'v8', mode: 'preview', delay: 0 });
  const r = await api.search('yulaf');
  assert.ok(r.products.length && r.products.every(p => p.preview && p.source.kind === 'preview'));
  assert.match(r.products[0].source.label, /Örnek veri/);
  const S = { preview: true, online: true, route: 'today', user: { name: 'x' }, sheet: null };
  assert.match(V.shell(S, ''), /ÖNİZLEME/);
  assert.doesNotMatch(V.shell({ ...S, preview: false }, ''), /ÖNİZLEME/);
});

/* ---------- Views: states, accessibility, escaping ---------- */
function baseState(over = {}) {
  const list = () => ({ loading: false, error: null, items: [], loaded: true });
  return {
    boot: 'ready', session: 'ok', user: { name: 'Üye' }, preview: false, caps: A.LIVE_CAPS, recipePrefix: A.RECIPE_PREFIX,
    online: true, route: 'today', today, date: today, toast: '', goals: null, mealTags: {}, pendingMeal: null,
    day: { loading: false, error: null, data: null },
    search: { q: '', tab: 'results', loading: false, error: null, results: null, attribution: '', lists: { recents: list(), favorites: list(), recipes: list() } },
    sheet: null, scan: { lookup: {}, manual: '', check: '' },
    trends: { period: 'weekly', anchor: today, loading: false, error: null, data: null },
    body: { goalError: '', form: {}, estimate: {}, measurements: list() },
    recipe: { active: false, items: [], name: '', cooked: '' }, ...over
  };
}

test('loading, empty, error, offline and session-expired states render', () => {
  assert.match(V.page(baseState({ boot: 'loading' })), /aria-busy|açılıyor/);
  assert.match(V.page(baseState({ day: { loading: true, data: null } })), /aria-busy="true"/);
  assert.match(V.page(baseState({ day: { data: { logs: [], daily: [], totals: {} } } })), /Bu gün için kayıt yok/);
  assert.match(V.page(baseState({ day: { error: { status: 500 } } })), /role="alert"[\s\S]*reload-day/);
  const off = V.page(baseState({ online: false, day: { error: { status: 0, offline: true } } }));
  assert.match(off, /Çevrimdışısın/);
  assert.match(off, /Bağlantı yok/);
  const expired = V.page(baseState({ session: 'expired' }));
  assert.match(expired, /Oturum süren doldu/);
  assert.match(expired, /href="\/" target="_top"/);
  assert.doesNotMatch(expired, /tabbar/, 'no personal screens behind the re-login prompt');
  assert.match(V.page(baseState({ route: 'search', search: { ...baseState().search, results: [] } })), /Sonuç bulunamadı/);
  assert.match(V.page(baseState({ caps:A.V8_CAPS,route: 'search', search: { ...baseState().search, tab: 'favorites' } })), /Sunucu desteği bekleniyor/);
  assert.match(V.page(baseState({ route: 'body' })), /Vücut ölçümü geçmişi/);
});

test('dashboard: ring, macro progress bars, meals and unassigned logs', async () => {
  const api = A.createNutritionApi({ contract:'v8', mode: 'preview', delay: 0, today });
  const data = await api.history('daily', today);
  data.logs.push({ ...data.logs[0], id: 999, meal: null });
  const html = V.page(baseState({ caps: api.caps, goals: C.normalizeGoals({ kcal: 2000 }), day: { data } }));
  assert.match(html, /class="ring"[^>]*role="img"[^>]*aria-label="[^"]*hedef 2\.000 kcal/);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 3);
  for (const m of ['Kahvaltı', 'Öğle', 'Akşam', 'Ara öğün', 'Öğünü belirtilmemiş']) assert.ok(html.includes(m), m);
  assert.match(html, /data-act="add-to-meal" data-meal="breakfast"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Bazı ürünlerde değer bilinmiyor/);
  const noGoal = V.page(baseState({ day: { data } }));
  assert.match(noGoal, /hedef belirlenmedi/);
});

test('product sheet: 100 g/ml basis, portion chips, unknown values and source', () => {
  const p = C.normalizeProduct({ id: 4, name: 'Süt', brand: 'Marka', basis: 'ml', kcal_100g: 46, protein_100g: 3.2, carbs_100g: null, fat_100g: 1.5, servings: [{ label: '1 bardak', amount: 200 }], source: 'Open Food Facts', source_url: 'https://world.openfoodfacts.org/product/1' });
  const html = V.sheet(baseState({ sheet: { kind: 'product', product: p, amount: '200', meal: 'breakfast' } }));
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /100 ml/);
  assert.match(html, /1 bardak \(200 ml\)/);
  assert.match(html, /<td class="unknown">Bilinmiyor<\/td>/);
  assert.match(html, /Bilinmeyen değer: Karbonhidrat/);
  assert.match(html, /92 kcal/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Open Food Facts/);
  assert.doesNotMatch(html,/yalnızca gram bazlı/,'Nutrition+ supports ml without density conversion');
  const legacy=V.sheet(baseState({caps:A.V8_CAPS,sheet:{kind:'product',product:p,amount:'200',meal:'breakfast'}}));
  assert.match(legacy,/yalnızca gram bazlı/);assert.match(legacy,/type="submit" disabled/);
  const bad = V.sheet(baseState({ sheet: { kind: 'product', product: { ...p, basis: 'g' }, amount: '0', meal: 'lunch' } }));
  assert.match(bad, /Miktar 0’dan büyük/);
});

test('every dynamic value is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = C.normalizeProduct({ id: 1, name: evil, brand: evil, kcal_100g: 1, protein_100g: 1, carbs_100g: 1, fat_100g: 1, source: evil });
  p.key = '"><script>';
  const html = V.productCard(p) + V.sheet(baseState({ sheet: { kind: 'product', product: p, amount: '1', meal: 'lunch' } })) + V.shell(baseState({ user: { name: evil }, toast: evil }), '');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
});

test('trend charts: daily, weekly and monthly render accessible SVG', async () => {
  const api = A.createNutritionApi({ contract:'v8', mode: 'preview', delay: 0, today });
  for (const period of ['daily', 'weekly', 'monthly']) {
    const data = await api.history(period, today);
    const html = V.trends(baseState({ goals: C.normalizeGoals({ kcal: 2000 }), trends: { period, anchor: today, data } }));
    assert.match(html, /role="tablist"/, period);
    if (period === 'daily') assert.match(html, /Öğünlere göre kalori/);
    else { assert.match(html, /<svg viewBox="0 -4 320/); assert.match(html, /class="goal"/); assert.equal((html.match(/class="cbar/g) || []).length, data.days); }
    assert.match(html, /Enerji dağılımı/);
  }
});

/* ---------- CSP, privacy and responsive layout ---------- */
test('Nutrition+ is CSP-safe: no inline script, handlers, eval or javascript: URLs', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['/runtime-config.js', '/table-cards.js', '/nutrition/nutrition-core.js', '/nutrition/nutrition-api.js', '/nutrition/nutrition-views.js', '/nutrition/nutrition.js']);
  for (const f of ['index.html', 'nutrition.js', 'nutrition-views.js', 'nutrition-api.js', 'nutrition-core.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["'`]/i, f);
    assert.doesNotMatch(src, /javascript:/i, f);
    assert.doesNotMatch(src, /\beval\(|new Function\(|setTimeout\(\s*['"`]/, f);
    assert.doesNotMatch(src, /style="/, f);
    assert.doesNotMatch(src, /api[_-]?key|apikey|secret/i, f);
  }
  assert.match(read('nutrition.js'), /FORMCLUB_CONFIG/);
});

test('personal nutrition data is never written to persistent storage or caches', () => {
  const js = read('nutrition.js');
  assert.doesNotMatch(js, /localStorage|indexedDB|caches\.|serviceWorker/);
  // Fallback/preview goals and meal tags stay in memory, scoped by identity.
  assert.deepEqual([...new Set([...js.matchAll(/(?:save|load)\('([a-z]+)'/g)].map(m => m[1]))].sort(), ['goals', 'meals']);
  assert.match(js, /fcn:\$\{mode\}:\$\{S\.user\?\.id/);
  // Root service worker does not precache Nutrition+ and bypasses every /api/ request.
  assert.match(fs.readFileSync(path.join(pub, 'sw.js'), 'utf8'), /pathname.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(js,/sessionStorage/);
});

test('responsive CSS: 360 px phones, tablet and desktop rail without horizontal overflow', () => {
  const css = read('nutrition.css');
  assert.match(css, /html,body\{[^}]*overflow-x:hidden/);
  assert.match(css, /@media \(max-width:380px\)/);
  assert.match(css, /@media \(min-width:720px\)/);
  assert.match(css, /@media \(min-width:1024px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.tabbar\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  // Touch targets: buttons and icon buttons are at least 44 px.
  assert.match(css, /\.btn\{[^}]*min-height:44px/);
  assert.match(css, /\.iconbtn\{[^}]*width:44px;height:44px/);
  // Inputs are 16 px so iOS does not zoom on focus.
  assert.match(css, /\.field input[^{]*\{[^}]*font-size:16px/);
  // No fixed width above 360 px outside min() / media queries.
  const outside = css.replace(/@media[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  for (const m of outside.matchAll(/(?<![-\w])(?:min-)?width:(\d+)px/g)) assert.ok(Number(m[1]) <= 360, m[0]);
  const html = read('index.html');
  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale/);
});

test('mobile web bundle includes Nutrition+ files', () => {
  const { bundleWeb } = require('../lib/web-bundle');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'formclub-nutrition-')), 'web');
  bundleWeb({ publicDir: pub, outDir: out, apiUrl: 'https://api.example.com' });
  for (const f of ['index.html', 'nutrition.css', 'nutrition.js', 'nutrition-api.js', 'nutrition-core.js', 'nutrition-views.js']) assert.ok(fs.existsSync(path.join(out, 'nutrition', f)), f);
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
});

/* ---------- Live V8 contract (in-memory database, no network) ---------- */
test('adapter works against the real V8 endpoints on an in-memory database', async t => {
  process.env.NODE_ENV = 'test';
  process.env.FITNESS_DB_PATH = ':memory:';
  const { server, db } = require('../../server');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const fetchImpl = async (url, init = {}) => {
    const r = await fetch(url, { ...init, headers: { ...init.headers, ...(cookie ? { cookie } : {}) } });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return r;
  };
  const anon = A.createNutritionApi({ contract:'v8', fetchImpl: (u, i) => fetch(u, i), base });
  await assert.rejects(anon.me(), e => C.errorKind(e) === 'session');
  await assert.rejects(anon.history('daily', today), e => C.errorKind(e) === 'session');
  await fetchImpl(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nutrition-test', password: 'test-password-123' }) });
  assert.ok(cookie.startsWith('fc_session='));
  const api = A.createNutritionApi({ contract:'v8', fetchImpl, base });
  assert.ok((await api.me()).role);
  const food = await api.createFood({ name: 'Test yulaf', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 } });
  assert.equal(food.source.kind, 'manual');
  assert.ok(food.id > 0);
  const recipe = await api.saveRecipe({ name: 'Smoothie', per100: { kcal: 80, protein: 3, carbs: 12, fat: 2 } });
  assert.equal(recipe.name, 'Tarif · Smoothie');
  assert.deepEqual((await api.recipes()).map(p => p.id), [recipe.id]);
  assert.ok((await api.recents()).every(p => p.id !== recipe.id));
  const log = await api.addLog({ productId: food.id, amount: 40, date: today, meal: 'breakfast' });
  const day = await api.history('daily', today);
  assert.equal(day.logs.length, 1);
  assert.equal(day.logs[0].nutrients.kcal, 148.8);
  assert.equal(day.logs[0].meal, null, 'V8 does not store meals; the UI keeps them per session');
  assert.equal(day.totals.kcal, 148.8);
  assert.equal((await api.history('weekly', today)).daily.length, 7);
  await api.deleteLog(log.id);
  assert.equal((await api.history('daily', today)).logs.length, 0);
  await assert.rejects(api.deleteLog(log.id), e => C.errorKind(e) === 'notFound');
  await assert.rejects(api.addLog({ productId: 999999, amount: 10, date: today }), e => C.errorKind(e) === 'notFound');
  const est = await api.estimate({ age: 30, height_cm: 180, weight_kg: 80, sex: 'male', activity: 'moderate', goal: 'maintain' });
  assert.equal(est.estimated, true);
  // The page itself is served under the same CSP as the rest of the app.
  const page = await fetch(base + '/nutrition/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
});

/* ---------- Controller boot with a minimal DOM stub (no real browser) ---------- */
test('controller boots in preview mode, routes and handles session expiry', async () => {
  const vm = require('node:vm');
  const listeners = {};
  const makeRoot = () => ({ innerHTML: '', contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener: (n, f) => { listeners['root:' + n] = f; } });
  const run = async (hostname, search, fetchImpl) => {
    const root = makeRoot();
    const store = new Map();
    const win = {
      location: { hostname, search, hash: '#today' }, navigator: { onLine: true }, FORMCLUB_CONFIG: { apiBase: '', native: false },
      document: { documentElement: { classList: { add() {}, toggle() {} } }, getElementById: () => root, addEventListener() {}, activeElement: null, body: {} },
      sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
      addEventListener: (n, f) => { listeners['win:' + n] = f; }, CSS: { escape: s => s }, fetch: fetchImpl,
      URLSearchParams, URL, Intl, Error, Promise, Math, JSON, Object, Array, Number, String, Map, Set, Date, setTimeout, clearTimeout, setInterval, clearInterval, isSecureContext: false
    };
    win.window = win; win.globalThis = win;
    const ctx = vm.createContext(win);
    for (const f of ['nutrition-core.js', 'nutrition-api.js', 'nutrition-views.js', 'nutrition.js']) vm.runInContext(read(f), ctx, { filename: f });
    await new Promise(r => setTimeout(r, 1500));
    return { root, win };
  };
  const preview = await run('localhost', '?preview=mock', () => { throw Error('preview must not call the network'); });
  assert.match(preview.root.innerHTML, /ÖNİZLEME/);
  assert.match(preview.root.innerHTML, /Kahvaltı/);
  assert.match(preview.root.innerHTML, /role="progressbar"/);
  preview.win.location.hash = '#trends'; listeners['win:hashchange']();
  await new Promise(r => setTimeout(r, 800));
  assert.match(preview.root.innerHTML, /Grafikler/);
  const expired = await run('club.example.com', '?preview=mock', async () => ({ ok: true, status: 200, json: async () => ({ user: null }) }));
  assert.match(expired.root.innerHTML, /Oturum süren doldu/);
  assert.doesNotMatch(expired.root.innerHTML, /ÖNİZLEME/, 'preview is refused on a deployed host');
});

test('opening a search hit resolves its actual unit before the amount form and displays source dates',async()=>{
 const vm=require('node:vm'),listeners={};
 const root={innerHTML:'',contains:x=>!!x,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(k,f)=>listeners[k]=f};
 const stub=C.normalizeProduct({name:'Search liquid',source_id:'3017620422003',source:'Open Food Facts',details_loaded:false});
 const full=C.normalizeProduct({name:'Search liquid',source_id:'3017620422003',source:'Open Food Facts',basis:'ml',per_100:{kcal:40},retrieved_at:'2026-11-17T12:00:00Z',updated_at:'2026-11-16T10:00:00Z'});
 let reads=0,writes=0;
 const api={preview:false,caps:{...A.PLUS_CAPS,favorites:false},me:async()=>({id:1,role:'member'}),goals:async()=>null,search:async()=>({products:[stub]}),barcode:async()=>{reads++;return full;},addLog:async()=>{writes++;}};
 const context={NutritionCore:C,NutritionViews:V,NutritionApi:{resolveMode:()=> 'live',createNutritionApi:()=>api},FORMCLUB_CONFIG:{},document:{documentElement:{classList:{add(){},toggle(){}}},getElementById:()=>root,addEventListener(){},activeElement:null,body:{}},location:{hash:'#search',search:''},navigator:{onLine:true},CSS:{escape:s=>s},URLSearchParams,setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){}};
 context.window=context;vm.createContext(context);vm.runInContext(read('nutrition.js'),context);await new Promise(setImmediate);
 const f={dataset:{form:'search'},q:{value:'liquid'}};listeners.submit({preventDefault(){},target:{closest:()=>f}});await new Promise(setImmediate);
 const key=root.innerHTML.match(/data-act="open-product"[^>]*data-key="([^"]+)"/)?.[1]||root.innerHTML.match(/data-key="([^"]+)"/)?.[1];assert.ok(key);
 const button={dataset:{act:'open-product',key}};listeners.click({preventDefault(){},target:{closest:()=>button}});await new Promise(setImmediate);
 assert.equal(reads,1);assert.equal(writes,0);assert.match(root.innerHTML,/Miktar \(ml\)/);assert.match(root.innerHTML,/Kaynak güncellemesi: 2026-11-16T10:00:00Z/);assert.match(root.innerHTML,/Alındı: 2026-11-17T12:00:00Z/);
});
