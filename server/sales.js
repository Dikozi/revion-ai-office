// Data for the sales analyst (Ерлан) and the revenue analyst (Нурлан), prepared by plain code
// before the run: chessboard and sales pace from the portal, Meta ads by campaign, Krisha spend,
// and the owner's exports (Krisha leads, WhatsApp chats) with names and phone numbers cut out.
// Raw exports are deleted from the task folder, so personal data never reaches Claude.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { P } from './paths.js'
import { moneyEvents, received, planned, deals, unfilled, extraIncome, shortPaid } from './payments.js'
import { readLog, soldDays, salesIn, kzDay, kzStamp } from './sales-rules.js'
import { excluded } from './ads-rules.js'

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const daysAgo = (n) => ymd(new Date(Date.now() - n * 864e5))

// ---------- zip / xlsx without dependencies ----------

export function unzip(buf) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('не zip-архив')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = {}
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    if (!name.endsWith('/')) files[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// first sheet of an .xlsx as rows of strings
export function readXlsx(buf) {
  const z = unzip(buf)
  const shared = []
  const ss = z['xl/sharedStrings.xml']?.toString('utf8') || ''
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]))
  const sheetName = Object.keys(z).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]
  if (!sheetName) throw new Error('в файле нет листов')
  const rows = []
  for (const r of z[sheetName].toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1] || ''
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
      const type = /t="(\w+)"/.exec(c[1])?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || '')?.[1]
      const inline = /<is>([\s\S]*?)<\/is>/.exec(c[2] || '')?.[1]
      row[col < 0 ? row.length : col] = type === 's' ? shared[Number(v)] ?? '' : inline ? xmlText(inline) : v ? xmlText(v) : ''
    }
    rows.push(Array.from(row, (x) => x ?? ''))
  }
  return rows
}

function readCsv(text) {
  const head = text.split('\n').slice(0, 5).join('\n')
  const count = (ch) => (head.match(new RegExp(ch, 'g')) || []).length
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0]
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const toCsv = (rows) => rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(';')).join('\n')

// ---------- removing personal data ----------

// Kazakh mobiles and Astana landlines in any spacing, and any long international number
const PHONES = [
  /(?:\+?[78])[\s\-().]*\d{3,4}[\s\-().]*\d{2,3}[\s\-.]*\d{2}[\s\-.]*\d{2}\b/g,
  /\b7\d{2}[\s\-().]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}\b/g,
  /\+\d[\d\s().-]{8,}\d/g,
]
export function scrub(text) {
  let t = String(text).normalize('NFKC').replace(/[‐-―−]/g, '-')
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[почта]')
  for (const re of PHONES) t = t.replace(re, '[телефон]')
  return t.replace(/\b\d{12}\b/g, '[ИИН]').replace(/\b\d{9,}\b/g, '[номер]')
}

// whole-word names in any grammatical form: «Ержан», «Ержану», «Ержаном»
const BRAND = /^(altyn|qala|менеджер|отдел|продажи?|жк|клиент)$/i
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
export function nameMatcher(names) {
  const words = names.flatMap((n) => String(n).split(/[\s,.;]+/)).filter((w) => /^\p{L}{3,}$/u.test(w) && !BRAND.test(w))
  const stems = [...new Set(words.map((w) => w.slice(0, Math.min(w.length, 4)).toLowerCase()))]
  if (!stems.length) return null
  return new RegExp(`(?<!\\p{L})(${stems.map(escapeRe).join('|')})\\p{L}{0,8}(?!\\p{L})`, 'giu')
}

// columns that hold who the client is, not what happened
const PERSONAL_COL = /(имя|фио|ф\.и\.о|^фи$|клиент|покупател|контакт|пользоват|автор|отправит|собеседник|name|user|author|телефон|phone|тел\b|тел\.|номер тел|whats|ватсап|e-?mail|почт|иин|адрес|address)/i

function scrubTable(rows) {
  if (!rows.length) return { rows, dropped: [] }
  // the header is the first row with at least 3 filled cells (exports often start with a title line)
  const hi = Math.max(0, rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 3))
  const head = rows[hi].map((h) => String(h || ''))
  const keep = head.map((h) => !PERSONAL_COL.test(h))
  const dropped = head.filter((h, i) => !keep[i])
  // names from removed columns are cut out wherever else they appear
  const re = nameMatcher(rows.slice(hi + 1).flatMap((r) => r.filter((_, i) => !keep[i])))
  const clean = (c) => { const t = scrub(c); return re ? t.replace(re, '[имя]') : t }
  return { rows: rows.slice(hi).map((r) => r.filter((_, i) => keep[i]).map(clean)), dropped }
}

// WhatsApp: Android "06.10.2026, 14:23 - Имя: текст", iPhone "[06.10.2026, 14:23:11] Имя: текст", ISO dates;
// iPhone puts invisible direction marks at line starts
const WA_DATE = /^\[?(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})/
const WA_LINE = /^\[?(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}),? (\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]?\s*(?:[-–]\s)?([^:]{1,60}):\s?(.*)$/
function scrubChat(text) {
  const lines = text.normalize('NFKC').split(/\r?\n/).map((l) => l.replace(/[‎‏‪-‮⁦-⁩﻿]/g, ''))
  const senders = new Map()
  for (const l of lines) { const m = WA_LINE.exec(l); if (m) senders.set(m[3].trim(), (senders.get(m[3].trim()) || 0) + 1) }
  // fail closed: if most dated lines are not understood, the format is unknown and names could stay
  const dated = lines.filter((l) => WA_DATE.test(l)).length
  const parsed = [...senders.values()].reduce((a, b) => a + b, 0)
  if (dated > 5 && parsed < dated * 0.8) throw new Error('незнакомый формат переписки, файл не передан сотруднику')
  // the one who writes most in a business chat is usually the manager; everyone else is a client
  const order = [...senders.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
  const label = new Map(order.map((n, i) => [n, i === 0 ? 'Менеджер' : order.length > 2 ? `Клиент ${i}` : 'Клиент']))
  const nameRe = nameMatcher(order)
  const hide = (t) => (nameRe ? t.replace(nameRe, '[имя]') : t)
  const out = lines.map((l) => {
    const m = WA_LINE.exec(l)
    return scrub(m ? `${m[1]} ${m[2]} — ${label.get(m[3].trim())}: ${hide(m[4])}` : hide(l))
  })
  return { text: out.join('\n'), people: senders.size, messages: parsed }
}

// Files that may hold client data. Analysts get only cleaned copies of them; everything else is removed
// for analysts, and kept (pictures, videos) for the others.
export const DATA_RE = /\.(txt|zip|csv|xlsx|xls|json|vcf|docx?|pdf|rtf|odt|ods)$/i

// Turns exports in _материалы into clean copies in outDir and deletes the originals.
// Output names are neutral: chat exports are named after the client.
export function cleanExports(materialsDir, outDir, { keepOther = false } = {}) {
  const done = []
  if (!fs.existsSync(materialsDir)) return done
  fs.mkdirSync(outDir, { recursive: true })
  let n = 0
  for (const name of fs.readdirSync(materialsDir)) {
    const src = path.join(materialsDir, name)
    if (!fs.statSync(src).isFile()) continue
    if (keepOther && !DATA_RE.test(name)) continue
    const ext = path.extname(name).toLowerCase()
    const base = `файл-${++n}`
    try {
      if (ext === '.zip') {
        const files = unzip(fs.readFileSync(src))
        const chats = Object.entries(files).filter(([f]) => /\.txt$/i.test(f))
        if (!chats.length) throw new Error('в архиве нет переписки .txt')
        chats.forEach(([, b], i) => {
          const r = scrubChat(b.toString('utf8'))
          const file = `${base}${chats.length > 1 ? `-${i + 1}` : ''}.txt`
          fs.writeFileSync(path.join(outDir, file), r.text, 'utf8')
          done.push({ file, kind: 'переписка WhatsApp', messages: r.messages, people: r.people })
        })
      } else if (ext === '.txt') {
        const r = scrubChat(fs.readFileSync(src, 'utf8'))
        fs.writeFileSync(path.join(outDir, `${base}.txt`), r.text, 'utf8')
        done.push({ file: `${base}.txt`, kind: r.messages ? 'переписка WhatsApp' : 'текст', messages: r.messages, people: r.people })
      } else if (ext === '.xlsx' || ext === '.csv') {
        const rows = ext === '.xlsx' ? readXlsx(fs.readFileSync(src)) : readCsv(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''))
        const t = scrubTable(rows.filter((r) => r.some((c) => String(c).trim())))
        fs.writeFileSync(path.join(outDir, `${base}.csv`), toCsv(t.rows), 'utf8')
        done.push({ file: `${base}.csv`, kind: 'таблица', rows: Math.max(0, t.rows.length - 1), columnsRemoved: t.dropped })
      } else {
        throw new Error('этот тип файла офис не обезличивает — пришлите .txt, .zip, .csv или .xlsx')
      }
    } catch (e) {
      done.push({ file: `${base}${ext}`, kind: 'ошибка', error: e.message })
    }
    fs.rmSync(src, { force: true }) // the raw file never stays where Claude can read it
  }
  return done
}

// ---------- portal, ads, Krisha spend ----------

async function chessboard(portal, dir) {
  const a = await portal.get('/api/analytics/apartments')
  const h = await portal.get('/api/analytics/status-history')
  const flats = a.apartments.map((x) => ({ номер: x.number, подъезд: x.entrance, этаж: x.floor, комнат: x.rooms, площадь: x.area_m2, цена: x.price_kzt, цена_м2: x.price_per_m2_kzt, статус: x.status, статус_с: kzDay(x.status_changed_at) }))
  const count = (list, key) => list.reduce((o, x) => ((o[x[key]] = (o[x[key]] || 0) + 1), o), {})
  const byNum = new Map(a.apartments.map((x) => [x.number, x]))
  // one sales rule with the portal (sales-rules.js): Almaty days, net of cancellations, client moves left out
  const log = readLog(h.changes)
  const soldAt = soldDays(log)
  const pf = a.apartments.map((x) => ({ n: x.number, r: x.rooms, m2: x.area_m2, price: x.price_kzt, st: x.status, since: kzDay(x.status_changed_at), soldAt: soldAt.get(x.number) }))
  const pay = (await portal.get('/api/analytics/payments').catch(() => null))?.flats || null
  const ev = moneyEvents(pf, pay)
  const price = (c) => byNum.get(c.number)?.price_kzt || 0
  // week-by-week pace for the last 8 weeks (weeks end today)
  const weeks = []
  for (let w = 7; w >= 0; w--) {
    const from = daysAgo((w + 1) * 7), to = daysAgo(w * 7)
    const x = salesIn(log, from, to)
    weeks.push({
      неделя: `${from} — ${to}`,
      новых_броней: x.bookings,
      снято_броней: x.unbooked,
      продаж: x.net,
      ...(x.cancels.length ? { из_них_отмены_прежних_продаж: x.cancels.length } : {}),
      сумма_договоров: x.deals.reduce((t, c) => t + price(c), 0) - x.cancels.reduce((t, c) => t + price(c), 0),
      ...(({ revenue, booking, first, installment, full }) => ({ выручка_получено_денег: revenue, из_них_брони: booking, первые_взносы: first, платежи_рассрочки: installment, полные_оплаты: full }))(received(ev, from, to)),
      продано_без_цены: x.deals.filter((c) => !price(c)).length,
    })
  }
  const free = a.apartments.filter((x) => x.status === 'Свободна')
  const sold = a.apartments.filter((x) => x.sold)
  const now = Date.now()
  const summary = {
    жк: [...new Set(a.apartments.map((x) => `${x.complex}, ${x.phase} очередь`))],
    всего: a.count,
    по_статусам: count(a.apartments, 'status'),
    свободно_по_комнатам: count(free, 'rooms'),
    продано_по_комнатам: count(sold, 'rooms'),
    продано_площадь: Math.round(sold.reduce((s, x) => s + (x.area_m2 || 0), 0)),
    свободно_площадь: Math.round(free.reduce((s, x) => s + (x.area_m2 || 0), 0)),
    цены_внесены: `${a.apartments.filter((x) => x.price_kzt).length} из ${a.count}`,
    брони_дольше_7_дней: a.apartments.filter((x) => x.status === 'Бронь' && x.status_changed_at && now - Date.parse(x.status_changed_at) > 7 * 864e5).map((x) => x.number),
    журнал_с: kzDay(a.history_since),
  }
  fs.writeFileSync(path.join(dir, 'шахматка.json'), JSON.stringify({ summary, квартиры: flats }, null, 1), 'utf8')
  const today = ymd(new Date())
  fs.writeFileSync(path.join(dir, 'оплаты.json'), JSON.stringify({
    правило: 'Выручка = деньги, реально полученные (по данным шахматки): брони, первые взносы, платежи по рассрочке, полные оплаты. Цена квартиры — это сумма договора, а не выручка. «Продана» без внесённых оплат считается полной оплатой в день продажи. Деньги вне шахматки (другая очередь) в выручку, сравнения и цели не входят — только отдельной строкой.',
    ...(pay ? {} : { внимание: 'Шахматка не ответила (оплаты) — выручка посчитана по ценам квартир «Продана» на день продажи, а не по полученным деньгам: она может быть завышена (частично оплаченные считаются целиком), а брони и рассрочки в неё не вошли. Это сбой связи, а не ошибка владельца: не пиши, что оплаты не внесены.' }),
    не_внесены_оплаты: unfilled(pf, pay).map((x) => x.n),
    продана_не_доплачено: shortPaid(pf, pay).map((x) => ({ квартира: x.n, цена: x.price, получено: x.paid, ожидается_по_графику: x.planned, не_доплачено: x.short })),
    вне_шахматки_не_в_выручке: extraIncome().map((x) => ({ дата: x.date, сумма: x.amount, что: x.label || '' })),
    ожидается_по_графику_30_дней: planned(ev, today, daysAgo(-30)), ожидается_всего: planned(ev, today, '9999-12-31'),
    сделки: deals(pf, pay).map((x) => ({ квартира: x.n, статус: x.st, цена: x.price, получено: x.paid, ожидается_по_графику: x.planned, просрочка: x.overdue, просрочка_с: x.overdueSince, следующий_платёж: x.next, оплаты_внесены: x.filled, полная_оплата_по_цене_автоматически: x.auto, ...(x.short ? { продана_не_доплачено: x.short } : {}) })),
  }, null, 1), 'utf8')
  fs.writeFileSync(path.join(dir, 'продажи.json'), JSON.stringify({ по_неделям: weeks, правило: 'Продажа = переход в «Продана»/«Рассрочка» из другого статуса; продажи недели — за вычетом отмен; перенос клиента в другую квартиру — не продажа и не снятая бронь. Время — Астана.', смены_статусов: log.map((c) => ({ номер: c.number, было: c.from, стало: c.to, когда: kzStamp(c.changed_at), ...(c.move ? { перенос_клиента: c.move === 'in' ? `из кв. ${c.movedFrom}` : `в кв. ${c.movedTo}` } : {}) })) }, null, 1), 'utf8')
  const last4 = weeks.slice(-4)
  return { flats: a.count, free: free.length, sales4w: last4.reduce((s, w) => s + w.продаж, 0), bookings4w: last4.reduce((s, w) => s + w.новых_броней, 0), noPrice: a.count - a.apartments.filter((x) => x.price_kzt).length }
}

const ACT = (acts, type) => Number((acts || []).find((x) => x.action_type === type)?.value || 0)
const results = (acts) => ACT(acts, 'onsite_conversion.messaging_conversation_started_7d') + Math.max(ACT(acts, 'lead'), ACT(acts, 'onsite_conversion.lead_grouped'))

async function ads(meta, dir) {
  const act = `act_${String(meta.m.adAccountId).replace(/^act_/, '')}`
  const range = (days) => JSON.stringify({ since: daysAgo(days), until: ymd(new Date()) })
  const rows = async (level, days) => ((await meta.api(`${act}/insights`, { level, fields: `${level}_name,${level === 'ad' ? 'campaign_name,' : ''}spend,impressions,inline_link_clicks,ctr,actions`, time_range: range(days), limit: 300 })).data || [])
    .filter((r) => !excluded(meta.cfg)(r.campaign_name || r[`${level}_name`])) // another project in the same ad account (ads-rules.js)
    .map((r) => ({ название: r[`${level}_name`], ...(r.campaign_name && level === 'ad' ? { кампания: r.campaign_name } : {}), расход: +r.spend || 0, показы: +r.impressions || 0, переходы: +r.inline_link_clicks || 0, ctr: +(+r.ctr || 0).toFixed(2), переписки_и_заявки: results(r.actions) }))
    .sort((a, b) => b.расход - a.расход)
  const data = { валюта: meta.m.adAccounts?.find((a) => String(a.id || '').includes(String(meta.m.adAccountId).replace(/^act_/, '')))?.currency || 'USD', кампании_30_дней: await rows('campaign', 30), кампании_90_дней: await rows('campaign', 90), объявления_30_дней: await rows('ad', 30) }
  fs.writeFileSync(path.join(dir, 'реклама.json'), JSON.stringify(data, null, 1), 'utf8')
  const c = data.кампании_30_дней
  return { currency: data.валюта, spend30: +c.reduce((s, x) => s + x.расход, 0).toFixed(2), results30: c.reduce((s, x) => s + x.переписки_и_заявки, 0) }
}

function krisha(dir) {
  let entries = []
  try { entries = JSON.parse(fs.readFileSync(path.join(P.data, 'initiative.json'), 'utf8')).krisha?.entries || [] } catch {}
  fs.writeFileSync(path.join(dir, 'крыша-расход.json'), JSON.stringify({ записи: entries.map((e) => ({ дата: e.at, сумма_тенге: e.amount })) }, null, 1), 'utf8')
  return entries.length
}

export async function collectSales({ portal, meta, dir, materialsDir, withAds }) {
  fs.mkdirSync(dir, { recursive: true })
  const stats = { notes: [] }
  try { stats.board = await chessboard(portal, dir) } catch (e) { stats.notes.push(`шахматка: ${e.message}`) }
  if (withAds && meta?.m?.token && meta.m.adAccountId) {
    try { stats.ads = await ads(meta, dir) } catch (e) { stats.notes.push(`реклама Meta: ${e.message}`) }
  }
  stats.krisha = krisha(dir)
  stats.exports = cleanExports(materialsDir, path.join(dir, 'клиенты'))
  if (!stats.board) throw new Error(stats.notes.join(' '))
  return stats
}
