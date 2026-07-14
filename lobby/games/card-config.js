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
  BERSERKER_HP_RATIO: 0.4,    // 狂战士被动触发血量比（HP≤40%时增伤）
  BERSERKER_BONUS: 3,         // 狂战士被动增伤量
  BERSERKER_SELF_DMG: 3,      // 狂战士主动血怒自扣血量
  CRYO_VULN: 3,               // 寒冰法师冻结易伤量（对手冻结时伤害+3）
  GUARDIAN_REDUCE: 0.5,       // 壁垒守卫减伤比例
  PALADIN_SHIELD_BONUS: 3,    // 圣骑士被动叠盾量（已有护盾时额外+盾）
  WARLOCK_POISON: 7,          // 术士诅咒叠毒层数
  WARLOCK_HEAL: 5,            // 术士诅咒回血量
  GAMBLER_BACKFIRE: 0.2,      // 赌徒随机牌反噬概率(20%)
  GAMBLER_BACKFIRE_DMG: 5,    // 赌徒反噬无负面牌时的扣血量
  TYCOON_SAVE_THRESHOLD: 5,  // 财阀被动囤水晶阈值(剩余水晶≥5时存入储蓄)
  TYCOON_DMG_PER_SAVE: 2,    // 财阀主动每点水晶造成伤害(消耗当前全部水晶)
  UNDEAD_DMG: 6,             // 不死族主动亡者汲取伤害
  UNDEAD_HEAL: 8,            // 不死族主动亡者汲取回血
  STATUS_DURATION: 3         // 灼烧持续回合数
};
