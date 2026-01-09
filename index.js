import { Telegraf, Markup } from 'telegraf'
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

const today = () => new Date().toISOString().slice(0, 10)
const monthNow = () => new Date().toISOString().slice(0, 7)

function getUser(chatId, userId) {
  const key = `${chatId}:${userId}`
  if (!store.has(key)) {
    store.set(key, {
      day: today(),
      month: monthNow(),
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

// ===== Message Listener =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  // reset day
  if (data.day !== today()) {
    data.day = today()
    data.phonesDay.clear()
    data.usersDay.clear()
  }

  // reset month
  if (data.month !== monthNow()) {
    data.month = monthNow()
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

  const msg =
`👤 User: ${ctx.from.first_name || ''} ${ctx.from.last_name || ''} (${ctx.from.id})
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`

  await ctx.reply(msg)
})

// ===== /month panel (Admin) =====
bot.command('month', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const m = monthNow()

  await ctx.reply(
`📊 Monthly Order Panel
📅 Month: ${m}

请选择操作：`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📤 Export', `EXPORT:${m}`)]
    ])
})

// ===== Export callback =====
bot.action(/EXPORT:(.+)/, async ctx => {
  if (!(await isAdmin(ctx))) {
    return ctx.answerCbQuery('Admin only')
  }

  const m = ctx.match[1]
  const rows = []

  for (const [k, v] of store.entries()) {
    if (k === 'HISTORY') continue

    rows.push({
      user: k,
      phone_month: v.phonesMonth.size,
      username_month: v.usersMonth.size,
      total: v.phonesMonth.size + v.usersMonth.size,
      month: m
    })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Stats')

  const file = `export_${m}.xlsx`
  XLSX.writeFile(wb, file)

  await ctx.replyWithDocument({ source: file })
  await ctx.answerCbQuery('✅ Exported')
})

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
