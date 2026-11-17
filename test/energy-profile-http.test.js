process.env.NODE_ENV='test';process.env.FITNESS_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const {server,db}=require('../server');
test('profile HTTP uses private Nutrition+ goals, real logout, CSRF and unchanged security headers',async t=>{
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));db.close()});const base=`http://127.0.0.1:${server.address().port}`;
 async function req(route,method='GET',body,cookie,origin){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(origin?{origin}:{})},body:method==='GET'?undefined:JSON.stringify(body||{})});return {r,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 assert.equal((await req('/api/nutrition-plus/profile')).r.status,401);
 const admin=await req('/api/setup','POST',{username:'profile-admin',password:'profile-test-password'});assert.match(admin.r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 for(const [username,role,link] of [['profile-member','member',{member_id:1}],['profile-teacher','teacher',{trainer_id:1}]])assert.equal((await req('/api/users','POST',{username,password:'profile-test-password',role,...link},admin.cookie)).r.status,200);
 const member=await req('/api/login','POST',{username:'profile-member',password:'profile-test-password'}),teacher=await req('/api/login','POST',{username:'profile-teacher',password:'profile-test-password'});
 const profile={age:30,sex:'male',height_cm:180,weight_kg:80,activity:'moderate',goal:'maintain',target_mode:'auto'};
 const saved=await req('/api/nutrition-plus/profile','PATCH',profile,member.cookie);assert.equal(saved.r.status,200);assert.equal(saved.data.goals.kcal,2759);assert.equal(saved.r.headers.get('cache-control'),'no-store');assert.match(saved.r.headers.get('content-security-policy'),/script-src 'self';/);assert.equal(saved.r.headers.get('access-control-allow-origin'),null);
 assert.equal((await req('/api/nutrition-plus/goals','GET',null,member.cookie)).data.goals.kcal,2759);
 for(const cookie of [admin.cookie,teacher.cookie])assert.equal((await req('/api/nutrition-plus/profile','GET',null,cookie)).data.profile,null);
 assert.equal((await req('/api/nutrition-plus/profile?user_id=2','GET',null,admin.cookie)).r.status,403);
 assert.equal((await req('/api/nutrition-plus/profile','PATCH',{manual_kcal:2000,target_mode:'manual'},member.cookie,'https://evil.test')).r.status,403);
 assert.equal((await req('/api/nutrition-plus/goals','GET',null,member.cookie)).data.goals.kcal,2759);
 await req('/api/logout','POST',{},member.cookie);assert.equal((await req('/api/nutrition-plus/profile','GET',null,member.cookie)).r.status,401);
 for(const file of ['/energy.js','/shell.css','/nutrition/','/v8.html?embedded=1','/v9/index.html?embedded=1'])assert.equal((await fetch(base+file)).status,200,file);
});
