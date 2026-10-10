// ==========================================
// connor.fm — database (Durable Object with SQLite)
//
// Everything that changes often or needs to be exact:
// page views, plays, access codes, listening sessions,
// comments, questions and rate limits.
//
// Cloudflare creates it automatically on deploy
// (see "migrations" in wrangler.jsonc).
// ==========================================

import { DurableObject } from "cloudflare:workers";

const DAY = 24 * 60 * 60 * 1000;


export class Database extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS views (
        day TEXT NOT NULL,
        path TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path)
      );

      CREATE TABLE IF NOT EXISTS visitors (
        day TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (day, hash)
      );

      CREATE TABLE IF NOT EXISTS codes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        code_id TEXT NOT NULL,
        expires INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        code_id TEXT,
        track TEXT,
        title TEXT
      );

      CREATE INDEX IF NOT EXISTS events_code ON events (code_id, ts);

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        track TEXT NOT NULL,
        at REAL,
        name TEXT,
        text TEXT NOT NULL,
        code_id TEXT
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        text TEXT NOT NULL,
        answer TEXT NOT NULL DEFAULT '',
        published INTEGER NOT NULL DEFAULT 0,
        answered INTEGER
      );

      CREATE TABLE IF NOT EXISTS ratelimits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset INTEGER NOT NULL
      );
    `);
  }


  // ---------- rate limiting ----------

  rateLimit(key, max, windowSeconds) {
    const now = Date.now();
    const row = this.sql.exec("SELECT count, reset FROM ratelimits WHERE key = ?", key).toArray()[0];

    if (!row || row.reset <= now) {
      this.sql.exec(
        "INSERT OR REPLACE INTO ratelimits (key, count, reset) VALUES (?, 1, ?)",
        key,
        now + windowSeconds * 1000
      );
      return true;
    }

    if (row.count >= max) {
      return false;
    }

    this.sql.exec("UPDATE ratelimits SET count = count + 1 WHERE key = ?", key);
    return true;
  }


  // ---------- page views ----------

  hit(path, visitorHash) {
    const day = today();

    this.sql.exec(
      `INSERT INTO views (day, path, count) VALUES (?, ?, 1)
       ON CONFLICT (day, path) DO UPDATE SET count = count + 1`,
      day,
      path
    );

    this.sql.exec("INSERT OR IGNORE INTO visitors (day, hash) VALUES (?, ?)", day, visitorHash);

    // Housekeeping now and then.
    if (Math.random() < 0.01) {
      const cutoff = isoDay(Date.now() - 400 * DAY);
      this.sql.exec("DELETE FROM visitors WHERE day < ?", cutoff);
      this.sql.exec("DELETE FROM ratelimits WHERE reset < ?", Date.now());
      this.sql.exec("DELETE FROM sessions WHERE expires < ?", Date.now());
    }
  }


  stats(days) {
    const from = isoDay(Date.now() - (days - 1) * DAY);

    const daily = this.sql.exec(
      `SELECT d.day,
              (SELECT COALESCE(SUM(count), 0) FROM views v WHERE v.day = d.day) AS views,
              (SELECT COUNT(*) FROM visitors s WHERE s.day = d.day) AS visitors
       FROM (SELECT DISTINCT day FROM views WHERE day >= ?) d
       ORDER BY d.day`,
      from
    ).toArray();

    const pages = this.sql.exec(
      `SELECT path, SUM(count) AS views FROM views
       WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 20`,
      from
    ).toArray();

    const tracks = this.sql.exec(
      `SELECT track, MAX(title) AS title,
              SUM(type = 'play') AS plays,
              SUM(type = 'complete') AS completes,
              COUNT(DISTINCT CASE WHEN type = 'play' THEN code_id END) AS listeners
       FROM events
       WHERE type IN ('play', 'complete') AND ts >= ?
       GROUP BY track ORDER BY plays DESC`,
      Date.now() - days * DAY
    ).toArray();

    const unlocks = this.sql.exec(
      "SELECT COUNT(*) AS n FROM events WHERE type = 'unlock' AND ts >= ?",
      Date.now() - days * DAY
    ).one().n;

    return { daily, pages, tracks, unlocks };
  }


  // ---------- access codes ----------

  listCodes() {
    return this.sql.exec(
      `SELECT c.id, c.label, c.code, c.active, c.created,
              (SELECT COUNT(*) FROM events e WHERE e.code_id = c.id AND e.type = 'unlock') AS unlocks,
              (SELECT COUNT(*) FROM events e WHERE e.code_id = c.id AND e.type = 'play') AS plays,
              (SELECT COUNT(*) FROM events e WHERE e.code_id = c.id AND e.type = 'complete') AS completes,
              (SELECT MAX(ts) FROM events e WHERE e.code_id = c.id) AS last_seen
       FROM codes c ORDER BY c.created DESC`
    ).toArray();
  }


  createCode(label, code) {
    if (this.sql.exec("SELECT 1 FROM codes WHERE code = ?", code).toArray().length) {
      return { error: "This code already exists." };
    }

    const id = crypto.randomUUID();

    this.sql.exec(
      "INSERT INTO codes (id, label, code, active, created) VALUES (?, ?, ?, 1, ?)",
      id,
      label,
      code,
      Date.now()
    );

    return { id };
  }


  updateCode(id, { label, active }) {
    if (typeof label === "string") {
      this.sql.exec("UPDATE codes SET label = ? WHERE id = ?", label, id);
    }

    if (typeof active === "boolean") {
      this.sql.exec("UPDATE codes SET active = ? WHERE id = ?", active ? 1 : 0, id);

      if (!active) {
        this.sql.exec("DELETE FROM sessions WHERE code_id = ?", id);
      }
    }
  }


  deleteCode(id) {
    this.sql.exec("DELETE FROM codes WHERE id = ?", id);
    this.sql.exec("DELETE FROM sessions WHERE code_id = ?", id);
  }


  codeCount() {
    return this.sql.exec("SELECT COUNT(*) AS n FROM codes").one().n;
  }


  codeActivity(id) {
    const tracks = this.sql.exec(
      `SELECT track, MAX(title) AS title,
              SUM(type = 'play') AS plays,
              SUM(type = 'complete') AS completes,
              MAX(ts) AS last
       FROM events WHERE code_id = ? AND type IN ('play', 'complete')
       GROUP BY track ORDER BY last DESC`,
      id
    ).toArray();

    const recent = this.sql.exec(
      "SELECT ts, type, title FROM events WHERE code_id = ? ORDER BY ts DESC LIMIT 30",
      id
    ).toArray();

    return { tracks, recent };
  }


  // Opens a listening session for a code. Returns null for unknown or paused codes.
  unlock(code, token, ttlSeconds) {
    const row = this.sql.exec("SELECT id FROM codes WHERE code = ? AND active = 1", code).toArray()[0];

    if (!row) {
      return null;
    }

    this.sql.exec(
      "INSERT INTO sessions (token, code_id, expires) VALUES (?, ?, ?)",
      token,
      row.id,
      Date.now() + ttlSeconds * 1000
    );

    this.logEvent("unlock", row.id);

    return row.id;
  }


  // The code behind a listening session, if the session and the code are still valid.
  sessionCode(token) {
    const row = this.sql.exec(
      `SELECT s.code_id FROM sessions s JOIN codes c ON c.id = s.code_id
       WHERE s.token = ? AND s.expires > ? AND c.active = 1`,
      token,
      Date.now()
    ).toArray()[0];

    return row ? row.code_id : null;
  }


  logEvent(type, codeId, track = null, title = null) {
    this.sql.exec(
      "INSERT INTO events (ts, type, code_id, track, title) VALUES (?, ?, ?, ?, ?)",
      Date.now(),
      type,
      codeId,
      track,
      title
    );
  }


  // ---------- comments ----------

  listComments(withCode = false) {
    const rows = this.sql.exec(
      `SELECT m.id, m.ts, m.track, m.at, m.name, m.text, m.code_id, c.label AS code_label
       FROM comments m LEFT JOIN codes c ON c.id = m.code_id
       ORDER BY m.ts DESC`
    ).toArray();

    return withCode
      ? rows
      : rows.map(({ id, ts, track, at, name, text }) => ({ id, ts, track, at, name, text }));
  }


  addComment({ track, at, name, text, codeId }) {
    const id = crypto.randomUUID();

    this.sql.exec(
      "INSERT INTO comments (id, ts, track, at, name, text, code_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      Date.now(),
      track,
      at,
      name,
      text,
      codeId
    );

    return { id, ts: Date.now(), track, at, name, text };
  }


  deleteComment(id) {
    this.sql.exec("DELETE FROM comments WHERE id = ?", id);
  }


  // ---------- questions ----------

  addQuestion(text) {
    this.sql.exec(
      "INSERT INTO questions (id, ts, text) VALUES (?, ?, ?)",
      crypto.randomUUID(),
      Date.now(),
      text
    );
  }


  listQuestions(publishedOnly) {
    return publishedOnly
      ? this.sql.exec(
          `SELECT id, ts, text, answer, answered FROM questions
           WHERE published = 1 AND answer != '' ORDER BY answered DESC`
        ).toArray()
      : this.sql.exec("SELECT * FROM questions ORDER BY ts DESC").toArray();
  }


  updateQuestion(id, { answer, published }) {
    if (typeof answer === "string") {
      this.sql.exec(
        "UPDATE questions SET answer = ?, answered = CASE WHEN ? = '' THEN NULL ELSE COALESCE(answered, ?) END WHERE id = ?",
        answer,
        answer,
        Date.now(),
        id
      );
    }

    if (typeof published === "boolean") {
      this.sql.exec("UPDATE questions SET published = ? WHERE id = ?", published ? 1 : 0, id);
    }
  }


  deleteQuestion(id) {
    this.sql.exec("DELETE FROM questions WHERE id = ?", id);
  }
}


function isoDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}


function today() {
  return isoDay(Date.now());
}
