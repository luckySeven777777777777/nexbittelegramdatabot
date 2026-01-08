import { Telegraf } from 'telegraf'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// ===== 本地时区 =====
const LOCAL_TZ = 'Asia/Yangon' // 中国：Asia/Shanghai

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== DB =====
const db = new Database('data.db')

// ===== 表结构 =====
db.prepare(`
CREATE TABLE IF NOT EXISTS records (
  value TEXT,
  type TEXT,
  first_user INTEGER,
  created_at TEXT,
  count INTEGER DEFAULT 1,
  UNIQUE(value, type)
)
`).run()

// ===== 提取 =====
const extractPhones = (text) => text.match(/\+?\d{8,15}/g) || []
const extractMentions = (text) => text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

// ===== 监听 =====
bot.on('text', (ctx) => {
  const text = ctx.message.text || ''
  const phones = extractPhones(text)
  const mentions = extractMentions(text)

  if (!phones.length && !mentions.length) return

  const now = dayjs().tz(LOCAL_TZ)
  const nowStr = now.format('YYYY-MM-DD HH:mm:ss')

  let duplicates = []
  let repeatTimes = 0
  let newlyAdded = 0

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
      newlyAdded++

      db.prepare(
        `INSERT INTO records (value, type, first_user, created_at)
         VALUES (?,?,?,?)`
      ).run(item.v, item.type, ctx.from.id, nowStr)
    }
  }

  // ===== 每日统计 =====
  const dayStart = now.startOf('day').format('YYYY-MM-DD HH:mm:ss')
  const dayEnd = now.endOf('day').format('YYYY-MM-DD HH:mm:ss')

  const dailyCount = db.prepare(`
    SELECT COUNT(*) as total
    FROM records
    WHERE created_at BETWEEN ? AND ?
  `).get(dayStart, dayEnd).total

  // ===== 当月统计 =====
  const monthStart = now.startOf('month').format('YYYY-MM-DD HH:mm:ss')
  const monthEnd = now.endOf('month').format('YYYY-MM-DD HH:mm:ss')

  const monthlyCount = db.prepare(`
    SELECT COUNT(*) as total
    FROM records
    WHERE created_at BETWEEN ? AND ?
  `).get(monthStart, monthEnd).total

  // ===== 回复 =====
  let reply =
`👤 ${ctx.from.first_name || 'Unknown'} (${ctx.from.id})
📝 重复：${duplicates.length ? duplicates.join(' / ') : '无'}
📱 手机号数量：${phones.length}
@ 用户名数量：${mentions.length}
📈 每日增加数量：${dailyCount}
📊 当月总数量：${monthlyCount}
📅 时间：${nowStr}`

  if (repeatTimes > 0) {
    reply += `\n⚠️ 这是您重复了第 ${repeatTimes} 次`
  }

  ctx.reply(reply)
})

// ===== 启动 =====
bot.launch()
console.log('✅ Bot started with daily & monthly stats')
