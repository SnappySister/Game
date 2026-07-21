'use strict';
/**
 * 大富翁游戏引擎（精简标准版）
 * 接入契约参考 sichuan-mahjong.js：
 *   constructor(players, sendFn, ...)
 *   start() / handleMessage(playerIndex, rawMsg) / playerDisconnected(playerIndex) / _broadcastAll()
 * 状态机：idle → rolling → moving → event → action → ended
 * 外置地图数据：games/monopoly-map.json
 */
const MAP = require('./monopoly-map.json');

// 颜色 → 是否为可升级地产（含车站/公用设施不可升级）
const BUILDABLE_COLORS = ['brown', 'lightblue', 'pink', 'orange', 'red', 'yellow'];

class MonopolyEngine {
  constructor(players, sendFn, prevScores, logFn) {
    this.players = players.map((p, i) => ({
      id: p.id, name: p.name, ws: p.ws, index: i,
      cash: 1500,
      position: 0,
      bankrupt: false,
      jailTurns: 0,           // 入狱剩余回合（>0 表示在狱中）
      jailCards: 0,           // 出狱卡数量
      disconnected: false,
      score: prevScores && prevScores[i] != null ? prevScores[i] : 0,
      doublesCount: 0,        // 本回合连续同点次数
    }));
    this.playerCount = this.players.length;
    this._send = sendFn;
    this._log = logFn || (() => {});
    this.phase = 'idle';      // idle/rolling/moving/event/action/trading/ended
    this.currentPlayer = 0;
    this.round = 1;
    this.maxRounds = MAP.meta.maxRounds;
    this.cells = MAP.cells;
    this.chanceDeck = this._shuffle(MAP.chanceCards.map((c, i) => i));
    this.fateDeck = this._shuffle(MAP.fateCards.map((c, i) => i));
    this.cellState = MAP.cells.map(c => {
      if (c.type === 'property' || c.type === 'station' || c.type === 'utility') {
        return { type: 'ownable', owner: -1, houses: 0, mortgaged: false };
      }
      return { type: 'other' };
    });
    // 交易：发起方提交的待确认交易提议
    this.pendingTrade = null;   // { from, to, offer, request, responses: {to: bool} }
    this.tradeTimer = null;
    this.lastDice = null;
    this.log = [];
    this.ended = false;
    this.pendingResolve = null; // 移动后需玩家决策的事件描述（如买地、交租破产）
  }

  start() {
    this.phase = 'idle';
    this._pushLog(`新对局开始，共 ${this.playerCount} 位玩家，每人初始 1500 元，目标 ${this.maxRounds} 回合。`);
    this._broadcastAll();
    // 第一位玩家进入等待掷骰
    this._startTurn();
  }

  // ==================== 工具 ====================
  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _pushLog(text) {
    this.log.push({ text, round: this.round, player: this.currentPlayer });
    if (this.log.length > 60) this.log.shift();
    this._log(`[大富翁] R${this.round} ${text}`);
  }

  _cellName(idx) { return this.cells[idx].name; }

  _alivePlayers() { return this.players.filter(p => !p.bankrupt); }

  _isOwnable(idx) {
    return this.cells[idx].type === 'property' || this.cells[idx].type === 'station' || this.cells[idx].type === 'utility';
  }

  _ownerOf(idx) { return this.cellState[idx].owner; }

  _sameColorCells(color) {
    return this.cells.map((c, i) => ({ c, i })).filter(x => x.c.color === color);
  }

  // 该玩家是否拥有某颜色全部地产
  _ownsFullSet(pIdx, color) {
    const cells = this._sameColorCells(color);
    return cells.length > 0 && cells.every(x => this.cellState[x.i].owner === pIdx);
  }

  // 该颜色组是否已建房屋（升级前提：整组无房屋才能逐块建，或都均衡建设——这里采用均衡规则）
  _canBuildOn(pIdx, cellIdx) {
    const c = this.cells[cellIdx];
    if (!BUILDABLE_COLORS.includes(c.color)) return false;
    if (this.cellState[cellIdx].owner !== pIdx) return false;
    if (!this._ownsFullSet(pIdx, c.color)) return false;
    const cs = this.cellState[cellIdx];
    if (cs.houses >= 5) return false;          // 5 = 酒店
    // 均衡建设：本组内不能比其他格多 1 栋以上
    const setCells = this._sameColorCells(c.color);
    const minHouses = Math.min(...setCells.map(x => this.cellState[x.i].houses));
    return cs.houses === minHouses;
  }

  _canSellHouse(pIdx, cellIdx) {
    const c = this.cells[cellIdx];
    if (!BUILDABLE_COLORS.includes(c.color)) return false;
    if (this.cellState[cellIdx].owner !== pIdx) return false;
    return this.cellState[cellIdx].houses > 0;
  }

  // 计算过路费
  _rentFor(cellIdx) {
    const c = this.cells[cellIdx];
    const cs = this.cellState[cellIdx];
    if (c.type === 'property') {
      return c.rent[cs.houses];
    }
    if (c.type === 'station') {
      const owned = this._sameColorCells('station').filter(x => this.cellState[x.i].owner === cs.owner).length;
      return c.rent[owned - 1];
    }
    if (c.type === 'utility') {
      const owned = this._sameColorCells('utility').filter(x => this.cellState[x.i].owner === cs.owner).length;
      const mult = owned === 2 ? 10 : 4;
      return mult * (this.lastDice ? (this.lastDice[0] + this.lastDice[1]) : 7);
    }
    return 0;
  }

  _netWorth(p) {
    let w = p.cash;
    this.cells.forEach((c, i) => {
      const cs = this.cellState[i];
      if (cs.type === 'ownable' && cs.owner === p.index) {
        w += c.price / 2;
        if (c.type === 'property') w += (this.cellState[i].houses * c.housePrice) / 2;
      }
    });
    return Math.floor(w);
  }

  // ==================== 回合流转 ====================
  _startTurn() {
    if (this.ended) return;
    const p = this.players[this.currentPlayer];
    this.phase = 'idle';
    this._pushLog(`第 ${this.round} 回合，轮到 ${p.name}。`);
    if (p.bankrupt) { this._nextPlayer(); return; }
    // 监狱状态处理
    if (p.jailTurns > 0) {
      this.phase = 'action';
      this._broadcastAll();
      return;
    }
    this._broadcastAll();
  }

  _nextPlayer() {
    if (this.ended) return;
    if (this._alivePlayers().length <= 1) { this._endGame(); return; }
    // 推进到下一个未破产玩家
    let next = (this.currentPlayer + 1) % this.playerCount;
    while (this.players[next].bankrupt) {
      next = (next + 1) % this.playerCount;
    }
    if (next <= this.currentPlayer) {
      // 走完一圈，进入下一回合
      this.round++;
      if (this.round > this.maxRounds) { this._endGame(); return; }
    }
    this.currentPlayer = next;
    this.players[next].doublesCount = 0;
    this._startTurn();
  }

  // ==================== 掷骰 ====================
  _rollDice() {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    return [d1, d2];
  }

  _handleRoll(pIdx) {
    if (this.phase !== 'idle') return;
    const p = this.players[pIdx];
    if (pIdx !== this.currentPlayer || p.bankrupt) return;
    const dice = this._rollDice();
    this.lastDice = dice;
    const total = dice[0] + dice[1];
    const isDouble = dice[0] === dice[1];
    p.doublesCount = isDouble ? p.doublesCount + 1 : 0;

    // 监狱中
    if (p.jailTurns > 0) {
      if (isDouble) {
        p.jailTurns = 0;
        this._pushLog(`${p.name} 在狱中掷出双 ${dice[0]}，出狱移动 ${total} 格。`);
        this.phase = 'moving';
        this._broadcastAll();
        this._move(pIdx, total);
      } else {
        p.jailTurns--;
        this._pushLog(`${p.name} 未掷出双点，剩余 ${p.jailTurns} 回合。`);
        if (p.jailTurns <= 0) {
          p.cash -= MAP.meta.jailBail;
          p.jailTurns = 0;
          this._pushLog(`${p.name} 服刑期满，交保释金 ${MAP.meta.jailBail} 元出狱并移动 ${total} 格。`);
          this.phase = 'moving';
          this._broadcastAll();
          this._move(pIdx, total);
        } else {
          this._broadcastAll();
          this._nextPlayer();
        }
      }
      return;
    }

    // 连续 3 次同点入狱
    if (p.doublesCount >= 3) {
      this._pushLog(`${p.name} 连续 3 次掷出双点，直接入狱！`);
      this._sendToJail(pIdx);
      return;
    }

    this._pushLog(`${p.name} 掷出 ${dice[0]} + ${dice[1]} = ${total}${isDouble ? '（双点，可再掷）' : ''}。`);
    this.phase = 'moving';
    this._broadcastAll();
    this._move(pIdx, total);
  }

  // ==================== 移动 ====================
  // 正向移动（绕过 0 点）领起点奖金；后退不发奖金
  _move(pIdx, steps) {
    const p = this.players[pIdx];
    const len = this.cells.length;
    let newPos = p.position + steps;
    if (steps > 0 && newPos >= len) {
      p.cash += MAP.meta.startBonus;
      this._pushLog(`${p.name} 经过起点，领取 ${MAP.meta.startBonus} 元。`);
    }
    p.position = ((newPos % len) + len) % len;
    this._onLand(pIdx);
  }

  // 卡片"前进到指定格子"：正向绕过 0 点领奖金
  _moveTo(pIdx, target) {
    const p = this.players[pIdx];
    if (target < p.position) {
      p.cash += MAP.meta.startBonus;
      this._pushLog(`${p.name} 经过起点，领取 ${MAP.meta.startBonus} 元。`);
    }
    p.position = target;
    this._onLand(pIdx);
  }

  _moveToType(pIdx, cellType) {
    const p = this.players[pIdx];
    let target = -1;
    for (let i = 1; i <= this.cells.length; i++) {
      const idx = (p.position + i) % this.cells.length;
      if (this.cells[idx].type === cellType) { target = idx; break; }
    }
    if (target === -1) { this._onLand(pIdx); return; }
    if (target < p.position) {
      p.cash += MAP.meta.startBonus;
      this._pushLog(`${p.name} 经过起点，领取 ${MAP.meta.startBonus} 元。`);
    }
    p.position = target;
    this._onLand(pIdx);
  }

  // ==================== 落地事件 ====================
  _onLand(pIdx) {
    const p = this.players[pIdx];
    const cell = this.cells[p.position];
    this._pushLog(`${p.name} 到达 ${cell.name}。`);

    switch (cell.type) {
      case 'start':
        // 落在起点：经起点奖金已在 _move 处理，落地额外再领一次
        p.cash += MAP.meta.startBonus;
        this._pushLog(`${p.name} 停在起点，领取 ${MAP.meta.startBonus} 元。`);
        this._endMoveOrContinue(pIdx);
        break;
      case 'tax':
        this._pay(pIdx, MAP.meta.incomeTaxAmount, -1, () => this._endMoveOrContinue(pIdx));
        break;
      case 'luxury_tax':
        this._pay(pIdx, MAP.meta.luxuryTaxAmount, -1, () => this._endMoveOrContinue(pIdx));
        break;
      case 'jail':
        // jail 格子=被关进/关在监狱；仅作为路过的"探监点"，无副作用
        this._endMoveOrContinue(pIdx);
        break;
      case 'chance':
        this._drawCard(pIdx, 'chance');
        break;
      case 'fate':
        this._drawCard(pIdx, 'fate');
        break;
      case 'property':
      case 'station':
      case 'utility':
        this._onOwnable(pIdx);
        break;
      default:
        this._endMoveOrContinue(pIdx);
    }
    this._broadcastAll();
  }

  _onOwnable(pIdx) {
    const p = this.players[pIdx];
    const idx = p.position;
    const cs = this.cellState[idx];
    if (cs.owner === -1) {
      // 无主：可购买
      this.phase = 'action';
      const price = this.cells[idx].price;
      if (p.cash >= price) {
        this.pendingResolve = { kind: 'buy', cell: idx, price };
        this._send(pIdx, { event: 'actionRequest', actions: ['buy', 'pass'], reason: `是否购买 ${this._cellName(idx)}（${price} 元）？` });
      } else {
        this._pushLog(`${p.name} 资金不足，无法购买 ${this._cellName(idx)}。`);
        this._endMoveOrContinue(pIdx);
      }
    } else if (cs.owner !== pIdx && !cs.mortgaged) {
      // 他人所有：付过路费
      const rent = this._rentFor(idx);
      this._pushLog(`${p.name} 进入 ${this.players[cs.owner].name} 的领地 ${this._cellName(idx)}，需付过路费 ${rent} 元。`);
      this._pay(pIdx, rent, cs.owner, () => this._endMoveOrContinue(pIdx));
    } else {
      // 自己的地产或他人已抵押：进入管理阶段，可选建房/抵押/结束回合
      this._startManage(pIdx, idx);
    }
  }

  // 落地到自己地产：给玩家一次管理机会（建房/抵押/赎回/跳过）
  _startManage(pIdx, idx) {
    const p = this.players[pIdx];
    const c = this.cells[idx];
    const cs = this.cellState[idx];
    const actions = [];
    const opts = {};
    // 自己的地产
    if (cs.owner === pIdx) {
      if (this._canBuildOn(pIdx, idx) && p.cash >= c.housePrice) {
        actions.push('build'); opts.buildPrice = c.housePrice;
      }
      if (this._canSellHouse(pIdx, idx)) {
        actions.push('sellHouse'); opts.sellBack = Math.floor(c.housePrice / 2);
      }
      if (!cs.mortgaged && cs.houses === 0) {
        actions.push('mortgage'); opts.mortgageAmt = Math.floor(c.price / 2);
      }
      if (cs.mortgaged && p.cash >= Math.ceil(c.price * 0.55)) {
        actions.push('redeem'); opts.redeemCost = Math.ceil(c.price * 0.55);
      }
    }
    if (actions.length > 0) {
      this.phase = 'action';
      this.pendingResolve = { kind: 'manage', cell: idx, actions, opts };
      const cellName = this._cellName(idx);
      let reason = `你停在 ${cellName}（${c.type === 'property' ? 'Lv.' + cs.houses : cs.mortgaged ? '已抵押' : '自有'}）`;
      if (actions.includes('build')) reason += `，可建房（¥${opts.buildPrice}）`;
      this._send(pIdx, { event: 'actionRequest', actions, reason, cell: idx, opts });
    } else {
      this._endMoveOrContinue(pIdx);
    }
  }

  _endMoveOrContinue(pIdx) {
    const p = this.players[pIdx];
    if (p.bankrupt) { this._checkBankruptEnd(pIdx); return; }
    // 双点可再掷，否则换人
    if (p.doublesCount > 0 && p.doublesCount < 3 && p.jailTurns === 0) {
      this.phase = 'idle';
      this._pushLog(`${p.name} 因双点获得额外一次掷骰。`);
      this._broadcastAll();
    } else {
      this._nextPlayer();
    }
  }

  _checkBankruptEnd(pIdx) {
    if (this._alivePlayers().length <= 1) { this._endGame(); return; }
    this._nextPlayer();
  }

  // ==================== 付款（含破产判定） ====================
  _pay(pIdx, amount, toIdx, onDone) {
    const p = this.players[pIdx];
    if (p.cash >= amount) {
      p.cash -= amount;
      if (toIdx >= 0) {
        this.players[toIdx].cash += amount;
      }
      onDone && onDone();
      return;
    }
    // 现金不足：尝试变卖房屋、抵押（简化：自动判定是否可救，否则破产）
    const recoverable = this._estimateLiquidation(pIdx);
    if (p.cash + recoverable >= amount) {
      // 资金缺口：要求玩家处理资产。简化策略——优先卖房屋、再抵押地产，直至满足。
      this._autoLiquidate(pIdx, amount - p.cash);
      p.cash -= amount;
      if (toIdx >= 0) this.players[toIdx].cash += amount;
      this._pushLog(`${p.name} 通过变卖资产凑齐 ${amount} 元。`);
      onDone && onDone();
    } else {
      // 破产
      const paid = Math.min(p.cash, amount);
      if (toIdx >= 0) this.players[toIdx].cash += paid;
      this._pushLog(`${p.name} 资金不足，宣告破产！`);
      this._doBankrupt(pIdx, toIdx);
      onDone && onDone();
    }
  }

  _estimateLiquidation(pIdx) {
    let total = 0;
    this.cells.forEach((c, i) => {
      const cs = this.cellState[i];
      if (cs.owner === pIdx) {
        if (c.type === 'property' && cs.houses > 0) total += Math.floor(cs.houses * c.housePrice / 2);
        total += Math.floor(c.price / 2);
      }
    });
    return total;
  }

  _autoLiquidate(pIdx, need) {
    const p = this.players[pIdx];
    // 1) 先卖房屋
    let raised = 0;
    for (let i = 0; i < this.cells.length && raised < need; i++) {
      const c = this.cells[i], cs = this.cellState[i];
      if (cs.owner === pIdx && c.type === 'property' && cs.houses > 0) {
        while (cs.houses > 0 && raised < need) {
          cs.houses--;
          const back = Math.floor(c.housePrice / 2);
          p.cash += back;
          raised += back;
          this._pushLog(`${p.name} 升降级 ${this._cellName(i)}，回收 ${back} 元。`);
        }
      }
    }
    // 2) 抵押地产
    for (let i = 0; i < this.cells.length && raised < need; i++) {
      const c = this.cells[i], cs = this.cellState[i];
      if (cs.owner === pIdx && !cs.mortgaged && cs.houses === 0) {
        cs.mortgaged = true;
        const mort = Math.floor(c.price / 2);
        p.cash += mort;
        raised += mort;
        this._pushLog(`${p.name} 抵押 ${this._cellName(i)}，获得 ${mort} 元。`);
      }
    }
  }

  _doBankrupt(pIdx, creditorIdx) {
    const p = this.players[pIdx];
    p.bankrupt = true;
    // 资产转移给债主（若有），否则释放为无主
    this.cells.forEach((c, i) => {
      const cs = this.cellState[i];
      if (cs.owner === pIdx) {
        cs.houses = 0;
        cs.mortgaged = false;
        cs.owner = (creditorIdx >= 0) ? creditorIdx : -1;
      }
    });
    if (creditorIdx >= 0) {
      this.players[creditorIdx].cash += p.cash;
    }
    p.cash = 0;
    p.jailCards = 0;
    p.jailTurns = 0;
  }

  _sendToJail(pIdx) {
    const p = this.players[pIdx];
    p.position = MAP.meta.jailIndex;
    p.jailTurns = 3;
    p.doublesCount = 0;
    this.phase = 'idle';
    this._broadcastAll();
    this._nextPlayer();
  }

  // ==================== 卡牌 ====================
  _drawCard(pIdx, kind) {
    const p = this.players[pIdx];
    const deck = kind === 'chance' ? this.chanceDeck : this.fateDeck;
    const pool = kind === 'chance' ? MAP.chanceCards : MAP.fateCards;
    if (deck.length === 0) {
      const refill = this._shuffle(pool.map((c, i) => i));
      if (kind === 'chance') this.chanceDeck = refill; else this.fateDeck = refill;
    }
    const cardIdx = deck.shift();
    const card = pool[cardIdx];
    this._pushLog(`${p.name} 抽到 ${kind === 'chance' ? '机会' : '命运'}卡：${card.text}`);
    this.phase = 'event';
    this._broadcastAll();
    this._applyCard(pIdx, card, () => this._endMoveOrContinue(pIdx));
  }

  _applyCard(pIdx, card, done) {
    const p = this.players[pIdx];
    const finish = () => { done && done(); };
    switch (card.type) {
      case 'gain':
        p.cash += card.amount;
        this._pushLog(`${p.name} 获得 ${card.amount} 元。`);
        finish(); break;
      case 'lose':
        this._pay(pIdx, card.amount, -1, finish); break;
      case 'moveTo':
        this.phase = 'moving';
        this._moveTo(pIdx, card.target); break;          // _onLand 内部会收尾
      case 'moveToType':
        this.phase = 'moving';
        this._moveToType(pIdx, card.cellType); break;
      case 'moveBy':
        this.phase = 'moving';
        this._move(pIdx, card.steps); break;              // 后退不发奖金
      case 'goToJail':
        this._sendToJail(pIdx); break;
      case 'getOutOfJail':
        p.jailCards++;
        this._pushLog(`${p.name} 获得一张出狱卡。`);
        finish(); break;
      case 'repair': {
        let cost = 0;
        this.cells.forEach((c, i) => {
          const cs = this.cellState[i];
          if (cs.owner === pIdx && c.type === 'property') cost += cs.houses * card.perHouse;
        });
        this._pay(pIdx, cost, -1, finish); break;
      }
      case 'collectFromOthers': {
        const others = this._alivePlayers().filter(x => x.index !== pIdx);
        let collected = 0;
        others.forEach(o => {
          const give = Math.min(o.cash, card.amount);
          o.cash -= give;
          p.cash += give;
          collected += give;
        });
        this._pushLog(`${p.name} 从其他玩家处共收到 ${collected} 元。`);
        finish(); break;
      }
      case 'payOthers': {
        const others2 = this._alivePlayers().filter(x => x.index !== pIdx);
        const total2 = others2.length * card.amount;
        this._pay(pIdx, total2, -1, () => {
          others2.forEach(o => o.cash += card.amount);
          this._pushLog(`${p.name} 付给每位玩家 ${card.amount} 元。`);
          finish();
        }); break;
      }
      default:
        finish();
    }
  }

  // ==================== 买地/建房/拆房/抵押 ====================
  _buyProperty(pIdx, cellIdx) {
    const p = this.players[pIdx];
    const c = this.cells[cellIdx];
    const cs = this.cellState[cellIdx];
    if (cs.owner !== -1 || p.cash < c.price) return false;
    p.cash -= c.price;
    cs.owner = pIdx;
    this._pushLog(`${p.name} 购入 ${c.name}，花费 ${c.price} 元。`);
    return true;
  }

  _buildHouse(pIdx, cellIdx) {
    if (!this._canBuildOn(pIdx, cellIdx)) return false;
    const c = this.cells[cellIdx];
    const p = this.players[pIdx];
    if (p.cash < c.housePrice) return false;
    p.cash -= c.housePrice;
    this.cellState[cellIdx].houses++;
    this._pushLog(`${p.name} 在 ${c.name} 建造房屋（Lv.${this.cellState[cellIdx].houses}），花费 ${c.housePrice} 元。`);
    return true;
  }

  _sellHouse(pIdx, cellIdx) {
    if (!this._canSellHouse(pIdx, cellIdx)) return false;
    const c = this.cells[cellIdx];
    this.cellState[cellIdx].houses--;
    const back = Math.floor(c.housePrice / 2);
    this.players[pIdx].cash += back;
    this._pushLog(`${this.players[pIdx].name} 出售 ${c.name} 的房屋，回收 ${back} 元。`);
    return true;
  }

  _mortgage(pIdx, cellIdx) {
    const c = this.cells[cellIdx], cs = this.cellState[cellIdx];
    if (cs.owner !== pIdx || cs.mortgaged || cs.houses > 0) return false;
    cs.mortgaged = true;
    const m = Math.floor(c.price / 2);
    this.players[pIdx].cash += m;
    this._pushLog(`${this.players[pIdx].name} 抵押 ${c.name}，获得 ${m} 元。`);
    return true;
  }

  _redeem(pIdx, cellIdx) {
    const c = this.cells[cellIdx], cs = this.cellState[cellIdx];
    if (cs.owner !== pIdx || !cs.mortgaged) return false;
    const cost = Math.ceil(c.price * 0.55);
    if (this.players[pIdx].cash < cost) return false;
    this.players[pIdx].cash -= cost;
    cs.mortgaged = false;
    this._pushLog(`${this.players[pIdx].name} 赎回 ${c.name}，花费 ${cost} 元。`);
    return true;
  }

  // ==================== 交易 ====================
  _startTrade(pIdx, toIdx, offer, request) {
    if (this.pendingTrade) return false;
    if (pIdx === toIdx) return false;
    if (toIdx < 0 || toIdx >= this.playerCount || this.players[toIdx].bankrupt) return false;
    this.pendingTrade = { from: pIdx, to: toIdx, offer, request, accepted: false, declined: false };
    this.phase = 'trading';
    this._pushLog(`${this.players[pIdx].name} 向 ${this.players[toIdx].name} 发起交易提议。`);
    this._send(toIdx, {
      event: 'tradeOffer',
      from: pIdx, fromName: this.players[pIdx].name,
      offer, request
    });
    this._broadcastAll();
    // 30 秒超时自动取消
    if (this.tradeTimer) clearTimeout(this.tradeTimer);
    this.tradeTimer = setTimeout(() => {
      if (this.pendingTrade && !this.pendingTrade.accepted && !this.pendingTrade.declined) {
        this._pushLog('交易超时自动取消。');
        this.pendingTrade = null;
        this.phase = 'idle';
        this._broadcastAll();
      }
    }, 30000);
    return true;
  }

  _resolveTrade(pIdx, accept) {
    if (!this.pendingTrade) return;
    const t = this.pendingTrade;
    if (pIdx !== t.to) return;
    if (this.tradeTimer) { clearTimeout(this.tradeTimer); this.tradeTimer = null; }
    if (!accept) {
      t.declined = true;
      this._pushLog(`${this.players[t.to].name} 拒绝了交易。`);
      this.pendingTrade = null;
      this.phase = 'idle';
      this._broadcastAll();
      return;
    }
    // 校验并执行
    if (this._validateAndExecuteTrade(t)) {
      t.accepted = true;
      this._pushLog(`${this.players[t.from].name} 与 ${this.players[t.to].name} 完成交易。`);
    } else {
      this._pushLog('交易校验失败，已取消。');
    }
    this.pendingTrade = null;
    this.phase = 'idle';
    this._broadcastAll();
  }

  _validateAndExecuteTrade(t) {
    const a = this.players[t.from], b = this.players[t.to];
    const offer = t.offer || {}, request = t.request || {};
    offer.properties = offer.properties || [];
    request.properties = request.properties || [];
    offer.cash = offer.cash || 0;
    request.cash = request.cash || 0;
    offer.jailCards = offer.jailCards || 0;
    request.jailCards = request.jailCards || 0;
    // offer: A 给 B 的内容；request: B 给 A 的内容
    const checkOwned = (pIdx, props) => props.every(i => this.cellState[i].owner === pIdx && !this.cellState[i].mortgaged);
    const checkCash = (pIdx, cash) => this.players[pIdx].cash >= cash;
    if (!checkOwned(t.from, offer.properties) || !checkOwned(t.to, request.properties)) return false;
    if (!checkCash(t.from, offer.cash) || !checkCash(t.to, request.cash)) return false;
    if (offer.jailCards > a.jailCards || request.jailCards > b.jailCards) return false;
    // 执行
    this.players[t.from].cash -= offer.cash;
    this.players[t.to].cash += offer.cash;
    this.players[t.to].cash -= request.cash;
    this.players[t.from].cash += request.cash;
    a.jailCards -= offer.jailCards; b.jailCards += offer.jailCards;
    b.jailCards -= request.jailCards; a.jailCards += request.jailCards;
    offer.properties.forEach(i => this.cellState[i].owner = t.to);
    request.properties.forEach(i => this.cellState[i].owner = t.from);
    return true;
  }

  // ==================== 监狱操作 ====================
  _useJailCard(pIdx) {
    const p = this.players[pIdx];
    if (p.jailCards <= 0 || p.jailTurns <= 0) return;
    p.jailCards--;
    p.jailTurns = 0;
    this._pushLog(`${p.name} 使用出狱卡出狱。`);
    this.phase = 'idle';
    this._broadcastAll();
  }

  _payBail(pIdx) {
    const p = this.players[pIdx];
    if (p.jailTurns <= 0) return;
    if (p.cash < MAP.meta.jailBail) return;
    p.cash -= MAP.meta.jailBail;
    p.jailTurns = 0;
    this._pushLog(`${p.name} 交 ${MAP.meta.jailBail} 元保释金出狱，需掷骰移动。`);
    this.phase = 'idle';
    this._broadcastAll();
  }

  // ==================== 结束 ====================
  _endGame() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    const ranked = this.players.slice().map(p => ({
      id: p.id, name: p.name, cash: p.cash, netWorth: this._netWorth(p), bankrupt: p.bankrupt
    })).sort((a, b) => (b.netWorth) - (a.netWorth));
    const winner = ranked[0];
    this._pushLog(`对局结束！冠军：${winner.name}（净资产 ${winner.netWorth} 元）。`);
    this._broadcastAll();
    // 发送结算
    const settlement = ranked.map((r, i) => ({
      rank: i + 1, name: r.name, netWorth: r.netWorth, cash: r.cash, bankrupt: r.bankrupt
    }));
    this.players.forEach((p, i) => {
      p.score = ranked.findIndex(r => r.id === p.id) + 1; // 名次越小越好，存为"名次分"
    });
    this._broadcastSettlement(settlement, winner);
  }

  _broadcastSettlement(settlement, winner) {
    this.players.forEach((p, i) => {
      this._send(i, { event: 'over', settlement, winner: winner.name, myRank: settlement.findIndex(s => s.name === p.name) + 1 });
    });
  }

  // ==================== 消息处理 ====================
  handleMessage(pIdx, rawMsg) {
    if (this.ended) return;
    let msg;
    try { msg = JSON.parse(rawMsg); } catch (e) { return; }
    const p = this.players[pIdx];
    if (!p || p.bankrupt) return;
    if (msg.type === 'roll') { this._handleRoll(pIdx); return; }
    if (msg.type === 'action') {
      const pr = this.pendingResolve;
      if (!pr || pIdx !== this.currentPlayer) return;
      if (pr.kind === 'buy') {
        if (msg.choice === 'buy') this._buyProperty(pIdx, pr.cell);
        this.pendingResolve = null;
        this.phase = 'idle';
        this._broadcastAll();
        this._endMoveOrContinue(pIdx);
      } else if (pr.kind === 'manage') {
        const cell = pr.cell;
        const choice = msg.choice;
        let acted = false;
        if (choice === 'build') acted = this._buildHouse(pIdx, cell);
        else if (choice === 'sellHouse') acted = this._sellHouse(pIdx, cell);
        else if (choice === 'mortgage') acted = this._mortgage(pIdx, cell);
        else if (choice === 'redeem') acted = this._redeem(pIdx, cell);
        // pass / done / 操作失败：结束管理
        if (choice === 'pass' || choice === 'done' || !acted) {
          this.pendingResolve = null;
          this.phase = 'idle';
          this._broadcastAll();
          this._endMoveOrContinue(pIdx);
        } else {
          // 执行成功，重新检查是否还能继续操作（如连建）
          this._broadcastAll();
          this._startManage(pIdx, cell);
        }
      }
      return;
    }
    if (msg.type === 'build') { this._buildHouse(pIdx, msg.cell); this._broadcastAll(); return; }
    if (msg.type === 'sellHouse') { this._sellHouse(pIdx, msg.cell); this._broadcastAll(); return; }
    if (msg.type === 'mortgage') { this._mortgage(pIdx, msg.cell); this._broadcastAll(); return; }
    if (msg.type === 'redeem') { this._redeem(pIdx, msg.cell); this._broadcastAll(); return; }
    if (msg.type === 'useJailCard') { this._useJailCard(pIdx); return; }
    if (msg.type === 'payBail') { this._payBail(pIdx); return; }
    if (msg.type === 'tradeOffer') {
      this._startTrade(pIdx, msg.to, msg.offer, msg.request);
      return;
    }
    if (msg.type === 'tradeResolve') {
      this._resolveTrade(pIdx, msg.accept);
      return;
    }
  }

  playerDisconnected(pIdx) {
    if (pIdx < 0 || pIdx >= this.playerCount) return;
    const p = this.players[pIdx];
    if (!p || p.bankrupt) return;
    p.disconnected = true;
    this._pushLog(`${p.name} 断线，自动破产退出。`);
    this._doBankrupt(pIdx, -1);
    // 若当前轮到该玩家，推进
    if (this.currentPlayer === pIdx && !this.ended) {
      this._nextPlayer();
    }
    this._broadcastAll();
  }

  stop() {
    if (this.tradeTimer) { clearTimeout(this.tradeTimer); this.tradeTimer = null; }
  }

  // ==================== 状态广播 ====================
  _statePayload() {
    return {
      phase: this.phase,
      currentPlayer: this.currentPlayer,
      round: this.round,
      maxRounds: this.maxRounds,
      players: this.players.map(p => ({
        id: p.id, name: p.name, title: p.title || null, nameColor: p.nameColor || null, vipActive: !!p.vipActive, cash: p.cash, position: p.position,
        bankrupt: p.bankrupt, jailTurns: p.jailTurns, jailCards: p.jailCards,
        disconnected: p.disconnected, score: p.score, netWorth: this._netWorth(p)
      })),
      cells: this.cells,
      cellState: this.cellState,
      log: this.log.slice(-12),
      lastDice: this.lastDice,
      pendingResolve: this.pendingResolve,
      pendingTrade: this.pendingTrade ? {
        from: this.pendingTrade.from, to: this.pendingTrade.to
      } : null
    };
  }

  _broadcastAll() {
    if (this.ended) return;
    const state = this._statePayload();
    this.players.forEach((p, i) => {
      this._send(i, { event: 'update', state, myIndex: i });
    });
  }
}

module.exports = MonopolyEngine;
