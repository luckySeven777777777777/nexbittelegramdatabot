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
      phonesDay: new Map(),    // 改为 Map，存日期 => Set
      usersDay: new Map(),
      phonesMonth: new Map(),  // 存每月统计
      usersMonth: new Map()
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
  const text = ctx.message.text
  const userData = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  // ===== Reset logic =====
  const d = today()
  const m = month()

  if (!userData.phonesDay.has(d)) userData.phonesDay.set(d, new Set())
  if (!userData.usersDay.has(d)) userData.usersDay.set(d, new Set())
  if (!userData.phonesMonth.has(m)) userData.phonesMonth.set(m, new Set())
  if (!userData.usersMonth.has(m)) userData.usersMonth.set(m, new Set())

  const phonesToday = userData.phonesDay.get(d)
  const usersToday = userData.usersDay.get(d)
  const phonesMonth = userData.phonesMonth.get(m)
  const usersMonth = userData.usersMonth.get(m)

  // ===== Extract =====
  const phones = extractPhones(text)
  const users = extractMentions(text)

  let dupCount = 0
  let dupList = []

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (
      history.phones.has(np) ||
      phonesMonth.has(np)
    ) {
      dupCount++
      dupList.push(np)
    } else {
      phonesToday.add(np)
      phonesMonth.add(np)
      history.phones.add(np)
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    if (
      history.users.has(nu) ||
      usersMonth.has(nu)
    ) {
      dupCount++
      dupList.push(nu)
    } else {
      usersToday.add(nu)
      usersMonth.add(nu)
      history.users.add(nu)
    }
  })

  // ===== Auto reply =====
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Yangon'
  })

  const msg =
`📚 HISTORY RECORD
👤 User: ${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers Today: ${phonesToday.size}
@ Username Count Today: ${usersToday.size}
📈 Daily Increase: ${phonesToday.size + usersToday.size}
📊 Monthly Total: ${phonesMonth.size + usersMonth.size}
📅 Time: ${now}`

  await ctx.reply(msg)
})

// ===== Export Admin Only =====
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const rows = []
  for (const [k, v] of store.entries()) {
    if (k === 'HISTORY') continue
    rows.push({
      key: k,
      phones_month: [...v.phonesMonth.values()].reduce((a,s)=>a+s.size,0),
      users_month: [...v.usersMonth.values()].reduce((a,s)=>a+s.size,0)
    })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'stats')
  const file = 'export.xlsx'
  XLSX.writeFile(wb, file)
  await ctx.replyWithDocument({ source: file })
})

// ===== New: History Download by User & Date =====
// Usage: /history_user <userId> <YYYY-MM-DD>
bot.command('history_user', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const parts = ctx.message.text.split(' ')
  if (parts.length < 3) return ctx.reply('❌ Usage: /history_user <userId> <YYYY-MM-DD>')

  const userId = parts[1]
  const date = parts[2]

  const key = `${ctx.chat.id}:${userId}`
  if (!store.has(key)) return ctx.reply('❌ No data for this user')

  const userData = store.get(key)
  const phonesToday = userData.phonesDay.get(date) || new Set()
  const usersToday = userData.usersDay.get(date) || new Set()

  const dupList = []
  phonesToday.forEach(p => {
    if (store.get('HISTORY').phones.has(p)) dupList.push(p)
  })
  usersToday.forEach(u => {
    if (store.get('HISTORY').users.has(u)) dupList.push(u)
  })

  const phonesMonth = [...userData.phonesMonth.values()].reduce((a,s)=>a+s.size,0)
  const usersMonth = [...userData.usersMonth.values()].reduce((a,s)=>a+s.size,0)

  const msg =
`📚 HISTORY RECORD
👤 User: ${userId}
📱 PHONES: ${[...phonesToday].join(', ') || 'None'}
📝 Duplicate: ${dupList.length ? `⚠️ ${dupList.join(', ')} (${dupList.length})` : 'None'}
👤 USERNAMES: ${[...usersToday].join(', ') || 'None'}
📱 Phone Numbers Today: ${phonesToday.size}
@ Username Count Today: ${usersToday.size}
📈 Daily Increase: ${phonesToday.size + usersToday.size}
📊 Monthly Total: ${phonesMonth + usersMonth}
📅 Time: ${date}`

  // 生成文本文件
  const fileName = `history_${userId}_${date}.txt`
  fs.writeFileSync(fileName, msg)

  await ctx.replyWithDocument({ source: fileName })
})

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
