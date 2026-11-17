const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const create=require('../backend/nutrition-plus');
const {createNutritionApi}=require('../public/nutrition/nutrition-api');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2),(3)');
 const route=create(db,async url=>({ok:true,json:async()=>String(url).includes('search.openfoodfacts')?{hits:[{code:'3017620422003',product_name:'Synthetic contract product'}]}:{product:{code:'3017620422003',product_name:'Synthetic contract product',nutrition_data_per:'100g',product_quantity_unit:'ml',serving_quantity:200,serving_quantity_unit:'ml',nutriments:{'energy-kcal_100g':50,proteins_100g:3,carbohydrates_100g:5}}}}));
 const clients=['member','teacher','admin'].map((role,i)=>{const user={id:i+1,role,member_id:role==='member'?1:null};return createNutritionApi({fetchImpl:async(p,init={})=>{
  const url=new URL(p,'https://club.test');try{const data=url.pathname==='/api/me'?{user}:await route(init.method||'GET',url.pathname,init.method&&init.method!=='GET'?JSON.parse(init.body):Object.fromEntries(url.searchParams),user);return new Response(JSON.stringify(data),{headers:{'content-type':'application/json','cache-control':'no-store'}})}catch(e){return new Response(JSON.stringify({error:e.message}),{status:e.status||400})}
 }});});return {db,route,clients};
}
test('Nutrition+ default adapter supports source-backed ml, favorites, meals, recipes and persisted goals',async t=>{
 const {clients:[api],db}=fixture(t);assert.equal(api.caps.volume,true);assert.equal(api.caps.serverGoals,true);
 const search=await api.search('synthetic');assert.equal(search.products.length,1);assert.equal(search.products[0].id,null);
 const read=await api.barcode('3017620422003');assert.equal(read.id,null);assert.equal(db.prepare('SELECT count(*) n FROM np_foods').get().n,0);assert.equal(read.basis,'ml');assert.equal(read.per100.kcal,50);assert.equal(read.per100.fat,null);
 const saved=await api.select(read.sourceId);assert.equal(saved.servings[0].amount,200);await api.toggleFavorite(saved.id);assert.equal((await api.favorites())[0].id,saved.id);
 await api.addLog({productId:saved.id,amount:200,unit:'ml',date:'2026-11-17',meal:'breakfast'});
 const history=await api.history('daily','2026-11-17');assert.equal(history.totals.kcal,100);assert.equal(history.logs[0].unit,'ml');assert.equal(history.logs[0].amount,200);assert.equal(history.logs[0].meal,'breakfast');assert.equal(history.logs[0].nutrients.fat,null);assert.equal(history.partial,true);
 const recipe=await api.saveRecipe({name:'Measured synthetic recipe',items:[{product:saved,amount:200}],yieldGrams:180,portions:2});
 assert.equal(recipe.per100.fat,null);assert.equal(recipe.source.kind,'recipe');const raw=JSON.parse(db.prepare('SELECT data FROM np_foods WHERE id=?').get(recipe.id).data);assert.equal(raw.ingredients[0].unit,'ml');assert.equal(raw.ingredients[0].amount,200);assert.equal(raw.serving_grams,90);
 assert.equal(await api.goals(),null);const goal={kcal:1800,protein:100,carbs:200,fat:60};assert.deepEqual(await api.saveGoals(goal),goal);assert.deepEqual(await api.goals(),goal);await api.saveGoals(null);assert.equal(await api.goals(),null);
 assert.equal((await api.recents())[0].id,saved.id);await api.deleteLog(history.logs[0].id);assert.equal((await api.history('daily','2026-11-17')).logs.length,0);
});
test('every role keeps its collection, goals, recipes and logs private including from administrators',async t=>{
 const {clients,route}=fixture(t);
 for(let i=0;i<clients.length;i++){
  const api=clients[i],product=await api.createFood({name:'Private synthetic '+i,per100:{kcal:100,protein:null,carbs:10,fat:0}});
  await api.addLog({productId:product.id,amount:100,date:'2026-11-17',meal:'dinner'});await api.saveGoals({kcal:1900+i,protein:90,carbs:200,fat:60});
  for(let j=0;j<clients.length;j++)if(i!==j){const other=clients[j];await assert.rejects(other.toggleFavorite(product.id),e=>e.status===404);await assert.rejects(other.addLog({productId:product.id,amount:100,date:'2026-11-17',meal:'lunch'}),e=>e.status===404);await assert.rejects(other.saveRecipe({name:'Forbidden',items:[{product,amount:100}],yieldGrams:100}),e=>e.status===404);}
 }
 for(let i=0;i<clients.length;i++){assert.equal((await clients[i].foods()).length,1);assert.equal((await clients[i].history('daily','2026-11-17')).logs.length,1);assert.equal((await clients[i].goals()).kcal,1900+i);}
 await assert.rejects(route('GET','/api/nutrition-plus/goals',{user_id:1},{id:3,role:'admin'}),e=>e.status===403);
});
test('ml never silently becomes grams; ambiguous sources and invalid goals are rejected',async t=>{
 const {clients:[api],route}=fixture(t);const p=await api.select('3017620422003');
 await assert.rejects(api.addLog({productId:p.id,amount:100,unit:'g',date:'2026-11-17',meal:'lunch'}),e=>e.status===422);
 await assert.rejects(api.saveGoals({kcal:0,protein:10}),e=>e.status===400);
 await assert.rejects(route('POST','/api/nutrition-plus/logs',{food_id:p.id,grams:100,day:'2026-11-17',meal:'lunch'},{id:1}),e=>e.status===422);
 const c=require('../public/nutrition/nutrition-core');assert.throws(()=>c.recipePer100([{product:p,amount:200}]),/ölçülmüş/);
});

test('favorites, meals, goals and recipe ingredients survive a SQLite close/reopen without cross-account leakage',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'formclub-np-persistence-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));const file=path.join(temp,'isolated.sqlite');
 let db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
  let handler=create(db);const u={id:1},call=(m,p,b={})=>handler(m,'/api/nutrition-plus'+p,b,u);
  const p=await call('POST','/foods',{name:'Persistent fixture',basis:'g',nutrients:{kcal:100,protein:2,carbs:null,fat:0}});
  await call('PATCH',`/foods/${p.id}/favorite`,{favorite:true});
  await call('POST','/logs',{food_id:p.id,amount:150,unit:'g',meal:'dinner',day:'2026-11-17'});
  await call('PATCH','/goals',{kcal:2100,protein:120,carbs:250,fat:70});
  const recipe=await call('POST','/recipes',{name:'Persistent recipe',ingredients:[{food_id:p.id,amount:150,unit:'g'}],yield_grams:120,portions:2});
  db.close();db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');handler=create(db);
  assert.equal((await call('GET','/foods',{filter:'favorites'}))[0].id,p.id);
  const history=await call('GET','/history',{date:'2026-11-17'});assert.equal(history.logs[0].meal,'dinner');assert.equal(history.totals.known.kcal,150);assert.equal(history.totals.missing.carbs,1);
  assert.equal((await call('GET','/goals')).goals.kcal,2100);
  const r=(await call('GET','/foods',{filter:'recipes'}))[0];assert.equal(r.id,recipe.id);assert.equal(r.ingredients[0].food_id,p.id);assert.equal(r.ingredients[0].amount,150);assert.equal(r.nutrients.carbs,null);assert.equal(r.serving_grams,60);
  assert.deepEqual(await handler('GET','/api/nutrition-plus/foods',{}, {id:2}),[]);
  assert.equal((await handler('GET','/api/nutrition-plus/goals',{}, {id:2})).goals,null);
  await assert.rejects(call('POST','/recipes',{name:'Invalid units',ingredients:[{food_id:p.id,ml:100}],yield_grams:100,portions:1}),e=>e.status===422);
 }finally{db.close();}
});

test('search results require read-only detail lookup; source metadata and recipe provenance survive the adapter',async t=>{
 const {clients:[api],db}=fixture(t);
 const hit=(await api.search('synthetic')).products[0];assert.equal(hit.detailsLoaded,false);
 const full=await api.barcode(hit.sourceId);assert.equal(full.detailsLoaded,true);assert.equal(full.basis,'ml');assert.equal(db.prepare('SELECT count(*) n FROM np_foods').get().n,0);
 await assert.rejects(api.saveRecipe({name:'Unit changed',items:[{product:hit,amount:100}],yieldGrams:100}),e=>e.status===422);
 const saved=await api.select(full.sourceId);const recipe=await api.saveRecipe({name:'Provenance fixture',items:[{product:saved,amount:100}],yieldGrams:80});
 assert.equal(recipe.ingredients.length,1);assert.equal(recipe.ingredients[0].unit,'ml');assert.equal(recipe.ingredients[0].source.kind,'openfoodfacts');assert.ok(recipe.ingredients[0].retrievedAt);
 const C=require('../public/nutrition/nutrition-core');const p=C.normalizeProduct({name:'Dates',source:'Open Food Facts',retrieved_at:'2026-11-17T10:00:00Z',updated_at:'2026-11-16T10:00:00Z'});
 assert.equal(p.retrievedAt,'2026-11-17T10:00:00Z');assert.equal(p.updatedAt,'2026-11-16T10:00:00Z');
});
