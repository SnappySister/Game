/* 德州扑克游戏引擎 - Texas Hold'em No-Limit */

const SUITS = ['s', 'h', 'c', 'd'];
const RANK_NAMES = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};
const SUIT_NAMES = { s: '♠', h: '♥', c: '♣', d: '♦' };

function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ suit: s, rank: r });
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

/* 将7张牌（2底牌+5公牌）评估为最大5张牌的分数 */
function evaluate7(cards7) {
  let best = -1;
  // 从7张选5张，共21种组合
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) {
            const score = evaluate5([cards7[a], cards7[b], cards7[c], cards7[d], cards7[e]]);
            if (score > best) best = score;
          }
  return best;
}

/* 评估5张牌的分数，越大越好。格式: rank*16^5 + kickers */
function evaluate5(hand) {
  const ranks = hand.map(c => c.rank).sort((a, b) => b - a);
  const isFlush = hand.every(c => c.suit === hand[0].suit);

  // 顺子判断
  const uniqueRanks = [...new Set(ranks)];
  let isStraight = false;
  let straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (ranks[0] - ranks[4] === 4) {
      isStraight = true; straightHigh = ranks[0];
    } else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
      isStraight = true; straightHigh = 5; // A-5 小顺
    }
  }

  if (isFlush && isStraight) {
    return 8 * 1048576 + straightHigh * 65536;
  }

  // 统计rank频次
  const freq = {};
  for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
  const counts = Object.entries(freq).map(([r, c]) => ({ rank: parseInt(r), count: c }));
  counts.sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (counts[0].count === 4) {
    const kicker = counts[1].rank;
    return 7 * 1048576 + counts[0].rank * 65536 + kicker * 4096;
  }
  if (counts[0].count === 3 && counts[1].count === 2) {
    return 6 * 1048576 + counts[0].rank * 65536 + counts[1].rank * 4096;
  }
  if (isFlush) {
    return 5 * 1048576 + ranks[0] * 65536 + ranks[1] * 4096 + ranks[2] * 256 + ranks[3] * 16 + ranks[4];
  }
  if (isStraight) {
    return 4 * 1048576 + straightHigh * 65536;
  }
  if (counts[0].count === 3) {
    const kickers = counts.slice(1).map(x => x.rank);
    return 3 * 1048576 + counts[0].rank * 65536 + kickers[0] * 4096 + kickers[1] * 256;
  }
  if (counts[0].count === 2 && counts[1].count === 2) {
    const kicker = counts[2].rank;
    return 2 * 1048576 + counts[0].rank * 65536 + counts[1].rank * 4096 + kicker * 256;
  }
  if (counts[0].count === 2) {
    const kickers = counts.slice(1).map(x => x.rank);
    return 1 * 1048576 + counts[0].rank * 65536 + kickers[0] * 4096 + kickers[1] * 256 + kickers[2] * 16;
  }
  return ranks[0] * 65536 + ranks[1] * 4096 + ranks[2] * 256 + ranks[3] * 16 + ranks[4];
}

function handRankName(score) {
  const rank = Math.floor(score / 1048576);
  const names = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
  return names[rank] || '未知';
}

function cardToString(card) {
  if (!card) return '?';
  return (SUIT_NAMES[card.suit] || card.suit) + (RANK_NAMES[card.rank] || card.rank);
}

class TexasHoldemEngine {
  constructor(players, sendFn) {
    // players: Array<{id, name, ws, index}>
    this._send = sendFn; // (playerIndex, obj) => void
    this.playerCount = players.length;
    this.players = players.map((p, i) => ({
      ...p,
      index: i,
      chips: 1000,
      holeCards: [],
      folded: false,
      allin: false,
      bet: 0,       // 本轮已下注
      totalBet: 0,  // 本局总下注（用于边池）
      hasActed: false
    }));
    this.deck = [];
    this.communityCards = [];
    this.dealer = -1;
    this.currentPlayer = -1;
    this.phase = 'idle'; // idle, preflop, flop, turn, river, showdown, ended
    this.pot = 0;
    this.currentBet = 0;
    this.logs = [];
    this.ended = false;
    this.smallBlind = 10;
    this.bigBlind = 20;
    this.needsAction = new Set();
    this.startChips = this.players.map(p => p.chips);
    this.lastPots = [];
  }

  start() {
    // 清除可能存在的自动开始定时器
    if (this._autoStartTimer) {
      clearTimeout(this._autoStartTimer);
      this._autoStartTimer = null;
    }
    // 选择庄家（顺时针轮换）
    this.dealer = (this.dealer + 1) % this.playerCount;
    // 重置状态
    this.players.forEach(p => {
      p.holeCards = [];
      p.folded = false;
      p.allin = false;
      p.bet = 0;
      p.totalBet = 0;
      p.hasActed = false;
    });
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.logs = [];
    this.ended = false;
    this.needsAction = new Set();
    this.startChips = this.players.map(p => p.chips);
    this.lastPots = [];

    this.deck = createDeck();
    shuffle(this.deck);

    // 发底牌
    for (let i = 0; i < 2; i++) {
      for (let pi = 0; pi < this.playerCount; pi++) {
        const target = (this.dealer + 1 + pi) % this.playerCount;
        this.players[target].holeCards.push(this.deck.pop());
      }
    }

    // 盲注位置
    const sbIdx = (this.dealer + 1) % this.playerCount;
    const bbIdx = (this.dealer + 2) % this.playerCount;
    const sb = this.players[sbIdx];
    const bb = this.players[bbIdx];

    // 小盲
    const sbAmount = Math.min(this.smallBlind, sb.chips);
    sb.chips -= sbAmount;
    sb.bet += sbAmount;
    if (sb.chips === 0) sb.allin = true;

    // 大盲
    const bbAmount = Math.min(this.bigBlind, bb.chips);
    bb.chips -= bbAmount;
    bb.bet += bbAmount;
    if (bb.chips === 0) bb.allin = true;

    this.currentBet = bb.bet;
    this.phase = 'preflop';

    this.logs.push(`=== 新局开始，庄家: ${this.players[this.dealer].name} ===`);
    this.logs.push(`${sb.name} 小盲 ${sbAmount}`);
    this.logs.push(`${bb.name} 大盲 ${bbAmount}`);

    // 设置第一个行动的玩家 = BB下家
    this.currentPlayer = (bbIdx + 1) % this.playerCount;
    this._initNeedsAction();
    this._skipToNextNeedingAction();

    // 如果所有人都不能行动（如只剩1人有筹码，但其他人allin），直接推进
    if (this._eligibleActors().length === 0 || this.needsAction.size === 0) {
      this._endBettingRound();
    } else {
      this._broadcastAll();
    }
  }

  stop() {
    if (this._autoStartTimer) {
      clearTimeout(this._autoStartTimer);
      this._autoStartTimer = null;
    }
  }

  handleMessage(playerIndex, rawMsg) {
    if (this.ended) return;
    if (playerIndex !== this.currentPlayer) return;
    let msg;
    try { msg = JSON.parse(rawMsg); } catch (e) { return; }
    if (msg.type === 'bet') {
      this._handleBet(playerIndex, msg);
    }
  }

  _eligibleActors() {
    return this.players.filter(p => !p.folded && !p.allin && p.chips > 0);
  }

  _notFolded() {
    return this.players.filter(p => !p.folded);
  }

  _initNeedsAction() {
    this.needsAction = new Set();
    for (const p of this._eligibleActors()) {
      this.needsAction.add(p.index);
    }
  }

  _skipToNextNeedingAction() {
    const n = this.playerCount;
    let idx = this.currentPlayer;
    for (let step = 0; step < n; step++) {
      if (this.needsAction.has(idx)) break;
      idx = (idx + 1) % n;
    }
    this.currentPlayer = idx;
  }

  _handleBet(idx, msg) {
    const p = this.players[idx];
    if (p.folded || p.allin || p.chips <= 0) return;

    const action = msg.action;
    let amount = parseInt(msg.amount) || 0;

    if (action === 'fold') {
      p.folded = true;
      this.logs.push(`${p.name} 弃牌`);
      this.needsAction.delete(idx);

      const remaining = this._notFolded();
      if (remaining.length === 1) {
        // 只剩一人，_endBettingRound -> _advancePhase -> _awardWinner 会处理
        this._endBettingRound();
        return;
      }
    } else if (action === 'check') {
      if (this.currentBet > 0 && p.bet !== this.currentBet) {
        this._send(idx, { event: 'error', msg: '不能过牌，需跟注或加注' });
        return;
      }
      this.logs.push(`${p.name} 过牌`);
      this.needsAction.delete(idx);
    } else if (action === 'call') {
      const need = this.currentBet - p.bet;
      if (need <= 0) {
        this.logs.push(`${p.name} 过牌`);
        this.needsAction.delete(idx);
      } else if (p.chips <= need) {
        // 筹码不足，allin
        const allinAmt = p.chips;
        p.bet += allinAmt;
        p.chips = 0;
        p.allin = true;
        p.hasActed = true;
        this.logs.push(`${p.name} 全下 ${p.bet}（不足跟注）`);
        this.needsAction.delete(idx);
      } else {
        p.chips -= need;
        p.bet += need;
        p.hasActed = true;
        this.logs.push(`${p.name} 跟注 ${need}`);
        this.needsAction.delete(idx);
      }
    } else if (action === 'raise') {
      if (amount <= this.currentBet) {
        this._send(idx, { event: 'error', msg: '加注金额必须高于当前注额' });
        return;
      }
      const need = amount - p.bet;
      if (need > p.chips) {
        this._send(idx, { event: 'error', msg: '筹码不足' });
        return;
      }
      // 最小加注限制：至少是当前注额 + bigBlind（除非allin）
      if (need < p.chips && amount - this.currentBet < this.bigBlind) {
        this._send(idx, { event: 'error', msg: `最小加注额增加 ${this.bigBlind}` });
        return;
      }
      p.chips -= need;
      p.bet += need;
      this.currentBet = amount;
      p.hasActed = true;
      this.logs.push(`${p.name} 加注到 ${amount}`);

      // raise后重置needsAction（除raiser自己）
      this.needsAction = new Set();
      for (const ep of this._eligibleActors()) {
        if (ep.index !== idx) this.needsAction.add(ep.index);
      }
      // raise的人自然从当前needsAction中移除，因为刚刚行动过
      this.needsAction.delete(idx);
    } else if (action === 'allin') {
      const need = p.chips;
      const newBet = p.bet + need;
      p.bet = newBet;
      p.chips = 0;
      p.allin = true;
      p.hasActed = true;
      if (newBet > this.currentBet) {
        this.currentBet = newBet;
        this.logs.push(`${p.name} 全下 ${newBet}`);
        // allin超过currentBet视为raise，重置needsAction
        this.needsAction = new Set();
        for (const ep of this._eligibleActors()) {
          if (ep.index !== idx) this.needsAction.add(ep.index);
        }
        this.needsAction.delete(idx);
      } else {
        this.logs.push(`${p.name} 全下 ${newBet}（不足跟注）`);
        this.needsAction.delete(idx);
      }
    } else {
      return;
    }

    // 推进
    const remaining = this._notFolded();
    if (remaining.length === 1) {
      // _endBettingRound -> _advancePhase -> _awardWinner 会处理
      this._endBettingRound();
      return;
    }

    if (this.needsAction.size === 0) {
      this._endBettingRound();
      return;
    }

    // 找下一个需要行动的玩家
    let nextIdx = (idx + 1) % this.playerCount;
    let found = false;
    for (let step = 0; step < this.playerCount; step++) {
      if (this.needsAction.has(nextIdx)) { found = true; break; }
      nextIdx = (nextIdx + 1) % this.playerCount;
    }
    if (!found) {
      // 理论上不会发生，因为needsAction.size > 0
      this._endBettingRound();
      return;
    }
    this.currentPlayer = nextIdx;
    this._broadcastAll();
  }

  _endBettingRound() {
    // 收集本轮下注到pot
    for (const p of this.players) {
      this.pot += p.bet;
      p.totalBet += p.bet;
      p.bet = 0;
    }
    this.currentBet = 0;
    this.needsAction = new Set();
    this._advancePhase();
  }

  _advancePhase() {
    const notFolded = this._notFolded();
    if (notFolded.length === 1) {
      this._awardWinner(notFolded[0]);
      return;
    }

    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this._burnAndDeal(3);
      this.logs.push(`翻牌: ${this.communityCards.slice(0, 3).map(cardToString).join(' ')}`);
    } else if (this.phase === 'flop') {
      this.phase = 'turn';
      this._burnAndDeal(1);
      this.logs.push(`转牌: ${this.communityCards.slice(3, 4).map(cardToString).join(' ')}`);
    } else if (this.phase === 'turn') {
      this.phase = 'river';
      this._burnAndDeal(1);
      this.logs.push(`河牌: ${this.communityCards.slice(4, 5).map(cardToString).join(' ')}`);
    } else if (this.phase === 'river') {
      this.phase = 'showdown';
      this._showdown();
      return;
    }

    // 新一轮下注
    this.currentPlayer = (this.dealer + 1) % this.playerCount;
    this._initNeedsAction();
    this._skipToNextNeedingAction();

    if (this._eligibleActors().length === 0 || this.needsAction.size === 0) {
      this._endBettingRound();
    } else {
      this._broadcastAll();
    }
  }

  _burnAndDeal(n) {
    if (this.deck.length > 0) this.deck.pop(); // burn card
    for (let i = 0; i < n; i++) {
      if (this.deck.length > 0) this.communityCards.push(this.deck.pop());
    }
  }

  _showdown() {
    const contenders = this._notFolded();
    // 亮牌
    this.logs.push('=== 亮牌 ===');
    for (const p of contenders) {
      const score = evaluate7([...p.holeCards, ...this.communityCards]);
      p._score = score;
      this.logs.push(`${p.name}: ${p.holeCards.map(cardToString).join(' ')} — ${handRankName(score)}`);
    }

    // 边池分配
    const pots = this._calculateSidePots(contenders);
    this.lastPots = [];
    for (const pot of pots) {
      const eligible = pot.eligible;
      if (eligible.length === 0) continue;
      let winners;
      if (eligible.length === 1) {
        const winner = eligible[0];
        winner.chips += pot.amount;
        this.logs.push(`${winner.name} 赢得边池 ${pot.amount}`);
        winners = [winner];
      } else {
        // 找最大牌
        let bestScore = -1;
        for (const ep of eligible) {
          if (ep._score > bestScore) bestScore = ep._score;
        }
        const w = eligible.filter(ep => ep._score === bestScore);
        const winAmount = Math.floor(pot.amount / w.length);
        for (const wn of w) {
          wn.chips += winAmount;
          this.logs.push(`${wn.name} 赢得边池 ${winAmount}（${handRankName(bestScore)}）`);
        }
        // 余数给第一个赢家（基本不会发生，除非pot不能被整除）
        const remainder = pot.amount - winAmount * w.length;
        if (remainder > 0 && w.length > 0) w[0].chips += remainder;
        winners = w;
      }
      this.lastPots.push({ amount: pot.amount, winners: winners.map(w => w.name) });
    }

    this._finalizeGame();
  }

  _awardWinner(winner) {
    const notFolded = this._notFolded();
    // 如果只剩一人，也可能有totalBet需要收集（preflop有人fold的情况）
    // 但_endBettingRound已经收集了当前轮的bet。如果中途有人fold导致直接award，说明还没_endBettingRound。
    // 这里需要把剩余bet也收进pot
    for (const p of this.players) {
      this.pot += p.bet;
      p.totalBet += p.bet;
      p.bet = 0;
    }

    this.logs.push(`${winner.name} 赢得底池 ${this.pot}`);
    winner.chips += this.pot;
    this.lastPots = [{ amount: this.pot, winners: [winner.name] }];
    this._finalizeGame();
  }

  _calculateSidePots(contenders) {
    // contenders 未fold的玩家
    const allBettors = this.players.filter(p => p.totalBet > 0).sort((a, b) => a.totalBet - b.totalBet);
    const pots = [];
    let prevBet = 0;
    for (const p of allBettors) {
      if (p.totalBet > prevBet) {
        const amount = (p.totalBet - prevBet) * this.players.filter(c => c.totalBet >= p.totalBet).length;
        const eligible = contenders.filter(c => c.totalBet >= p.totalBet);
        pots.push({ amount, eligible });
        prevBet = p.totalBet;
      }
    }
    return pots;
  }

  _finalizeGame() {
    this.ended = true;
    this.currentPlayer = -1;
    this.phase = 'ended';
    this.pot = 0; // 已分配完毕，清零防重复award
    this._broadcastAll();
    const settlement = {
      players: this.players.map((p, i) => ({
        name: p.name,
        holeCards: p.holeCards.map(cardToString),
        bestHand: handRankName(p._score || (this.communityCards.length >= 5 ? evaluate7([...p.holeCards, ...this.communityCards]) : 0)),
        chips: p.chips,
        change: p.chips - (this.startChips[i] || 0)
      })),
      pots: this.lastPots || []
    };
    for (let i = 0; i < this.playerCount; i++) {
      this._send(i, { event: 'over', winner: this._getWinnersText(), settlement });
    }
  }

  _getWinnersText() {
    const maxChips = Math.max(...this.players.map(p => p.chips));
    const winners = this.players.filter(p => p.chips === maxChips);
    if (winners.length === 1) return winners[0].name;
    return winners.map(w => w.name).join('、');
  }

  /* 构建对外状态 */
  _statePayload() {
    const payload = {
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      dealer: this.dealer,
      currentPlayer: this.currentPlayer,
      communityCards: this.communityCards.map(c => cardToString(c)),
      logs: this.logs.slice(-20),
      players: this.players.map((p, i) => ({
        index: i,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allin: p.allin,
        isCurrent: i === this.currentPlayer,
        isDealer: i === this.dealer,
        // 手牌数量不公开，只有观战时showdown阶段或自己的才公开
        handSize: p.holeCards.length
      }))
    };
    if (this.phase === 'showdown' || this.phase === 'ended') {
      payload.players.forEach((pp, i) => {
        const p = this.players[i];
        pp.holeCards = p.holeCards.map(c => cardToString(c));
        pp.bestHand = handRankName(p._score || 0);
      });
    }
    return payload;
  }

  _broadcastAll() {
    const state = this._statePayload();
    for (let i = 0; i < this.playerCount; i++) {
      const p = this.players[i];
      const myCards = p.holeCards.map(c => cardToString(c));
      this._send(i, { event: this.ended ? 'update' : 'update', state });
      this._send(i, { myHand: myCards, myIndex: i, spectator: false });
    }
  }

  /* 给观战者的状态 */
  _spectatorState() {
    const s = this._statePayload();
    // 观战者看不到底牌（除非showdown/ended）
    return s;
  }
}

module.exports = TexasHoldemEngine;
