/* Math Quest server – serves the site and stores players, quizzes, and goals in SQLite.
 *
 * Start it with:  node server.js        (or double-click start.bat)
 * Then open:      http://localhost:3000
 *
 * Forgot a password?  node server.js --reset-password "Player Name"
 *   (or double-click reset-password.bat). The player sets a new one at their next login.
 *
 * Settings (environment variables):
 *   PORT          port to listen on (default 3000)
 *   HOST          address to listen on (default 127.0.0.1 = this computer only)
 *   MATHQUEST_DB  database file (default data/mathquest.db next to this file)
 *
 * Uses Node's built-in SQLite (node:sqlite), so there is nothing to npm install.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exec } = require('node:child_process');

// node:sqlite prints an "experimental feature" notice on Node 22. Hide just that one.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite')) return;
  emitWarning.call(process, warning, ...rest);
};

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error(`Math Quest needs Node.js 22.13 or newer for its built-in SQLite. This computer has ${process.version}.`);
  process.exit(1);
}

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = path.resolve(process.env.MATHQUEST_DB || path.join(ROOT, 'data', 'mathquest.db'));
const MAX_BODY = 1024 * 1024;
const SESSION_HOURS = 12;          // a login stays valid this long after the last activity
const MAX_TRIES = 5;               // wrong passwords allowed before a short lockout
const LOCKOUT_MS = 60 * 1000;

// ---------- database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT    NOT NULL,
    avatar      TEXT    NOT NULL,
    grade       INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 12),
    created_at  INTEGER NOT NULL,
    last_grade  INTEGER,
    last_topic  TEXT,
    last_count  INTEGER
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id   TEXT    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    taken_at     INTEGER NOT NULL,
    grade        INTEGER NOT NULL,
    topic        TEXT    NOT NULL,
    topic_label  TEXT    NOT NULL,
    total        INTEGER NOT NULL,
    correct      INTEGER NOT NULL,
    pct          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS quizzes_by_profile ON quizzes (profile_id, taken_at);

  CREATE TABLE IF NOT EXISTS goals (
    id           TEXT PRIMARY KEY,
    profile_id   TEXT    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type         TEXT    NOT NULL,
    target       INTEGER NOT NULL,
    topic        TEXT    NOT NULL,
    grade        INTEGER,
    topic_label  TEXT,
    created_at   INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS goals_by_profile ON goals (profile_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    profile_id  TEXT    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
`);
// Databases made before logins existed get the password column added.
if (!db.prepare('PRAGMA table_info(profiles)').all().some((c) => c.name === 'password_hash')) {
  db.exec('ALTER TABLE profiles ADD COLUMN password_hash TEXT');
}

const sql = {
  players: db.prepare(`SELECT p.id, p.name, p.avatar, p.grade, p.password_hash IS NOT NULL AS has_password,
                              (SELECT COUNT(*) FROM quizzes q WHERE q.profile_id = p.id) AS quiz_count
                       FROM profiles p ORDER BY p.created_at`),
  getProfile: db.prepare('SELECT * FROM profiles WHERE id = ?'),
  findByName: db.prepare('SELECT * FROM profiles WHERE name = ? COLLATE NOCASE'),
  quizzesFor: db.prepare('SELECT * FROM quizzes WHERE profile_id = ? ORDER BY taken_at, id'),
  goalsFor: db.prepare('SELECT * FROM goals WHERE profile_id = ? ORDER BY created_at'),
  insertProfile: db.prepare('INSERT INTO profiles (id, name, avatar, grade, created_at, password_hash) VALUES (?, ?, ?, ?, ?, ?)'),
  updateProfile: db.prepare('UPDATE profiles SET name = ?, avatar = ?, grade = ?, last_grade = ?, last_topic = ?, last_count = ? WHERE id = ?'),
  setPassword: db.prepare('UPDATE profiles SET password_hash = ? WHERE id = ?'),
  deleteProfile: db.prepare('DELETE FROM profiles WHERE id = ?'),
  insertQuiz: db.prepare(`INSERT INTO quizzes (profile_id, taken_at, grade, topic, topic_label, total, correct, pct)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  insertGoal: db.prepare(`INSERT INTO goals (id, profile_id, type, target, topic, grade, topic_label, created_at, completed_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  completeGoal: db.prepare('UPDATE goals SET completed_at = ? WHERE id = ? AND profile_id = ? AND completed_at IS NULL'),
  deleteGoal: db.prepare('DELETE FROM goals WHERE id = ? AND profile_id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, profile_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
  touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteSessionsFor: db.prepare('DELETE FROM sessions WHERE profile_id = ?'),
  deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
};

function transaction(fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- passwords & sessions ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function startSession(profileId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sql.insertSession.run(hashToken(token), profileId, now, now + SESSION_HOURS * 3600e3);
  return token;
}

// Returns the logged-in profile row for this request, or throws 401.
function requireLogin(req) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Please log in');
  const tokenHash = hashToken(match[1]);
  const session = sql.getSession.get(tokenHash, Date.now());
  const profile = session && sql.getProfile.get(session.profile_id);
  if (!profile) throw new HttpError(401, 'Your login has ended. Please log in again.');
  sql.touchSession.run(Date.now() + SESSION_HOURS * 3600e3, tokenHash);
  profile.tokenHash = tokenHash;
  return profile;
}

// Slow down guessing: a few wrong passwords lock that player for a minute.
const failures = new Map();
function checkLockout(profileId) {
  const f = failures.get(profileId);
  if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong tries. Wait a minute and try again.');
}
function recordFailure(profileId) {
  const f = failures.get(profileId) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= MAX_TRIES) { f.count = 0; f.until = Date.now() + LOCKOUT_MS; }
  failures.set(profileId, f);
}

// The whole profile, in the shape the site uses.
function fullProfile(row) {
  return {
    id: row.id, name: row.name, avatar: row.avatar, grade: row.grade, createdAt: row.created_at,
    last: row.last_grade ? { grade: row.last_grade, topic: row.last_topic, count: row.last_count } : null,
    history: sql.quizzesFor.all(row.id).map((r) => ({
      at: r.taken_at, grade: r.grade, topic: r.topic, topicLabel: r.topic_label, total: r.total, right: r.correct, pct: r.pct,
    })),
    goals: sql.goalsFor.all(row.id).map((r) => ({
      id: r.id, type: r.type, target: r.target, topic: r.topic, grade: r.grade, topicLabel: r.topic_label,
      createdAt: r.created_at, completedAt: r.completed_at,
    })),
  };
}

// ---------- validation ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (what) => new HttpError(400, `Invalid ${what}`);
const ID_RE = /^[a-z0-9]{4,40}$/i;
const GOAL_TYPES = new Set(['quizzes', 'score', 'aGrades', 'streak']);

const id = (v, what = 'id') => { if (typeof v !== 'string' || !ID_RE.test(v)) throw bad(what); return v; };
const text = (v, max, what) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw bad(what);
  return v.trim();
};
const int = (v, min, max, what) => { if (!Number.isInteger(v) || v < min || v > max) throw bad(what); return v; };
const time = (v, what) => int(v, 0, Number.MAX_SAFE_INTEGER, what);
const password = (v) => {
  if (typeof v !== 'string' || v.length < 4) throw new HttpError(400, 'Passwords need at least 4 characters.');
  if (v.length > 64) throw new HttpError(400, 'Passwords can be at most 64 characters.');
  return v;
};

function uniqueName(name, exceptId) {
  const other = sql.findByName.get(name);
  if (other && other.id !== exceptId) throw new HttpError(409, `There's already a player named ${other.name}. Try a different name.`);
  return name;
}

// ---------- API ----------
function handleApi(req, method, parts, body) {
  const route = `${method} /${parts.join('/')}`;

  // Public: the names and avatars shown on the "Who's practicing?" screen.
  if (route === 'GET /players') {
    return sql.players.all().map((r) => ({
      id: r.id, name: r.name, avatar: r.avatar, grade: r.grade, quizzes: r.quiz_count, hasPassword: !!r.has_password,
    }));
  }

  // Create a player (and log them in).
  if (route === 'POST /players') {
    const name = uniqueName(text(body.name, 20, 'name'));
    const newId = crypto.randomBytes(8).toString('hex');
    sql.insertProfile.run(newId, name, text(body.avatar, 16, 'avatar'), int(body.grade, 1, 12, 'grade'), Date.now(), hashPassword(password(body.password)));
    return { token: startSession(newId), profile: fullProfile(sql.getProfile.get(newId)) };
  }

  // Log in. A player without a password yet (older data or a reset) sets one here.
  if (route === 'POST /login') {
    const row = sql.getProfile.get(id(body.id));
    if (!row) throw new HttpError(404, 'Player not found');
    checkLockout(row.id);
    const pw = password(body.password);
    if (!row.password_hash) sql.setPassword.run(hashPassword(pw), row.id);
    else if (!checkPassword(pw, row.password_hash)) {
      recordFailure(row.id);
      throw new HttpError(401, "That password isn't right. Try again!");
    }
    failures.delete(row.id);
    return { token: startSession(row.id), profile: fullProfile(sql.getProfile.get(row.id)) };
  }

  // Everything below needs a login and only touches that player's data.
  const me = requireLogin(req);

  if (route === 'POST /logout') { sql.deleteSession.run(me.tokenHash); return { ok: true }; }
  if (route === 'GET /me') return fullProfile(me);

  if (route === 'PATCH /me') {
    const last = body.last === undefined
      ? { grade: me.last_grade, topic: me.last_topic, count: me.last_count }
      : body.last && {
        grade: int(body.last.grade, 1, 12, 'last.grade'),
        topic: text(body.last.topic, 40, 'last.topic'),
        count: int(body.last.count, 1, 100, 'last.count'),
      };
    const name = body.name === undefined ? me.name : uniqueName(text(body.name, 20, 'name'), me.id);
    transaction(() => {
      sql.updateProfile.run(
        name,
        body.avatar === undefined ? me.avatar : text(body.avatar, 16, 'avatar'),
        body.grade === undefined ? me.grade : int(body.grade, 1, 12, 'grade'),
        last ? last.grade : null, last ? last.topic : null, last ? last.count : null,
        me.id,
      );
      if (body.password !== undefined) sql.setPassword.run(hashPassword(password(body.password)), me.id);
    });
    return { ok: true };
  }

  if (route === 'DELETE /me') { sql.deleteProfile.run(me.id); return { ok: true }; }

  if (route === 'POST /me/quizzes') {
    const q = body.quiz || {};
    const total = int(q.total, 1, 100, 'total');
    const values = [
      me.id, time(q.at, 'at'), int(q.grade, 1, 12, 'grade'), text(q.topic, 40, 'topic'), text(q.topicLabel, 60, 'topicLabel'),
      total, int(q.right, 0, total, 'right'), int(q.pct, 0, 100, 'pct'),
    ];
    const completed = Array.isArray(body.completedGoals) ? body.completedGoals : [];
    transaction(() => {
      sql.insertQuiz.run(...values);
      for (const g of completed) sql.completeGoal.run(time(g.completedAt, 'completedAt'), id(g.id, 'goal id'), me.id);
    });
    return { ok: true };
  }

  if (route === 'POST /me/goals') {
    const g = body.goal || {};
    if (!GOAL_TYPES.has(g.type)) throw bad('goal type');
    sql.insertGoal.run(
      id(g.id, 'goal id'), me.id, g.type, int(g.target, 1, 100, 'target'), text(g.topic, 40, 'topic'),
      g.grade == null ? null : int(g.grade, 1, 12, 'grade'),
      g.topicLabel == null ? null : text(g.topicLabel, 60, 'topicLabel'),
      time(g.createdAt, 'createdAt'), g.completedAt == null ? null : time(g.completedAt, 'completedAt'),
    );
    return { ok: true };
  }

  if (method === 'DELETE' && parts[0] === 'me' && parts[1] === 'goals' && parts[2] && parts.length === 3) {
    sql.deleteGoal.run(id(parts[2], 'goal id'), me.id);
    return { ok: true };
  }

  throw new HttpError(404, 'Not found');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const PRIVATE = new Set([__filename]);

function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return sendText(res, 400, 'Bad path'); }
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel));
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!file.startsWith(ROOT + path.sep) || !type || PRIVATE.has(file)) return sendText(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

// ---------- password reset from the command line ----------
const resetAt = process.argv.indexOf('--reset-password');
if (resetAt !== -1) {
  const name = (process.argv[resetAt + 1] || '').trim();
  const row = name && sql.findByName.get(name);
  if (!row) {
    console.log(name ? `No player named "${name}".` : 'Usage: node server.js --reset-password "Player Name"');
    console.log('Players:', sql.players.all().map((r) => r.name).join(', ') || '(none yet)');
    process.exit(1);
  }
  sql.setPassword.run(null, row.id);
  sql.deleteSessionsFor.run(row.id);
  console.log(`${row.name}'s password was cleared. They'll choose a new one the next time they log in.`);
  process.exit(0);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    return serveStatic(url.pathname, res);
  }
  try {
    let body = {};
    if (req.method === 'POST' || req.method === 'PATCH') {
      // Requiring JSON stops other websites from sending data here with a plain form.
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Expected JSON');
      body = await readJson(req);
      if (!body || typeof body !== 'object') throw bad('body');
    }
    const parts = url.pathname.split('/').filter(Boolean).slice(1);
    sendJson(res, 200, handleApi(req, req.method, parts, body));
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  }
});

const siteUrl = `http://localhost:${PORT}`;
function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${siteUrl}"` : process.platform === 'darwin' ? `open "${siteUrl}"` : `xdg-open "${siteUrl}"`;
  exec(cmd);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Math Quest may already be running at ${siteUrl}`);
    if (process.argv.includes('--open')) openBrowser();
  } else {
    console.error(e);
  }
  process.exit(1);
});

sql.deleteExpired.run(Date.now());
setInterval(() => sql.deleteExpired.run(Date.now()), 3600e3).unref();

server.listen(PORT, HOST, () => {
  console.log(`Math Quest is running at ${siteUrl}`);
  console.log(`Saving progress to ${DB_PATH}`);
  console.log('Keep this window open while playing. Press Ctrl+C to stop.');
  if (process.argv.includes('--open')) openBrowser();
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
