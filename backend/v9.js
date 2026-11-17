const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
module.exports = function createV9(db) {
  db.exec("CREATE TABLE IF NOT EXISTS v9_qr_used(nonce TEXT PRIMARY KEY,member_id INTEGER NOT NULL,used_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS v9_notification_reads(user_id INTEGER NOT NULL,notice_id TEXT NOT NULL,read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,notice_id));");
  let secret = db.prepare("SELECT value FROM app_settings WHERE key='v9_qr_secret'").get()?.value;
  if (!secret) {
    db.prepare("INSERT OR IGNORE INTO app_settings(key,value) VALUES('v9_qr_secret',?)").run(randomBytes(32).toString('hex'));
    secret = db.prepare("SELECT value FROM app_settings WHERE key='v9_qr_secret'").get().value;
  }
  const key = Buffer.from(secret, 'hex');
  const forbidden = (msg = 'Bu işlem için yetkiniz yok', status = 403) => { const e = Error(msg); e.status = status; throw e };
  const iso = d => d.toISOString().slice(0, 10);
  const now = () => Date.now();
  const sign = data => createHmac('sha256', key).update(data).digest('base64url');
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  const day = (delta = 0) => iso(new Date(now() + delta * 86400000));
  function memberQR(user) {
    if (user.role !== 'member' || !Number.isInteger(user.member_id)) forbidden();
    const member = db.prepare('SELECT id,expires,status FROM members WHERE id=?').get(user.member_id);
    if (!member || member.status !== 'Aktif' || member.expires < day()) forbidden('Üyelik aktif değil');
    const payload = Buffer.from(JSON.stringify({ m: member.id, n: randomBytes(16).toString('hex'), exp: now() + 60000 })).toString('base64url');
    return { token: payload + '.' + sign(payload), expires_in: 60 };
  }
  function scanQR(user, data) {
    if (!['admin', 'teacher'].includes(user.role)) forbidden();
    const token = String(data?.token || '');
    if (token.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) forbidden('Geçersiz QR', 400);
    const [payload, mac] = token.split('.');
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) forbidden('QR doğrulanamadı', 400);
    let value;
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { forbidden('Geçersiz QR', 400) }
    if (!Number.isSafeInteger(value.m) || !/^[a-f0-9]{32}$/.test(value.n || '') || !Number.isFinite(value.exp) || value.exp < now() || value.exp > now() + 60000) forbidden('QR süresi dolmuş', 400);
    const member = db.prepare('SELECT id,name,expires,status FROM members WHERE id=?').get(value.m);
    if (!member || member.status !== 'Aktif' || member.expires < day()) forbidden('Üyelik aktif değil', 400);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM v9_qr_used WHERE used_at < ?').run(now() - 86400000);
      const inserted = db.prepare('INSERT OR IGNORE INTO v9_qr_used(nonce,member_id,used_at) VALUES(?,?,?)').run(value.n, member.id, now());
      if (inserted.changes !== 1) forbidden('Bu QR daha önce kullanıldı', 409);
      db.prepare('INSERT INTO checkins(member_id) VALUES(?)').run(member.id);
      db.prepare('INSERT INTO activity(action,details) VALUES(?,?)').run('V9 QR giriş', String(member.id));
      db.exec('COMMIT');
      return { ok: true, member: member.name, checked_in_at: new Date().toISOString() };
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  function notifications(user) {
    const today = day(), horizon = day(7), notices = [];
    if (user.role === 'member') {
      if (!user.member_id) return [];
      const member = db.prepare('SELECT expires,status FROM members WHERE id=?').get(user.member_id);
      if (member?.expires >= today && member.expires <= horizon) notices.push({ id: 'expiry:' + member.expires, title: 'Üyeliğin bitiyor', detail: member.expires + ' tarihinde üyeliğin sona erecek.', date: member.expires });
      const bookings = db.prepare("SELECT b.id,c.title,c.starts_at FROM bookings b JOIN classes c ON c.id=b.class_id WHERE b.member_id=? AND b.status='reserved' AND substr(c.starts_at,1,10) BETWEEN ? AND ? ORDER BY c.starts_at LIMIT 25").all(user.member_id,today,day(2));
      for (const b of bookings) notices.push({ id: 'booking:' + b.id, title: 'Yaklaşan ders', detail: b.title + ' · ' + b.starts_at, date: b.starts_at });
      const payments = db.prepare("SELECT id,amount,due_date FROM payments WHERE member_id=? AND status!='Ödendi' AND due_date<=? ORDER BY due_date LIMIT 20").all(user.member_id,horizon);
      for (const p of payments) notices.push({ id: 'payment:' + p.id, title: 'Bekleyen ödeme', detail: p.amount + ' ₺ · Vade: ' + p.due_date, date: p.due_date });
    } else if (user.role === 'admin') {
      const expiring = db.prepare("SELECT id,name,expires FROM members WHERE status='Aktif' AND expires BETWEEN ? AND ? LIMIT 40").all(today,horizon);
      for (const m of expiring) notices.push({ id: 'member-expiry:' + m.id + ':' + m.expires, title: 'Üyeliği biten üye', detail: m.name + ' · ' + m.expires, date: m.expires });
      const payments = db.prepare("SELECT id,member_id,amount,due_date FROM payments WHERE status!='Ödendi' AND due_date<=? LIMIT 40").all(today);
      for (const p of payments) notices.push({ id: 'admin-payment:' + p.id, title: 'Geciken ödeme', detail: 'Üye #' + p.member_id + ' · ' + p.amount + ' ₺', date: p.due_date });
    } else if (user.role === 'teacher') {
      const classes = db.prepare("SELECT id,title,starts_at FROM classes WHERE trainer_id=? AND substr(starts_at,1,10) BETWEEN ? AND ? ORDER BY starts_at LIMIT 30").all(user.trainer_id,today,day(2));
      for (const c of classes) notices.push({ id: 'teacher-class:' + c.id, title: 'Yaklaşan dersin', detail: c.title + ' · ' + c.starts_at, date: c.starts_at });
    }
    const read = new Set(db.prepare('SELECT notice_id FROM v9_notification_reads WHERE user_id=?').all(user.id).map(r => r.notice_id));
    return notices.map(n => ({ ...n, read: read.has(n.id) }));
  }
  function trainerReport(user, query) {
    if (!['teacher','admin'].includes(user.role)) forbidden();
    const year = Number(query.year || new Date().getFullYear()), month = Number(query.month || new Date().getMonth() + 1);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) forbidden('Geçersiz dönem', 400);
    const trainerId = user.role === 'teacher' ? user.trainer_id : Number(query.trainer_id);
    if (!Number.isSafeInteger(trainerId) || trainerId <= 0) forbidden('Eğitmen gerekli', 400);
    const trainer = db.prepare('SELECT id,name FROM trainers WHERE id=?').get(trainerId);
    if (!trainer) forbidden('Eğitmen bulunamadı', 404);
    const start = year + '-' + String(month).padStart(2,'0') + '-01', next = month === 12 ? year + 1 + '-01-01' : year + '-' + String(month+1).padStart(2,'0') + '-01';
    const classes = db.prepare("SELECT c.id,c.title,c.starts_at,c.capacity,COUNT(CASE WHEN b.status IN ('reserved','attended','absent') THEN 1 END) reservations,COUNT(CASE WHEN b.status='attended' THEN 1 END) attended FROM classes c LEFT JOIN bookings b ON b.class_id=c.id WHERE c.trainer_id=? AND substr(c.starts_at,1,10)>=? AND substr(c.starts_at,1,10)<? GROUP BY c.id ORDER BY c.starts_at").all(trainerId,start,next);
    const taught = classes.filter(c => c.starts_at <= new Date().toISOString().slice(0,16));
    const attendance = taught.reduce((s,c)=>s+c.attended,0);
    const capacity = classes.reduce((s,c)=>s+c.capacity,0);
    const booked = classes.reduce((s,c)=>s+c.reservations,0);
    return { trainer,year,month,class_count:classes.length,completed_classes:taught.length,attendance,occupancy_percent:capacity?Math.round(100*booked/capacity):0,classes };
  }
  return function route(method, pathname, data, user) {
    if (!user) forbidden('Oturum açmanız gerekiyor',401);
    if (method === 'GET' && pathname === '/api/v9/qr') return memberQR(user);
    if (method === 'POST' && pathname === '/api/v9/checkin') return scanQR(user,data);
    if (method === 'GET' && pathname === '/api/v9/notifications') return notifications(user);
    if (method === 'POST' && pathname === '/api/v9/notifications/read') {
      const id = String(data?.id || '');
      if (!id || id.length > 200 || !notifications(user).some(n => n.id === id)) forbidden('Bildirim bulunamadı',404);
      db.prepare('INSERT OR IGNORE INTO v9_notification_reads(user_id,notice_id) VALUES(?,?)').run(user.id,id);
      return {ok:true};
    }
    if (method === 'GET' && pathname === '/api/v9/trainer-report') return trainerReport(user,data);
    forbidden('Endpoint bulunamadı',404);
  };
};
