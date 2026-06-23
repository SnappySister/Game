const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== 卡牌配置 ====================
const CARDS = [
  { id: 'fireball',  name: '火球术',   type: 'damage',    value: 6,  cost: 1, color: '#e74c3c', desc: '造成6点伤害' },
  { id: 'heal',      name: '治疗术',   type: 'heal',      value: 6,  cost: 1, color: '#2ecc71', desc: '恢复6点生命' },
  { id: 'shield',    name: '圣盾',     type: 'shield',    value: 6,  cost: 1, color: '#3498db', desc: '获得6点护盾' },
  { id: 'thunder',   name: '雷击',     type: 'damage',    value: 15, cost: 6, color: '#9b59b6', desc: '造成15点伤害' },
  { id: 'vampiric',  name: '吸血',     type: 'vampiric',  value: 12, cost: 5, color: '#c0392b', desc: '造成12伤并回6血' },
  { id: 'chaos',     name: '混沌',     type: 'chaos',     value: 6,  cost: 2, color: '#f39c12', desc: '随机效果(伤害、治疗、护盾、净化、中毒、灼烧、冰冻)' },
  { id: 'poison',    name: '毒雾',     type: 'poison',    value: 8,  cost: 3, color: '#27ae60', desc: '造成8伤并中毒' },
  { id: 'barrier',   name: '铁壁',     type: 'shield',    value: 15, cost: 6, color: '#2980b9', desc: '获得15点护盾' },
  { id: 'arcane',    name: '奥术智慧', type: 'draw',      value: 2,  cost: 3, color: '#1abc9c', desc: '抽2张牌' },
  { id: 'sprint',    name: '疾风斩',   type: 'draw_dmg',  value: 8,  cost: 3, color: '#e67e22', desc: '造成8伤并抽1' },
  { id: 'sacrifice', name: '献祭',     type: 'sacrifice', value: 15, cost: 4, color: '#8e44ad', desc: '自扣8血，对手扣15' },
  { id: 'suicide',   name: '自爆卡车', type: 'suicide',   value: 25, cost: 7, color: '#c0392b', desc: '双方各受25真伤' },
  { id: 'block',     name: '格挡',     type: 'block',     value: 0,  cost: 4, color: '#f1c40f', desc: '免疫下回合所有伤害' },
  { id: 'steal',     name: '顺手牵羊', type: 'steal',     value: 0,  cost: 2, color: '#2c3e50', desc: '随机偷对手1张牌' },
  { id: 'combust',   name: '烈焰',     type: 'combust',   value: 3,  cost: 5, color: '#e67e22', desc: '造成6伤并灼烧3层' },
  { id: 'curse',     name: '诅咒',     type: 'curse',     value: 5,  cost: 5, color: '#8e44ad', desc: '对手叠5层中毒' },
  { id: 'freeze',    name: '冰封',     type: 'freeze',    value: 0,  cost: 4, color: '#00bcd4', desc: '冻结对手1回合' },
  { id: 'doom',      name: '死亡宣告', type: 'doom',      value: 3,  cost: 5, color: '#607d8b', desc: '3回合后扣15血' },
  { id: 'cleanse',   name: '净化',     type: 'cleanse',   value: 3,  cost: 4, color: '#ecf0f1', desc: '清负面+回3血' }
];

const MAX_MANA = 10;
const START_HAND = 4;
const TURN_DRAW = 3;

const COIN_TEMPLATE = {
  id: 'coin', name: '水晶硬币', type: 'coin', value: 1, cost: 0,
  color: '#f1c40f', desc: '本回合水晶+1'
};

// ==================== 静态文件 ====================
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url;
  const p = path.join(__dirname, 'public', file);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); }
    else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(data); }
  });
});

// ==================== WebSocket + 游戏逻辑 ====================
const wss = new WebSocket.Server({ server });
let game = null;

function broadcast(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(s); });
}

function createPlayer(ws) {
  return {
    ws, name: '玩家' + (game.players.length + 1),
    hp: 100, maxHp: 100, shield: 0,
    mana: 0, maxMana: 0,
    poison: 0, burn: 0, frozen: false, doom: 0, doomStacks: 0,
    immune: false,
    hand: []
  };
}

function drawCards(player, n) {
  for (let i = 0; i < n; i++) {
    const template = weightedPick(CARDS);
    const card = { ...template };
    card.uuid = Math.random().toString(36).slice(2, 9);
    player.hand.push(card);
  }
}

function weightedPick(cards) {
  const totalWeight = cards.reduce((sum, c) => sum + Math.max(1, 14 - c.cost), 0);
  let rand = Math.random() * totalWeight;
  for (const c of cards) {
    rand -= Math.max(1, 14 - c.cost);
    if (rand < 0) return c;
  }
  return cards[cards.length - 1];
}

function giveCoin(player) {
  const coin = { ...COIN_TEMPLATE, uuid: Math.random().toString(36).slice(2, 9) };
  player.hand.push(coin);
}

function realHandCount(p) {
  return p.hand.filter(c => c.type !== 'coin').length;
}

function effectiveDamage(target, v) {
  if (target.immune) return 0;
  if (target.shield > 0) {
    const absorb = Math.min(target.shield, v);
    target.shield -= absorb;
    v -= absorb;
  }
  return v;
}

/* 统一结算 */
function resolveCard(user, target, card) {
  const v = card.value;
  let extra = {};
  switch (card.type) {
    case 'damage':
      target.hp = Math.max(0, target.hp - effectiveDamage(target, v));
      break;

    case 'heal':
      if (user.burn > 0) extra = { healBlocked: true };
      else user.hp = Math.min(user.maxHp, user.hp + v);
      break;

    case 'shield':
      user.shield += v;
      break;

    case 'vampiric':
      target.hp = Math.max(0, target.hp - effectiveDamage(target, v));
      if (user.burn > 0) extra = { healBlocked: true };
      else user.hp = Math.min(user.maxHp, user.hp + Math.floor(v / 2));
      break;

    case 'poison':
      target.hp = Math.max(0, target.hp - effectiveDamage(target, v));
      target.poison = (target.poison || 0) + 2;
      break;

    case 'combust':
      target.hp = Math.max(0, target.hp - effectiveDamage(target, 6));
      target.burn = (target.burn || 0) + v;
      break;

    case 'curse':
      target.poison = (target.poison || 0) + v;
      break;

    case 'freeze':
      target.frozen = true;
      break;

    case 'doom':
      target.doom = Math.max(target.doom || 0, v);
      target.doomStacks = Math.min(5, (target.doomStacks || 0) + 1);
      break;

    case 'draw':
      drawCards(user, v);
      break;

    case 'draw_dmg':
      target.hp = Math.max(0, target.hp - effectiveDamage(target, v));
      drawCards(user, 1);
      break;

    case 'chaos': {
      const pool = ['damage', 'heal', 'shield', 'cleanse', 'poison', 'burn', 'freeze'];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === 'damage') target.hp = Math.max(0, target.hp - effectiveDamage(target, v));
      if (pick === 'heal') {
        if (user.burn > 0) extra = { healBlocked: true };
        else user.hp = Math.min(user.maxHp, user.hp + v);
      }
      if (pick === 'shield') user.shield += v;
      if (pick === 'cleanse') {
        const hadNeg = user.poison > 0 || user.burn > 0 || user.frozen || user.doom > 0 || user.doomStacks > 0;
        const hadBurn = user.burn > 0;
        user.poison = 0; user.burn = 0; user.frozen = false; user.doom = 0; user.doomStacks = 0;
        if (!hadBurn) user.hp = Math.min(user.maxHp, user.hp + 3);
        extra = { ...extra, cleansed: hadNeg };
      }
      if (pick === 'poison') target.poison = (target.poison || 0) + 2;
      if (pick === 'burn')   target.burn   = (target.burn   || 0) + 3;
      if (pick === 'freeze') target.frozen = true;
      extra = { ...extra, chaosEffect: pick };
      break;
    }

    case 'sacrifice':
      user.hp = Math.max(0, user.hp - 8);
      target.hp = Math.max(0, target.hp - (target.immune ? 0 : 15));
      break;

    case 'suicide':
      user.hp = Math.max(0, user.hp - (user.immune ? 0 : v));
      target.hp = Math.max(0, target.hp - (target.immune ? 0 : v));
      break;

    case 'block':
      user.immune = true;
      break;

    case 'steal':
      if (target.hand.length > 0) {
        const idx = Math.floor(Math.random() * target.hand.length);
        const stolen = target.hand.splice(idx, 1)[0];
        user.hand.push(stolen);
        extra = { stolenName: stolen.name };
      } else {
        extra = { stolenFail: true };
      }
      break;

    case 'cleanse': {
      const hadPoison = user.poison > 0;
      const hadBurn = user.burn > 0;
      const hadFrozen = user.frozen;
      const hadDoom = user.doom > 0 || user.doomStacks > 0;
      user.poison = 0;
      user.burn = 0;
      user.frozen = false;
      user.doom = 0;
      user.doomStacks = 0;
      if (hadBurn) extra = { healBlocked: true };
      else user.hp = Math.min(user.maxHp, user.hp + 3);
      extra = { ...extra, cleansed: hadPoison || hadBurn || hadFrozen || hadDoom };
      break;
    }

    case 'coin':
      user.mana += 1;
      break;
  }
  if (target.hp <= 0) target.shield = 0;
  if (user.hp <= 0) user.shield = 0;
  return extra;
}

/* 回合结束结算负面效果 + 死亡倒计时 */
function applyStatusEffects(pp) {
  let parts = [];
  if (pp.poison && pp.hp > 0) {
    pp.hp = Math.max(0, pp.hp - pp.poison);
    parts.push(`${pp.poison}中毒`);
  }
  if (pp.burn && pp.hp > 0) {
    pp.hp = Math.max(0, pp.hp - pp.burn);
    parts.push(`${pp.burn}灼烧`);
  }
  if (pp.doom > 0) {
    pp.doom--;
    if (pp.doom === 0) {
      const dmg = 15 * (pp.doomStacks || 1);
      pp.hp = Math.max(0, pp.hp - dmg);
      parts.push(`死亡倒计时爆发(${dmg})`);
      pp.doomStacks = 0;
    } else {
      parts.push(`死亡倒计时${pp.doom}` + (pp.doomStacks > 1 ? `×${pp.doomStacks}` : ''));
    }
  }
  if (parts.length > 0) {
    game.logs.push(`${pp.name} 受到 ${parts.join(' + ')}`);
    return true;
  }
  return false;
}

function statePayload() {
  return {
    turn: game.turn,
    logs: game.logs.slice(-12),
    players: game.players.map((p, i) => ({
      name: p.name,
      hp: p.hp, maxHp: p.maxHp,
      shield: p.shield,
      mana: p.mana, maxMana: p.maxMana,
      poison: p.poison || 0,
      burn: p.burn || 0,
      frozen: !!p.frozen,
      doom: p.doom || 0,
      doomStacks: p.doomStacks || 0,
      immune: !!p.immune,
      handSize: realHandCount(p),
      isCurrent: i === game.turn
    }))
  };
}

function sendHand(who) {
  const p = game.players[who];
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ myHand: p.hand, myIndex: who }));
}

function tryStartGame() {
  if (game.players.length !== 2) return;
  game.turn = Math.random() < 0.5 ? 0 : 1;
  game.players.forEach(p => {
    p.hp = 100; p.maxHp = 100; p.shield = 0;
    p.poison = 0; p.burn = 0; p.frozen = false; p.doom = 0; p.doomStacks = 0;
    p.mana = 0; p.maxMana = 0; p.immune = false;
    p.hand = [];
  });
  game.logs = [];
  game.ended = false;

  game.players.forEach(p => drawCards(p, START_HAND));
  const second = (game.turn + 1) % 2;
  giveCoin(game.players[second]);
  game.logs.push(`${game.players[second].name} 获得后手硬币（+1水晶）`);

  beginTurn(game.turn);
  broadcast({ event: 'start', state: statePayload() });
  game.players.forEach((_, i) => sendHand(i));
}

function beginTurn(idx) {
  const p = game.players[idx];
  if (p.immune) {
    p.immune = false;
    game.logs.push(`${p.name} 的格挡效果消失了`);
  }
  p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
  p.mana = p.maxMana;
  drawCards(p, TURN_DRAW);
}

function nextTurn() {
  const prev = game.turn;
  const pp = game.players[prev];
  applyStatusEffects(pp);

  // 冰冻持续一回合，结束自动解除
  if (pp.frozen) {
    pp.frozen = false;
    game.logs.push(`${pp.name} 从冰冻中恢复`);
  }

  game.turn = (game.turn + 1) % 2;
  beginTurn(game.turn);
  broadcast({ event: 'update', state: statePayload() });
  game.players.forEach((_, i) => sendHand(i));
  checkEnd();
}

function checkEnd() {
  const alive = game.players.map((p, i) => p.hp > 0 ? i : -1).filter(x => x !== -1);
  if (alive.length <= 1) {
    const winner = alive[0] != null ? game.players[alive[0]].name : '平局';
    game.ended = true;
    game.turn = -1;
    broadcast({ event: 'over', winner });
  }
}

wss.on('connection', (ws) => {
  if (!game) game = { players: [], turn: -1, logs: [], ended: false };
  if (game.players.length >= 2) {
    ws.send(JSON.stringify({ event: 'full' }));
    ws.close();
    return;
  }
  const me = createPlayer(ws);
  game.players.push(me);
  const myIndex = game.players.length - 1;

  ws.send(JSON.stringify({ event: 'joined', name: me.name, index: myIndex }));
  broadcast({ event: 'lobby', count: game.players.length });
  if (game.players.length === 2) tryStartGame();

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (game.turn !== myIndex) return;

    if (msg.type === 'play') {
      const user = game.players[myIndex];
      const target = game.players[1 - myIndex];
      const idx = user.hand.findIndex(c => c.uuid === msg.uuid);
      if (idx === -1) return;
      const card = user.hand[idx];
      if (user.mana < card.cost) return;

      // 被冰冻时只能出净化
      if (user.frozen && card.type !== 'cleanse') {
        ws.send(JSON.stringify({ event: 'frozen' }));
        return;
      }

      user.hand.splice(idx, 1);
      user.mana -= card.cost;

      const extra = resolveCard(user, target, card);
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
      if (card.type === 'doom') log += '（死亡倒计时5回合）';
      if (card.type === 'cleanse') {
        if (extra.cleansed) log += '（清除所有负面）';
        else log += '（无负面可清）';
      }
      if (extra.chaosEffect === 'cleanse' && extra.cleansed) log += '（清除所有负面）';
      if (card.type === 'block') log += '（下回合免疫所有伤害）';
      if (card.type === 'coin') log += '（水晶+1）';
      if (extra.healBlocked) log += '（灼烧中，回血无效）';
      game.logs.push(log);

      broadcast({ event: 'update', state: statePayload() });
      game.players.forEach((_, i) => sendHand(i));
      checkEnd();
    }

    if (msg.type === 'discard') {
      const user = game.players[myIndex];
      const limit = user.maxMana;
      const needed = realHandCount(user) - limit;
      if (needed <= 0) return;
      const uuids = msg.uuids;
      if (!Array.isArray(uuids) || uuids.length !== needed) return;
      const set = new Set(uuids);
      if (set.size !== needed) return;
      if (!uuids.every(u => user.hand.some(c => c.uuid === u && c.type !== 'coin'))) return;

      user.hand = user.hand.filter(c => !set.has(c.uuid));
      game.logs.push(`${user.name} 弃掉了 ${needed} 张牌`);
      broadcast({ event: 'update', state: statePayload() });
      game.players.forEach((_, i) => sendHand(i));
      game.logs.push(`${user.name} 结束回合`);
      nextTurn();
    }

    if (msg.type === 'endTurn') {
      const user = game.players[myIndex];
      if (realHandCount(user) > user.maxMana) {
        ws.send(JSON.stringify({ event: 'need_discard', count: realHandCount(user) - user.maxMana, limit: user.maxMana }));
        return;
      }
      game.logs.push(`${user.name} 结束回合`);
      nextTurn();
    }
  });

  ws.on('close', () => {
    if (!game) return;
    const i = game.players.findIndex(p => p.ws === ws);
    if (i !== -1) game.players.splice(i, 1);

    if (game.players.length === 0) { game = null; return; }

    if (game.turn !== -1 && !game.ended && game.players.length === 1) {
      const lone = game.players[0];
      game.ended = true;
      game.turn = -1;
      if (lone.ws.readyState === 1) lone.ws.send(JSON.stringify({ event: 'over', winner: lone.name + '（对手逃跑）' }));
      game = null;
      return;
    }
    if (game.ended && game.players.length <= 1) game = null;
  });
});

const PORT = 3456;
server.listen(PORT, () => console.log('卡牌对战服务器运行在 http://localhost:' + PORT));
