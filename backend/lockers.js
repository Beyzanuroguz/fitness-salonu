'use strict';
// Virtual lockers V1, SIMULATION ONLY. Each locker has a printable QR that holds only a public
// locker identifier: no member data, no secret and no unlock authority. Nothing here opens a lock,
// drives a relay or talks to hardware. A member can claim a locker only while gate_presence (the
// turnstile module's single in/out state) says they are inside. One active assignment per member and
// per locker is enforced by partial UNIQUE indexes, inside BEGIN IMMEDIATE transactions.
const { randomBytes } = require('node:crypto');
const { createLimiter } = require('./security');
const PREFIX = 'FORMCLUB-LOCKER:1:';
const GATE_PREFIX = 'FORMCLUB-GATE:1:';
const SEED_COUNT = 20, MAX_LOCKERS = 200;
const today = now => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const newCode = () => randomBytes(16).toString('hex');
const REASONS = {
  invalid_code: 'Bu bir FORM CLUB dolap QR kodu değil.',
  gate_code: 'Bu bir turnike kodu. Turnike için “Turnike QR Tara” ekranını kullan.',
  unknown_code: 'Dolap QR kodu geçersiz veya yenilenmiş. Dolabın üzerindeki güncel kodu okut.',
  maintenance: 'Bu dolap bakımda. Başka bir dolap seç.',
  inactive: 'Bu dolap kullanım dışı (pasif). Başka bir dolap seç.',
  not_inside: 'Dolap almak için önce turnikeden giriş yapmalısın.',
  membership: 'Aktif üyelik gerekli. Resepsiyona başvur.',
  already_yours: 'Bu dolap zaten sana ayrılmış.',
  has_locker: 'Zaten bir dolabın var. Yeni dolap için önce mevcut dolabını bırak.',
  occupied: 'Bu dolap dolu. Başka bir dolap seç.',
  no_locker: 'Üzerinde kayıtlı dolap yok.'
};
const ACTIONS = {
  claim: 'Dolap alındı', release: 'Üye dolabı bıraktı', admin_assign: 'Yönetici atadı', admin_release: 'Yönetici boşalttı',
  status: 'Durum değişti', rotate: 'QR kimliği yenilendi', create: 'Dolap eklendi', exit_warning: 'Dolapla çıkış uyarısı', alert_resolved: 'Uyarı kapatıldı'
};
const STATE = { available: 'Boş', occupied: 'Dolu', maintenance: 'Bakımda', inactive: 'Pasif' };
const STATUSES = ['available', 'maintenance', 'inactive'];

module.exports = function createLockers(db, { clock = Date.now, actionLimit = 20, ephemeral = false } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS lockers(id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE CHECK(length(code)=32), status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','maintenance','inactive')),
    code_rotated_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS locker_assignments(id INTEGER PRIMARY KEY AUTOINCREMENT,
    locker_id INTEGER NOT NULL REFERENCES lockers(id), member_id INTEGER NOT NULL REFERENCES members(id),
    source TEXT NOT NULL CHECK(source IN ('member','admin')), started_by INTEGER NOT NULL REFERENCES users(id), started_at INTEGER NOT NULL,
    ended_at INTEGER, ended_by INTEGER REFERENCES users(id), end_reason TEXT CHECK(end_reason IN ('member','admin')),
    CHECK((ended_at IS NULL) = (end_reason IS NULL)));
  CREATE UNIQUE INDEX IF NOT EXISTS locker_one_active_per_locker ON locker_assignments(locker_id) WHERE ended_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS locker_one_active_per_member ON locker_assignments(member_id) WHERE ended_at IS NULL;
  CREATE TABLE IF NOT EXISTS locker_events(id INTEGER PRIMARY KEY AUTOINCREMENT,
    locker_id INTEGER REFERENCES lockers(id), member_id INTEGER REFERENCES members(id),
    actor_user_id INTEGER NOT NULL REFERENCES users(id), actor_role TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('claim','release','admin_assign','admin_release','status','rotate','create','exit_warning','alert_resolved')),
    result TEXT NOT NULL CHECK(result IN ('ok','rejected')), reason TEXT, note TEXT, detail TEXT,
    idempotency_key TEXT, request_fp TEXT, created_at INTEGER NOT NULL, UNIQUE(actor_user_id, idempotency_key));
  CREATE INDEX IF NOT EXISTS locker_events_time ON locker_events(created_at);
  CREATE INDEX IF NOT EXISTS locker_events_member ON locker_events(member_id, created_at);
  CREATE TABLE IF NOT EXISTS locker_alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('exit_with_locker')),
    member_id INTEGER NOT NULL REFERENCES members(id), locker_id INTEGER NOT NULL REFERENCES lockers(id),
    assignment_id INTEGER NOT NULL REFERENCES locker_assignments(id), gate_event_id INTEGER UNIQUE,
    created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by INTEGER REFERENCES users(id), resolution_note TEXT);`);
  // First start only: 20 lockers. Restarts keep the printed codes.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT count(*) n FROM lockers').get().n) {
      const add = db.prepare("INSERT INTO lockers(label,code,status,code_rotated_at,created_at) VALUES(?,?,'available',?,?)");
      for (let i = 1; i <= SEED_COUNT; i++) add.run('Dolap ' + i, newCode(), clock(), clock());
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }

  const limit = createLimiter({ limit: actionLimit, windowMs: 60000, clock });
  const adminLimit = createLimiter({ limit: 120, windowMs: 60000, clock });
  const admin = u => { if (u.role !== 'admin') fail('Yönetici yetkisi gerekli', 403); };
  const member = u => { if (u.role !== 'member' || !u.member_id) fail('Üye hesabı gerekli', 403); };
  const keyOf = (body, required) => {
    const key = body.idempotency_key;
    if (key === undefined && !required) return null;
    if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(key)) fail('Geçersiz istek anahtarı');
    return key;
  };
  const reasonOf = body => {
    const r = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (r.length < 3 || r.length > 300) fail('Sebep gerekli (3-300 karakter)');
    return r;
  };
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }
  const active = 'SELECT a.*, l.label FROM locker_assignments a JOIN lockers l ON l.id=a.locker_id WHERE a.ended_at IS NULL';
  const activeFor = memberId => db.prepare(active + ' AND a.member_id=?').get(memberId);
  const activeOn = lockerId => db.prepare(active + ' AND a.locker_id=?').get(lockerId);
  const record = (u, f) => {
    const id = Number(db.prepare(`INSERT INTO locker_events(locker_id,member_id,actor_user_id,actor_role,action,result,reason,note,detail,idempotency_key,request_fp,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.locker ?? null, f.member ?? null, u.id, u.role, f.action, f.reason ? 'rejected' : 'ok',
      f.reason ?? null, f.note ?? null, f.detail ?? null, f.key ?? null, f.key ? f.fp ?? null : null, clock()).lastInsertRowid);
    return db.prepare('SELECT * FROM locker_events WHERE id=?').get(id);
  };
  // A reused key must carry the same request; otherwise it is a client bug and must not look like success.
  const seen = (u, key, fp) => {
    const prior = key ? db.prepare('SELECT * FROM locker_events WHERE actor_user_id=? AND idempotency_key=?').get(u.id, key) : undefined;
    if (prior && prior.request_fp !== fp) fail('İstek anahtarı başka bir işlemde kullanıldı', 409);
    return prior;
  };
  const assignmentOf = body => {
    const id = Number(body.assignment_id);
    if (!Number.isInteger(id) || id < 1) fail('Tahsis bilgisi eksik. Sayfayı yenileyin.');
    return id;
  };
  const label = id => id ? db.prepare('SELECT label FROM lockers WHERE id=?').get(id)?.label ?? null : null;
  const outcome = e => ({ ok: e.result === 'ok', action: e.action, reason: e.reason, message: e.reason ? REASONS[e.reason] : null,
    locker: label(e.locker_id), locker_id: e.locker_id, at: e.created_at, simulation: true });
  const openAlert = memberId => db.prepare(`SELECT al.id, al.created_at, l.label FROM locker_alerts al JOIN lockers l ON l.id=al.locker_id
    WHERE al.member_id=? AND al.resolved_at IS NULL ORDER BY al.id DESC LIMIT 1`).get(memberId);
  const resolveAlerts = (assignmentId, u, note) => db.prepare('UPDATE locker_alerts SET resolved_at=?, resolved_by=?, resolution_note=? WHERE assignment_id=? AND resolved_at IS NULL')
    .run(clock(), u.id, note, assignmentId);
  const insideNow = memberId => !!db.prepare('SELECT inside FROM gate_presence WHERE member_id=?').get(memberId)?.inside;

  function listLockers() {
    return db.prepare(`SELECT l.*, a.id assignment_id, a.member_id, a.started_at, a.source, m.name member,
      EXISTS(SELECT 1 FROM locker_alerts al WHERE al.locker_id=l.id AND al.resolved_at IS NULL) alert
      FROM lockers l LEFT JOIN locker_assignments a ON a.locker_id=l.id AND a.ended_at IS NULL LEFT JOIN members m ON m.id=a.member_id ORDER BY l.id`).all()
      .map(l => {
        const state = l.member_id ? 'occupied' : l.status;
        return { id: l.id, label: l.label, qr: PREFIX + l.code, status: l.status, state, state_label: STATE[state], code_rotated_at: l.code_rotated_at,
          assignment: l.member_id ? { id: l.assignment_id, member_id: l.member_id, member: l.member, since: l.started_at, source: l.source } : null, alert: !!l.alert };
      });
  }
  const eventRow = e => ({ id: e.id, locker: e.locker, member: e.member, actor: e.actor, actor_role: e.actor_role, action: e.action,
    action_label: ACTIONS[e.action], result: e.result, reason: e.reason, message: e.reason ? REASONS[e.reason] : null, note: e.note, detail: e.detail, at: e.created_at });
  const events = (where, ...args) => db.prepare(`SELECT e.*, l.label locker, m.name member, us.username actor FROM locker_events e
    LEFT JOIN lockers l ON l.id=e.locker_id LEFT JOIN members m ON m.id=e.member_id LEFT JOIN users us ON us.id=e.actor_user_id ${where}
    ORDER BY e.created_at DESC, e.id DESC LIMIT 200`).all(...args).map(eventRow);

  /* ---------- Member ---------- */
  function claim(u, body) {
    member(u);
    const key = keyOf(body, true);
    if (typeof body.code !== 'string' || body.code.length > 200) fail('Geçersiz QR');
    limit('locker:' + u.id);
    const raw = body.code.trim();
    return tx(() => {
      // Retried request (network drop, double tap): return the stored outcome, never a second claim.
      const fp = 'claim:' + raw;
      const prior = seen(u, key, fp);
      if (prior) return { ...outcome(prior), replayed: true };
      const rej = (reason, locker = null) => outcome(record(u, { action: 'claim', locker, member: u.member_id, reason, key, fp }));
      if (raw.startsWith(GATE_PREFIX)) return rej('gate_code');
      if (!raw.startsWith(PREFIX)) return rej('invalid_code');
      const hex = raw.slice(PREFIX.length);
      const locker = /^[a-f0-9]{32}$/.test(hex) ? db.prepare('SELECT * FROM lockers WHERE code=?').get(hex) : undefined;
      if (!locker) return rej('unknown_code');
      const mine = activeFor(u.member_id);
      if (mine && mine.locker_id === locker.id) return rej('already_yours', locker.id);
      if (locker.status !== 'available') return rej(locker.status, locker.id);
      if (!insideNow(u.member_id)) return rej('not_inside', locker.id);
      const m = db.prepare('SELECT status,expires FROM members WHERE id=?').get(u.member_id);
      if (!m || m.status !== 'Aktif' || m.expires < today(clock())) return rej('membership', locker.id);
      if (mine) return rej('has_locker', locker.id);
      if (activeOn(locker.id)) return rej('occupied', locker.id);
      db.prepare("INSERT INTO locker_assignments(locker_id,member_id,source,started_by,started_at) VALUES(?,?,'member',?,?)").run(locker.id, u.member_id, u.id, clock());
      return outcome(record(u, { action: 'claim', locker: locker.id, member: u.member_id, key, fp }));
    });
  }
  function release(u, body) {
    member(u);
    const key = keyOf(body, true);
    if (body.confirm !== true) fail('Bırakma işlemini onaylaman gerekiyor');
    const confirmed = assignmentOf(body);
    limit('locker:' + u.id);
    return tx(() => {
      const fp = 'release:' + confirmed;
      const prior = seen(u, key, fp);
      if (prior) return { ...outcome(prior), replayed: true };
      const mine = activeFor(u.member_id);
      if (!mine) return outcome(record(u, { action: 'release', member: u.member_id, reason: 'no_locker', key, fp }));
      // The confirmation was for a specific assignment; a stale tab must not release a newer one.
      if (mine.id !== confirmed) fail('Dolap bilgin değişti. Sayfayı yenileyip tekrar dene.', 409);
      db.prepare("UPDATE locker_assignments SET ended_at=?, ended_by=?, end_reason='member' WHERE id=? AND ended_at IS NULL").run(clock(), u.id, mine.id);
      resolveAlerts(mine.id, u, 'Üye dolabı bıraktı');
      return outcome(record(u, { action: 'release', locker: mine.locker_id, member: u.member_id, key, fp }));
    });
  }
  function me(u) {
    member(u);
    const p = db.prepare('SELECT inside,changed_at FROM gate_presence WHERE member_id=?').get(u.member_id);
    const a = activeFor(u.member_id), alert = openAlert(u.member_id);
    // Members see their own locker events only; admin notes stay internal.
    const own = events('WHERE e.member_id=?', u.member_id).slice(0, 30).map(({ note, actor, ...e }) => e);
    return { inside: !!p?.inside, inside_since: p?.changed_at ?? null, locker: a ? { id: a.locker_id, assignment_id: a.id, label: a.label, since: a.started_at, source: a.source } : null,
      alert: alert ? { label: alert.label, at: alert.created_at, message: `Turnikeden çıkış yaptın ama ${alert.label} hâlâ sende görünüyor. Eşyalarını aldıysan dolabı bırak.` } : null,
      events: own, simulation: true };
  }

  /* ---------- Admin ---------- */
  function overview() {
    const lockers = listLockers(), counts = { available: 0, occupied: 0, maintenance: 0, inactive: 0 };
    for (const l of lockers) counts[l.state]++;
    const alerts = db.prepare(`SELECT al.id, al.created_at, l.label locker, m.name member, al.member_id,
      EXISTS(SELECT 1 FROM gate_presence p WHERE p.member_id=al.member_id AND p.inside=1) inside
      FROM locker_alerts al JOIN lockers l ON l.id=al.locker_id JOIN members m ON m.id=al.member_id WHERE al.resolved_at IS NULL ORDER BY al.id DESC`).all()
      .map(a => ({ ...a, inside: !!a.inside, at: a.created_at, message: `${a.member} turnikeden çıktı, ${a.locker} hâlâ üzerinde.` }));
    const members = db.prepare(`SELECT m.id, m.name FROM members m WHERE m.status='Aktif'
      AND NOT EXISTS(SELECT 1 FROM locker_assignments a WHERE a.member_id=m.id AND a.ended_at IS NULL) ORDER BY m.name LIMIT 1000`).all();
    return { lockers, counts, alerts, members, events: events(''), simulation: true, ephemeral };
  }
  // fp: what this request asks for (action, target, payload); replaying a key with a different request is refused.
  function adminOp(u, body, fp, fn) {
    admin(u);
    const key = keyOf(body, false);
    adminLimit('locker-admin:' + u.id);
    return tx(() => {
      const prior = seen(u, key, fp);
      if (prior) return { ok: true, replayed: true, locker: listLockers().find(l => l.id === prior.locker_id) ?? null };
      return fn(f => record(u, { ...f, key, fp }));
    });
  }
  const lockerOr404 = id => db.prepare('SELECT * FROM lockers WHERE id=?').get(id) || fail('Dolap bulunamadı', 404);
  const done = id => ({ ok: true, locker: listLockers().find(l => l.id === id) });

  function create(u, body) {
    return adminOp(u, body, 'create:' + (typeof body.label === 'string' ? body.label.trim() : ''), log => {
      const n = db.prepare('SELECT count(*) n FROM lockers').get().n;
      if (n >= MAX_LOCKERS) fail(`En fazla ${MAX_LOCKERS} dolap eklenebilir`, 409);
      let name = typeof body.label === 'string' ? body.label.trim() : '';
      if (name && (name.length > 40 || /[<>]/.test(name))) fail('Dolap adı en fazla 40 karakter olmalı');
      if (!name) { let i = n + 1; while (db.prepare('SELECT 1 FROM lockers WHERE label=?').get('Dolap ' + i)) i++; name = 'Dolap ' + i; }
      if (db.prepare('SELECT 1 FROM lockers WHERE label=?').get(name)) fail('Bu adda bir dolap zaten var', 409);
      const id = Number(db.prepare("INSERT INTO lockers(label,code,status,code_rotated_at,created_at) VALUES(?,?,'available',?,?)").run(name, newCode(), clock(), clock()).lastInsertRowid);
      log({ action: 'create', locker: id, detail: name });
      return done(id);
    });
  }
  function setStatus(u, id, body) {
    if (!STATUSES.includes(body.status)) fail('Durum boş, bakımda veya pasif olmalı');
    const reason = reasonOf(body);
    return adminOp(u, body, `status:${id}:${body.status}:${reason}`, log => {
      const l = lockerOr404(id);
      if (body.status !== 'available' && activeOn(id)) fail('Dolap dolu. Önce dolabı manuel boşaltın.', 409);
      db.prepare('UPDATE lockers SET status=? WHERE id=?').run(body.status, id);
      log({ action: 'status', locker: id, note: reason, detail: `${STATE[l.status]} → ${STATE[body.status]}` });
      return done(id);
    });
  }
  function rotate(u, id, body) {
    const reason = reasonOf(body);
    return adminOp(u, body, `rotate:${id}:${reason}`, log => {
      lockerOr404(id);
      db.prepare('UPDATE lockers SET code=?, code_rotated_at=? WHERE id=?').run(newCode(), clock(), id);
      log({ action: 'rotate', locker: id, note: reason });
      return done(id);
    });
  }
  function assign(u, id, body) {
    const reason = reasonOf(body), memberId = Number(body.member_id);
    if (!Number.isInteger(memberId) || memberId < 1) fail('Üye seçin');
    return adminOp(u, body, `assign:${id}:${memberId}:${reason}`, log => {
      const l = lockerOr404(id);
      if (!db.prepare('SELECT 1 FROM members WHERE id=?').get(memberId)) fail('Üye bulunamadı', 404);
      if (l.status !== 'available') fail(l.status === 'maintenance' ? 'Dolap bakımda, atanamaz.' : 'Dolap pasif, atanamaz.', 409);
      if (activeOn(id)) fail('Dolap dolu. Önce boşaltın.', 409);
      if (activeFor(memberId)) fail('Bu üyenin zaten aktif bir dolabı var.', 409);
      db.prepare("INSERT INTO locker_assignments(locker_id,member_id,source,started_by,started_at) VALUES(?,?,'admin',?,?)").run(id, memberId, u.id, clock());
      log({ action: 'admin_assign', locker: id, member: memberId, note: reason });
      return done(id);
    });
  }
  function adminRelease(u, id, body) {
    const reason = reasonOf(body), confirmed = assignmentOf(body);
    return adminOp(u, body, `release:${id}:${confirmed}:${reason}`, log => {
      lockerOr404(id);
      const a = activeOn(id);
      if (!a) fail('Dolap zaten boş.', 409);
      // The admin confirmed a specific member's assignment; never end a newer one by accident.
      if (a.id !== confirmed) fail('Dolap bu arada başka bir üyeye geçti. Sayfayı yenileyin.', 409);
      db.prepare("UPDATE locker_assignments SET ended_at=?, ended_by=?, end_reason='admin' WHERE id=? AND ended_at IS NULL").run(clock(), u.id, a.id);
      resolveAlerts(a.id, u, 'Yönetici boşalttı: ' + reason);
      log({ action: 'admin_release', locker: id, member: a.member_id, note: reason });
      return done(id);
    });
  }
  function resolveAlert(u, id, body) {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    return adminOp(u, body, `resolve:${id}:${note}`, log => {
      const al = db.prepare('SELECT * FROM locker_alerts WHERE id=?').get(id) || fail('Uyarı bulunamadı', 404);
      if (al.resolved_at) fail('Uyarı zaten kapatılmış.', 409);
      db.prepare('UPDATE locker_alerts SET resolved_at=?, resolved_by=?, resolution_note=? WHERE id=?').run(clock(), u.id, note || 'Yönetici kapattı', id);
      log({ action: 'alert_resolved', locker: al.locker_id, member: al.member_id, note: note || null });
      return { ok: true };
    });
  }

  /* ---------- Turnstile hook (called inside the turnstile transaction) ---------- */
  const gate = {
    current(memberId) { const a = activeFor(memberId); return a ? { id: a.locker_id, label: a.label, since: a.started_at } : null; },
    // A successful exit never blocks: the pass is stored, the locker stays assigned, the admin gets an alert.
    onExit(event, u) {
      const a = activeFor(event.member_id);
      if (!a) return;
      db.prepare('INSERT INTO locker_alerts(kind,member_id,locker_id,assignment_id,gate_event_id,created_at) VALUES(?,?,?,?,?,?)')
        .run('exit_with_locker', event.member_id, a.locker_id, a.id, event.id, clock());
      record(u, { action: 'exit_warning', locker: a.locker_id, member: event.member_id, detail: 'Turnike çıkışı' });
    },
    notice(gateEventId) {
      const al = db.prepare('SELECT l.label FROM locker_alerts al JOIN lockers l ON l.id=al.locker_id WHERE al.gate_event_id=?').get(gateEventId);
      return al ? { label: al.label, message: `${al.label} hâlâ sende görünüyor. Çıkışın kaydedildi ve yöneticiye bildirildi. Eşyalarını aldıysan “Dolabım” ekranından dolabı bırak.` } : null;
    }
  };

  function handle(method, pathname, body, u) {
    if (!u) fail('Oturum gerekli', 401);
    const route = pathname.slice('/api/lockers'.length);
    if (method === 'GET' && route === '/me') return me(u);
    if (method === 'POST' && route === '/claim') return claim(u, body);
    if (method === 'POST' && route === '/me/release') return release(u, body);
    // Everything below is admin-only: refuse other roles before validating the payload.
    admin(u);
    if (method === 'GET' && route === '') return overview();
    if (method === 'POST' && route === '') return create(u, body);
    let m = /^\/alerts\/(\d+)\/resolve$/.exec(route);
    if (m && method === 'POST') return resolveAlert(u, Number(m[1]), body);
    m = /^\/(\d+)(?:\/(rotate|assign|release))?$/.exec(route);
    if (m) {
      const id = Number(m[1]);
      if (method === 'PATCH' && !m[2]) return setStatus(u, id, body);
      if (method === 'POST' && m[2] === 'rotate') return rotate(u, id, body);
      if (method === 'POST' && m[2] === 'assign') return assign(u, id, body);
      if (method === 'POST' && m[2] === 'release') return adminRelease(u, id, body);
    }
    fail('API bulunamadı', 404);
  }
  handle.gate = gate;
  return handle;
};
module.exports.PREFIX = PREFIX;
module.exports.REASONS = REASONS;
module.exports.ACTIONS = ACTIONS;
