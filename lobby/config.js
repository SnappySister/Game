/* 集中配置 - 优先读环境变量(服务器pm2注入/本地.env)，fallback默认值
 * 密钥(SESSION_SECRET)绝不硬编码，必须从环境变量读，本地开发用 .env(已gitignore)。
 * 配置示例见 config.example.json / .env.example
 */

// 本地开发时加载 .env 文件(已gitignore)；服务器用 pm2 注入环境变量，无 .env 也不报错
try { require('dotenv').config(); } catch (e) { /* dotenv 未装则跳过，依赖服务器环境变量 */ }

const config = {
  PORT: parseInt(process.env.PORT) || 3456,
  DB_PATH: process.env.DB_PATH || '',  // 留空则用 db.js 默认(lobby/data/game.db)；设绝对路径则覆盖
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  SESSION_TTL_DAYS: parseInt(process.env.SESSION_TTL_DAYS) || 7,
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 10,
  RECONNECT_GRACE_MS: parseInt(process.env.RECONNECT_GRACE_MS) || 120000,
  // 开发环境警告：SESSION_SECRET 用了默认值
  _insecureSecret: !process.env.SESSION_SECRET
};

if (config._insecureSecret) {
  console.warn('[安全警告] SESSION_SECRET 未设置，使用不安全的默认值。生产环境必须设置环境变量 SESSION_SECRET');
}

module.exports = config;
