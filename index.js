import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ================== STORE ==================
const store = new Map()
store.set('HISTORY', { phones: new Set(), users: new Set() })

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

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ================== PRELOAD HISTORY ==================
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) return

  const text = fs.readFileSync(file, 'utf8')
  const history = store.get('HISTORY')

  const phones = text.match(/\b\d{7,15}\b/g) || []
  const users = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  phones.forEach(p => history.phones.add(normalizePhone(p)))
  users.forEach(u => history.users.add(u.toLowerCase()))

  console.log(`📚 History loaded: ${history.phones.size} phones, ${history.users.size} users`)
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

// ---- DOWNLOAD HISTORY TXT ----
bot.command('history', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const history = store.get('HISTORY')

  let content = '📚 HISTORY RECORD\n\n'
  content += '📱 PHONES:\n' + (history.phones.size ? [...history.phones].join('\n') : 'None')
  content += '\n\n👤 USERNAMES:\n' + (history.users.size ? [...history.users].join('\n') : 'None')

  const file = `history_download_${Date.now()}.txt`
  fs.writeFileSync(file, content, 'utf8')
  await ctx.replyWithDocument({ source: file })
  fs.unlinkSync(file)
})

// ---- DOWNLOAD SPECIFIC USER HISTORY TXT ----
bot.command('history_user', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const args = ctx.message.text.split(' ')
  const targetUserId = args[1]
  if (!targetUserId) return ctx.reply('❗ 用法: /history_user <userId>')

  const history = store.get('HISTORY')

  // ====== 读取 TXT 历史 ======
  let filePhones = new Set()
  let fileUsers = new Set()
  if (fs.existsSync('history.txt')) {
    const text = fs.readFileSync('history.txt', 'utf8')
    ;(text.match(/\b\d{7,15}\b/g) || []).forEach(p => filePhones.add(normalizePhone(p)))
    ;(text.match(/@[a-zA-Z0-9_]{3,32}/g) || []).forEach(u => fileUsers.add(u.toLowerCase()))
  }

  const targetKey = `${ctx.chat.id}:${targetUserId}`
  const targetData = store.get(targetKey) || {
    phonesDay: new Set(),
    usersDay: new Set(),
    phonesMonth: new Set(),
    usersMonth: new Set()
  }

  const dailyPhones = targetData.phonesDay.size
  const dailyUsers = targetData.usersDay.size
  const dailyIncrease = dailyPhones + dailyUsers

  const allPhones = new Set([...filePhones, ...targetData.phonesMonth])
  const allUsers = new Set([...fileUsers, ...targetData.usersMonth])
  const monthlyTotal = allPhones.size + allUsers.size
  const duplicates = Math.max(0, monthlyTotal - dailyIncrease)

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  let content = `📚 HISTORY RECORD\n\n`
  content += `👤 User: ${targetUserId}\n\n`
  content += `📱 PHONES:\n` + (allPhones.size ? [...allPhones].join('\n') : 'None')
  content += `\n\n📝 Duplicate: ⚠️ ${duplicates}\n\n`
  content += `👤 USERNAMES:\n` + (allUsers.size ? [...allUsers].join('\n') : 'None')
  content += `\n\n📱 Phone Numbers Today: ${dailyPhones}`
  content += `\n@ Username Count Today: ${dailyUsers}`
  content += `\n📈 Daily Increase: ${dailyIncrease}`
  content += `\n📊 Monthly Total: ${monthlyTotal}`
  content += `\n📅 Time: ${now}`

  const file = `history_user_${targetUserId}_${Date.now()}.txt`
  fs.writeFileSync(file, content, 'utf8')
  await ctx.replyWithDocument({ source: file })
  fs.unlinkSync(file)
})

// ================== TEXT LISTENER ==================
bot.on('text', async ctx => {
  const text = ctx.message.text
  if (text.startsWith('/')) return // 不吃命令

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

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || data.phonesMonth.has(np)) {
      dupCount++
      dupList.push(np)
    } else {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)
      fs.appendFileSync('history.txt', np + '\n')
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
      fs.appendFileSync('history.txt', nu + '\n')
    }
  })

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  await ctx.reply(
`👤 User: ${ctx.from.first_name || ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? dupList.join(', ') : 'None'}
📱 Phone Today: ${data.phonesDay.size}
@ User Today: ${data.usersDay.size}
📊 Month Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}`
  )
})

// ================== START ==================
preloadHistory()
bot.launch()
console.log('✅ Bot running — /history_user now detects duplicates')
