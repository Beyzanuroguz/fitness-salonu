process.env.NODE_ENV='test';process.env.FITNESS_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync,spawn}=require('node:child_process');const {once}=require('node:events');
const {DatabaseSync}=require('node:sqlite');
const {config}=require('../backend/security');
const {server,db}=require('../server');let base;
test.before(async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
test('V9.5 manifest MIME, static revalidation, camera policy and personal cache boundaries',async()=>{
 for(const route of ['/manifest.webmanifest','/v9/manifest.webmanifest']){
  const r=await fetch(base+route);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/manifest+json');assert.equal(r.headers.get('cache-control'),'public, max-age=0, must-revalidate');await r.json();
 }
 for(const route of ['/','/sw.js','/v9/sw.js','/app.js','/v8.html?embedded=1','/v9/index.html?embedded=1']){
  const r=await fetch(base+route);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/max-age=0, must-revalidate/);assert.equal(r.headers.get('permissions-policy'),'camera=(self), microphone=(), geolocation=()');assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
 for(const route of ['/api/me','/api/state','/healthz','/missing.json'])assert.equal((await fetch(base+route)).headers.get('cache-control'),'no-store');
});
test('native localhost origins cannot obtain cross-origin sessions or bypass CSRF',async()=>{
 for(const origin of ['capacitor://localhost','https://localhost','http://localhost','https://evil.test']){
  const r=await fetch(base+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'x',password:'x'})});assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
});
test('staging creates synthetic-only DB, refuses reuse and cannot point at another DB',async()=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'formclub-v95-'));
 const dir=path.join(temp,'new-staging');const file=path.join(dir,'staging.sqlite');
 const env={...process.env,NODE_ENV:'production',APP_ENV:'staging',COOKIE_SECURE:'1',PUBLIC_ORIGIN:'https://stage.test',HOST:'127.0.0.1',PORT:'0',STAGING_DATA_DIR:dir,FITNESS_DB_PATH:file};
 const run=()=>spawnSync(process.execPath,['scripts/prepare-staging.js'],{cwd:path.join(__dirname,'..'),env,encoding:'utf8'});
 let child;
 try{
  assert.throws(()=>config(env));assert.equal(run().status,0);assert.equal(config(env).staging,true);
  assert.equal(run().status,1);
  const original=fs.readFileSync(file);
  assert.throws(()=>config({...env,FITNESS_DB_PATH:path.join(temp,'customer.sqlite')}));
  assert.throws(()=>config({...env,PUBLIC_ORIGIN:'https://production.test'}));
  const inspect=new DatabaseSync(file,{readOnly:true});try{
   assert.equal(inspect.prepare('SELECT count(*) n FROM members').get().n,1);assert.equal(inspect.prepare('SELECT name FROM members').get().name,'STAGING Üye');assert.equal(inspect.prepare('SELECT count(*) n FROM users').get().n,0);
  }finally{inspect.close()}
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});let output='';
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('staging timeout')),5000);child.stdout.on('data',b=>{output+=b;if(output.includes('listening')){clearTimeout(timer);resolve()}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('staging exit'))})});
  const stage=`http://127.0.0.1:${JSON.parse(output.trim()).port}`;
  const r=await fetch(stage+'/healthz');assert.equal(r.status,200);assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');assert.match(r.headers.get('strict-transport-security'),/max-age=/);
  // Simulates the remote WebView's HTTPS Origin over the loopback proxy hop, not live TLS.
  const bad=await fetch(stage+'/api/login',{method:'POST',headers:{origin:'capacitor://localhost','content-type':'application/json'},body:'{}'});assert.equal(bad.status,403);
  const good=await fetch(stage+'/api/login',{method:'POST',headers:{origin:env.PUBLIC_ORIGIN,'content-type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify({username:'staging-user',password:'test-password'})});assert.equal(good.status,401);
  const provision=spawnSync(process.execPath,['scripts/create-admin.js','staging-admin'],{cwd:path.join(__dirname,'..'),env,input:'staging-password-only-123',encoding:'utf8'});assert.equal(provision.status,0);
  const api=async(route,body,cookie)=>fetch(stage+route,{method:body===undefined?'GET':'POST',headers:{origin:env.PUBLIC_ORIGIN,'content-type':'application/json','sec-fetch-site':'same-origin',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const login=await api('/api/login',{username:'staging-admin',password:'staging-password-only-123'});assert.equal(login.status,200);const session=login.headers.get('set-cookie');assert.match(session,/HttpOnly; SameSite=Strict/);assert.match(session,/Secure/);const admin=session.split(';')[0];
  assert.equal((await api('/api/users',{username:'staging-member',password:'staging-member-password',role:'member',member_id:1},admin)).status,200);
  const memberLogin=await api('/api/login',{username:'staging-member',password:'staging-member-password'});assert.equal(memberLogin.status,200);const member=memberLogin.headers.get('set-cookie').split(';')[0];
  const qr=await api('/api/v9/qr',{},member);assert.equal(qr.status,200);assert.equal(qr.headers.get('cache-control'),'no-store');const token=(await qr.json()).token;
  assert.equal((await api('/api/v9/qr/verify',{token},member)).status,403);
  assert.equal((await api('/api/v9/qr/verify',{token},admin)).status,200);
  assert.equal((await api('/api/logout',{},member)).status,200);assert.equal((await api('/api/state',undefined,member)).status,401);
  const exit=once(child,'exit');child.kill('SIGTERM');assert.equal((await exit)[0],0);
  assert.ok(original.length>0);
 }finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit}fs.rmSync(temp,{recursive:true,force:true})}
});
