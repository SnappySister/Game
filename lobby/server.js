const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CardGameEngine = require('./games/card-game');
const TexasHoldemEngine = require('./games/texas-holdem');

const PORT = 3456;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

/* ==================== 数据模型 ==================== */
const users = new Map();       // ws -> { id, name, state, roomId, gameIndex }
const rooms = new Map();       // roomId -> Room
let lobbyChat = [];            // {name, text, time}
let nextUserId = 1;
let nextRoomId = 1;

const GAMES = [
  { id: 'card',   name: '卡牌对战',   desc: '双人回合制卡牌对战', minPlayers: 2, maxPlayers: 2, available: true },
  { id: 'poker',  name: '德州扑克',   desc: '多人德州扑克（2-6人）', minPlayers: 2, maxPlayers: 6, available: true },
  { id: 'chess',  name: '象棋 (开发中)', desc: '敬请期待', minPlayers: 2, maxPlayers: 2, available: false },
  { id: 'snake',  name: '贪吃蛇 (开发中)', desc: '敬请期待', minPlayers: 2, maxPlayers: 4, available: false }
];

function nowStr() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

/* ==================== HTTP 静态文件 ==================== */
const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url;
  const p = path.join(__dirname, 'public', file);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); }
    else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(data); }
  });
});

/* ==================== WebSocket ==================== */
const wss = new WebSocket.Server({ server });

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastExcept(exceptWs, obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c !== exceptWs && c.readyState === 1) c.send(s); });
}

function broadcastLobby(obj) {
  const s = JSON.stringify(obj);
  for (const [ws, user] of users) {
    if (user.state === 'lobby' && ws.readyState === 1) ws.send(s);
  }
}

function broadcastRoom(roomId, obj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const s = JSON.stringify(obj);
  [...room.players, ...room.spectators].forEach(uid => {
    for (const [ws, user] of users) {
      if (user.id === uid && ws.readyState === 1) ws.send(s);
    }
  });
}

function buildLobbyState() {
  const online = [];
  for (const [, u] of users) {
    if (u.state === 'lobby') online.push({ name: u.name });
  }
  return { event: 'lobbyState', online, games: GAMES };
}

function buildRoomList(gameType) {
  const list = [];
  for (const r of rooms.values()) {
    if (r.gameType === gameType) {
      list.push({
        id: r.id, name: r.name,
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        status: r.status,
        spectators: r.spectators.length
      });
    }
  }
  return { event: 'roomList', rooms: list, gameType };
}

function buildRoomState(room) {
  const pNames = room.players.map(uid => {
    for (const [, u] of users) if (u.id === uid) return { name: u.name, id: u.id };
    return { name: '?', id: uid };
  });
  const sNames = room.spectators.map(uid => {
    for (const [, u] of users) if (u.id === uid) return { name: u.name, id: u.id };
    return { name: '?', id: uid };
  });
  const allReady = room.players.length > 0 && room.players.every(uid => room.ready.has(uid));
  return { event: 'roomState', id: room.id, name: room.name, players: pNames, spectators: sNames, status: room.status, chat: room.chat.slice(-30), ready: [...room.ready], allReady, ownerId: room.ownerId };
}

function addChat(scope, roomId, name, text) {
  const t = { name, text, time: nowStr() };
  if (scope === 'lobby') {
    lobbyChat.push(t);
    if (lobbyChat.length > 50) lobbyChat.shift();
    // 大厅聊天广播给所有已连接用户（即使他们在房间/游戏里也能收到）
    const s = JSON.stringify({ event: 'chat', scope: 'lobby', ...t });
    for (const [cws] of users) {
      if (cws.readyState === 1) cws.send(s);
    }
  } else if (scope === 'room' && roomId) {
    const room = rooms.get(roomId);
    if (room) {
      room.chat.push(t);
      if (room.chat.length > 50) room.chat.shift();
      broadcastRoom(roomId, { event: 'chat', scope: 'room', ...t });
    }
  }
}

wss.on('connection', (ws) => {
  send(ws, { event: 'connected' });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const user = users.get(ws);

    /* ---------- 登录 ---------- */
    if (msg.type === 'setName') {
      const name = (msg.name || '').trim().slice(0, 12) || '匿名';
      const id = nextUserId++;
      users.set(ws, { id, name, state: 'lobby', roomId: null, gameIndex: -1 });
      send(ws, { event: 'named', name: name });
      send(ws, buildLobbyState());
      send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
      broadcastLobby(buildLobbyState());
      return;
    }

    if (!user) return; // 未登录忽略

    /* ---------- 聊天 ---------- */
    if (msg.type === 'chat') {
      const scope = msg.scope === 'room' ? 'room' : 'lobby';
      const rid = scope === 'room' ? (user.roomId || null) : null;
      addChat(scope, rid, user.name, (msg.text || '').trim().slice(0, 200));
      return;
    }

    /* ---------- 大厅操����� ---------- */
    if (msg.type === 'listGames') {
      send(ws, { event: 'games', games: GAMES });
      return;
    }

    if (msg.type === 'listRooms') {
      send(ws, buildRoomList(msg.gameType));
      return;
    }

    /* ---------- 创建房间 ---------- */
    if (msg.type === 'createRoom') {
      const game = GAMES.find(g => g.id === msg.gameType && g.available);
      if (!game) { send(ws, { event: 'error', msg: '该游戏不可用' }); return; }
      const rid = 'R' + nextRoomId++;
      const name = (msg.name || `${user.name}的房间`).trim().slice(0, 16);
      const room = {
        id: rid, gameType: game.id, name,
        players: [user.id], spectators: [],
        status: 'waiting', chat: [], gameInstance: null,
        maxPlayers: game.maxPlayers, ownerId: user.id,
        ready: new Set(),
        nextRoundReady: new Set()
      };
      rooms.set(rid, room);
      user.state = 'room';
      user.roomId = rid;
      broadcastLobby(buildLobbyState());
      // 给创建者发房间状态
      send(ws, buildRoomState(room));
      // 通知同游戏大厅的人
      for (const [cws, u] of users) {
        if (u.state === 'game-list' && cws.readyState === 1) {
          send(cws, buildRoomList(game.id));
        }
      }
      return;
    }

    /* ---------- 加入游戏列表页 ---------- */
    if (msg.type === 'enterGameList') {
      user.state = 'game-list';
      send(ws, buildRoomList(msg.gameType));
      return;
    }

    /* ---------- 返回大厅 ---------- */
    if (msg.type === 'backToLobby') {
      user.state = 'lobby';
      user.roomId = null;
      send(ws, buildLobbyState());
      send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
      broadcastLobby(buildLobbyState());
      return;
    }

    /* ---------- 加入房间 ---------- */
    if (msg.type === 'joinRoom') {
      const room = rooms.get(msg.roomId);
      if (!room) { send(ws, { event: 'error', msg: '房间不存在' }); return; }
      if (room.status !== 'waiting') { send(ws, { event: 'error', msg: '游戏已开始' }); return; }
      if (room.players.length >= room.maxPlayers) { send(ws, { event: 'error', msg: '房间已满' }); return; }
      if (room.players.includes(user.id)) { send(ws, { event: 'error', msg: '已在房间中' }); return; }

      // 如果用户在另一个房间，先离开
      if (user.roomId && user.roomId !== room.id) {
        leaveRoomInternal(user.id);
      }

      room.players.push(user.id);
      user.state = 'room';
      user.roomId = room.id;

      broadcastRoom(room.id, buildRoomState(room));
      send(ws, buildRoomState(room));
      send(ws, { event: 'chatHistory', scope: 'room', messages: room.chat });
      return;
    }

    /* ---------- 离开房间 ---------- */
    if (msg.type === 'leaveRoom') {
      if (user.roomId) {
        leaveRoomInternal(user.id);
        user.state = 'lobby';
        user.roomId = null;
        user.gameIndex = -1;
        send(ws, buildLobbyState());
        send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
        broadcastLobby(buildLobbyState());
      }
      return;
    }

    /* ---------- 观战 ---------- */
    if (msg.type === 'spectateRoom') {
      const room = rooms.get(msg.roomId);
      if (!room) { send(ws, { event: 'error', msg: '房间不存在' }); return; }
      if (user.roomId && user.roomId !== room.id) leaveRoomInternal(user.id);

      if (!room.spectators.includes(user.id) && !room.players.includes(user.id)) {
        room.spectators.push(user.id);
      }
      user.state = 'room';
      user.roomId = room.id;

      broadcastRoom(room.id, buildRoomState(room));
      send(ws, buildRoomState(room));
      send(ws, { event: 'chatHistory', scope: 'room', messages: room.chat });

      // 如果游戏正在进行，发送当前游戏状态
      if (room.status === 'playing' && room.gameInstance) {
        send(ws, { event: 'gameStarted', roomId: room.id, gameType: room.gameType });
        const state = room.gameInstance._statePayload();
        send(ws, { event: 'update', state });
        send(ws, { myHand: [], myIndex: -1, spectator: true });
      }
      return;
    }

    /* ---------- 准备/取消准备 ---------- */
    if (msg.type === 'toggleReady') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '不在房间中' }); return; }
      if (!room.players.includes(user.id)) { send(ws, { event: 'error', msg: '你不是玩家' }); return; }
      if (room.ready.has(user.id)) room.ready.delete(user.id);
      else room.ready.add(user.id);
      broadcastRoom(room.id, buildRoomState(room));
      return;
    }

    /* ---------- 开始游戏 ---------- */
    if (msg.type === 'startGame') {
      const room = rooms.get(user.roomId);
      if (!room || room.ownerId !== user.id) { send(ws, { event: 'error', msg: '无权开始' }); return; }
      const game = GAMES.find(g => g.id === room.gameType);
      if (!game) { send(ws, { event: 'error', msg: '游戏不存在' }); return; }
      if (room.status !== 'waiting') { send(ws, { event: 'error', msg: '游戏已开始' }); return; }
      if (room.players.length < game.minPlayers) { send(ws, { event: 'error', msg: '人数不足' }); return; }
      if (!room.players.every(uid => room.ready.has(uid))) { send(ws, { event: 'error', msg: '并非所有玩家都已准备' }); return; }

      room.status = 'playing';
      const players = room.players.map((uid, i) => {
        for (const [ws2, u] of users) {
          if (u.id === uid) return { id: uid, name: u.name, ws: ws2, index: i };
        }
      }).filter(Boolean);

      const sendToPlayer = (pIdx, obj) => {
        const uid = room.players[pIdx];
        for (const [ws2, u] of users) {
          if (u.id === uid) { send(ws2, obj); break; }
        }
      };

      // 德州扑克保留上一局筹码
      const prevChips = (room.gameType === 'poker' && room.gameInstance)
        ? room.gameInstance.players.map(p => ({ id: p.id, chips: p.chips }))
        : [];

      if (room.gameType === 'card') {
        room.gameInstance = new CardGameEngine(players, sendToPlayer);
      } else if (room.gameType === 'poker') {
        room.gameInstance = new TexasHoldemEngine(players, sendToPlayer);
        room.gameInstance.players.forEach(p => {
          const found = prevChips.find(c => c.id === p.id);
          if (found) p.chips = found.chips;
        });
      }
      room.gameInstance.start();

      // 给所有人标记 gameIndex
      room.players.forEach((uid, i) => {
        for (const [, u] of users) {
          if (u.id === uid) u.gameIndex = i;
        }
      });

      broadcastRoom(room.id, { event: 'gameStarted', roomId: room.id, gameType: room.gameType });
      return;
    }

    /* ---------- 返回房间（原再来一局） ---------- */
    if (msg.type === 'backToRoom') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '房间不存在' }); return; }
      // 如果房间已经重置，直接返回状态
      if (room.status === 'waiting' && !room.gameInstance) {
        send(ws, buildRoomState(room));
        return;
      }
      if (room.status !== 'playing' || !room.gameInstance || !room.gameInstance.ended) {
        send(ws, { event: 'error', msg: '游戏未结束' }); return;
      }
      // 德州扑克不清除 engine 以保留筹码，其他游戏销毁
      if (room.gameType !== 'poker') {
        room.gameInstance = null;
      }
      room.status = 'waiting';
      room.ready.clear();
      room.players.forEach(uid => {
        for (const [, u] of users) { if (u.id === uid) u.gameIndex = -1; }
      });
      broadcastRoom(room.id, buildRoomState(room));
      return;
    }

    /* ---------- 继续下一局（投票制） ---------- */
    if (msg.type === 'nextRound') {
      const room = rooms.get(user.roomId);
      if (!room || !room.gameInstance) return;
      if (room.gameType !== 'poker') return;
      if (!room.gameInstance.ended) return;
      if (!room.players.includes(user.id)) return;

      room.nextRoundReady.add(user.id);
      if (room.players.every(uid => room.nextRoundReady.has(uid))) {
        room.nextRoundReady.clear();
        room.gameInstance.start();
      } else {
        broadcastRoom(room.id, {
          event: 'roundWait',
          ready: room.nextRoundReady.size,
          total: room.players.length
        });
      }
      return;
    }

    /* ---------- 结束对局（房主专用） ---------- */
    if (msg.type === 'endGame') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '房间不存在' }); return; }
      if (room.ownerId !== user.id) { send(ws, { event: 'error', msg: '只有房主可以结束对局' }); return; }
      if (room.status !== 'playing' || !room.gameInstance) { send(ws, { event: 'error', msg: '游戏未在进行中' }); return; }

      // 停止引擎（清除定时器）
      if (typeof room.gameInstance.stop === 'function') {
        room.gameInstance.stop();
      }
      room.gameInstance = null;
      room.status = 'waiting';
      room.ready.clear();
      room.players.forEach(uid => {
        for (const [, u] of users) { if (u.id === uid) u.gameIndex = -1; }
      });
      broadcastRoom(room.id, buildRoomState(room));
      return;
    }

    /* ---------- 游戏内消息 ---------- */
    if (msg.type === 'play' || msg.type === 'discard' || msg.type === 'endTurn' || msg.type === 'bet') {
      const room = rooms.get(user.roomId);
      if (!room || !room.gameInstance || room.gameInstance.ended) return;
      const pIdx = room.players.indexOf(user.id);
      if (pIdx === -1) return;
      room.gameInstance.handleMessage(pIdx, JSON.stringify(msg));
      return;
    }
  });

  ws.on('close', () => {
    const user = users.get(ws);
    if (user) {
      if (user.roomId) leaveRoomInternal(user.id);
      users.delete(ws);
      broadcastLobby(buildLobbyState());
    }
  });
});

function leaveRoomInternal(userId) {
  for (const [, u] of users) {
    if (u.id === userId) {
      const room = rooms.get(u.roomId);
      if (!room) { u.roomId = null; return; }
      room.players = room.players.filter(id => id !== userId);
      room.spectators = room.spectators.filter(id => id !== userId);
      room.ready.delete(userId);
      room.nextRoundReady.delete(userId);
      if (room.players.length === 0 && room.spectators.length === 0) {
      room.chat = [];
      rooms.delete(room.id);
      } else {
        if (room.ownerId === userId && room.players.length > 0) room.ownerId = room.players[0];
        broadcastRoom(room.id, buildRoomState(room));
      }
      u.roomId = null; u.gameIndex = -1;
      break;
    }
  }
}

server.listen(PORT, () => console.log('游戏大厅运行在 http://localhost:' + PORT));
