process.env.NODE_ENV='test';
process.env.FITNESS_DB_PATH=':memory:';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {db}=require('../server');
const route=require('../backend/v9')(db);
test.after(()=>db.close());
const admin={id:801,role:'admin'},teacher={id:802,role:'teacher',trainer_id:1},other={id:803,role:'teacher',trainer_id:2},member={id:804,role:'member',member_id:1};
test.before(()=>db.exec(`INSERT INTO users(id,username,password_hash,role,trainer_id,member_id) VALUES(801,'integration-admin','x','admin',NULL,NULL),(802,'integration-teacher','x','teacher',1,NULL),(803,'integration-other','x','teacher',2,NULL),(804,'integration-member','x','member',NULL,1); INSERT INTO announcements(title,body) VALUES('Ortak duyuru','Salon duyurusu');`));
test('staff notifications keep read state isolated per identity and reject members',()=>{
 const call=(m,p,b,u)=>route(m,'/api/v9/staff/notifications'+p,b,u);
 const items=call('GET','',{},teacher).reminders;assert.ok(items.length);
 call('POST','/read',{id:items[0].id},teacher);
 assert.equal(call('GET','',{},teacher).reminders[0].read,true);
 assert.equal(call('GET','',{},other).reminders[0].read,false);
 assert.throws(()=>call('GET','',{},member),e=>e.status===403);
 assert.throws(()=>call('POST','/read',{id:'payment:1'},admin),e=>e.status===404);
});
test('admin report selection is separate from teacher self report contract',()=>{
 const path='/api/v9/admin/reports/monthly';
 const result=route('GET',path,{trainer_id:2,month:'2026-11'},admin);assert.equal(result.trainer_id,2);
 for(const u of [teacher,member])assert.throws(()=>route('GET',path,{trainer_id:2},u),e=>e.status===403);
 assert.throws(()=>route('GET','/api/v9/teacher/reports/monthly',{trainer_id:2},teacher),e=>e.status===403);
 for(const u of [teacher,other,member])assert.throws(()=>route('POST','/api/v9/qr/verify',{token:'a'.repeat(64)},u),e=>e.status===403);
});
function appContext(){const context={FormClubDashboard:{defaults:()=>({})},document:{getElementById:()=>({remove:()=>{}}),addEventListener:()=>{}},window:{addEventListener:()=>{}},navigator:{onLine:true},location:{hash:''},fetch:()=>new Promise(()=>{}),console,setTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('public/app.js','utf8'),context);return context}
test('single role menus expose required modules without leaking scanner or member QR',()=>{
 const c=appContext(),pages=r=>Array.from(vm.runInContext(`navItems.${r}.map(x=>x[0])`,c));
 for(const p of ['renewals','reservations','attendance','scan','performance','notifications','nutrition'])assert.ok(pages('admin').includes(p),p);
 for(const p of ['today','calendar','students','attendance','performance','notifications'])assert.ok(pages('teacher').includes(p),p);
 assert.ok(!pages('teacher').includes('scan'));assert.ok(!pages('member').includes('scan'));assert.ok(pages('member').includes('entry'));
 vm.runInContext("role='member';page='entry'",c);assert.match(vm.runInContext('content()',c),/embedded=1#qr/);
 vm.runInContext("page='nutrition'",c);assert.match(vm.runInContext('content()',c),/v8.html\?embedded=1/);
});
test('unified worker bypasses APIs, token query strings and unknown files',()=>{
 const handlers={},c={URL,self:{location:{origin:'https://club.test'},addEventListener:(k,f)=>handlers[k]=f}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),c);
 for(const path of ['/api/state','/api/v9/qr','/app.js?token=private','/profile.json']){
  let hit=false;handlers.fetch({request:{method:'GET',url:'https://club.test'+path},respondWith:()=>hit=true});assert.equal(hit,false,path);
 }
 const manifest=JSON.parse(fs.readFileSync('public/manifest.webmanifest'));assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/index.html');
});

test('logout clears personal in-memory data for the next account',()=>{
 const c=appContext();
 vm.runInContext("account={id:1};S={members:[{name:'Özel'}]};L=[{}];notes=[{}];V6.posts=[{}];V6.foods=[{}];V6.logs=[{}];V6.analytics={};clearPrivateState()",c);
 assert.equal(vm.runInContext('account',c),null);
 assert.equal(vm.runInContext('Object.keys(S).length+L.length+notes.length+V6.posts.length+V6.foods.length+V6.logs.length',c),0);
 assert.equal(vm.runInContext('V6.analytics',c),null);
});
test('unified worker installs only existing public assets and serves the root offline',async()=>{
 const handlers={},assets=new Map();
 const c={URL,Response,self:{location:{origin:'https://club.test'},clients:{claim:async()=>{}},addEventListener:(k,f)=>handlers[k]=f},caches:{open:async()=>({addAll:async files=>{for(const file of files){assert.ok(fs.existsSync('public'+(file==='/'?'/index.html':file)),file);assets.set('https://club.test'+file,new Response('shell'))}}}),match:async r=>assets.get(r.url),keys:async()=>[]},fetch:async()=>{throw Error('offline')}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),c);
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;
 handlers.fetch({request:{method:'GET',url:'https://club.test/'},respondWith:p=>pending=p});
 assert.equal(await (await pending).text(),'shell');
});
test('embedded nutrition preserves all V8 page controls and member selection',()=>{
 const source=fs.readFileSync('public/v8.js','utf8');
 assert.match(source,/aria-label="Beslenme sayfaları"/);
 assert.match(source,/links.map\(\(\[id,name\]\)/);
 assert.match(source,/memberPicker\(\)\}<\/nav>/);
});
