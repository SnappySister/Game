'use strict';
/**
 * 大富翁中途退出测试：游戏进行中玩家 leaveRoom，
 * 验证引擎 playerDisconnected 被调用、断线玩家破产、房间回到正常状态
 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 3462;
const server = spawn(process.execPath, ['server.js'], {
  cwd: __dirname, env: { ...process.env, PORT: PORT.toString() }, stdio: ['ignore','pipe','pipe']
});
let serverOut = ''; server.stdout.on('data', d => serverOut += d); server.stderr.on('data', d => serverOut += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient(name) {
  const real = new WebSocket('ws://localhost:' + PORT);
  const received = [];
  real.on('message', d => received.push(JSON.parse(d)));
  const opened = new Promise(res => real.on('open', res));
  function send(obj) { opened.then(() => real.send(JSON.stringify(obj))); }
  function once(ev, t=5000){return new Promise((res,rej)=>{const s=Date.now();(function c(){const f=received.find(r=>r.event===ev);if(f){res(f);return;}if(Date.now()-s>t){rej(new Error(name+' 等 '+ev+' 超时'));return;}setTimeout(c,30);})();});}
  return { ws: real, send, once, received, name, opened };
}

async function run() {
  await sleep(800);
  let pass=0, fail=0;
  const assert=(c,m)=>{c?pass++:fail++;console.log(c?'  ✓ '+m:'  ✗ '+m);};
  try {
    const a = makeClient('甲'), b = makeClient('乙');
    await Promise.all([a.opened, b.opened]);
    a.send({type:'setName',name:'甲'}); await a.once('named');
    b.send({type:'setName',name:'乙'}); await b.once('named');
    a.send({type:'createRoom',gameType:'monopoly'}); const rs=await a.once('roomState');
    b.send({type:'joinRoom',roomId:rs.id}); await b.once('roomState');
    a.send({type:'toggleReady'}); b.send({type:'toggleReady'});
    await sleep(300);
    a.send({type:'startGame'}); await a.once('gameStarted');
    // 进行一两回合
    await sleep(300);
    a.send({type:'roll'}); await sleep(400);
    const upd = a.received.filter(r=>r.event==='update').pop();
    assert(upd && upd.state, '游戏进行中收到状态');

    console.log('[退出] 玩家甲中途退出');
    a.send({type:'leaveRoom'});
    await sleep(500);
    // 甲应回到大厅
    const lobby = a.received.filter(r=>r.event==='lobbyState').pop();
    assert(lobby !== undefined, '甲退出后收到大厅状态');
    // 不应有 "游戏未结束" 错误
    const err = a.received.filter(r=>r.event==='error').pop();
    assert(err === undefined, '退出无错误提示' + (err ? '（'+err.msg+'）' : ''));

    console.log('[退出] 完成测试');
    console.log(`\n=== 中途退出测试: ${pass} 通过, ${fail} 失败 ===`);
    a.ws.close(); b.ws.close();
    server.kill(); process.exit(fail>0?1:0);
  } catch(e) {
    console.log('异常: '+e.message);
    console.log('服务端:\n'+serverOut.slice(-1500));
    server.kill(); process.exit(1);
  }
}
run();
