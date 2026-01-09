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

// ===== Daily history log (append only, NEW) =====
store.set('HISTORY_LOG', [])

function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

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

const today = () => new Date().toISOString().slice(0,10)
const month = () => new Date().toISOString().slice(0,7)

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

// ===== Message Listener =====
bot.on('text', async ctx => {

  // ===== IMPORTANT: allow commands to pass through =====
  if (ctx.message.text.startsWith('/')) return

  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')


  // ===== Reset logic =====
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

  // ===== Extract =====
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

  const msg =
`👤 User: ${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`

  await ctx.reply(msg)

// ===== Append history log (FIXED: record per-message data) =====
store.get('HISTORY_LOG').push({
  chatId: ctx.chat.id,
  userId: ctx.from.id,
  username: ctx.from.username || '',
  name: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
  date: today(),
  time: now,

  // ⚠️ 关键修改点在这里
  phones: phones,          // 本条消息提取到的
  users: users,            // 本条消息提取到的

  dailyIncrease: phones.length + users.length,
  monthlyTotal: data.phonesMonth.size + data.usersMonth.size
  })

})

// ===== Export (Admin Only) =====
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

// ===== History Download (Admin Only, NEW) =====
bot.command('history', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const args = ctx.message.text.split(' ').slice(1)
  if (args.length < 2) {
    return ctx.reply('⚠️ Usage:\n/history <userId | @username> <YYYY-MM-DD>')
  }

  const [userKey, date] = args
  const logs = store.get('HISTORY_LOG')

  const filtered = logs.filter(l => {
    const matchUser = userKey.startsWith('@')
      ? `@${l.username}` === userKey
      : String(l.userId) === userKey
    return matchUser && l.date === date
  })

  if (!filtered.length) {
    return ctx.reply('❌ No history found')
  }

  const r = filtered[filtered.length - 1]

  const content =
`📚 HISTORY RECORD
👤 User: ${r.name} (${r.userId}) ${r.username ? '@' + r.username : ''}
📱 PHONES:
${r.phones.join('\n') || 'None'}
👤 USERNAMES:
${r.users.join('\n') || 'None'}
📱 Phone Numbers Today: ${r.phones.length}
@ Username Count Today: ${r.users.length}
📈 Daily Increase: ${r.dailyIncrease}
📊 Monthly Total: ${r.monthlyTotal}
📅 Time: ${r.time}
`

  const filename = `history_${r.userId}_${date}.txt`
  fs.writeFileSync(filename, content, 'utf8')
  await ctx.replyWithDocument({ source: filename })
})

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
