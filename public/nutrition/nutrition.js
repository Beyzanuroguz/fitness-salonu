/* FORM CLUB Nutrition+ controller: state, routing, events, camera. Rendering lives in
   nutrition-views.js, API knowledge in nutrition-api.js, maths in nutrition-core.js.
   CSP-safe: no inline handlers, no eval; all events are delegated from #nutrition-root. */
(function () {
'use strict';
const Core = window.NutritionCore, V = window.NutritionViews, NA = window.NutritionApi;
const cfg = window.FORMCLUB_CONFIG || {};
const params = new URLSearchParams(location.search);
if (params.has('embedded')) document.documentElement.classList.add('embedded');
const mode = NA.resolveMode(location, cfg);
const API = NA.createNutritionApi({ mode, fetchImpl: (u, i) => fetch(u, i), base: cfg.apiBase, online: () => navigator.onLine !== false });
const root = document.getElementById('nutrition-root');
const ROUTES = V.TABS.map(t => t[0]);
const today = Core.localDate();
const list = () => ({ loading: false, error: null, items: [], loaded: false });

const S = {
  boot: 'loading', bootError: null, session: 'ok', user: null,
  preview: API.preview, caps: API.caps, recipePrefix: NA.RECIPE_PREFIX,
  online: navigator.onLine !== false,
  route: ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  today, date: today, toast: '',
  goals: null, mealTags: {}, pendingMeal: null,
  day: { loading: false, error: null, data: null },
  search: { q: '', tab: 'results', loading: false, error: null, results: null, attribution: '', lastQuery: '', lists: { recents: list(), favorites: list(), recipes: list() } },
  sheet: null,
  scan: { active: false, starting: false, error: null, torch: false, torchOn: false, manual: '', check: '', lookup: { loading: false, error: null }, lastCode: '' },
  trends: { period: 'weekly', anchor: today, loading: false, error: null, data: null },
  body: { goalError: '', form: { age: '', sex: 'female', height_cm: '', weight_kg: '', activity: 'moderate', goal: 'maintain' }, estimate: { loading: false, error: null, data: null }, measurements: list() },
  recipe: { active: false, name: '', items: [], cooked: '', saving: false, error: '' }
};

/* ---------- In-memory preview/fallback state; live goals stay on the server ---------- */
const storeKey = k => `fcn:${mode}:${S.user?.id ?? 'anon'}:${k}`;
const memory=new Map();
function load(k){return memory.get(storeKey(k))??null}
function save(k,v){if(v===null)memory.delete(storeKey(k));else memory.set(storeKey(k),v)}
async function persistGoals(g){S.goals=!S.preview&&S.caps.serverGoals?await API.saveGoals(g):g;if(S.preview)save('goals',g);if(!S.preview&&S.caps.serverGoals&&window.parent&&window.parent!==window)window.parent.postMessage({type:'formclub:nutrition-goals-updated'},location.origin);}

/* ---------- Product registry: views refer to products by an opaque key ---------- */
const registry = new Map(); let seq = 0;
function reg(p) { if (!p) return p; if (registry.size > 600) registry.clear(); p.key = 'p' + (++seq); registry.set(p.key, p); return p; }

/* ---------- Render with focus preservation ---------- */
let toastTimer = 0;
function focusSelector(el) {
  if (!el || el === document.body) return '';
  if (el.id) return '#' + CSS.escape(el.id);
  const form = el.closest('[data-form]');
  if (form && el.name) return `[data-form="${form.dataset.form}"] [name="${CSS.escape(el.name)}"]` + (el.type === 'radio' ? `[value="${CSS.escape(el.value)}"]` : '');
  if (el.dataset.act) return `[data-act="${el.dataset.act}"]` + ['key', 'tab', 'period', 'meal', 'amount'].filter(k => el.dataset[k]).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
  return '';
}
function render() {
  const active = document.activeElement;
  const sel = root.contains(active) ? focusSelector(active) : '';
  const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  root.innerHTML = V.page(S);
  document.documentElement.classList.toggle('sheet-open', !!S.sheet);
  if (sel) { const el = root.querySelector(sel); if (el) { el.focus({ preventScroll: true }); if (caret && typeof el.setSelectionRange === 'function') try { el.setSelectionRange(caret[0], caret[1]); } catch { /* number inputs */ } } }
  attachVideo();
}
function toast(msg) { S.toast = msg; render(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = ''; const t = root.querySelector('.toast'); if (t) t.textContent = ''; }, 3200); }
// Session expiry anywhere switches to the re-login screen and drops everything personal from memory.
function guard(e) {
  if (Core.errorKind(e) === 'session') { S.session = 'expired'; stopCamera(); S.sheet = null; S.day.data = null; S.trends.data = null;S.goals=null;registry.clear();memory.clear();for(const l of Object.values(S.search.lists)){l.items=[];l.loaded=false}S.recipe.items=[];S.search.results=null;S.body.measurements.items=[]; }
  return e;
}

/* ---------- Data loading ---------- */
async function loadDay() {
  S.day.loading = true; render();
  try { const d = await API.history('daily', S.date); if (d) d.logs.forEach(l => l.product && reg(l.product)); S.day.data = d; S.day.error = null; }
  catch (e) { S.day.error = guard(e); }
  S.day.loading = false; render();
}
async function loadList(name) {
  const L = S.search.lists[name];
  if (name === 'favorites' && !S.caps.favorites) return;
  L.loading = true; L.error = null; render();
  try { L.items = ((await API[name]()) || []).map(reg); L.loaded = true; }
  catch (e) { L.error = guard(e); }
  L.loading = false; render();
}
async function loadTrends() {
  const T = S.trends; T.loading = true; render();
  try { T.data = await API.history(T.period, T.anchor); T.error = null; }
  catch (e) { T.error = guard(e); T.data = null; }
  T.loading = false; render();
}
async function loadMeasurements() {
  const M = S.body.measurements; if (!S.caps.measurements) return;
  M.loading = true; M.error = null; render();
  try { M.items = await API.measurements(); M.loaded = true; } catch (e) { M.error = guard(e); }
  M.loading = false; render();
}
function enterRoute(route, { focus = false } = {}) {
  if (S.route === 'scan' && route !== 'scan') stopCamera();
  S.route = route;
  render();
  if (focus) root.querySelector('#main')?.focus({ preventScroll: false });
  if (route === 'today') loadDay();
  else if (route === 'search') { if (S.search.tab !== 'results') loadList(S.search.tab); }
  else if (route === 'trends') loadTrends();
  else if (route === 'body' && !S.body.measurements.loaded) loadMeasurements();
}

/* ---------- Search ---------- */
async function runSearch(q) {
  const Q = S.search; Q.q = q; Q.tab = 'results';
  if (q.trim().length < 2) { Q.error = Object.assign(Error('En az 2 karakter yaz'), { status: 400 }); Q.results = null; render(); return; }
  Q.loading = true; Q.error = null; Q.lastQuery = q; render();
  try {
    if (Core.looksLikeBarcode(q)) { const p = reg(await API.barcode(q)); Q.results = [p]; Q.attribution = p.source.label; }
    else { const r = await API.search(q); Q.results = r.products.map(reg); Q.attribution = r.attribution; }
  } catch (e) {
    guard(e);
    if (['notFoundBarcode', 'incomplete'].includes(Core.errorKind(e))) { Q.results = []; Q.error = null; } else { Q.error = e; Q.results = null; }
  }
  Q.loading = false; render();
}

/* ---------- Sheet ---------- */
let opener = '';
async function openProduct(p) {
  if (!p) return;
  if(p.detailsLoaded===false){
    try{p=reg(await API.barcode(p.sourceId));}
    catch(e){guard(e);toast(Core.errorText(e));return;}
    if(S.session!=='ok')return;
  }
  opener = focusSelector(document.activeElement);
  const fav = S.search.lists.favorites.items.some(f => f.id && f.id === p.id);
  S.sheet = { kind: 'product', product: p, amount: String(p.servings[0]?.amount || 100), meal: S.pendingMeal || Core.guessMeal(), saving: false, error: null, favorite: fav };
  render(); root.querySelector('.sheet [data-act="close-sheet"]')?.focus();
}
function openManual(barcode = '') {
  opener = focusSelector(document.activeElement);
  S.sheet = { kind: 'manual', barcode, values: {}, saving: false, error: null };
  render(); root.querySelector('.sheet input[name="name"]')?.focus();
}
function closeSheet() {
  S.sheet = null; render();
  const el = opener && root.querySelector(opener); (el || root.querySelector('#main'))?.focus();
}
async function submitLog(form) {
  const X = S.sheet; let p = X.product;
  X.meal = form.querySelector('input[name="meal"]:checked')?.value || X.meal;
  const amount = Core.validAmount(form.amount.value);
  if (amount === null) { X.amount = form.amount.value; render(); return; }
  X.saving = true; X.error = null; render();
  try {
    if (!p.id) { p = reg(await API.select(p.sourceId)); X.product = p; }
    const r = await API.addLog({ productId: p.id, amount, unit:p.basis, date: S.date, meal: X.meal });
    if (!S.caps.meals && r.id) { S.mealTags[r.id] = X.meal; save('meals', S.mealTags); }
    S.sheet = null; S.pendingMeal = null; S.search.lists.recents.loaded = false;
    toast(`${p.name} eklendi`);
    if (S.route === 'today') loadDay(); else location.hash = '#today';
  } catch (e) { X.error = guard(e); X.saving = false; render(); }
}
async function submitManual(form) {
  const X = S.sheet;
  const values = Object.fromEntries(['name', 'kcal', 'protein', 'carbs', 'fat'].map(k => [k, form[k].value]));
  X.values = values;
  const per100 = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map(k => [k, Core.toNum(values[k])]));
  if (Object.values(per100).some(v => v === null)) { X.error = Object.assign(Error('Dört değeri de sıfır veya pozitif sayı olarak gir'), { status: 400 }); render(); return; }
  if (per100.kcal > 1000 || ['protein', 'carbs', 'fat'].some(k => per100[k] > 100)) { X.error = Object.assign(Error('100 g için enerji en fazla 1000 kcal, makrolar en fazla 100 g olabilir'), { status: 400 }); render(); return; }
  X.saving = true; X.error = null; render();
  try { const p = reg(await API.createFood({ name: values.name, per100 })); S.search.lists.recents.loaded = false; S.sheet = null; openProduct(p); }
  catch (e) { X.error = guard(e); X.saving = false; render(); }
}

/* ---------- Barcode camera ---------- */
const cam = { stream: null, timer: 0, detector: null, busy: false };
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
function attachVideo() {
  const v = root.querySelector('#scan-video');
  if (v && cam.stream && v.srcObject !== cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); }
}
async function startCamera() {
  const C = S.scan; C.error = null;
  const failWith = name => { C.error = Core.cameraErrorText({ name }); C.starting = false; render(); };
  if (!window.isSecureContext) return failWith('InsecureContext');
  if (!navigator.mediaDevices?.getUserMedia) return failWith('NoMediaDevices');
  if (!('BarcodeDetector' in window)) return failWith('NoBarcodeDetector');
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter(f => supported.includes(f));
    if (!formats.length) return failWith('NoBarcodeDetector');
    cam.detector = new window.BarcodeDetector({ formats });
  } catch { return failWith('NoBarcodeDetector'); }
  C.starting = true; render();
  try { cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
  catch (e) { cam.stream = null; C.error = Core.cameraErrorText(e); C.starting = false; render(); return; }
  if (S.route !== 'scan') { stopCamera(); return; }
  C.starting = false; C.active = true; C.torchOn = false;
  try { C.torch = !!cam.stream.getVideoTracks()[0]?.getCapabilities?.().torch; } catch { C.torch = false; }
  render();
  cam.timer = setInterval(detect, 300);
}
async function detect() {
  const v = root.querySelector('#scan-video');
  if (cam.busy || !v || v.readyState < 2 || !cam.detector) return;
  cam.busy = true;
  try {
    const codes = await cam.detector.detect(v);
    const hit = codes.map(c => Core.checkBarcode(c.rawValue)).find(c => c.status !== 'format');
    if (hit) { navigator.vibrate?.(60); stopCamera(); S.scan.manual = hit.code; lookupBarcode(hit.code); }
  } catch { /* frame not ready */ }
  cam.busy = false;
}
function stopCamera() {
  clearInterval(cam.timer); cam.timer = 0;
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; S.scan.active = false; S.scan.starting = false; S.scan.torchOn = false;
}
async function toggleTorch() {
  const track = cam.stream?.getVideoTracks()[0]; if (!track) return;
  try { await track.applyConstraints({ advanced: [{ torch: !S.scan.torchOn }] }); S.scan.torchOn = !S.scan.torchOn; } catch { S.scan.torch = false; }
  render();
}
async function lookupBarcode(code) {
  const C = S.scan; C.lastCode = code; C.lookup = { loading: true, error: null }; render();
  try { const p = reg(await API.barcode(code)); C.lookup = { loading: false, error: null }; S.search.lists.recents.loaded = false; render(); openProduct(p); }
  catch (e) { C.lookup = { loading: false, error: guard(e) }; render(); }
}

/* ---------- Trends navigation ---------- */
function shiftAnchor(dir) {
  const T = S.trends;
  let next;
  if (T.period === 'daily') next = Core.addDays(T.anchor, dir);
  else if (T.period === 'weekly') next = Core.addDays(T.anchor, 7 * dir);
  else { const d = Core.parseDate(T.anchor); next = Core.localDate(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
  T.anchor = next > S.today ? S.today : next; T.data = null; loadTrends();
}

/* ---------- Events ---------- */
const actions = {
  skip: () => root.querySelector('#main')?.focus(),
  boot: () => boot(),
  'reload-day': loadDay,
  'day-prev': () => { S.date = Core.addDays(S.date, -1); S.day.data = null; loadDay(); },
  'day-next': () => { const n = Core.addDays(S.date, 1); if (n <= S.today) { S.date = n; S.day.data = null; loadDay(); } },
  'go-search': () => { location.hash = '#search'; },
  'add-to-meal': el => { S.pendingMeal = el.dataset.meal; location.hash = '#search'; setTimeout(() => root.querySelector('#q')?.focus(), 0); },
  'delete-log': async el => {
    const id = Number(el.dataset.id);
    const log = S.day.data?.logs.find(l => l.id === id);
    if (!window.confirm(`${log ? log.name : 'Bu kayıt'} silinsin mi?`)) return;
    try { await API.deleteLog(id); delete S.mealTags[id]; save('meals', S.mealTags); toast('Kayıt silindi'); loadDay(); }
    catch (e) { guard(e); toast(Core.errorText(e)); }
  },
  'retry-search': () => runSearch(S.search.lastQuery || S.search.q),
  'search-tab': el => { S.search.tab = el.dataset.tab; if (S.route !== 'search') location.hash = '#search'; if (S.search.tab !== 'results' && !S.search.lists[S.search.tab].loaded) loadList(S.search.tab); else render(); root.querySelector(`[data-tab="${el.dataset.tab}"]`)?.focus(); },
  'reload-list': () => loadList(S.search.tab),
  'open-product': el => openProduct(registry.get(el.dataset.key)),
  'manual-food': () => openManual(),
  'manual-food-barcode': () => openManual(S.scan.lastCode),
  'close-sheet': closeSheet,
  'set-amount': el => { if (S.sheet) { S.sheet.amount = el.dataset.amount; render(); } },
  'toggle-fav': async () => {
    const X = S.sheet; if (!X?.product) return;
    try { if(!X.product.id)X.product=reg(await API.select(X.product.sourceId));const r = await API.toggleFavorite(X.product.id); X.favorite = !!r.favorite; S.search.lists.favorites.loaded = false; render(); if (S.search.tab === 'favorites') loadList('favorites'); }
    catch (e) { guard(e); X.error = e; render(); }
  },
  'recipe-start': () => { Object.assign(S.recipe, { active: true, name: '', items: [], cooked: '', error: '' }); render(); },
  'recipe-cancel': () => { Object.assign(S.recipe, { active: false, items: [], error: '' }); render(); },
  'recipe-add': () => {
    const X = S.sheet; const amount = Core.validAmount(root.querySelector('#amount')?.value ?? X.amount);
    if (amount === null) return;
    S.recipe.items.push({ product: X.product, amount }); S.sheet = null; S.search.tab = 'recipes';
    toast(`${X.product.name} tarife eklendi`);
    if (S.route !== 'search') location.hash = '#search';
  },
  'recipe-remove': el => { S.recipe.items.splice(Number(el.dataset.idx), 1); render(); },
  'scan-start': startCamera,
  'scan-stop': () => { stopCamera(); render(); },
  'scan-torch': toggleTorch,
  'scan-retry': () => S.scan.lastCode && lookupBarcode(S.scan.lastCode),
  period: el => { S.trends.period = el.dataset.period; S.trends.data = null; loadTrends(); },
  'trend-prev': () => shiftAnchor(-1),
  'trend-next': () => shiftAnchor(1),
  'reload-trends': loadTrends,
  'goal-clear': async () => {try{await persistGoals(null);toast('Hedef kaldırıldı')}catch(e){guard(e);toast(Core.errorText(e))}},
  'use-estimate': async () => { const t = Core.toNum(S.body.estimate.data?.target_kcal); const g = Core.normalizeGoals({ kcal: t }); if (g) { try{await persistGoals(g);toast('Hedef güncellendi')}catch(e){guard(e);toast(Core.errorText(e))} } },
  'reload-measurements': loadMeasurements
};
const forms = {
  search: f => runSearch(f.q.value),
  log: submitLog,
  manual: submitManual,
  barcode: f => {
    const c = Core.checkBarcode(f.code.value);
    S.scan.manual = f.code.value; S.scan.check = c.status === 'ok' ? '' : c.status;
    if (c.status === 'format') { render(); return; }
    lookupBarcode(c.code);
  },
  recipe: async f => {
    const R = S.recipe; R.name = f.name.value.trim(); R.cooked = f.cooked.value;
    let calc;
    try { calc = Core.recipePer100(R.items, R.cooked); } catch (e) { R.error = e.message; render(); return; }
    if (R.name.length < 2) { R.error = 'Tarif adı en az 2 karakter olmalı'; render(); return; }
    R.saving = true; R.error = ''; render();
    try { await API.saveRecipe({ name: R.name, per100: calc.per100,items:R.items,yieldGrams:calc.weight,portions:1 }); Object.assign(R, { active: false, items: [], name: '', cooked: '', saving: false }); toast('Tarif kaydedildi'); loadList('recipes'); }
    catch (e) { guard(e); R.error = Core.errorText(e); R.saving = false; render(); }
  },
  goals: async f => {
    const g = Core.normalizeGoals({ kcal: f.kcal.value, protein: f.protein.value, carbs: f.carbs.value, fat: f.fat.value });
    if (!g) { S.body.goalError = 'Kalori hedefi 800–6000 kcal arasında olmalı.'; render(); return; }
    try{await persistGoals(g);S.body.goalError='';toast('Hedef kaydedildi')}catch(e){guard(e);S.body.goalError=Core.errorText(e);render()}
  },
  estimate: async f => {
    const B = S.body;
    B.form = Object.fromEntries(['age', 'sex', 'height_cm', 'weight_kg', 'activity', 'goal'].map(k => [k, f[k].value]));
    const body = { ...B.form, age: Number(B.form.age), height_cm: Core.toNum(B.form.height_cm), weight_kg: Core.toNum(B.form.weight_kg) };
    B.estimate = { loading: true, error: null, data: null }; render();
    try { B.estimate.data = await API.estimate(body); } catch (e) { B.estimate.error = guard(e); }
    B.estimate.loading = false; render();
  },
  measurement: async f => {
    try { await API.addMeasurement({ date: S.today, weight_kg: f.weight_kg.value, waist_cm: f.waist_cm.value, body_fat: f.body_fat.value }); toast('Ölçüm eklendi'); loadMeasurements(); }
    catch (e) { guard(e); toast(Core.errorText(e)); }
  }
};

root.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !root.contains(el) || el.disabled) return;
  e.preventDefault();
  Promise.resolve(actions[el.dataset.act]?.(el)).catch(() => {});
});
root.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  Promise.resolve(forms[f.dataset.form]?.(f)).catch(() => {});
});
root.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') S.search.q = t.value;
  else if (t.id === 'amount' && S.sheet) { S.sheet.amount = t.value; render(); }
  else if (t.closest('[data-form="recipe"]')) { if (t.name === 'name') S.recipe.name = t.value; if (t.name === 'cooked') { S.recipe.cooked = t.value; render(); } }
  else if (t.closest('[data-form="barcode"]')) { S.scan.manual = t.value; S.scan.check = ''; }
  else if (t.closest('[data-form="manual"]') && S.sheet) S.sheet.values[t.name] = t.value;
});
root.addEventListener('change', e => { if (e.target.name === 'meal' && S.sheet) S.sheet.meal = e.target.value; });
root.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) { e.preventDefault(); closeSheet(); return; }
  // Keep keyboard focus inside the open dialog.
  if (e.key === 'Tab' && S.sheet) {
    const items = [...root.querySelectorAll('.sheet button:not([disabled]), .sheet input, .sheet select, .sheet a[href]')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // Arrow keys move between tabs in a tablist.
  const tab = e.target.closest('[role="tab"]');
  if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    e.preventDefault(); next.click();
  }
});
window.addEventListener('hashchange', () => {
  const r = location.hash.slice(1);
  if (ROUTES.includes(r) && S.session === 'ok' && S.boot === 'ready') enterRoute(r, { focus: true });
});
window.addEventListener('online', () => { S.online = true; if (S.boot === 'error') boot(); else if (S.boot === 'ready') enterRoute(S.route); });
window.addEventListener('offline', () => { S.online = false; render(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && cam.stream) { stopCamera(); render(); } });
window.addEventListener('pagehide', stopCamera);

async function boot() {
  S.boot = 'loading'; render();
  try { S.user = await API.me(); }
  catch (e) {
    if (Core.errorKind(e) === 'session') { S.session = 'expired'; render(); return; }
    S.boot = 'error'; S.bootError = e; render(); return;
  }
  try{S.goals=Core.normalizeGoals(!S.preview&&S.caps.serverGoals?await API.goals():load('goals'))||null}catch(e){guard(e);S.boot='error';S.bootError=e;render();return}
  S.mealTags = load('meals') || {};
  S.boot = 'ready';
  if (S.caps.favorites) loadList('favorites');
  enterRoute(S.route);
}
boot();
})();
