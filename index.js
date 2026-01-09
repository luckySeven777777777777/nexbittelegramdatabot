import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store =====
const store = new Map()

// ===== History store =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

// ===== Logs store (NEW) =====
store.set('LOGS', [])

// ===== Utils =====
const today = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)

function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

// ===== Load history.txt =====
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) {
    console.log('⚠️ history.txt not found, skip preload')
    return
  }

  const text = fs.readFileSync(file, 'utf8')
  const rawPhones = text.match(/[\+]?[\d\-\s]{7,}/g) || []
  const rawUsers = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  const history = store.get('HISTORY')

  rawPhones.forEach(p => {
    const n = normalizePhone(p)
    if (n.length >= 7) history.phones.add(n)
  })

  rawUsers.forEach(u => history.users.add(u.toLowerCase()))

  console.log(
    `📚 History loaded: ${history.phones.size} phones, ${history.users.size} usernames`
  )
}

function getUser(chatId, userId) {
  const key = `${chatId}:${userId}`
  if (!store.has(key)) {
    store.set(key, {
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

const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ===== Message Listener (IGNORE COMMANDS) =====
bot.on('text', async ctx => {
  const text = ctx.message.text

  // ⚠️ 命令不进入统计
  if (text.startsWith('/')) return

  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')
  const logs = store.get('LOGS')

  // ===== Reset day/month =====
  if (data.day !== today()) {
    data.day = today()
    data.phonesDay.clear()
    data.usersDay.clear()
  }

  if (data.month !== month()) {
    data.month = month()
    data.phonesMonth.clear()
    data.usersMonth.clear()
  }

  const phones = extractPhones(text)
  const users = extractMentions(text)

  let dupCount = 0
  let dupList = []

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || data.phonesMonth.has(np)) {
      dupCount++
      dupList.push(np)
    } else {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    if (history.users.has(nu) || data.usersMonth.has(nu)) {
      dupCount++
      dupList.push(nu)
    } else {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      history.users.add(nu)
    }
  })

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Yangon'
  })

  // ===== Save LOG =====
  logs.push({
    date: today(),
    time: now,
    chatId: ctx.chat.id,
    userId: ctx.from.id,
    username: ctx.from.username ? '@' + ctx.from.username : '',
    name: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
    duplicateCount: dupCount,
    duplicateList: dupList.join(', '),
    phoneToday: data.phonesDay.size,
    usernameToday: data.usersDay.size,
    dailyIncrease: data.phonesDay.size + data.usersDay.size,
    monthlyTotal: data.phonesMonth.size + data.usersMonth.size
  })

  const msg =
`👤 User: ${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`

  await ctx.reply(msg)
})

// ===== Export Orders (FIXED & STABLE) =====
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) {
    return ctx.reply('❌ Admin only')
  }

  const args = ctx.message.text.trim().split(/\s+/)
  const arg = args[1] || 'all'

  const logs = store.get('LOGS') || []
  let data = logs

  // 支持：
  // /export
  // /export all
  // /export 2026-01-10
  // /export 2026-01
  if (arg !== 'all') {
    data = logs.filter(l =>
      l.date === arg || l.date.startsWith(arg)
    )
  }

  if (!data.length) {
    return ctx.reply('⚠️ No data to export')
  }

  await ctx.reply('📤 Exporting Excel, please wait...')

  // ===== Build Excel =====
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')

  // ✅ 关键修复：用 Buffer，不落盘
  const buffer = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'buffer'
  })

  await ctx.replyWithDocument({
    source: buffer,
    filename: `orders_${arg}.xlsx`
  })
})

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
