/* 卡牌游戏全局配置 - 所有逻辑无关的游戏规则参数集中在此，便于平衡性调整 */

module.exports = {
  /* 基础规则 */
  MAX_MANA: 10,              // 水晶上限
  START_HAND: 4,             // 开局抽牌数
  TURN_DRAW: 3,               // 每回合抽牌数
  START_HP: 100,              // 初始血量

  /* 抽牌概率 */
  COST_WEIGHT_BASE: 14,       // 费用加权曲线基数（权重 = max(1, COST_WEIGHT_BASE - cost)）
  RARITY_WEIGHTS: { common: 60, uncommon: 30, rare: 10 }, // 分层抽牌稀有度权重

  /* 英雄/卡牌效果参数 */
  BERSERKER_HP_RATIO: 0.3,    // 狂战士被动触发血量比（HP≤30%时增伤）
  GUARDIAN_REDUCE: 0.5,       // 壁垒守卫减伤比例
  STATUS_DURATION: 3,         // 灼烧持续回合数
  DOOM_DAMAGE_PER_STACK: 20    // 死亡倒计时每层爆发伤害
};
