import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)
const HISTORY_FILE = 'history.json'

// ================== STORE ==================
const store = new Map()
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

// ================== UTILS ==================
const today = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)

const normalizePhone = p => p.replace(/\D/g, '')
const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

function getUser(chatId, userId) {
  const key = `${chatId}:${userId}`
  if (!store.has(key)) {
    store.set(key, {
      first_name: '',
      day: today(),
      month: month(),
      phonesDay: new Set(),
      usersDay: new Set(),
      phonesMonth: new Set(),
      usersMonth: new Set(),
      dupPhonesDay: new Set(),
      dupUsersDay: new Set()
    })
  }
  return store.get(key)
}

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ================== LOAD / SAVE HISTORY ==================
function saveHistory() {
  const data = {}
  for (const [key, val] of store.entries()) {
    if (key === 'HISTORY') continue
    data[key] = {
      first_name: val.first_name,
      day: val.day,
      month: val.month,
      phonesDay: Array.from(val.phonesDay),
      usersDay: Array.from(val.usersDay),
      phonesMonth: Array.from(val.phonesMonth),
      usersMonth: Array.from(val.usersMonth),
      dupPhonesDay: Array.from(val.dupPhonesDay),
      dupUsersDay: Array.from(val.dupUsersDay)
    }
  }
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function preloadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return
  const raw = fs.readFileSync(HISTORY_FILE, 'utf8')
  const json = JSON.parse(raw)
  const globalHistory = store.get('HISTORY')

  for (const [key, val] of Object.entries(json)) {
    const obj = {
      first_name: val.first_name || '',
      day: val.day || today(),
      month: val.month || month(),
      phonesDay: new Set(val.phonesDay || []),
      usersDay: new Set(val.usersDay || []),
      phonesMonth: new Set(val.phonesMonth || []),
      usersMonth: new Set(val.usersMonth || []),
      dupPhonesDay: new Set(val.dupPhonesDay || []),
      dupUsersDay: new Set(val.dupUsersDay || [])
    }
    store.set(key, obj)
    // 更新全局历史
    val.phonesMonth?.forEach(p => globalHistory.phones.add(p))
    val.usersMonth?.forEach(u => globalHistory.users.add(u))
  }

  console.log('✅ History loaded from JSON:', globalHistory.phones.size, 'phones,', globalHistory.users.size, 'users')
}

// ================== COMMANDS ==================

// ---- EXPORT STATS ----
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
  fs.unlinkSync(file)
})

// ---- HISTORY DOWNLOAD ----
bot.command('history', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const args = ctx.message.text.split(' ').slice(1)
  let targetUserId = null
  let targetDate = null

  if (args[0] && /^\d+$/.test(args[0])) targetUserId = args[0]
  if (args[1] && /^\d{4}-\d{2}-\d{2}$/.test(args[1])) targetDate = args[1]

  let rows = []
  const globalHistory = store.get('HISTORY')

  for (const [key, data] of store.entries()) {
    if (key === 'HISTORY') continue
    const [chatId, userId] = key.split(':')
    if (targetUserId && targetUserId !== userId) continue
    if (targetDate && data.day !== targetDate) continue

    rows.push({
      user: data.first_name || userId,
      phones_today: Array.from(data.phonesDay),
      users_today: Array.from(data.usersDay),
      dup_phones: Array.from(data.dupPhonesDay),
      dup_users: Array.from(data.dupUsersDay),
      daily_increase: data.phonesDay.size + data.usersDay.size,
      monthly_total: data.phonesMonth.size + data.usersMonth.size,
      time: data.day
    })
  }

  let content = '📚 HISTORY RECORD\n\n'
  for (const r of rows) {
    content += `👤 User: ${r.user}\n`
    content += `📱 PHONES: ${r.phones_today.length ? r.phones_today.join(', ') : 'None'}\n`
    content += `📝 Duplicate: ${r.dup_phones.concat(r.dup_users).length ? r.dup_phones.concat(r.dup_users).join(', ') : 'None'}\n`
    content += `👤 USERNAMES: ${r.users_today.length ? r.users_today.join(', ') : 'None'}\n`
    content += `@ Username Count Today: ${r.users_today.length}\n`
    content += `📈 Daily Increase: ${r.daily_increase}\n`
    content += `📊 Monthly Total: ${r.monthly_total}\n`
    content += `📅 Time: ${r.time}\n\n================\n\n`
  }

  if (!rows.length) content += 'No records found for given filters.'

  const file = `history_download_${Date.now()}.txt`
  fs.writeFileSync(file, content, 'utf8')
  await ctx.replyWithDocument({ source: file })
  fs.unlinkSync(file)
})

// ================== TEXT LISTENER ==================
bot.on('text', async ctx => {
  const text = ctx.message.text
  if (text.startsWith('/')) return

  const data = getUser(ctx.chat.id, ctx.from.id)
  data.first_name = ctx.from.first_name || ''
  const globalHistory = store.get('HISTORY')

  if (data.day !== today()) {
    data.day = today()
    data.phonesDay.clear()
    data.usersDay.clear()
    data.dupPhonesDay.clear()
    data.dupUsersDay.clear()
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
    if (globalHistory.phones.has(np) || data.phonesMonth.has(np)) {
      data.dupPhonesDay.add(np)
    } else {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      globalHistory.phones.add(np)
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    if (globalHistory.users.has(nu) || data.usersMonth.has(nu)) {
      data.dupUsersDay.add(nu)
    } else {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      globalHistory.users.add(nu)
    }
  })

  saveHistory() // 每条消息后保存

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  await ctx.reply(
`👤 User: ${data.first_name} ${ctx.from.id}
📝 Duplicate: ${Array.from(data.dupPhonesDay).concat(Array.from(data.dupUsersDay)).length ? Array.from(data.dupPhonesDay).concat(Array.from(data.dupUsersDay)).join(', ') : 'None'}
📱 Phone Today: ${data.phonesDay.size}
@ User Today: ${data.usersDay.size}
📊 Month Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`
  )
})

// ================== START ==================
preloadHistory()
bot.launch()
console.log('✅ Bot running — history JSON persistent, /history works')
