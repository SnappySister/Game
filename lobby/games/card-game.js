/* 卡牌游戏引擎 - 从 card-game/server.js 提取的游戏逻辑类 */

const CONFIG = require('./card-config');
const { CARDS, COIN_TEMPLATE } = require('./card-data');
const { CHARACTERS } = require('./character-data');
const MAX_MANA = CONFIG.MAX_MANA;
const START_HAND = CONFIG.START_HAND;
const TURN_DRAW = CONFIG.TURN_DRAW;

class CardGameEngine {
  constructor(players, sendFn) {
    // players: Array<{id, name, ws, character}>
    this._send = sendFn; // (playerIndex, obj) => void
    this.players = players.map((p, i) => ({
      ...p,
      index: i,
      hp: CONFIG.START_HP, maxHp: CONFIG.START_HP, shield: 0,
      mana: 0, maxMana: 0,
      poison: 0, burn: 0, frozen: false, burnTurn: 0,
      immune: false, negImmune: false,
      hand: [],
      character: p.character || null,
      skillUsedThisTurn: false,
      berserkerDoubleDamage: false,
      cardCostPenalty: 0,
      equipBladeTurn: 0,
      equipBladeDmg: 0,
      equipBurnStacks: 0,
      equipShieldTurn: 0,
      equipShieldAmt: 0,
      equipManaTurn: 0,
      equipManaAmt: 0,
      summons: [],
      manaSavings: 0,       // 财阀储蓄水晶
      undeadUsed: false     // 不死族免死是否用过
    }));
    this.turn = -1;
    this.logs = [];
    this.ended = false;
  }

  start() {
    this.turn = Math.random() < 0.5 ? 0 : 1;
    this.players.forEach(p => {
      p.hp = CONFIG.START_HP; p.maxHp = CONFIG.START_HP; p.shield = 0;
      p.poison = 0; p.burn = 0; p.frozen = false;
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
    const v = card.value;
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
    this._gamblerBackfire(user, target, card, extra);
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
    const chaosCleanseCleared = (Array.isArray(extra.chaosEffect) ? extra.chaosEffect.includes('cleanse') : extra.chaosEffect === 'cleanse') && extra.cleansed;
    if (chaosCleanseCleared) log += '（清除所有负面）';
    if (card.type === 'cleanse') log += extra.cleansed ? '（清除所有负面）' : '（无负面可清）';
    if (card.type === 'cleanse_lite') log += extra.cleansed ? '（清除对面所有随从）' : '（对面无随从）';
    if (card.type === 'cleanse_burn') log += extra.healBlocked ? '（清负面，灼烧中回血无效，抽1张）' : '（清负面，回8血，抽1张）';
    if (card.type === 'cleanse_burn' && extra.purged) log += '，焚毁对面随从';
    if (card.type === 'block') log += '（下回合免疫所有伤害）';
    if (card.type === 'ward') log += '（下回合免疫负面效果）';
    if (card.type === 'coin') log += '（水晶+1）';
    if (card.type === 'summon_fire') log += '（召唤火灵，每回合递增伤害）';
    if (card.type === 'summon_spider') log += '（召唤蜘蛛女皇，每回合叠毒）';
    if (card.type === 'summon_guard') log += '（召唤壁垒守卫，3回合普通伤害减半）';
    if (card.type === 'equip') log += '（装备影刃3回合）';
    if (card.type === 'equip_shield') log += '（装备守护者之盾3回合）';
    if (card.type === 'equip_mana') log += '（装备宝藏2回合）';
    if (card.type === 'cond_damage') log += `（自己HP${user.hp}，造成${user.hp <= 40 ? 15 : 5}伤）`;
    if (card.type === 'cond_kill') log += extra.executed ? '（斩杀！）' : `（对手HP${target.hp}，造成8伤）`;
    if (card.type === 'cond_draw') log += `（手牌${this._realHandCount(user)}张后）`;
    if (card.type === 'rand_mana') log += ` → 造成${extra.manaDmg}点伤害(剩余水晶${user.mana}×3)`;
    if (card.type === 'rand_pact') log += ` → 回${extra.pactHeal}血，对手${extra.pactNegs.map(n => ({poison:'中毒',burn:'灼烧',freeze:'冰冻'})[n]).join('+')}${extra.negBlocked ? '（被护罩抵挡）' : ''}${extra.healBlocked ? '（灼烧中回血无效）' : ''}`;
    if (card.type === 'rand_copy') log += extra.copied.length ? ` → 复制了【${extra.copied.join('、')}】` : '（对手无手牌）';
    if (card.type === 'rand_summon') log += ` → 召唤了${extra.summoned.join('、')}`;
    if (card.type === 'meteor') log += ` → 造成${extra.meteorDmg}真伤${user.burn === 0 ? '并回'+(card.heal||10)+'血' : '（灼烧中回血无效）'}`;
    if (card.type === 'cond_neg') log += extra.judged ? ` → 对手有负面，造成${v + (card.bonusDmg||8)}伤` : ` → 造成${v}伤`;
    if (card.type === 'freeze_dmg') log += ` → 造成${v}伤并冻结对手${extra.negBlocked ? '（被护罩抵挡冻结）' : ''}`;
    if (card.type === 'equip_burn') log += '（装备烈焰之杖，每回合6伤+灼烧1层）';
    if (extra.summonHealed) log += `（对手有随从，回${extra.summonHealed}血）`;
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

  // 普通伤害修饰点：集中处理狂战士被动(+3)、寒冰法师冻结易伤(+3)、主动(翻倍)、壁垒守卫减伤。仅卡牌普通伤害调用。
  _dealDamage(user, target, baseV) {
    if (user.character === 'berserker' && user.hp <= user.maxHp * CONFIG.BERSERKER_HP_RATIO) baseV += CONFIG.BERSERKER_BONUS;
    // 寒冰法师被动：对手冻结期间受到的伤害+3
    if (user.character === 'cryomage' && target.frozen) baseV += CONFIG.CRYO_VULN;
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
      damage:   () => {
        this._dealDamage(user, target, v);
        // 死亡之触：对手有随从则回血
        if (card.summonHeal && target.summons && target.summons.length > 0) {
          if (user.burn === 0) { user.hp = Math.min(user.maxHp, user.hp + card.summonHeal); extra = { ...extra, summonHealed: card.summonHeal }; }
        }
      },
      heal:     () => { if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + v); },
      shield:   () => { user.shield += v; },
      vampiric: () => { this._dealDamage(user, target, v); if (user.burn > 0) extra = { healBlocked: true }; else user.hp = Math.min(user.maxHp, user.hp + Math.floor(v / 2)); },
      poison:   () => { this._dealDamage(user, target, v); if (target.negImmune) extra = { negBlocked: true }; else target.poison += card.stacks || 3; },
      combust:  () => { this._dealDamage(user, target, card.fixedDmg || 6); if (target.negImmune) extra = { negBlocked: true }; else { target.burn += v; target.burnTurn = CONFIG.STATUS_DURATION; } },
      curse:    () => { if (target.negImmune) extra = { negBlocked: true }; else target.poison += v; },
      freeze:   () => { if (target.negImmune) extra = { negBlocked: true }; else target.frozen = true; },
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
            const h = user.poison > 0 || user.burn > 0 || user.frozen;
            const b = user.burn > 0; user.poison = 0; user.burn = 0; user.frozen = false; user.burnTurn = 0;
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
        const n = user.poison > 0 || user.burn > 0 || user.frozen;
        const b = user.burn > 0; user.poison = 0; user.burn = 0; user.frozen = false; user.burnTurn = 0;
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
        const n = user.poison > 0 || user.burn > 0 || user.frozen;
        const b = user.burn > 0;
        user.poison = 0; user.burn = 0; user.frozen = false; user.burnTurn = 0;
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
        user.summons.push({ kind: 'firesprite', name: card.name, turns: card.summonTurns || 3, dmg: card.summonDmg || v, incr: card.summonIncr || 2 });
      },
      summon_spider: () => {
        user.summons.push({ kind: 'spider', name: card.name, turns: card.summonTurns || 3, stacks: card.summonStacks || 2 });
      },
      summon_guard: () => {
        user.summons.push({ kind: 'guardian', name: card.name, turns: card.summonTurns || 3 });
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
      },
      /* ===== 高费终结牌 ===== */
      // 陨石坠落：真实伤害(无视护盾)+回血
      meteor: () => {
        const dmg = target.immune ? 0 : (card.value || 25);
        target.hp = Math.max(0, target.hp - dmg);
        if (user.burn === 0) user.hp = Math.min(user.maxHp, user.hp + (card.heal || 10));
        extra = { ...extra, meteorDmg: dmg };
      },
      // 神圣审判：对手有负面时+bonusDmg
      cond_neg: () => {
        let dmg = v;
        const hasNeg = target.poison > 0 || target.burn > 0 || target.frozen;
        if (hasNeg) dmg += (card.bonusDmg || 8);
        this._dealDamage(user, target, dmg);
        extra = { ...extra, judged: hasNeg };
      },
      /* ===== 冰系牌 ===== */
      // 冰锥/暴风雪：伤害+冻结
      freeze_dmg: () => {
        this._dealDamage(user, target, v);
        if (target.negImmune) extra = { ...extra, negBlocked: true };
        else target.frozen = true;
      },
      /* ===== 烈焰之杖装备：每回合伤害+灼烧 ===== */
      equip_burn: () => {
        user.equipBladeTurn = card.equipTurns || 2;
        user.equipBladeDmg = card.equipDmg || 6;
        user.equipBurnStacks = card.burnStacks || 1;
      },
      /* ===== 随机卡牌(赌徒双发) ===== */
      // 能量爆发：与水晶联动，伤害=剩余水晶×倍率
      rand_mana: () => {
        const dmg = user.mana * (card.value || 3);
        this._dealDamage(user, target, dmg);
        extra = { ...extra, manaDmg: dmg };
      },
      // 命运契约：回血+随机给对手负面（赌徒双发=回16+两个负面）
      rand_pact: () => {
        const times = user.character === 'gambler' ? 2 : 1;
        const v2 = card.value || 8;
        let heal = 0;
        const negs = [];
        for (let t = 0; t < times; t++) {
          if (user.burn > 0) extra = { ...extra, healBlocked: true };
          else { user.hp = Math.min(user.maxHp, user.hp + v2); heal += v2; }
          const pool = ['poison', 'burn', 'freeze'];
          const pick = pool[Math.floor(Math.random() * pool.length)];
          if (target.negImmune) { extra = { ...extra, negBlocked: true }; }
          else {
            if (pick === 'poison') target.poison += card.stacks || 3;
            if (pick === 'burn') { target.burn += card.stacks || 3; target.burnTurn = CONFIG.STATUS_DURATION; }
            if (pick === 'freeze') target.frozen = true;
          }
          negs.push(pick);
        }
        extra = { ...extra, pactHeal: heal, pactNegs: negs };
      },
      // 幻象术：随机复制对手一张手牌（赌徒复制两张）
      rand_copy: () => {
        const times = user.character === 'gambler' ? 2 : 1;
        const stolen = [];
        for (let t = 0; t < times; t++) {
          if (target.hand.length > 0) {
            const idx = Math.floor(Math.random() * target.hand.length);
            const copy = { ...target.hand[idx], uuid: Math.random().toString(36).slice(2, 9) };
            user.hand.push(copy);
            stolen.push(copy.name);
          }
        }
        extra = { ...extra, copied: stolen };
      },
      // 召唤仪式：随机召唤一个随从（赌徒召唤两个）
      rand_summon: () => {
        const times = user.character === 'gambler' ? 2 : 1;
        const summoned = [];
        // 每类取所有卡牌(含火灵/剑魔/地狱火等同类变体)，合并后随机抽
        const pool = CARDS.filter(c => ['summon_fire', 'summon_spider', 'summon_guard'].includes(c.type));
        for (let t = 0; t < times; t++) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick.type === 'summon_fire') {
            user.summons.push({ kind: 'firesprite', name: pick.name, turns: pick.summonTurns || 3, dmg: pick.summonDmg || 5, incr: pick.summonIncr || 2 });
            summoned.push(pick.name);
          } else if (pick.type === 'summon_spider') {
            user.summons.push({ kind: 'spider', name: pick.name, turns: pick.summonTurns || 3, stacks: pick.summonStacks || 2 });
            summoned.push(pick.name);
          } else {
            user.summons.push({ kind: 'guardian', name: pick.name, turns: pick.summonTurns || 3 });
            summoned.push(pick.name);
          }
        }
        extra = { ...extra, summoned };
      }
    };
    (RESOLVERS[card.type] || (() => {}))();
    if (target.hp <= 0) target.shield = 0;
    if (user.hp <= 0) user.shield = 0;
    return extra;
  }

  // 出牌后被动钩子（在 _resolveCard 之后调用）
  _onCardResolved(user, target, card) {
    const NEGATIVE_TYPES = ['poison', 'combust', 'curse', 'freeze'];
    if (user.character === 'warlock' && NEGATIVE_TYPES.includes(card.type)) {
      this._drawCards(user, 1);
      this.logs.push(`${user.name} 触发【血契】抽1张牌`);
    }
  }

  // 赌徒随机牌反噬：用随机牌时20%概率自己得一个随机负面效果
  _gamblerBackfire(user, target, card, extra) {
    const RAND_TYPES = ['chaos', 'rand_mana', 'rand_pact', 'rand_copy', 'rand_summon'];
    if (user.character !== 'gambler' || !RAND_TYPES.includes(card.type)) return;
    if (Math.random() >= CONFIG.GAMBLER_BACKFIRE) return; // 80%无事发生

    if (user.negImmune) {
      this.logs.push(`${user.name} 的随机牌反噬被护罩抵挡`);
      return;
    }
    const pool = ['poison', 'burn', 'freeze'];
    const neg = pool[Math.floor(Math.random() * pool.length)];
    if (neg === 'poison') { user.poison += 3; this.logs.push(`${user.name} 随机牌反噬！自己中毒3层`); }
    else if (neg === 'burn') { user.burn += 3; user.burnTurn = CONFIG.STATUS_DURATION; this.logs.push(`${user.name} 随机牌反噬！自己灼烧3层`); }
    else { user.frozen = true; this.logs.push(`${user.name} 随机牌反噬！自己被冻结`); }
  }

  _applyStatusEffects(pp) {
    let parts = [];
    if (pp.immune) {
      let blocked = [];
      if (pp.poison && pp.hp > 0) blocked.push('中毒');
      if (pp.burn && pp.hp > 0)   { blocked.push('灼烧'); pp.burnTurn--; if (pp.burnTurn <= 0) pp.burn = 0; }
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
    p.mana = p.maxMana + (p.manaSavings || 0); // 财阀储蓄水晶自动可用
    // 大法师被动：抽牌+1
    const drawN = p.character === 'archmage' ? TURN_DRAW + 1 : TURN_DRAW;
    this._drawCards(p, drawN);
    // 圣骑士被动：回合开始回2血(灼烧时除外) + 已有护盾时额外叠盾
    if (p.character === 'paladin' && p.burn === 0 && p.hp > 0) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + 2);
      if (p.hp > before) this.logs.push(`${p.name} 触发【圣愈】回2血`);
      // 叠盾：已有护盾时额外+3盾
      if (p.shield > 0) {
        p.shield += CONFIG.PALADIN_SHIELD_BONUS;
        this.logs.push(`${p.name} 触发【圣盾增幅】护盾+${CONFIG.PALADIN_SHIELD_BONUS}`);
      }
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
      // 烈焰之杖：附带灼烧
      if (p.equipBurnStacks > 0 && !target.negImmune) {
        target.burn += p.equipBurnStacks;
        target.burnTurn = CONFIG.STATUS_DURATION;
      }
      p.equipBladeTurn--;
      const name = p.equipBurnStacks > 0 ? '烈焰之杖' : '影刃';
      this.logs.push(`${p.name} 的${name}造成${dmg}点伤害${p.equipBurnStacks > 0 ? `并灼烧${p.equipBurnStacks}层` : ''}${p.equipBladeTurn === 0 ? '（损坏）' : ''}`);
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

    // 扣除水晶（财阀【水晶爆发】改为消耗当前全部水晶，由其 case 自行处理，此处跳过固定扣费）
    if (user.character !== 'tycoon') user.mana -= ch.active.cost;

    switch (user.character) {
      case 'berserker':
        user.hp = Math.max(0, user.hp - CONFIG.BERSERKER_SELF_DMG);
        user.berserkerDoubleDamage = true;
        this.logs.push(`${user.name} 释放【血怒】(耗${ch.active.cost}水晶)自扣${CONFIG.BERSERKER_SELF_DMG}血，本回合伤害翻倍`);
        break;
      case 'paladin':
        user.shield += 10;
        this.logs.push(`${user.name} 释放【圣盾】(耗${ch.active.cost}水晶)获得10护盾`);
        break;
      case 'warlock': {
        const ci = user.hand.findIndex(c => c.uuid === msg.uuid);
        if (ci === -1) { user.mana += ch.active.cost; return; } // 牌不存在，退还水晶
        user.hand.splice(ci, 1);
        // 弃牌补偿回血（灼烧时除外，与治疗逻辑一致）
        const healed = user.burn === 0;
        if (healed) user.hp = Math.min(user.maxHp, user.hp + CONFIG.WARLOCK_HEAL);
        if (target.negImmune) {
          this.logs.push(`${user.name} 释放【诅咒】(耗${ch.active.cost}水晶,被护罩抵挡,${healed ? '回'+CONFIG.WARLOCK_HEAL+'血' : '灼烧中回血无效'})`);
        } else {
          target.poison += CONFIG.WARLOCK_POISON;
          this.logs.push(`${user.name} 释放【诅咒】(耗${ch.active.cost}水晶)对手叠${CONFIG.WARLOCK_POISON}层中毒,${healed ? '回'+CONFIG.WARLOCK_HEAL+'血' : '灼烧中回血无效'}`);
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
        this._drawCards(user, 2);
        {
          const discarded = [];
          for (let i = 0; i < 2 && target.hand.length > 0; i++) {
            const di = Math.floor(Math.random() * target.hand.length);
            discarded.push(target.hand.splice(di, 1)[0].name);
          }
          if (discarded.length) this.logs.push(`${user.name} 释放【奥术涌动】(耗${ch.active.cost}水晶)抽2张并弃对手【${discarded.join('、')}】`);
          else this.logs.push(`${user.name} 释放【奥术涌动】(耗${ch.active.cost}水晶)抽2张(对手无手牌)`);
        }
        break;
      case 'tycoon': {
        const spent = user.mana || 0;
        const dmg = spent * CONFIG.TYCOON_DMG_PER_SAVE;
        if (dmg > 0) {
          this._dealDamage(user, target, dmg);
          this.logs.push(`${user.name} 释放【水晶爆发】，消耗全部${spent}水晶造成${dmg}伤害`);
          user.mana = 0;
        } else {
          this.logs.push(`${user.name} 释放【水晶爆发】（无水晶可用）`);
        }
        break;
      }
      case 'undead': {
        const dmg = CONFIG.UNDEAD_DMG, heal = CONFIG.UNDEAD_HEAL;
        this._dealDamage(user, target, dmg);
        if (user.burn === 0) user.hp = Math.min(user.maxHp, user.hp + heal);
        this.logs.push(`${user.name} 释放【亡者汲取】(耗${ch.active.cost}水晶)，造成${dmg}伤回${heal}血${user.burn > 0 ? '（灼烧中回血无效）' : ''}`);
        break;
      }
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
    // 财阀被动：回合结束剩余水晶≥5时存入储蓄
    if (pp.character === 'tycoon' && pp.mana >= CONFIG.TYCOON_SAVE_THRESHOLD) {
      pp.manaSavings = (pp.manaSavings || 0) + pp.mana;
      this.logs.push(`${pp.name} 触发【囤积】，存入${pp.mana}水晶(储蓄${pp.manaSavings})`);
    }
    this.turn = (this.turn + 1) % 2;
    this._beginTurn(this.turn);
    this._broadcastAll();
    this._checkEnd();
  }

  _checkEnd() {
    // 不死族被动：致命伤害保1血(每局1次)
    for (const p of this.players) {
      if (p.hp <= 0 && p.character === 'undead' && !p.undeadUsed) {
        p.hp = 1;
        p.undeadUsed = true;
        this.logs.push(`${p.name} 触发【不灭】，保留1血不死！`);
      }
    }
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

  // 当前装备列表(含名称)，供前端文字显示
  _equipList(p) {
    const list = [];
    if (p.equipBladeTurn > 0) {
      // equipBurnStacks>0 为烈焰之杖，否则为影刃
      list.push({ name: p.equipBurnStacks > 0 ? '烈焰之杖' : '影刃', turn: p.equipBladeTurn });
    }
    if (p.equipShieldTurn > 0) list.push({ name: '守护者之盾', turn: p.equipShieldTurn });
    if (p.equipManaTurn > 0) list.push({ name: '宝藏', turn: p.equipManaTurn });
    return list;
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
          frozen: !!p.frozen,
          immune: !!p.immune, negImmune: !!p.negImmune, handSize: this._realHandCount(p),
          isCurrent: i === this.turn, disconnected: !!p.disconnected,
          cardCostPenalty: p.cardCostPenalty || 0,
          equipBladeTurn: p.equipBladeTurn || 0,
          equipShieldTurn: p.equipShieldTurn || 0,
          equipManaTurn: p.equipManaTurn || 0,
          // 装备列表(含名称，供前端文字显示)：影刃/烈焰之杖/守护者之盾/宝藏
          equips: this._equipList(p),
          summons: (p.summons || []).map(s => ({
            kind: s.kind,
            name: s.name || '',
            turns: s.turns === undefined ? -1 : s.turns,
            dmg: s.dmg === undefined ? 0 : s.dmg,
            stacks: s.stacks === undefined ? 0 : s.stacks
          })),
          character: p.character,
          characterEmoji: ch ? ch.emoji : '',
          characterName: ch ? ch.name : '',
          skillName: ch && ch.active ? ch.active.name : '',
          skillDesc: ch && ch.active ? ch.active.desc : '',
          skillCost: ch && ch.active ? ch.active.cost : 0,
          skillUsedThisTurn: !!p.skillUsedThisTurn,
          manaSavings: p.manaSavings || 0,
          undeadUsed: !!p.undeadUsed
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
