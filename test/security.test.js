process.env.NODE_ENV='test';process.env.FITNESS_DB_PATH=':memory:';process.env.COOKIE_SECURE='1';
const test=require('node:test');const assert=require('node:assert/strict');const {once}=require('node:events');const {createHash}=require('node:crypto');
const {server,db,shutdown}=require('../server');let base;
const hash=v=>createHash('sha256').update(v).digest('hex');
async function call(url,body,headers={}){return fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})}
test.before(async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`});
test.after(async()=>shutdown());
test('health is minimal, no-store and database-aware; headers protect static and API responses',async()=>{
 const r=await call('/healthz');assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok'});assert.equal(r.headers.get('cache-control'),'no-store');
 for(const route of ['/','/api/me','/v8.html?embedded=1','/v9/index.html?embedded=1']){const res=await call(route);assert.equal(res.headers.get('x-content-type-options'),'nosniff');assert.match(res.headers.get('content-security-policy'),/script-src 'self';/);assert.equal(res.headers.get('access-control-allow-origin'),null)}
});
test('HTTP rejects hostile origins, simple form CSRF, invalid JSON shape and CORS preflight',async()=>{
 assert.equal((await call('/api/setup',{username:'admin',password:'secret-password-123'},{origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/setup',{},{'content-type':'text/plain'})).status,415);
 assert.equal((await call('/api/setup',[])).status,400);
 assert.equal((await fetch(base+'/api/setup',{method:'OPTIONS',headers:{origin:'https://evil.test'}})).status,405);
});
test('login rotation, hashed cookies, logout revocation, SQL injection and secret redaction',async()=>{
 const setup=await call('/api/setup',{username:'admin',password:'secret-password-123'});assert.equal(setup.status,200);
 const cookie=setup.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(cookie.includes(flag));
 const old=cookie.split(';')[0],token=old.split('=')[1];assert.ok(db.prepare('SELECT 1 FROM sessions WHERE id_hash=?').get(hash(token)));assert.equal(db.prepare('SELECT 1 FROM sessions WHERE id_hash=?').get(token),undefined);
 const login=await call('/api/login',{username:'admin',password:'secret-password-123'},{cookie:old});assert.equal(login.status,200);const current=login.headers.get('set-cookie').split(';')[0];assert.notEqual(current,old);assert.equal((await (await call('/api/me',undefined,{cookie:old})).json()).user,null);
 assert.equal((await call('/api/login',{username:"' OR 1=1 --",password:'secret-password-123'})).status,401);
 const profile=await (await call('/api/me',undefined,{cookie:current})).text();assert.ok(!profile.includes('password_hash'));assert.ok(!profile.includes('session_hash'));
 const duplicate=await call('/api/users',{username:'admin',password:'secret-password-123',role:'admin'},{cookie:current});assert.equal(duplicate.status,500);assert.deepEqual(await duplicate.json(),{error:'İşlem tamamlanamadı'});
 const logout=await call('/api/logout',{}, {cookie:current});assert.match(logout.headers.get('set-cookie'),/Secure/);assert.equal((await call('/api/state',undefined,{cookie:current})).status,401);
});
test('stored markup is escaped in unified member views and inline script sinks are removed',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const c={FormClubDashboard:{defaults:()=>({})},document:{getElementById:()=>({}),addEventListener:()=>{}},window:{addEventListener:()=>{}},navigator:{onLine:true},location:{hash:''},fetch:()=>new Promise(()=>{}),console,setTimeout};
 vm.createContext(c);vm.runInContext(fs.readFileSync('public/app.js','utf8'),c);
 vm.runInContext(`S={members:[{id:1,name:'<img src=x onerror=alert(1)>',phone:'',email:'',plan:'<script>alert(1)</script>',credits:'<img src=x>',expires:'2026-12-01',status:'Aktif'}],bookings:[]}`,c);
 const html=vm.runInContext('memberProfile()',c);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));
 for(const file of ['public/v7.html','public/v8.html','public/v9/index.html'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/<script>([\s\S]*?)<\/script>/);
 assert.doesNotMatch(vm.runInContext("moduleFrame('/v8.html','Beslenme')",c),/onload=/);
});
test('HTTP login rate limit blocks repeated guesses even with forged forwarded IP',async()=>{
 let response;for(let i=0;i<25;i++)response=await call('/api/login',{username:'missing',password:'bad'},{'x-forwarded-for':`192.0.2.${i}`});assert.equal(response.status,429);assert.ok(response.headers.get('retry-after'));
});
test('health returns 503 when database is closed without exposing details',async()=>{db.close();const res=await call('/healthz');assert.equal(res.status,503);assert.deepEqual(await res.json(),{status:'unavailable'})});
