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
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  result TEXT NOT NULL,
  score_change INTEGER NOT NULL,
  elo_change INTEGER NOT NULL,
  played_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_records_account ON records(account_id);
CREATE INDEX IF NOT EXISTS idx_records_time ON records(played_at);
`);
// accounts 加战绩字段(阶段2新增，老库容错：字段已存在则跳过)
function addColumnIfMissing(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumnIfMissing('accounts', 'elo', 'INTEGER NOT NULL DEFAULT 1000');
addColumnIfMissing('accounts', 'wins', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('accounts', 'losses', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('accounts', 'draws', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('accounts', 'title', "TEXT DEFAULT NULL");        // 称号(玩家自定义文字)
addColumnIfMissing('accounts', 'name_color', "TEXT DEFAULT NULL");  // 彩名颜色(如 #f1c40f)

/* ==================== 账号 CRUD ==================== */
const stmtGetByUsername = db.prepare('SELECT * FROM accounts WHERE username = ?');
const stmtGetById = db.prepare('SELECT * FROM accounts WHERE id = ?');
const stmtInsertAccount = db.prepare(
  'INSERT INTO accounts (username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)'
);
const stmtUpdateNickname = db.prepare('UPDATE accounts SET nickname = ? WHERE id = ?');
const stmtUpdateAppearance = db.prepare('UPDATE accounts SET title = ?, name_color = ? WHERE id = ?');

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

// 改外观(称号+彩名)：title/name_color 允许 null(清空)，返回更新后的 account
function updateAppearance(accountId, title, nameColor) {
  const info = stmtUpdateAppearance.run(title, nameColor, accountId);
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

/* ==================== 战绩 records ==================== */
const stmtInsertRecord = db.prepare(
  'INSERT INTO records (account_id, game_type, result, score_change, elo_change, played_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const stmtUpdateElo = db.prepare(
  'UPDATE accounts SET elo = elo + ?, wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE id = ?'
);
const stmtGetRecent = db.prepare(
  'SELECT game_type, result, score_change, elo_change, played_at FROM records WHERE account_id = ? ORDER BY played_at DESC LIMIT ?'
);
const stmtGetStatsByGame = db.prepare(
  `SELECT game_type,
     SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
     SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses,
     SUM(CASE WHEN result='draw' THEN 1 ELSE 0 END) as draws
   FROM records WHERE account_id = ? GROUP BY game_type`
);

// 记录一局战绩：写 record + 更新 accounts 的 elo/胜负场(一个事务)
function recordMatch(accountId, gameType, result, scoreChange, eloChange) {
  const now = Date.now();
  const tx = db.transaction(() => {
    stmtInsertRecord.run(accountId, gameType, result, scoreChange, eloChange, now);
    const w = result === 'win' ? 1 : 0;
    const l = result === 'loss' ? 1 : 0;
    const d = result === 'draw' ? 1 : 0;
    stmtUpdateElo.run(eloChange, w, l, d, accountId);
  });
  tx();
}

// 个人战绩统计：总elo/胜负平 + 各游戏分别 + 最近N局
function getAccountStats(accountId, recentLimit = 10) {
  const acc = getAccountById(accountId);
  if (!acc) return null;
  const byGame = stmtGetStatsByGame.all(accountId);
  const recent = stmtGetRecent.all(accountId, recentLimit);
  const total = byGame.reduce((s, g) => ({
    wins: s.wins + g.wins, losses: s.losses + g.losses, draws: s.draws + g.draws
  }), { wins: 0, losses: 0, draws: 0 });
  return {
    nickname: acc.nickname,
    elo: acc.elo,
    totalGames: total.wins + total.losses + total.draws,
    wins: total.wins, losses: total.losses, draws: total.draws,
    winRate: (total.wins + total.losses + total.draws) > 0
      ? Math.round(total.wins / (total.wins + total.losses + total.draws) * 100) : 0,
    byGame,
    recent
  };
}

// 排行榜：scope = total/mahjong/card/poker/monopoly/weekly/monthly
function getLeaderboard(scope = 'total', limit = 50) {
  // 总榜/周榜/月榜按 accounts.elo；分游戏榜按该游戏胜率(需有该游戏对局)
  if (scope === 'total') {
    return db.prepare('SELECT nickname, elo, wins, losses, draws, title, name_color as nameColor FROM accounts WHERE (wins+losses+draws) > 0 ORDER BY elo DESC, wins DESC LIMIT ?').all(limit);
  }
  if (scope === 'weekly' || scope === 'monthly') {
    const days = scope === 'weekly' ? 7 : 30;
    const since = Date.now() - days * 24 * 3600 * 1000;
    return db.prepare(
      `SELECT a.nickname, a.title, a.name_color as nameColor,
         SUM(CASE WHEN r.result='win' THEN 1 ELSE 0 END) as wins,
         SUM(CASE WHEN r.result='loss' THEN 1 ELSE 0 END) as losses,
         SUM(CASE WHEN r.result='draw' THEN 1 ELSE 0 END) as draws,
         SUM(r.elo_change) as elo_gain
       FROM records r JOIN accounts a ON r.account_id = a.id
       WHERE r.played_at >= ?
       GROUP BY r.account_id ORDER BY elo_gain DESC LIMIT ?`
    ).all(since, limit);
  }
  // 分游戏榜：该游戏胜场数排序(玩得多且赢得多靠前)
  const validGames = ['mahjong', 'card', 'poker', 'monopoly'];
  if (!validGames.includes(scope)) return [];
  return db.prepare(
    `SELECT a.nickname, a.elo, a.title, a.name_color as nameColor,
       SUM(CASE WHEN r.result='win' THEN 1 ELSE 0 END) as wins,
       SUM(CASE WHEN r.result='loss' THEN 1 ELSE 0 END) as losses,
       COUNT(*) as games
     FROM records r JOIN accounts a ON r.account_id = a.id
     WHERE r.game_type = ?
     GROUP BY r.account_id ORDER BY wins DESC, games DESC LIMIT ?`
  ).all(scope, limit);
}

module.exports = {
  db,
  createAccount,
  verifyAccount,
  getAccountById,
  getAccountByUsername,
  updateNickname,
  updateAppearance,
  createSession,
  verifySession,
  deleteSession,
  deleteSessionsByAccount,
  cleanExpiredSessions,
  recordMatch,
  getAccountStats,
  getLeaderboard,
};
