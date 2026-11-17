'use strict';
// Online SQLite backup includes committed WAL pages; never copy a live .sqlite alone.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
async function snapshot(source,destination,{restore=false}={}){
 source=path.resolve(source);destination=path.resolve(destination);
 if(source===destination||!fs.statSync(source).isFile())throw Error('A regular source and different destination are required');
 for(const suffix of ['', '-wal','-shm'])if(fs.existsSync(destination+suffix))throw Error('Destination must be new, without WAL/SHM');
 const parent=path.dirname(destination);
 const temp=fs.mkdtempSync(path.join(parent,'.formclub-backup-'));fs.chmodSync(temp,0o700);
 const staged=path.join(temp,'snapshot.sqlite');
 let db;
 try{
  db=new DatabaseSync(source,{readOnly:true});
  await backup(db,staged);db.close();db=null;
  const check=new DatabaseSync(staged);
  try{
   if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database validation failed');
   if(restore){check.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    // Invalidate restored sessions and QR tokens to avoid reviving old logins.
    if(check.prepare("SELECT 1 FROM sqlite_master WHERE name='v9_qr_tokens'").get())check.exec('DELETE FROM v9_qr_tokens');
    if(check.prepare("SELECT 1 FROM sqlite_master WHERE name='sessions'").get())check.exec('DELETE FROM sessions');
    check.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
   }
   check.exec('PRAGMA journal_mode=DELETE');
  }finally{check.close()}
  fs.chmodSync(staged,0o600);
  const fd=fs.openSync(staged,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  // link is atomic and refuses overwrite, including symlinks created concurrently.
  fs.linkSync(staged,destination);
  const dir=fs.openSync(parent,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
  return destination;
 }finally{db?.close();fs.rmSync(temp,{recursive:true,force:true})}
}
module.exports={snapshot};
if(require.main===module){const [mode,source,destination]=process.argv.slice(2);if(!['backup','restore'].includes(mode)||!source||!destination){console.error('Usage: node scripts/database.js backup|restore SOURCE NEW_DESTINATION');process.exitCode=1}else snapshot(source,destination,{restore:mode==='restore'}).then(()=>console.log('Database snapshot verified')).catch(()=>{console.error('Database operation failed; destination must be new and source valid');process.exitCode=1})}
