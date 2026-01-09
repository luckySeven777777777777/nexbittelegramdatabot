import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)

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

  const phones = text.match(/[\+]?[\d\-\s]{7,}/g) || []
  const users = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  phones.forEach(p => {
    const n = normalizePhone(p)
    if (n.length >= 7) history.phones.add(n)
  })

  users.forEach(u => history.users.add(u.toLowerCase()))

  console.log(`📚 History loaded: ${history.phones.size} phones, ${history.users.size} users`)
}

// ================== COMMANDS (一定要在前面) ==================

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

// ---- DOWNLOAD HISTORY TXT (改造版) ----
bot.command('history', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  // 解析参数：/history [userId] [YYYY-MM-DD]
  const args = ctx.message.text.split(' ').slice(1)
  const targetUser = args[0] || null
  const targetDate = args[1] || null

  const history = store.get('HISTORY')
  let usersToShow = []
  let phonesToShow = []

  // 如果指定了用户和日期
  if (targetUser && targetDate) {
    // 从 store 找到对应 key
    const key = `${ctx.chat.id}:${targetUser}`
    const data = store.get(key)
    if (!data) return ctx.reply('❌ No data for this user')

    const dayPhones = data.day === targetDate ? [...data.phonesDay] : []
    const dayUsers = data.day === targetDate ? [...data.usersDay] : []

    usersToShow = dayUsers
    phonesToShow = dayPhones
  } else {
    // 默认展示全部 HISTORY
    usersToShow = [...history.users]
    phonesToShow = [...history.phones]
  }

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  // 统计
  const dailyIncrease = phonesToShow.length + usersToShow.length
  const monthlyTotal = Array.from(store.values())
    .filter(v => v.phonesMonth && v.usersMonth)
    .reduce((sum, v) => sum + v.phonesMonth.size + v.usersMonth.size, 0)

  let content = '📚 HISTORY RECORD\n\n'
  content += `👤 User: ${targetUser || 'ALL'}\n`
  content += `📱 PHONES:\n${phonesToShow.length ? phonesToShow.join('\n') : 'None'}\n`
  content += `📝 Duplicate: None\n`  // 可选，如果想显示当日重复，可进一步统计
  content += `👤 USERNAMES:\n${usersToShow.length ? usersToShow.join('\n') : 'None'}\n`
  content += `📱 Phone Numbers Today: ${phonesToShow.length}\n`
  content += `@ Username Count Today: ${usersToShow.length}\n`
  content += `📈 Daily Increase: ${dailyIncrease}\n`
  content += `📊 Monthly Total: ${monthlyTotal}\n`
  content += `📅 Time: ${now}\n`

  const file = `history_download_${Date.now()}.txt`
  fs.writeFileSync(file, content, 'utf8')
  await ctx.replyWithDocument({ source: file })
  fs.unlinkSync(file)
})

// ================== TEXT LISTENER (最后) ==================
bot.on('text', async ctx => {
  const text = ctx.message.text
  if (text.startsWith('/')) return   // ⭐ 不吃命令

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
console.log('✅ Bot running — /history works')
