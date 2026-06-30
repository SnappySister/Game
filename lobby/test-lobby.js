const WebSocket = require('ws');

const URL = 'ws://localhost:3456';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const messages = [];
    ws.on('open', () => {
      console.log(`[${name}] 连接成功`);
      resolve({ ws, messages });
    });
    ws.on('message', (data) => {
      const d = JSON.parse(data);
      messages.push(d);
      console.log(`[${name}] ← ${JSON.stringify(d).slice(0, 200)}`);
    });
    ws.on('error', (e) => reject(e));
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function findMsg(messages, eventName) {
  return messages.find(m => m.event === eventName);
}

async function main() {
  const A = await connect('玩家A');
  const B = await connect('玩家B');

  // A 登录
  send(A.ws, { type: 'setName', name: '玩家A' });
  await delay(300);
  console.log('玩家A named:', !!findMsg(A.messages, 'named'));
  console.log('玩家A lobbyState:', !!findMsg(A.messages, 'lobbyState'));

  // B 登录
  send(B.ws, { type: 'setName', name: '玩家B' });
  await delay(300);
  console.log('玩家B named:', !!findMsg(B.messages, 'named'));

  // A 进入卡牌游戏列表
  A.messages.length = 0;
  send(A.ws, { type: 'enterGameList', gameType: 'card' });
  await delay(200);
  console.log('A roomList:', !!findMsg(A.messages, 'roomList'));

  // A 创建房间
  A.messages.length = 0;
  send(A.ws, { type: 'createRoom', gameType: 'card', name: '测试房' });
  await delay(300);
  const roomStateA = findMsg(A.messages, 'roomState');
  console.log('A 创建房间:', !!roomStateA, '房间名:', roomStateA?.name);
  const roomId = roomStateA?.id;

  // B 进入卡牌列表，应看到房间
  B.messages.length = 0;
  send(B.ws, { type: 'enterGameList', gameType: 'card' });
  await delay(200);
  const roomListB = findMsg(B.messages, 'roomList');
  console.log('B 看到房间列表:', roomListB?.rooms?.length > 0);

  // B 加入房间
  B.messages.length = 0;
  send(B.ws, { type: 'joinRoom', roomId });
  await delay(300);
  const roomStateB = findMsg(B.messages, 'roomState');
  console.log('B 加入房间:', !!roomStateB, ' players:', roomStateB?.players?.map(p=>p.name));

  // A 应收到更新的房间状态（B加入）
  await delay(200);
  console.log('A 收到 roomState 更新:', A.messages.some(m => m.event === 'roomState' && m.players?.length === 2));

  // 准备
  send(A.ws, { type: 'toggleReady' });
  send(B.ws, { type: 'toggleReady' });
  await delay(300);

  // A 开始游戏
  A.messages.length = 0;
  B.messages.length = 0;
  send(A.ws, { type: 'startGame' });
  await delay(500);
  console.log('A gameStarted:', !!findMsg(A.messages, 'gameStarted'));
  console.log('B gameStarted:', !!findMsg(B.messages, 'gameStarted'));

  // 检查游戏状态
  const updateA = findMsg(A.messages, 'update');
  const updateB = findMsg(B.messages, 'update');
  console.log('A 收到 game state:', !!updateA, 'players:', updateA?.state?.players?.map(p=>p.name));
  console.log('B 收到 game state:', !!updateB, 'players:', updateB?.state?.players?.map(p=>p.name));

  // 检查手牌
  const handA = A.messages.find(m => m.myHand != null);
  const handB = B.messages.find(m => m.myHand != null);
  console.log('A 手牌数:', handA?.myHand?.length);
  console.log('B 手牌数:', handB?.myHand?.length);

  // 测试聊天
  A.messages.length = 0;
  B.messages.length = 0;
  send(A.ws, { type: 'chat', scope: 'room', text: '你好B' });
  await delay(200);
  console.log('B 收到房间聊天:', B.messages.some(m => m.event === 'chat' && m.text === '你好B'));

  A.ws.close();
  B.ws.close();
  console.log('\n✅ 测试结束');
}

main().catch((e) => { console.error(e); process.exit(1); });
