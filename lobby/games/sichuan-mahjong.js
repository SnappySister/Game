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
  constructor(players, sendFn, initialScores = []) {
    this._send = sendFn;
    this.playerCount = players.length;
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
    if (this.ended) return;
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
    }
  }

  _handleDingque(idx, msg) {
    if (this.phase !== 'dingque') return;
    const suit = msg.suit;
    if (!SUITS.includes(suit)) return;

    this.players[idx].dingque = suit;
    this.logs.push(`${this.players[idx].name} 定缺${suitLabel(suit)}`);

    if (this.players.every(p => p.dingque !== null)) {
      this.phase = 'playing';
      this.logs.push('定缺结束，庄家出牌');
    }
    this._broadcastAll();
  }

  _handleExchange(idx, msg) {
    if (this.phase !== 'exchange') return;
    const cards = msg.cards;
    if (!Array.isArray(cards) || cards.length !== 3) return;
    const player = this.players[idx];
    // 必须是同花色
    const suit = cards[0].suit;
    if (!SUITS.includes(suit)) return;
    if (!cards.every(c => c.suit === suit)) return;
    // 必须都在手牌中
    const handCopy = [...player.hand];
    for (const c of cards) {
      const ci = handCopy.findIndex(t => t.suit === c.suit && t.rank === c.rank);
      if (ci === -1) return;
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
    if (this.phase !== 'playing') return;
    if (this.currentPlayer !== idx) return;

    const tile = msg.tile;
    if (!tile || !SUITS.includes(tile.suit) || !RANKS.includes(tile.rank)) return;

    const player = this.players[idx];
    const handIdx = player.hand.findIndex(t => t.suit === tile.suit && t.rank === tile.rank);
    if (handIdx === -1) return;

    const removedTile = player.hand.splice(handIdx, 1)[0];
    this._sortHand(player.hand);
    player.discards.push(tile);
    this.discardPile.push(tile);
    this.pendingTile = tile;
    this.logs.push(`${player.name} 打出 ${tileLabel(tile)}`);

    if (removedTile === player.lastDrawn) {
      player.lastDrawn = null;
    }

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
      for (const i of huCandidates) {
        this._send(i, { event: 'actionRequest', actions: ['hu', 'pass'], tile, reason: 'dianpao' });
      }
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
        return;
      }
    }

    // 无人可响应
    this._nextPlayer();
  }

  _handleAction(idx, msg) {
    if (this.phase !== 'waitAction') return;
    if (!this.waitingPlayers.includes(idx)) return;
    const action = msg.action;

    const isSelfAction = this.waitingPlayers.length === 1 && this.waitingPlayers[0] === this.currentPlayer;

    this.pendingActions.set(idx, action);

    if (isSelfAction) {
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

    // 他人响应（点炮/抢杠胡/碰/明杠）
    if (!['hu', 'pass', 'peng', 'gang'].includes(action)) return;

    if (action === 'hu') {
      this._doHu(idx, this.pendingTile, false);
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
      if (this._shouldEnd()) { this._endGame(); return; }
      this._nextPlayer();
      return;
    }

    const allResponded = this.waitingPlayers.every(i => this.pendingActions.has(i));
    if (!allResponded) return;

    const acted = this.waitingPlayers.find(i => this.pendingActions.get(i) !== 'pass');
    if (acted !== undefined) {
      const act = this.pendingActions.get(acted);
      if (act === 'peng') this._doPeng(acted, this.pendingTile);
      else if (act === 'gang') this._doMingGang(acted, this.pendingTile);
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
      return;
    }

    // 全部 pass
    if (this.jiagangPending) {
      const { idx: gangIdx, tile, pengMeldIdx } = this.jiagangPending;
      this._completeJiaGang(gangIdx, tile, pengMeldIdx);
      this.jiagangPending = null;
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
      return;
    }

    this.phase = 'playing';
    this.pendingTile = null;
    this.waitingPlayers = [];
    this.pendingActions = new Map();
    this._nextPlayer();
  }

  _handleSelfAction(idx, msg) {
    const action = msg.action;
    if (action === 'angang') {
      if (this.phase !== 'waitAction') return;
      if (!this.waitingPlayers.includes(idx)) return;
      const tk = msg.tileKey;
      if (!this._canAnGang(idx).includes(tk)) return;
      this._doAnGang(idx, tk);
      this.phase = 'playing';
      this.pendingTile = null;
      this.waitingPlayers = [];
      this.pendingActions = new Map();
      this._broadcastAll();
      return;
    }
    if (action === 'jiagang') {
      if (this.phase !== 'waitAction') return;
      if (!this.waitingPlayers.includes(idx)) return;
      const pengMeldIdx = msg.pengMeldIdx;
      if (!this._canJiaGang(idx).includes(pengMeldIdx)) return;
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
    this._draw(next);
  }

  _draw(idx) {
    if (this.deck.length === 0) {
      this.logs.push('牌堆已空');
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

    const hasDingqueInMelds = player.melds.some(m => m.tiles.some(t => t.suit === player.dingque));
    if (!hasDingqueInMelds && this._canHu(player.hand, player.dingque)) {
      this.phase = 'waitAction';
      this.waitingPlayers = [idx];
      this.pendingActions = new Map();
      this.pendingTile = tile;
      this._broadcastAll();
      this._send(idx, { event: 'actionRequest', actions: ['hu', 'pass'], tile, isZimo: true, reason: 'zimo' });
      return;
    }

    const anGangList = this._canAnGang(idx);
    const jiaGangList = this._canJiaGang(idx);
    if (anGangList.length > 0 || jiaGangList.length > 0) {
      this.phase = 'waitAction';
      this.waitingPlayers = [idx];
      this.pendingActions = new Map();
      this._broadcastAll();
      this._send(idx, { event: 'actionRequest', actions: ['pass'], anGangList, jiaGangList, reason: 'selfGang' });
      return;
    }

    this._broadcastAll();
  }

  _drawExtra(idx) {
    if (this.deck.length === 0) {
      this.logs.push('牌堆已空');
      this._endGame();
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

    if (!this.players[fromIdx].isHu) {
      this.players[fromIdx].score -= 2;
      player.score += 2;
      this.logs.push(`${player.name} 明杠收分 +2`);
    }

    this.currentPlayer = idx;
    this.pendingTile = null;
    this._drawExtra(idx);
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
      return;
    }
    this._sortHand(player.hand);

    if (player.lastDrawn && player.lastDrawn.suit === suit && player.lastDrawn.rank === rank) {
      player.lastDrawn = null;
    }

    player.melds.push({ type: 'angang', tiles: removed, targetIdx: null });
    this.logs.push(`${player.name} 暗杠 ${tileLabel({ suit, rank })}`);

    const losers = this.players.filter((p, i) => i !== idx && !p.isHu);
    const gain = losers.length * 2;
    for (const p of losers) p.score -= 2;
    player.score += gain;
    this.logs.push(`${player.name} 暗杠收分 +${gain}`);

    this._drawExtra(idx);
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
      return;
    }

    this._completeJiaGang(idx, removedTile, pengMeldIdx);
  }

  _completeJiaGang(idx, tile, pengMeldIdx) {
    const losers = this.players.filter((p, i) => i !== idx && !p.isHu);
    const gain = losers.length;
    for (const p of losers) p.score -= 1;
    this.players[idx].score += gain;
    this.logs.push(`${this.players[idx].name} 加杠收分 +${gain}`);
    this._drawExtra(idx);
  }

  /* ==================== 胡牌结算 ==================== */
  _doHu(idx, tile, isZimo) {
    const player = this.players[idx];
    player.isHu = true;
    player.huTile = tile;

    const { totalFan, fans } = this._calcFan(idx, tile, isZimo);
    const baseScore = Math.pow(2, totalFan - 1);

    let gained = 0;
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
      }
    }
    player.score += gained;
    player.fanDetail = { totalFan, fans, baseScore, isZimo };

    const fanStr = fans.map(f => f.label).join(' ');
    this.logs.push(`${player.name} 胡了${isZimo ? '（自摸）' : '（点炮）'} +${gained} [${totalFan}番 ${fanStr}]`);
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
    const keys = Object.keys(count).filter(k => count[k] > 0);
    if (keys.length === 0) return true;

    const firstKey = keys[0];
    const [suit, rankStr] = firstKey.split('_');
    const r = parseInt(rankStr);

    if (count[firstKey] >= 3) {
      count[firstKey] -= 3;
      if (this._canFormMelds(count)) return true;
      count[firstKey] += 3;
    }

    if (r <= 7) {
      const k2 = `${suit}_${r + 1}`;
      const k3 = `${suit}_${r + 2}`;
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

  /* ==================== 番数计算 ==================== */
  _calcFan(idx, huTile, isZimo) {
    const player = this.players[idx];
    const allTiles = isZimo ? [...player.hand] : [...player.hand, huTile];

    const fans = [];
    const isQiDui = player.melds.length === 0 && allTiles.length === 14 && this._isQiDui(allTiles);
    const isLongQiDui = player.melds.length === 0 && allTiles.length === 14 && this._isLongQiDui(allTiles);
    const isDuiDuiHu = this._isDuiDuiHu(allTiles, player.melds);
    const isQingYiSe = this._isQingYiSe(allTiles, player.melds, player.dingque);

    if (isLongQiDui) {
      fans.push({ name: 'longqidui', label: '龙七对', fan: 4 });
    } else if (isQiDui) {
      fans.push({ name: 'qidui', label: '七对', fan: 2 });
    } else if (isDuiDuiHu) {
      fans.push({ name: 'duiduihu', label: '对对胡', fan: 2 });
    } else {
      fans.push({ name: 'pinghu', label: '平胡', fan: 1 });
    }

    if (isQingYiSe) {
      fans.push({ name: 'qingyise', label: '清一色', fan: 4 });
    }

    const genCount = this._countGen(player.melds);
    if (genCount > 0) {
      fans.push({ name: 'gen', label: `带根x${genCount}`, fan: genCount });
    }

    if (isZimo && player.gangDrawFlag) {
      fans.push({ name: 'gangshanghua', label: '杠上花', fan: 1 });
    }

    if (isZimo && this.deck.length === 0) {
      fans.push({ name: 'haidilaoyue', label: '海底捞月', fan: 1 });
    }

    if (!isZimo) {
      const fromIdx = this.jiagangPending ? this.jiagangPending.idx : this.currentPlayer;
      if (this.players[fromIdx] && this.players[fromIdx].gangDrawFlag) {
        fans.push({ name: 'gangshangpao', label: '杠上炮', fan: 1 });
      }
    }

    if (!isZimo && this.deck.length === 0) {
      fans.push({ name: 'haidipao', label: '海底炮', fan: 1 });
    }

    if (!isZimo && this.jiagangPending) {
      fans.push({ name: 'qiangganghu', label: '抢杠胡', fan: 1 });
    }

    if (player.discards.length === 0 && this.turn === 0 && !player.gangDrawFlag) {
      if (idx === this.dealerIndex) {
        fans.push({ name: 'tianhu', label: '天胡', fan: 2 });
      } else {
        fans.push({ name: 'dihu', label: '地胡', fan: 2 });
      }
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

  _countGen(melds) {
    return melds.filter(m => m.type === 'angang' || m.type === 'minggang' || m.type === 'jiagang').length;
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

  _getTingTiles(hand, dingque) {
    if (hand.some(t => t.suit === dingque)) return [];
    const result = [];
    for (const s of SUITS) {
      if (s === dingque) continue;
      for (const r of RANKS) {
        const test = [...hand, { suit: s, rank: r }];
        if (this._canHu(test, dingque)) result.push({ suit: s, rank: r });
      }
    }
    return result;
  }

  /* ==================== 结束 ==================== */
  _checkFlowEnd() {
    if (this.ended) return;

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

    for (const hzIdx of huaZhuPlayers) {
      for (const nonHzIdx of nonHuaZhuPlayers) {
        this.players[hzIdx].score -= 2;
        this.players[nonHzIdx].score += 2;
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

    for (const noIdx of noJiaoPlayers) {
      for (const jIdx of jiaoPlayers) {
        this.players[noIdx].score -= 1;
        this.players[jIdx].score += 1;
      }
      if (jiaoPlayers.length > 0) {
        this.logs.push(`${this.players[noIdx].name} 未叫`);
      }
    }

    for (const jIdx of jiaoPlayers) {
      this.logs.push(`${this.players[jIdx].name} 下叫`);
    }

    this._endGame(true);
  }

  _endGame(isFlowEnd = false) {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    this.logs.push(isFlowEnd ? '流局结束' : '本局结束');
    this._broadcastAll();

    const settlement = {
      flowEnd: isFlowEnd,
      players: this.players.map(p => ({
        name: p.name,
        score: p.score,
        isHu: p.isHu,
        change: p.score,
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
    if (this.ended || idx < 0 || idx >= this.players.length) return;
    const p = this.players[idx];
    if (!p || p.isHu) return;
    p.disconnected = true;
    p.isHu = true;
    this.logs.push(`${p.name} 离开，自动退出`);

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
      discardPile: this.discardPile.slice(-24),
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
