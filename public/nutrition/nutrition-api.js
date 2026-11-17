/* Nutrition+ adapter: the default live contract is /api/nutrition-plus.
   contract:'v8' preserves the legacy client. Local preview is opt-in, labelled,
   in-memory sample data and never used as a live provider fallback. */
(function (global) {
'use strict';
const Core = typeof module === 'object' && module.exports ? require('./nutrition-core.js') : global.NutritionCore;

// When the Nutrition+ backend contract is final, change these paths and the mappers below only.
const ENDPOINTS = Object.freeze({
  me: '/api/me',
  search: '/api/v8/foods/search',
  select: '/api/v8/foods/select',
  foods: '/api/v8/foods',
  logs: '/api/v8/food-logs',
  history: '/api/v8/nutrition/history',
  estimate: '/api/v8/nutrition/estimate',
  bmi: '/api/v8/nutrition/bmi'
});
// Prefix that marks a manual V8 product as one of the user's recipes.
const RECIPE_PREFIX = 'Tarif · ';
const LIVE_CAPS = Object.freeze({
  search: true, barcode: true, manualFood: true, logs: true, history: true, estimate: true, recents: true,
  recipes: true,        // stored as a manual product with per-100 g values; ingredients are not stored
  meals: false,         // V8 logs have no meal field
  favorites: false, measurements: false, serverGoals: false, volume: false
});
const PREVIEW_CAPS = Object.freeze({ ...LIVE_CAPS, meals: true, favorites: true, measurements: true, serverGoals: true, volume: true });

const fail = (status, message, extra) => { throw Object.assign(Error(message), { status }, extra || {}); };
const unsupported = feature => fail(501, 'Bu özellik sunucuda henüz etkin değil', { kind: 'unsupported', feature });
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

// Preview data is opt-in and can never be activated on a deployed host or in the native app.
function resolveMode(loc, config) {
  const q = new URLSearchParams(loc?.search || '');
  if (q.get('preview') !== 'mock') return 'live';
  if (config?.native) return 'live';
  return LOCAL_HOSTS.includes(String(loc?.hostname || '')) ? 'preview' : 'live';
}

function mapLog(l) {
  const product = Core.normalizeProduct({ ...l, id: l.product_id ?? l.productId });
  const n = l.nutrients || {};
  const nutrients = Object.fromEntries(Core.KEYS.map(k => [k, Core.toNum(n[k])]));
  return {
    id: Number(l.id),
    productId: Number(l.product_id ?? l.productId),
    name: String(l.name || product?.name || 'Ürün'),
    amount: Core.toNum(l.grams ?? l.amount),
    unit: l.unit === 'ml' ? 'ml' : 'g',
    date: String(l.consumed_on || l.date || ''),
    meal: Core.MEAL_IDS.includes(l.meal) ? l.meal : null,
    nutrients,
    source: Core.sourceInfo(l),
    product
  };
}
function mapHistory(h) {
  if (!h || !Array.isArray(h.daily)) fail(502, 'Sunucu geçersiz beslenme geçmişi yanıtı verdi', { kind: 'server' });
  return {
    period: h.period, start: h.start, end: h.end, days: h.days,
    daily: h.daily.map(d => ({ date: d.date, kcal: Core.toNum(d.kcal) || 0, protein: Core.toNum(d.protein) || 0, carbs: Core.toNum(d.carbs) || 0, fat: Core.toNum(d.fat) || 0 })),
    totals: Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map(k => [k, Core.toNum(h.totals?.[k]) || 0])),
    logs: (h.logs || []).map(mapLog)
  };
}
const isRecipe = p => p?.source?.kind === 'manual' && p.name.startsWith(RECIPE_PREFIX);

function createLiveApi({ fetchImpl, base = '', online = () => true } = {}) {
  const root = String(base || '').replace(/\/+$/, '');
  async function call(path, options = {}) {
    const init = { credentials: root ? 'include' : 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, method: options.method || 'GET' };
    // The server's CSRF guard requires a JSON content type on every non-GET request, DELETE included.
    if (init.method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body || {}); }
    let response;
    try { response = await fetchImpl(root + path, init); }
    catch { fail(0, online() ? 'Sunucuya bağlanılamadı' : 'Çevrimdışısın', { offline: true }); }
    let json = null;
    try { json = await response.json(); } catch { if (response.ok) fail(response.status || 502, 'Sunucu yanıtı okunamadı', { kind: 'server' }); }
    if (!response.ok) fail(response.status, json?.error || 'Sunucu hatası (' + response.status + ')');
    return json;
  }
  const product = raw => { const p = Core.normalizeProduct(raw); if (!p) fail(502, 'Sunucu geçersiz ürün yanıtı verdi', { kind: 'server' }); return p; };
  return {
    mode: 'live', preview: false, caps: LIVE_CAPS, endpoints: ENDPOINTS,
    async me() {
      const r = await call(ENDPOINTS.me);
      if (!r?.user) fail(401, 'Oturum bulunamadı');
      return { id: r.user.id, role: r.user.role, name: String(r.user.name || r.user.username || '') };
    },
    async search(q) {
      const query = String(q || '').trim();
      if (query.length < 2 || query.length > 100) fail(400, 'Arama 2-100 karakter olmalı');
      const r = await call(ENDPOINTS.search + '?q=' + encodeURIComponent(query));
      return { products: (r?.products || []).map(Core.normalizeProduct).filter(Boolean), attribution: String(r?.attribution || '') };
    },
    // V8 has no read-only barcode lookup: selecting by code fetches the product from the source and
    // stores a copy in the user's own product list (needed anyway before it can be logged).
    async barcode(code) {
      const c = Core.checkBarcode(code);
      if (c.status === 'format') fail(400, 'Barkod 8, 12, 13 veya 14 haneli olmalı');
      try { return product(await call(ENDPOINTS.select, { method: 'POST', body: { source_id: c.code } })); }
      catch (e) { if (e.status === 422) e.kind = 'notFoundBarcode'; throw e; }
    },
    async select(sourceId) { return product(await call(ENDPOINTS.select, { method: 'POST', body: { source_id: String(sourceId) } })); },
    async createFood({ name, per100, basis = 'g' }) {
      if (basis !== 'g') fail(400, 'Sunucu şu an yalnızca 100 g bazlı ürünleri kabul ediyor');
      const body = { name: String(name || '').trim() };
      for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
        const v = Core.toNum(per100?.[k]);
        if (v === null) fail(400, 'Enerji, protein, karbonhidrat ve yağ değerleri zorunlu');
        body[k + '_100g'] = v;
      }
      return product(await call(ENDPOINTS.foods, { method: 'POST', body }));
    },
    async foods() { return ((await call(ENDPOINTS.foods)) || []).map(Core.normalizeProduct).filter(Boolean); },
    async recents(limit = 12) { return (await this.foods()).filter(p => !isRecipe(p)).slice(0, limit); },
    async recipes() { return (await this.foods()).filter(isRecipe); },
    async saveRecipe({ name, per100 }) { return this.createFood({ name: RECIPE_PREFIX + String(name || '').trim(), per100 }); },
    async addLog({ productId, amount, date, meal }) {
      const grams = Core.validAmount(amount);
      if (grams === null) fail(400, 'Miktar 0’dan büyük ve en fazla ' + Core.MAX_AMOUNT + ' olmalı');
      // meal is sent for forward compatibility; V8 ignores unknown fields.
      const r = await call(ENDPOINTS.logs, { method: 'POST', body: { product_id: productId, grams, consumed_on: date, meal } });
      return { id: Number(r?.id) };
    },
    async deleteLog(id) { await call(ENDPOINTS.logs + '/' + encodeURIComponent(id), { method: 'DELETE' }); return { ok: true }; },
    async history(period, date) { return mapHistory(await call(ENDPOINTS.history + '?period=' + encodeURIComponent(period) + '&date=' + encodeURIComponent(date))); },
    async estimate(body) { return call(ENDPOINTS.estimate, { method: 'POST', body }); },
    async favorites() { unsupported('favorites'); },
    async toggleFavorite() { unsupported('favorites'); },
    async measurements() { unsupported('measurements'); },
    async addMeasurement() { unsupported('measurements'); }
  };
}

// Nutrition+ contract: all personal operations remain bound to the session identity.
const PLUS_ENDPOINTS=Object.freeze({me:'/api/me',search:'/api/nutrition-plus/search',barcode:'/api/nutrition-plus/barcode',select:'/api/nutrition-plus/select',foods:'/api/nutrition-plus/foods',logs:'/api/nutrition-plus/logs',history:'/api/nutrition-plus/history',recipes:'/api/nutrition-plus/recipes',goals:'/api/nutrition-plus/goals',estimate:'/api/v8/nutrition/estimate'});
const PLUS_CAPS=Object.freeze({...LIVE_CAPS,meals:true,favorites:true,serverGoals:true,volume:true});
function createPlusApi({fetchImpl,base='',online=()=>true}={}){
 const root=String(base).replace(/\/+$/,'');
 async function call(path,method='GET',body){
  const init={method,credentials:root?'include':'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
  if(method!=='GET'){init.headers['Content-Type']='application/json';init.body=JSON.stringify(body||{});}
  let r;try{r=await fetchImpl(root+path,init)}catch{fail(0,online()?'Sunucuya bağlanılamadı':'Çevrimdışısın',{offline:true})}
  let data;try{data=await r.json()}catch{fail(502,'Sunucu yanıtı okunamadı',{kind:'server'})}
  if(!r.ok)fail(r.status,data?.error||'İşlem başarısız');return data;
 }
 const product=p=>Core.normalizeProduct({...p,per_100:p.nutrients,basis:p.basis==='100ml'?'ml':p.basis==='unsupported'?'unsupported':'g',servings:(p.serving_ml||p.serving_grams)?[{label:p.serving_label||'1 porsiyon',amount:p.serving_ml||p.serving_grams}]:[]});
 const list=async filter=>(await call(PLUS_ENDPOINTS.foods+'?filter='+filter)).map(product).filter(Boolean);
 return {
  mode:'live',preview:false,caps:PLUS_CAPS,endpoints:PLUS_ENDPOINTS,
  async me(){const r=await call(PLUS_ENDPOINTS.me);if(!r?.user)fail(401,'Oturum bulunamadı');return {id:r.user.id,role:r.user.role,name:r.user.username};},
  async search(q){q=String(q||'').trim();if(q.length<2||q.length>100)fail(400,'Arama 2–100 karakter olmalı');const r=await call(PLUS_ENDPOINTS.search+'?q='+encodeURIComponent(q));return {products:(r.products||[]).map(p=>product({...p,source:'Open Food Facts'})).filter(Boolean),attribution:r.attribution};},
  async barcode(code){const c=Core.checkBarcode(code);if(c.status==='format')fail(400,'Barkod biçimi geçersiz');try{return product(await call(PLUS_ENDPOINTS.barcode+'?code='+encodeURIComponent(c.code)))}catch(e){if([404,422].includes(e.status))e.kind='notFoundBarcode';throw e}},
  async select(code){return product(await call(PLUS_ENDPOINTS.select,'POST',{code:String(code)}));},
  async createFood({name,per100,basis='g'}){return product(await call(PLUS_ENDPOINTS.foods,'POST',{name,basis,nutrients:per100}));},
  async foods(){return list('all')},async recents(){return list('recent')},async recipes(){return list('recipes')},async favorites(){return list('favorites')},
  async toggleFavorite(id){const rows=await call(PLUS_ENDPOINTS.foods);const row=rows.find(p=>p.id===Number(id));if(!row)fail(404,'Besin bulunamadı');const favorite=!row.favorite;await call(PLUS_ENDPOINTS.foods+'/'+id+'/favorite','PATCH',{favorite});return {favorite};},
  async saveRecipe({name,items,yieldGrams,portions=1}){
   const ingredients=[];for(const i of items||[]){const p=i.product.id?i.product:await this.select(i.product.sourceId);ingredients.push({food_id:p.id,amount:i.amount,unit:p.basis});}
   return product(await call(PLUS_ENDPOINTS.recipes,'POST',{name,ingredients,yield_grams:yieldGrams,portions}));
  },
  async addLog({productId,amount,unit='g',date,meal}){const value=Core.validAmount(amount);if(value===null)fail(400,'Geçersiz miktar');return call(PLUS_ENDPOINTS.logs,'POST',{food_id:productId,amount:value,unit,day:date,meal});},
  async deleteLog(id){return call(PLUS_ENDPOINTS.logs+'/'+encodeURIComponent(id),'DELETE')},
  async history(period,date){
   const h=await call(PLUS_ENDPOINTS.history+'?period='+encodeURIComponent(period)+'&date='+encodeURIComponent(date));if(!Array.isArray(h?.daily))fail(502,'Geçersiz geçmiş yanıtı',{kind:'server'});
   const mapBucket=b=>Object.fromEntries(Core.KEYS.map(k=>[k,Core.toNum(b?.known?.[k])]));
   return {period:h.period,days:h.days,start:h.daily[0]?.date,end:h.daily.at(-1)?.date,totals:mapBucket(h.totals),missing:h.totals.missing,partial:Object.values(h.totals.missing).some(n=>n>0),daily:h.daily.map(d=>({date:d.date,...mapBucket(d),missing:d.missing})),logs:h.logs.map(l=>({id:l.id,productId:l.food_id,name:l.name,amount:l.amount??l.grams,unit:l.unit||'g',date:l.day,meal:l.meal,nutrients:l.nutrients,source:Core.sourceInfo(l)}))};
  },
  async goals(){return (await call(PLUS_ENDPOINTS.goals)).goals},
  async saveGoals(goals){return goals?(await call(PLUS_ENDPOINTS.goals,'PATCH',goals)).goals:(await call(PLUS_ENDPOINTS.goals,'DELETE'),null)},
  async estimate(body){return call(PLUS_ENDPOINTS.estimate,'POST',body)},
  async measurements(){unsupported('measurements')},async addMeasurement(){unsupported('measurements')}
 };
}

/* ---------- Preview (sample data, local development only) ---------- */
const SAMPLE = [
  { source_id: '8690000000017', name: 'Yulaf ezmesi', brand: 'Örnek Marka', kcal_100g: 372, protein_100g: 13.5, carbs_100g: 58.7, fat_100g: 7, sugar_100g: 1.1, fiber_100g: 10, salt_100g: 0.01, servings: [{ label: '1 kase', amount: 40 }] },
  { source_id: '8690000000024', name: 'Yarım yağlı süt', brand: 'Örnek Süt', basis: 'ml', kcal_100g: 46, protein_100g: 3.2, carbs_100g: 4.7, fat_100g: 1.5, sugar_100g: 4.7, salt_100g: 0.1, servings: [{ label: '1 bardak', amount: 200 }] },
  { source_id: '8690000000031', name: 'Tavuk göğsü, ızgara', brand: '', kcal_100g: 165, protein_100g: 31, carbs_100g: 0, fat_100g: 3.6 },
  { source_id: '8690000000048', name: 'Bitter çikolata %70', brand: 'Örnek Kakao', kcal_100g: 579, protein_100g: 7.8, carbs_100g: null, fat_100g: 42, sugar_100g: 28, servings: [{ label: '1 kare', amount: 10 }] },
  { source_id: '8690000000055', name: 'Süzme yoğurt', brand: 'Örnek Süt', kcal_100g: 97, protein_100g: 9, carbs_100g: 3.9, fat_100g: 5 },
  { source_id: '8690000000062', name: 'Muz', brand: '', kcal_100g: 89, protein_100g: 1.1, carbs_100g: 22.8, fat_100g: 0.3, fiber_100g: 2.6, servings: [{ label: '1 orta boy', amount: 120 }] }
].map(p => ({ ...p, source: 'preview', preview: true }));

function createPreviewApi({ delay = 250, today = Core.localDate() } = {}) {
  let seq = 100;
  const products = SAMPLE.map((p, i) => ({ ...p, id: i + 1 }));
  const favorites = new Set([1, 5]);
  const measurements = [{ id: 1, date: Core.addDays(today, -14), weight_kg: 78.4, waist_cm: 86 }, { id: 2, date: Core.addDays(today, -7), weight_kg: 77.9, waist_cm: 85 }];
  const logs = [
    { id: 1, product_id: 1, amount: 40, date: today, meal: 'breakfast' },
    { id: 2, product_id: 2, amount: 200, date: today, meal: 'breakfast' },
    { id: 3, product_id: 3, amount: 150, date: today, meal: 'lunch' },
    { id: 4, product_id: 4, amount: 20, date: today, meal: 'snack' }
  ];
  for (let d = 1; d <= 20; d++) logs.push({ id: 10 + d, product_id: 1 + (d % 6), amount: 120 + (d * 37) % 260, date: Core.addDays(today, -d), meal: Core.MEAL_IDS[d % 4] });
  const wait = () => new Promise(r => setTimeout(r, delay));
  const find = id => products.find(p => p.id === Number(id));
  const norm = raw => Core.normalizeProduct(raw);
  const logView = l => {
    const p = norm(find(l.product_id));
    return mapLog({ id: l.id, product_id: l.product_id, amount: l.amount, unit: p.basis, date: l.date, meal: l.meal, name: p.name, source: 'preview', preview: true, nutrients: Core.portion(p, l.amount), ...Object.fromEntries(Core.KEYS.map(k => [k + '_100g', p.per100[k]])) });
  };
  return {
    mode: 'preview', preview: true, caps: PREVIEW_CAPS, endpoints: ENDPOINTS,
    async me() { await wait(); return { id: 0, role: 'member', name: 'Önizleme' }; },
    async search(q) {
      await wait();
      const s = String(q || '').trim().toLocaleLowerCase('tr-TR');
      if (s.length < 2) fail(400, 'Arama 2-100 karakter olmalı');
      if (s === 'hata') fail(502, 'Önizleme: kaynak hatası');
      if (s === 'oturum') fail(401, 'Önizleme: oturum süresi doldu');
      const hits = products.filter(p => (p.name + ' ' + p.brand + ' ' + p.source_id).toLocaleLowerCase('tr-TR').includes(s));
      return { products: hits.map(norm), attribution: 'Örnek veri (önizleme)' };
    },
    async barcode(code) {
      await wait();
      const c = Core.checkBarcode(code);
      if (c.status === 'format') fail(400, 'Barkod 8, 12, 13 veya 14 haneli olmalı');
      const p = products.find(x => x.source_id === c.code);
      if (!p) fail(404, 'Önizleme: ürün bulunamadı', { kind: 'notFoundBarcode' });
      return norm(p);
    },
    async select(sourceId) { await wait(); const p = products.find(x => x.source_id === String(sourceId)); if (!p) fail(404, 'Ürün bulunamadı'); return norm(p); },
    async createFood({ name, per100, basis = 'g' }) {
      await wait();
      const raw = { id: ++seq, name: String(name).trim(), basis, source: 'preview', preview: true, ...Object.fromEntries(Core.KEYS.map(k => [k + '_100g', Core.toNum(per100?.[k])])) };
      products.unshift(raw); return norm(raw);
    },
    async foods() { await wait(); return products.map(norm); },
    async recents(limit = 12) {
      await wait();
      const ids = [...new Set([...logs].sort((a, b) => b.id - a.id).map(l => l.product_id))].slice(0, limit);
      return ids.map(id => norm(find(id))).filter(p => p && !p.name.startsWith(RECIPE_PREFIX));
    },
    async recipes() { await wait(); return products.filter(p => p.name.startsWith(RECIPE_PREFIX)).map(norm); },
    async saveRecipe({ name, per100 }) { return this.createFood({ name: RECIPE_PREFIX + String(name || '').trim(), per100 }); },
    async addLog({ productId, amount, date, meal }) {
      await wait();
      if (!find(productId)) fail(404, 'Ürün bulunamadı');
      if (Core.validAmount(amount) === null) fail(400, 'Geçersiz miktar');
      const l = { id: ++seq, product_id: Number(productId), amount: Core.validAmount(amount), date, meal: Core.MEAL_IDS.includes(meal) ? meal : 'snack' };
      logs.push(l); return { id: l.id };
    },
    async deleteLog(id) { await wait(); const i = logs.findIndex(l => l.id === Number(id)); if (i < 0) fail(404, 'Kayıt bulunamadı'); logs.splice(i, 1); return { ok: true }; },
    async history(period, date) {
      await wait();
      let start = date, days = 1;
      if (period === 'weekly') { start = Core.weekStart(date); days = 7; }
      else if (period === 'monthly') { const d = Core.parseDate(date); start = date.slice(0, 8) + '01'; days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
      const dates = Array.from({ length: days }, (_, i) => Core.addDays(start, i));
      const list = logs.filter(l => dates.includes(l.date)).map(logView);
      const daily = dates.map(dt => { const s = Core.sumNutrients(list.filter(l => l.date === dt).map(l => l.nutrients)).totals; return { date: dt, kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat }; });
      const t = Core.sumNutrients(list.map(l => l.nutrients)).totals;
      return { period, start, end: dates.at(-1), days, daily, totals: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat }, logs: list };
    },
    async estimate(b) {
      await wait();
      const f = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 }[b.activity] || 1.2;
      const bmr = 10 * b.weight_kg + 6.25 * b.height_cm - 5 * b.age + (b.sex === 'male' ? 5 : -161);
      const m = bmr * f;
      return { bmi: Core.bmi(b.height_cm, b.weight_kg), bmr: Core.round(bmr, 0), maintenance_kcal: Core.round(m, 0), target_kcal: Core.round(m + ({ lose: -300, gain: 300 }[b.goal] || 0), 0), formula: 'Mifflin-St Jeor', estimated: true };
    },
    async favorites() { await wait(); return [...favorites].map(id => norm(find(id))).filter(Boolean); },
    async toggleFavorite(productId) { await wait(); const id = Number(productId); if (favorites.has(id)) favorites.delete(id); else favorites.add(id); return { favorite: favorites.has(id) }; },
    async measurements() { await wait(); return [...measurements].sort((a, b) => b.date.localeCompare(a.date)); },
    async addMeasurement(m) { await wait(); const row = { id: ++seq, date: m.date, weight_kg: Core.toNum(m.weight_kg), waist_cm: Core.toNum(m.waist_cm), body_fat: Core.toNum(m.body_fat) }; measurements.push(row); return row; }
  };
}

function createNutritionApi({ mode = 'live', contract='nutrition-plus', fetchImpl, base, online, delay, today } = {}) {
  return mode === 'preview' ? createPreviewApi({ delay, today }) : (contract==='v8'?createLiveApi:createPlusApi)({ fetchImpl, base, online });
}

const exported = { ENDPOINTS:PLUS_ENDPOINTS, V8_ENDPOINTS:ENDPOINTS, LIVE_CAPS:PLUS_CAPS, V8_CAPS:LIVE_CAPS, PREVIEW_CAPS, PLUS_ENDPOINTS, PLUS_CAPS, RECIPE_PREFIX, resolveMode, createNutritionApi, mapHistory, mapLog };
if (typeof module === 'object' && module.exports) module.exports = exported;
else global.NutritionApi = Object.freeze(exported);
})(typeof globalThis !== 'undefined' ? globalThis : this);
