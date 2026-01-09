import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store (Railway safe, simple) =====
const store = new Map()

// ===== History store (global, preload) =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

// ===== Export history store =====
store.set('EXPORT_HISTORY', [])

// ===== Helpers =====
function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

function today() {
  return new Date().toISOString().slice(0,10)
}

function month() {
  return new Date().toISOString().slice(0,7)
}

const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

// ===== Load history.txt once at startup =====
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

// ===== Get or init user data =====
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

// ===== Check admin =====
async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ===== Message Listener =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  // ===== Reset daily/monthly =====
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

  // ===== Extract phones & mentions =====
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

  // ===== Time =====
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  // ===== Reply message =====
  const msg =
`👤 User: ${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`

  await ctx.reply(msg)

  // ===== Export history log =====
  const exportHistory = store.get('EXPORT_HISTORY')
  exportHistory.push({
    chatId: ctx.chat.id,
    userId: ctx.from.id,
    username: ctx.from.username || '',
    duplicateCount: dupCount,
    duplicateList: dupList.join(' | '),
    phonesToday: data.phonesDay.size,
    usersToday: data.usersDay.size,
    dailyIncrease: data.phonesDay.size + data.usersDay.size,
    monthlyTotal: data.phonesMonth.size + data.usersMonth.size,
    date: today(),
    month: month(),
    time: now
  })
})

// ===== Export command =====
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const arg = ctx.message.text.split(' ')[1] || null
  const history = store.get('EXPORT_HISTORY')

  let filtered = history
  if (arg) filtered = history.filter(r => r.date === arg || r.month === arg)

  if (!filtered.length) return ctx.reply('⚠️ No data for selected date')

  const header = [
    'User ID',
    'Username',
    'Duplicate Count',
    'Duplicate List',
    'Phone Numbers Today',
    'Username Count Today',
    'Daily Increase',
    'Monthly Total',
    'Date',
    'Time'
  ]

  const rows = filtered.map(r => [
    r.userId,
    r.username,
    r.duplicateCount,
    r.duplicateList,
    r.phonesToday,
    r.usersToday,
    r.dailyIncrease,
    r.monthlyTotal,
    r.date,
    r.time
  ])

  const csv =
    header.join(',') + '\n' +
    rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')

  const fileName = `export_${arg || 'all'}.csv`
  fs.writeFileSync(fileName, csv)
  await ctx.replyWithDocument({ source: fileName })
})

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
