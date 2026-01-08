import { Telegraf } from 'telegraf'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import XLSX from 'xlsx'
import fs from 'fs'

dayjs.extend(utc)
dayjs.extend(timezone)

// ===== Local Timezone =====
const LOCAL_TZ = 'Asia/Yangon' // change if needed

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== Database =====
const db = new Database('data.db')

// ===== Table =====
db.prepare(`
CREATE TABLE IF NOT EXISTS records (
  chat_id INTEGER,
  value TEXT,
  type TEXT,
  first_user INTEGER,
  created_at TEXT,
  count INTEGER DEFAULT 1,
  UNIQUE(chat_id, value, type)
)
`).run()

// ===== Utils =====
const extractPhones = (t) => t.match(/\+?\d{8,15}/g) || []
const extractMentions = (t) => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ===== Main Listener =====
bot.on('text', async (ctx) => {
  if (!ctx.chat || !ctx.from) return

  const text = ctx.message.text || ''
  const phones = extractPhones(text)
  const mentions = extractMentions(text)
  if (!phones.length && !mentions.length) return

  const now = dayjs().tz(LOCAL_TZ)
  const nowStr = now.format('YYYY-MM-DD HH:mm:ss')

  let duplicates = []
  let duplicateCount = 0

  const items = [
    ...phones.map(v => ({ v, type: 'phone' })),
    ...mentions.map(v => ({ v, type: 'mention' }))
  ]

  for (const item of items) {
    const row = db.prepare(`
      SELECT count FROM records
      WHERE chat_id=? AND value=? AND type=?
    `).get(ctx.chat.id, item.v, item.type)

    if (row) {
      duplicateCount++
      duplicates.push(item.v)
      db.prepare(`
        UPDATE records SET count = count + 1
        WHERE chat_id=? AND value=? AND type=?
      `).run(ctx.chat.id, item.v, item.type)
    } else {
      db.prepare(`
        INSERT INTO records
        (chat_id,value,type,first_user,created_at)
        VALUES (?,?,?,?,?)
      `).run(ctx.chat.id, item.v, item.type, ctx.from.id, nowStr)
    }
  }

  // ===== Daily / Monthly (user) =====
  const dayStart = now.startOf('day').format('YYYY-MM-DD HH:mm:ss')
  const monthStart = now.startOf('month').format('YYYY-MM-DD HH:mm:ss')

  const dailyUser = db.prepare(`
    SELECT COUNT(*) total
    FROM records
    WHERE chat_id=? AND first_user=? AND created_at>=?
  `).get(ctx.chat.id, ctx.from.id, dayStart).total

  const monthlyUser = db.prepare(`
    SELECT COUNT(*) total
    FROM records
    WHERE chat_id=? AND first_user=? AND created_at>=?
  `).get(ctx.chat.id, ctx.from.id, monthStart).total

  const dailyPhones = phones.length
  const dailyMentions = mentions.length

  // ===== Reply =====
  let reply =
`👤 ${ctx.from.first_name || 'User'} (${ctx.from.id})
📝 Duplicate: ${
  duplicateCount
    ? `⚠️ ${duplicates.join(' / ')} (${duplicateCount})`
    : 'None'
}
📱 Phone Numbers Today: ${dailyPhones}
@ Usernames Today: ${dailyMentions}
📈 Daily Increase: ${dailyUser}
📊 Monthly Total: ${monthlyUser}
📅 Time: ${nowStr}`

  ctx.reply(reply)
})

// ===== /today =====
bot.command('today', (ctx) => {
  const now = dayjs().tz(LOCAL_TZ)
  const start = now.startOf('day').format('YYYY-MM-DD HH:mm:ss')

  const rows = db.prepare(`
    SELECT type, COUNT(*) c
    FROM records
    WHERE chat_id=? AND first_user=? AND created_at>=?
    GROUP BY type
  `).all(ctx.chat.id, ctx.from.id, start)

  let phone = 0, mention = 0
  rows.forEach(r => r.type === 'phone' ? phone = r.c : mention = r.c)

  ctx.reply(
`📆 Today Statistics
📱 Phone Numbers: ${phone}
@ Usernames: ${mention}
📊 Total: ${phone + mention}`
  )
})

// ===== /month =====
bot.command('month', (ctx) => {
  const now = dayjs().tz(LOCAL_TZ)
  const start = now.startOf('month').format('YYYY-MM-DD HH:mm:ss')

  const rows = db.prepare(`
    SELECT type, COUNT(*) c
    FROM records
    WHERE chat_id=? AND first_user=? AND created_at>=?
    GROUP BY type
  `).all(ctx.chat.id, ctx.from.id, start)

  let phone = 0, mention = 0
  rows.forEach(r => r.type === 'phone' ? phone = r.c : mention = r.c)

  ctx.reply(
`🗓 Monthly Statistics
📱 Phone Numbers: ${phone}
@ Usernames: ${mention}
📊 Total: ${phone + mention}`
  )
})

// ===== /export (admin only) =====
bot.command('export', async (ctx) => {
  if (!(await isAdmin(ctx))) {
    return ctx.reply('❌ Only administrators can export data.')
  }

  const rows = db.prepare(`
    SELECT chat_id,value,type,first_user,created_at,count
    FROM records
    WHERE chat_id=?
  `).all(ctx.chat.id)

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'records')

  const file = `export_${ctx.chat.id}_${Date.now()}.xlsx`
  XLSX.writeFile(wb, file)

  await ctx.replyWithDocument({ source: file })
  fs.unlinkSync(file)
})

// ===== Start =====
bot.launch()
console.log('✅ Bot started (final version)')
