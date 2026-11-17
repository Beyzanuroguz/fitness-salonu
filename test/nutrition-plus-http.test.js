process.env.NODE_ENV='test';process.env.FITNESS_DB_PATH=':memory:';
const {test}=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const {server,db}=require('../server');
test('Nutrition+ HTTP session, CSRF, private cache, static shell and owner boundaries',async t=>{
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const request=(p,method='GET',body,cookie,origin)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/api/nutrition-plus/foods')).status,401);
 const setup=await request('/api/setup','POST',{username:'np-admin',password:'isolated-password-123'});assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0];
 const uid=db.prepare("SELECT id FROM users WHERE username='np-admin'").get().id;
 const data={name:'HTTP fixture',nutrients:{kcal:200,protein:10,carbs:null,fat:8},basis:'100g',source:'recipe',serving_grams:50};
 const id=Number(db.prepare('INSERT INTO np_foods(user_id,name,data) VALUES(?,?,?)').run(uid,data.name,JSON.stringify(data)).lastInsertRowid);
 const logged=await request('/api/nutrition-plus/logs','POST',{food_id:id,grams:50,meal:'lunch',day:'2026-11-17'},cookie);assert.equal(logged.status,200);assert.equal(logged.headers.get('cache-control'),'no-store');
 const h=await (await request('/api/nutrition-plus/history?date=2026-11-17','GET',null,cookie)).json();assert.equal(h.totals.known.kcal,100);assert.equal(h.totals.missing.carbs,1);
 assert.equal((await request('/api/nutrition-plus/foods?user_id=999','GET',null,cookie)).status,403);
 assert.equal((await request('/api/nutrition-plus/logs','POST',{food_id:id,grams:100,meal:'lunch',day:'2026-11-17'},cookie,'https://evil.test')).status,403);
 for(const p of ['/nutrition-plus.html?embedded=1','/nutrition-plus.js','/nutrition-plus.css','/v8.html?embedded=1']){const r=await request(p);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);}
 const goal=await request('/api/nutrition-plus/goals','PATCH',{kcal:1900,protein:100,carbs:200,fat:70},cookie);assert.equal(goal.status,200);assert.equal((await (await request('/api/nutrition-plus/goals','GET',null,cookie)).json()).goals.kcal,1900);
 const liquid=await request('/api/nutrition-plus/foods','POST',{name:'Manual synthetic liquid',basis:'ml',nutrients:{kcal:40,protein:2,carbs:null,fat:1}},cookie);assert.equal(liquid.status,200);const lp=await liquid.json();assert.equal(lp.source,'manual');
 assert.equal((await request('/api/nutrition-plus/logs','POST',{food_id:lp.id,amount:200,unit:'ml',meal:'snack',day:'2026-11-17'},cookie)).status,200);
 for(const p of ['/nutrition/','/nutrition/index.html','/nutrition/nutrition-api.js','/nutrition/nutrition-core.js','/nutrition/nutrition-views.js','/nutrition/nutrition.js','/nutrition/nutrition.css']){const r=await request(p);assert.equal(r.status,200,p);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);}
 await request('/api/logout','POST',{},cookie);assert.equal((await request('/api/nutrition-plus/foods','GET',null,cookie)).status,401);
});
