import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store (Railway safe, simple) =====
const store = new Map()

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
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)

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
    if (data.phonesMonth.has(p)) {
      dupCount++; dupList.push(p)
    } else {
      data.phonesDay.add(p)
      data.phonesMonth.add(p)
    }
  })

  users.forEach(u => {
    if (data.usersMonth.has(u)) {
      dupCount++; dupList.push(u)
    } else {
      data.usersDay.add(u)
      data.usersMonth.add(u)
    }
  })

  if (!text.startsWith('/')) return

  let msg = ''
  const now = new Date().toLocaleString()

  if (text === '/today') {
    msg =
`👤 User: ${ctx.from.username || ctx.from.first_name} (${ctx.from.id})
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers: ${data.phonesDay.size}
@ Usernames: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`
  }

  if (text === '/month') {
    msg =
`👤 User: ${ctx.from.username || ctx.from.first_name} (${ctx.from.id})
📱 Phone Numbers: ${data.phonesMonth.size}
@ Usernames: ${data.usersMonth.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`
  }

  if (msg) ctx.reply(msg)
})

// ===== Export (Admin Only) =====
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const rows = []
  for (const [k, v] of store.entries()) {
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

bot.launch()
console.log('✅ Bot running on Railway')
