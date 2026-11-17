'use strict';
// Creates a NEW synthetic environment. No source DB, import, copy, or overwrite option.
const fs=require('node:fs');const path=require('node:path');
function prepare(env=process.env){
 if(env.APP_ENV!=='staging'||env.NODE_ENV!=='production'||env.COOKIE_SECURE!=='1')throw Error('Staging production-security environment required');
 if(!env.STAGING_DATA_DIR||!path.isAbsolute(env.STAGING_DATA_DIR))throw Error('Absolute STAGING_DATA_DIR required');
 const origin=new URL(env.PUBLIC_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN)throw Error('Exact HTTPS origin required');
 const dir=path.resolve(env.STAGING_DATA_DIR);
 if(path.resolve(env.FITNESS_DB_PATH||'')!==path.join(dir,'staging.sqlite'))throw Error('FITNESS_DB_PATH must be STAGING_DATA_DIR/staging.sqlite');
 const root=path.resolve(__dirname,'..');if(dir===root||dir.startsWith(root+path.sep))throw Error('Staging data must be outside repository');
 // mkdir without recursive or overwrite refuses all pre-existing locations.
 fs.mkdirSync(dir,{mode:0o700});
 if(fs.realpathSync(dir)!==dir)throw Error('Staging path must not contain symlinks');
 fs.writeFileSync(path.join(dir,'.formclub-staging.json'),JSON.stringify({syntheticOnly:true,origin:origin.origin})+'\n',{flag:'wx',mode:0o600});
 fs.closeSync(fs.openSync(env.FITNESS_DB_PATH,'wx',0o600));
 Object.assign(process.env,env);
 const {db}=require('../server');
 try{
  db.exec('BEGIN IMMEDIATE');
  const trainer=db.prepare('INSERT INTO trainers(name,specialty) VALUES(?,?)').run('STAGING Eğitmen','Sentetik test');
  db.prepare('INSERT INTO members(name,phone,email,plan,expires,credits) VALUES(?,?,?,?,?,?)').run('STAGING Üye','','synthetic@example.invalid','STAGING test','2099-12-31',8);
  db.prepare('INSERT INTO classes(title,trainer_id,starts_at,capacity) VALUES(?,?,?,?)').run('STAGING Dersi',Number(trainer.lastInsertRowid),'2099-01-01T12:00:00',10);
  db.exec('COMMIT');
 }finally{db.close()}
}
module.exports={prepare};
if(require.main===module){try{prepare();console.log('Synthetic staging created. Provision separate test accounts locally.')}catch{console.error('Staging preparation refused. Use a NEW private directory and matching staging configuration.');process.exitCode=1}}
