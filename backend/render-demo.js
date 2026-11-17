'use strict';
// Render Free demo (APP_ENV=render-demo). Render Free has no persistent disk, so this mode is
// deliberately ephemeral: every process start rebuilds a synthetic-only SQLite file in a temporary
// directory. It never opens, copies or migrates a customer database. Production rules are unchanged.
const fs=require('node:fs'),path=require('node:path');
const MARK='formclub-render-demo-v1';
const ROOT=path.resolve(__dirname,'..');
const OUTBOUND=['PAYMENTS_ENABLED','SMS_ENABLED','EMAIL_ENABLED','TURNSTILE_ENABLED'];
const ROLES=[['admin','DEMO_ADMIN'],['teacher','DEMO_TEACHER'],['member','DEMO_MEMBER']];

function accounts(env=process.env){
 const list=ROLES.map(([role,key])=>({role,username:env[key+'_USERNAME']||'demo-'+role,password:env[key+'_PASSWORD']}));
 for(const a of list){
  if(!/^[-a-zA-Z0-9_.]{3,80}$/.test(a.username))throw Error(`Invalid ${a.role} demo username`);
  if(typeof a.password!=='string'||a.password.length<16||a.password.length>256)throw Error(`Render demo requires a strong ${a.role} password secret (16+ characters)`);
 }
 if(new Set(list.map(a=>a.username)).size!==list.length||new Set(list.map(a=>a.password)).size!==list.length)throw Error('Render demo usernames and passwords must be distinct');
 return list;
}

// Called from security.config(); no side effects.
function check(env=process.env){
 if(env.DEMO_SYNTHETIC_ONLY!=='1')throw Error('Render demo requires DEMO_SYNTHETIC_ONLY=1');
 for(const flag of OUTBOUND)if(env[flag]!=='0')throw Error(`Render demo requires ${flag}=0`);
 const file=env.FITNESS_DB_PATH;
 if(!file||!path.isAbsolute(file)||path.extname(file)!=='.sqlite')throw Error('Render demo requires an absolute temporary FITNESS_DB_PATH ending in .sqlite');
 const resolved=path.resolve(file);
 if(resolved.startsWith(ROOT+path.sep))throw Error('Render demo database must be outside the repository');
 accounts(env);
}

// Before the DB is opened: start from an empty file. An existing file is removed only if it is a
// previous render demo database; anything else (e.g. a customer DB) is refused untouched.
function prepare(file){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 if(fs.existsSync(file)){
  let ours=false;
  try{const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(file,{readOnly:true});try{ours=d.prepare('SELECT value FROM demo_environment WHERE key=?').get('synthetic')?.value===MARK}finally{d.close()}}catch{}
  if(!ours)throw Error('Refusing to reset a database that is not a FORM CLUB render demo');
 }
 for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});
}

// After the synthetic sample data is in place: mark the DB and create the three role accounts.
function seed(db,hash,env=process.env){
 const list=accounts(env);
 const member=db.prepare('SELECT id FROM members ORDER BY id LIMIT 1').get()?.id,trainer=db.prepare('SELECT id FROM trainers ORDER BY id LIMIT 1').get()?.id;
 if(!member||!trainer)throw Error('Synthetic sample data missing');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE demo_environment(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  db.prepare('INSERT INTO demo_environment VALUES(?,?)').run('synthetic',MARK);
  const add=db.prepare('INSERT INTO users(username,password_hash,role,member_id,trainer_id) VALUES(?,?,?,?,?)');
  for(const a of list)add.run(a.username,hash(a.password),a.role,a.role==='member'?member:null,a.role==='teacher'?trainer:null);
  db.prepare('INSERT INTO announcements(title,body) VALUES(?,?)').run('DEMO ortamı','Bu demo yalnızca sentetik verilerle çalışır ve sunucu yeniden başladığında sıfırlanır. Gerçek üye, ödeme veya sağlık bilgisi girmeyin.');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
module.exports={check,prepare,seed,accounts,MARK,OUTBOUND};
