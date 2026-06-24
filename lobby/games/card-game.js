/* 卡牌游戏引擎 - 从 card-game/server.js 提取的游戏逻辑类 */

const CARDS = [
  { id: 'fireball',  name: '火球术',   type: 'damage',    value: 6,  cost: 1, color: '#e74c3c', desc: '造成6点伤害' },
  { id: 'heal',      name: '治疗术',   type: 'heal',      value: 6,  cost: 1, color: '#2ecc71', desc: '恢复6点生命' },
  { id: 'shield',    name: '圣盾',     type: 'shield',    value: 6,  cost: 1, color: '#3498db', desc: '获得6点护盾' },
  { id: 'thunder',   name: '雷击',     type: 'damage',    value: 20, cost: 6, color: '#9b59b6', desc: '造成20点伤害' },
  { id: 'vampiric',  name: '吸血',     type: 'vampiric',  value: 12, cost: 5, color: '#c0392b', desc: '造成12伤并回6血' },
  { id: 'chaos',     name: '混沌',     type: 'chaos',     value: 6,  cost: 2, color: '#f39c12', desc: '随机效果(伤害、治疗、护盾、净化、中毒、灼烧、冰冻)' },
  { id: 'poison',    name: '毒雾',     type: 'poison',    value: 8,  cost: 3, color: '#27ae60', desc: '造成8伤并中毒3层' },
  { id: 'barrier',   name: '铁壁',     type: 'shield',    value: 20, cost: 6, color: '#2980b9', desc: '获得20点护盾' },
  { id: 'arcane',    name: '奥术智慧', type: 'draw',      value: 2,  cost: 3, color: '#1abc9c', desc: '抽2张牌' },
  { id: 'sprint',    name: '疾风斩',   type: 'draw_dmg',  value: 8,  cost: 3, color: '#e67e22', desc: '造成8伤并抽1' },
  { id: 'sacrifice', name: '献祭',     type: 'sacrifice', value: 15, cost: 4, color: '#8e44ad', desc: '自扣8血，对手扣15真伤' },
  { id: 'suicide',   name: '自爆卡车', type: 'suicide',   value: 25, cost: 7, color: '#c0392b', desc: '双方各受25真伤' },
  { id: 'block',     name: '格挡',     type: 'block',     value: 0,  cost: 4, color: '#f1c40f', desc: '免疫下回合所有伤害' },
  { id: 'steal',     name: '顺手牵羊', type: 'steal',     value: 0,  cost: 2, color: '#2c3e50', desc: '随机偷对手1张牌' },
  { id: 'combust',   name: '烈焰',     type: 'combust',   value: 3,  cost: 5, color: '#e67e22', desc: '造成6伤并灼烧3层' },
  { id: 'curse',     name: '诅咒',     type: 'curse',     value: 5,  cost: 5, color: '#8e44ad', desc: '对手叠5层中毒' },
  { id: 'freeze',    name: '冰封',     type: 'freeze',    value: 0,  cost: 4, color: '#00bcd4', desc: '冻结对手1回合' },
  { id: 'doom',      name: '死亡宣告', type: 'doom',      value: 3,  cost: 5, color: '#607d8b', desc: '3回合后扣20血' },
  { id: 'ward',      name: '护罩',     type: 'ward',      value: 0,  cost: 3, color: '#f1c40f', desc: '下回合免疫负面效果' },
  { id: 'cleanse',   name: '净化',     type: 'cleanse',   value: 3,  cost: 4, color: '#ecf0f1', desc: '清负面+回3血' }
];

const MAX_MANA = 10;
const START_HAND = 4;
const TURN_DRAW = 3;

const COIN_TEMPLATE = {
  id: 'coin', name: '水晶硬币', type: 'coin', value: 1, cost: 0,
  color: '#f1c40f', desc: '本回合水晶+1'
};

class CardGameEngine {
  constructor(players, sendFn) {
    // players: Array<{id, name, ws}>
    this._send = sendFn; // (playerIndex, obj) => void
    this.players = players.map((p, i) => ({
      ...p,
      index: i,
      hp: 100, maxHp: 100, shield: 0,
      mana: 0, maxMana: 0,
      poison: 0, burn: 0, frozen: false, doom: 0, doomStacks: 0, burnTurn: 0,
      immune: false, negImmune: false,
      hand: []
    }));
    this.turn = -1;
    this.logs = [];
    this.ended = false;
  }

  start() {
    this.turn = Math.random() < 0.5 ? 0 : 1;
    this.players.forEach(p => {
      p.hp = 100; p.maxHp = 100; p.shield = 0;
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
    if (this.turn !== playerIndex || this.ended) return;
    const msg = JSON.parse(rawMsg);

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
    if (user.mana < card.cost) return;
    if (user.frozen && card.type !== 'cleanse') {
      this._send(myIndex, { event: 'frozen' });
      return;
    }

    user.hand.splice(idx, 1);
    user.mana -= card.cost;

    const extra = this._resolveCard(user, target, card);
    let log = `${user.name} 使用了【${card.name}】`;
    if (extra.chaosEffect) {
      log += ' → ' + {damage:'伤害',heal:'治疗',shield:'护盾',cleanse:'净化',poison:'中毒',burn:'灼烧',freeze:'冰冻'}[extra.chaosEffect];
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
    if (extra.chaosEffect === 'cleanse' && extra.cleansed) log += '（清除所有负面）';
    if (card.type === 'cleanse') log += extra.cleansed ? '（清除所有负面）' : '（无负面可清）';
    if (card.type === 'block') log += '（下回合免疫所有伤害）';
    if (card.type === 'ward') log += '（下回合免疫负面效果）';
    if (card.type === 'coin') log += '（水晶+1）';
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

  _weightedPick(cards) {
    const total = cards.reduce((s, c) => s + Math.max(1, 14 - c.cost), 0);
    let r = Math.random() * total;
    for (const c of cards) {
      r -= Math.max(1, 14 - c.cost);
      if (r < 0) return c;
    }
    return cards[cards.length - 1];
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

  _resolveCard(user, target, card) {
    const v = card.value;
    let extra = {};
    const RESOLVERS = {
      damage:   () => { target.hp = Math.max(0, target.hp - this._effectiveDamage(target, v)); },
      heal:     () => { if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + v); },
      shield:   () => { user.shield += v; },
      vampiric: () => { target.hp = Math.max(0, target.hp - this._effectiveDamage(target, v)); if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + Math.floor(v / 2)); },
      poison:   () => { target.hp = Math.max(0, target.hp - this._effectiveDamage(target, v)); if (target.negImmune) extra = { negBlocked: true }; else target.poison += 3; },
      combust:  () => { target.hp = Math.max(0, target.hp - this._effectiveDamage(target, 6)); if (target.negImmune) extra = { negBlocked: true }; else { target.burn += v; target.burnTurn = 3; } },
      curse:    () => { if (target.negImmune) extra = { negBlocked: true }; else target.poison += v; },
      freeze:   () => { if (target.negImmune) extra = { negBlocked: true }; else target.frozen = true; },
      doom:     () => { if (target.negImmune) extra = { negBlocked: true }; else { target.doom = Math.max(target.doom || 0, v); target.doomStacks = Math.min(5, (target.doomStacks || 0) + 1); } },
      draw:     () => { this._drawCards(user, v); },
      draw_dmg: () => { target.hp = Math.max(0, target.hp - this._effectiveDamage(target, v)); this._drawCards(user, 1); },
      chaos:    () => {
        const pool = ['damage', 'heal', 'shield', 'cleanse', 'poison', 'burn', 'freeze'];
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick === 'damage') target.hp = Math.max(0, target.hp - this._effectiveDamage(target, v));
        if (pick === 'heal') { if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + v); }
        if (pick === 'shield') user.shield += v;
        if (pick === 'cleanse') {
          const h = user.poison > 0 || user.burn > 0 || user.frozen || user.doom > 0 || user.doomStacks > 0;
          const b = user.burn > 0; user.poison = 0; user.burn = 0; user.frozen = false; user.doom = 0; user.doomStacks = 0; user.burnTurn = 0;
          if (!b) user.hp = Math.min(user.maxHp, user.hp + 3); extra = { ...extra, cleansed: h };
        }
        if (pick === 'poison') { if (target.negImmune) extra = { ...extra, negBlocked: true }; else target.poison += 3; }
        if (pick === 'burn') { if (target.negImmune) extra = { ...extra, negBlocked: true }; else { target.burn += 3; target.burnTurn = 3; } }
        if (pick === 'freeze') { if (target.negImmune) extra = { ...extra, negBlocked: true }; else target.frozen = true; }
        extra = { ...extra, chaosEffect: pick };
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
      coin:     () => { user.mana += 1; }
    };
    (RESOLVERS[card.type] || (() => {}))();
    if (target.hp <= 0) target.shield = 0;
    if (user.hp <= 0) user.shield = 0;
    return extra;
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
      if (pp.doom === 0) { const dmg = 20 * (pp.doomStacks || 1); pp.hp = Math.max(0, pp.hp - this._effectiveDamage(pp, dmg)); parts.push(`死亡倒计时爆发(${dmg})`); pp.doomStacks = 0; }
      else parts.push(`死亡倒计时${pp.doom}` + (pp.doomStacks > 1 ? `×${pp.doomStacks}` : ''));
    }
    if (parts.length > 0) { this.logs.push(`${pp.name} 受到 ${parts.join(' + ')}`); return true; }
    return false;
  }

  _beginTurn(idx) {
    const p = this.players[idx];
    if (p.immune) { p.immune = false; this.logs.push(`${p.name} 的格挡效果消失了`); }
    if (p.negImmune) { p.negImmune = false; this.logs.push(`${p.name} 的护罩效果消失了`); }
    p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
    p.mana = p.maxMana;
    this._drawCards(p, TURN_DRAW);
  }

  _nextTurn() {
    const pp = this.players[this.turn];
    this._applyStatusEffects(pp);
    if (pp.frozen) { pp.frozen = false; this.logs.push(`${pp.name} 从冰冻中恢复`); }
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

  _statePayload() {
    return {
      turn: this.turn,
      logs: this.logs.slice(-12),
      players: this.players.map((p, i) => ({
        name: p.name, hp: p.hp, maxHp: p.maxHp, shield: p.shield,
        mana: p.mana, maxMana: p.maxMana,
        poison: p.poison || 0, burn: p.burn || 0, burnTurn: p.burnTurn || 0,
        frozen: !!p.frozen, doom: p.doom || 0, doomStacks: p.doomStacks || 0,
        immune: !!p.immune, negImmune: !!p.negImmune, handSize: this._realHandCount(p),
        isCurrent: i === this.turn
      }))
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
