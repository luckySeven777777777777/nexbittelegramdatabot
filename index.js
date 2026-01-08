
import { Telegraf } from 'telegraf';
import Database from 'better-sqlite3';
import dayjs from 'dayjs';

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Database('data.db');

db.prepare(`
CREATE TABLE IF NOT EXISTS records (
  value TEXT,
  type TEXT,
  user_id INTEGER,
  count INTEGER DEFAULT 1
)
`).run();

function extractPhones(text) {
  return text.match(/\+?\d{8,15}/g) || [];
}

function extractMentions(text) {
  return text.match(/@[a-zA-Z0-9_]{3,32}/g) || [];
}

bot.on('text', (ctx) => {
  const text = ctx.message.text;
  const phones = extractPhones(text);
  const mentions = extractMentions(text);

  if (phones.length === 0 && mentions.length === 0) return;

  let duplicates = [];
  let dupCount = 0;

  [...phones.map(v => ({v, t:'phone'})), ...mentions.map(v => ({v, t:'mention'}))]
    .forEach(({v, t}) => {
      const row = db.prepare(
        'SELECT count FROM records WHERE value=? AND type=?'
      ).get(v, t);

      if (row) {
        dupCount += 1;
        duplicates.push(v);
        db.prepare(
          'UPDATE records SET count=count+1 WHERE value=? AND type=?'
        ).run(v, t);
      } else {
        db.prepare(
          'INSERT INTO records (value, type, user_id) VALUES (?,?,?)'
        ).run(v, t, ctx.from.id);
      }
    });

  const timeStr = dayjs().format('YYYY-MM-DD HH:mm:ss');

  let msg = `👤 ${ctx.from.first_name || ''} (${ctx.from.id})\n` +
            `📝 重复：${duplicates.join(' / ') || '无'}\n` +
            `📱 手机号数量：${phones.length}\n` +
            `@ 用户名数量：${mentions.length}\n` +
            `📅 时间：${timeStr}`;

  if (dupCount > 0) {
    msg += `\n⚠️ 这是您重复了第 ${dupCount} 次`;
  }

  ctx.reply(msg);
});

bot.launch();
console.log('Bot started');
