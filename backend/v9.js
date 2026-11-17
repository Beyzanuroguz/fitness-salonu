const { randomBytes, createHash } = require('node:crypto');
const hash = token => createHash('sha256').update(token).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const today = now => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const percent = (n, d) => d ? Math.round(n / d * 10000) / 100 : null;
module.exports = function createV9(db, clock = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS v9_qr_tokens(
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    member_id INTEGER NOT NULL REFERENCES members(id), session_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE INDEX IF NOT EXISTS v9_qr_expiry ON v9_qr_tokens(expires_at);
    CREATE TABLE IF NOT EXISTS v9_reminder_reads(
    user_id INTEGER NOT NULL REFERENCES users(id), reminder_key TEXT NOT NULL,
    read_at INTEGER NOT NULL, PRIMARY KEY(user_id,reminder_key));`);
  function active(id, now) {
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
    if (!m || m.status !== 'Aktif' || m.expires < today(now)) fail('Aktif üyelik gerekli', 403);
    return m;
  }
  function reminders(u, now) {
    if (u.role !== 'member' || !u.member_id) fail('Üye hesabı gerekli', 403);
    const day = today(now), until = today(now + 7 * 86400000);
    const m = db.prepare('SELECT expires FROM members WHERE id=?').get(u.member_id);
    const items = [];
    if (m && m.expires <= until) items.push({ id: `membership:${m.expires}`, type: 'membership', due_at: m.expires, message: 'Üyelik yenileme hatırlatması' });
    for (const p of db.prepare("SELECT id,due_date,amount FROM payments WHERE member_id=? AND status='Bekliyor' AND due_date<=? ORDER BY due_date,id").all(u.member_id, until))
      items.push({ id: `payment:${p.id}:${p.due_date}`, type: 'payment', due_at: p.due_date, amount: p.amount, message: 'Ödeme hatırlatması' });
    // Class timestamps in this application use Istanbul wall time without an offset.
    for (const c of db.prepare("SELECT c.id,c.title,c.starts_at FROM bookings b JOIN classes c ON c.id=b.class_id WHERE b.member_id=? AND b.status='reserved' AND substr(c.starts_at,1,10)>=? AND substr(c.starts_at,1,10)<=? ORDER BY c.starts_at").all(u.member_id, day, today(now + 86400000))) {
      const starts = Date.parse(/[Zz]|[+-]\d\d:\d\d$/.test(c.starts_at) ? c.starts_at : c.starts_at + '+03:00');
      if (starts >= now && starts <= now + 86400000) items.push({ id: `class:${c.id}:${c.starts_at}`, type: 'class', due_at: c.starts_at, title: c.title, message: 'Yaklaşan ders hatırlatması' });
    }
    return items.map(item => ({ ...item, read: !!db.prepare('SELECT 1 FROM v9_reminder_reads WHERE user_id=? AND reminder_key=?').get(u.id, item.id) }));
  }
  return function handle(method, pathname, body, u) {
    if (!u) fail('Oturum gerekli', 401);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON nesnesi gerekli');
    const now = clock(), route = pathname.slice('/api/v9'.length);
    for (const key of ['user_id', 'member_id', 'trainer_id']) if (body[key] !== undefined && Number(body[key]) !== u[key === 'user_id' ? 'id' : key]) fail('Yalnızca kendi kayıtlarınıza erişebilirsiniz', 403);
    if (method === 'POST' && route === '/qr') {
      if (u.role !== 'member' || !u.member_id) fail('Üye hesabı gerekli', 403);
      active(u.member_id, now);
      if (!db.prepare('SELECT 1 FROM sessions WHERE id_hash=? AND user_id=? AND expires_at>?').get(u.session_hash, u.id, now)) fail('Oturum gerekli', 401);
      const token = randomBytes(32).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM v9_qr_tokens WHERE expires_at<=? OR user_id=?').run(now, u.id);
        db.prepare('INSERT INTO v9_qr_tokens(token_hash,user_id,member_id,session_hash,expires_at) VALUES(?,?,?,?,?)').run(hash(token), u.id, u.member_id, u.session_hash, now + 60000);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { token, expires_at: now + 60000, expires_in: 60 };
    }
    if (method === 'POST' && route === '/qr/verify') {
      // Only reception administrators may scan entry codes; members cannot self-admit.
      if (u.role !== 'admin') fail('Yönetici yetkisi gerekli', 403);
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) fail('Geçersiz QR');
      db.exec('BEGIN IMMEDIATE');
      try {
        const qr = db.prepare(`SELECT q.* FROM v9_qr_tokens q JOIN users u ON u.id=q.user_id
          JOIN sessions s ON s.id_hash=q.session_hash AND s.user_id=q.user_id
          WHERE q.token_hash=? AND q.used_at IS NULL AND q.expires_at>? AND s.expires_at>?
          AND u.role='member' AND u.member_id=q.member_id`).get(hash(body.token), now, now);
        if (!qr) fail('QR geçersiz, kullanılmış veya süresi dolmuş', 422);
        active(qr.member_id, now);
        const consumed = db.prepare('UPDATE v9_qr_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').run(now, qr.token_hash, now);
        if (consumed.changes !== 1) fail('QR kullanılmış', 422);
        const result = db.prepare('INSERT INTO checkins(member_id) VALUES(?)').run(qr.member_id);
        db.exec('COMMIT');
        return { ok: true, checkin_id: Number(result.lastInsertRowid), member_id: qr.member_id };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (method === 'GET' && route === '/reminders') return { reminders: reminders(u, now) };
    if (method === 'POST' && route === '/reminders/read') {
      const item = reminders(u, now).find(x => x.id === body.id);
      if (!item) fail('Hatırlatma bulunamadı', 404);
      db.prepare('INSERT OR IGNORE INTO v9_reminder_reads VALUES(?,?,?)').run(u.id, item.id, now);
      return { ok: true };
    }
    if (method === 'GET' && route === '/teacher/reports/monthly') {
      if (u.role !== 'teacher' || !u.trainer_id) fail('Eğitmen hesabı gerekli', 403);
      const month = body.month || today(now).slice(0, 7);
      if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.slice(0, 4) === '0000') fail('Geçersiz ay');
      const classes = db.prepare(`SELECT c.id,c.title,c.starts_at,c.capacity,
        SUM(CASE WHEN b.status IN ('reserved','attended') THEN 1 ELSE 0 END) booked,
        SUM(CASE WHEN b.status='attended' THEN 1 ELSE 0 END) attended,
        SUM(CASE WHEN b.status IN ('attended','absent') THEN 1 ELSE 0 END) marked
        FROM classes c LEFT JOIN bookings b ON b.class_id=c.id
        WHERE c.trainer_id=? AND substr(c.starts_at,1,7)=? GROUP BY c.id ORDER BY c.starts_at,c.id`).all(u.trainer_id, month);
      const totals = classes.reduce((a, c) => { for (const k of ['capacity','booked','attended','marked']) a[k] += c[k]; return a; }, { capacity: 0, booked: 0, attended: 0, marked: 0 });
      return { month, trainer_id: u.trainer_id, class_count: classes.length, ...totals, attendance_percent: percent(totals.attended, totals.marked), occupancy_percent: percent(totals.booked, totals.capacity), classes: classes.map(c => ({ ...c, occupancy_percent: percent(c.booked, c.capacity), attendance_percent: percent(c.attended, c.marked) })) };
    }
    fail('API bulunamadı', 404);
  };
};
