import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ================== 全局存储 ==================
const store = new Map()

// 👉 明细记录池（CSV 导出用）
const records = []

// 👉 历史重复池
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

// ================== 工具函数 ==================
const today = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)

function normalizePhone(p) {
  return p.replace(/\D/g, '')
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

// ================== 历史预加载 ==================
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

  console.log(`📚 History loaded`)
}

// ================== 用户数据 ==================
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

// ================== 监听所有消息 ==================
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  // ===== 重置逻辑 =====
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

  // ===== 提取 =====
  const phones = extractPhones(text)
  const users = extractMentions(text)

  let dupCount = 0
  let dupItems = []

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || data.phonesMonth.has(np)) {
      dupCount++
      dupItems.push(np)
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
      dupItems.push(nu)
    } else {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      history.users.add(nu)
    }
  })

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Yangon'
  })

  // ===== 记录明细（CSV 用）=====
  records.push({
    chat_id: ctx.chat.id,
    user_id: ctx.from.id,
    username: ctx.from.username || '',
    name: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
    duplicate_count: dupCount,
    phone_numbers_today: data.phonesDay.size,
    username_today: data.usersDay.size,
    daily_increase: data.phonesDay.size + data.usersDay.size,
    monthly_total: data.phonesMonth.size + data.usersMonth.size,
    date: today(),
    time: now
  })

  // ===== 自动回复 =====
  const msg = `👤 User: ${ctx.from.first_name || ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupItems.length}` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`

  await ctx.reply(msg)
})

// ================== CSV 导出（管理员） ==================
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const date = ctx.message.text.split(' ')[1] || today()
  const data = records.filter(r => r.date === date)

  if (!data.length) {
    return ctx.reply(`⚠️ No data for ${date}`)
  }

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'records')

  const file = `export_${date}.csv`
  XLSX.writeFile(wb, file, { bookType: 'csv' })

  await ctx.replyWithDocument({
    source: file,
    filename: file
  })
})

// ================== 启动 ==================
preloadHistory()
bot.launch()
console.log('✅ Bot running and CSV export ready')
