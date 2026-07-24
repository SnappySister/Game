/* 管理脚本 - VIP/战绩/管理员管理
 * 用法：
 *   node manage.js vip <用户名> <天数>     开通/续费VIP
 *   node manage.js vipstatus <用户名>      查VIP状态
 *   node manage.js unvip <用户名>          取消VIP
 *   node manage.js list                    列出所有VIP用户
 *   node manage.js resetstats              清空所有战绩和排行榜(elo归1000)
 *   node manage.js admin <用户名>          设置管理员
 *   node manage.js unadmin <用户名>        取消管理员
 */
const db = require('./db');

const [,, cmd, ...args] = process.argv;

function help() {
  console.log('用法:');
  console.log('  node manage.js vip <用户名> <天数>     开通/续费VIP');
  console.log('  node manage.js vipstatus <用户名>      查VIP状态');
  console.log('  node manage.js unvip <用户名>          取消VIP');
  console.log('  node manage.js list                    列出所有VIP用户');
  console.log('  node manage.js resetstats              清空所有战绩和排行榜');
  console.log('  node manage.js admin <用户名>          设置管理员');
  console.log('  node manage.js unadmin <用户名>        取消管理员');
}

async function main() {
  if (cmd === 'vip') {
    const [username, daysStr] = args;
    if (!username || !daysStr) { help(); process.exit(1); }
    const days = parseInt(daysStr);
    if (!days || days <= 0) { console.log('天数必须是正整数'); process.exit(1); }
    const acc = db.getAccountByUsername(username);
    if (!acc) { console.log(`用户 "${username}" 不存在`); process.exit(1); }
    const updated = db.setVip(acc.id, days);
    const vip = db.getVipStatus(acc.id);
    const expireDate = new Date(vip.expire).toLocaleString('zh-CN');
    console.log(`✓ ${username} (${acc.nickname}) VIP已开通/续费 ${days} 天`);
    console.log(`  到期时间: ${expireDate}`);
    console.log(`  当前状态: level=${vip.level} active=${vip.active}`);
  } else if (cmd === 'vipstatus') {
    const [username] = args;
    if (!username) { help(); process.exit(1); }
    const acc = db.getAccountByUsername(username);
    if (!acc) { console.log(`用户 "${username}" 不存在`); process.exit(1); }
    const vip = db.getVipStatus(acc.id);
    console.log(`用户: ${username} (${acc.nickname})`);
    console.log(`VIP等级: ${vip.level}`);
    console.log(`状态: ${vip.active ? '✓ 有效' : '✗ 无效'}`);
    if (vip.expire > 0) {
      const expireDate = new Date(vip.expire).toLocaleString('zh-CN');
      const remain = Math.max(0, Math.ceil((vip.expire - Date.now()) / 86400000));
      console.log(`到期: ${expireDate} (剩余${remain}天)`);
    }
  } else if (cmd === 'unvip') {
    const [username] = args;
    if (!username) { help(); process.exit(1); }
    const acc = db.getAccountByUsername(username);
    if (!acc) { console.log(`用户 "${username}" 不存在`); process.exit(1); }
    db.clearVip(acc.id);
    console.log(`✓ ${username} (${acc.nickname}) VIP已取消`);
  } else if (cmd === 'list') {
    const vips = db.db.prepare('SELECT username, nickname, vip_level, vip_expire FROM accounts WHERE vip_level > 0 ORDER BY vip_expire DESC').all();
    if (vips.length === 0) { console.log('暂无VIP用户'); }
    else {
      console.log(`VIP用户共 ${vips.length} 个:`);
      vips.forEach(v => {
        const remain = Math.max(0, Math.ceil((v.vip_expire - Date.now()) / 86400000));
        const active = v.vip_expire > Date.now();
        console.log(`  ${v.username} (${v.nickname}) - ${active ? '有效' : '已过期'} 剩余${remain}天`);
      });
    }
  } else if (cmd === 'resetstats') {
    const records = db.db.prepare('SELECT COUNT(*) as c FROM records').get().c;
    db.db.exec('DELETE FROM records');
    db.db.exec("UPDATE accounts SET elo = 1000, wins = 0, losses = 0, draws = 0");
    console.log(`✓ 已清空 ${records} 条战绩记录`);
    console.log('  所有账号 elo 重置为 1000，胜负场归 0');
    console.log('  排行榜已清空');
  } else if (cmd === 'admin') {
    const [username] = args;
    if (!username) { help(); process.exit(1); }
    const acc = db.getAccountByUsername(username);
    if (!acc) { console.log(`用户 "${username}" 不存在`); process.exit(1); }
    db.setAdmin(acc.id, true);
    console.log(`✓ ${username} (${acc.nickname}) 已设为管理员`);
  } else if (cmd === 'unadmin') {
    const [username] = args;
    if (!username) { help(); process.exit(1); }
    const acc = db.getAccountByUsername(username);
    if (!acc) { console.log(`用户 "${username}" 不存在`); process.exit(1); }
    db.setAdmin(acc.id, false);
    console.log(`✓ ${username} (${acc.nickname}) 已取消管理员`);
  } else {
    help();
  }
  process.exit(0);
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
