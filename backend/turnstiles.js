'use strict';
// Virtual turnstiles, SIMULATION ONLY. Three bidirectional gates, each with a fixed printable QR.
// The QR holds only a public gate identifier: no member data and no pass authority. A pass needs a
// signed-in member session; the server decides entry or exit from the member's stored presence.
// Nothing here opens a door, drives a relay or talks to hardware (that is TURNSTILE_ENABLED, separate).
const { randomBytes } = require('node:crypto');
const { createLimiter } = require('./security');
const PREFIX = 'FORMCLUB-GATE:1:';
const today = now => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const REASONS = {
  invalid_code: 'Bu bir FORM CLUB turnike QR kodu değil.',
  unknown_code: 'QR kodu geçersiz veya yenilenmiş. Turnikedeki güncel kodu okut.',
  inactive: 'Bu turnike şu an kapalı. Başka bir turnikeyi kullan.',
  membership: 'Aktif üyelik gerekli. Resepsiyona başvur.',
  too_soon: 'Az önce geçiş yaptın. Birkaç saniye sonra tekrar dene.'
};
const newCode = () => randomBytes(16).toString('hex');

module.exports = function createTurnstiles(db, { clock = Date.now, cooldownMs = 20000, scanLimit = 20 } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS gate_turnstiles(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, code_rotated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS gate_presence(member_id INTEGER PRIMARY KEY REFERENCES members(id),
    inside INTEGER NOT NULL DEFAULT 0, changed_at INTEGER NOT NULL, turnstile_id INTEGER REFERENCES gate_turnstiles(id));
  CREATE TABLE IF NOT EXISTS gate_events(id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id), user_id INTEGER NOT NULL REFERENCES users(id),
    turnstile_id INTEGER REFERENCES gate_turnstiles(id), direction TEXT CHECK(direction IN ('in','out')),
    result TEXT NOT NULL CHECK(result IN ('ok','rejected')), reason TEXT,
    idempotency_key TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, idempotency_key));
  CREATE INDEX IF NOT EXISTS gate_events_time ON gate_events(created_at);
  CREATE INDEX IF NOT EXISTS gate_events_member ON gate_events(member_id, created_at);`);
  const add = db.prepare('INSERT OR IGNORE INTO gate_turnstiles(id,name,code,active,code_rotated_at) VALUES(?,?,?,1,?)');
  for (const id of [1, 2, 3]) add.run(id, 'Turnike ' + id, newCode(), clock());

  const limit = createLimiter({ limit: scanLimit, windowMs: 60000, clock });
  const gates = () => db.prepare('SELECT id,name,code,active,code_rotated_at FROM gate_turnstiles ORDER BY id').all()
    .map(g => ({ ...g, active: !!g.active, qr: PREFIX + g.code }));
  const eventRow = e => ({ id: e.id, member_id: e.member_id, member: e.member, turnstile_id: e.turnstile_id, turnstile: e.turnstile,
    direction: e.direction, result: e.result, reason: e.reason, message: e.reason ? REASONS[e.reason] : null, at: e.created_at });
  const events = (where, ...args) => db.prepare(`SELECT e.*, m.name member, t.name turnstile FROM gate_events e
    JOIN members m ON m.id=e.member_id LEFT JOIN gate_turnstiles t ON t.id=e.turnstile_id ${where}
    ORDER BY e.created_at DESC, e.id DESC LIMIT 50`).all(...args).map(eventRow);
  const outcome = e => ({ ok: e.result === 'ok', direction: e.direction, reason: e.reason, message: e.reason ? REASONS[e.reason] : null,
    turnstile: e.turnstile_id ? db.prepare('SELECT name FROM gate_turnstiles WHERE id=?').get(e.turnstile_id)?.name : null, at: e.created_at, simulation: true });
  const admin = u => { if (u.role !== 'admin') fail('Yönetici yetkisi gerekli', 403); };

  function scan(u, body) {
    if (u.role !== 'member' || !u.member_id) fail('Üye hesabı gerekli', 403);
    const key = body.idempotency_key;
    if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(key)) fail('Geçersiz istek anahtarı');
    if (typeof body.code !== 'string' || body.code.length > 200) fail('Geçersiz QR');
    limit('gate:' + u.id);
    const now = clock(), raw = body.code.trim();
    db.exec('BEGIN IMMEDIATE');
    try {
      // Retried request (network drop, double tap): return the stored outcome, never a second pass.
      const seen = db.prepare('SELECT * FROM gate_events WHERE user_id=? AND idempotency_key=?').get(u.id, key);
      if (seen) { db.exec('COMMIT'); return { ...outcome(seen), replayed: true }; }
      const record = (turnstile, direction, reason) => {
        const id = Number(db.prepare(`INSERT INTO gate_events(member_id,user_id,turnstile_id,direction,result,reason,idempotency_key,created_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(u.member_id, u.id, turnstile, direction, reason ? 'rejected' : 'ok', reason, key, now).lastInsertRowid);
        return db.prepare('SELECT * FROM gate_events WHERE id=?').get(id);
      };
      let event;
      const gate = raw.startsWith(PREFIX) && /^[a-f0-9]{32}$/.test(raw.slice(PREFIX.length))
        ? db.prepare('SELECT * FROM gate_turnstiles WHERE code=?').get(raw.slice(PREFIX.length)) : undefined;
      const presence = db.prepare('SELECT * FROM gate_presence WHERE member_id=?').get(u.member_id);
      const inside = !!presence?.inside, direction = inside ? 'out' : 'in';
      if (!raw.startsWith(PREFIX)) event = record(null, null, 'invalid_code');
      else if (!gate) event = record(null, null, 'unknown_code');
      else if (!gate.active) event = record(gate.id, direction, 'inactive');
      else if (presence && now - presence.changed_at < cooldownMs) event = record(gate.id, direction, 'too_soon');
      else {
        // Entry needs an active membership; exit is never blocked by membership status.
        const m = db.prepare('SELECT status,expires FROM members WHERE id=?').get(u.member_id);
        if (direction === 'in' && (!m || m.status !== 'Aktif' || m.expires < today(now))) event = record(gate.id, direction, 'membership');
        else {
          event = record(gate.id, direction, null);
          db.prepare(`INSERT INTO gate_presence(member_id,inside,changed_at,turnstile_id) VALUES(?,?,?,?)
            ON CONFLICT(member_id) DO UPDATE SET inside=excluded.inside,changed_at=excluded.changed_at,turnstile_id=excluded.turnstile_id`)
            .run(u.member_id, direction === 'in' ? 1 : 0, now, gate.id);
        }
      }
      db.exec('COMMIT');
      return outcome(event);
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }

  return function handle(method, pathname, body, u) {
    if (!u) fail('Oturum gerekli', 401);
    const route = pathname.slice('/api/turnstiles'.length);
    if (method === 'POST' && route === '/scan') return scan(u, body);
    if (method === 'GET' && route === '/me') {
      if (u.role !== 'member' || !u.member_id) fail('Üye hesabı gerekli', 403);
      const p = db.prepare('SELECT inside,changed_at FROM gate_presence WHERE member_id=?').get(u.member_id);
      return { inside: !!p?.inside, since: p?.changed_at ?? null, cooldown_seconds: cooldownMs / 1000, events: events('WHERE e.member_id=?', u.member_id), simulation: true };
    }
    if (method === 'GET' && route === '') {
      admin(u);
      const inside = db.prepare(`SELECT p.member_id, m.name member, p.changed_at since, t.name turnstile FROM gate_presence p
        JOIN members m ON m.id=p.member_id LEFT JOIN gate_turnstiles t ON t.id=p.turnstile_id WHERE p.inside=1 ORDER BY p.changed_at DESC`).all();
      return { turnstiles: gates(), inside_count: inside.length, inside, events: events(''), cooldown_seconds: cooldownMs / 1000, simulation: true };
    }
    const m = /^\/(\d+)(\/rotate)?$/.exec(route);
    if (m && ((method === 'PATCH' && !m[2]) || (method === 'POST' && m[2]))) {
      admin(u);
      const id = Number(m[1]);
      if (!db.prepare('SELECT 1 FROM gate_turnstiles WHERE id=?').get(id)) fail('Turnike bulunamadı', 404);
      if (m[2]) db.prepare('UPDATE gate_turnstiles SET code=?, code_rotated_at=? WHERE id=?').run(newCode(), clock(), id);
      else {
        if (typeof body.active !== 'boolean') fail('active true veya false olmalı');
        db.prepare('UPDATE gate_turnstiles SET active=? WHERE id=?').run(body.active ? 1 : 0, id);
      }
      return { turnstile: gates().find(g => g.id === id) };
    }
    fail('API bulunamadı', 404);
  };
};
module.exports.PREFIX = PREFIX;
module.exports.REASONS = REASONS;
