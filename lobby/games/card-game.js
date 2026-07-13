/* 卡牌游戏引擎 - 从 card-game/server.js 提取的游戏逻辑类 */

const CONFIG = require('./card-config');
const MAX_MANA = CONFIG.MAX_MANA;
const START_HAND = CONFIG.START_HAND;
const TURN_DRAW = CONFIG.TURN_DRAW;

const CARDS = [
  { id: 'fireball',  name: '火球术',   type: 'damage',    value: 6,  cost: 1, color: '#e74c3c', rarity: 'common', desc: '造成6点伤害' },
  { id: 'heal',      name: '治疗术',   type: 'heal',      value: 6,  cost: 1, color: '#2ecc71', rarity: 'common', desc: '恢复6点生命' },
  { id: 'shield',    name: '圣盾',     type: 'shield',    value: 6,  cost: 1, color: '#3498db', rarity: 'common', desc: '获得6点护盾' },
  { id: 'thunder',   name: '雷击',     type: 'damage',    value: 20, cost: 6, color: '#9b59b6', rarity: 'uncommon', desc: '造成20点伤害' },
  { id: 'vampiric',  name: '吸血',     type: 'vampiric',  value: 12, cost: 5, color: '#c0392b', rarity: 'uncommon', desc: '造成12伤并回6血' },
  { id: 'chaos',     name: '混沌',     type: 'chaos',     value: 6,  cost: 2, color: '#f39c12', rarity: 'common', desc: '随机效果(伤害、治疗、护盾、净化、中毒、灼烧、冰冻)' },
  { id: 'poison',    name: '毒雾',     type: 'poison',    value: 8,  cost: 3, color: '#27ae60', rarity: 'common', stacks: 3, desc: '造成8伤并中毒3层' },
  { id: 'barrier',   name: '铁壁',     type: 'shield',    value: 20, cost: 6, color: '#2980b9', rarity: 'uncommon', desc: '获得20点护盾' },
  { id: 'arcane',    name: '奥术智慧', type: 'draw',      value: 2,  cost: 3, color: '#1abc9c', rarity: 'common', desc: '抽2张牌' },
  { id: 'sprint',    name: '疾风斩',   type: 'draw_dmg',  value: 8,  cost: 3, color: '#e67e22', rarity: 'common', desc: '造成8伤并抽1' },
  { id: 'sacrifice', name: '献祭',     type: 'sacrifice', value: 15, cost: 4, color: '#8e44ad', rarity: 'uncommon', desc: '自扣8血，对手扣15真伤' },
  { id: 'suicide',   name: '自爆卡车', type: 'suicide',   value: 25, cost: 7, color: '#c0392b', rarity: 'uncommon', desc: '双方各受25真伤' },
  { id: 'block',     name: '格挡',     type: 'block',     value: 0,  cost: 4, color: '#f1c40f', rarity: 'uncommon', desc: '免疫下回合所有伤害' },
  { id: 'steal',     name: '顺手牵羊', type: 'steal',     value: 0,  cost: 2, color: '#2c3e50', rarity: 'common', desc: '随机偷对手1张牌' },
  { id: 'combust',   name: '烈焰',     type: 'combust',   value: 3,  cost: 5, color: '#e67e22', rarity: 'uncommon', fixedDmg: 6, desc: '造成6伤并灼烧3层' },
  { id: 'curse',     name: '诅咒',     type: 'curse',     value: 5,  cost: 5, color: '#8e44ad', rarity: 'uncommon', desc: '对手叠5层中毒' },
  { id: 'freeze',    name: '冰封',     type: 'freeze',    value: 0,  cost: 4, color: '#00bcd4', rarity: 'uncommon', desc: '冻结对手1回合' },
  { id: 'doom',      name: '死亡宣告', type: 'doom',      value: 3,  cost: 5, color: '#607d8b', rarity: 'uncommon', desc: '3回合后扣20血' },
  { id: 'ward',      name: '护罩',     type: 'ward',      value: 0,  cost: 3, color: '#f1c40f', rarity: 'common', desc: '下回合免疫负面效果' },
  { id: 'cleanse',   name: '净化',     type: 'cleanse',   value: 3,  cost: 4, color: '#ecf0f1', rarity: 'common', desc: '清除自身所有负面效果并恢复3点生命' },
  { id: 'delay_dmg', name: '火灵', type: 'summon_fire', value: 5, cost: 4, color: '#e67e22', rarity: 'rare', summonDmg: 5, summonIncr: 2, summonTurns: 3, desc: '召唤火灵，在场3回合每回合对对手造成5/7/9点递增普通伤害' },
  { id: 'blade',     name: '影刃',     type: 'equip',     value: 4,  cost: 3, color: '#95a5a6', rarity: 'uncommon', equipDmg: 4, equipTurns: 3, desc: '装备3回合，每回合开始对对手造成4点普通伤害' },
  { id: 'guard_shield', name: '守护者之盾', type: 'equip_shield', value: 5, cost: 3, color: '#2980b9', rarity: 'uncommon', equipShield: 5, equipTurns: 3, desc: '装备3回合，每回合开始获得5点护盾' },
  { id: 'treasure',  name: '宝藏',     type: 'equip_mana', value: 1,  cost: 2, color: '#f1c40f', rarity: 'uncommon', equipMana: 1, equipTurns: 2, desc: '装备2回合，每回合开始水晶+1' },
  { id: 'laststand', name: '背水一战', type: 'cond_damage', value: 15, cost: 2, color: '#c0392b', rarity: 'uncommon', hpThreshold: 40, lowDmg: 5, desc: '自己HP≤40时造成15点普通伤害，否则5点' },
  { id: 'execute',  name: '斩杀',     type: 'cond_kill',  value: 0,  cost: 4, color: '#c0392b', rarity: 'uncommon', hpThreshold: 15, normalDmg: 8, desc: '对手HP≤15直接斩杀，否则造成8点普通伤害' },
  { id: 'overload',  name: '过载',     type: 'cond_draw',  value: 3,  cost: 1, color: '#1abc9c', rarity: 'common', desc: '手牌≤2张时抽3张，否则抽1张' },
  { id: 'holylight', name: '圣光',     type: 'cleanse_lite', value: 0, cost: 2, color: '#ecf0f1', rarity: 'rare', desc: '清除对面所有随从（含壁垒守卫）' },
  { id: 'purge',     name: '净化火焰', type: 'cleanse_burn', value: 8, cost: 5, color: '#e74c3c', rarity: 'rare', drawCount: 1, desc: '清自身负面+回8血+抽1张，并清除对面所有随从' },
  { id: 'spider',    name: '蜘蛛女皇', type: 'summon_spider', value: 2, cost: 4, color: '#27ae60', rarity: 'rare', summonStacks: 2, summonTurns: 3, desc: '召唤蜘蛛女皇，在场3回合每回合给对手叠2层中毒' },
  { id: 'guardian',  name: '壁垒守卫', type: 'summon_guard',  value: 0,  cost: 3, color: '#3498db', rarity: 'rare', summonTurns: 3, desc: '召唤壁垒守卫，在场3回合期间受到的普通伤害减半' }
];

const COIN_TEMPLATE = {
  id: 'coin', name: '水晶硬币', type: 'coin', value: 1, cost: 0,
  color: '#f1c40f', desc: '本回合水晶+1'
};

/* 角色定义：被动(常驻) + 主动(消耗水晶，每回合1次) */
const CHARACTERS = [
  { id: 'berserker', emoji: '😈', name: '狂战士', type: '输出',
    passive: { name: '嗜血', desc: 'HP≤30%时，所有普通伤害+3' },
    active:  { name: '血怒', desc: '消耗3水晶，扣自己5血，本回合普通伤害翻倍', cost: 3 } },
  { id: 'paladin',   emoji: '🛡', name: '圣骑士', type: '防御',
    passive: { name: '圣愈', desc: '每回合开始(灼烧时除外)回2血' },
    active:  { name: '圣盾', desc: '消耗2水晶，获得10点护盾', cost: 2 } },
  { id: 'warlock',   emoji: '💀', name: '术士', type: '资源',
    passive: { name: '血契', desc: '打出负面效果牌(中毒/灼烧/诅咒/冰封/死亡宣告)后抽1张' },
    active:  { name: '诅咒', desc: '消耗3水晶，弃1张手牌，对手叠5层中毒', cost: 3 } },
  { id: 'gambler',   emoji: '🎲', name: '赌徒', type: '随机',
    passive: { name: '双骰', desc: '混沌卡牌效果触发两次' },
    active:  { name: '换牌', desc: '消耗2水晶，弃全部手牌，重抽等量张', cost: 2 } },
  { id: 'cryomage', emoji: '❄', name: '寒冰法师', type: '控制',
    passive: { name: '霜寒', desc: '打出冰封牌时额外造成5点普通伤害' },
    active:  { name: '极地风暴', desc: '消耗3水晶，对手本回合所有卡牌费用+2', cost: 3 } },
  { id: 'archmage', emoji: '🧙', name: '大法师', type: '资源',
    passive: { name: '博学', desc: '每回合抽牌数+1(共4张)' },
    active:  { name: '奥术涌动', desc: '消耗3水晶，立即抽3张牌', cost: 3 } }
];

class CardGameEngine {
  constructor(players, sendFn) {
    // players: Array<{id, name, ws, character}>
    this._send = sendFn; // (playerIndex, obj) => void
    this.players = players.map((p, i) => ({
      ...p,
      index: i,
      hp: CONFIG.START_HP, maxHp: CONFIG.START_HP, shield: 0,
      mana: 0, maxMana: 0,
      poison: 0, burn: 0, frozen: false, doom: 0, doomStacks: 0, burnTurn: 0,
      immune: false, negImmune: false,
      hand: [],
      character: p.character || null,
      skillUsedThisTurn: false,
      berserkerDoubleDamage: false,
      cardCostPenalty: 0,
      delayDamages: [],
      equipBladeTurn: 0,
      equipBladeDmg: 0,
      equipShieldTurn: 0,
      equipShieldAmt: 0,
      equipManaTurn: 0,
      equipManaAmt: 0,
      summons: []
    }));
    this.turn = -1;
    this.logs = [];
    this.ended = false;
  }

  start() {
    this.turn = Math.random() < 0.5 ? 0 : 1;
    this.players.forEach(p => {
      p.hp = CONFIG.START_HP; p.maxHp = CONFIG.START_HP; p.shield = 0;
      p.poison = 0; p.burn = 0; p.frozen = false; p.doom = 0; p.doomStacks = 0;
      p.burnTurn = 0; p.negImmune = false;
      p.mana = 0; p.maxMana = 0; p.immune = false;
      p.hand = [];
    });
    this.logs = [];
    this.ended = false;

    this.players.forEach(p => this._drawCards(p, START_HAND));
    const second = (this.turn + 1) % 2;
    this._giveCoin(this.players[second]);
    this.logs.push(`${this.players[second].name} 获得后手硬币（+1水晶）`);

    this._beginTurn(this.turn);
    this._broadcastAll();
  }

  handleMessage(playerIndex, rawMsg) {
    const msg = JSON.parse(rawMsg);

    if (msg.type === 'useSkill') {
      this._handleSkill(playerIndex, msg);
      return;
    }
    if (this.turn !== playerIndex || this.ended) return;

    if (msg.type === 'play') {
      this._handlePlay(playerIndex, msg);
    } else if (msg.type === 'discard') {
      this._handleDiscard(playerIndex, msg);
    } else if (msg.type === 'endTurn') {
      this._handleEndTurn(playerIndex);
    }
  }

  _handlePlay(myIndex, msg) {
    const user = this.players[myIndex];
    const target = this.players[1 - myIndex];
    const idx = user.hand.findIndex(c => c.uuid === msg.uuid);
    if (idx === -1) return;
    const card = user.hand[idx];
    const effectiveCost = card.cost + (user.cardCostPenalty || 0);
    if (user.mana < effectiveCost) return;
    if (user.frozen && card.type !== 'cleanse' && card.type !== 'cleanse_burn') {
      this._send(myIndex, { event: 'frozen' });
      return;
    }

    user.hand.splice(idx, 1);
    user.mana -= effectiveCost;

    const extra = this._resolveCard(user, target, card);
    this._onCardResolved(user, target, card);
    let log = `${user.name} 使用了【${card.name}】`;
    const chaosLabel = {damage:'伤害',heal:'治疗',shield:'护盾',cleanse:'净化',poison:'中毒',burn:'灼烧',freeze:'冰冻'};
    if (Array.isArray(extra.chaosEffect)) {
      log += ' → ' + extra.chaosEffect.map(e => chaosLabel[e]).join('、');
    } else if (extra.chaosEffect) {
      log += ' → ' + chaosLabel[extra.chaosEffect];
    }
    if (card.type === 'draw') log += `（抽了${card.value}张）`;
    if (card.type === 'draw_dmg') log += '（额外抽1张）';
    if (card.type === 'sacrifice') log += '（自损8，对手-15）';
    if (card.type === 'suicide') log += '（双方各受25真伤）';
    if (card.type === 'steal') {
      if (extra.stolenName) log += `（偷到【${extra.stolenName}】）`;
      else log += '（对手没有手牌！）';
    }
    if (card.type === 'freeze') log += '（对手被冰冻）';
    if (card.type === 'doom') log += '（死亡倒计时3回合）';
    const chaosCleanseCleared = (Array.isArray(extra.chaosEffect) ? extra.chaosEffect.includes('cleanse') : extra.chaosEffect === 'cleanse') && extra.cleansed;
    if (chaosCleanseCleared) log += '（清除所有负面）';
    if (card.type === 'cleanse') log += extra.cleansed ? '（清除所有负面）' : '（无负面可清）';
    if (card.type === 'cleanse_lite') log += extra.cleansed ? '（清除对面所有随从）' : '（对面无随从）';
    if (card.type === 'cleanse_burn') log += extra.healBlocked ? '（清负面，灼烧中回血无效，抽1张）' : '（清负面，回8血，抽1张）';
    if (card.type === 'cleanse_burn' && extra.purged) log += '，焚毁对面随从';
    if (card.type === 'block') log += '（下回合免疫所有伤害）';
    if (card.type === 'ward') log += '（下回合免疫负面效果）';
    if (card.type === 'coin') log += '（水晶+1）';
    if (card.type === 'delay_damage') log += extra.negBlocked ? '（被护罩抵挡）' : '（3回合后爆发20伤）';
    if (card.type === 'summon_fire') log += '（召唤火灵，每回合递增伤害）';
    if (card.type === 'summon_spider') log += '（召唤蜘蛛女皇，每回合叠毒）';
    if (card.type === 'summon_guard') log += '（召唤壁垒守卫，3回合普通伤害减半）';
    if (card.type === 'equip') log += '（装备影刃3回合）';
    if (card.type === 'equip_shield') log += '（装备守护者之盾3回合）';
    if (card.type === 'equip_mana') log += '（装备宝藏2回合）';
    if (card.type === 'cond_damage') log += `（自己HP${user.hp}，造成${user.hp <= 40 ? 15 : 5}伤）`;
    if (card.type === 'cond_kill') log += extra.executed ? '（斩杀！）' : `（对手HP${target.hp}，造成8伤）`;
    if (card.type === 'cond_draw') log += `（手牌${this._realHandCount(user)}张后）`;
    if (extra.healBlocked) log += '（灼烧中，回血无效）';
    if (extra.negBlocked) log += '（被护罩抵挡）';
    this.logs.push(log);

    this._broadcastAll();
    this._checkEnd();
  }

  _handleDiscard(myIndex, msg) {
    const user = this.players[myIndex];
    const limit = user.maxMana;
    const needed = this._realHandCount(user) - limit;
    if (needed <= 0) return;
    const uuids = msg.uuids;
    if (!Array.isArray(uuids) || uuids.length !== needed) return;
    if (new Set(uuids).size !== needed) return;
    if (!uuids.every(u => user.hand.some(c => c.uuid === u && c.type !== 'coin'))) return;

    user.hand = user.hand.filter(c => !uuids.includes(c.uuid));
    this.logs.push(`${user.name} 弃掉了 ${needed} 张牌`);
    this._broadcastAll();
    this.logs.push(`${user.name} 结束回合`);
    this._nextTurn();
  }

  _handleEndTurn(myIndex) {
    const user = this.players[myIndex];
    if (this._realHandCount(user) > user.maxMana) {
      this._send(myIndex, { event: 'need_discard', count: this._realHandCount(user) - user.maxMana });
      return;
    }
    this.logs.push(`${user.name} 结束回合`);
    this._nextTurn();
  }

  /* 核心游戏逻辑 */
  _drawCards(player, n) {
    for (let i = 0; i < n; i++) {
      const t = this._weightedPick(CARDS);
      const card = { ...t, uuid: Math.random().toString(36).slice(2, 9) };
      player.hand.push(card);
    }
  }

  // 分层抽牌：先按 RARITY_WEIGHTS 选稀有度层，再在层内按费用加权抽
  _weightedPick(cards) {
    // 按稀有度分组
    const byRarity = { common: [], uncommon: [], rare: [] };
    for (const c of cards) {
      const r = c.rarity || 'common';
      if (byRarity[r]) byRarity[r].push(c); else byRarity.common.push(c);
    }
    // 过滤掉空层，按权重选层
    const RW = CONFIG.RARITY_WEIGHTS;
    const layers = Object.keys(RW).filter(r => byRarity[r] && byRarity[r].length > 0);
    if (layers.length === 0) return cards[0];
    const wTotal = layers.reduce((s, r) => s + RW[r], 0);
    let wr = Math.random() * wTotal;
    let chosen = layers[0];
    for (const r of layers) {
      wr -= RW[r];
      if (wr < 0) { chosen = r; break; }
    }
    const pool = byRarity[chosen];
    // 层内按费用加权（低费权重高）
    const total = pool.reduce((s, c) => s + Math.max(1, CONFIG.COST_WEIGHT_BASE - c.cost), 0);
    let r = Math.random() * total;
    for (const c of pool) {
      r -= Math.max(1, CONFIG.COST_WEIGHT_BASE - c.cost);
      if (r < 0) return c;
    }
    return pool[pool.length - 1];
  }

  _giveCoin(player) {
    player.hand.push({ ...COIN_TEMPLATE, uuid: Math.random().toString(36).slice(2, 9) });
  }

  _realHandCount(p) { return p.hand.filter(c => c.type !== 'coin').length; }

  _effectiveDamage(target, v) {
    if (target.immune) return 0;
    if (target.shield > 0) {
      const a = Math.min(target.shield, v);
      target.shield -= a; v -= a;
    }
    return v;
  }

  // 普通伤害修饰点：集中处理狂战士被动(+3)、主动(翻倍)、壁垒守卫减伤。仅卡牌普通伤害调用。
  _dealDamage(user, target, baseV) {
    if (user.character === 'berserker' && user.hp <= user.maxHp * CONFIG.BERSERKER_HP_RATIO) baseV += 3;
    if (user.berserkerDoubleDamage) baseV *= 2;
    // 壁垒守卫：在场期间普通伤害减半（向下取整）
    if (target.summons && target.summons.some(s => s.kind === 'guardian') && baseV > 0) {
      const reduced = Math.floor(baseV * CONFIG.GUARDIAN_REDUCE);
      this.logs.push(`${target.name} 的壁垒守卫减伤 ${baseV - reduced} 点`);
      baseV = reduced;
    }
    const dmg = this._effectiveDamage(target, baseV);
    target.hp = Math.max(0, target.hp - dmg);
    return dmg;
  }

  _resolveCard(user, target, card) {
    const v = card.value;
    let extra = {};
    const RESOLVERS = {
      damage:   () => { this._dealDamage(user, target, v); },
      heal:     () => { if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + v); },
      shield:   () => { user.shield += v; },
      vampiric: () => { this._dealDamage(user, target, v); if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + Math.floor(v / 2)); },
      poison:   () => { this._dealDamage(user, target, v); if (target.negImmune) extra = { negBlocked: true }; else target.poison += card.stacks || 3; },
      combust:  () => { this._dealDamage(user, target, card.fixedDmg || 6); if (target.negImmune) extra = { negBlocked: true }; else { target.burn += v; target.burnTurn = CONFIG.STATUS_DURATION; } },
      curse:    () => { if (target.negImmune) extra = { negBlocked: true }; else target.poison += v; },
      freeze:   () => { if (target.negImmune) extra = { negBlocked: true }; else target.frozen = true; },
      doom:     () => { if (target.negImmune) extra = { negBlocked: true }; else { target.doom = Math.max(target.doom || 0, v); target.doomStacks = Math.min(5, (target.doomStacks || 0) + 1); } },
      draw:     () => { this._drawCards(user, v); },
      draw_dmg: () => { this._dealDamage(user, target, v); this._drawCards(user, 1); },
      chaos:    () => {
        const pool = ['damage', 'heal', 'shield', 'cleanse', 'poison', 'burn', 'freeze'];
        const times = user.character === 'gambler' ? 2 : 1;
        const effects = [];
        for (let t = 0; t < times; t++) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick === 'damage') this._dealDamage(user, target, v);
          if (pick === 'heal') { if (user.burn > 0) extra = { ...extra, healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + v); }
          if (pick === 'shield') user.shield += v;
          if (pick === 'cleanse') {
            const h = user.poison > 0 || user.burn > 0 || user.frozen || user.doom > 0 || user.doomStacks > 0;
            const b = user.burn > 0; user.poison = 0; user.burn = 0; user.frozen = false; user.doom = 0; user.doomStacks = 0; user.burnTurn = 0;
            if (!b) user.hp = Math.min(user.maxHp, user.hp + 3); extra = { ...extra, cleansed: h };
          }
          if (pick === 'poison') { if (target.negImmune) extra = { ...extra, negBlocked: true }; else target.poison += 3; }
          if (pick === 'burn') { if (target.negImmune) extra = { ...extra, negBlocked: true }; else { target.burn += 3; target.burnTurn = 3; } }
          if (pick === 'freeze') { if (target.negImmune) extra = { ...extra, negBlocked: true }; else target.frozen = true; }
          effects.push(pick);
        }
        extra = { ...extra, chaosEffect: effects.length > 1 ? effects : effects[0] };
      },
      sacrifice:() => { user.hp = Math.max(0, user.hp - 8); target.hp = Math.max(0, target.hp - (target.immune ? 0 : 15)); },
      suicide:  () => { user.hp = Math.max(0, user.hp - (user.immune ? 0 : v)); target.hp = Math.max(0, target.hp - (target.immune ? 0 : v)); },
      block:    () => { user.immune = true; },
      ward:     () => { user.negImmune = true; },
      steal:    () => { if (target.hand.length > 0) { const s = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0]; user.hand.push(s); extra = { stolenName: s.name }; } else extra = { stolenFail: true }; },
      cleanse:  () => {
        const n = user.poison > 0 || user.burn > 0 || user.frozen || user.doom > 0 || user.doomStacks > 0;
        const b = user.burn > 0; user.poison = 0; user.burn = 0; user.frozen = false; user.doom = 0; user.doomStacks = 0; user.burnTurn = 0;
        if (b) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + 3);
        extra = { ...extra, cleansed: n };
      },
      /* 圣光：清除对面所有随从（含壁垒守卫），不清负面不回血 */
      cleanse_lite: () => {
        const cleared = target.summons && target.summons.length > 0;
        if (cleared) {
          const names = target.summons.map(s => ({firesprite:'火灵',spider:'蜘蛛女皇',guardian:'壁垒守卫'})[s.kind] || '随从');
          this.logs.push(`${target.name} 的${names.join('、')}被圣光驱散`);
          target.summons = [];
        }
        extra = { cleansed: cleared };
      },
      /* 净化火焰：清自身负面+回8血+抽1，并清除对面所有随从（含壁垒） */
      cleanse_burn: () => {
        const n = user.poison > 0 || user.burn > 0 || user.frozen || user.doom > 0 || user.doomStacks > 0;
        const b = user.burn > 0;
        user.poison = 0; user.burn = 0; user.frozen = false; user.doom = 0; user.doomStacks = 0; user.burnTurn = 0;
        if (!b) user.hp = Math.min(user.maxHp, user.hp + v); else extra = { healBlocked: true };
        this._drawCards(user, card.drawCount || 1);
        const cleared = target.summons && target.summons.length > 0;
        if (cleared) {
          const names = target.summons.map(s => ({firesprite:'火灵',spider:'蜘蛛女皇',guardian:'壁垒守卫'})[s.kind] || '随从');
          this.logs.push(`${target.name} 的${names.join('、')}被净化火焰焚毁`);
          target.summons = [];
        }
        extra = { ...extra, cleansed: n, purged: cleared };
      },
      coin:     () => { user.mana += 1; },
      /* ===== 随从(召唤物) ===== */
      summon_fire: () => {
        user.summons.push({ kind: 'firesprite', turns: card.summonTurns || 3, dmg: card.summonDmg || v, incr: card.summonIncr || 2 });
      },
      summon_spider: () => {
        user.summons.push({ kind: 'spider', turns: card.summonTurns || 3, stacks: card.summonStacks || 2 });
      },
      summon_guard: () => {
        user.summons.push({ kind: 'guardian', turns: card.summonTurns || 3 });
      },
      /* ===== 限时装备 ===== */
      equip:        () => { user.equipBladeTurn = card.equipTurns || 3; user.equipBladeDmg = card.equipDmg || 4; },
      equip_shield: () => { user.equipShieldTurn = card.equipTurns || 3; user.equipShieldAmt = card.equipShield || 5; },
      equip_mana:   () => { user.equipManaTurn = card.equipTurns || 2; user.equipManaAmt = card.equipMana || 1; },
      /* ===== 条件触发 ===== */
      cond_damage: () => {
        if (user.hp <= (card.hpThreshold || 40)) this._dealDamage(user, target, v);
        else this._dealDamage(user, target, card.lowDmg || 5);
      },
      cond_kill: () => {
        if (target.hp <= (card.hpThreshold || 15) && target.hp > 0 && !target.immune) { target.hp = 0; extra = { executed: true }; }
        else this._dealDamage(user, target, card.normalDmg || 8);
      },
      cond_draw: () => {
        const n = this._realHandCount(user) <= 2 ? 3 : 1;
        this._drawCards(user, n);
      }
    };
    (RESOLVERS[card.type] || (() => {}))();
    if (target.hp <= 0) target.shield = 0;
    if (user.hp <= 0) user.shield = 0;
    return extra;
  }

  // 出牌后被动钩子（在 _resolveCard 之后调用）
  _onCardResolved(user, target, card) {
    const NEGATIVE_TYPES = ['poison', 'combust', 'curse', 'freeze', 'doom'];
    if (user.character === 'warlock' && NEGATIVE_TYPES.includes(card.type)) {
      this._drawCards(user, 1);
      this.logs.push(`${user.name} 触发【血契】抽1张牌`);
    }
    if (user.character === 'cryomage' && card.type === 'freeze') {
      const dmg = this._effectiveDamage(target, 5);
      target.hp = Math.max(0, target.hp - dmg);
      this.logs.push(`${user.name} 触发【霜寒】额外造成5点伤害`);
    }
  }

  _applyStatusEffects(pp) {
    let parts = [];
    if (pp.immune) {
      let blocked = [];
      if (pp.poison && pp.hp > 0) blocked.push('中毒');
      if (pp.burn && pp.hp > 0)   { blocked.push('灼烧'); pp.burnTurn--; if (pp.burnTurn <= 0) pp.burn = 0; }
      if (pp.doom > 0)            { blocked.push('死亡宣告'); pp.doom--; if (pp.doom === 0) pp.doomStacks = 0; }
      if (blocked.length > 0) { this.logs.push(`${pp.name} 的格挡免疫了${blocked.join('、')}伤害`); return true; }
      return false;
    }
    if (pp.poison && pp.hp > 0) { pp.hp = Math.max(0, pp.hp - this._effectiveDamage(pp, pp.poison)); parts.push(`${pp.poison}中毒`); }
    if (pp.burn && pp.hp > 0)   {
      pp.hp = Math.max(0, pp.hp - this._effectiveDamage(pp, pp.burn));
      pp.burnTurn--;
      if (pp.burnTurn <= 0) { pp.burn = 0; parts.push(`灼烧熄灭`); }
      else parts.push(`灼烧${pp.burn}(${pp.burnTurn})`);
    }
    if (pp.doom > 0) {
      pp.doom--;
      if (pp.doom === 0) { const dmg = CONFIG.DOOM_DAMAGE_PER_STACK * (pp.doomStacks || 1); pp.hp = Math.max(0, pp.hp - this._effectiveDamage(pp, dmg)); parts.push(`死亡倒计时爆发(${dmg})`); pp.doomStacks = 0; }
      else parts.push(`死亡倒计时${pp.doom}` + (pp.doomStacks > 1 ? `×${pp.doomStacks}` : ''));
    }
    if (parts.length > 0) { this.logs.push(`${pp.name} 受到 ${parts.join(' + ')}`); return true; }
    return false;
  }

  _beginTurn(idx) {
    const p = this.players[idx];
    // 清除上回合主动增益与技能冷却
    if (p.berserkerDoubleDamage) { p.berserkerDoubleDamage = false; this.logs.push(`${p.name} 的血怒效果消失了`); }
    p.skillUsedThisTurn = false;
    if (p.immune) { p.immune = false; this.logs.push(`${p.name} 的格挡效果消失了`); }
    if (p.negImmune) { p.negImmune = false; this.logs.push(`${p.name} 的护罩效果消失了`); }
    p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
    p.mana = p.maxMana;
    // 大法师被动：抽牌+1
    const drawN = p.character === 'archmage' ? TURN_DRAW + 1 : TURN_DRAW;
    this._drawCards(p, drawN);
    // 圣骑士被动：回合开始回2血(灼烧时除外)
    if (p.character === 'paladin' && p.burn === 0 && p.hp > 0) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + 2);
      if (p.hp > before) this.logs.push(`${p.name} 触发【圣愈】回2血`);
    }
    // 装备触发：宝藏(水晶+1，可临时突破上限) → 影刃(对对手造成伤害) → 守护盾(+护盾)
    if (p.equipManaTurn > 0) {
      p.mana += p.equipManaAmt || 1; // 宝藏水晶不受maxMana上限限制，本回合内可超额
      p.equipManaTurn--;
      this.logs.push(`${p.name} 的宝藏+${p.equipManaAmt||1}水晶(当前${p.mana})${p.equipManaTurn === 0 ? '（耗尽）' : ''}`);
    }
    if (p.equipBladeTurn > 0 && p.hp > 0) {
      const target = this.players[1 - idx];
      const dmg = p.equipBladeDmg || 4;
      this._dealDamage(p, target, dmg);
      p.equipBladeTurn--;
      this.logs.push(`${p.name} 的影刃造成${dmg}点伤害${p.equipBladeTurn === 0 ? '（损坏）' : ''}`);
    }
    if (p.equipShieldTurn > 0) {
      const amt = p.equipShieldAmt || 5;
      p.shield += amt;
      p.equipShieldTurn--;
      this.logs.push(`${p.name} 的守护者之盾+${amt}护盾${p.equipShieldTurn === 0 ? '（消失）' : ''}`);
    }
    // 随从触发（火灵递增伤害、蜘蛛叠毒）；壁垒为被动减伤(在_dealDamage处理)，此处只做倒计时
    if (p.summons && p.summons.length > 0 && p.hp > 0) {
      const target = this.players[1 - idx];
      p.summons = p.summons.filter(s => {
        if (s.kind === 'firesprite') {
          this._dealDamage(p, target, s.dmg);
          this.logs.push(`${p.name} 的火灵造成${s.dmg}点伤害`);
          s.dmg += s.incr || 2;
        } else if (s.kind === 'spider') {
          if (target.negImmune) this.logs.push(`${p.name} 的蜘蛛女皇被护罩抵挡`);
          else { target.poison += s.stacks || 2; this.logs.push(`${p.name} 的蜘蛛女皇给对手叠${s.stacks||2}层中毒`); }
        }
        // guardian 壁垒无主动效果，仅倒计时
        s.turns--;
        if (s.turns <= 0) {
          if (s.kind === 'firesprite') this.logs.push(`${p.name} 的火灵消散`);
          else if (s.kind === 'spider') this.logs.push(`${p.name} 的蜘蛛女皇离去`);
          else if (s.kind === 'guardian') this.logs.push(`${p.name} 的壁垒守卫消散`);
          return false;
        }
        return true;
      });
    }
  }

  _handleSkill(myIndex, msg) {
    if (this.turn !== myIndex || this.ended) return;
    const user = this.players[myIndex];
    const target = this.players[1 - myIndex];
    const ch = CHARACTERS.find(c => c.id === user.character);
    if (!ch || !ch.active) return;
    if (user.skillUsedThisTurn) return;
    if (user.mana < ch.active.cost) return;

    // 术士需先选牌，未传 uuid 不扣费（等待客户端选牌）
    if (user.character === 'warlock' && !msg.uuid) return;

    // 扣除水晶
    user.mana -= ch.active.cost;

    switch (user.character) {
      case 'berserker':
        user.hp = Math.max(0, user.hp - 5);
        user.berserkerDoubleDamage = true;
        this.logs.push(`${user.name} 释放【血怒】(耗${ch.active.cost}水晶)自扣5血，本回合伤害翻倍`);
        break;
      case 'paladin':
        user.shield += 10;
        this.logs.push(`${user.name} 释放【圣盾】(耗${ch.active.cost}水晶)获得10护盾`);
        break;
      case 'warlock': {
        const ci = user.hand.findIndex(c => c.uuid === msg.uuid);
        if (ci === -1) { user.mana += ch.active.cost; return; } // 牌不存在，退还水晶
        user.hand.splice(ci, 1);
        if (target.negImmune) {
          this.logs.push(`${user.name} 释放【诅咒】(耗${ch.active.cost}水晶,被护罩抵挡)`);
        } else {
          target.poison += 5;
          this.logs.push(`${user.name} 释放【诅咒】(耗${ch.active.cost}水晶)对手叠5层中毒`);
        }
        break;
      }
      case 'gambler': {
        const count = user.hand.length;
        user.hand = [];
        this._drawCards(user, count);
        this.logs.push(`${user.name} 释放【换牌】(耗${ch.active.cost}水晶)重抽${count}张`);
        break;
      }
      case 'cryomage':
        target.cardCostPenalty = (target.cardCostPenalty || 0) + 2;
        this.logs.push(`${user.name} 释放【极地风暴】(耗${ch.active.cost}水晶)，对手本回合出牌费用+2`);
        break;
      case 'archmage':
        this._drawCards(user, 3);
        this.logs.push(`${user.name} 释放【奥术涌动】(耗${ch.active.cost}水晶)抽3张牌`);
        break;
    }
    user.skillUsedThisTurn = true;
    this._broadcastAll();
    this._checkEnd();
  }

  _nextTurn() {
    const pp = this.players[this.turn];
    this._applyStatusEffects(pp);
    if (pp.frozen) { pp.frozen = false; this.logs.push(`${pp.name} 从冰冻中恢复`); }
    if (pp.cardCostPenalty) { pp.cardCostPenalty = 0; } // 软控仅持续一个回合
    this.turn = (this.turn + 1) % 2;
    this._beginTurn(this.turn);
    this._broadcastAll();
    this._checkEnd();
  }

  _checkEnd() {
    const alive = this.players.map((p, i) => p.hp > 0 ? i : -1).filter(x => x !== -1);
    if (alive.length <= 1) {
      const winner = alive.length === 1 ? this.players[alive[0]].name : '平局';
      this.ended = true; this.turn = -1;
      this.players.forEach((p, i) => this._send(i, { event: 'over', winner }));
    }
  }

  playerDisconnected(idx) {
    if (this.ended || idx < 0 || idx >= this.players.length) return;
    const p = this.players[idx];
    if (!p || p.hp <= 0) return;
    p.hp = 0;
    p.disconnected = true;
    this.logs.push(`${p.name} 离开，自动判负`);
    this._broadcastAll();
    this._checkEnd();
  }

  _statePayload() {
    return {
      turn: this.turn,
      logs: this.logs.slice(-12),
      players: this.players.map((p, i) => {
        const ch = CHARACTERS.find(c => c.id === p.character);
        return {
          name: p.name, hp: p.hp, maxHp: p.maxHp, shield: p.shield,
          mana: p.mana, maxMana: p.maxMana,
          poison: p.poison || 0, burn: p.burn || 0, burnTurn: p.burnTurn || 0,
          frozen: !!p.frozen, doom: p.doom || 0, doomStacks: p.doomStacks || 0,
          immune: !!p.immune, negImmune: !!p.negImmune, handSize: this._realHandCount(p),
          isCurrent: i === this.turn, disconnected: !!p.disconnected,
          cardCostPenalty: p.cardCostPenalty || 0,
          delayDamages: (p.delayDamages || []).map(d => ({ amount: d.amount, turns: d.turns })),
          equipBladeTurn: p.equipBladeTurn || 0,
          equipShieldTurn: p.equipShieldTurn || 0,
          equipManaTurn: p.equipManaTurn || 0,
          summons: (p.summons || []).map(s => ({
            kind: s.kind,
            turns: s.turns === undefined ? -1 : s.turns,
            dmg: s.dmg === undefined ? 0 : s.dmg
          })),
          character: p.character,
          characterEmoji: ch ? ch.emoji : '',
          characterName: ch ? ch.name : '',
          skillName: ch && ch.active ? ch.active.name : '',
          skillDesc: ch && ch.active ? ch.active.desc : '',
          skillCost: ch && ch.active ? ch.active.cost : 0,
          skillUsedThisTurn: !!p.skillUsedThisTurn
        };
      })
    };
  }

  _broadcastAll() {
    const state = this._statePayload();
    this.players.forEach((p, i) => {
      this._send(i, { event: this.ended ? 'update' : 'update', state });
      this._send(i, { myHand: p.hand, myIndex: i });
    });
  }
}

module.exports = CardGameEngine;
module.exports.CHARACTERS = CHARACTERS;
