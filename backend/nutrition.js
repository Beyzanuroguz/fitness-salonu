const providerFields = 'code,product_name,nutrition_data_per,product_quantity_unit,serving_quantity_unit,nutriments';
const fields = ['kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g'];
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
function number(value, min, max) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') fail('Sayısal değer gerekli');
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail('Sayısal değer aralık dışında');
  return n;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Geçersiz tarih');
  return value;
}
const round = n => Math.round(n * 100) / 100;
function normalize(p) {
  const n = p.nutriments || {};
  // Reject explicitly volume-based products; no density conversion is assumed.
  if (!/^\d{8,14}$/.test(String(p.code)) || !p.product_name || p.nutrition_data_per !== '100g' || ['ml', 'cl', 'l'].includes(p.product_quantity_unit) || ['ml', 'cl', 'l'].includes(p.serving_quantity_unit)) return null;
  try {
    const values = [n['energy-kcal_100g'], n.proteins_100g, n.carbohydrates_100g, n.fat_100g];
    return { name: String(p.product_name).slice(0, 200), ...Object.fromEntries(fields.map((k, i) => [k, number(values[i], 0, i ? 100 : 1000)])), source: 'Open Food Facts', source_id: String(p.code), source_url: `https://world.openfoodfacts.org/product/${p.code}`, source_license: 'ODbL-1.0', retrieved_at: new Date().toISOString() };
  } catch { return null; }
}
module.exports = function createNutrition(db, fetcher = fetch) {
  db.exec(`CREATE TABLE IF NOT EXISTS v8_foods (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
    kcal_100g REAL NOT NULL, protein_100g REAL NOT NULL, carbs_100g REAL NOT NULL, fat_100g REAL NOT NULL,
    source TEXT NOT NULL, source_id TEXT, source_url TEXT, source_license TEXT, retrieved_at TEXT);
    CREATE TABLE IF NOT EXISTS v8_food_logs (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), product_id INTEGER NOT NULL REFERENCES v8_foods(id),
    grams REAL NOT NULL CHECK(grams>0), consumed_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS v8_logs_user_date ON v8_food_logs(user_id, consumed_on);`);
  const cache = new Map();
  async function remote(url) {
    try {
      const response = await fetcher(url, { headers: { 'User-Agent': 'FORM-CLUB/8.0 (nutrition integration; https://world.openfoodfacts.org)' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) fail(`Besin kaynağına erişilemiyor (HTTP ${response.status || 'hatası'}). Lütfen daha sonra deneyin veya manuel ürün ekleyin.`, 502);
      const data = await response.json();
      if (!data || typeof data !== 'object') fail('Besin kaynağı geçersiz yanıt verdi. Lütfen daha sonra deneyin.', 502);
      return data;
    } catch (e) {
      if (e.status) throw e;
      if (['TimeoutError', 'AbortError'].includes(e.name)) fail('Besin kaynağı zaman aşımına uğradı. Lütfen daha sonra deneyin veya manuel ürün ekleyin.', 502);
      if (e instanceof SyntaxError) fail('Besin kaynağı geçersiz JSON yanıtı verdi. Lütfen daha sonra deneyin.', 502);
      fail('Besin kaynağına ağ bağlantısı kurulamadı. Lütfen daha sonra deneyin veya manuel ürün ekleyin.', 502);
    }
  }
  async function lookup(code) {
    const data = await remote(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${providerFields}`);
    return normalize(data.product || {});
  }
  const save = (u, p) => {
    const r = db.prepare(`INSERT INTO v8_foods(user_id,name,${fields.join(',')},source,source_id,source_url,source_license,retrieved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(u.id, p.name, ...fields.map(k => p[k]), p.source, p.source_id || null, p.source_url || null, p.source_license || null, p.retrieved_at || null);
    return db.prepare('SELECT * FROM v8_foods WHERE id=? AND user_id=?').get(Number(r.lastInsertRowid), u.id);
  };
  return async function handle(method, pathname, body, u) {
    if (!u) fail('Oturum gerekli', 401);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON nesnesi gerekli');
    if (body.user_id !== undefined && Number(body.user_id) !== u.id) fail('Yalnızca kendi kayıtlarınıza erişebilirsiniz', 403);
    if (body.member_id !== undefined && Number(body.member_id) !== u.member_id) fail('Yalnızca kendi kayıtlarınıza erişebilirsiniz', 403);
    const route = pathname.slice('/api/v8'.length);
    if (method === 'GET' && route === '/foods/search') {
      const query = String(body.q || '').trim();
      if (query.length < 2 || query.length > 100) fail('Arama 2-100 karakter olmalı');
      const key = query.toLowerCase();
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.data;
      const url = new URL('https://search.openfoodfacts.org/search');
      url.searchParams.set('q', query);
      url.searchParams.set('page_size', '5');
      const response = await remote(url);
      if (!Array.isArray(response.hits)) fail('Besin kaynağı geçersiz arama yanıtı verdi. Lütfen daha sonra deneyin.', 502);
      if (response.timed_out === true) fail('Besin kaynağında arama zaman aşımına uğradı. Lütfen daha sonra deneyin.', 502);
      // The search index omits the nutrition basis. Read each result from the
      // product API rather than guessing mass/volume units or missing values.
      const codes = [...new Set(response.hits.slice(0, 5).map(p => String(p?.code || '')).filter(code => /^\d{8,14}$/.test(code)))];
      const products = await Promise.all(codes.map(lookup));
      const data = { products: products.filter(Boolean), attribution: 'Open Food Facts — ODbL-1.0' };
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { data, expires: Date.now() + 60000 });
      return data;
    }
    if (method === 'POST' && route === '/foods/select') {
      if (!/^\d{8,14}$/.test(String(body.source_id))) fail('Geçersiz ürün kodu');
      const product = await lookup(String(body.source_id));
      if (!product || product.source_id !== String(body.source_id)) fail('Ürün veya 100 gram besin değerleri bulunamadı', 422);
      return save(u, product);
    }
    if (method === 'POST' && route === '/foods') {
      const name = String(body.name || '').trim();
      if (name.length < 2 || name.length > 200) fail('Ürün adı 2-200 karakter olmalı');
      return save(u, { name, ...Object.fromEntries(fields.map((k, i) => [k, number(body[k], 0, i ? 100 : 1000)])), source: 'manual' });
    }
    if (method === 'GET' && route === '/foods') return db.prepare('SELECT * FROM v8_foods WHERE user_id=? ORDER BY id DESC').all(u.id);
    if (method === 'POST' && route === '/food-logs') {
      const id = number(body.product_id, 1, Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(id)) fail('Geçersiz ürün kimliği');
      if (!db.prepare('SELECT id FROM v8_foods WHERE id=? AND user_id=?').get(id, u.id)) fail('Ürün bulunamadı', 404);
      const grams = number(body.grams, 0.01, 5000), consumed = date(body.consumed_on);
      const r = db.prepare('INSERT INTO v8_food_logs(user_id,product_id,grams,consumed_on) VALUES(?,?,?,?)').run(u.id, id, grams, consumed);
      return { id: Number(r.lastInsertRowid) };
    }
    if (method === 'DELETE' && /^\/food-logs\/\d+$/.test(route)) {
      if (!db.prepare('DELETE FROM v8_food_logs WHERE id=? AND user_id=?').run(Number(route.split('/').pop()), u.id).changes) fail('Kayıt bulunamadı', 404);
      return { ok: true };
    }
    if (method === 'GET' && route === '/nutrition/history') {
      const anchor = date(body.date || new Date().toISOString().slice(0, 10));
      const period = body.period || 'daily';
      let start = new Date(anchor + 'T00:00:00Z'), days = 1;
      if (period === 'weekly') { start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7); days = 7; }
      else if (period === 'monthly') { start.setUTCDate(1); days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate(); }
      else if (period !== 'daily') fail('Geçersiz dönem');
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + days);
      const logs = db.prepare(`SELECT l.*, f.name, f.source, f.source_url, ${fields.map(k => 'f.' + k).join(',')} FROM v8_food_logs l JOIN v8_foods f ON f.id=l.product_id WHERE l.user_id=? AND l.consumed_on>=? AND l.consumed_on<? ORDER BY l.consumed_on,l.id`).all(u.id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
      const daily = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0, 10), kcal: 0, protein: 0, carbs: 0, fat: 0 }; });
      const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      for (const log of logs) {
        log.nutrients = {};
        Object.keys(totals).forEach((k, i) => { const value = log[fields[i]] * log.grams / 100; log.nutrients[k] = round(value); totals[k] += value; daily.find(d => d.date === log.consumed_on)[k] += value; });
      }
      const average = round(totals.kcal / days);
      for (const item of [totals, ...daily]) for (const k of Object.keys(totals)) item[k] = round(item[k]);
      return { period, start: daily[0].date, end: daily.at(-1).date, days, average_daily_kcal: average, totals, daily, logs };
    }
    if (method === 'POST' && route === '/nutrition/estimate') {
      const height = number(body.height_cm, 100, 250), weight = number(body.weight_kg, 30, 350), age = number(body.age, 18, 100);
      const activity = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
      const goals = { lose: -300, maintain: 0, gain: 300 };
      if (!Object.hasOwn(activity, body.activity) || !Object.hasOwn(goals, body.goal) || !['male', 'female'].includes(body.sex)) fail('Geçersiz aktivite, hedef veya cinsiyet');
      if (!Number.isInteger(age)) fail('Yaş tam sayı olmalı');
      const bmr = 10 * weight + 6.25 * height - 5 * age + (body.sex === 'male' ? 5 : -161);
      if (bmr <= 0 || bmr * activity[body.activity] + goals[body.goal] <= 0) fail('Ölçüler bu tahmin modeli için uygun değil');
      return { bmi: round(weight / (height / 100) ** 2), bmr: round(bmr), maintenance_kcal: round(bmr * activity[body.activity]), target_kcal: round(bmr * activity[body.activity] + goals[body.goal]), formula: 'Mifflin-St Jeor', estimated: true };
    }
    if (method === 'POST' && route === '/nutrition/bmi') return { bmi: round(number(body.weight_kg, 1, 500) / (number(body.height_cm, 50, 250) / 100) ** 2) };
    fail('API bulunamadı', 404);
  };
};
