/* 卡牌数据 - 所有卡牌定义集中在此，便于数值平衡调整 */

const CARDS = [
  /* ===== 基础牌(1费) ===== */
  { id: 'fireball',  name: '火球术',   type: 'damage',    value: 7,  cost: 1, color: '#e74c3c', rarity: 'common', desc: '造成7点伤害' },
  { id: 'heal',      name: '治疗术',   type: 'heal',      value: 7,  cost: 1, color: '#2ecc71', rarity: 'common', desc: '恢复7点生命' },
  { id: 'shield',    name: '圣盾',     type: 'shield',    value: 7,  cost: 1, color: '#3498db', rarity: 'common', desc: '获得7点护盾' },
  { id: 'overload',  name: '过载',     type: 'cond_draw',  value: 3,  cost: 1, color: '#1abc9c', rarity: 'common', desc: '手牌≤2张时抽3张，否则抽1张' },

  /* ===== 低费功能牌(2费) ===== */
  { id: 'chaos',     name: '混沌',     type: 'chaos',     value: 6,  cost: 2, color: '#f39c12', rarity: 'common', desc: '随机效果(伤害、治疗、护盾、净化、中毒、灼烧、冰冻)' },
  { id: 'steal',     name: '顺手牵羊', type: 'steal',     value: 0,  cost: 2, color: '#2c3e50', rarity: 'common', desc: '随机偷对手1张牌' },
  { id: 'treasure',  name: '宝藏',     type: 'equip_mana', value: 1,  cost: 2, color: '#f1c40f', rarity: 'uncommon', equipMana: 2, equipTurns: 2, desc: '装备2回合，每回合开始水晶+2' },
  { id: 'laststand', name: '背水一战', type: 'cond_damage', value: 15, cost: 2, color: '#c0392b', rarity: 'uncommon', hpThreshold: 40, lowDmg: 5, desc: '自己HP≤40时造成15点普通伤害，否则5点' },
  { id: 'holylight', name: '圣光',     type: 'cleanse_lite', value: 0, cost: 2, color: '#ecf0f1', rarity: 'rare', desc: '清除对面所有随从（含壁垒守卫）' },

  /* ===== 中费牌(3费) ===== */
  { id: 'poison',    name: '毒雾',     type: 'poison',    value: 8,  cost: 3, color: '#27ae60', rarity: 'common', stacks: 3, desc: '造成8伤并中毒3层' },
  { id: 'arcane',    name: '奥术智慧', type: 'draw',      value: 2,  cost: 3, color: '#1abc9c', rarity: 'common', desc: '抽2张牌' },
  { id: 'sprint',    name: '疾风斩',   type: 'draw_dmg',  value: 8,  cost: 3, color: '#e67e22', rarity: 'common', desc: '造成8伤并抽1' },
  { id: 'ward',      name: '护罩',     type: 'ward',      value: 0,  cost: 3, color: '#f1c40f', rarity: 'common', desc: '下回合免疫负面效果' },
  { id: 'freeze',    name: '冰封',     type: 'freeze',    value: 0,  cost: 3, color: '#00bcd4', rarity: 'common', desc: '冻结对手1回合' },
  { id: 'block',     name: '格挡',     type: 'block',     value: 0,  cost: 3, color: '#f1c40f', rarity: 'uncommon', desc: '免疫下回合所有伤害' },
  { id: 'blade',     name: '影刃',     type: 'equip',     value: 4,  cost: 3, color: '#95a5a6', rarity: 'uncommon', equipDmg: 4, equipTurns: 3, desc: '装备3回合，每回合开始对对手造成4点普通伤害' },
  { id: 'guard_shield', name: '守护者之盾', type: 'equip_shield', value: 5, cost: 3, color: '#2980b9', rarity: 'uncommon', equipShield: 5, equipTurns: 3, desc: '装备3回合，每回合开始获得5点护盾' },
  { id: 'icearmor', name: '寒冰护甲', type: 'shield', value: 10, cost: 3, color: '#3498db', rarity: 'uncommon', desc: '获得10点护盾（纯防御）' },
  { id: 'guardian',  name: '壁垒守卫', type: 'summon_guard',  value: 0,  cost: 3, color: '#3498db', rarity: 'rare', summonTurns: 3, desc: '召唤壁垒守卫，在场3回合期间受到的普通伤害减半' },
  { id: 'energyburst', name: '能量爆发', type: 'rand_mana', value: 3, cost: 3, color: '#f39c12', rarity: 'uncommon', desc: '造成(当前剩余水晶×3)点普通伤害，剩余水晶越多越强' },

  /* ===== 中高费牌(4费) ===== */
  { id: 'lightning', name: '闪电箭', type: 'damage', value: 9, cost: 3, color: '#f1c40f', rarity: 'common', desc: '造成9点普通伤害' },
  { id: 'sacrifice', name: '献祭',     type: 'sacrifice', value: 15, cost: 4, color: '#8e44ad', rarity: 'uncommon', desc: '自扣8血，对手扣15真伤' },
  { id: 'combust',   name: '烈焰',     type: 'combust',   value: 3,  cost: 5, color: '#e67e22', rarity: 'uncommon', fixedDmg: 9, desc: '造成9伤并灼烧3层' },
  { id: 'poisoncloud', name: '毒云术', type: 'poison', value: 6,  cost: 4, color: '#27ae60', rarity: 'uncommon', stacks: 4, desc: '造成6伤并中毒4层' },
  { id: 'cleanse',   name: '净化',     type: 'cleanse',   value: 3,  cost: 4, color: '#ecf0f1', rarity: 'common', desc: '清除自身所有负面效果并恢复3点生命' },
  { id: 'delay_dmg', name: '火灵', type: 'summon_fire', value: 5, cost: 4, color: '#e67e22', rarity: 'rare', summonDmg: 5, summonIncr: 2, summonTurns: 3, desc: '召唤火灵，在场3回合每回合对对手造成5/7/9点递增普通伤害' },
  { id: 'execute',  name: '斩杀',     type: 'cond_kill',  value: 0,  cost: 4, color: '#c0392b', rarity: 'uncommon', hpThreshold: 15, normalDmg: 8, desc: '对手HP≤15直接斩杀，否则造成8点普通伤害' },
  { id: 'pact',      name: '命运契约', type: 'rand_pact',  value: 8,  cost: 4, color: '#9b59b6', rarity: 'uncommon', stacks: 3, desc: '回8血并随机给对手一个负面(中毒3层/灼烧3层/冻结)(赌徒双发=回16+两个负面)' },
  { id: 'mirror',    name: '幻象术',   type: 'rand_copy',  value: 0,  cost: 4, color: '#1abc9c', rarity: 'rare', desc: '随机复制对手一张手牌到自己手里(赌徒复制两张)' },
  { id: 'fireblast', name: '烈焰冲击', type: 'combust', value: 2, cost: 4, color: '#e67e22', rarity: 'uncommon', fixedDmg: 10, desc: '造成10伤并灼烧2层' },
  { id: 'firestaff', name: '烈焰之杖', type: 'equip_burn', value: 6, cost: 4, color: '#e67e22', rarity: 'uncommon', equipDmg: 6, burnStacks: 1, equipTurns: 2, desc: '装备2回合，每回合造成6伤并灼烧1层' },
  { id: 'icecone',  name: '冰锥',     type: 'freeze_dmg', value: 6, cost: 4, color: '#00bcd4', rarity: 'uncommon', desc: '造成6点普通伤害并冻结对手' },
  { id: 'spider',    name: '蜘蛛女皇', type: 'summon_spider', value: 2, cost: 4, color: '#27ae60', rarity: 'rare', summonStacks: 2, summonTurns: 3, desc: '召唤蜘蛛女皇，在场3回合每回合给对手叠2层中毒' },

  /* ===== 高费牌(5费+) ===== */
  { id: 'vampiric',  name: '吸血',     type: 'vampiric',  value: 12, cost: 5, color: '#c0392b', rarity: 'uncommon', desc: '造成12伤并回6血' },
  { id: 'curse',     name: '诅咒',     type: 'curse',     value: 6,  cost: 5, color: '#8e44ad', rarity: 'uncommon', desc: '对手叠6层中毒' },
  { id: 'purge',     name: '净化火焰', type: 'cleanse_burn', value: 8, cost: 5, color: '#e74c3c', rarity: 'rare', drawCount: 1, desc: '清自身负面+回8血+抽1张，并清除对面所有随从' },
  { id: 'ritual',    name: '召唤仪式', type: 'rand_summon', value: 0, cost: 5, color: '#8e44ad', rarity: 'rare', desc: '随机召唤一个随从(火灵/蜘蛛/壁垒)(赌徒召唤两个)' },
  { id: 'bladewraith', name: '剑魔', type: 'summon_fire', value: 7, cost: 5, color: '#95a5a6', rarity: 'rare', summonDmg: 7, summonIncr: 0, summonTurns: 3, desc: '召唤剑魔，在场3回合每回合造成7点普通伤害' },
  { id: 'deathtouch', name: '死亡之触', type: 'damage', value: 18, cost: 6, color: '#8e44ad', rarity: 'rare', summonHeal: 8, desc: '造成18点普通伤害，若对手有随从则回8血' },
  { id: 'barrier',   name: '铁壁',     type: 'shield',    value: 20, cost: 6, color: '#2980b9', rarity: 'uncommon', desc: '获得20点护盾' },
  { id: 'hellfire', name: '地狱火', type: 'summon_fire', value: 10, cost: 6, color: '#c0392b', rarity: 'rare', summonDmg: 10, summonIncr: 0, summonTurns: 3, desc: '召唤地狱火，在场3回合每回合造成10伤(固定不递增)' },
  { id: 'blizzard', name: '暴风雪',   type: 'freeze_dmg', value: 10, cost: 6, color: '#00bcd4', rarity: 'rare', desc: '造成10点普通伤害并冻结对手' },
  { id: 'thunder',   name: '雷击',     type: 'damage',    value: 22, cost: 6, color: '#9b59b6', rarity: 'uncommon', desc: '造成22点伤害' },
  { id: 'dragonbreath', name: '龙息', type: 'combust', value: 5, cost: 7, color: '#e67e22', rarity: 'rare', fixedDmg: 12, burnStacks: 5, desc: '造成12伤并灼烧5层' },
  { id: 'suicide',   name: '自爆卡车', type: 'suicide',   value: 25, cost: 7, color: '#c0392b', rarity: 'uncommon', desc: '双方各受25真伤' },
  { id: 'judge',   name: '神圣审判', type: 'cond_neg', value: 16, cost: 7, color: '#f1c40f', rarity: 'rare', bonusDmg: 8, desc: '造成16伤，对手有负面效果时额外+8伤' },
  { id: 'meteor',  name: '陨石坠落', type: 'meteor', value: 25, cost: 8, color: '#c0392b', rarity: 'rare', heal: 10, desc: '造成25点真实伤害(无视护盾)并回10血' }
];

const COIN_TEMPLATE = {
  id: 'coin', name: '水晶硬币', type: 'coin', value: 1, cost: 0,
  color: '#f1c40f', desc: '本回合水晶+1'
};

module.exports = { CARDS, COIN_TEMPLATE };
