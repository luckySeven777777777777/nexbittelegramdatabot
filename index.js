import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store (Railway safe) =====
const store = new Map()

// ===== History global =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

const HISTORY_FILE = 'history.txt'

// ===== Utils =====
const today = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)
const normalizePhone = p => p.replace(/\D/g, '')

const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

// ===== Preload history.txt =====
function preloadHistory(file = HISTORY_FILE) {
  if (!fs.existsSync(file)) {
    console.log('⚠️ history.txt not found, skip preload')
    return
  }

  const text = fs.readFileSync(file, 'utf8')
  const history = store.get('HISTORY')

  const phones = text.match(/\b\d{7,15}\b/g) || []
  const users = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  phones.forEach(p => history.phones.add(normalizePhone(p)))
  users.forEach(u => history.users.add(u.toLowerCase()))

  console.log(`📚 History loaded: ${history.phones.size} phones, ${history.users.size} users`)
}

// ===== Per-user store =====
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

// ===== Admin check =====
async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ===== Append to history.txt =====
function appendHistory({ date, chatId, userId, name, value }) {
  const line = `[${date}] | chat:${chatId} | user:${userId} | ${name} | ${value}\n`
  fs.appendFileSync(HISTORY_FILE, line)
}

// ===== Message listener =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

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

  const name =
    `${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || data.phonesMonth.has(np)) {
      dupCount++
      dupList.push(np)
    } else {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)
      appendHistory({
        date: today(),
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        name,
        value: np
      })
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
      appendHistory({
        date: today(),
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        name,
        value: nu
      })
    }
  })

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  await ctx.reply(
`👤 User: ${name} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')}` : 'None'}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`
  )
})

// ===== /history download =====
bot.command('history', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  if (!fs.existsSync(HISTORY_FILE)) {
    return ctx.reply('⚠️ No history file')
  }

  const args = ctx.message.text.split(' ').slice(1)
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a))
  const user = args.find(a => a.startsWith('@'))

  const lines = fs.readFileSync(HISTORY_FILE, 'utf8')
    .split('\n')
    .filter(l => {
      if (date && !l.includes(`[${date}]`)) return false
      if (user && !l.toLowerCase().includes(user.toLowerCase())) return false
      return true
    })

  if (!lines.length) {
    return ctx.reply('⚠️ No matched history')
  }

  const file = `history_${Date.now()}.txt`
  fs.writeFileSync(file, lines.join('\n'))

  await ctx.replyWithDocument({ source: file })
})

// ===== Export XLSX =====
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
