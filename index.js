import { Telegraf, Markup } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'
import http from 'http'
import path from 'path'

const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== 基础配置 =====
const EXPORT_DIR = './exports'
const DOWNLOAD_BASE = process.env.DOWNLOAD_BASE || 'http://localhost:3000'

if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR)

// ===== In-memory store =====
const store = new Map()

// ===== History store =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

// ===== 每日消息明细（用于按日导出）=====
store.set('DAILY_LOG', new Map()) // date -> [{ user, phone, username, time }]

function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

// ===== Load history.txt =====
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) return

  const text = fs.readFileSync(file, 'utf8')
  const history = store.get('HISTORY')

  ;(text.match(/\b\d{7,15}\b/g) || []).forEach(p => history.phones.add(normalizePhone(p)))
  ;(text.match(/@[a-zA-Z0-9_]{3,32}/g) || []).forEach(u => history.users.add(u.toLowerCase()))
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

// ===== 消息监听 =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')
  const date = today()

  if (data.day !== date) {
    data.day = date
    data.phonesDay.clear()
    data.usersDay.clear()
  }

  if (data.month !== monthNow()) {
    data.month = monthNow()
    data.phonesMonth.clear()
    data.usersMonth.clear()
  }

  const phones = extractPhones(text)
  const users = extractMentions(text)

  if (!store.get('DAILY_LOG').has(date)) {
    store.get('DAILY_LOG').set(date, [])
  }

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (!history.phones.has(np)) {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)

      store.get('DAILY_LOG').get(date).push({
        user: ctx.from.id,
        phone: np,
        username: '',
        time: new Date().toISOString()
      })
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    if (!history.users.has(nu)) {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      history.users.add(nu)

      store.get('DAILY_LOG').get(date).push({
        user: ctx.from.id,
        phone: '',
        username: nu,
        time: new Date().toISOString()
      })
    }
  })
})

// ===== /month 面板 =====
bot.command('month', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const buttons = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    buttons.push([Markup.button.callback(`📅 ${d}`, `EXPORT_DAY:${d}`)])
  }

  await ctx.reply(
    '📊 请选择要导出的日期：',
    Markup.inlineKeyboard(buttons)
  )
})

// ===== 导出指定日期 =====
bot.action(/EXPORT_DAY:(.+)/, async ctx => {
  if (!(await isAdmin(ctx))) return ctx.answerCbQuery('Admin only')

  const date = ctx.match[1]
  const rows = store.get('DAILY_LOG').get(date) || []

  if (!rows.length) {
    return ctx.reply(`⚠️ ${date} 没有数据`)
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Details')

  const file = `${EXPORT_DIR}/orders_${date}.xlsx`
  XLSX.writeFile(wb, file)

  const link = `${DOWNLOAD_BASE}/downloads/orders_${date}.xlsx`
  await ctx.reply(`✅ 导出完成\n📥 下载链接：\n${link}`)
  await ctx.answerCbQuery('OK')
})

// ===== HTTP 下载服务 =====
http.createServer((req, res) => {
  if (req.url.startsWith('/downloads/')) {
    const file = path.join(EXPORT_DIR, req.url.replace('/downloads/', ''))
    if (fs.existsSync(file)) {
      res.writeHead(200)
      fs.createReadStream(file).pipe(res)
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  }
}).listen(3000)

// ===== Start =====
preloadHistory()
bot.launch()
console.log('✅ Bot running with calendar export + download link')
