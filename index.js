import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store =====
const store = new Map()

// ===== Global HISTORY =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

const today = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)

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

// ===== Load history.txt =====
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) return

  const text = fs.readFileSync(file, 'utf8')
  const history = store.get('HISTORY')

  const rawPhones = text.match(/[\+]?[\d\-\s]{7,}/g) || []
  const rawUsers = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  rawPhones.forEach(p => {
    const n = normalizePhone(p)
    if (n.length >= 7) history.phones.add(n)
  })

  rawUsers.forEach(u => history.users.add(u.toLowerCase()))
}

// ===== User store =====
function getUser(chatId, userId, username) {
  const key = `${chatId}:${userId}`

  if (!store.has(key)) {
    store.set(key, {
      userId,
      username: username ? username.toLowerCase() : null,

      day: today(),
      month: month(),

      phonesDay: new Set(),
      usersDay: new Set(),

      phonesMonth: new Set(),
      usersMonth: new Set(),

      // 👇 新增：历史可回溯存储
      history: {} // { 'yyyy-mm-dd': { phones:Set, users:Set } }
    })
  }

  return store.get(key)
}

// ===== Message Listener =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const history = store.get('HISTORY')

  const data = getUser(
    ctx.chat.id,
    ctx.from.id,
    ctx.from.username
  )

  // ===== Reset =====
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

  // ===== Ensure history day =====
  const d = today()
  if (!data.history[d]) {
    data.history[d] = {
      phones: new Set(),
      users: new Set()
    }
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
      data.history[d].phones.add(np)
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
      data.history[d].users.add(nu)
    }
  })

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Yangon'
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

// ===== /history =====
bot.command('history', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const [, userArg, date, format = 'excel'] = ctx.message.text.split(' ')

  if (!userArg || !date) {
    return ctx.reply('Usage:\n/history <userId|@username> <yyyy-mm-dd> <excel|txt>')
  }

  let target

  for (const [, v] of store.entries()) {
    if (!v || !v.history) continue

    if (
      userArg === String(v.userId) ||
      (v.username && userArg.toLowerCase() === '@' + v.username)
    ) {
      target = v
      break
    }
  }

  if (!target || !target.history[date]) {
    return ctx.reply('❌ No data found')
  }

  const rows = []

  target.history[date].phones.forEach(p =>
    rows.push({ type: 'phone', value: p })
  )

  target.history[date].users.forEach(u =>
    rows.push({ type: 'username', value: u })
  )

  if (!rows.length) return ctx.reply('❌ Empty')

  if (format === 'txt') {
    const file = `history_${target.userId}_${date}.txt`
    fs.writeFileSync(
      file,
      rows.map(r => `${r.type}: ${r.value}`).join('\n')
    )
    return ctx.replyWithDocument({ source: file })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'history')

  const file = `history_${target.userId}_${date}.xlsx`
  XLSX.writeFile(wb, file)
  await ctx.replyWithDocument({ source: file })
})

// ===== /export (原样保留) =====
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const rows = []
  for (const [k, v] of store.entries()) {
    if (k === 'HISTORY') continue
    rows.push({
      key: k,
      phones_month: v.phonesMonth.size,
      users_month: v.usersMonth.size
    })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'stats')
  const file = 'export.xlsx'
  XLSX.writeFile(wb, file)
  await ctx.replyWithDocument({ source: file })
})

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
