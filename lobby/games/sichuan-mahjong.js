/* 四川麻将引擎 - 血战到底（Phase 2: 碰/杠/抢杠胡/刮风下雨） */

const SUITS = ['wan', 'tiao', 'tong'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function tileKey(t) { return `${t.suit}_${t.rank}`; }
function tileLabel(t) {
  const s = { wan: '\u4e07', tiao: '\u6761', tong: '\u7b52' }[t.suit];
  return `${t.rank}${s}`;
}

function suitLabel(suit) {
  return { wan: '万', tiao: '条', tong: '筒' }[suit] || suit;
}

class SichuanMahjongEngine {
  constructor(players, sendFn, initialScores = [], logFn = null) {
    this._send = sendFn;
    this._log = logFn || (() => {});
    this.playerCount = players.length;
    this.initialScores = [...initialScores];  // 保存本局开始时的分数，用于计算变化量（对局总账）
    this.players = players.map((p, i) => ({
      ...p,
      index: i,
      hand: [],
      discards: [],
      melds: [],
      dingque: null,
      score: initialScores[i] || 0,
      isHu: false,
      huTile: null,
      disconnected: false,
      lastDrawn: null,
      fanDetail: null,
      gangGain: 0,  // 本局杠净收入（用于杠上炮转移、流局退税）
    }));
    this.deck = [];
    this.discardPile = [];
    this.dealerIndex = 0;
    this.currentPlayer = 0;
    this.phase = 'idle'; // idle, exchange, dingque, playing, waitAction, ended
    this.turn = 0;
    this.logs = [];
    this.ended = false;
    this.pendingTile = null;
    this.pendingActions = new Map();
    this.waitingPlayers = [];
    this.jiagangPending = null;
    this.turn = 0;
    this.lastTilePlayed = false;
    this.exchangeCards = [];
    this.diceResult = null;
    this.firstHuPlayerIndex = -1;
    this.gangTransactions = [];  // 本局杠分交易 {from, to, amount}，流局退税用
  }

  /* ==================== 初始化 ==================== */
  start() {
    this.deck = this._createDeck();
    this._shuffle(this.deck);

    for (let i = 0; i < this.players.length; i++) {
      const count = (i === this.dealerIndex) ? 14 : 13;
      this.players[i].hand = this.deck.splice(0, count);
      this._sortHand(this.players[i].hand);
      this.players[i].discards = [];
      this.players[i].melds = [];
      this.players[i].dingque = null;
      this.players[i].isHu = false;
      this.players[i].huTile = null;
      this.players[i].disconnected = false;
      this.players[i].lastDrawn = null;
      this.players[i].gangDrawFlag = false;
      this.players[i].fanDetail = null;
    }

    this.discardPile = [];
    this.currentPlayer = this.dealerIndex;
    if (this.players.length <= 2) {
      this.phase = 'dingque';
      this.logs = [`第${this.turn + 1}局开始，请选择定缺`];
    } else {
      this.phase = 'exchange';
      this.logs = [`第${this.turn + 1}局开始，请选择3张同花色牌交换`];
    }
    this.ended = false;
    this.pendingTile = null;
    this.pendingActions = new Map();
    this.waitingPlayers = [];
    this.jiagangPending = null;
    this.lastTilePlayed = false;
    this.exchangeCards = [];
    this.diceResult = null;
    this.firstHuPlayerIndex = -1;

    this._log(`[engine] 游戏开始(${this.players.length}人), 庄=P${this.dealerIndex}, 牌堆=${this.deck.length}`);
    this._broadcastAll();
  }

  _createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        for (let i = 0; i < 4; i++) deck.push({ suit, rank });
      }
    }
    return deck;
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  _sortHand(hand) {
    hand.sort((a, b) => {
      const si = SUITS.indexOf(a.suit);
      const sj = SUITS.indexOf(b.suit);
      if (si !== sj) return si - sj;
      return a.rank - b.rank;
    });
  }

  /* ==================== 消息入口 ==================== */
  handleMessage(playerIndex, rawMsg) {
    if (this.ended) { this._log(`[engine] 游戏已结束，忽略消息`); return; }
    const msg = JSON.parse(rawMsg);

    if (msg.type === 'dingque') {
      this._handleDingque(playerIndex, msg);
    } else if (msg.type === 'exchange') {
      this._handleExchange(playerIndex, msg);
    } else if (msg.type === 'discard') {
      this._handleDiscard(playerIndex, msg);
    } else if (msg.type === 'action') {
      this._handleAction(playerIndex, msg);
    } else if (msg.type === 'selfAction') {
      this._handleSelfAction(playerIndex, msg);
    } else {
      this._log(`[engine] 未知消息类型: ${msg.type}`);
    }
  }

  _handleDingque(idx, msg) {
    if (this.phase !== 'dingque') { this._log(`[engine] P${idx}定缺拒绝: phase=${this.phase}`); return; }
    const suit = msg.suit;
    if (!SUITS.includes(suit)) { this._log(`[engine] P${idx}定缺拒绝: 非法花色${suit}`); return; }

    this.players[idx].dingque = suit;
    this.logs.push(`${this.players[idx].name} 定缺${suitLabel(suit)}`);

    if (this.players.every(p => p.dingque !== null)) {
      const allSame = this.players.every(p => p.dingque === this.players[0].dingque);
      if (allSame) {
        const sameSuit = suitLabel(this.players[0].dingque);
        this.start();
        this.logs.push(`全体定缺${sameSuit}，重新发牌`);
        this._broadcastAll();
        return;
      }
      this.phase = 'playing';
      this.logs.push('定缺结束，庄家出牌');
    }
    this._broadcastAll();
  }

  _handleExchange(idx, msg) {
    if (this.phase !== 'exchange') { this._log(`[engine] P${idx}exchange拒绝: phase=${this.phase}`); return; }
    const cards = msg.cards;
    if (!Array.isArray(cards) || cards.length !== 3) { this._log(`[engine] P${idx}exchange拒绝: 牌数量=${cards ? cards.length : 'null'}`); return; }
    const player = this.players[idx];
    const suit = cards[0].suit;
    if (!SUITS.includes(suit)) { this._log(`[engine] P${idx}exchange拒绝: 非法花色${suit}`); return; }
    if (!cards.every(c => c.suit === suit)) { this._log(`[engine] P${idx}exchange拒绝: 不是同花色`); return; }
    const handCopy = [...player.hand];
    for (const c of cards) {
      const ci = handCopy.findIndex(t => t.suit === c.suit && t.rank === c.rank);
      if (ci === -1) { this._log(`[engine] P${idx}exchange拒绝: 手牌中没有${tileLabel(c)}`); return; }
      handCopy.splice(ci, 1);
    }

    this.exchangeCards[idx] = cards.map(c => ({ suit: c.suit, rank: c.rank }));
    this.logs.push(`${player.name} 选定交换牌`);
    this._broadcastAll();

    if (this.players.every((p, i) => this.exchangeCards[i] && this.exchangeCards[i].length === 3)) {
      this._performExchange();
    }
  }

  _performExchange() {
    const dice = Math.floor(Math.random() * 6) + 1;
    const direction = (dice === 1 || dice === 3 || dice === 5) ? 'shun' : 'ni';

    this.diceResult = { dice, direction };
    const dirLabel = { shun: '顺时针', ni: '逆时针' };
    this.logs.push(`掷骰子 ${dice} 点，${dirLabel[direction]}交换`);
    this._log(`[engine] 换三张: 骰子${dice}点, 方向=${direction}(${dirLabel[direction]})`);
    this._broadcastAll();

    const n = this.players.length;
    const buffers = this.exchangeCards.map(cards => cards.map(c => ({ ...c })));

    for (let i = 0; i < n; i++) {
      const give = buffers[i];
      const giver = this.players[i];
      for (const c of give) {
        const gi = giver.hand.findIndex(t => t.suit === c.suit && t.rank === c.rank);
        if (gi !== -1) giver.hand.splice(gi, 1);
      }
    }

    for (let i = 0; i < n; i++) {
      const give = buffers[i];
      let receiverIdx;
      if (direction === 'shun') receiverIdx = (i + 1) % n;
      else receiverIdx = (i - 1 + n) % n;

      const receiver = this.players[receiverIdx];
      receiver.hand.push(...give);
      this._sortHand(receiver.hand);
    }

    for (let i = 0; i < n; i++) {
      this._sortHand(this.players[i].hand);
    }

    this.logs.push('换三张完成，进入定缺');
    this.phase = 'dingque';
    this.exchangeCards = [];
    this._broadcastAll();
  }

  _handleDiscard(idx, msg) {
    if (this.phase !== 'playing') { this._log(`[engine] P${idx}discard拒绝: phase=${this.phase}不是playing`); return; }
    if (this.currentPlayer !== idx) { this._log(`[engine] P${idx}discard拒绝: 不是当前玩家(current=${this.currentPlayer})`); return; }

    const tile = msg.tile;
    if (!tile || !SUITS.includes(tile.suit) || !RANKS.includes(tile.rank)) {
      this._log(`[engine] P${idx}discard拒绝: 非法牌${tile ? tileLabel(tile) : 'null'}`);
      return;
    }

    const player = this.players[idx];
    const handIdx = player.hand.findIndex(t => t.suit === tile.suit && t.rank === tile.rank);
    if (handIdx === -1) { this._log(`[engine] P${idx}discard拒绝: 手牌中没有${tileLabel(tile)}`); return; }

    const removedTile = player.hand.splice(handIdx, 1)[0];
    this._sortHand(player.hand);
    player.discards.push(tile);
    this.discardPile.push(tile);
    this.pendingTile = tile;
    this.logs.push(`${player.name} 打出 ${tileLabel(tile)}`);

    if (removedTile === player.lastDrawn) {
      player.lastDrawn = null;
    }

    // 出牌后清掉新牌标记，让放大效果消失
    for (const t of player.hand) t.isNew = false;

    // 检查其他人是否可胡这张牌
    const huCandidates = [];
    for (let i = 0; i < this.players.length; i++) {
      if (i === idx) continue;
      if (this.players[i].isHu) continue;
      if (this.players[i].disconnected) continue;
      const testHand = [...this.players[i].hand, tile];
      const hasDingqueInMelds = this.players[i].melds.some(m => m.tiles.some(t => t.suit === this.players[i].dingque));
      if (!hasDingqueInMelds && this._canHu(testHand, this.players[i].dingque)) {
        huCandidates.push(i);
      }
    }

    if (huCandidates.length > 0) {
      this.phase = 'waitAction';
      this.waitingPlayers = huCandidates;
      this.pendingActions = new Map();
      this._broadcastAll();
      // 对每个胡牌候选玩家，同时检测是否能碰/杠，给玩家完整选择权
      for (const i of huCandidates) {
        const actions = ['hu'];
        const canGang = this._canMingGang(i, tile);
        const canPeng = this._canPeng(i, tile);
        if (canGang) actions.push('gang');
        if (canPeng) actions.push('peng');
        actions.push('pass');
        this._send(i, { event: 'actionRequest', actions, tile, reason: 'dianpao' });
      }
      this._log(`[engine] P${idx}出${tileLabel(tile)} -> 点炮候选=${huCandidates.join(',')}`);
      return;
    }

    // 检查碰/杠（同一张牌最多1人可操作）
    for (let i = 0; i < this.players.length; i++) {
      if (i === idx) continue;
      if (this.players[i].isHu) continue;
      if (this.players[i].disconnected) continue;

      const canGang = this._canMingGang(i, tile);
      const canPeng = this._canPeng(i, tile);
      if (canGang || canPeng) {
        this.phase = 'waitAction';
        this.waitingPlayers = [i];
        this.pendingActions = new Map();
        this._broadcastAll();
        const actions = [];
        if (canGang) actions.push('gang');
        if (canPeng) actions.push('peng');
        actions.push('pass');
        const reason = canGang && canPeng ? 'peng_gang' : (canGang ? 'minggang' : 'peng');
        this._send(i, { event: 'actionRequest', actions, tile, reason });
        this._log(`[engine] P${idx}出${tileLabel(tile)} -> P${i}可${actions.join('/')}`);
        return;
      }
    }

    // 无人可响应
    this._log(`[engine] P${idx}出${tileLabel(tile)} -> 无人响应, 进下家`);
    this._nextPlayer();
  }

  _handleAction(idx, msg) {
    if (this.phase !== 'waitAction') { this._log(`[engine] P${idx}action拒绝: phase=${this.phase}`); return; }
    if (!this.waitingPlayers.includes(idx)) { this._log(`[engine] P${idx}action拒绝: 不在waitingPlayers中`); return; }
    const action = msg.action;

    const isSelfAction = this.waitingPlayers.length === 1 && this.waitingPlayers[0] === this.currentPlayer;

    this.pendingActions.set(idx, action);

    if (isSelfAction) {
      if (action === 'hu' || action === 'pass') {
        // 允许
      } else if (!['angang', 'jiagang'].includes(action)) {
        this._log(`[engine] P${idx}action拒绝: 自操作非法action=${action}`);
        return;
      }
      if (action === 'hu') {
        this._doHu(idx, this.pendingTile || this.players[idx].hand[this.players[idx].hand.length - 1], true);
        this.phase = 'playing';
        if (this._shouldEnd()) { this._endGame(); return; }
        this._nextPlayer();
        return;
      }
      if (action === 'pass') {
        this.phase = 'playing';
        this.pendingTile = null;
        this.waitingPlayers = [];
        this.pendingActions = new Map();
        this._broadcastAll();
        return;
      }
      // angang/jiagang 走 _handleSelfAction
      return;
    }

    // 他人响应(点炮/抢杠胡/碰/明杠)
    if (!['hu', 'pass', 'peng', 'gang'].includes(action)) {
      this._log(`[engine] P${idx}action拒绝: 响应阶段非法action=${action}`);
      return;
    }

    // 等待所有候选者响应
    const allResponded = this.waitingPlayers.every(i => this.pendingActions.has(i));
    if (!allResponded) return;

    // 处理所有响应
    if (action === 'hu' || this.pendingActions.get(idx) === 'hu') {
      // 一炮多响:收集所有选择胡的玩家,依次执行
      const huPlayers = this.waitingPlayers.filter(i => this.pendingActions.get(i) === 'hu');
      for (const huIdx of huPlayers) {
        this._doHu(huIdx, this.pendingTile, false);
      }

      if (this.jiagangPending) {
        const gangIdx = this.jiagangPending.idx;
        const meldIdx = this.jiagangPending.pengMeldIdx;
        const meld = this.players[gangIdx].melds[meldIdx];
        if (meld) {
          meld.type = 'peng';
          meld.tiles.pop();
          delete meld.sourcePengIdx;
        }
        this.jiagangPending = null;
      }

      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      if (this._shouldEnd()) { this._endGame(); return; }
      this._broadcastAll();
      this._nextPlayer();
      return;
    }

    const acted = this.waitingPlayers.find(i => this.pendingActions.get(i) !== 'pass');
    if (acted !== undefined) {
      const act = this.pendingActions.get(acted);
      this._log(`[engine] 多人响应 -> P${acted}选择${act}, pendingTile=${tileLabel(this.pendingTile)}`);
      if (act === 'peng') this._doPeng(acted, this.pendingTile);
      else if (act === 'gang') {
        const hasAction = this._doMingGang(acted, this.pendingTile);
        if (hasAction) return;
      }
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
      return;
    }

    // 全部 pass
    if (this.jiagangPending) {
      this._log(`[engine] 全部pass -> 加杠继续 P${this.jiagangPending.idx}`);
      const { idx: gangIdx, tile, pengMeldIdx } = this.jiagangPending;
      this._completeJiaGang(gangIdx, tile, pengMeldIdx);
      this.jiagangPending = null;
      // _drawExtra 可能已将 phase 改为 waitAction（杠上花 / 杠后杠）
      if (this.phase === 'waitAction') return;
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
      return;
    }

    this._log(`[engine] 全部pass -> 进下家`);
    this.phase = 'playing';
    this.pendingTile = null;
    this.waitingPlayers = [];
    this.pendingActions = new Map();
    this._nextPlayer();
  }

  _handleSelfAction(idx, msg) {
    const action = msg.action;
    if (action === 'angang') {
      if (this.phase !== 'waitAction') { this._log(`[engine] P${idx}angang拒绝: phase=${this.phase}`); return; }
      if (!this.waitingPlayers.includes(idx)) { this._log(`[engine] P${idx}angang拒绝: 不在waitingPlayers`); return; }
      const tk = msg.tileKey;
      if (!this._canAnGang(idx).includes(tk)) { this._log(`[engine] P${idx}angang拒绝: 不能暗杠${tk}`); return; }
      this._doAnGang(idx, tk);
      return;
    }
    if (action === 'jiagang') {
      if (this.phase !== 'waitAction') { this._log(`[engine] P${idx}jiagang拒绝: phase=${this.phase}`); return; }
      if (!this.waitingPlayers.includes(idx)) { this._log(`[engine] P${idx}jiagang拒绝: 不在waitingPlayers`); return; }
      const pengMeldIdx = msg.pengMeldIdx;
      if (!this._canJiaGang(idx).includes(pengMeldIdx)) { this._log(`[engine] P${idx}jiagang拒绝: 不能加杠meld=${pengMeldIdx}`); return; }
      this._doJiaGang(idx, pengMeldIdx);
      return;
    }
    this._handleAction(idx, msg);
  }

  /* ==================== 摸牌与回合推进 ==================== */
  _nextPlayer() {
    this.pendingTile = null;
    this.waitingPlayers = [];
    this.pendingActions = new Map();

    let next = (this.currentPlayer + 1) % this.players.length;
    let loops = 0;
    while ((this.players[next].isHu || this.players[next].disconnected) && loops < this.players.length) {
      next = (next + 1) % this.players.length;
      loops++;
    }

    if (this._shouldEnd()) {
      this._endGame();
      return;
    }

    this.currentPlayer = next;
    this._log(`[engine] 轮到P${next}, 未胡=${this.players.filter(p => !p.isHu).length}人`);
    this._draw(next);
  }

  _draw(idx) {
    if (this.deck.length === 0) {
      this.logs.push('牌堆已空');
      this._log(`[engine] P${idx}摸牌: 牌堆已空 -> 流局`);
      this._checkFlowEnd();
      return;
    }

    const tile = this.deck.pop();
    const player = this.players[idx];
    player.gangDrawFlag = false;
    if (player.lastDrawn) player.lastDrawn.isNew = false;
    tile.isNew = true;
    player.lastDrawn = tile;
    player.hand.push(tile);
    this._sortHand(player.hand);
    this.logs.push(`${player.name} 摸牌`);
    this._log(`[engine] P${idx}摸牌 ${tileLabel(tile)}, 手牌=${player.hand.length}, 牌堆剩${this.deck.length}`);

    const hasDingqueInMelds = player.melds.some(m => m.tiles.some(t => t.suit === player.dingque));
    const canHu = !hasDingqueInMelds && this._canHu(player.hand, player.dingque);
    const anGangList = this._canAnGang(idx);
    const jiaGangList = this._canJiaGang(idx);

    if (canHu || anGangList.length > 0 || jiaGangList.length > 0) {
      this.phase = 'waitAction';
      this.waitingPlayers = [idx];
      this.pendingActions = new Map();
      if (canHu) this.pendingTile = tile;

      const actions = [];
      if (canHu) actions.push('hu');
      actions.push('pass');
      const reason = canHu ? 'zimo' : 'selfGang';

      this._broadcastAll();
      this._send(idx, { event: 'actionRequest', actions, tile, isZimo: canHu, reason, anGangList, jiaGangList });
      this._log(`[engine] P${idx} self action: canHu=${canHu}, anGang=[${anGangList}], jiaGang=[${jiaGangList}]`);
      return;
    }

    this._broadcastAll();
  }

  _drawExtra(idx) {
    if (this.deck.length === 0) {
      this.logs.push('牌堆已空');
      this._log(`[engine] P${idx}摸岭上牌: 牌堆已空 -> 流局`);
      this._checkFlowEnd();
      return;
    }
    const tile = this.deck.pop();
    const player = this.players[idx];
    player.gangDrawFlag = true;
    if (player.lastDrawn) player.lastDrawn.isNew = false;
    tile.isNew = true;
    player.lastDrawn = tile;
    player.hand.push(tile);
    this._sortHand(player.hand);
    this.logs.push(`${player.name} 摸岭上牌`);
    this._log(`[engine] P${idx}摸岭上牌 ${tileLabel(tile)}, 手牌=${player.hand.length}`);

    const hasDingqueInMelds = player.melds.some(m => m.tiles.some(t => t.suit === player.dingque));
    const canHu = !hasDingqueInMelds && this._canHu(player.hand, player.dingque);
    const anGangList = this._canAnGang(idx);
    const jiaGangList = this._canJiaGang(idx);

    if (canHu || anGangList.length > 0 || jiaGangList.length > 0) {
      this.phase = 'waitAction';
      this.waitingPlayers = [idx];
      this.pendingActions = new Map();
      if (canHu) this.pendingTile = tile;

      const actions = [];
      if (canHu) actions.push('hu');
      actions.push('pass');
      const reason = canHu ? 'zimo' : 'selfGang';

      this._broadcastAll();
      this._send(idx, { event: 'actionRequest', actions, tile, isZimo: canHu, reason, anGangList, jiaGangList });
      this._log(`[engine] P${idx} gang-draw action: canHu=${canHu}, anGang=[${anGangList}], jiaGang=[${jiaGangList}]`);
      return true;
    }

    this._broadcastAll();
    return false;
  }

  _shouldEnd() {
    const unHuCount = this.players.filter(p => !p.isHu).length;
    return unHuCount <= 1;
  }

  /* ==================== 碰杠检查 ==================== */
  _canPeng(idx, tile) {
    const player = this.players[idx];
    if (tile.suit === player.dingque) return false;
    let count = 0;
    for (const t of player.hand) {
      if (t.suit === tile.suit && t.rank === tile.rank) count++;
    }
    return count >= 2;
  }

  _canMingGang(idx, tile) {
    const player = this.players[idx];
    if (tile.suit === player.dingque) return false;
    let count = 0;
    for (const t of player.hand) {
      if (t.suit === tile.suit && t.rank === tile.rank) count++;
    }
    return count >= 3;
  }

  _canAnGang(idx) {
    const player = this.players[idx];
    const count = {};
    for (const t of player.hand) {
      if (t.suit === player.dingque) continue; // 定缺花色不能暗杠
      const k = tileKey(t);
      count[k] = (count[k] || 0) + 1;
    }
    return Object.keys(count).filter(k => count[k] === 4);
  }

  _canJiaGang(idx) {
    const player = this.players[idx];
    const results = [];
    for (let i = 0; i < player.melds.length; i++) {
      const meld = player.melds[i];
      if (meld.type === 'peng') {
        const t = meld.tiles[0];
        if (t.suit === player.dingque) continue; // 定缺花色不能加杠
        if (player.hand.some(h => h.suit === t.suit && h.rank === t.rank)) {
          results.push(i);
        }
      }
    }
    return results;
  }

  /* ==================== 碰杠执行 ==================== */
  _doPeng(idx, tile) {
    const player = this.players[idx];
    const fromIdx = this.currentPlayer;

    let removed = [];
    for (let i = player.hand.length - 1; i >= 0; i--) {
      const t = player.hand[i];
      if (t.suit === tile.suit && t.rank === tile.rank) {
        removed.push(player.hand.splice(i, 1)[0]);
        if (removed.length === 2) break;
      }
    }
    if (removed.length !== 2) {
      player.hand.push(...removed);
      this._sortHand(player.hand);
      return;
    }
    this._sortHand(player.hand);

    const pengTiles = [...removed, { ...tile }];
    player.melds.push({ type: 'peng', tiles: pengTiles, targetIdx: fromIdx });
    this.logs.push(`${player.name} 碰 ${tileLabel(tile)}`);
    this._log(`[engine] P${idx}碰P${fromIdx}的${tileLabel(tile)}, 手牌剩${player.hand.length}`);

    // 从弃牌堆移除被碰的牌
    const di = this.discardPile.findIndex(t => t.suit === tile.suit && t.rank === tile.rank);
    if (di !== -1) this.discardPile.splice(di, 1);

    this.currentPlayer = idx;
    this.pendingTile = null;
  }

  _doMingGang(idx, tile) {
    const player = this.players[idx];
    const fromIdx = this.currentPlayer;

    let removed = [];
    for (let i = player.hand.length - 1; i >= 0; i--) {
      const t = player.hand[i];
      if (t.suit === tile.suit && t.rank === tile.rank) {
        removed.push(player.hand.splice(i, 1)[0]);
        if (removed.length === 3) break;
      }
    }
    if (removed.length !== 3) {
      player.hand.push(...removed);
      this._sortHand(player.hand);
      return;
    }
    this._sortHand(player.hand);

    const gangTiles = [...removed, { ...tile }];
    player.melds.push({ type: 'minggang', tiles: gangTiles, targetIdx: fromIdx });
    this.logs.push(`${player.name} 明杠 ${tileLabel(tile)}`);
    this._log(`[engine] P${idx}明杠P${fromIdx}的${tileLabel(tile)}, 手牌剩${player.hand.length}`);
    const di = this.discardPile.findIndex(t => t.suit === tile.suit && t.rank === tile.rank);
    if (di !== -1) this.discardPile.splice(di, 1);

    if (!this.players[fromIdx].isHu) {
      this.players[fromIdx].score -= 2;
      player.score += 2;
      player.gangGain += 2;  // 记录本局杠收入（杠上炮转移/流局退税用）
      this.gangTransactions.push({ from: fromIdx, to: idx, amount: 2 });
      this.logs.push(`${player.name} 明杠收分 +2`);
    }

    this.currentPlayer = idx;
    this.pendingTile = null;
    const hasAction = this._drawExtra(idx);
    if (!hasAction) {
      this.phase = 'playing';
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
    }
  }

  _doAnGang(idx, tk) {
    const player = this.players[idx];
    const [suit, rankStr] = tk.split('_');
    const rank = parseInt(rankStr);

    let removed = [];
    for (let i = player.hand.length - 1; i >= 0; i--) {
      const t = player.hand[i];
      if (t.suit === suit && t.rank === rank) {
        removed.push(player.hand.splice(i, 1)[0]);
        if (removed.length === 4) break;
      }
    }
    if (removed.length !== 4) {
      player.hand.push(...removed);
      this._sortHand(player.hand);
      this._log(`[engine] P${idx}暗杠${suit}_${rank}失败: 手牌不足4张`);
      return;
    }
    this._sortHand(player.hand);

    if (player.lastDrawn && player.lastDrawn.suit === suit && player.lastDrawn.rank === rank) {
      player.lastDrawn = null;
    }

    player.melds.push({ type: 'angang', tiles: removed, targetIdx: null });
    this.logs.push(`${player.name} 暗杠 ${tileLabel({ suit, rank })}`);
    this._log(`[engine] P${idx}暗杠${suit}_${rank}, 手牌剩${player.hand.length}`);

    const losers = this.players.filter((p, i) => i !== idx && !p.isHu);
    const gain = losers.length * 2;
    for (const p of losers) p.score -= 2;
    player.score += gain;
    player.gangGain += gain;  // 记录本局杠收入
    for (const p of losers) this.gangTransactions.push({ from: p.index, to: idx, amount: 2 });
    this.logs.push(`${player.name} 暗杠收分 +${gain}`);

    const hasAction = this._drawExtra(idx);
    if (!hasAction) {
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
    }
  }

  _doJiaGang(idx, pengMeldIdx) {
    const player = this.players[idx];
    const pengMeld = player.melds[pengMeldIdx];
    if (!pengMeld || pengMeld.type !== 'peng') return;

    const tile = pengMeld.tiles[0];
    const handIdx = player.hand.findIndex(t => t.suit === tile.suit && t.rank === tile.rank);
    if (handIdx === -1) return;

    const removedTile = player.hand.splice(handIdx, 1)[0];
    this._sortHand(player.hand);

    pengMeld.type = 'jiagang';
    pengMeld.tiles.push(removedTile);
    pengMeld.sourcePengIdx = pengMeldIdx;

    this.logs.push(`${player.name} 加杠 ${tileLabel(tile)}`);
    this._log(`[engine] P${idx}加杠${tileLabel(tile)}, meld=${pengMeldIdx}`);
    this._broadcastAll();

    // 抢杠胡检测
    const huCandidates = [];
    for (let i = 0; i < this.players.length; i++) {
      if (i === idx) continue;
      if (this.players[i].isHu) continue;
      if (this.players[i].disconnected) continue;
      const testHand = [...this.players[i].hand, removedTile];
      const hasDingqueInMelds = this.players[i].melds.some(m => m.tiles.some(t => t.suit === this.players[i].dingque));
      if (!hasDingqueInMelds && this._canHu(testHand, this.players[i].dingque)) {
        huCandidates.push(i);
      }
    }

    if (huCandidates.length > 0) {
      this.phase = 'waitAction';
      this.waitingPlayers = huCandidates;
      this.pendingActions = new Map();
      this.pendingTile = removedTile;
      this.jiagangPending = { idx, tile: removedTile, pengMeldIdx };
      this._broadcastAll();
      for (const i of huCandidates) {
        this._send(i, { event: 'actionRequest', actions: ['hu', 'pass'], tile: removedTile, reason: 'qianggang' });
      }
      this._log(`[engine] P${idx}加杠 -> 抢杠胡候选=${huCandidates.join(',')}`);
      return;
    }

    this._completeJiaGang(idx, removedTile, pengMeldIdx);
  }

  _completeJiaGang(idx, tile, pengMeldIdx) {
    const losers = this.players.filter((p, i) => i !== idx && !p.isHu);
    const gain = losers.length;
    for (const p of losers) p.score -= 1;
    this.players[idx].score += gain;
    this.players[idx].gangGain += gain;  // 记录本局杠收入
    for (const p of losers) this.gangTransactions.push({ from: p.index, to: idx, amount: 1 });
    this.logs.push(`${this.players[idx].name} 加杠收分 +${gain}`);
    this._log(`[engine] P${idx}加杠完成${tileLabel(tile)}, 收${gain}分`);
    const hasAction = this._drawExtra(idx);
    if (!hasAction) {
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
    }
  }

  /* ==================== 胡牌结算 ==================== */
  _doHu(idx, tile, isZimo) {
    const player = this.players[idx];
    player.isHu = true;
    player.huTile = tile;

    if (this.firstHuPlayerIndex === -1) {
      this.firstHuPlayerIndex = idx;
    }

    const { totalFan, fans } = this._calcFan(idx, tile, isZimo);
    const baseScore = Math.pow(2, totalFan);  // 单家赔付 = 2^总番数（底分1，无封顶）

    let gained = 0;
    let gangTransfer = 0;  // 杠上炮转移的杠钱
    if (isZimo) {
      const losers = this.players.filter((p, i) => i !== idx && !p.isHu);
      const eachPay = baseScore;
      gained = losers.length * eachPay;
      for (const p of losers) p.score -= eachPay;
    } else {
      const fromIdx = this.jiagangPending ? this.jiagangPending.idx : this.currentPlayer;
      if (fromIdx !== idx && !this.players[fromIdx].isHu) {
        this.players[fromIdx].score -= baseScore;
        gained = baseScore;

        // 杠上炮（呼叫转移）：杠完打牌点炮时，点炮者本局收的杠钱全部转给胡家
        const isGangShangPao = this.players[fromIdx].gangDrawFlag === true;
        if (isGangShangPao && this.players[fromIdx].gangGain > 0) {
          gangTransfer = this.players[fromIdx].gangGain;
          this.players[fromIdx].score -= gangTransfer;
          this.players[fromIdx].gangGain = 0;
          gained += gangTransfer;  // 转移的钱计入胡家收入
          this.logs.push(`${player.name} 杠上炮转移 ${this.players[fromIdx].name} 杠钱 +${gangTransfer}`);
        }
      }
    }
    player.score += gained;
    player.fanDetail = { totalFan, fans, baseScore, isZimo, gangTransfer };

    const fanStr = fans.map(f => f.label).join(' ');
    this.logs.push(`${player.name} 胡了${isZimo ? '（自摸）' : '（点炮）'} +${gained}${gangTransfer ? '(含转移杠钱' + gangTransfer + ')' : ''} [${totalFan}番 ${fanStr}]`);
    this._log(`[engine] P${idx}胡牌${isZimo ? '(自摸)' : '(点炮)'} tile=${tileLabel(tile)}, ${totalFan}番, ${fans.map(f => f.label).join('+')}, 得${gained}分${gangTransfer ? '(含杠上炮转移' + gangTransfer + ')' : ''}, 总${player.score}分`);
  }

  /* ==================== 胡牌检测 ==================== */
  _canHu(tiles, dingque) {
    if (tiles.some(t => t.suit === dingque)) return false;
    if (tiles.length % 3 !== 2) return false;

    const count = {};
    for (const t of tiles) {
      const k = tileKey(t);
      count[k] = (count[k] || 0) + 1;
    }

    // 七对：7种牌各2张
    const values = Object.values(count);
    if (values.length === 7 && values.every(v => v === 2)) return true;

    // 龙七对：6种牌，其中1种4张，其余5种各2张
    if (values.length === 6 && values.some(v => v === 4) && values.filter(v => v === 2).length === 5) return true;

    for (const key of Object.keys(count)) {
      if (count[key] >= 2) {
        count[key] -= 2;
        if (this._canFormMelds(count)) {
          count[key] += 2;
          return true;
        }
        count[key] += 2;
      }
    }
    return false;
  }

  _canFormMelds(count) {
    // 取当前剩余的最小牌（按 suit 顺序 wan<tiao<tong，同 suit 按 rank 升序）。
    // 必须按数值取最小牌，不能依赖 Object.keys 的插入顺序——
    // 点炮/抢杠/听牌检测传入的 testHand 未必排序，否则会漏判胡牌。
    const SUIT_ORDER = ['wan', 'tiao', 'tong'];
    let firstKey = null;
    let firstSuitIdx = -1;
    let firstRank = -1;
    for (const k in count) {
      if (count[k] <= 0) continue;
      const parts = k.split('_');
      const si = SUIT_ORDER.indexOf(parts[0]);
      const r = parseInt(parts[1]);
      if (firstKey === null || si < firstSuitIdx || (si === firstSuitIdx && r < firstRank)) {
        firstKey = k; firstSuitIdx = si; firstRank = r;
      }
    }
    if (firstKey === null) return true;

    if (count[firstKey] >= 3) {
      count[firstKey] -= 3;
      if (this._canFormMelds(count)) return true;
      count[firstKey] += 3;
    }

    if (firstRank <= 7) {
      const k2 = `${SUIT_ORDER[firstSuitIdx]}_${firstRank + 1}`;
      const k3 = `${SUIT_ORDER[firstSuitIdx]}_${firstRank + 2}`;
      if (count[k2] > 0 && count[k3] > 0) {
        count[firstKey]--;
        count[k2]--;
        count[k3]--;
        if (this._canFormMelds(count)) return true;
        count[firstKey]++;
        count[k2]++;
        count[k3]++;
      }
    }

    return false;
  }

  /* ==================== 番数计算 ====================
   * 成都血战到底规则（底分=1，无封顶）：
   *   单家赔付 = 2^总番数
   * 基础牌型（互斥取一）：
   *   平胡0 / 对对胡1 / 清一色2 / 七对2 / 龙七对3 / 清对3 / 清七对3
   * 叠加项（+1番/项）：
   *   金钩钓、自摸、杠上花、杠上炮、抢杠胡、海底捞月、根(每杠+1)
   * 注：清对=清一色+对对胡(固定3番)，清七对=清一色+七对(固定3番)，
   *     取复合番型后不再单独记清一色/对对胡/七对。
   */
  _calcFan(idx, huTile, isZimo) {
    const player = this.players[idx];
    const allTiles = isZimo ? [...player.hand] : [...player.hand, huTile];

    const fans = [];
    const isQiDui = player.melds.length === 0 && allTiles.length === 14 && this._isQiDui(allTiles);
    const isLongQiDui = player.melds.length === 0 && allTiles.length === 14 && this._isLongQiDui(allTiles);
    const isDuiDuiHu = this._isDuiDuiHu(allTiles, player.melds);
    const isQingYiSe = this._isQingYiSe(allTiles, player.melds, player.dingque);

    // 基础牌型（互斥取一，复合番型优先）
    if (isQingYiSe && isLongQiDui) {
      fans.push({ name: 'qinglongqidui', label: '清龙七对', fan: 4 });
    } else if (isQingYiSe && isQiDui) {
      fans.push({ name: 'qingqidui', label: '清七对', fan: 3 });      // 清一色+七对 固定3番
    } else if (isQingYiSe && isDuiDuiHu) {
      fans.push({ name: 'qingdui', label: '清对', fan: 3 });          // 清一色+对对胡 固定3番
    } else if (isLongQiDui) {
      fans.push({ name: 'longqidui', label: '龙七对', fan: 3 });
    } else if (isQiDui) {
      fans.push({ name: 'qidui', label: '七对', fan: 2 });
    } else if (isDuiDuiHu) {
      fans.push({ name: 'duiduihu', label: '对对胡', fan: 1 });
    } else if (isQingYiSe) {
      fans.push({ name: 'qingyise', label: '清一色', fan: 2 });
    } else {
      fans.push({ name: 'pinghu', label: '平胡', fan: 0 });
    }

    // 金钩钓：手里只剩1张牌单吊，其余全在碰杠中（+1番，可叠加）
    const handTileCount = isZimo ? player.hand.length - 1 : player.hand.length;
    if (handTileCount === 1) {
      fans.push({ name: 'jingoudiao', label: '金钩钓', fan: 1 });
    }

    // 根（杠）：melds里每1组杠 + 手牌里每1组4张相同牌，各+1番
    // （选胡未杠成时，手里握着的4张也算根，符合"4张即根"规则）
    const genCount = this._countGen(player.melds, allTiles);
    if (genCount > 0) {
      fans.push({ name: 'gen', label: `带根x${genCount}`, fan: genCount });
    }

    // 自摸 +1番
    if (isZimo) {
      fans.push({ name: 'zimo', label: '自摸', fan: 1 });
    }

    // 杠上花：杠后补牌自摸
    if (isZimo && player.gangDrawFlag) {
      fans.push({ name: 'gangshanghua', label: '杠上花', fan: 1 });
    }

    // 海底捞月：牌墙最后一张自摸
    if (isZimo && this.deck.length === 0) {
      fans.push({ name: 'haidilaoyue', label: '海底捞月', fan: 1 });
    }

    // 杠上炮：杠完打牌点炮
    if (!isZimo) {
      const fromIdx = this.jiagangPending ? this.jiagangPending.idx : this.currentPlayer;
      if (this.players[fromIdx] && this.players[fromIdx].gangDrawFlag) {
        fans.push({ name: 'gangshangpao', label: '杠上炮', fan: 1 });
      }
    }

    // 海底炮（点炮者打最后一张）
    if (!isZimo && this.deck.length === 0) {
      fans.push({ name: 'haidipao', label: '海底炮', fan: 1 });
    }

    // 抢杠胡：别人补杠你胡那张
    if (!isZimo && this.jiagangPending) {
      fans.push({ name: 'qiangganghu', label: '抢杠胡', fan: 1 });
    }

    const totalFan = fans.reduce((sum, f) => sum + f.fan, 0);
    return { totalFan, fans };
  }

  _isQiDui(tiles) {
    const count = {};
    for (const t of tiles) {
      const k = tileKey(t);
      count[k] = (count[k] || 0) + 1;
    }
    const values = Object.values(count);
    return values.length === 7 && values.every(v => v === 2);
  }

  _isLongQiDui(tiles) {
    const count = {};
    for (const t of tiles) {
      const k = tileKey(t);
      count[k] = (count[k] || 0) + 1;
    }
    const values = Object.values(count);
    const hasFour = values.some(v => v === 4);
    const pairs = values.filter(v => v === 2).length;
    return hasFour && pairs === 5 && values.length === 6;
  }

  _isDuiDuiHu(tiles, melds) {
    if (melds.some(m => m.type === 'shunzi')) return false;
    if (tiles.length % 3 !== 2) return false;
    const count = {};
    for (const t of tiles) {
      const k = tileKey(t);
      count[k] = (count[k] || 0) + 1;
    }
    return this._canFormKeZiWithJiang(count);
  }

  _canFormKeZiWithJiang(count) {
    const keys = Object.keys(count).filter(k => count[k] > 0);
    if (keys.length === 0) return true;
    for (const key of keys) {
      if (count[key] >= 2) {
        count[key] -= 2;
        if (this._canFormKeZiOnly(count)) {
          count[key] += 2;
          return true;
        }
        count[key] += 2;
      }
    }
    return false;
  }

  _canFormKeZiOnly(count) {
    const keys = Object.keys(count).filter(k => count[k] > 0);
    if (keys.length === 0) return true;
    const firstKey = keys[0];
    if (count[firstKey] >= 3) {
      count[firstKey] -= 3;
      if (this._canFormKeZiOnly(count)) return true;
      count[firstKey] += 3;
    }
    return false;
  }

  _isQingYiSe(tiles, melds, dingque) {
    const suits = new Set();
    for (const t of tiles) {
      if (t.suit !== dingque) suits.add(t.suit);
    }
    for (const m of melds) {
      for (const t of m.tiles) {
        if (t.suit !== dingque) suits.add(t.suit);
      }
    }
    return suits.size === 1;
  }

  // 根：melds里每1组杠(暗杠/明杠/加杠) + 手牌里每1组4张相同牌，各算1根
  // 注意：杠牌已移出手牌进melds，所以两者不会重复计数
  _countGen(melds, hand) {
    let count = melds.filter(m => m.type === 'angang' || m.type === 'minggang' || m.type === 'jiagang').length;
    if (hand && hand.length) {
      const map = {};
      for (const t of hand) {
        const k = tileKey(t);
        map[k] = (map[k] || 0) + 1;
      }
      for (const k in map) {
        if (map[k] >= 4) count += 1;  // 手里握着的4张相同牌算1根
      }
    }
    return count;
  }

  _isTing(hand, dingque) {
    if (hand.some(t => t.suit === dingque)) return false;
    for (const s of SUITS) {
      if (s === dingque) continue;
      for (const r of RANKS) {
        const test = [...hand, { suit: s, rank: r }];
        if (this._canHu(test, dingque)) return true;
      }
    }
    return false;
  }

  /* 计算玩家听牌的最大番数（流局查叫/花猪赔付用）
   * 遍历所有听张，模拟"点炮胡"算番（不含自摸+1等情境番），取最大值。
   */
  _calcTingMaxFan(idx) {
    const player = this.players[idx];
    const tingTiles = this._getTingTiles(player.hand, player.dingque);
    if (tingTiles.length === 0) return 0;
    let maxFan = 0;
    for (const t of tingTiles) {
      const { totalFan } = this._calcFan(idx, t, false);
      if (totalFan > maxFan) maxFan = totalFan;
    }
    return maxFan;
  }

  _getTingTiles(hand, dingque) {
    if (hand.some(t => t.suit === dingque)) return [];
    const result = [];
    const seen = new Set();

    const handsToCheck = [];
    if (hand.length % 3 === 0) {
      // 12/15张等不规范手牌，直接算
      handsToCheck.push(hand);
    } else if (hand.length % 3 === 1) {
      // 13张标准听牌
      handsToCheck.push(hand);
    } else {
      // 14张（自己摸牌后）：尝试打出每张牌，计算剩下13张的听牌
      for (let i = 0; i < hand.length; i++) {
        handsToCheck.push(hand.filter((_, idx) => idx !== i));
      }
    }

    for (const testHand of handsToCheck) {
      for (const s of SUITS) {
        if (s === dingque) continue;
        for (const r of RANKS) {
          const test = [...testHand, { suit: s, rank: r }];
          if (this._canHu(test, dingque)) {
            const key = `${s}_${r}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.push({ suit: s, rank: r });
            }
          }
        }
      }
    }
    return result;
  }

  /* ==================== 结束 ==================== */
  _checkFlowEnd() {
    if (this.ended) { this._log(`[engine] 流局检查忽略: 已结束`); return; }

    const huaZhuPlayers = [];
    const nonHuaZhuPlayers = [];

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.isHu) continue;
      const hasDingqueInHand = p.hand.some(t => t.suit === p.dingque);
      const hasDingqueInMelds = p.melds.some(m => m.tiles.some(t => t.suit === p.dingque));
      if (hasDingqueInHand || hasDingqueInMelds) {
        huaZhuPlayers.push(i);
      } else {
        nonHuaZhuPlayers.push(i);
      }
    }

    // 花猪赔所有非花猪玩家（按对方听牌最大番，2^番；未听的非花猪按0番=1分）
    for (const hzIdx of huaZhuPlayers) {
      for (const nonHzIdx of nonHuaZhuPlayers) {
        const maxFan = this._calcTingMaxFan(nonHzIdx);
        const pay = Math.pow(2, maxFan);
        this.players[hzIdx].score -= pay;
        this.players[nonHzIdx].score += pay;
        this.logs.push(`${this.players[hzIdx].name} 花猪赔${this.players[nonHzIdx].name} ${pay}分`);
      }
      this.logs.push(`${this.players[hzIdx].name} 花猪`);
    }

    const jiaoPlayers = [];
    const noJiaoPlayers = [];
    for (const idx of nonHuaZhuPlayers) {
      if (this._isTing(this.players[idx].hand, this.players[idx].dingque)) {
        jiaoPlayers.push(idx);
      } else {
        noJiaoPlayers.push(idx);
      }
    }

    // 查大叫：未听者（非花猪）赔每个听牌者，按听牌者实际最大番
    for (const noIdx of noJiaoPlayers) {
      for (const jIdx of jiaoPlayers) {
        const maxFan = this._calcTingMaxFan(jIdx);
        const pay = Math.pow(2, maxFan);
        this.players[noIdx].score -= pay;
        this.players[jIdx].score += pay;
      }
      if (jiaoPlayers.length > 0) {
        this.logs.push(`${this.players[noIdx].name} 未叫`);
      }
    }

    for (const jIdx of jiaoPlayers) {
      this.logs.push(`${this.players[jIdx].name} 下叫`);
    }

    // 流局退税：花猪 + 未听者退回本局收的杠钱（回滚它作为收款方的交易）
    const refundSet = new Set([...huaZhuPlayers, ...noJiaoPlayers]);
    for (const tx of this.gangTransactions) {
      if (refundSet.has(tx.to)) {
        // 收款者是花猪/未听者：回滚这笔杠（收款者退回，赔付者收回）
        this.players[tx.to].score -= tx.amount;
        this.players[tx.from].score += tx.amount;
      }
    }
    for (const rIdx of refundSet) {
      const p = this.players[rIdx];
      if (p.gangGain > 0) {
        this.logs.push(`${p.name} 流局退杠钱 -${p.gangGain}`);
        p.gangGain = 0;
      }
    }

    // 给流局玩家设置状态摘要，供结算弹窗显示
    for (const hzIdx of huaZhuPlayers) {
      this.players[hzIdx].fanDetail = { totalFan: 0, fans: [{ name: 'huazhu', label: '花猪', fan: 0 }] };
    }
    for (const noIdx of noJiaoPlayers) {
      this.players[noIdx].fanDetail = { totalFan: 0, fans: [{ name: 'nojiao', label: '未听', fan: 0 }] };
    }
    for (const jIdx of jiaoPlayers) {
      const maxFan = this._calcTingMaxFan(jIdx);
      this.players[jIdx].fanDetail = { totalFan: maxFan, fans: [{ name: 'ting', label: `下叫(${maxFan}番)`, fan: maxFan }] };
    }

    this._log(`[engine] 流局结算: 花猪=${huaZhuPlayers.join(',')}, 听牌=${jiaoPlayers.join(',')}, 未听=${noJiaoPlayers.join(',')}`);

    this._endGame(true);
  }

  _endGame(isFlowEnd = false) {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    this.logs.push(isFlowEnd ? '流局结束' : '本局结束');
    this._log(`[engine] 结束(${isFlowEnd ? '流局' : '正常'}), 各玩家分数:` + this.players.map((p, i) => `P${i}=${p.score}${p.isHu ? '(胡)' : ''}`).join(', '));

    if (this.firstHuPlayerIndex !== -1) {
      this.dealerIndex = this.firstHuPlayerIndex;
    }
    this._log(`[engine] 下一局庄家=P${this.dealerIndex}`);
    this._broadcastAll();

    const settlement = {
      flowEnd: isFlowEnd,
      nextDealer: this.dealerIndex,
      players: this.players.map((p, i) => ({
        name: p.name,
        score: p.score,
        isHu: p.isHu,
        change: p.score - (this.initialScores[i] || 0),  // 本局变化量 = 当前分数 - 初始分数
        melds: p.melds.map(m => ({ type: m.type, label: tileLabel(m.tiles[0]) })),
        fanDetail: p.fanDetail || null,
      })),
    };
    this.players.forEach((p, i) => {
      this._send(i, { event: 'over', settlement });
    });
  }

  /* ==================== 断线 ==================== */
  playerDisconnected(idx) {
    if (this.ended || idx < 0 || idx >= this.players.length) { this._log(`[engine] P${idx}断线忽略: ended=${this.ended}`); return; }
    const p = this.players[idx];
    if (!p || p.isHu) { this._log(`[engine] P${idx}断线忽略: 不存在或已胡`); return; }
    p.disconnected = true;
    p.isHu = true;
    this.logs.push(`${p.name} 离开，自动退出`);
    this._log(`[engine] P${idx}断线, 自动设为已胡, phase=${this.phase}`);

    if (this._shouldEnd()) {
      this._endGame();
      return;
    }

    if (this.phase === 'waitAction' && this.waitingPlayers.includes(idx)) {
      this._handleAction(idx, { action: 'pass' });
      return;
    }

    if (this.phase === 'playing' && this.currentPlayer === idx) {
      const tile = p.hand.find(t => t.suit !== p.dingque) || p.hand[0];
      if (tile) {
        this._handleDiscard(idx, { tile });
        return;
      }
    }

    this._broadcastAll();
  }

  /* ==================== 状态广播 ==================== */
  _statePayload() {
    return {
      phase: this.phase,
      dealerIndex: this.dealerIndex,
      currentPlayer: this.currentPlayer,
      deckCount: this.deck.length,
      discardPile: this.discardPile,
      pendingTile: this.pendingTile,
      waitingPlayers: this.waitingPlayers,
      logs: this.logs.slice(-20),
      exchangeSubmitted: this.players.map((_, i) => !!(this.exchangeCards[i] && this.exchangeCards[i].length === 3)),
      diceResult: this.diceResult,
      players: this.players.map((p, i) => ({
        name: p.name,
        index: i,
        handSize: p.hand.length,
        discards: p.discards,
        melds: p.melds.map(m => ({
          type: m.type,
          tiles: m.tiles,
          targetIdx: m.targetIdx,
          sourcePengIdx: m.sourcePengIdx,
        })),
        dingque: p.dingque,
        score: p.score,
        isHu: p.isHu,
        huTile: p.huTile,
        isDealer: i === this.dealerIndex,
        isCurrent: i === this.currentPlayer,
        disconnected: !!p.disconnected,
      })),
    };
  }

  _broadcastAll() {
    const state = this._statePayload();
    this.players.forEach((p, i) => {
      this._send(i, { event: 'update', state });
      const tingTiles = (this.phase === 'playing' && !p.isHu)
        ? this._getTingTiles(p.hand, p.dingque)
        : [];
      this._send(i, { myHand: p.hand, myIndex: i, lastDrawn: p.lastDrawn, tingTiles });
    });
  }
}

module.exports = SichuanMahjongEngine;
