import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'
import Papa from 'papaparse'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ================= Store =================
const store = new Map()

store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

store.set('LOGS', []) // 👈 CSV 明细日志

// ================= Utils =================
const today = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)

function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

// ================= History preload =================
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) return

  const text = fs.readFileSync(file, 'utf8')
  const history = store.get('HISTORY')

  extractPhones(text).forEach(p =>
    history.phones.add(normalizePhone(p))
  )

  extractMentions(text).forEach(u =>
    history.users.add(u.toLowerCase())
  )
}

// ================= User =================
function getUser(chatId, user) {
  const key = `${chatId}:${user.id}`
  if (!store.has(key)) {
    store.set(key, {
      chatId,
      userId: user.id,
      name:
        `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      day: today(),
      month: month(),
      phonesDay: new Set(),
      usersDay: new Set(),
      phonesMonth: new Set(),
      usersMonth: new Set()
    })
  }
  return store.get(key)
}

// ================= Admin =================
async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ================= Message Listener =================
bot.on('text', async ctx => {
  const text = ctx.message.text
  const user = getUser(ctx.chat.id, ctx.from)
  const history = store.get('HISTORY')

  if (user.day !== today()) {
    user.day = today()
    user.phonesDay.clear()
    user.usersDay.clear()
  }

  if (user.month !== month()) {
    user.month = month()
    user.phonesMonth.clear()
    user.usersMonth.clear()
  }

  let dupCount = 0
  let dupList = []

  extractPhones(text).forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || user.phonesMonth.has(np)) {
      dupCount++
      dupList.push(np)
    } else {
      user.phonesDay.add(np)
      user.phonesMonth.add(np)
      history.phones.add(np)
    }
  })

  extractMentions(text).forEach(u => {
    const nu = u.toLowerCase()
    if (history.users.has(nu) || user.usersMonth.has(nu)) {
      dupCount++
      dupList.push(nu)
    } else {
      user.usersDay.add(nu)
      user.usersMonth.add(nu)
      history.users.add(nu)
    }
  })

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Yangon'
  })

  // ===== 记录 CSV 明细 =====
  store.get('LOGS').push({
    user_name: user.name,
    user_id: user.userId,
    chat_id: user.chatId,
    duplicate_count: dupCount,
    duplicate_list: dupList.join(' | '),
    phone_today: user.phonesDay.size,
    username_today: user.usersDay.size,
    daily_increase: user.phonesDay.size + user.usersDay.size,
    monthly_total: user.phonesMonth.size + user.usersMonth.size,
    time: now,
    date: today(),
    month: month()
  })

  // ===== Reply =====
  await ctx.reply(
`👤 User: ${user.name} ${user.userId}
📝 Duplicate: ${dupCount ? dupList.join(', ') : 'None'}
📱 Phone Numbers Today: ${user.phonesDay.size}
@ Username Count Today: ${user.usersDay.size}
📈 Daily Increase: ${user.phonesDay.size + user.usersDay.size}
📊 Monthly Total: ${user.phonesMonth.size + user.usersMonth.size}
📅 Time: ${now}`
  )
})

// ================= Export =================
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const args = ctx.message.text.split(' ')
  const logs = store.get('LOGS')

  const mode = args.includes('today')
    ? 'today'
    : args.includes('month')
    ? 'month'
    : 'all'

  const csvOnly = args.includes('csv')

  const filtered = logs.filter(r =>
    mode === 'today'
      ? r.date === today()
      : mode === 'month'
      ? r.month === month()
      : true
  )

  if (csvOnly) {
    const csv = Papa.unparse(filtered)
    fs.writeFileSync('export.csv', csv)
    return ctx.replyWithDocument({ source: 'export.csv' })
  }

  const ws = XLSX.utils.json_to_sheet(filtered)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'logs')
  XLSX.writeFile(wb, 'export.xlsx')

  await ctx.replyWithDocument({ source: 'export.xlsx' })
})

// ================= Start =================
preloadHistory()
bot.launch()
console.log('✅ Bot running')
