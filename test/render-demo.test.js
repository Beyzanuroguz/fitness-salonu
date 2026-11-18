'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');const {once}=require('node:events');const {randomBytes}=require('node:crypto');const {DatabaseSync}=require('node:sqlite');
const {config}=require('../backend/security');const root=path.join(__dirname,'..');
const ORIGIN='https://formclub-demo-test.onrender.com';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'formclub-render-demo-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pw=()=>randomBytes(18).toString('base64url');
 const env={PATH:process.env.PATH,NODE_ENV:'production',APP_ENV:'render-demo',HOST:'0.0.0.0',PORT:'0',RENDER_EXTERNAL_URL:ORIGIN,COOKIE_SECURE:'1',FITNESS_DB_PATH:path.join(dir,'run/demo.sqlite'),DEMO_SYNTHETIC_ONLY:'1',PAYMENTS_ENABLED:'0',SMS_ENABLED:'0',EMAIL_ENABLED:'0',TURNSTILE_ENABLED:'0',DEMO_ADMIN_PASSWORD:pw(),DEMO_TEACHER_PASSWORD:pw(),DEMO_MEMBER_PASSWORD:pw()};
 return {dir,env};
}
async function boot(env){
 const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let out='';child.stderr.on('data',b=>out+=b);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),8000);child.stdout.on('data',b=>{out+=b;if(out.includes('listening')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(Error('startup refused'))})});
 const port=JSON.parse(out.trim().split('\n').find(l=>l.includes('listening'))).port;
 return {base:`http://127.0.0.1:${port}`,logs:()=>out,stop:async()=>{if(child.exitCode!==null || child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done}};
}
async function call(base,url,method='GET',body,cookie,origin=ORIGIN){const r=await fetch(base+url,{method,headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},body:method==='GET'?undefined:JSON.stringify(body||{})});return {status:r.status,headers:r.headers,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};}

test('render demo config requires production security, secrets, synthetic-only and disabled outbound actions',t=>{
 const {env}=fixture(t);const cfg=config(env);assert.equal(cfg.renderDemo,true);assert.equal(cfg.origin,ORIGIN);assert.equal(cfg.secure,true);assert.equal(cfg.host,'0.0.0.0');
 for(const change of [{NODE_ENV:'development'},{COOKIE_SECURE:'0'},{RENDER_EXTERNAL_URL:'http://formclub.onrender.com'},{RENDER_EXTERNAL_URL:''},{DEMO_SYNTHETIC_ONLY:'0'},{PAYMENTS_ENABLED:'1'},{SMS_ENABLED:undefined},{EMAIL_ENABLED:'1'},{TURNSTILE_ENABLED:'1'},{DEMO_ADMIN_PASSWORD:undefined},{DEMO_ADMIN_PASSWORD:'short-pass'},{DEMO_MEMBER_PASSWORD:env.DEMO_ADMIN_PASSWORD},{FITNESS_DB_PATH:':memory:'},{FITNESS_DB_PATH:path.join(root,'fitness.sqlite')}])assert.throws(()=>config({...env,...change}),JSON.stringify(change));
 // Production without render-demo keeps its own rules: no RENDER_EXTERNAL_URL fallback.
 assert.throws(()=>config({NODE_ENV:'production',COOKIE_SECURE:'1',RENDER_EXTERNAL_URL:ORIGIN,FITNESS_DB_PATH:'/srv/private/club.sqlite'}));
});

test('render demo boots on 0.0.0.0 with synthetic data, role logins, CSRF/CORS guards and no public setup',async t=>{
 const {env}=fixture(t);const app=await boot(env);
 const health=await call(app.base,'/healthz');assert.deepEqual(health.data,{status:'ok'});assert.equal(health.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
 assert.equal(await (await fetch(app.base+'/robots.txt')).text(),'User-agent: *\nDisallow: /\n');
 assert.equal((await call(app.base,'/api/me')).data.setup,false);
 assert.equal((await call(app.base,'/api/setup','POST',{username:'intruder',password:randomBytes(16).toString('hex')})).status,403);
 assert.equal((await call(app.base,'/api/login','POST',{username:'demo-admin',password:'wrong-password-123'})).status,401);
 const s={};for(const role of ['admin','teacher','member']){const r=await call(app.base,'/api/login','POST',{username:'demo-'+role,password:env[`DEMO_${role.toUpperCase()}_PASSWORD`]});assert.equal(r.status,200,role);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);s[role]=r.cookie;assert.equal((await call(app.base,'/api/me','GET',null,r.cookie)).data.user.role,role)}
 const admin=(await call(app.base,'/api/state','GET',null,s.admin)).data;assert.ok(admin.members.length>1);assert.ok(admin.members.every(m=>m.email.endsWith('@example.com')));assert.ok(admin.announcements.some(a=>a.title==='DEMO ortamı'));
 assert.equal((await call(app.base,'/api/state','GET',null,s.member)).data.members.length,1);
 assert.equal((await call(app.base,'/api/payments','POST',{member_id:1,amount:1,due_date:'2099-01-01'},s.teacher)).status,403);
 assert.equal((await call(app.base,'/api/announcements','POST',{title:'x',body:'y'},s.admin,'https://evil.example')).status,403);
 const me=await call(app.base,'/api/me','GET',null,s.member);assert.equal(me.headers.get('access-control-allow-origin'),null);assert.match(me.headers.get('content-security-policy'),/script-src 'self';/);assert.match(me.headers.get('strict-transport-security'),/max-age/);
 assert.equal((await call(app.base,'/api/logout','POST',{},s.member)).status,200);assert.equal((await call(app.base,'/api/state','GET',null,s.member)).status,401);
 for(const k of ['DEMO_ADMIN_PASSWORD','DEMO_TEACHER_PASSWORD','DEMO_MEMBER_PASSWORD'])assert.ok(!app.logs().includes(env[k]));
});

test('render demo resets on restart and refuses to touch a non-demo database',async t=>{
 const {dir,env}=fixture(t);let app=await boot(env);t.after(()=>app.stop());
 const login=await call(app.base,'/api/login','POST',{username:'demo-admin',password:env.DEMO_ADMIN_PASSWORD});
 const before=(await call(app.base,'/api/state','GET',null,login.cookie)).data.members.length;
 assert.equal((await call(app.base,'/api/members','POST',{name:'Geçici Kayıt',expires:'2099-01-01'},login.cookie)).status,200);
 assert.equal((await call(app.base,'/api/state','GET',null,login.cookie)).data.members.length,before+1);
 await app.stop();app=await boot(env);
 assert.equal((await call(app.base,'/api/state','GET',null,login.cookie)).status,401);
 const again=await call(app.base,'/api/login','POST',{username:'demo-admin',password:env.DEMO_ADMIN_PASSWORD});
 assert.equal((await call(app.base,'/api/state','GET',null,again.cookie)).data.members.length,before);
 await app.stop();
 const foreign=path.join(dir,'customer.sqlite');const d=new DatabaseSync(foreign);d.exec("CREATE TABLE members(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO members(name) VALUES('Gerçek Müşteri')");d.close();
 const bytes=fs.readFileSync(foreign);await assert.rejects(boot({...env,FITNESS_DB_PATH:foreign}),/startup refused/);assert.deepEqual(fs.readFileSync(foreign),bytes);
});

test('render demo: virtual turnstiles work with demo accounts, stay simulation-only and get new QR ids on every restart',async t=>{
 const {env}=fixture(t);let app=await boot(env);t.after(()=>app.stop());
 const login=async role=>(await call(app.base,'/api/login','POST',{username:'demo-'+role,password:env[`DEMO_${role.toUpperCase()}_PASSWORD`]})).cookie;
 let admin=await login('admin');const member=await login('member');
 const first=(await call(app.base,'/api/turnstiles','GET',null,admin)).data;assert.equal(first.simulation,true);assert.equal(first.turnstiles.length,3);
 const pass=(await call(app.base,'/api/turnstiles/scan','POST',{code:first.turnstiles[1].qr,idempotency_key:'render-demo-0001'},member)).data;
 assert.deepEqual([pass.ok,pass.direction,pass.turnstile],[true,'in','Turnike 2']);
 assert.equal((await call(app.base,'/api/turnstiles','GET',null,admin)).data.inside_count,1);
 assert.equal((await call(app.base,'/api/turnstiles/scan','POST',{code:first.turnstiles[1].qr,idempotency_key:'render-demo-0002'},admin)).status,403);
 await app.stop();app=await boot(env);admin=await login('admin');
 const second=(await call(app.base,'/api/turnstiles','GET',null,admin)).data;
 assert.equal(second.inside_count,0,'presence reset with the ephemeral DB');
 for(let i=0;i<3;i++)assert.notEqual(second.turnstiles[i].qr,first.turnstiles[i].qr,'printed codes stop working after a restart');
 for(const k of ['DEMO_ADMIN_PASSWORD','DEMO_TEACHER_PASSWORD','DEMO_MEMBER_PASSWORD'])assert.ok(!app.logs().includes(env[k]));
});
test('render demo: virtual lockers work after a turnstile entry, say they are ephemeral and reset QR ids and logs on restart',async t=>{
 const {env}=fixture(t);let app=await boot(env);t.after(()=>app.stop());
 const login=async role=>(await call(app.base,'/api/login','POST',{username:'demo-'+role,password:env[`DEMO_${role.toUpperCase()}_PASSWORD`]})).cookie;
 let admin=await login('admin');const member=await login('member');
 const first=(await call(app.base,'/api/lockers','GET',null,admin)).data;
 assert.equal(first.lockers.length,20);assert.equal(first.ephemeral,true);assert.equal(first.simulation,true);
 const gate=(await call(app.base,'/api/turnstiles','GET',null,admin)).data.turnstiles[0].qr;
 assert.equal((await call(app.base,'/api/turnstiles/scan','POST',{code:gate,idempotency_key:'render-lock-0001'},member)).data.direction,'in');
 const claim=(await call(app.base,'/api/lockers/claim','POST',{code:first.lockers[2].qr,idempotency_key:'render-lock-0002'},member)).data;
 assert.deepEqual([claim.ok,claim.locker],[true,'Dolap 3']);
 const occupied=await call(app.base,'/api/lockers/claim','POST',{code:first.lockers[2].qr,idempotency_key:'render-lock-0003'},admin);
 assert.equal(occupied.status,200);assert.equal(occupied.data.reason,'occupied');
 const adminClaim=await call(app.base,'/api/lockers/claim','POST',{code:first.lockers[3].qr,idempotency_key:'render-lock-0004'},admin);
 assert.equal(adminClaim.status,200);assert.deepEqual([adminClaim.data.ok,adminClaim.data.locker],[true,'Dolap 4']);
 await app.stop();app=await boot(env);admin=await login('admin');
 const second=(await call(app.base,'/api/lockers','GET',null,admin)).data;
 assert.equal(second.counts.occupied,0);assert.equal(second.events.length,0,'demo locker logs reset');
 for(let i=0;i<20;i++)assert.notEqual(second.lockers[i].qr,first.lockers[i].qr,'printed demo locker codes stop working after a restart');
});
