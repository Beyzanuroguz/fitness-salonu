const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const ROOT = __dirname;
const DBFILE = path.join(ROOT, 'fitness.sqlite');
const db = new DatabaseSync(DBFILE);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT DEFAULT '',email TEXT DEFAULT '',plan TEXT NOT NULL DEFAULT 'Aylık + 8 Ders',expires TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 8,status TEXT NOT NULL DEFAULT 'Aktif',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS trainers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,specialty TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,trainer_id INTEGER NOT NULL,starts_at TEXT NOT NULL,duration INTEGER NOT NULL DEFAULT 50,capacity INTEGER NOT NULL DEFAULT 12,studio TEXT NOT NULL DEFAULT 'Stüdyo 1', FOREIGN KEY(trainer_id) REFERENCES trainers(id));
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,class_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(member_id,class_id),FOREIGN KEY(member_id) REFERENCES members(id),FOREIGN KEY(class_id) REFERENCES classes(id));
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,amount REAL NOT NULL,status TEXT NOT NULL DEFAULT 'Bekliyor',due_date TEXT NOT NULL,paid_at TEXT,FOREIGN KEY(member_id) REFERENCES members(id));
CREATE TABLE IF NOT EXISTS checkins(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(member_id) REFERENCES members(id));
CREATE TABLE IF NOT EXISTS measurements(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,measured_at TEXT NOT NULL,weight REAL,body_fat REAL,muscle REAL,FOREIGN KEY(member_id) REFERENCES members(id));
CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
function datePlus(days){const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function dateTimePlus(days,hour,minute=0){const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,minute,0,0);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`}
if(db.prepare('SELECT count(*) n FROM members').get().n===0){
  const insert=db.prepare('INSERT INTO members(name,phone,email,plan,expires,credits) VALUES(?,?,?,?,?,?)');
  [['Ayşe Yılmaz','05320000001','ayse@example.com','Aylık + 8 Ders',15,6],['Zeynep Kaya','05320000002','zeynep@example.com','Pilates 8 Ders',7,4],['Elif Şahin','05320000003','elif@example.com','Aylık Fitness',22,0],['Merve Arslan','05320000004','merve@example.com','Aylık + 8 Ders',3,8],['Burak Şen','05320000005','burak@example.com','Aylık Fitness',2,0],['Gizem Ak','05320000006','gizem@example.com','Pilates 8 Ders',5,3]].forEach(r=>insert.run(r[0],r[1],r[2],r[3],datePlus(r[4]),r[5]));
  const t=db.prepare('INSERT INTO trainers(name,specialty) VALUES(?,?)');[['Ece K.','Pilates Reformer'],['Mert A.','Spinning'],['Deniz T.','Fonksiyonel'],['Can B.','HIIT'],['Selim D.','Boks']].forEach(x=>t.run(...x));
  const c=db.prepare('INSERT INTO classes(title,trainer_id,starts_at,duration,capacity,studio) VALUES(?,?,?,?,?,?)');
  for(let day=0;day<7;day++) {[["Spinning",2,7,30,16,'Stüdyo 1'],['Fonksiyonel',3,12,15,12,'Stüdyo 1'],['Pilates Reformer',1,18,30,8,'Stüdyo 2'],['HIIT',4,19,30,20,'Stüdyo 1'],['Boks Kondisyon',5,20,30,14,'Stüdyo 3']].forEach(x=>c.run(x[0],x[1],dateTimePlus(day,x[2],x[3]),50,x[4],x[5]));}
  db.prepare('INSERT INTO bookings(member_id,class_id,status) VALUES(1,3,?)').run('reserved');
  [[1,850,'Ödendi',-4],[2,950,'Bekliyor',2],[3,1200,'Ödendi',-7],[4,850,'Bekliyor',1],[5,1100,'Bekliyor',-2],[6,950,'Ödendi',-5]].forEach(x=>db.prepare('INSERT INTO payments(member_id,amount,status,due_date,paid_at) VALUES(?,?,?,?,?)').run(x[0],x[1],x[2],datePlus(x[3]),x[2]==='Ödendi'?datePlus(x[3]):null));
  [[-90,68,28.3,25.3],[-60,66.1,26.9,25.8],[-30,65,25.2,26.1],[0,63.8,24.1,26.3]].forEach(x=>db.prepare('INSERT INTO measurements(member_id,measured_at,weight,body_fat,muscle) VALUES(1,?,?,?,?)').run(datePlus(x[0]),x[1],x[2],x[3]));
  db.prepare('INSERT INTO announcements(title,body) VALUES(?,?)').run('Açık hava antrenmanı','Cumartesi 09:00’da açık hava antrenmanına davetlisiniz!');
}
const q={members:()=>db.prepare('SELECT * FROM members ORDER BY id DESC').all(),trainers:()=>db.prepare('SELECT * FROM trainers').all(),classes:()=>db.prepare(`SELECT c.*,t.name trainer,(SELECT COUNT(*) FROM bookings b WHERE b.class_id=c.id AND b.status IN ('reserved','attended')) booked FROM classes c JOIN trainers t ON t.id=c.trainer_id WHERE c.starts_at >= datetime('now','localtime','-1 day') ORDER BY c.starts_at LIMIT 150`).all(),bookings:()=>db.prepare('SELECT b.*,m.name member,c.title class_title,c.starts_at FROM bookings b JOIN members m ON m.id=b.member_id JOIN classes c ON c.id=b.class_id ORDER BY b.id DESC').all(),payments:()=>db.prepare('SELECT p.*,m.name member FROM payments p JOIN members m ON m.id=p.member_id ORDER BY p.id DESC').all(),checkins:()=>db.prepare('SELECT i.*,m.name member FROM checkins i JOIN members m ON m.id=i.member_id ORDER BY i.id DESC LIMIT 100').all(),measurements:()=>db.prepare('SELECT * FROM measurements ORDER BY measured_at').all(),announcements:()=>db.prepare('SELECT * FROM announcements ORDER BY id DESC').all()};
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function log(action,details){db.prepare('INSERT INTO activity(action,details) VALUES(?,?)').run(action,details||'')}
function required(body,...keys){for(const k of keys) if(body[k]===undefined||body[k]===null||String(body[k]).trim()==='') throw new Error(`${k} zorunlu`)}
function api(method,pathname,body){
 if(method==='GET'&&pathname==='/api/state'){
 const members=q.members(),payments=q.payments(),classes=q.classes(),checkins=q.checkins();
 return {members,trainers:q.trainers(),classes,bookings:q.bookings(),payments,checkins,measurements:q.measurements(),announcements:q.announcements(),stats:{active:members.filter(x=>x.status==='Aktif').length,todayEntries:checkins.filter(x=>x.created_at.slice(0,10)===datePlus(0)).length,expiring:members.filter(x=>x.expires>=datePlus(0)&&x.expires<=datePlus(7)).length,pending:payments.filter(x=>x.status==='Bekliyor').reduce((s,x)=>s+x.amount,0)}};
 }
 if(method==='POST'&&pathname==='/api/members') {required(body,'name','expires');const r=db.prepare('INSERT INTO members(name,phone,email,plan,expires,credits,status) VALUES(?,?,?,?,?,?,?)').run(body.name,String(body.phone||''),String(body.email||''),body.plan||'Aylık + 8 Ders',body.expires,Number(body.credits??8),'Aktif');log('Yeni üye',body.name);return {id:Number(r.lastInsertRowid)}}
 if(method==='PATCH'&&/^\/api\/members\/\d+$/.test(pathname)){let id=Number(pathname.split('/').pop());const allowed=['name','phone','email','plan','expires','credits','status'];const fields=Object.keys(body).filter(k=>allowed.includes(k));if(!fields.length)throw new Error('Değiştirilecek alan yok');db.prepare(`UPDATE members SET ${fields.map(k=>k+'=?').join(',')} WHERE id=?`).run(...fields.map(k=>body[k]),id);return {ok:true}}
 if(method==='POST'&&pathname==='/api/classes'){required(body,'title','trainer_id','starts_at');const r=db.prepare('INSERT INTO classes(title,trainer_id,starts_at,duration,capacity,studio) VALUES(?,?,?,?,?,?)').run(body.title,Number(body.trainer_id),body.starts_at,Number(body.duration||50),Number(body.capacity||12),body.studio||'Stüdyo 1');log('Yeni ders',body.title);return {id:Number(r.lastInsertRowid)}}
 if(method==='POST'&&pathname==='/api/bookings'){
  required(body,'member_id','class_id');
  db.exec('BEGIN IMMEDIATE');
  try {
   const m=db.prepare('SELECT * FROM members WHERE id=?').get(Number(body.member_id));
   const c=db.prepare('SELECT * FROM classes WHERE id=?').get(Number(body.class_id));
   if(!m||!c)throw new Error('Üye veya ders bulunamadı');
   if(m.status!=='Aktif'||m.expires<datePlus(0))throw new Error('Üyelik aktif değil');
   if(m.credits<=0)throw new Error('Ders hakkı kalmadı');
   const existing=db.prepare('SELECT * FROM bookings WHERE member_id=? AND class_id=?').get(m.id,c.id);
   if(existing&&existing.status!=='cancelled')throw new Error('Bu derse zaten kayıtlısınız');
   const count=db.prepare("SELECT count(*) n FROM bookings WHERE class_id=? AND status IN ('reserved','attended')").get(c.id).n;
   const status=count>=c.capacity?'waitlist':'reserved';
   if(existing)db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,existing.id);
   else db.prepare('INSERT INTO bookings(member_id,class_id,status) VALUES(?,?,?)').run(m.id,c.id,status);
   log('Rezervasyon',`${m.name} - ${c.title} (${status})`);
   db.exec('COMMIT');return {status};
  } catch(e){db.exec('ROLLBACK');throw e}
 }
 if(method==='POST'&&/^\/api\/bookings\/\d+\/cancel$/.test(pathname)){
  const id=Number(pathname.split('/')[3]);
  db.exec('BEGIN IMMEDIATE');
  try {
   const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
   if(!b||!['reserved','waitlist','absent'].includes(b.status))throw new Error('Rezervasyon iptal edilemiyor');
   db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(id);
   if(b.status==='reserved'){
    const next=db.prepare("SELECT b.id FROM bookings b JOIN members m ON m.id=b.member_id WHERE b.class_id=? AND b.status='waitlist' AND m.status='Aktif' AND m.expires>=? AND m.credits>0 ORDER BY b.id LIMIT 1").get(b.class_id,datePlus(0));
    if(next)db.prepare("UPDATE bookings SET status='reserved' WHERE id=?").run(next.id);
   }
   log('Rezervasyon iptali',String(id));
   db.exec('COMMIT');return {ok:true};
  } catch(e){db.exec('ROLLBACK');throw e}
 }
 if(method==='POST'&&/^\/api\/bookings\/\d+\/attendance$/.test(pathname)){
  const id=Number(pathname.split('/')[3]);
  if(typeof body.present!=='boolean')throw new Error('present true/false olmalı');
  db.exec('BEGIN IMMEDIATE');
  try {
   const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
   if(!b)throw new Error('Rezervasyon bulunamadı');
   if(b.status==='cancelled'||b.status==='waitlist')throw new Error('Rezervasyon yoklamaya uygun değil');
   const status=body.present?'attended':'absent';
   if(b.status==='attended'&&status!=='attended')throw new Error('İşlenmiş yoklama değiştirilemez');
   if(b.status!=='attended'&&status==='attended'){
    const updated=db.prepare('UPDATE members SET credits=credits-1 WHERE id=? AND credits>0').run(b.member_id);
    if(updated.changes!==1)throw new Error('Üyenin ders hakkı yok');
   }
   db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,id);
   log('Yoklama',`${b.member_id} → ${status}`);
   db.exec('COMMIT');return {status};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 if(method==='POST'&&pathname==='/api/checkins'){required(body,'member_id');const m=db.prepare('SELECT * FROM members WHERE id=?').get(Number(body.member_id));if(!m||m.status!=='Aktif'||m.expires<datePlus(0))throw new Error('Aktif üyelik bulunamadı');db.prepare('INSERT INTO checkins(member_id) VALUES(?)').run(m.id);log('QR giriş',m.name);return {ok:true}}
 if(method==='POST'&&pathname==='/api/payments'){required(body,'member_id','amount','due_date');const r=db.prepare('INSERT INTO payments(member_id,amount,status,due_date) VALUES(?,?,?,?)').run(Number(body.member_id),Number(body.amount),'Bekliyor',body.due_date);return {id:Number(r.lastInsertRowid)}}
 if(method==='POST'&&/^\/api\/payments\/\d+\/pay$/.test(pathname)){const id=Number(pathname.split('/')[3]);db.prepare("UPDATE payments SET status='Ödendi',paid_at=? WHERE id=?").run(datePlus(0),id);log('Ödeme alındı',String(id));return {ok:true}}
 if(method==='POST'&&pathname==='/api/measurements'){required(body,'member_id','measured_at');db.prepare('INSERT INTO measurements(member_id,measured_at,weight,body_fat,muscle) VALUES(?,?,?,?,?)').run(Number(body.member_id),body.measured_at,Number(body.weight||0),Number(body.body_fat||0),Number(body.muscle||0));return {ok:true}}
 if(method==='POST'&&pathname==='/api/announcements'){required(body,'title','body');db.prepare('INSERT INTO announcements(title,body) VALUES(?,?)').run(body.title,body.body);return {ok:true}}
 throw new Error('Endpoint bulunamadı');
}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{try {const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){let body={};if(req.method!=='GET'){let chunks=[];for await(const ch of req){chunks.push(ch);if(Buffer.concat(chunks).length>1024*1024)throw new Error('İstek fazla büyük')}body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}return send(res,200,api(req.method,url.pathname,body));}const file=path.join(ROOT,'public',url.pathname==='/'?'index.html':url.pathname);if(!file.startsWith(path.join(ROOT,'public')+path.sep))return send(res,403,{error:'Yasak'});const stat=fs.statSync(file);if(!stat.isFile())throw Error('Bulunamadı');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);}catch(e){if(req.url.startsWith('/api/'))send(res,400,{error:e.message});else{res.writeHead(404);res.end('Bulunamadı')}}});
const PORT=Number(process.env.PORT||3000);server.listen(PORT,()=>console.log(`\n✅ FORM CLUB hazır: http://localhost:${PORT}\n📁 Veritabanı: ${DBFILE}\n`));
