import session from "express-session";

export class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires);
    `);
    this.database = database;
    this.readSession = database.prepare("SELECT sess, expires FROM sessions WHERE sid = ?");
    this.writeSession = database.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
    `);
  }

  get(sid, callback) {
    try {
      const row = this.readSession.get(sid);
      if (!row || row.expires <= Date.now()) {
        if (row) this.destroy(sid, () => {});
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, value, callback) {
    try {
      const expires = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + Number(value.cookie?.maxAge ?? 60 * 60 * 1000);
      this.writeSession.run(sid, JSON.stringify(value), expires);
      this.database.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, value, callback) {
    try {
      const expires = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + Number(value.cookie?.maxAge ?? 60 * 60 * 1000);
      this.database.prepare("UPDATE sessions SET expires = ? WHERE sid = ?").run(expires, sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.database.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  clear(callback) {
    try {
      this.database.prepare("DELETE FROM sessions").run();
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  length(callback) {
    try {
      const result = this.database.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE expires > ?",
      ).get(Date.now());
      callback(null, result.count);
    } catch (error) {
      callback(error);
    }
  }

  all(callback) {
    try {
      const sessions = this.database.prepare(
        "SELECT sess FROM sessions WHERE expires > ?",
      ).all(Date.now()).map((row) => JSON.parse(row.sess));
      callback(null, sessions);
    } catch (error) {
      callback(error);
    }
  }
}
