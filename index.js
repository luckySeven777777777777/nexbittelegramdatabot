import { Telegraf } from 'telegraf'
import sqlite3 from 'sqlite3'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import XLSX from 'xlsx'
import fs from 'fs'

dayjs.extend(utc)
dayjs.extend(timezone)

const LOCAL_TZ = 'Asia/Yangon'
const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== SQLite (safe for Railway) =====
const db = new sqlite3.Database('./data.db')

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      chat_id INTEGER,
      value TEXT,
      type TEXT,
      first_user INTEGER,
      created_at TEXT,
      count INTEGER DEFAULT 1,
      UNIQUE(chat_id, value, type)
    )
  `)
})

// ===== Utils =====
const extractPhones = t => t.match(/\+?\d{8,15}/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ===== Message Listener =====
bot.on('text', async (ctx) => {
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
    await new Promise(res => {
      db.get(
        `SELECT count FROM records WHERE chat_id=? AND value=? AND type=?`,
        [ctx.chat.id, item.v, item.type],
        (err, row) => {
          if (row) {
            duplicateCount++
            duplicates.push(item.v)
            db.run(
              `UPDATE records SET count=count+1 WHERE chat_id=? AND value=? AND type=?`,
              [ctx.chat.id, item.v, item.type]
            )
          } else {
            db.run(
              `INSERT INTO records (chat_id,value,type,first_user,created_at)
               VALUES (?,?,?,?,?)`,
              [ctx.chat.id, item.v, item.type, ctx.from.id, nowStr]
            )
          }
          res()
        }
      )
    })
  }

  const dayStart = now.startOf('day').format('YYYY-MM-DD HH:mm:ss')
  const monthStart = now.startOf('month').format('YYYY-MM-DD HH:mm:ss')

  const getCount = (sql, params) =>
    new Promise(r => db.get(sql, params, (_, row) => r(row.total)))

  const daily = await getCount(
    `SELECT COUNT(*) total FROM records WHERE chat_id=? AND first_user=? AND created_at>=?`,
    [ctx.chat.id, ctx.from.id, dayStart]
  )

  const monthly = await getCount(
    `SELECT COUNT(*) total FROM records WHERE chat_id=? AND first_user=? AND created_at>=?`,
    [ctx.chat.id, ctx.from.id, monthStart]
  )

  ctx.reply(
`👤 ${ctx.from.first_name || 'User'} (${ctx.from.id})
📝 Duplicate: ${duplicateCount ? `⚠️ ${duplicates.join(' / ')} (${duplicateCount})` : 'None'}
📱 Phone Numbers Today: ${phones.length}
@ Usernames Today: ${mentions.length}
📈 Daily Increase: ${daily}
📊 Monthly Total: ${monthly}
📅 Time: ${nowStr}`
  )
})

// ===== /export admin only =====
bot.command('export', async (ctx) => {
  if (!(await isAdmin(ctx))) {
    return ctx.reply('❌ Only administrators can export data.')
  }

  db.all(`SELECT * FROM records WHERE chat_id=?`, [ctx.chat.id], async (_, rows) => {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'records')
    const file = `export_${Date.now()}.xlsx`
    XLSX.writeFile(wb, file)
    await ctx.replyWithDocument({ source: file })
    fs.unlinkSync(file)
  })
})

bot.launch()
console.log('✅ Bot started (Railway safe)')
