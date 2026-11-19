// Where the numbers come from and how fresh they are: шахматка, Meta ads, Instagram, CRM, the National Bank rate.
// Every source records its last success and its last error here; the portal home shows one line, the morning
// line warns instead of «Спокойно», and a source that keeps failing for 3 hours sends one Telegram message
// (plus one «восстановилось»). Plain code, no Claude. Kept in data/sources.json.
// A source may have parts (chess:pay = the payments list of the chessboard): the worst part wins.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'

const FILE = path.join(P.data, 'sources.json')
export const SOURCE_RU = { chess: 'шахматка', ads: 'Meta', insta: 'Instagram', crm: 'CRM', fx: 'курс' }
const NAME = { chess: 'Шахматка', 'chess:pay': 'Список оплат в шахматке', ads: 'Реклама Meta', insta: 'Instagram', crm: 'CRM', fx: 'Курс Нацбанка' }
const WHAT = { chess: 'цифры продаж и денег', 'chess:pay': 'деньги месяца', ads: 'цифры рекламы', insta: 'цифры Instagram', crm: 'цифры по клиентам', fx: 'пересчёт долларов в тенге' }
// pulled on a schedule: no success for this long is «устарело» even without an error (hours)
const STALE_H = { crm: 3, insta: 3, fx: 30 }
// a Telegram alert after this long of failing; the rate changes once a day, a short bank outage does not matter
const ALERT_H = { fx: 24 }
const ALERT_DEFAULT_H = 3
const REPEAT_H = 12
// the morning line: these decide whether the day is «спокойно»
export const KEY_SOURCES = ['chess', 'ads', 'insta', 'crm']
const H = 3600e3

let book = null
let savedAt = 0
const load = () => {
  if (book) return book
  try { book = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { book = {} }
  book.parts ??= {}
  book.alerts ??= {}
  return book
}
const save = (force) => {
  if (!force && Date.now() - savedAt < 5 * 60e3) return
  savedAt = Date.now()
  try {
    fs.mkdirSync(P.data, { recursive: true })
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(book))
    fs.renameSync(`${FILE}.tmp`, FILE)
  } catch (e) { console.error('Источники данных:', e.message) }
}

// errors in plain Russian: the sources already explain theirs, the network ones do not
export function plainError(e) {
  const m = String(e?.message ?? e ?? '').trim()
  if (e?.name === 'TimeoutError' || /timed? ?out|aborted due to timeout/i.test(m)) return 'не ответил вовремя (нет связи или сервис перегружен)'
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network|socket/i.test(m)) return 'нет связи с сервисом'
  // English text of a service (e.g. Meta's «An unexpected error…»): the owner gets plain words, the log the original
  if (m && !/[а-яё]/i.test(m)) { console.error('Источник данных:', m.slice(0, 300)); const code = m.match(/HTTP \d{3}|#\d+/)?.[0]; return `сервис ответил ошибкой${code ? ` (${code})` : ''}` }
  return m.slice(0, 300) || 'неизвестная ошибка'
}

// a bug in the office's own code (not the service's answer) is not the source's failure
const codeBug = (e) => ['TypeError', 'ReferenceError', 'RangeError'].includes(e?.name) && !/fetch failed|terminated|network|socket/i.test(String(e.message))

export function markOk(part, at = Date.now()) {
  const p = (load().parts[part] ||= {})
  const force = !!p.failSince || !p.okAt
  p.okAt = at
  delete p.failSince
  p.fails = 0
  save(force)
}

// a source that keeps its own time of the last success (the CRM copy): used once, when the book knows nothing yet
export function seedOk(part, at) {
  const b = load()
  if (!at || b.parts[part]) return
  b.parts[part] = { okAt: at, fails: 0 }
}

export function markFail(part, err, at = Date.now()) {
  if (codeBug(err)) { console.error(`Источник ${part}: ошибка в коде офиса, не источника —`, err.message); return }
  const p = (load().parts[part] ||= {})
  const first = !p.failSince
  p.failSince ||= at
  p.failAt = at
  p.fails = (p.fails || 0) + 1
  p.error = plainError(err)
  save(first)
}

// which sources this office has at all: { chess, ads, insta, crm, fx } → true/false
export function enabled({ portal, meta, crm } = {}) {
  const m = meta?.m || {}
  return { chess: !!portal?.status?.().configured, ads: !!(m.token && m.adAccountId), insta: !!(m.token && m.igUserId), crm: !!crm?.status?.().configured, fx: true }
}

const hm = (ms) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(ms)
const dayOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(ms)
// «10:02» today, «18.11 10:02» before
export function when(ms, now = Date.now()) {
  if (!ms) return ''
  const d = dayOf(ms)
  return d === dayOf(now) ? hm(ms) : `${d.slice(8, 10)}.${d.slice(5, 7)} ${hm(ms)}`
}
export function ago(ms, now = Date.now()) {
  if (!ms) return 'ни разу'
  const min = Math.max(0, Math.round((now - ms) / 60e3))
  if (min < 60) return `${Math.max(1, min)} мин назад`
  if (min < 48 * 60) return `${Math.round(min / 60)} ч назад`
  return `${Math.round(min / 1440)} дн. назад`
}

function partState(id, p, now) {
  if (!p) return { state: 'unknown' }
  if (p.failSince) return { state: 'fail', okAt: p.okAt || null, failSince: p.failSince, error: p.error || '', fails: p.fails || 1 }
  if (STALE_H[id] && p.okAt && now - p.okAt > STALE_H[id] * H) return { state: 'stale', okAt: p.okAt }
  return { state: 'ok', okAt: p.okAt || null }
}

// One row per enabled source for the portal and the morning line.
// state: ok | fail (the last try failed) | stale (no fresh data for too long) | unknown (not asked yet)
export function sourceList(on = {}, now = Date.now()) {
  const b = load()
  const rank = { fail: 3, stale: 2, unknown: 1, ok: 0 }
  const out = []
  for (const id of Object.keys(SOURCE_RU)) {
    if (!on[id]) continue
    const parts = Object.keys(b.parts).filter((k) => k === id || k.startsWith(`${id}:`))
    let worst = { part: id, ...partState(id, b.parts[id], now) }
    for (const k of parts) { const s = { part: k, ...partState(id, b.parts[k], now) }; if (rank[s.state] > rank[worst.state]) worst = s }
    // «ok» time: the main part's, the moment the numbers last came
    const okAt = b.parts[id]?.okAt || worst.okAt || null
    const row = { id, name: SOURCE_RU[id], state: worst.state, part: worst.part, okAt, failSince: worst.failSince || null, error: worst.error || '', key: KEY_SOURCES.includes(id) }
    row.label = row.state === 'ok' ? `✓ ${id === 'fx' ? '' : when(okAt, now)}`.trim() : row.state === 'unknown' ? '…' : `⚠ ${ago(okAt, now)}`
    row.text = explain(row, now)
    if (row.state === 'fail' || row.state === 'stale') row.morning = morningText(row, now)
    out.push(row)
  }
  return out
}

function explain(r, now) {
  const name = NAME[r.part] || NAME[r.id]
  const last = r.okAt ? `Последний раз данные пришли ${when(r.okAt, now)} (${ago(r.okAt, now)}).` : 'Данные от него ещё ни разу не приходили.'
  if (r.state === 'ok') return `${name}: данные пришли ${when(r.okAt, now) || 'сегодня'}, всё в порядке.`
  if (r.state === 'unknown') return `${name}: офис ещё не обращался к нему после перезапуска.`
  if (r.state === 'stale') return `${name}: нет обновлений больше ${STALE_H[r.id]} ч. ${last} ${cap(WHAT[r.part] || WHAT[r.id])} могут быть старыми.`
  return `${name} не отвечает с ${when(r.failSince, now)}: ${bare(r.error)}. ${last} ${cap(WHAT[r.part] || WHAT[r.id])} могут быть старыми.`
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
const bare = (s) => String(s || 'ошибка').replace(/[.\s]+$/, '')

function morningText(r, now) {
  const name = NAME[r.part] || NAME[r.id], what = WHAT[r.part] || WHAT[r.id]
  if (r.state === 'stale') return `${name}: нет обновлений с ${when(r.okAt, now)} — ${what} могут быть старыми`
  return r.okAt ? `${name} не отвечает с ${when(r.failSince, now)} — ${what} могут быть старыми` : `${name} не отвечает — ${what} сегодня нет`
}

// Telegram: one message when a source has been failing for 3+ hours (at least two failed tries in a row),
// one «восстановилось» when it answers again; the same source is not reported twice within 12 hours.
export function sourceAlerts(on = {}, now = Date.now()) {
  const b = load()
  const out = []
  let changed = false
  for (const row of sourceList(on, now)) {
    const a = b.alerts[row.id]
    const p = b.parts[row.part] || {}
    const limit = (ALERT_H[row.id] ?? ALERT_DEFAULT_H) * H
    if (row.state === 'fail' && (p.fails || 0) >= 2 && now - row.failSince > limit) {
      if (a?.open || (a?.at && now - a.at < REPEAT_H * H)) continue
      b.alerts[row.id] = { at: now, since: row.failSince, open: true }
      out.push(`⚠️ ${NAME[row.part] || NAME[row.id]} не отвечает с ${when(row.failSince, now)}: ${bare(row.error)}. ${cap(WHAT[row.part] || WHAT[row.id])} на портале и в отчётах могут быть старыми. Сообщу, когда восстановится.`)
      changed = true
    } else if (row.state === 'ok' && a?.open) {
      a.open = false
      a.back = now
      out.push(`✅ ${NAME[row.id]} снова отвечает (не было данных с ${when(a.since, now)} до ${when(row.okAt || now, now)}).`)
      changed = true
    }
  }
  if (changed) save(true)
  return out
}

// tests only: forget the in-memory copy
export function _reset() { book = null; savedAt = 0 }
