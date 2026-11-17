'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const pub=path.join(__dirname,'../../public');
function qrContext({native=false,embedded=true}={}){
 const timers=new Map(),windowEvents={};let serial=0;
 const events={};const root={addEventListener:(name,fn)=>events[name]=fn};
 const c={URLSearchParams,Date,console,FORMCLUB_CONFIG:{native},location:{search:embedded?'?embedded=1':'',hash:'#qr'},navigator:{onLine:true,serviceWorker:{}},window:{isSecureContext:true,V9Core:require(path.join(pub,'v9/v9-core.js')),addEventListener:(name,fn)=>windowEvents[name]=fn},document:{getElementById:id=>id==='v9-root'?root:null,addEventListener(){},hidden:false},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial},clearTimeout:id=>timers.delete(id),setInterval:()=>0,clearInterval(){}};
 c.rootClick=ev=>events.click(ev);
 vm.createContext(c);
 const code=fs.readFileSync(path.join(pub,'v9/v9.js'),'utf8').replace(/init\(\);\s*\}\)\(\);\s*$/,`render=()=>{};paintQR=()=>{};sayQR=()=>{};tickQR=()=>{};updateScanUI=()=>{};globalThis.testQR={S,fetchQR,stopQR,stopCamera,setStream:value=>stream=value,click:rootClick,setAPI:fn=>api=fn};})();`);
 vm.runInContext(code,c);return {...c.testQR,timers,windowEvents};
}
test('QR retries transient failures, clears retry state on success and never retries revoked access',async()=>{
 const q=qrContext();q.S.view='qr';q.S.role='member';
 q.setAPI(async()=>{throw Object.assign(Error('temporary'),{status:503})});
 await q.fetchQR();assert.equal([...q.timers.values()][0].ms,3000);assert.equal(q.S.qr.retries,1);
 await q.fetchQR();assert.equal([...q.timers.values()][0].ms,6000);
 q.setAPI(async()=>({token:'a'.repeat(64),expires_in:60}));await q.fetchQR();assert.equal(q.S.qr.retryAt,0);assert.equal(q.S.qr.retries,0);assert.equal(q.S.qr.token,'a'.repeat(64));
 q.setAPI(async()=>{throw Object.assign(Error('revoked'),{status:401})});await q.fetchQR();assert.equal(q.S.qr.token,'');assert.equal(q.timers.size,0);
 q.setAPI(async()=>{throw Object.assign(Error('inactive'),{status:403})});await q.fetchQR();assert.equal(q.timers.size,0);
 q.setAPI(async()=>{throw Object.assign(Error('limit'),{status:429})});await q.fetchQR();assert.equal([...q.timers.values()][0].ms,30000);q.stopQR();assert.equal(q.timers.size,0);
});
test('CSP-safe iframe loading binds a listener and hides status on load',()=>{
 let load,timer;const status={hidden:false},frame={addEventListener:(name,fn)=>{assert.equal(name,'load');load=fn}};
 const app={querySelector:selector=>selector==='.module-frame'?frame:status};
 const c={FormClubDashboard:{defaults:()=>({})},navigator:{onLine:true},document:{getElementById:()=>app,addEventListener(){}},window:{addEventListener(){}},location:{hash:''},fetch:()=>new Promise(()=>{}),setTimeout:fn=>{timer=fn;return 1},clearTimeout(){}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(pub,'app.js'),'utf8'),c);vm.runInContext('bindModuleFrame()',c);timer();assert.match(status.innerHTML,/reloadmodule/);load();assert.equal(status.hidden,true);assert.doesNotMatch(vm.runInContext("moduleFrame('/v8.html?embedded=1','Beslenme')",c),/onload=/);
});

test('camera torch uses track constraints and stopping releases the stream',async()=>{
 const q=qrContext();let constraint,stopped=0;
 const track={applyConstraints:async value=>constraint=value,stop:()=>stopped++};q.setStream({getVideoTracks:()=>[track],getTracks:()=>[track]});q.S.scan.active=true;q.S.scan.torchOn=false;
 const target={id:'cam-torch',dataset:{},hasAttribute:()=>false};await q.click({target:{closest:()=>target}});
 assert.equal(constraint.advanced[0].torch,true);assert.equal(q.S.scan.torchOn,true);q.stopCamera();assert.equal(stopped,1);assert.equal(q.S.scan.active,false);
});

test('native V9 disables service worker registration while standalone web retains it',()=>{
 assert.equal(qrContext({native:true,embedded:false}).windowEvents.load,undefined);
 assert.equal(typeof qrContext({native:false,embedded:false}).windowEvents.load,'function');
});
