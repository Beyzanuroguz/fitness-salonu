const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');const {snapshot}=require('../scripts/database');
const {config,createLimiter,guard}=require('../backend/security');
test('production fails closed without HTTPS, Secure cookie and private absolute DB',()=>{
 for(const env of [{},{PUBLIC_ORIGIN:'http://club.test'},{PUBLIC_ORIGIN:'https://club.test',COOKIE_SECURE:'0'}])assert.throws(()=>config({NODE_ENV:'production',...env}));
 assert.equal(config({NODE_ENV:'production',PUBLIC_ORIGIN:'https://club.test',COOKIE_SECURE:'1',FITNESS_DB_PATH:'/srv/private/club.sqlite'}).secure,true);
});
test('CSRF rejects cross-site, same-site sibling, wrong scheme and form bodies',()=>{
 const cfg={origin:'https://club.test'};const req=headers=>({method:'POST',headers:{host:'club.test','content-type':'application/json',...headers}});
 for(const h of [{origin:'http://club.test'},{origin:'https://evil.test'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},{'content-type':'text/plain'},{'content-type':'application/x-www-form-urlencoded'}])assert.throws(()=>guard(req(h),cfg));
 guard(req({origin:cfg.origin,'sec-fetch-site':'same-origin'}),cfg);guard(req({}),cfg);
});
test('rate limit window expires and bounded storage fails closed',()=>{
 let now=0;const limit=createLimiter({limit:2,windowMs:100,maxKeys:1,clock:()=>now});limit('a');limit('a');assert.throws(()=>limit('a'),e=>e.status===429);assert.throws(()=>limit('b'),e=>e.status===429);now=100;limit('b');
});
test('online WAL snapshot restores committed records and invalidates old sessions without touching source',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'formclub-backup-test-'));
 const source=path.join(dir,'source.sqlite'),saved=path.join(dir,'saved.sqlite'),restored=path.join(dir,'restored.sqlite');
 const db=new DatabaseSync(source);
 try{
 db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT);CREATE TABLE sessions(id_hash TEXT);CREATE TABLE v9_qr_tokens(token_hash TEXT);INSERT INTO records VALUES(1,'private record');INSERT INTO sessions VALUES('old-session');INSERT INTO v9_qr_tokens VALUES('old-token');");
 assert.ok(fs.statSync(source+'-wal').size>0);
 await snapshot(source,saved);db.exec("INSERT INTO records VALUES(2,'later')");
 await snapshot(saved,restored,{restore:true});
 const out=new DatabaseSync(restored);try{assert.equal(out.prepare('SELECT count(*) n FROM records').get().n,1);assert.equal(out.prepare('SELECT value FROM records').get().value,'private record');assert.equal(out.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(out.prepare('SELECT count(*) n FROM v9_qr_tokens').get().n,0);assert.equal(out.prepare('PRAGMA integrity_check').get().integrity_check,'ok')}finally{out.close()}
 assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);
 await assert.rejects(snapshot(saved,source,{restore:true}));await assert.rejects(snapshot(source,source));
 assert.equal(fs.statSync(saved).mode&0o777,0o600);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
test('production process has no demo seeding, blocks public setup, emits HSTS and shuts down on SIGTERM',async()=>{
 const {spawn}=require('node:child_process');const {once}=require('node:events');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'formclub-production-test-'));const file=path.join(dir,'production.sqlite');
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'production',FITNESS_DB_PATH:file,PUBLIC_ORIGIN:'https://club.test',COOKIE_SECURE:'1',HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
 let logs='',err='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>err+=b);
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);const onData=()=>{if(logs.includes('listening')){clearTimeout(timer);child.stdout.off('data',onData);resolve()}};child.stdout.on('data',onData);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('startup failed'))})});
  // Port zero is reported via server.address(), not configuration.
  const port=JSON.parse(logs.trim().split('\n')[0]).port;assert.ok(port>0);
  const base=`http://127.0.0.1:${port}`;
  const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.match(health.headers.get('strict-transport-security'),/max-age=/);
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json',origin:'https://club.test'},body:JSON.stringify({username:'attacker',password:'some-long-password'})});assert.equal(setup.status,403);
  const exit=once(child,'exit');child.kill('SIGTERM');assert.equal((await exit)[0],0);
  const db=new DatabaseSync(file);try{assert.equal(db.prepare('SELECT count(*) n FROM members').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,0);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')}finally{db.close()}
  assert.ok(!logs.includes(file));assert.ok(!err.includes('some-long-password'));
 }finally{if(child.exitCode===null)child.kill('SIGKILL');await new Promise(resolve=>setTimeout(resolve,50));fs.rmSync(dir,{recursive:true,force:true})}
});

test('offline administrator provisioning hashes stdin passwords in a temporary database',()=>{
 const {spawnSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'formclub-admin-test-'));const file=path.join(dir,'admin.sqlite');
 const db=new DatabaseSync(file);db.exec('CREATE TABLE users(username TEXT,password_hash TEXT,role TEXT)');
 try{const result=spawnSync(process.execPath,['scripts/create-admin.js','operator'],{cwd:path.join(__dirname,'..'),env:{...process.env,FITNESS_DB_PATH:file},input:'only-for-test-password-123',encoding:'utf8'});assert.equal(result.status,0);const row=db.prepare('SELECT * FROM users').get();assert.equal(row.role,'admin');assert.match(row.password_hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);assert.ok(!result.stdout.includes('only-for-test'));assert.ok(!result.stderr.includes('only-for-test'));}finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
