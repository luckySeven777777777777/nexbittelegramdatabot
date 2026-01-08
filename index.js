import { Telegraf } from 'telegraf'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// ===== 设置本地时区 =====
// 中国用：Asia/Shanghai
// 缅甸用：Asia/Yangon
const LOCAL_TZ = 'Asia/Yangon'

// ===== Telegram Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== Database =====
const db = new Database('data.db')

// ===== 数据表 =====
db.prepare(`
CREATE TABLE IF NOT EXISTS records (
  value TEXT,
  type TEXT,
  first_user INTEGER,
  count INTEGER DEFAULT 1,
  UNIQUE(value, type)
)
`).run()

// ===== 提取手机号 =====
function extractPhones(text) {
  return text.match(/\+?\d{8,15}/g) || []
}

// ===== 提取 @用户名 =====
function extractMentions(text) {
  return text.match(/@[a-zA-Z0-9_]{3,32}/g) || []
}

// ===== 监听文本 =====
bot.on('text', (ctx) => {
  const text = ctx.message.text || ''
  const phones = extractPhones(text)
  const mentions = extractMentions(text)

  if (phones.length === 0 && mentions.length === 0) return

  let duplicates = []
  let repeatTimes = 0

  const items = [
    ...phones.map(v => ({ v, type: 'phone' })),
    ...mentions.map(v => ({ v, type: 'mention' }))
  ]

  for (const item of items) {
    const row = db
      .prepare('SELECT count FROM records WHERE value=? AND type=?')
      .get(item.v, item.type)

    if (row) {
      repeatTimes++
      duplicates.push(item.v)

      db.prepare(
        'UPDATE records SET count = count + 1 WHERE value=? AND type=?'
      ).run(item.v, item.type)
    } else {
      db.prepare(
        'INSERT INTO records (value, type, first_user) VALUES (?,?,?)'
      ).run(item.v, item.type, ctx.from.id)
    }
  }

  const timeStr = dayjs()
    .tz(LOCAL_TZ)
    .format('YYYY-MM-DD HH:mm:ss')

  let reply =
`👤 ${ctx.from.first_name || 'Unknown'} (${ctx.from.id})
📝 重复：${duplicates.length ? duplicates.join(' / ') : '无'}
📱 手机号数量：${phones.length}
@ 用户名数量：${mentions.length}
📅 时间：${timeStr}`

  if (repeatTimes > 0) {
    reply += `\n⚠️ 这是您重复了第 ${repeatTimes} 次`
  }

  ctx.reply(reply)
})

// ===== 启动 =====
bot.launch()
console.log('✅ Bot started with local timezone:', LOCAL_TZ)
