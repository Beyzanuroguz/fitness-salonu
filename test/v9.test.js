const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.NODE_ENV = 'test';
process.env.FITNESS_DB_PATH = ':memory:';
const { server, db } = require('../server');
const createV9 = require('../backend/v9');
const K = require('../public/v9/v9-core');
let base;
function client() {
  let cookie;
  return async (path, method = 'GET', body, extra = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie'), cacheControl: r.headers.get('cache-control') };
  };
}
test.before(async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('V9 HTTP authorization, QR expiry/replay/revocation, reminders and scoped reports', async () => {
  const anon = client(), admin = client(), member = client(), other = client(), teacher = client();
  for (const path of ['/qr', '/qr/verify', '/reminders', '/teacher/reports/monthly']) assert.equal((await anon('/api/v9' + path, path.startsWith('/qr') ? 'POST' : 'GET', path.startsWith('/qr') ? {} : undefined)).status, 401);
  const setup = await admin('/api/setup', 'POST', { username: 'admin', password: 'test-password-123' });
  assert.match(setup.cookie, /HttpOnly/); assert.match(setup.cookie, /SameSite=Strict/);
  for (const [username, role, link] of [['member','member',{member_id:1}], ['other','member',{member_id:2}], ['teacher','teacher',{trainer_id:1}]]) {
    assert.equal((await admin('/api/users','POST',{username,password:'test-password-123',role,...link})).status,200);
  }
  for (const [c,username] of [[member,'member'],[other,'other'],[teacher,'teacher']]) assert.equal((await c('/api/login','POST',{username,password:'test-password-123'})).status,200);
  db.prepare("UPDATE members SET expires='2099-12-31' WHERE id IN (1,2)").run();
  const issue = async () => { const r = await member('/api/v9/qr','POST',{}); assert.equal(r.status,200); assert.equal(r.data.expires_in,60); assert.equal(r.cacheControl,'no-store'); assert.ok(K.isToken(K.normalizeQR(r.data).token)); return r.data.token; };
  assert.equal((await admin('/api/v9/qr','POST',{})).status,403);
  assert.equal((await teacher('/api/v9/qr','POST',{})).status,403);
  assert.equal((await member('/api/v9/qr','POST',{member_id:2})).status,403);
  assert.equal((await member('/api/checkins','POST',{member_id:1})).status,403);
  assert.equal((await member('/api/v9/qr','POST',{}, {origin:'https://evil.example'})).status,403);
  assert.equal((await member('/api/v9/qr','POST',null)).status,400);
  let token = await issue();
  assert.notEqual(db.prepare('SELECT token_hash FROM v9_qr_tokens').get().token_hash,token);
  for (const c of [member,other,teacher]) assert.equal((await c('/api/v9/qr/verify','POST',{token})).status,403);
  const scans = await Promise.all([admin('/api/v9/qr/verify','POST',{token}),admin('/api/v9/qr/verify','POST',{token})]);
  assert.deepEqual(scans.map(x=>x.status).sort(),[200,422]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkins').get().n,1);
  assert.equal((await admin('/api/v9/qr/verify','POST',{token:'x'})).status,400);
  token = await issue();
  const row = db.prepare('SELECT * FROM v9_qr_tokens').get();
  const atExpiry = createV9(db, () => row.expires_at);
  const au = db.prepare("SELECT * FROM users WHERE role='admin'").get();
  assert.throws(()=>atExpiry('POST','/api/v9/qr/verify',{token},au),e=>e.status===422);
  token = await issue();
  db.prepare("UPDATE members SET status='Pasif' WHERE id=1").run();
  assert.equal((await admin('/api/v9/qr/verify','POST',{token})).status,403);
  assert.equal((await member('/api/v9/qr','POST',{})).status,403);
  db.prepare("UPDATE members SET status='Aktif',expires='2000-01-01' WHERE id=1").run();
  assert.equal((await admin('/api/v9/qr/verify','POST',{token})).status,403);
  db.prepare("UPDATE members SET expires='2099-12-31' WHERE id=1").run();
  const old = await issue(); token = await issue();
  assert.equal((await admin('/api/v9/qr/verify','POST',{token:old})).status,422);
  assert.equal((await member('/api/logout','POST',{})).status,200);
  assert.equal((await admin('/api/v9/qr/verify','POST',{token})).status,422);
  assert.equal((await member('/api/v9/qr','POST',{})).status,401);
  await member('/api/login','POST',{username:'member',password:'test-password-123'});
  token=await issue();
  db.prepare("UPDATE users SET role='teacher' WHERE username='member'").run();
  assert.equal((await admin('/api/v9/qr/verify','POST',{token})).status,422);
  db.prepare("UPDATE users SET role='member' WHERE username='member'").run();

  // Fixed Istanbul clock makes month, leap-day and reminder windows deterministic.
  const now=Date.parse('2028-02-28T09:00:00+03:00'), handle=createV9(db,()=>now);
  const mu=db.prepare("SELECT * FROM users WHERE username='member'").get();
  const ou=db.prepare("SELECT * FROM users WHERE username='other'").get();
  const tu=db.prepare("SELECT * FROM users WHERE username='teacher'").get();
  db.exec("DELETE FROM bookings; DELETE FROM classes; DELETE FROM payments;");
  db.prepare("UPDATE members SET expires='2028-03-01' WHERE id=1").run();
  db.exec(`INSERT INTO classes(id,title,trainer_id,starts_at,capacity) VALUES
    (101,'Own A',1,'2028-02-28T10:00:00',4),(102,'Own B',1,'2028-02-29T10:00:00',6),
    (103,'Other',2,'2028-02-28T10:00:00',10),(104,'March',1,'2028-03-01T10:00:00',8);
    INSERT INTO bookings(member_id,class_id,status) VALUES(1,101,'reserved'),(2,101,'attended'),(3,101,'absent'),(4,101,'cancelled'),(5,101,'waitlist'),(1,102,'attended'),(2,103,'reserved');
    INSERT INTO payments(member_id,amount,status,due_date) VALUES(1,100,'Bekliyor','2028-02-20'),(1,50,'Ödendi','2028-02-28'),(2,900,'Bekliyor','2028-02-28');`);
  const call=(method,path,body={},u=mu)=>handle(method,'/api/v9'+path,body,u);
  let items=call('GET','/reminders').reminders;
  assert.deepEqual(items.map(x=>x.type).sort(),['class','membership','payment']);
  assert.equal(items.find(x=>x.type==='payment').amount,100);
  assert.ok(items.every(x=>!x.read));
  call('POST','/reminders/read',{id:items[0].id});
  call('POST','/reminders/read',{id:items[0].id});
  assert.equal(call('GET','/reminders').reminders[0].read,true);
  assert.throws(()=>call('POST','/reminders/read',{id:items[0].id},ou),e=>e.status===404);
  assert.throws(()=>call('GET','/reminders',{},tu),e=>e.status===403);
  assert.throws(()=>call('GET','/reminders',{member_id:2}),e=>e.status===403);
  db.exec("UPDATE bookings SET status='cancelled' WHERE member_id=1 AND class_id=101; UPDATE payments SET status='Ödendi' WHERE member_id=1; UPDATE members SET expires='2099-01-01' WHERE id=1;");
  assert.deepEqual(call('GET','/reminders').reminders,[]);
  const report=call('GET','/teacher/reports/monthly',{month:'2028-02'},tu);
  assert.equal(report.class_count,2); assert.equal(report.capacity,10);
  assert.equal(report.attended,2); assert.equal(report.marked,3);
  assert.equal(report.occupancy_percent,20); assert.equal(report.attendance_percent,66.67);
  assert.deepEqual(report.classes.map(c=>c.id),[101,102]);
  const empty=call('GET','/teacher/reports/monthly',{month:'2027-12'},tu);
  assert.equal(empty.class_count,0); assert.equal(empty.occupancy_percent,null); assert.equal(empty.attendance_percent,null);
  for (const month of ['2028-13','2028-2','2028-02\' OR 1=1','0000-01']) assert.throws(()=>call('GET','/teacher/reports/monthly',{month},tu),e=>e.status===400);
  assert.throws(()=>call('GET','/teacher/reports/monthly',{trainer_id:2},tu),e=>e.status===403);
  for (const c of [member,admin]) assert.equal((await c('/api/v9/teacher/reports/monthly?month=2028-02')).status,403);
  assert.equal((await teacher('/api/v9/teacher/reports/monthly?month=2028-02')).data.class_count,2);
  const noticeResponse = await member(K.ENDPOINTS.notifications);
  assert.equal(noticeResponse.status,200);
  assert.equal(noticeResponse.cacheControl,'no-store');
  // Re-enable a pending member payment for HTTP read/list roundtrip.
  db.exec("UPDATE payments SET status='Bekliyor',due_date='2000-01-01' WHERE member_id=1;");
  const notes = K.normalizeNotifications((await member(K.ENDPOINTS.notifications)).data);
  assert.ok(notes.length);
  assert.equal((await member(K.ENDPOINTS.notificationRead,'POST',{id:notes[0].id})).status,200);
  assert.ok(K.normalizeNotifications((await member(K.ENDPOINTS.notifications)).data).find(n=>n.id===notes[0].id).read);
  assert.equal((await other(K.ENDPOINTS.notificationRead,'POST',{id:notes[0].id})).status,404);
  const reportResponse = await teacher(K.reportQuery(2028,2));
  assert.equal(reportResponse.cacheControl,'no-store');
  assert.deepEqual(K.normalizeReport(reportResponse.data).classes.map(c=>c.id),[101,102]);
  assert.equal((await teacher(K.reportQuery(2028,2)+'&trainer_id=2')).status,403);
  assert.equal((await member('/api/v9/unknown')).status,404);
});
