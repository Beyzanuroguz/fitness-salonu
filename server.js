const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const ROOT = __dirname;
const security = require('./backend/security');
const config = security.config();
process.umask(0o077);
const DBFILE = process.env.FITNESS_DB_PATH || path.join(ROOT, 'fitness.sqlite');
if (process.env.NODE_ENV === 'test' && (!process.env.FITNESS_DB_PATH || path.resolve(DBFILE) === path.join(ROOT, 'fitness.sqlite'))) throw Error('Testler ayrı FITNESS_DB_PATH gerektirir');
const db = new DatabaseSync(DBFILE);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT DEFAULT '',email TEXT DEFAULT '',plan TEXT NOT NULL DEFAULT 'Aylık + 8 Ders',expires TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 8,status TEXT NOT NULL DEFAULT 'Aktif',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS trainers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,specialty TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,trainer_id INTEGER NOT NULL,starts_at TEXT NOT NULL,duration INTEGER NOT NULL DEFAULT 50,capacity INTEGER NOT NULL DEFAULT 12,studio TEXT NOT NULL DEFAULT 'Stüdyo 1', FOREIGN KEY(trainer_id) REFERENCES trainers(id));
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,class_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(member_id,class_id),FOREIGN KEY(member_id) REFERENCES members(id),FOREIGN KEY(class_id) REFERENCES classes(id));
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,amount REAL NOT NULL,status TEXT NOT NULL DEFAULT 'Bekliyor',due_date TEXT NOT NULL,paid_at TEXT,FOREIGN KEY(member_id) REFERENCES members(id));
CREATE TABLE IF NOT EXISTS checkins(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(member_id) REFERENCES members(id));
CREATE TABLE IF NOT EXISTS measurements(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,measured_at TEXT NOT NULL,weight REAL,body_fat REAL,muscle REAL,FOREIGN KEY(member_id) REFERENCES members(id));
CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
// V5: CRM leads and member notes. Only new tables are created; existing records stay intact.
db.exec(`CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT DEFAULT '',interest TEXT DEFAULT '',stage TEXT NOT NULL DEFAULT 'Yeni' CHECK(stage IN ('Yeni','Arandı','Deneme Dersi','Üyeye Dönüştü','Kaybedildi')),note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS member_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(member_id) REFERENCES members(id));`);
// V6: additive schema. Never overwrite existing records.
db.exec(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS food_products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,kcal_100g REAL NOT NULL,protein_100g REAL NOT NULL DEFAULT 0,carbs_100g REAL NOT NULL DEFAULT 0,fat_100g REAL NOT NULL DEFAULT 0,created_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS food_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,product_id INTEGER NOT NULL,grams REAL NOT NULL,consumed_on TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(member_id) REFERENCES members(id),FOREIGN KEY(product_id) REFERENCES food_products(id));
CREATE TABLE IF NOT EXISTS community_posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS community_comments(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id));`);
db.prepare('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)').run('booking_window_days','90');
db.prepare('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)').run('community_post_roles','admin,teacher,member');
db.prepare('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)').run('community_comment_roles','admin,teacher,member');
const setting=k=>db.prepare('SELECT value FROM app_settings WHERE key=?').get(k)?.value;
const canRole=(key,role)=>setting(key).split(',').includes(role);
const isoDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x||''))&&!Number.isNaN(Date.parse(x));
const ensureNumber=(x,max=100000)=>{const n=Number(x);if(!Number.isFinite(n)||n<0||n>max)throw Error('Geçersiz sayısal değer');return n};
// V3: account authentication / hashed sessions. Existing business tables remain unchanged.
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','teacher','member')),member_id INTEGER,trainer_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));`);
function pwHash(p,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(p,salt,64).toString('hex')}
function pwVerify(p,stored){try{const [salt,hash]=stored.split(':');return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(p,salt,64))}catch{return false}}
function credentials(body){if(typeof body.username!=='string'||body.username.trim().length<1||body.username.length>120||typeof body.password!=='string'||body.password.length>256)throw Error('Geçersiz kullanıcı bilgileri')}
const digest=t=>createHash('sha256').update(t).digest('hex');
const roles=['admin','teacher','member'];
function authUser(req){const tok=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fc_session='))?.slice(11);if(!tok)return null;const u=db.prepare('SELECT u.id,u.username,u.role,u.member_id,u.trainer_id,s.expires_at,s.id_hash session_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?').get(digest(tok));if(!u||u.expires_at<=Date.now())return null;return u}
function setSession(res,userId,req){const old=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fc_session='))?.slice(11);if(old)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest(old));const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());db.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),userId,Date.now()+12*3600000);res.setHeader('Set-Cookie',`fc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.secure?'; Secure':''}`)}
function getProfile(u){return u?{id:u.id,username:u.username,role:u.role,member_id:u.member_id,trainer_id:u.trainer_id}:null}
function assertAllowed(u,condition){if(!condition){const e=Error('Bu işlem için yetkiniz yok');e.status=403;throw e}}
function userScope(u,state){if(u.role==='admin')return state;if(u.role==='member'){state.members=state.members.filter(x=>x.id===u.member_id);state.bookings=state.bookings.filter(x=>x.member_id===u.member_id);state.measurements=state.measurements.filter(x=>x.member_id===u.member_id);state.checkins=state.checkins.filter(x=>x.member_id===u.member_id);state.payments=state.payments.filter(x=>x.member_id===u.member_id);state.trainers=[];state.stats={};}else{const ids=new Set(state.classes.filter(x=>x.trainer_id===u.trainer_id).map(x=>x.id));state.classes=state.classes.filter(x=>ids.has(x.id));state.bookings=state.bookings.filter(x=>ids.has(x.class_id));const members=new Set(state.bookings.map(x=>x.member_id));state.members=state.members.filter(x=>members.has(x.id)).map(x=>({id:x.id,name:x.name,credits:x.credits,plan:x.plan}));state.trainers=state.trainers.filter(x=>x.id===u.trainer_id);state.payments=[];state.checkins=[];state.measurements=[];state.stats={};}return state}
function datePlus(days){const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function dateTimePlus(days,hour,minute=0){const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,minute,0,0);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`}
if(!config.production && db.prepare('SELECT count(*) n FROM members').get().n===0){
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
const q={members:()=>db.prepare('SELECT * FROM members ORDER BY id DESC').all(),trainers:()=>db.prepare('SELECT * FROM trainers').all(),classes:()=>db.prepare(`SELECT c.*,t.name trainer,(SELECT COUNT(*) FROM bookings b WHERE b.class_id=c.id AND b.status IN ('reserved','attended')) booked FROM classes c JOIN trainers t ON t.id=c.trainer_id WHERE c.starts_at>=datetime('now','localtime','-30 days') ORDER BY c.starts_at LIMIT 10000`).all(),bookings:()=>db.prepare('SELECT b.*,m.name member,c.title class_title,c.starts_at FROM bookings b JOIN members m ON m.id=b.member_id JOIN classes c ON c.id=b.class_id ORDER BY b.id DESC').all(),payments:()=>db.prepare('SELECT p.*,m.name member FROM payments p JOIN members m ON m.id=p.member_id ORDER BY p.id DESC').all(),checkins:()=>db.prepare('SELECT i.*,m.name member FROM checkins i JOIN members m ON m.id=i.member_id ORDER BY i.id DESC LIMIT 100').all(),measurements:()=>db.prepare('SELECT * FROM measurements ORDER BY measured_at').all(),announcements:()=>db.prepare('SELECT * FROM announcements ORDER BY id DESC').all()};
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function log(action){db.prepare('INSERT INTO activity(action,details) VALUES(?,?)').run(action,'')}
function required(body,...keys){for(const k of keys) if(body[k]===undefined||body[k]===null||String(body[k]).trim()==='') throw new Error(`${k} zorunlu`)}
function api(method,pathname,body,u){
 if(method==='GET'&&pathname==='/api/me')return {user:getProfile(u),setup:!config.production&&db.prepare('SELECT COUNT(*) n FROM users').get().n===0};
 if(pathname==='/api/leads'&&method==='GET'){assertAllowed(u,u?.role==='admin');return db.prepare('SELECT * FROM leads ORDER BY updated_at DESC,id DESC').all()}
 if(pathname==='/api/leads'&&method==='POST'){assertAllowed(u,u?.role==='admin');required(body,'name');const name=String(body.name).trim(), phone=String(body.phone||'').trim(),interest=String(body.interest||'').trim(),note=String(body.note||'').trim();if(name.length<2||name.length>120||phone.length>40||interest.length>140||note.length>1500)throw Error('Müşteri adayı bilgilerini kontrol edin');const r=db.prepare('INSERT INTO leads(name,phone,interest,note) VALUES(?,?,?,?)').run(name,phone,interest,note);log('Yeni müşteri adayı',name);return {id:Number(r.lastInsertRowid)}}
 if(/^\/api\/leads\/\d+$/.test(pathname)&&method==='PATCH'){assertAllowed(u,u?.role==='admin');const id=Number(pathname.split('/').pop()), stage=String(body.stage||'');if(!['Yeni','Arandı','Deneme Dersi','Üyeye Dönüştü','Kaybedildi'].includes(stage))throw Error('Geçersiz aşama');if(db.prepare("UPDATE leads SET stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(stage,id).changes!==1)throw Error('Kayıt bulunamadı');return {ok:true}}
 if(/^\/api\/members\/\d+\/notes$/.test(pathname)&&method==='GET'){assertAllowed(u,u?.role==='admin');return db.prepare('SELECT id,note,created_at FROM member_notes WHERE member_id=? ORDER BY id DESC LIMIT 100').all(Number(pathname.split('/')[3]))}
 if(/^\/api\/members\/\d+\/notes$/.test(pathname)&&method==='POST'){assertAllowed(u,u?.role==='admin');const id=Number(pathname.split('/')[3]),note=String(body.note||'').trim();if(!db.prepare('SELECT id FROM members WHERE id=?').get(id))throw Error('Üye bulunamadı');if(!note||note.length>1000)throw Error('Not 1-1000 karakter olmalı');db.prepare('INSERT INTO member_notes(member_id,note) VALUES(?,?)').run(id,note);return {ok:true}}
 if(/^\/api\/members\/\d+\/renew$/.test(pathname)&&method==='POST'){assertAllowed(u,u?.role==='admin');const id=Number(pathname.split('/')[3]),credits=Number(body.credits),expires=String(body.expires||'');if(!Number.isInteger(credits)||credits<0||credits>1000||!/^\d{4}-\d{2}-\d{2}$/.test(expires)||expires<datePlus(0))throw Error('Tarih veya hak sayısı geçersiz');const m=db.prepare('SELECT id FROM members WHERE id=?').get(id);if(!m)throw Error('Üye bulunamadı');db.prepare("UPDATE members SET credits=?,expires=?,status='Aktif' WHERE id=?").run(credits,expires,id);log('Üyelik yenilendi',String(id));return {ok:true}}
 if(method==='GET'&&pathname==='/api/users'){assertAllowed(u,u?.role==='admin');return db.prepare('SELECT id,username,role,member_id,trainer_id FROM users ORDER BY id DESC').all()}
 if(method==='POST'&&pathname==='/api/users'){assertAllowed(u,u?.role==='admin');credentials(body);required(body,'username','password','role');if(!roles.includes(body.role)||String(body.password).length<10)throw Error('Geçerli rol ve en az 10 karakter şifre gerekli');const mid=body.role==='member'?Number(body.member_id):null,tid=body.role==='teacher'?Number(body.trainer_id):null;if(body.role==='member'&&!db.prepare('SELECT id FROM members WHERE id=?').get(mid))throw Error('Üye bulunamadı');if(body.role==='teacher'&&!db.prepare('SELECT id FROM trainers WHERE id=?').get(tid))throw Error('Eğitmen bulunamadı');const r=db.prepare('INSERT INTO users(username,password_hash,role,member_id,trainer_id) VALUES(?,?,?,?,?)').run(String(body.username).trim(),pwHash(body.password),body.role,mid,tid);return {id:Number(r.lastInsertRowid)}}
 // V6: reports, configurable planning, nutrition and community.
 if(method==='GET'&&pathname==='/api/v6/settings'){assertAllowed(u,!!u);return {booking_window_days:Number(setting('booking_window_days')),community_post_roles:setting('community_post_roles').split(','),community_comment_roles:setting('community_comment_roles').split(',')}}
 if(method==='PATCH'&&pathname==='/api/v6/settings'){
  assertAllowed(u,u?.role==='admin');const days=Number(body.booking_window_days);if(!Number.isInteger(days)||days<1||days>365)throw Error('Rezervasyon aralığı 1-365 gün olmalı');
  for(const k of ['community_post_roles','community_comment_roles'])if(!Array.isArray(body[k])||body[k].some(x=>!roles.includes(x)))throw Error('Geçersiz topluluk rolü');
  db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(String(days),'booking_window_days');
  for(const k of ['community_post_roles','community_comment_roles'])db.prepare('UPDATE app_settings SET value=? WHERE key=?').run([...new Set(body[k])].join(','),k);
  return {ok:true};
 }
 if(method==='GET'&&pathname==='/api/v6/analytics'){
  assertAllowed(u,u?.role==='admin');
  const payments=db.prepare("SELECT substr(COALESCE(paid_at,due_date),1,7) month, SUM(CASE WHEN status='Ödendi' THEN amount ELSE 0 END) collected, SUM(CASE WHEN status='Bekliyor' THEN amount ELSE 0 END) pending FROM payments GROUP BY month ORDER BY month").all();
  const attendance=db.prepare("SELECT substr(c.starts_at,1,7) month, SUM(CASE WHEN b.status='attended' THEN 1 ELSE 0 END) attended, SUM(CASE WHEN b.status IN ('attended','absent') THEN 1 ELSE 0 END) marked FROM bookings b JOIN classes c ON c.id=b.class_id GROUP BY month ORDER BY month").all();
  const monthly=[...new Set([...payments,...attendance].map(x=>x.month))].sort().map(month=>({month, collected:payments.find(x=>x.month===month)?.collected||0,pending:payments.find(x=>x.month===month)?.pending||0,attended:attendance.find(x=>x.month===month)?.attended||0,marked:attendance.find(x=>x.month===month)?.marked||0}));
  const scores=db.prepare("SELECT m.id,m.name,COUNT(DISTINCT CASE WHEN b.status IN ('attended','absent') THEN b.id END) marked, COUNT(DISTINCT CASE WHEN b.status='attended' THEN b.id END) attended,(SELECT COUNT(*) FROM payments p WHERE p.member_id=m.id) payment_total,(SELECT COUNT(*) FROM payments p WHERE p.member_id=m.id AND p.status='Ödendi' AND (p.paid_at IS NULL OR p.paid_at<=p.due_date) ) on_time FROM members m LEFT JOIN bookings b ON b.member_id=m.id GROUP BY m.id ORDER BY m.name").all().map(x=>({...x,attendance_score:x.marked?Math.round(100*x.attended/x.marked):null,payment_score:x.payment_total?Math.round(100*x.on_time/x.payment_total):null}));
  return {monthly,scores};
 }
 if(method==='POST'&&pathname==='/api/v6/classes/repeat'){
  assertAllowed(u,u?.role==='admin');const original=db.prepare('SELECT * FROM classes WHERE id=?').get(Number(body.class_id));if(!original)throw Error('Ders bulunamadı');
  const weeks=Number(body.weeks);if(!Number.isInteger(weeks)||weeks<1||weeks>52)throw Error('1-52 hafta seçin');
  const insert=db.prepare('INSERT INTO classes(title,trainer_id,starts_at,duration,capacity,studio) VALUES(?,?,?,?,?,?)');let count=0;
  db.exec('BEGIN IMMEDIATE');try{for(let i=1;i<=weeks;i++){const dt=new Date(original.starts_at);dt.setDate(dt.getDate()+i*7);const start=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}T${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:00`;if(!db.prepare('SELECT id FROM classes WHERE trainer_id=? AND starts_at=? AND title=?').get(original.trainer_id,start,original.title)){insert.run(original.title,original.trainer_id,start,original.duration,original.capacity,original.studio);count++}}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return {created:count};
 }
 if(method==='GET'&&pathname==='/api/v6/foods'){
  assertAllowed(u,!!u);return db.prepare('SELECT id,name,kcal_100g,protein_100g,carbs_100g,fat_100g,created_by FROM food_products ORDER BY name COLLATE NOCASE').all();
 }
 if(method==='POST'&&pathname==='/api/v6/foods'){
  assertAllowed(u,!!u);const name=String(body.name||'').trim();if(name.length<2||name.length>100)throw Error('Ürün adı 2-100 karakter olmalı');
  const r=db.prepare('INSERT INTO food_products(name,kcal_100g,protein_100g,carbs_100g,fat_100g,created_by) VALUES(?,?,?,?,?,?)').run(name,ensureNumber(body.kcal_100g,1000),ensureNumber(body.protein_100g||0,100),ensureNumber(body.carbs_100g||0,100),ensureNumber(body.fat_100g||0,100),u.id);return {id:Number(r.lastInsertRowid)};
 }
 if(method==='GET'&&pathname==='/api/v6/food-logs'){
  assertAllowed(u,!!u);const id=u.role==='member'?u.member_id:Number(body.member_id);if(u.role==='teacher')throw Error('Beslenme günlüğüne erişim yetkiniz yok');if(!id||!Number.isInteger(id))return [];
  return db.prepare('SELECT l.*,f.name,f.kcal_100g,f.protein_100g,f.carbs_100g,f.fat_100g FROM food_logs l JOIN food_products f ON f.id=l.product_id WHERE l.member_id=? ORDER BY consumed_on DESC,l.id DESC LIMIT 250').all(id);
 }
 if(method==='POST'&&pathname==='/api/v6/food-logs'){
  assertAllowed(u,!!u&&u.role!=='teacher');const id=u.role==='member'?u.member_id:Number(body.member_id);if(!id||!db.prepare('SELECT id FROM members WHERE id=?').get(id))throw Error('Üye bulunamadı');if(u.role==='member'&&body.member_id&&Number(body.member_id)!==id)throw Error('Yalnızca kendi günlüğüne ekleyebilirsiniz');
  const prod=db.prepare('SELECT id FROM food_products WHERE id=?').get(Number(body.product_id));if(!prod)throw Error('Besin bulunamadı');const grams=ensureNumber(body.grams,5000);if(!grams)throw Error('Gram 0 olamaz');if(!isoDate(body.consumed_on))throw Error('Geçersiz tarih');const r=db.prepare('INSERT INTO food_logs(member_id,product_id,grams,consumed_on) VALUES(?,?,?,?)').run(id,prod.id,grams,body.consumed_on);return {id:Number(r.lastInsertRowid)};
 }
 if(method==='DELETE'&&/^\/api\/v6\/food-logs\/\d+$/.test(pathname)){
  assertAllowed(u,!!u&&u.role!=='teacher');const id=Number(pathname.split('/').pop());const row=db.prepare('SELECT member_id FROM food_logs WHERE id=?').get(id);if(!row)throw Error('Kayıt yok');assertAllowed(u,u.role==='admin'||row.member_id===u.member_id);db.prepare('DELETE FROM food_logs WHERE id=?').run(id);return {ok:true};
 }
 if(method==='GET'&&pathname==='/api/v6/community'){
  assertAllowed(u,!!u);return db.prepare('SELECT p.id,p.user_id,p.body,p.created_at,u.username,u.role FROM community_posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 100').all().map(p=>({...p,comments:db.prepare('SELECT c.id,c.user_id,c.body,c.created_at,u.username FROM community_comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id').all(p.id)}));
 }
 if(method==='POST'&&pathname==='/api/v6/community'){
  assertAllowed(u,!!u&&canRole('community_post_roles',u.role));const bodyText=String(body.text||'').trim();if(!bodyText||bodyText.length>2000)throw Error('Paylaşım 1-2000 karakter olmalı');const r=db.prepare('INSERT INTO community_posts(user_id,body) VALUES(?,?)').run(u.id,bodyText);return {id:Number(r.lastInsertRowid)};
 }
 if(method==='POST'&&/^\/api\/v6\/community\/\d+\/comments$/.test(pathname)){
  assertAllowed(u,!!u&&canRole('community_comment_roles',u.role));const postId=Number(pathname.split('/')[4]);if(!db.prepare('SELECT id FROM community_posts WHERE id=?').get(postId))throw Error('Paylaşım bulunamadı');const t=String(body.text||'').trim();if(!t||t.length>500)throw Error('Yorum 1-500 karakter olmalı');const r=db.prepare('INSERT INTO community_comments(post_id,user_id,body) VALUES(?,?,?)').run(postId,u.id,t);return {id:Number(r.lastInsertRowid)};
 }
 if(method==='DELETE'&&/^\/api\/v6\/community\/\d+$/.test(pathname)){
  const postId=Number(pathname.split('/')[4]);const p=db.prepare('SELECT user_id FROM community_posts WHERE id=?').get(postId);if(!p)throw Error('Paylaşım bulunamadı');assertAllowed(u,!!u&&(u.role==='admin'||p.user_id===u.id));db.prepare('DELETE FROM community_comments WHERE post_id=?').run(postId);db.prepare('DELETE FROM community_posts WHERE id=?').run(postId);return {ok:true};
 }
 if(method==='DELETE'&&/^\/api\/v6\/comments\/\d+$/.test(pathname)){
  const id=Number(pathname.split('/').pop());const c=db.prepare('SELECT user_id FROM community_comments WHERE id=?').get(id);if(!c)throw Error('Yorum bulunamadı');assertAllowed(u,!!u&&(u.role==='admin'||c.user_id===u.id));db.prepare('DELETE FROM community_comments WHERE id=?').run(id);return {ok:true};
 }
 assertAllowed(u,!!u);
 const admin=u.role==='admin';
 const mineMember=id=>admin||(u.role==='member'&&Number(id)===u.member_id);
 const mineTrainerClass=id=>admin||(u.role==='teacher'&&!!db.prepare('SELECT id FROM classes WHERE id=? AND trainer_id=?').get(Number(id),u.trainer_id));
 if(method==='POST'&&pathname==='/api/teacher/students'){
  assertAllowed(u,u.role==='teacher');
  required(body,'name','class_id');
  const classId=Number(body.class_id), credits=Number(body.credits??8);
  const clas=db.prepare('SELECT * FROM classes WHERE id=? AND trainer_id=?').get(classId,u.trainer_id);
  if(!clas)throw Error('Ders size ait değil');
  if(!Number.isInteger(credits)||credits<1||credits>1000)throw Error('Ders hakkı 1-1000 arasında olmalı');
  const phone=String(body.phone||'').trim(),name=String(body.name).trim();
  if(name.length<2||name.length>120)throw Error('Geçerli öğrenci adı girin');
  const expires=String(body.expires||datePlus(30));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(expires)||expires<datePlus(0))throw Error('Geçerli ileri tarihli bitiş tarihi girin');
  db.exec('BEGIN IMMEDIATE');
  try{
   if(phone&&db.prepare('SELECT id FROM members WHERE phone=?').get(phone))throw Error('Bu telefon numarasıyla kayıtlı üye var. Yöneticiyle iletişime geçin');
   const r=db.prepare('INSERT INTO members(name,phone,email,plan,expires,credits,status) VALUES(?,?,?,?,?,?,?)').run(name,phone,'','Pilates 8 Ders',expires,credits,'Aktif');
   const id=Number(r.lastInsertRowid);
   const filled=db.prepare("SELECT count(*) n FROM bookings WHERE class_id=? AND status IN ('reserved','attended')").get(classId).n;
   const status=filled>=clas.capacity?'waitlist':'reserved';
   db.prepare('INSERT INTO bookings(member_id,class_id,status) VALUES(?,?,?)').run(id,classId,status);
   log('Eğitmen öğrenci ekledi',`${u.username} - ${name} - ${clas.title}`);
   db.exec('COMMIT');return {id,status};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 if(method!=='GET'){if(pathname==='/api/bookings'||pathname==='/api/checkins'||pathname==='/api/measurements')assertAllowed(u,mineMember(body.member_id));else if(/^\/api\/bookings\/\d+\/(cancel|attendance)$/.test(pathname)){const bid=Number(pathname.split('/')[3]),booking=db.prepare('SELECT * FROM bookings WHERE id=?').get(bid);assertAllowed(u,!!booking&&(pathname.endsWith('/attendance')?mineTrainerClass(booking.class_id):mineMember(booking.member_id)));}else assertAllowed(u,admin);}

 if(method==='GET'&&pathname==='/api/state'){
 const members=q.members(),payments=q.payments(),classes=q.classes(),checkins=q.checkins();
 return userScope(u,{members,trainers:q.trainers(),classes,bookings:q.bookings(),payments,checkins,measurements:q.measurements(),announcements:q.announcements(),stats:{active:members.filter(x=>x.status==='Aktif').length,todayEntries:checkins.filter(x=>x.created_at.slice(0,10)===datePlus(0)).length,expiring:members.filter(x=>x.expires>=datePlus(0)&&x.expires<=datePlus(7)).length,pending:payments.filter(x=>x.status==='Bekliyor').reduce((s,x)=>s+x.amount,0)}});
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
   const classDay=c.starts_at.slice(0,10);if(classDay<datePlus(0))throw Error('Geçmiş derse rezervasyon yapılamaz');if(classDay>datePlus(Number(setting('booking_window_days'))))throw Error('Rezervasyon süresi dışında');if(m.expires<classDay)throw Error('Üyelik ders tarihinde sona ermiş olacak');
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
 if(method==='POST'&&pathname==='/api/checkins'){assertAllowed(u,admin);required(body,'member_id');const m=db.prepare('SELECT * FROM members WHERE id=?').get(Number(body.member_id));if(!m||m.status!=='Aktif'||m.expires<datePlus(0))throw new Error('Aktif üyelik bulunamadı');db.prepare('INSERT INTO checkins(member_id) VALUES(?)').run(m.id);log('QR giriş',m.name);return {ok:true}}
 if(method==='POST'&&pathname==='/api/payments'){required(body,'member_id','amount','due_date');const r=db.prepare('INSERT INTO payments(member_id,amount,status,due_date) VALUES(?,?,?,?)').run(Number(body.member_id),Number(body.amount),'Bekliyor',body.due_date);return {id:Number(r.lastInsertRowid)}}
 if(method==='POST'&&/^\/api\/payments\/\d+\/pay$/.test(pathname)){const id=Number(pathname.split('/')[3]);db.prepare("UPDATE payments SET status='Ödendi',paid_at=? WHERE id=?").run(datePlus(0),id);log('Ödeme alındı',String(id));return {ok:true}}
 if(method==='POST'&&pathname==='/api/measurements'){required(body,'member_id','measured_at');db.prepare('INSERT INTO measurements(member_id,measured_at,weight,body_fat,muscle) VALUES(?,?,?,?,?)').run(Number(body.member_id),body.measured_at,Number(body.weight||0),Number(body.body_fat||0),Number(body.muscle||0));return {ok:true}}
 if(method==='POST'&&pathname==='/api/announcements'){required(body,'title','body');db.prepare('INSERT INTO announcements(title,body) VALUES(?,?)').run(body.title,body.body);return {ok:true}}
 throw new Error('Endpoint bulunamadı');
}
const nutrition = require('./backend/nutrition')(db);
const nutritionPlus = require('./backend/nutrition-plus')(db);
const v9 = require('./backend/v9')(db);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const authLimit=security.createLimiter();
const apiLimit=security.createLimiter({limit:600,windowMs:60000});
const dummyHash=pwHash(randomBytes(32).toString('hex'));
let shuttingDown=false;
const server=http.createServer(async(req,res)=>{security.headers(res,config);try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/healthz'){if(req.method!=='GET')return send(res,405,{error:'Yöntem desteklenmiyor'});try{if(shuttingDown)throw Error();db.prepare('SELECT 1').get();return send(res,200,{status:'ok'})}catch{return send(res,503,{status:'unavailable'})}}
 if(url.pathname.startsWith('/api/')){
  security.guard(req,config);
  apiLimit(req.socket.remoteAddress);
  if(['/api/login','/api/setup'].includes(url.pathname))authLimit(req.socket.remoteAddress);
  let body={};if(req.method!=='GET'){
   const chunks=[];let size=0;for await(const ch of req){size+=ch.length;if(size>1024*1024){const e=Error('İstek fazla büyük');e.status=413;throw e}chunks.push(ch)}
   try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{const e=Error('Geçersiz JSON');e.status=400;throw e}
  }
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('JSON nesnesi gerekli');
  for(const key of ['member_id','class_id','trainer_id','credits','duration','capacity','amount','weight','body_fat','muscle'])if(body[key]!==undefined&&body[key]!==''&&body[key]!==null){const n=Number(body[key]);if(!Number.isFinite(n)||n<0||n>1000000)throw Error('Geçersiz sayısal değer');body[key]=n}
  for(const value of Object.values(body))if(typeof value==='string'&&value.length>10000)throw Error('Alan fazla uzun');
  const u=authUser(req);
  if(url.pathname.startsWith('/api/v9/')) return send(res,200,await v9(req.method,url.pathname,req.method==='GET'?Object.fromEntries(url.searchParams):body,u));
  if(req.method==='POST'&&url.pathname==='/api/setup'){
   assertAllowed(u,!config.production&&db.prepare('SELECT COUNT(*) n FROM users').get().n===0);
   credentials(body);required(body,'username','password');if(String(body.password).length<10)throw Error('Şifre en az 10 karakter olmalı');
   const result=db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'admin')").run(String(body.username).trim(),pwHash(body.password));setSession(res,Number(result.lastInsertRowid),req);return send(res,200,{ok:true});
  }
  if(req.method==='POST'&&url.pathname==='/api/login'){
   credentials(body);const account=db.prepare('SELECT * FROM users WHERE username=?').get(String(body.username||'').trim());
   if(!pwVerify(String(body.password||''),account?.password_hash||dummyHash)||!account){const e=Error('Kullanıcı adı veya şifre hatalı');e.status=401;throw e}
   setSession(res,account.id,req);return send(res,200,{ok:true});
  }
  if(req.method==='POST'&&url.pathname==='/api/logout'){
   const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fc_session='))?.slice(11);
   if(token)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest(token));
   res.setHeader('Set-Cookie',`fc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.secure?'; Secure':''}`);return send(res,200,{ok:true});
  }
  if(!u&&url.pathname!=='/api/me'){const e=Error('Oturum açmanız gerekiyor');e.status=401;throw e}
  if(url.pathname.startsWith('/api/nutrition-plus/')) return send(res,200,await nutritionPlus(req.method,url.pathname,req.method==='GET'?Object.fromEntries(url.searchParams):body,u));
  if(url.pathname.startsWith('/api/v8/')) return send(res,200,await nutrition(req.method,url.pathname,req.method==='GET'?Object.fromEntries(url.searchParams):body,u));
  return send(res,200,api(req.method,url.pathname,req.method==='GET'?{...body,member_id:url.searchParams.get('member_id')}:body,u));
 }
 const publicRoot=fs.realpathSync(path.join(ROOT,'public'));
 const decoded=decodeURIComponent(url.pathname);
 if(decoded.split('/').some(part=>part.startsWith('.'))){res.writeHead(404);return res.end('Bulunamadı')}
 let file=path.resolve(publicRoot,'.'+decoded);
 const inside=p=>p===publicRoot||p.startsWith(publicRoot+path.sep);
 if(!inside(file)){res.writeHead(403);return res.end('Yasak')}
 // Resolve directory entry points as well as explicit HTML paths.
 if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 file=fs.realpathSync(file);
 if(!inside(file)){res.writeHead(403);return res.end('Yasak')}
 if(!Object.hasOwn(mime,path.extname(file))){res.writeHead(404);return res.end('Bulunamadı')}
 const stat=fs.statSync(file);if(!stat.isFile())throw Error('Bulunamadı');res.setHeader('Cache-Control','public, max-age=0, must-revalidate');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
 }catch(e){if(req.url.startsWith('/api/')){const internal=!!e.code||!Number.isInteger(e.status)&&/SQLITE|constraint|bind|datatype/i.test(e.message);if(internal)console.error(JSON.stringify({event:'request_error',requestId:randomUUID(),status:500}));if(e.status===429)res.setHeader('Retry-After','900');send(res,internal?500:e.status||400,{error:internal?'İşlem tamamlanamadı':e.message});}else{res.writeHead(404);res.end('Bulunamadı')}}});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
async function shutdown(){if(shuttingDown)return;shuttingDown=true;const timer=setTimeout(()=>server.closeAllConnections(),10000);timer.unref();await new Promise(resolve=>server.close(resolve));clearTimeout(timer);if(db.isOpen)db.close()}
module.exports = { server, db, shutdown };
if(require.main===module){server.listen(config.port,config.host,()=>console.log(JSON.stringify({event:'listening',port:server.address().port})));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>shutdown().catch(()=>{console.error(JSON.stringify({event:'shutdown_error'}));process.exitCode=1}));}
