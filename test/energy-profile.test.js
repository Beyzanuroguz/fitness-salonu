const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const create=require('../backend/nutrition-plus'),E=require('../public/energy');
const base={age:30,sex:'male',height_cm:180,weight_kg:80,activity:'moderate',goal:'maintain',pregnancy:false,medical:false,target_mode:'auto'};
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2),(3)');const handler=create(db,async()=>{throw Error('network forbidden')});return {db,call:(method,route,body={},uid=1)=>handler(method,'/api/nutrition-plus'+route,body,uid?{id:uid,role:['member','teacher','admin'][uid-1],member_id:uid===1?1:null}:null)}}
test('automatic target is computed by the server and committed atomically with Nutrition+ goals',async t=>{
 const f=fixture(t);assert.equal((await f.call('GET','/profile')).profile,null);
 const result=await f.call('PATCH','/profile',{...base,kcal:999}).catch(e=>e);assert.equal(result.status,400);
 const saved=await f.call('PATCH','/profile',base);assert.equal(saved.goals.kcal,2759);assert.equal(saved.goals.kcal,E.resolveTarget(saved.profile).kcal);assert.ok(saved.profile.updated_at);
 assert.equal((await f.call('GET','/goals')).goals.kcal,2759);
 for(const uid of [2,3]){assert.equal((await f.call('GET','/profile',{},uid)).profile,null);assert.equal((await f.call('GET','/goals',{},uid)).goals,null)}
 await assert.rejects(f.call('GET','/profile',{user_id:1},3),e=>e.status===403);
});
test('manual target survives measurement changes, mode changes and synchronized Nutrition+ edits',async t=>{
 const f=fixture(t);await f.call('PATCH','/profile',{...base,target_mode:'manual',manual_kcal:2100});
 const changed=await f.call('PATCH','/profile',{weight_kg:95,activity:'active'});assert.equal(changed.goals.kcal,2100);assert.equal(changed.profile.target_mode,'manual');
 const auto=await f.call('PATCH','/profile',{target_mode:'auto'});assert.equal(auto.profile.manual_kcal,2100);assert.notEqual(auto.goals.kcal,2100);
 const back=await f.call('PATCH','/profile',{target_mode:'manual'});assert.equal(back.goals.kcal,2100);
 await f.call('PATCH','/goals',{kcal:1800,protein:100,carbs:200,fat:60});assert.equal((await f.call('GET','/profile')).profile.manual_kcal,1800);
 await f.call('DELETE','/goals');const cleared=await f.call('GET','/profile');assert.equal(cleared.profile.height_cm,180);assert.equal(cleared.profile.target_mode,'unset');assert.equal(cleared.goals,null);assert.equal(E.resolveTarget(cleared.profile).kcal,null);const noSelection={querySelector:()=>null};assert.equal(E.readForm(noSelection,cleared.profile).target_mode,'unset');
});
test('invalid automatic estimates fail without reporting or saving a target; manual mode is explicit',async t=>{
 const f=fixture(t);
 for(const patch of [{age:17},{age:30.5},{height_cm:90},{weight_kg:true},{activity:'invented'},{pregnancy:'yes'},{pregnancy:true},{medical:true},{sex:null},{weight_kg:40,height_cm:180}])await assert.rejects(f.call('PATCH','/profile',{...base,...patch}),e=>[400,422].includes(e.status));
 assert.equal(f.db.prepare('SELECT count(*) n FROM np_energy_profiles').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM np_goals').get().n,0);
 const manual=await f.call('PATCH','/profile',{target_mode:'manual',manual_kcal:1800,medical:true});assert.equal(manual.goals.kcal,1800);
 await assert.rejects(f.call('PATCH','/profile',{manual_kcal:799}),e=>e.status===400);assert.equal((await f.call('GET','/goals')).goals.kcal,1800);
});
test('calorie profile and target persist after a temporary database is closed and reopened',async()=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'formclub-energy-'));const file=path.join(dir,'isolated.sqlite');let db=new DatabaseSync(file);
 try{db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');let h=create(db);await h('PATCH','/api/nutrition-plus/profile',{...base,target_mode:'manual',manual_kcal:2000},{id:1,role:'member'});db.close();db=new DatabaseSync(file);h=create(db);const result=await h('GET','/api/nutrition-plus/profile',{}, {id:1,role:'member'});assert.equal(result.profile.manual_kcal,2000);assert.equal(result.goals.kcal,2000);assert.equal((await h('GET','/api/nutrition-plus/profile',{}, {id:2,role:'admin'})).profile,null)}finally{if(db.isOpen)db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
