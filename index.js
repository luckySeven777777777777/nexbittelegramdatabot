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

// ===== Export history =====
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

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
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

// ===== Preload history.txt =====
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) return console.log('⚠️ history.txt not found')

  const text = fs.readFileSync(file, 'utf8')
  const rawPhones = text.match(/[\+]?[\d\-\s]{7,}/g) || []
  const rawUsers = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  const history = store.get('HISTORY')
  rawPhones.forEach(p => {
    const np = normalizePhone(p)
    if (np.length >= 7) history.phones.add(np)
  })
  rawUsers.forEach(u => history.users.add(u.toLowerCase()))

  console.log(`📚 History loaded: ${history.phones.size} phones, ${history.users.size} usernames`)
}

// ===== Generate CSV =====
function generateCSV(data, label) {
  const header = [
    'User ID','Username','Duplicate Count','Duplicate List',
    'Phone Numbers Today','Username Count Today',
    'Daily Increase','Monthly Total','Date','Time'
  ]
  const rows = data.map(r => [
    r.userId,r.username,r.duplicateCount,r.duplicateList,
    r.phonesToday,r.usersToday,r.dailyIncrease,r.monthlyTotal,
    r.date,r.time
  ])
  const csv = header.join(',') + '\n' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const fileName = `export_${label}.csv`
  fs.writeFileSync(fileName, csv)
  return fileName
}

// ===== /month command with export button =====
bot.command('month', async ctx => {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📥 Export All CSV', 'EXPORT_ALL')],
    [Markup.button.callback('📅 Export by Date', 'EXPORT_DATE')]
  ])
  await ctx.reply('Choose an action:', kb)
})

// ===== Button actions =====
bot.action('EXPORT_ALL', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.answerCbQuery('❌ Admin only', { show_alert: true })
  const history = store.get('EXPORT_HISTORY')
  if (!history.length) return ctx.answerCbQuery('⚠️ No data', { show_alert: true })
  const fileName = generateCSV(history, 'all')
  await ctx.replyWithDocument({ source: fileName })
  await ctx.answerCbQuery()
})

bot.action('EXPORT_DATE', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.answerCbQuery('❌ Admin only', { show_alert: true })
  await ctx.reply('Please type the date in YYYY-MM-DD or YYYY-MM format:')
  await ctx.answerCbQuery()
})

// ===== Message listener for export by date & normal messages =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  // ===== Check if it's a date input for export =====
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(text)) {
    if (!(await isAdmin(ctx))) return
    const exportHistory = store.get('EXPORT_HISTORY')
    const filtered = exportHistory.filter(r => r.date === text || r.month === text)
    if (!filtered.length) return ctx.reply('⚠️ No data for this date')
    const fileName = generateCSV(filtered, text)
    return ctx.replyWithDocument({ source: fileName })
  }

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

  // ===== Save to export history =====
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

// ===== Start bot =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
