import { Telegraf, Markup } from 'telegraf'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store =====
const store = new Map()

// ===== History store =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

const today = () => new Date().toISOString().slice(0,10)
const month = () => new Date().toISOString().slice(0,7)

function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

function getUser(chatId, userId) {
  const key = `${chatId}:${userId}`
  if (!store.has(key)) {
    store.set(key, {
      day: today(),
      month: month(),
      phonesDay: new Set(),
      usersDay: new Set(),
      phonesMonth: new Set(),
      usersMonth: new Set(),
      dup: []
    })
  }
  return store.get(key)
}

async function isAdmin(ctx) {
  const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
  return ['creator', 'administrator'].includes(m.status)
}

// ===== Message listener (原封不动) =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  if (data.day !== today()) {
    data.day = today()
    data.phonesDay.clear()
    data.usersDay.clear()
    data.dup = []
  }

  if (data.month !== month()) {
    data.month = month()
    data.phonesMonth.clear()
    data.usersMonth.clear()
  }

  const phones = extractPhones(text)
  const users = extractMentions(text)

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || data.phonesMonth.has(np)) {
      data.dup.push(np)
    } else {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    if (history.users.has(nu) || data.usersMonth.has(nu)) {
      data.dup.push(nu)
    } else {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      history.users.add(nu)
    }
  })

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  await ctx.reply(
`👤 User: ${ctx.from.first_name || ''} (${ctx.from.id})
📝 Duplicate: ${data.dup.length ? `⚠️ ${data.dup.length}` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`
  )
})

/* ================= EXPORT ================= */

// Step 1: export button
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  await ctx.reply(
    '📤 Export CSV – choose date',
    Markup.inlineKeyboard([
      [Markup.button.callback('📅 Today', 'EXPORT_TODAY')],
      [Markup.button.callback('📆 This Month', 'EXPORT_MONTH')],
      [Markup.button.callback('🗓 Custom Date', 'EXPORT_CUSTOM')]
    ])
  )
})

// Step 2: handlers
bot.action('EXPORT_TODAY', ctx => exportCSV(ctx, today()))
bot.action('EXPORT_MONTH', ctx => exportCSV(ctx, month()))
bot.action('EXPORT_CUSTOM', async ctx => {
  await ctx.reply('✏️ Send date like: 2026-01-09')
  ctx.session = { waitDate: true }
})

// Step 3: receive custom date
bot.on('text', async ctx => {
  if (!ctx.session?.waitDate) return
  ctx.session.waitDate = false
  exportCSV(ctx, ctx.message.text.trim())
})

// ===== CSV Generator =====
async function exportCSV(ctx, dateKey) {
  let csv = 'User,Duplicate Count,Duplicate Detail,Phone Today,Username Today,Daily Increase,Monthly Total,Date\n'

  for (const [k, v] of store.entries()) {
    if (k === 'HISTORY') continue

    const user = k.split(':')[1]
    csv += `"${user}",${v.dup.length},"${v.dup.join(' ')}",${v.phonesDay.size},${v.usersDay.size},${v.phonesDay.size + v.usersDay.size},${v.phonesMonth.size + v.usersMonth.size},${dateKey}\n`
  }

  const file = `export_${dateKey}.csv`
  fs.writeFileSync(file, csv)

  await ctx.replyWithDocument({ source: file })
}

// ===== Start =====
bot.launch()
console.log('✅ Bot running (export CSV ready)')
