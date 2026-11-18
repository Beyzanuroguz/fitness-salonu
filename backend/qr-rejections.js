'use strict';

// An audit event represents a burst of identical rejections. Each request key still
// points to its original outcome, even if the underlying conditions later change.
module.exports = function rejectedScans(db, scope) {
  db.exec(`CREATE TABLE IF NOT EXISTS qr_rejection_replays(
    scope TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    PRIMARY KEY(scope, user_id, request_key));`);
  const add = db.prepare('INSERT INTO qr_rejection_replays VALUES(?,?,?,?)');
  const find = db.prepare('SELECT * FROM qr_rejection_replays WHERE scope=? AND user_id=? AND request_key=?');
  return {
    find(user, key) { return find.get(scope, user, key); },
    link(user, key, event) { add.run(scope, user, key, event.id); return event; }
  };
};
