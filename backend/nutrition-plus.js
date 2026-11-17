'use strict';
const keys = ['kcal', 'protein', 'carbs', 'fat'];
const meals = ['breakfast', 'lunch', 'dinner', 'snack'];
const fail = (s, status=400) => { throw Object.assign(Error(s), {status}); };
function num(v,min,max) { if (!['number','string'].includes(typeof v)||String(v).trim()===''||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max) fail('Geçersiz miktar'); return Number(v); }
function day(s) { if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s) fail('Geçersiz tarih'); return s; }
const round = n => Math.round(n*100)/100;
module.exports = function(db, fetcher=fetch) {
 db.exec(`CREATE TABLE IF NOT EXISTS np_foods(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,data TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS np_logs(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),food_id INTEGER NOT NULL REFERENCES np_foods(id),grams REAL NOT NULL,meal TEXT NOT NULL,day TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS np_owner_day ON np_logs(user_id,day);`);
 const cache=new Map(), pending=new Map(), requests=[];
 const unpack = r => r && ({...JSON.parse(r.data),id:r.id,favorite:!!r.favorite});
 const own = (id,u) => { const r=db.prepare('SELECT * FROM np_foods WHERE id=? AND user_id=?').get(num(id,1,Number.MAX_SAFE_INTEGER),u); if(!r)fail('Besin bulunamadı',404); return unpack(r); };
 const save = (u,p) => { const r=db.prepare('INSERT INTO np_foods(user_id,name,data) VALUES(?,?,?)').run(u,p.name,JSON.stringify(p));return own(Number(r.lastInsertRowid),u); };
 async function remote(url) {
  const key=String(url), hit=cache.get(key); if(hit&&hit.until>Date.now())return hit.data;
  if(pending.has(key))return pending.get(key);
  const search=key.includes('search.openfoodfacts');
  const now=Date.now(); while(requests.length&&requests[0].at<now-60000)requests.shift();
  if(requests.filter(r=>r.search===search).length >= (search?8:12))fail('Besin kaynağı istek sınırı. Bir dakika sonra deneyin.',429);
  requests.push({at:now,search});
  const task=(async()=>{try {
   const r=await fetcher(url,{headers:{'User-Agent':process.env.OFF_USER_AGENT||'FORM-CLUB/9.5 (NutritionPlus; https://world.openfoodfacts.org)'},signal:AbortSignal.timeout(12000)});
   if(!r.ok)fail('Open Food Facts şu an kullanılamıyor. Daha sonra deneyin.',502);
   const data=await r.json();if(!data||typeof data!=='object')fail('Geçersiz kaynak yanıtı',502);
   if(cache.size>=150)cache.delete(cache.keys().next().value);cache.set(key,{data,until:Date.now()+300000});return data;
  }catch(e){if(e.status)throw e;fail('Besin kaynağına ulaşılamadı. Bağlantınızı kontrol edin.',502);}finally{pending.delete(key);}})();pending.set(key,task);return task;
 }
 async function product(code) {
  if(!/^\d{8,14}$/.test(String(code)))fail('Barkod 8–14 rakam olmalı');
  const d=await remote(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=code,product_name,nutrition_data_per,product_quantity_unit,serving_quantity,serving_quantity_unit,serving_size,last_modified_t,nutriments`);
  const p=d.product;if(!p||String(p.code)!==String(code)||!p.product_name)fail('Ürün bulunamadı',404);
  const mass=p.nutrition_data_per==='100g'&&!['ml','cl','l'].includes(p.product_quantity_unit)&&!['ml','cl','l'].includes(p.serving_quantity_unit);
  const nutrients={}; const ns=p.nutriments||{};
  keys.forEach((k,i)=>{const v=ns[['energy-kcal_100g','proteins_100g','carbohydrates_100g','fat_100g'][i]]; nutrients[k]=mass&&['number','string'].includes(typeof v)&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=(i?100:1000)?Number(v):null;});
  const serving=mass&&p.serving_quantity_unit==='g'&&Number(p.serving_quantity)>0&&Number(p.serving_quantity)<=5000?Number(p.serving_quantity):null;
  return {name:String(p.product_name).slice(0,200),nutrients,serving_grams:serving,source:'Open Food Facts',source_id:String(code),source_url:`https://world.openfoodfacts.org/product/${code}`,source_license:'ODbL-1.0 / DbCL-1.0',retrieved_at:new Date().toISOString(),updated_at:Number.isFinite(p.last_modified_t)&&p.last_modified_t>0?new Date(p.last_modified_t*1000).toISOString():null,basis:mass?'100g':'unsupported',serving_label:String(p.serving_size||'').slice(0,100)};
 }
 return async(method,path,b,u)=>{
  if(!u)fail('Oturum gerekli',401);
  if(!b||typeof b!=='object'||Array.isArray(b))fail('JSON nesnesi gerekli');
  if(b.user_id!==undefined&&Number(b.user_id)!==u.id||b.member_id!==undefined&&Number(b.member_id)!==u.member_id)fail('Yalnızca kendi kayıtlarınıza erişebilirsiniz',403);
  const route=path.slice('/api/nutrition-plus'.length), uid=u.id;
  if(method==='GET'&&route==='/search') {
   const q=String(b.q||'').trim();if(q.length<2||q.length>100)fail('Arama 2–100 karakter olmalı');
   const url=new URL('https://search.openfoodfacts.org/search');url.searchParams.set('q',q);url.searchParams.set('page_size','5');
   const d=await remote(url);if(!Array.isArray(d.hits)||d.timed_out)fail('Arama kaynağı yanıt vermedi',502);
   return {products:d.hits.slice(0,5).filter(p=>/^\d{8,14}$/.test(String(p?.code))).map(p=>({source_id:String(p.code),name:String(p.product_name||p.code).slice(0,200)})),attribution:'Open Food Facts — ODbL-1.0'};
  }
  if(method==='GET'&&route==='/barcode')return product(String(b.code));
  if(method==='POST'&&route==='/select')return save(uid,await product(String(b.code)));
  if(method==='GET'&&route==='/foods') {
   let rows=db.prepare('SELECT * FROM np_foods WHERE user_id=? ORDER BY id DESC LIMIT 500').all(uid);
   if(b.filter==='favorites')rows=rows.filter(r=>r.favorite);
   else if(b.filter==='recent')rows=db.prepare('SELECT f.*,MAX(l.id) last_log FROM np_logs l JOIN np_foods f ON f.id=l.food_id AND f.user_id=l.user_id WHERE l.user_id=? GROUP BY f.id ORDER BY last_log DESC LIMIT 20').all(uid);
   else if(b.filter==='recipes')rows=rows.filter(r=>JSON.parse(r.data).source==='recipe');
   return rows.map(unpack);
  }
  if(method==='PATCH'&&/^\/foods\/\d+\/favorite$/.test(route)){const id=route.split('/')[2];own(id,uid);if(typeof b.favorite!=='boolean')fail('Favori seçimi gerekli');db.prepare('UPDATE np_foods SET favorite=? WHERE id=? AND user_id=?').run(+b.favorite,id,uid);return {ok:true};}
  if(method==='POST'&&route==='/recipes') {
   const name=String(b.name||'').trim();if(name.length<2||name.length>200||!Array.isArray(b.ingredients)||!b.ingredients.length||b.ingredients.length>50)fail('Tarif adı ve 1–50 malzeme gerekli');
   const weight=num(b.yield_grams,1,20000), portions=num(b.portions,1,100);
   const sums=Object.fromEntries(keys.map(k=>[k,0]));
   const ingredients=b.ingredients.map(i=>{const f=own(i.food_id,uid),grams=num(i.grams,0.01,5000);keys.forEach(k=>{sums[k]=sums[k]===null||f.nutrients[k]===null?null:sums[k]+f.nutrients[k]*grams/100;});return {food_id:f.id,name:f.name,grams,source:f.source,source_url:f.source_url||null,retrieved_at:f.retrieved_at||null};});
   return save(uid,{name,source:'recipe',nutrients:Object.fromEntries(keys.map(k=>[k,sums[k]===null?null:round(sums[k]*100/weight)])),serving_grams:weight/portions,yield_grams:weight,portions,ingredients,retrieved_at:new Date().toISOString(),updated_at:new Date().toISOString(),basis:'100g'});
  }
  if(method==='POST'&&route==='/logs') {
   const f=own(b.food_id,uid);if(f.basis!=='100g')fail('Gram bazlı değer bulunamadı; bu ürün günlüğe eklenemez',422);
   const grams=b.portions!==undefined?num(b.portions,0.01,100)*(f.serving_grams||fail('Gram cinsinden porsiyon bilgisi yok',422)):num(b.grams,0.01,5000);
   num(grams,0.01,5000);if(!meals.includes(b.meal))fail('Geçersiz öğün');
   const r=db.prepare('INSERT INTO np_logs(user_id,food_id,grams,meal,day) VALUES(?,?,?,?,?)').run(uid,f.id,grams,b.meal,day(b.day));return {id:Number(r.lastInsertRowid),grams};
  }
  if(method==='DELETE'&&/^\/logs\/\d+$/.test(route)){if(!db.prepare('DELETE FROM np_logs WHERE id=? AND user_id=?').run(Number(route.split('/')[2]),uid).changes)fail('Kayıt bulunamadı',404);return {ok:true};}
  if(method==='GET'&&route==='/history') {
   const anchor=day(b.date),period=b.period||'daily';const start=new Date(anchor+'T00:00:00Z');let count=1;
   if(period==='weekly'){start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);count=7;}else if(period==='monthly'){start.setUTCDate(1);count=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();}else if(period!=='daily')fail('Geçersiz dönem');
   const bucket=()=>({known:Object.fromEntries(keys.map(k=>[k,0])),missing:Object.fromEntries(keys.map(k=>[k,0]))});
   const daily=Array.from({length:count},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),...bucket()};});
   const rows=db.prepare('SELECT l.*,f.data FROM np_logs l JOIN np_foods f ON f.id=l.food_id AND f.user_id=l.user_id WHERE l.user_id=? AND l.day BETWEEN ? AND ? ORDER BY l.day,l.id').all(uid,daily[0].date,daily.at(-1).date);
   const totals=bucket();const logs=rows.map(r=>{const f=JSON.parse(r.data),nutrients={};keys.forEach(k=>{const n=f.nutrients[k]===null?null:f.nutrients[k]*r.grams/100;nutrients[k]=n===null?null:round(n);for(const target of [totals,daily.find(d=>d.date===r.day)]){if(n===null)target.missing[k]++;else target.known[k]+=n;}});return {id:r.id,food_id:r.food_id,name:f.name,grams:r.grams,meal:r.meal,day:r.day,nutrients,source:f.source,source_url:f.source_url,retrieved_at:f.retrieved_at,updated_at:f.updated_at};});
   for(const d of [totals,...daily])keys.forEach(k=>d.known[k]=round(d.known[k]));
   return {period,days:count,daily,totals,logs};
  }
  fail('API bulunamadı',404);
 };
};
