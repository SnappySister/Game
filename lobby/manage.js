/* 管理脚本 - VIP 手动开通/查询/取消
 * 用法：
 *   node manage.js vip <用户名> <天数>     开通/续费VIP
 *   node manage.js vipstatus <用户名>      查VIP状态
 *   node manage.js unvip <用户名>          取消VIP
 *   node manage.js list                    列出所有VIP用户
 */
const db = require('./db');

const [,, cmd, ...args] = process.argv;

function help() {
  console.log('用法:');
  console.log('  node manage.js vip <用户名> <天数>     开通/续费VIP');
  console.log('  node manage.js vipstatus <用户名>      查VIP状态');
  console.log('  node manage.js unvip <用户名>          取消VIP');
  console.log('  node manage.js list                    列出所有VIP用户');
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
  } else {
    help();
  }
  process.exit(0);
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
