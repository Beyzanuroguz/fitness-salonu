'use strict';
// Offline provisioning. Supply password over stdin, never argv or logs.
const {randomBytes,scryptSync}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const file=process.env.FITNESS_DB_PATH,username=process.argv[2];
if(!file||!fs.existsSync(file)||!username||username.length>120)throw Error('Existing FITNESS_DB_PATH and username required');
const password=fs.readFileSync(0,'utf8').replace(/\r?\n$/,'');
if(password.length<14||password.length>256)throw Error('Password must be 14–256 characters');
const db=new DatabaseSync(file);
try{const salt=randomBytes(16).toString('hex');db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'admin')").run(username,salt+':'+scryptSync(password,salt,64).toString('hex'));console.log('Administrator created')}finally{db.close()}
