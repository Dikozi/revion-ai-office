// The official US dollar rate of the National Bank of Kazakhstan, once a day, no Claude.
// The ad account pays in dollars, the money comes in tenge: the rate turns ad spend into ₸.
// Kept in data/fx.json; when the bank does not answer, the last known rate stays (with its date).
// data/fx.json: { usd, date, source, checked, days: { 'YYYY-MM-DD': usd } } — days is the per-day history
// (the newest DAYS_KEEP days); a file from before the history has no days and still loads.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { markOk, markFail } from './sources.js'

const DAYS_KEEP = 800

const FILE = path.join(P.data, 'fx.json')
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const dmy = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

let cache = null
const load = () => { try { cache ??= JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { cache = null } return cache }

// { usd, date, source } or null; usd = tenge for one dollar
export function usdKzt() {
  const c = load()
  if (!c?.usd) return null
  const { days: _, ...latest } = c
  return latest
}

// the known days: the history plus the latest rate (an old file has only the latter)
function days() {
  const c = load()
  const out = { ...(c?.days || {}) }
  if (c?.usd && c.date && !out[c.date]) out[c.date] = c.usd
  return out
}

// The rate of a day: that day, or the nearest earlier known day (weekends, a missed refresh).
// { usd, date } or null when nothing is known on or before it. date: 'YYYY-MM-DD' or anything Date can read.
export function rateOn(date) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : ymd(new Date(date))
  const d = days()
  if (d[day]) return { usd: d[day], date: day }
  const prev = Object.keys(d).filter((k) => k < day).sort().pop()
  return prev ? { usd: d[prev], date: prev } : null
}

// <item>…<title>USD</title>…<description>478.12</description><quant>1</quant>…</item> — the bank puts the rate in description
export function parseRates(xml, code = 'USD') {
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = m[1]
    const tag = (t) => (body.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`, 'i')) || [])[1]
    if ((tag('title') || '').trim().toUpperCase() !== code) continue
    const value = Number(String(tag('description') || tag('value') || tag('rate') || '').replace(',', '.'))
    const quant = Number(tag('quant')) || 1
    const rate = value / quant
    // a dollar costs a few hundred tenge: anything far outside is a parsing mistake
    const sane = code === 'USD' ? rate > 100 && rate < 5000 : rate > 0
    return sane ? Math.round(rate * 100) / 100 : null
  }
  return null
}

// today's rate; on a weekend or before the bank publishes it the latest earlier day is taken
export async function refreshFx() {
  const have = load()
  const today = ymd(new Date())
  if (have?.checked === today && have.usd) { markOk('fx'); return have }
  let err = null
  for (let back = 0; back < 7; back++) {
    const day = ymd(new Date(Date.now() - back * 864e5))
    try {
      const r = await fetch(`https://nationalbank.kz/rss/get_rates.cfm?fdate=${dmy(day)}`, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) { err ??= `Нацбанк ответил ошибкой ${r.status}`; continue }
      const usd = parseRates(await r.text())
      if (!usd) { err ??= 'в ответе Нацбанка нет курса доллара'; continue }
      const hist = days()
      hist[day] = usd
      // bounded: the newest DAYS_KEEP days
      const keep = Object.keys(hist).sort().slice(-DAYS_KEEP)
      cache = { usd, date: day, source: 'Нацбанк РК', checked: today, days: Object.fromEntries(keep.map((k) => [k, hist[k]])) }
      fs.mkdirSync(P.data, { recursive: true })
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(cache), 'utf8')
      fs.renameSync(`${FILE}.tmp`, FILE)
      markOk('fx')
      return cache
    } catch (e) {
      err ??= e
      if (back === 0) console.error('Курс Нацбанка:', e.message)
    }
  }
  markFail('fx', err || 'Нацбанк не ответил')
  return have
}

export function startFx() {
  refreshFx().catch(() => {})
  setInterval(() => refreshFx().catch(() => {}), 3 * 3600e3).unref?.()
}
