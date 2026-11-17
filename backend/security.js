'use strict';
const path = require('node:path');
const fs = require('node:fs');
const fail = (message,status=403) => { throw Object.assign(Error(message),{status}); };
function config(env=process.env) {
 const production=env.NODE_ENV==='production';
 const staging=env.APP_ENV==='staging';
 if(env.APP_ENV&&!['staging','production','development','test'].includes(env.APP_ENV))throw Error('Invalid APP_ENV');
 if(staging&&!production)throw Error('Staging must use production security');
 const port=Number(env.PORT||3001);
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid PORT');
 let origin;
 if(env.PUBLIC_ORIGIN){const u=new URL(env.PUBLIC_ORIGIN);if(u.origin!==env.PUBLIC_ORIGIN||u.username||u.password)throw Error('Invalid PUBLIC_ORIGIN');origin=u.origin;}
 if(production&&(!origin||!origin.startsWith('https://')||env.COOKIE_SECURE!=='1'||!env.FITNESS_DB_PATH||!path.isAbsolute(env.FITNESS_DB_PATH)||env.FITNESS_DB_PATH.includes('/public/')))throw Error('Production requires HTTPS PUBLIC_ORIGIN, COOKIE_SECURE=1 and absolute private FITNESS_DB_PATH');
 const publicDir=path.resolve(__dirname,'../public');
 if(env.FITNESS_DB_PATH){const resolved=fs.existsSync(env.FITNESS_DB_PATH)?fs.realpathSync(env.FITNESS_DB_PATH):path.resolve(env.FITNESS_DB_PATH);if(resolved===publicDir||resolved.startsWith(publicDir+path.sep))throw Error('Database must be outside public');}
 if(staging){
  if(!env.STAGING_DATA_DIR||!path.isAbsolute(env.STAGING_DATA_DIR))throw Error('Private STAGING_DATA_DIR required');
  const dir=fs.realpathSync(env.STAGING_DATA_DIR);
  const expected=path.join(dir,'staging.sqlite');
  if(path.resolve(env.FITNESS_DB_PATH)!==expected||!fs.existsSync(expected)||fs.realpathSync(expected)!==expected||fs.statSync(expected).nlink!==1)throw Error('Staging requires its own staging.sqlite');
  const marker=JSON.parse(fs.readFileSync(path.join(dir,'.formclub-staging.json'),'utf8'));
  if(marker.syntheticOnly!==true||marker.origin!==origin)throw Error('Invalid staging marker or origin');
 }
 return {production,staging,origin,port,secure:production||env.COOKIE_SECURE==='1',host:env.HOST||'127.0.0.1'};
}
function createLimiter({limit=20,windowMs=900000,maxKeys=10000,clock=Date.now}={}) {
 const entries=new Map();
 return key=>{const now=clock();for(const [k,v] of entries)if(v.until<=now)entries.delete(k);
  let entry=entries.get(key);if(!entry){if(entries.size>=maxKeys)fail('Çok fazla istek',429);entry={count:0,until:now+windowMs};entries.set(key,entry)}
  if(++entry.count>limit)fail('Çok fazla istek. Daha sonra tekrar deneyin.',429);
 };
}
function guard(req,cfg){
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))fail('Yöntem desteklenmiyor',405);
 if(req.method==='GET')return;
 if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'&&req.headers['sec-fetch-site']!=='none')fail('Geçersiz kaynak');
 const expected=cfg.origin||`http://${req.headers.host}`;
 if(req.headers.origin&&req.headers.origin!==expected)fail('Geçersiz kaynak');
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail('JSON gerekli',415);
}
function headers(res,cfg){
 res.setHeader('Cache-Control','no-store');
 if(cfg.staging)res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','SAMEORIGIN');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; worker-src 'self'");
 if(cfg.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
module.exports={config,createLimiter,guard,headers};
