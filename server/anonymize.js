// Anonymisation of client exports (WhatsApp chats, CRM/lead tables) before any AI employee sees them.
// Extracted from the production module that prepares data for the sales and revenue analysts.
// Raw exports are deleted from the task folder, so personal data never reaches Claude.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { P } from './paths.js'

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
const BRAND = /^(менеджер|отдел|продажи?|жк|клиент)$/i
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

