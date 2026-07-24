/* 卡牌游戏全局配置 - 默认值 + 数据库动态覆盖
 * 管理后台修改数值存数据库，loadFromDB() 加载覆盖，get() 动态读取。
 * 默认值始终保留，删除数据库配置即恢复默认。
 */

// 默认值(管理后台"恢复默认"时回到这些值)
const DEFAULTS = {
  /* 基础规则 */
  MAX_MANA: 10,
  START_HAND: 4,
  TURN_DRAW: 3,
  START_HP: 100,

  /* 抽牌概率 */
  COST_WEIGHT_BASE: 14,
  RARITY_WEIGHTS: { common: 60, uncommon: 30, rare: 10 },

  /* 英雄/卡牌效果参数 */
  BERSERKER_HP_RATIO: 0.4,
  BERSERKER_BONUS: 3,
  BERSERKER_SELF_DMG: 3,
  CRYO_VULN: 3,
  GUARDIAN_REDUCE: 0.5,
  PALADIN_SHIELD_BONUS: 3,
  WARLOCK_POISON: 7,
  WARLOCK_HEAL: 5,
  GAMBLER_BACKFIRE: 0.2,
  GAMBLER_BACKFIRE_DMG: 5,
  TYCOON_SAVE_THRESHOLD: 0,
  TYCOON_DMG_PER_SAVE: 2,
  TYCOON_BASE_DAMAGE: 10,
  UNDEAD_DMG: 6,
  UNDEAD_HEAL: 8,
  STATUS_DURATION: 3
};

// 数据库覆盖值(管理后台修改后存这里)
let _overrides = {};

const GAME_TYPE = 'card';

// 动态读取：优先用数据库覆盖值，无则用默认值
function get(key) {
  if (key in _overrides) return _overrides[key];
  return DEFAULTS[key];
}

// 从数据库加载覆盖值
function loadFromDB(db) {
  if (!db) return;
  try {
    _overrides = db.getAllConfig(GAME_TYPE) || {};
  } catch (e) {
    _overrides = {};  // 数据库未就绪时用默认值
  }
}

// 返回所有配置(默认值+覆盖值)，供管理后台展示
function getAllConfig() {
  return { ...DEFAULTS, ..._overrides };
}

// 返回默认值，供"恢复默认"
function getDefaults() {
  return { ...DEFAULTS };
}

// 管理后台保存后调用：更新单个配置到数据库 + 刷新覆盖值
function saveConfig(db, key, value) {
  if (!db) return;
  db.setConfig(GAME_TYPE, key, value);
  _overrides[key] = value;
}

// 恢复单个配置为默认值
function resetConfig(db, key) {
  if (!db) return;
  db.deleteConfig(GAME_TYPE, key);
  delete _overrides[key];
}

// 恢复全部为默认值
function resetAll(db) {
  if (!db) return;
  db.clearConfig(GAME_TYPE);
  _overrides = {};
}

module.exports = {
  get,
  loadFromDB,
  getAllConfig,
  getDefaults,
  saveConfig,
  resetConfig,
  resetAll,
  DEFAULTS
};
