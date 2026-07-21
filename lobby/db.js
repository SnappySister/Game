/* 数据库封装 - SQLite（better-sqlite3）
 * 表：accounts(账号) + sessions(登录会话)
 * 所有查询用参数化(?)防注入。密码用 bcrypt 加盐哈希，绝不存明文。
 * 数据库文件 lobby/data/game.db 已被 .gitignore 忽略。
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const config = require('./config');

// 数据库路径：config.DB_PATH 为空时默认 lobby/data/game.db(相对本文件)；绝对路径则用它
const DB_PATH = config.DB_PATH && path.isAbsolute(config.DB_PATH)
  ? config.DB_PATH
  : path.join(__dirname, 'data', 'game.db');
// 确保目录存在
const dbDir = path.dirname(DB_PATH);
if (!require('fs').existsSync(dbDir)) require('fs').mkdirSync(dbDir, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');  // 并发读写更稳

/* ==================== 建表 ==================== */
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

/* ==================== 账号 CRUD ==================== */
const stmtGetByUsername = db.prepare('SELECT * FROM accounts WHERE username = ?');
const stmtGetById = db.prepare('SELECT * FROM accounts WHERE id = ?');
const stmtInsertAccount = db.prepare(
  'INSERT INTO accounts (username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)'
);
const stmtUpdateNickname = db.prepare('UPDATE accounts SET nickname = ? WHERE id = ?');

// 注册：返回 {id, username, nickname} 或抛错(用户名重复)
function createAccount(username, password, nickname) {
  const existing = stmtGetByUsername.get(username);
  if (existing) throw new Error('USERNAME_EXISTS');
  const hash = bcrypt.hashSync(password, config.BCRYPT_ROUNDS);
  const now = Date.now();
  const info = stmtInsertAccount.run(username, hash, nickname, now);
  return { id: info.lastInsertRowid, username, nickname };
}

// 登录校验：返回 account 或 null(用户名不存在/密码错)
function verifyAccount(username, password) {
  const acc = stmtGetByUsername.get(username);
  if (!acc) return null;
  if (!bcrypt.compareSync(password, acc.password_hash)) return null;
  return acc;
}

function getAccountById(id) {
  return stmtGetById.get(id) || null;
}

function getAccountByUsername(username) {
  return stmtGetByUsername.get(username) || null;
}

// 改昵称：返回更新后的 account 或 null(账号不存在)
function updateNickname(accountId, newNickname) {
  const info = stmtUpdateNickname.run(newNickname, accountId);
  if (info.changes === 0) return null;
  return getAccountById(accountId);
}

/* ==================== 会话 session ==================== */
const SESSION_TTL_MS = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const stmtInsertSession = db.prepare('INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)');
const stmtGetSession = db.prepare('SELECT * FROM sessions WHERE token = ?');
const stmtDeleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const stmtDeleteSessionByAccount = db.prepare('DELETE FROM sessions WHERE account_id = ?');
const stmtCleanExpired = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

// 创建会话：返回 token
function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  stmtInsertSession.run(token, accountId, expiresAt);
  return token;
}

// 校验会话：返回 account 或 null(不存在/过期)
function verifySession(token) {
  if (!token) return null;
  const sess = stmtGetSession.get(token);
  if (!sess) return null;
  if (sess.expires_at < Date.now()) {
    stmtDeleteSession.run(token);
    return null;
  }
  return getAccountById(sess.account_id);
}

function deleteSession(token) {
  if (token) stmtDeleteSession.run(token);
}

// 删除某账号所有会话(用于改密码/封禁等，本阶段暂不用)
function deleteSessionsByAccount(accountId) {
  stmtDeleteSessionByAccount.run(accountId);
}

// 清理过期会话(启动时调用一次)
function cleanExpiredSessions() {
  return stmtCleanExpired.run(Date.now()).changes;
}

module.exports = {
  db,
  createAccount,
  verifyAccount,
  getAccountById,
  getAccountByUsername,
  updateNickname,
  createSession,
  verifySession,
  deleteSession,
  deleteSessionsByAccount,
  cleanExpiredSessions,
};
