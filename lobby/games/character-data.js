/* 英雄数据 - 所有英雄定义集中在此，被动(常驻) + 主动(消耗水晶，每回合1次) */

const CHARACTERS = [
  { id: 'berserker', emoji: '😈', name: '狂战士', type: '输出',
    passive: { name: '嗜血', desc: 'HP≤40%时，所有普通伤害+3' },
    active:  { name: '血怒', desc: '消耗3水晶，扣自己3血，本回合普通伤害翻倍', cost: 3 } },
  { id: 'paladin',   emoji: '🛡', name: '圣骑士', type: '防御',
    passive: { name: '圣愈', desc: '每回合开始(灼烧时除外)回2血，且已有护盾时额外+3护盾' },
    active:  { name: '圣盾', desc: '消耗2水晶，获得10点护盾', cost: 2 } },
  { id: 'warlock',   emoji: '💀', name: '术士', type: '资源',
    passive: { name: '血契', desc: '打出负面效果牌(中毒/灼烧/诅咒/冰封)后抽1张' },
    active:  { name: '诅咒', desc: '消耗3水晶，弃1张手牌，对手叠7层中毒并自己回5血', cost: 3 } },
  { id: 'gambler',   emoji: '🎲', name: '赌徒', type: '随机',
    passive: { name: '双骰', desc: '随机卡牌触发两次，但有20%概率自己得一个负面效果' },
    active:  { name: '换牌', desc: '消耗2水晶，弃全部手牌，重抽等量张', cost: 2 } },
  { id: 'cryomage', emoji: '❄', name: '寒冰法师', type: '控制',
    passive: { name: '霜寒', desc: '对手冻结期间，你对其造成的所有普通伤害+3' },
    active:  { name: '极地风暴', desc: '消耗3水晶，对手本回合所有卡牌费用+2', cost: 3 } },
  { id: 'archmage', emoji: '🧙', name: '大法师', type: '资源',
    passive: { name: '博学', desc: '每回合抽牌数+1(共4张)' },
    active:  { name: '奥术涌动', desc: '消耗2水晶，抽2张牌并随机弃掉对手2张手牌', cost: 2 } },
  { id: 'tycoon', emoji: '💰', name: '财阀', type: '水晶',
    passive: { name: '囤积', desc: '回合结束时若剩余水晶≥5，将剩余水晶存入储蓄(下回合可用，不重置)' },
    active:  { name: '水晶爆发', desc: '消耗2水晶，清空储蓄并每点储蓄造成2点伤害', cost: 2 } },
  { id: 'undead', emoji: '🧟', name: '不死族', type: '亡灵',
    passive: { name: '不灭', desc: '每局1次：受到致命伤害时保留1血不死' },
    active:  { name: '亡者汲取', desc: '消耗3水晶，造成6伤并回8血', cost: 3 } }
];

module.exports = { CHARACTERS };
