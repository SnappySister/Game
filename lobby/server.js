const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CardGameEngine = require('./games/card-game');
const TexasHoldemEngine = require('./games/texas-holdem');
const SichuanMahjongEngine = require('./games/sichuan-mahjong');
const MonopolyEngine = require('./games/monopoly');
const { VERSION } = require('./public/version');
const config = require('./config');
const db = require('./db');
const bcrypt = require('bcrypt');

const PORT = config.PORT;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

/* ==================== 日志系统 ==================== */
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logTime() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}

function logFileName() {
  const d = new Date();
  return `server-${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}.log`;
}

function writeLog(level, text) {
  const line = `[${logTime()}] [${level}] ${text}\n`;
  console.log(line.trim());
  try {
    fs.appendFileSync(path.join(LOG_DIR, logFileName()), line);
  } catch (e) {
    console.error('日志写入失败:', e.message);
  }
}

const log = {
  info:  (text) => writeLog('INFO', text),
  warn:  (text) => writeLog('WARN', text),
  error: (text) => writeLog('ERROR', text),
  debug: (text) => writeLog('DEBUG', text),
};

/* ==================== 数据模型 ==================== */
const users = new Map();       // ws -> { id, name, state, roomId, gameIndex }
const rooms = new Map();       // roomId -> Room
const pendingReconnects = new Map(); // userId -> { user, roomId, gameIndex, timer, disconnectAt } 断线待重连会话
const RECONNECT_GRACE_MS = config.RECONNECT_GRACE_MS;  // 断线宽限期(默认120秒)
const RECONNECT_GAMES = new Set(['mahjong', 'card']); // 支持断线重连的游戏
let lobbyChat = [];            // {name, text, time}
let nextUserId = 1;            // 游客临时id自增(注册用户用数据库account.id)
let nextRoomId = 1;
const registerAttempts = new Map(); // ip -> [时间戳...] 注册频率限制
const REGISTER_LIMIT = 3;     // 每分钟最多3次注册
const REGISTER_WINDOW_MS = 60000;

// 启动时清理过期会话
db.cleanExpiredSessions();

const GAMES = [
  { id: 'card',   name: '卡牌对战',   desc: '双人回合制卡牌对战', minPlayers: 2, maxPlayers: 2, available: true },
  { id: 'poker',  name: '德州扑克',   desc: '多人德州扑克（2-6人）', minPlayers: 2, maxPlayers: 6, available: true },
  { id: 'mahjong', name: '四川麻将',  desc: '血战到底（2-4人）', minPlayers: 2, maxPlayers: 4, available: true },
  { id: 'monopoly', name: '大富翁',    desc: '买地建房收租（2-4人）', minPlayers: 2, maxPlayers: 4, available: true },
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
    else {
      const ext = path.extname(p);
      const headers = { 'Content-Type': MIME[ext] || 'text/plain' };
      if (ext === '.png' || ext === '.jpg' || ext === '.webp' || ext === '.gif') {
        // 图片长缓存：消除牌面重建闪烁，改图会升版本号触发刷新
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      } else {
        // HTML/JS/CSS 不缓存：确保玩家拿到最新前端(版本号校验有效)
        headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
      }
      res.writeHead(200, headers);
      res.end(data);
    }
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
    // 所有已登录用户都算在线(含大厅/房间/游戏内)，断开的已从 users 删除
    const entry = { name: u.name, state: u.state };
    if (u.roomId) {
      const room = rooms.get(u.roomId);
      if (room) {
        const game = GAMES.find(g => g.id === room.gameType);
        entry.gameType = room.gameType;
        entry.gameName = game ? game.name : room.gameType;
        entry.roomId = room.id;
        entry.roomName = room.name;
        entry.roomStatus = room.status;  // waiting/playing
        entry.playerCount = room.players.length;
        entry.maxPlayers = room.maxPlayers;
        // 是否观战(不在 players 列表里即在观战)
        entry.isSpectator = !room.players.includes(u.id);
        // 一键加入: 等待中且未满的房间；游戏进行中可观战。
        // 注意: 此数据广播给所有大厅玩家，"能否加入"只取决于房间状态，
        // 不取决于被显示的玩家(看列表的人都在大厅，不会在该房间里)。
        entry.canJoin = room.status === 'waiting' && room.players.length < room.maxPlayers;
        entry.canSpectate = room.status === 'playing';
      }
    }
    online.push(entry);
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
  // 查找玩家信息：优先 users，其次 pendingReconnects(断线待重连)，并标记 reconnecting
  const findUserInfo = (uid) => {
    for (const [, u] of users) if (u.id === uid) return { name: u.name, id: u.id, reconnecting: false };
    const pr = pendingReconnects.get(uid);
    if (pr) return { name: pr.user.name, id: uid, reconnecting: true };
    return { name: '?', id: uid, reconnecting: false };
  };
  const pNames = room.players.map(findUserInfo);
  const sNames = room.spectators.map(findUserInfo);
  const allReady = room.players.length > 0 && room.players.every(uid => room.ready.has(uid));
  return {
    event: 'roomState', id: room.id, name: room.name, gameType: room.gameType, players: pNames, spectators: sNames,
    status: room.status, chat: room.chat.slice(-30), ready: [...room.ready], allReady, ownerId: room.ownerId,
    characterSelections: room.characterSelections || {},
    characters: CardGameEngine.CHARACTERS
  };
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

wss.on('connection', (ws, req) => {
  ws._ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  log.info(`WebSocket 连接建立，当前在线 ${users.size + 1}`);
  send(ws, { event: 'connected', serverVersion: VERSION });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { log.warn(`收到非法 JSON: ${raw.slice(0,200)}`); return; }
    const user = users.get(ws);

    /* ---------- 心跳 ---------- */
    if (msg.type === 'ping') { send(ws, { event: 'pong' }); return; }

    /* ---------- 登录/注册/游客 ---------- */
    if (msg.type === 'setName') {
      // 版本校验：客户端版本与服务端不一致时记录日志并提示更新（不强制断开，避免误伤）
      if (msg.clientVersion && msg.clientVersion !== VERSION) {
        log.warn(`版本不匹配: 客户端=${msg.clientVersion} 服务端=${VERSION} 用户=${(msg.name||'').trim()}`);
        send(ws, { event: 'versionMismatch', client: msg.clientVersion, server: VERSION });
      }
      // 断线重连识别：带 userId 且在宽限期内，恢复原游戏会话(游客/注册用户都适用)
      if (msg.reconnect && msg.userId != null && pendingReconnects.has(msg.userId)) {
        const pr = pendingReconnects.get(msg.userId);
        pendingReconnects.delete(msg.userId);
        clearTimeout(pr.timer);
        const room = rooms.get(pr.roomId);
        if (room && room.gameInstance && room.status === 'playing' && room.players.includes(pr.user.id)) {
          const playerIdx = room.gameInstance.players.findIndex(p => p.id === pr.user.id);
          pr.user.state = 'playing';
          users.set(ws, pr.user);
          send(ws, { event: 'named', name: pr.user.name, userId: pr.user.id, token: pr.user.token || null, isGuest: !!pr.user.isGuest });
          send(ws, { event: 'reconnected', roomId: room.id, gameType: room.gameType });
          send(ws, buildRoomState(room));
          send(ws, { event: 'gameStarted', roomId: room.id, gameType: room.gameType });
          if (playerIdx >= 0 && typeof room.gameInstance.playerReconnected === 'function') {
            room.gameInstance.playerReconnected(playerIdx);
          }
          broadcastRoom(room.id, buildRoomState(room));
          broadcastLobby(buildLobbyState());
          log.info(`用户 ${pr.user.name} 重连成功 (uid=${pr.user.id})`);
          return;
        }
        pr.user.roomId = null; pr.user.gameIndex = -1;
        log.info(`用户 ${pr.user.name} 重连时房间已不在，转为普通登录`);
      }

      // 注册用户 token 恢复：reconnect 带 token 且 pendingReconnects 没命中(服务重启后/刷新超时)
      // 用 token 验证身份恢复 user，不需要重新输密码
      if (msg.reconnect && msg.token && !msg.isGuest) {
        const acc = db.verifySession(msg.token);
        if (acc) {
          kickExistingSessions(acc.id, ws);  // 后登踢先登(极端情况)
          const userObj = { id: acc.id, name: acc.nickname, state: 'lobby', roomId: null, gameIndex: -1, isGuest: false, accountId: acc.id, token: msg.token };
          users.set(ws, userObj);
          send(ws, { event: 'named', name: acc.nickname, userId: acc.id, token: msg.token, isGuest: false });
          send(ws, buildLobbyState());
          send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
          broadcastLobby(buildLobbyState());
          log.info(`用户 ${acc.nickname} token重连成功 (uid=${acc.id})`);
          return;
        }
        // token 失效：通知前端清session回登录页，不自动当游客
        send(ws, { event: 'reconnectFailed', reason: '登录已过期，请重新登录' });
        return;
      }

      // reconnect 请求但既无 token(游客超时)：通知前端回登录页
      if (msg.reconnect) {
        send(ws, { event: 'reconnectFailed', reason: '连接已过期，请重新进入' });
        return;
      }

      // 按 mode 分流：guest(游客) / register(注册) / login(登录)
      const mode = msg.mode || 'guest';

      if (mode === 'register') {
        const username = (msg.username || '').trim();
        const password = msg.password || '';
        const nickname = (msg.nickname || '').trim().slice(0, 12) || username;
        if (!username || !password) { send(ws, { event: 'error', msg: '用户名和密码不能为空' }); return; }
        if (username.length > 20 || password.length < 6) { send(ws, { event: 'error', msg: '密码至少6位，用户名不超过20字' }); return; }
        if (!checkRegisterLimit(ws._ip)) { send(ws, { event: 'error', msg: '注册太频繁，请稍后再试' }); return; }
        try {
          const acc = db.createAccount(username, password, nickname);
          const token = db.createSession(acc.id);
          kickExistingSessions(acc.id, ws);  // 后登踢先登(极少见，刚注册就重复)
          const userObj = { id: acc.id, name: nickname, state: 'lobby', roomId: null, gameIndex: -1, isGuest: false, accountId: acc.id, token };
          users.set(ws, userObj);
          send(ws, { event: 'named', name: nickname, userId: acc.id, token, isGuest: false });
          send(ws, buildLobbyState());
          send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
          broadcastLobby(buildLobbyState());
          log.info(`用户注册: ${username} -> uid=${acc.id}`);
        } catch (e) {
          if (e.message === 'USERNAME_EXISTS') send(ws, { event: 'error', msg: '用户名已存在' });
          else { log.error(`注册异常: ${e.message}`); send(ws, { event: 'error', msg: '注册失败' }); }
        }
        return;
      }

      if (mode === 'login') {
        const username = (msg.username || '').trim();
        const password = msg.password || '';
        const acc = db.verifyAccount(username, password);
        if (!acc) { send(ws, { event: 'error', msg: '用户名或密码错误' }); return; }
        const token = db.createSession(acc.id);
        kickExistingSessions(acc.id, ws);  // 后登踢先登
        const userObj = { id: acc.id, name: acc.nickname, state: 'lobby', roomId: null, gameIndex: -1, isGuest: false, accountId: acc.id, token };
        users.set(ws, userObj);
        send(ws, { event: 'named', name: acc.nickname, userId: acc.id, token, isGuest: false });
        send(ws, buildLobbyState());
        send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
        broadcastLobby(buildLobbyState());
        log.info(`用户登录: ${username} -> uid=${acc.id}`);
        return;
      }

      // mode === 'guest'（游客）：原逻辑，分配临时 id
      const name = (msg.name || '').trim().slice(0, 12) || '匿名';
      const id = nextUserId++;
      const userObj = { id, name, state: 'lobby', roomId: null, gameIndex: -1, isGuest: true, accountId: null, token: null };
      users.set(ws, userObj);
      send(ws, { event: 'named', name: name, userId: id, token: null, isGuest: true });
      send(ws, buildLobbyState());
      send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
      broadcastLobby(buildLobbyState());
      log.info(`游客登录: ${name} (uid=${id})`);
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
        nextRoundReady: new Set(),
        characterSelections: {}
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
      log.info(`用户 ${user.name} 创建房间 ${rid} (${game.id})`);
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
      broadcastLobby(buildLobbyState());
      log.info(`用户 ${user.name} 加入房间 ${room.id}`);
      return;
    }

    /* ---------- 离开房间 ---------- */
    if (msg.type === 'leaveRoom') {
      if (user.roomId) {
        const rid = user.roomId;
        leaveRoomInternal(user.id);
        user.state = 'lobby';
        user.roomId = null;
        user.gameIndex = -1;
        send(ws, buildLobbyState());
        send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
        broadcastLobby(buildLobbyState());
        log.info(`用户 ${user.name} 离开房间 ${rid}`);
      }
      return;
    }

    /* ---------- 改昵称(仅注册账号) ---------- */
    if (msg.type === 'changeNickname') {
      if (user.isGuest) { send(ws, { event: 'error', msg: '游客不能改昵称，请先注册账号' }); return; }
      const nickname = (msg.nickname || '').trim().slice(0, 12);
      if (!nickname) { send(ws, { event: 'error', msg: '昵称不能为空' }); return; }
      const acc = db.updateNickname(user.accountId, nickname);
      if (!acc) { send(ws, { event: 'error', msg: '账号不存在' }); return; }
      user.name = nickname;  // 更新当前会话的显示名
      send(ws, { event: 'nicknameChanged', nickname });
      broadcastLobby(buildLobbyState());
      log.info(`用户 accountId=${user.accountId} 改昵称为 ${nickname}`);
      return;
    }

    /* ---------- 退出登录 ---------- */
    if (msg.type === 'logout') {
      if (user.token) db.deleteSession(user.token);  // 删服务端会话
      if (user.roomId) leaveRoomInternal(user.id);   // 离开房间(若在)
      users.delete(ws);
      broadcastLobby(buildLobbyState());
      log.info(`用户 ${user.name} 退出登录`);
      try { ws.close(); } catch (e) {}  // 断开连接，前端回登录页
      return;
    }

    /* ---------- 战绩查询(仅注册用户) ---------- */
    if (msg.type === 'getMyStats') {
      if (user.isGuest || !user.accountId) { send(ws, { event: 'error', msg: '游客无战绩，请先注册账号' }); return; }
      const stats = db.getAccountStats(user.accountId);
      send(ws, { event: 'myStats', stats });
      return;
    }
    if (msg.type === 'getLeaderboard') {
      const scope = ['total', 'mahjong', 'card', 'poker', 'monopoly', 'weekly', 'monthly'].includes(msg.scope) ? msg.scope : 'total';
      const list = db.getLeaderboard(scope, 50);
      send(ws, { event: 'leaderboard', scope, list });
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
      broadcastLobby(buildLobbyState());
      log.info(`用户 ${user.name} 观看房间 ${room.id}`);

      // 如果游戏正在进行，发送当前游戏状态
      if (room.status === 'playing' && room.gameInstance) {
        send(ws, { event: 'gameStarted', roomId: room.id, gameType: room.gameType });
        const state = room.gameInstance._statePayload();
        send(ws, { event: 'update', state });
        send(ws, { myHand: [], myIndex: -1, spectator: true });
      }
      return;
    }

    /* ---------- 切换为观战 ---------- */
    if (msg.type === 'becomeSpectator') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '不在房间中' }); return; }
      if (room.status !== 'waiting') { send(ws, { event: 'error', msg: '游戏中不可切换身份' }); return; }
      if (!room.players.includes(user.id)) { send(ws, { event: 'error', msg: '你当前不是玩家' }); return; }
      if (room.ownerId === user.id) { send(ws, { event: 'error', msg: '房主不可切换为观战' }); return; }

      room.players = room.players.filter(id => id !== user.id);
      room.spectators.push(user.id);
      room.ready.delete(user.id);
      broadcastRoom(room.id, buildRoomState(room));
      send(ws, buildRoomState(room));
      log.info(`用户 ${user.name} 切换为观战 (${room.id})`);
      return;
    }

    /* ---------- 切换为玩家 ---------- */
    if (msg.type === 'becomePlayer') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '不在房间中' }); return; }
      if (room.status !== 'waiting') { send(ws, { event: 'error', msg: '游戏中不可切换身份' }); return; }
      if (!room.spectators.includes(user.id)) { send(ws, { event: 'error', msg: '你当前不是观战者' }); return; }
      if (room.players.length >= room.maxPlayers) { send(ws, { event: 'error', msg: '玩家已满' }); return; }

      room.spectators = room.spectators.filter(id => id !== user.id);
      room.players.push(user.id);
      broadcastRoom(room.id, buildRoomState(room));
      send(ws, buildRoomState(room));
      log.info(`用户 ${user.name} 切换为玩家 (${room.id})`);
      return;
    }

    /* ---------- 选择角色（卡牌游戏） ---------- */
    if (msg.type === 'selectCharacter') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '不在房间中' }); return; }
      if (room.gameType !== 'card') { send(ws, { event: 'error', msg: '该游戏不支持角色' }); return; }
      if (!room.players.includes(user.id)) { send(ws, { event: 'error', msg: '你不是玩家' }); return; }
      if (room.status !== 'waiting') { send(ws, { event: 'error', msg: '游戏已开始' }); return; }
      if (room.ready.has(user.id)) { send(ws, { event: 'error', msg: '已准备，取消准备后才能换角色' }); return; }
      const ch = CardGameEngine.CHARACTERS.find(c => c.id === msg.characterId);
      if (!ch) { send(ws, { event: 'error', msg: '角色不存在' }); return; }
      if (!room.characterSelections) room.characterSelections = {};
      room.characterSelections[user.id] = ch.id;
      broadcastRoom(room.id, buildRoomState(room));
      log.info(`用户 ${user.name} 选择角色 ${ch.name} (${room.id})`);
      return;
    }

    /* ---------- 准备/取消准备 ---------- */
    if (msg.type === 'toggleReady') {
      const room = rooms.get(user.roomId);
      if (!room) { send(ws, { event: 'error', msg: '不在房间中' }); return; }
      if (!room.players.includes(user.id)) { send(ws, { event: 'error', msg: '你不是玩家' }); return; }
      const wasReady = room.ready.has(user.id);
      // 卡牌游戏：准备前必须已选角色
      if (!wasReady && room.gameType === 'card') {
        if (!room.characterSelections || !room.characterSelections[user.id]) {
          send(ws, { event: 'error', msg: '请先选择角色' }); return;
        }
      }
      if (wasReady) room.ready.delete(user.id);
      else room.ready.add(user.id);
      broadcastRoom(room.id, buildRoomState(room));
      log.info(`用户 ${user.name} ${wasReady ? '取消准备' : '准备'} (${room.id})`);
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
          if (u.id === uid) {
            const p = { id: uid, name: u.name, ws: ws2, index: i };
            if (room.gameType === 'card') p.character = (room.characterSelections && room.characterSelections[uid]) || null;
            return p;
          }
        }
      }).filter(Boolean);

      const sendToPlayer = wrapSendToPlayer(room, (pIdx, obj) => {
        const uid = room.players[pIdx];
        for (const [ws2, u] of users) {
          if (u.id === uid) { send(ws2, obj); break; }
        }
      });

      // 德州/麻将保留上一局分数
      const prevChips = (room.gameType === 'poker' && room.gameInstance)
        ? room.gameInstance.players.map(p => ({ id: p.id, chips: p.chips }))
        : [];
      const prevMahjongScores = (room.gameType === 'mahjong' && room.gameInstance)
        ? room.gameInstance.players.map(p => p.score)
        : [];
      const prevMonopolyScores = (room.gameType === 'monopoly' && room.gameInstance)
        ? room.gameInstance.players.map(p => p.score)
        : [];

      if (room.gameType === 'card') {
        room.gameInstance = new CardGameEngine(players, sendToPlayer);
      } else if (room.gameType === 'poker') {
        room.gameInstance = new TexasHoldemEngine(players, sendToPlayer);
        room.gameInstance.players.forEach(p => {
          const found = prevChips.find(c => c.id === p.id);
          if (found) p.chips = found.chips;
        });
      } else if (room.gameType === 'mahjong') {
        room.gameInstance = new SichuanMahjongEngine(players, sendToPlayer, prevMahjongScores, (msg) => log.debug(msg));
      } else if (room.gameType === 'monopoly') {
        room.gameInstance = new MonopolyEngine(players, sendToPlayer, prevMonopolyScores, (msg) => log.debug(msg));
      }
      room.gameInstance.start();

      // 给所有人标记 gameIndex
      room.players.forEach((uid, i) => {
        for (const [, u] of users) {
          if (u.id === uid) u.gameIndex = i;
        }
      });

      broadcastRoom(room.id, { event: 'gameStarted', roomId: room.id, gameType: room.gameType });
      log.info(`房间 ${room.id} 游戏开始 (${room.gameType}, ${players.length}人)`);
      return;
    }

    /* ---------- 返回房间（原再来一局） ---------- */
    if (msg.type === 'backToRoom') {
      const room = rooms.get(user.roomId);
      if (!room) {
        user.state = 'lobby';
        user.roomId = null;
        user.gameIndex = -1;
        send(ws, buildLobbyState());
        send(ws, { event: 'chatHistory', scope: 'lobby', messages: lobbyChat });
        return;
      }
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
      log.info(`房间 ${room.id} 游戏结束，返回房间`);
      return;
    }

    /* ---------- 继续下一局（投票制） ---------- */
    if (msg.type === 'nextRound') {
      const room = rooms.get(user.roomId);
      if (!room || !room.gameInstance) return;
      if (!room.gameInstance.ended) return;
      if (!room.players.includes(user.id)) return;

      room.nextRoundReady.add(user.id);
      if (room.players.every(uid => room.nextRoundReady.has(uid))) {
        room.nextRoundReady.clear();

        if (room.players.length < 2) {
          room.gameInstance = null;
          room.status = 'waiting';
          room.ready.clear();
          room.players.forEach(uid => {
            for (const [, u] of users) { if (u.id === uid) u.gameIndex = -1; }
          });
          broadcastRoom(room.id, buildRoomState(room));
          log.info(`房间 ${room.id} 人数不足，返回房间`);
          return;
        }

        // 人数变化时重建引擎，保留分数/筹码
        if (room.players.length !== room.gameInstance.playerCount) {
          const players = room.players.map((uid, i) => {
            for (const [ws2, u] of users) {
              if (u.id === uid) return { id: uid, name: u.name, ws: ws2, index: i };
            }
          }).filter(Boolean);
          const sendToPlayer = wrapSendToPlayer(room, (pIdx, obj) => {
            const uid = room.players[pIdx];
            for (const [ws2, u] of users) {
              if (u.id === uid) { send(ws2, obj); break; }
            }
          });

          if (room.gameType === 'poker') {
            const prevChips = room.gameInstance.players.map(p => ({ id: p.id, chips: p.chips }));
            room.gameInstance = new TexasHoldemEngine(players, sendToPlayer);
            room.gameInstance.players.forEach(p => {
              const found = prevChips.find(c => c.id === p.id);
              if (found) p.chips = found.chips;
            });
          } else if (room.gameType === 'mahjong') {
            const prevScores = room.gameInstance.players.map(p => p.score);
            const prevDealer = room.gameInstance.dealerIndex;
            room.gameInstance = new SichuanMahjongEngine(players, sendToPlayer, prevScores, (msg) => log.debug(msg));
            room.gameInstance.dealerIndex = prevDealer;
          } else if (room.gameType === 'monopoly') {
            const prevScores = room.gameInstance.players.map(p => p.score);
            room.gameInstance = new MonopolyEngine(players, sendToPlayer, prevScores, (msg) => log.debug(msg));
          }
        }

        room._recorded = false;  // 重置战绩标记，新局可重新记录
        room.gameInstance.start();
        room.players.forEach((uid, i) => {
          for (const [, u] of users) {
            if (u.id === uid) u.gameIndex = i;
          }
        });
        log.info(`房间 ${room.id} 下一局开始 (${room.gameType})`);
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

      // 触发引擎结算（发送 over 事件）
      if (room.gameInstance._endGame && !room.gameInstance.ended) {
        room.gameInstance._endGame();
      }

      // 停止引擎（清除定时器）
      if (typeof room.gameInstance.stop === 'function') {
        room.gameInstance.stop();
      }
      clearPendingReconnectsByRoom(room.id); // 游戏被结束，断线玩家不再重连
      room.gameInstance = null;
      room.status = 'waiting';
      room.ready.clear();
      room.players.forEach(uid => {
        for (const [, u] of users) { if (u.id === uid) u.gameIndex = -1; }
      });
      broadcastRoom(room.id, buildRoomState(room));
      log.warn(`房间 ${room.id} 被房主 ${user.name} 强制结束`);
      return;
    }

    /* ---------- 游戏内消息 ---------- */
    if (msg.type === 'play' || msg.type === 'discard' || msg.type === 'endTurn' || msg.type === 'useSkill' || msg.type === 'bet' || msg.type === 'dingque' || msg.type === 'action' || msg.type === 'selfAction' || msg.type === 'exchange' || msg.type === 'roll' || msg.type === 'build' || msg.type === 'sellHouse' || msg.type === 'mortgage' || msg.type === 'redeem' || msg.type === 'useJailCard' || msg.type === 'payBail' || msg.type === 'tradeOffer' || msg.type === 'tradeResolve') {
      const room = rooms.get(user.roomId);
      if (!room) { log.warn(`P${user.gameIndex}(${user.name}) ${msg.type} 拒绝: 不在房间中`); return; }
      if (!room.gameInstance) { log.warn(`P${user.gameIndex}(${user.name}) ${msg.type} 拒绝: 无游戏实例 room=${room.id}`); return; }
      if (room.gameInstance.ended) { log.warn(`P${user.gameIndex}(${user.name}) ${msg.type} 拒绝: 游戏已结束 room=${room.id}`); return; }
      const pIdx = room.players.indexOf(user.id);
      if (pIdx === -1) { log.warn(`${user.name} ${msg.type} 拒绝: 不是玩家 room=${room.id}`); return; }
      log.debug(`房间 ${room.id} 收到 ${msg.type} 消息: 玩家${pIdx}`);
      try {
        room.gameInstance.handleMessage(pIdx, JSON.stringify(msg));
      } catch (e) {
        log.error(`房间 ${room.id} 处理 ${msg.type} 消息异常: ${e.stack || e.message}`);
        send(ws, { event: 'error', msg: '处理消息时发生异常' });
      }
      return;
    }
  });

  ws.on('close', () => {
    const user = users.get(ws);
    if (!user) { log.debug('匿名连接断开'); return; }
    users.delete(ws);
    const wasKicked = !!ws._kicked;  // 被踢(后登踢先登)的连接不进宽限期
    log.info(`用户断开: ${user.name}${wasKicked ? '(被踢)' : ''}`);

    // 被踢或非游戏中：直接离开房间；麻将/卡牌游戏中正常断线进120秒宽限期
    if (user.roomId) {
      const room = rooms.get(user.roomId);
      const canReconnect = !wasKicked && room && room.status === 'playing' && room.gameInstance && RECONNECT_GAMES.has(room.gameType) && room.players.includes(user.id);
      if (canReconnect) {
        const playerIdx = room.gameInstance.players.findIndex(p => p.id === user.id);
        if (playerIdx >= 0) {
          room.gameInstance.playerDisconnected(playerIdx); // 仅暂停(引擎改造后)
          pendingReconnects.set(user.id, {
            user, roomId: user.roomId, gameIndex: user.gameIndex,
            timer: setTimeout(() => onReconnectTimeout(user.id), RECONNECT_GRACE_MS),
            disconnectAt: Date.now()
          });
          log.info(`用户 ${user.name} 游戏中断线，进入${RECONNECT_GRACE_MS/1000}s宽限期`);
          broadcastRoom(room.id, buildRoomState(room));
          broadcastLobby(buildLobbyState());
          return;
        }
      }
      leaveRoomInternal(user.id); // 非游戏中/不支持重连的游戏 → 原逻辑
    }
    broadcastLobby(buildLobbyState());
  });
});

// 断线宽限期超时：真正判负并移出房间
function onReconnectTimeout(userId) {
  const pr = pendingReconnects.get(userId);
  if (!pr) return;
  pendingReconnects.delete(userId);
  const room = rooms.get(pr.roomId);
  if (!room || !room.gameInstance || !room.players.includes(userId)) {
    broadcastLobby(buildLobbyState());
    return;
  }
  const playerIdx = room.gameInstance.players.findIndex(p => p.id === userId);
  if (playerIdx >= 0) {
    log.warn(`用户 ${pr.user.name} ${RECONNECT_GRACE_MS/1000}s未重连，强制判负`);
    // 调用引擎的强制判负(原 playerDisconnected 逻辑)
    if (typeof room.gameInstance.playerForceOut === 'function') room.gameInstance.playerForceOut(playerIdx);
    else room.gameInstance.playerDisconnected(playerIdx);
  }
  leaveRoomInternal(userId);
  broadcastLobby(buildLobbyState());
}

// 清理某房间的所有待重连会话(房间删除/游戏结束时调用)
function clearPendingReconnectsByRoom(roomId) {
  for (const [uid, pr] of pendingReconnects) {
    if (pr.roomId === roomId) {
      clearTimeout(pr.timer);
      pendingReconnects.delete(uid);
    }
  }
}

// 后登踢先登：踢掉同 accountId 的旧连接，发 kicked 事件并标记(不进宽限期)
function kickExistingSessions(accountId, exceptWs) {
  for (const [oldWs, u] of users) {
    if (u.accountId === accountId && oldWs !== exceptWs && oldWs.readyState === 1) {
      oldWs._kicked = true;  // 标记被踢，close 时不走宽限期
      send(oldWs, { event: 'kicked', reason: '账号在其他设备登录' });
      try { oldWs.close(); } catch (e) {}
      log.info(`账号 ${u.name}(accountId=${accountId}) 旧连接被踢(后登踢先登)`);
    }
  }
}

// 注册频率限制：同IP每分钟最多 REGISTER_LIMIT 次
function checkRegisterLimit(ip) {
  if (!ip) return true;
  const now = Date.now();
  const arr = (registerAttempts.get(ip) || []).filter(t => now - t < REGISTER_WINDOW_MS);
  if (arr.length >= REGISTER_LIMIT) return false;
  arr.push(now);
  registerAttempts.set(ip, arr);
  return true;
}

// ELO 按名次加减分：1v1 胜+20负-20；多人局按人数套档位(第1+30/第2+10/第3-10/第4-30)
const ELO_TABLE = {
  2: [20, -20],
  3: [30, 0, -30],
  4: [30, 10, -10, -30]
};
function eloChangeByRank(playerCount, rank) {
  // rank 从1开始；超出表范围的局数(5+)按4人档截断
  const table = ELO_TABLE[Math.min(playerCount, 4)] || ELO_TABLE[4];
  if (playerCount > 4) {
    // 5人以上：第1+30，最后-30，中间按比例线性分布
    if (rank === 1) return 30;
    if (rank === playerCount) return -30;
    const step = 60 / (playerCount - 1);
    return Math.round(30 - step * (rank - 1));
  }
  return table[rank - 1] || 0;
}

// 一局结束写战绩：读 engine.players，按 gameType 算胜负/名次，只记注册用户
function writeMatchRecord(room) {
  const engine = room.gameInstance;
  if (!engine || !engine.players) return;
  const gameType = room.gameType;
  const players = engine.players;
  // 关联 accountId(跳过游客)
  const enriched = players.map(p => {
    let user = null;
    for (const [, u] of users) { if (u.id === p.id) { user = u; break; } }
    return { p, accountId: user && user.accountId };
  }).filter(e => e.accountId);  // 只保留注册用户
  if (enriched.length === 0) return;  // 全员游客，不记

  // 算每人 scoreChange + 胜负 + 名次
  const ranked = enriched.map(e => {
    let scoreChange = 0, metric = 0;
    if (gameType === 'mahjong' || gameType === 'poker') {
      scoreChange = e.p.change || 0;  // 本局分数/筹码变化
      metric = scoreChange;
      // 主动离开/超时判负(disconnected)的玩家强制排最后
      if (e.p.disconnected) metric = -99999;
    } else if (gameType === 'card') {
      scoreChange = e.p.hp > 0 ? 1 : -1;
      metric = e.p.hp;  // hp 高的排前
      if (e.p.disconnected) metric = -99999;
    } else if (gameType === 'monopoly') {
      // p.score 是名次(1..N)，metric 反过来让名次1排前
      metric = -(e.p.score || 99);
      scoreChange = e.p.netWorth || e.p.money || 0;
    }
    return { ...e, scoreChange, metric };
  });
  // 按 metric 降序排名
  ranked.sort((a, b) => b.metric - a.metric);
  ranked.forEach((e, i) => { e.rank = i + 1; });

  // 只有注册用户参与排名(过滤后)，按注册用户数算 elo 档位
  const n = ranked.length;
  for (const e of ranked) {
    // 胜负判定：第1名=win，最后一名=loss，中间=draw(2人局无中间)
    // 例外：disconnected(判负退出)强制 loss
    let result;
    if (e.p.disconnected) {
      result = 'loss';
    } else if (n === 2) {
      result = e.rank === 1 ? 'win' : 'loss';
    } else {
      result = e.rank === 1 ? 'win' : (e.rank === n ? 'loss' : 'draw');
    }
    const eloChange = eloChangeByRank(n, e.rank);
    try {
      db.recordMatch(e.accountId, gameType, result, e.scoreChange, eloChange);
    } catch (err) {
      log.error(`写战绩异常 accountId=${e.accountId}: ${err.message}`);
    }
  }
  log.info(`房间 ${room.id} 战绩已记录(${gameType} ${n}名注册用户)`);
}

// 包装 sendToPlayer：拦截 over 事件，只第一次触发写战绩
function wrapSendToPlayer(room, rawSend) {
  return (pIdx, obj) => {
    if (obj && obj.event === 'over' && !room._recorded) {
      room._recorded = true;
      try { writeMatchRecord(room); } catch (e) { log.error(`writeMatchRecord异常: ${e.stack||e.message}`); }
    }
    rawSend(pIdx, obj);
  };
}

function leaveRoomInternal(userId) {
  let userObj = null;
  let room = null;
  for (const [, u] of users) {
    if (u.id === userId) {
      userObj = u;
      room = rooms.get(u.roomId);
      break;
    }
  }
  if (!room) {
    if (userObj) { userObj.roomId = null; userObj.gameIndex = -1; }
    return;
  }

  // 游戏中：主动离开=判负(playerForceOut触发_endGame记战绩)，断线由ws.on('close)单独处理(宽限期)
  if (room.status === 'playing' && room.gameInstance && room.players.includes(userId)) {
    const playerIdx = room.gameInstance.players.findIndex(p => p.id === userId);
    if (playerIdx >= 0) {
      // 优先用 playerForceOut(判负)，无则回退 playerDisconnected
      if (typeof room.gameInstance.playerForceOut === 'function') room.gameInstance.playerForceOut(playerIdx);
      else room.gameInstance.playerDisconnected(playerIdx);
    }
  }

  room.players = room.players.filter(id => id !== userId);
  room.spectators = room.spectators.filter(id => id !== userId);
  room.ready.delete(userId);
  room.nextRoundReady.delete(userId);
  if (room.characterSelections) delete room.characterSelections[userId];

  if (room.players.length === 0 && room.spectators.length === 0) {
    room.chat = [];
    clearPendingReconnectsByRoom(room.id); // 房间删除，清理待重连会话
    rooms.delete(room.id);
  } else {
    if (room.ownerId === userId && room.players.length > 0) room.ownerId = room.players[0];
    broadcastRoom(room.id, buildRoomState(room));
  }
  if (userObj) { userObj.roomId = null; userObj.gameIndex = -1; }
}

server.listen(PORT, () => console.log(`游戏大厅 v${VERSION} 运行在 http://localhost:${PORT}`));
