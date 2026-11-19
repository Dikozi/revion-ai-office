// The company's months, kept for good (owner's decision 19.11.2026): data/reports/months.json.
// Plain code, no Claude. Every number of a period comes from one function (periodFacts) for the weekly report,
// the monthly report and the portal page «Отчёты»:
// - chessboard (sales-rules.js: net sales, Almaty days, moves are not deals; payments.js: money received,
//   money outside the chessboard only apart), stock rewound through the status log;
// - CRM (real leads, crm.leadChannel for «источник», refusals with Ерлан's own words);
// - the ads archive by day (ads-archive.js; price of a conversation = chat and form ads only, reach spend apart),
//   tenge by the National Bank rate of each day (fx.rateOn);
// - Instagram: the account history by day (insta-archive.js), the hourly follower log, stories, the media list.
// The 1st of a month closes the previous one. A closed month is never silently rewritten: a later recalculation
// that differs is kept as a revision («было → стало»); an empty part (a source did not answer) is filled in.
// Months before this file existed are backfilled once from what the archives allow; every part says how complete it is.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { readLog, soldDays, salesIn, SOLD, kzDay } from './sales-rules.js'
import { moneyEvents, received, extraIncome } from './payments.js'
import { realLeads, leadChannel, topStage, STAGE_ORDER, isNonTarget } from './crm.js'
import { kindOf } from './ads-archive.js'
import { instaHistory, storyArchive } from './insta-archive.js'
import { followerLog } from './followers.js'
import { rateOn } from './fx.js'

const DIR = path.join(P.data, 'reports')
const FILE = path.join(DIR, 'months.json')
const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
// the numbers a closed month protects; a different recalculation becomes a revision
const TRACK = ['sales.net', 'sales.bookings', 'money.received', 'leads.total', 'ads.spend', 'insta.followersEnd']

export const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
export const ru = (day) => (day ? day.split('-').reverse().join('.') : '')
export const lastDayOf = (key) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).toISOString().slice(0, 10)
export const nextMonth = (key) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 1)).toISOString().slice(0, 7)
export const prevMonth = (key) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 2, 1)).toISOString().slice(0, 7)
export const monthName = (key, form = 'n') => `${(form === 'g' ? GEN : form === 'p' ? PREP : MONTH)[+key.slice(5, 7) - 1]}`
export const monthLabel = (key) => `${monthName(key)} ${key.slice(0, 4)}`
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f) }
const inRange = (d, from, to) => !!d && d >= from && d <= to
const count = (list, key) => list.reduce((o, x) => { const k = key(x); if (k != null) o[k] = (o[k] || 0) + 1; return o }, {})
const floorBand = (f) => (f == null ? null : f <= 3 ? '1–3 этаж' : f <= 6 ? '4–6 этаж' : f <= 9 ? '7–9 этаж' : '10+ этаж')
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

// ---------- sources ----------

export function chessFrom(a, h, pay) {
  const flats = (a?.apartments || []).map((x) => ({ n: x.number, f: x.floor, r: x.rooms, m2: x.area_m2, price: x.price_kzt, ppm: x.price_per_m2_kzt, st: x.status, since: kzDay(x.status_changed_at) }))
  const byNum = new Map(flats.map((x) => [x.n, x]))
  const log = readLog(h?.changes)
  for (const [n, day] of soldDays(log)) if (byNum.has(n)) byNum.get(n).soldAt = day
  const logSince = kzDay(a?.history_since || h?.history_since) || log[0]?.day || null
  return { flats, byNum, log, logSince, events: moneyEvents(flats, pay?.flats || null), pay: !!pay }
}

// the ads archive by day, split by what each ad is for; `live` = complete days from the dashboard after the archive's last day
export function adsFrom(archive, live = []) {
  if (!archive?.days && !live?.length) return null
  const kinds = Object.fromEntries(Object.entries(archive?.ads || {}).map(([id, x]) => [id, kindOf(x.set, x.total)]))
  const days = {}
  for (const [d, ads] of Object.entries(archive?.days || {})) {
    const o = { spend: 0, spendChat: 0, spendForm: 0, spendReach: 0, chats: 0, forms: 0, deep: 0 }
    for (const [id, v] of Object.entries(ads || {})) {
      const k = kinds[id] || 'other'
      o.spend += v[0] || 0
      if (k === 'chat') { o.spendChat += v[0] || 0; o.chats += v[3] || 0; o.deep += v[5] || 0 } else if (k === 'form') { o.spendForm += v[0] || 0; o.forms += v[4] || 0 } else o.spendReach += v[0] || 0
    }
    days[d] = o
  }
  const until0 = archive?.until || (archive?.day ? addDays(archive.day, -1) : null)
  for (const x of live || []) {
    if (!x?.date || (until0 && x.date <= until0) || days[x.date]) continue
    days[x.date] = { spend: x.spend || 0, spendChat: x.spendChat || 0, spendForm: x.spendForm || 0, spendReach: x.spendReach || 0, chats: x.chatChats || 0, forms: x.formLeads || 0, deep: x.chatDeep || 0 }
  }
  const dates = Object.keys(days).sort()
  if (!dates.length) return null
  const until = [until0, ...(live || []).map((x) => x.date)].filter(Boolean).sort().at(-1) || dates.at(-1)
  return { days, first: dates[0], until, currency: archive?.currency || 'USD' }
}

// everything a report needs, read once. `live` (optional) is the dashboard data: its ad days fill what the archive lacks.
export async function loadSources({ portal, crm, meta, live } = {}) {
  const src = { today: ymd(new Date()), errors: [] }
  if (portal?.status?.().configured) {
    try {
      const [a, h] = await Promise.all([portal.get('/api/analytics/apartments'), portal.get('/api/analytics/status-history')])
      let pay = null
      try { pay = await portal.get('/api/analytics/payments') } catch (e) { src.errors.push(`оплаты шахматки: ${e.message}`) }
      src.chess = chessFrom(a, h, pay)
    } catch (e) { src.errors.push(`шахматка: ${e.message}`) }
  }
  src.extra = extraIncome()
  src.ads = adsFrom(read(path.join(P.data, 'ads', 'archive.json'), null), live?.ads?.days || [])
  src.insta = instaHistory().days || {}
  src.followers = followerLog()
  src.stories = Object.values(storyArchive())
  if (crm?.data?.leads) {
    src.leads = realLeads(Object.values(crm.data.leads))
    src.words = crm.refusalWords?.() || {}
    src.crmFirst = src.leads.reduce((m, l) => (l.created_at && (!m || ymd(new Date(l.created_at)) < m) ? ymd(new Date(l.created_at)) : m), null)
  }
  if (meta?.m?.token && meta.m.igUserId) {
    try { src.media = await mediaList(meta) } catch (e) { src.errors.push(`публикации Instagram: ${e.message}`) }
  }
  return src
}

// the account's posts by day (newest first, up to ~1000): enough for every month since the account began
async function mediaList(meta) {
  const out = []
  let after = null
  for (let i = 0; i < 20; i++) {
    const r = await meta.api(`${meta.m.igUserId}/media`, { fields: 'timestamp,media_type,media_product_type', limit: 50, ...(after ? { after } : {}) })
    for (const x of r.data || []) out.push({ day: ymd(new Date(x.timestamp)), reels: x.media_product_type === 'REELS', carousel: x.media_type === 'CAROUSEL_ALBUM' })
    after = r.paging?.cursors?.after
    if (!after || !r.paging?.next) return { list: out, all: true }
  }
  return { list: out, all: false }
}

// ---------- one period ----------

const dayOf = (iso) => (iso ? ymd(new Date(iso)) : null)
// a refusal: the Ерлан's category when he read the note, else the CRM reason; «Другое: …» counts as «Другое»
export function refusalOf(l, words = {}) {
  const w = words[l.id]
  if (w?.reason) return { reason: w.reason, words: w.words || '' }
  const r = l.refusal_reason || 'Причина не указана'
  return { reason: r.startsWith('Другое') ? 'Другое' : r, words: '' }
}

// the stock at the end of a day: today's statuses rewound through the log
function stockAt(chess, day) {
  if (!chess || (chess.logSince && day < chess.logSince)) return null
  const st = new Map(chess.flats.map((x) => [x.n, x.st]))
  for (let i = chess.log.length - 1; i >= 0; i--) {
    const c = chess.log[i]
    if (c.day <= day) break
    if (st.has(c.number)) st.set(c.number, c.from)
  }
  const v = [...st.values()]
  const free = v.filter((s) => s === 'Свободна').length, booked = v.filter((s) => s === 'Бронь').length, sold = v.filter((s) => SOLD.includes(s)).length
  return { free, booked, sold, left: free + booked }
}

// All numbers of the days from..to (inclusive). null = unknown (no source or no data for the days), never 0.
export function periodFacts(src, from, to) {
  const out = { from, to }
  const ch = src.chess
  if (ch && (!ch.logSince || ch.logSince <= to)) {
    const s = salesIn(ch.log, addDays(from, -1), to)
    const flat = (c) => ch.byNum.get(c.number) || {}
    const sign = [...s.deals.map((c) => [c, 1]), ...s.cancels.map((c) => [c, -1])]
    const sum = (key) => sign.reduce((t, [c, k]) => { const o = key(flat(c), c); if (o != null) t[o] = (t[o] || 0) + k; return t }, {})
    const ppm = s.deals.map((c) => flat(c)).map((f) => f.ppm || (f.price && f.m2 ? f.price / f.m2 : null)).filter(Boolean)
    out.sales = {
      net: s.net, deals: s.deals.length, cancels: s.cancels.length, bookings: s.bookings, unbooked: s.unbooked,
      m2: round(sign.reduce((t, [c, k]) => t + k * (flat(c).m2 || 0), 0), 1),
      ppm: ppm.length ? Math.round(ppm.reduce((t, v) => t + v, 0) / ppm.length) : null,
      rooms: sum((f) => (f.r ? `${f.r}-комн.` : 'комнатность не указана')), floors: sum((f) => floorBand(f.f)),
      pay: sum((f, c) => (c.to === 'Рассрочка' ? 'Рассрочка' : 'Полная оплата')),
      list: s.deals.map((c) => c.number),
    }
    const m = ch.pay ? received(ch.events, addDays(from, -1), to) : null
    out.money = m ? { received: Math.round(m.revenue), booking: Math.round(m.booking), first: Math.round(m.first), installment: Math.round(m.installment), full: Math.round(m.full) } : null
    out.stock = stockAt(ch, to)
  } else { out.sales = null; out.money = null; out.stock = null }
  out.extra = (src.extra || []).filter((x) => inRange(x.date, from, to)).reduce((t, x) => t + Number(x.amount || 0), 0)

  if (src.leads && src.crmFirst && src.crmFirst <= to) {
    const list = src.leads.filter((l) => inRange(dayOf(l.created_at), from, to))
    const lost = src.leads.filter((l) => l.stage === 'lost' && inRange(dayOf(l.stage_at || l.updated_at || l.created_at), from, to))
    const reasons = lost.map((l) => refusalOf(l, src.words))
    out.leads = {
      total: list.length,
      consult: list.filter((l) => topStage(l) >= STAGE_ORDER.qualified).length,
      booking: list.filter((l) => topStage(l) >= STAGE_ORDER.booking).length,
      sale: list.filter((l) => l.stage === 'sale').length,
      nonTarget: list.filter(isNonTarget).length,
      sources: count(list, (l) => leadChannel(l).label),
      refusals: count(reasons, (r) => r.reason),
      lost: lost.length,
    }
    out.words = reasons.filter((r) => r.words).slice(0, 12)
    // buyers: the deals of the chessboard; the CRM tells the source of those it knows, the rest is «источник неизвестен»
    const bought = src.leads.filter((l) => l.stage === 'sale' && inRange(dayOf(l.deal_at || l.stage_at || l.updated_at), from, to))
    const sources = count(bought, (l) => leadChannel(l).label)
    const deals = out.sales?.net ?? bought.length
    const unknown = Math.max(0, deals - bought.length)
    if (unknown) sources['Источник неизвестен'] = (sources['Источник неизвестен'] || 0) + unknown
    out.buyers = { sources, total: Math.max(deals, bought.length), known: bought.filter((l) => leadChannel(l).key !== 'unknown').length }
  } else { out.leads = null; out.buyers = null; out.words = [] }

  const ads = src.ads
  if (ads && ads.first <= to && ads.until >= from) {
    const o = { spend: 0, spendChat: 0, spendForm: 0, spendReach: 0, chats: 0, forms: 0, deep: 0, spendKzt: 0 }
    let approx = false, noRate = false
    for (let d = from; d <= to && d <= ads.until; d = addDays(d, 1)) {
      const x = ads.days[d]
      if (!x) continue
      for (const k of Object.keys(o)) if (k !== 'spendKzt') o[k] += x[k] || 0
      if (/KZT|₸/i.test(ads.currency)) o.spendKzt += x.spend
      else if (x.spend) {
        const r = rateOn(d) || firstRate()
        if (!rateOn(d)) approx = true
        if (r) o.spendKzt += x.spend * r.usd; else noRate = true
      }
    }
    if (noRate) o.spendKzt = null
    const paid = o.chats + o.forms
    out.ads = { currency: ads.currency, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : /spend/.test(k) ? round(v) : v])), spendKzt: o.spendKzt == null ? null : Math.round(o.spendKzt), kztApprox: approx || undefined, cpr: paid ? round((o.spendChat + o.spendForm) / paid) : null }
  } else out.ads = null

  out.insta = instaFacts(src, from, to)
  return out
}

let first
function firstRate() {
  if (first) return first
  // the earliest known rate stands in for the days before it
  try {
    const f = JSON.parse(fs.readFileSync(path.join(P.data, 'fx.json'), 'utf8'))
    const k = Object.keys(f.days || {}).sort()[0]
    first = k ? { usd: f.days[k], date: k } : f.usd ? { usd: f.usd, date: f.date } : null
  } catch { first = null }
  return first
}

function instaFacts(src, from, to) {
  const days = src.insta || {}
  const known = Object.keys(days).filter((d) => inRange(d, from, to))
  const sum = (k) => { const v = known.map((d) => days[d][k]).filter((x) => x != null); return v.length ? v.reduce((t, x) => t + x, 0) : null }
  const fullDays = known.filter((d) => days[d].follows != null && days[d].unfollows != null)
  const total = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) + 1
  // followers at the end: the office's hourly log, else today's count minus every known follow after the period
  let followersEnd = null, approx = false
  const log = src.followers || []
  const onOrBefore = log.filter(([t]) => ymd(new Date(t)) <= to)
  if (onOrBefore.length && ymd(new Date(onOrBefore.at(-1)[0])) >= from) followersEnd = onOrBefore.at(-1)[1]
  else if (log.length) {
    let n = log.at(-1)[1], ok = true
    for (let d = addDays(to, 1); d < ymd(new Date(log.at(-1)[0])); d = addDays(d, 1)) {
      const x = days[d]
      if (x?.follows == null || x?.unfollows == null) { ok = false; break }
      n -= x.follows - x.unfollows
    }
    // a negative or zero count means the history of follows is incomplete: unknown, not a number
    if (ok && n > 0) { followersEnd = n; approx = true }
  }
  const media = src.media?.list?.filter((x) => inRange(x.day, from, to))
  const mediaKnown = src.media && (src.media.all || src.media.list.some((x) => x.day < from))
  const stories = src.stories?.length && src.stories.some((s) => dayOf(s.date) <= from) ? src.stories.filter((s) => inRange(dayOf(s.date), from, to)).length : null
  if (!known.length && followersEnd == null && !media?.length) return null
  const follows = fullDays.length ? fullDays.reduce((t, d) => t + days[d].follows, 0) : null
  const unfollows = fullDays.length ? fullDays.reduce((t, d) => t + days[d].unfollows, 0) : null
  return {
    followersEnd, followersApprox: approx || undefined,
    follows, unfollows, net: follows == null ? null : follows - unfollows, netDays: fullDays.length, days: total,
    reach: sum('reach'), profileViews: sum('profile_views'), reachDays: known.filter((d) => days[d].reach != null).length,
    posts: mediaKnown ? media.filter((x) => !x.reels).length : null, reels: mediaKnown ? media.filter((x) => x.reels).length : null,
    carousels: mediaKnown ? media.filter((x) => x.carousel).length : null, stories,
  }
}

// ---------- months ----------

export function readBook() {
  const b = read(FILE, null)
  return b && b.months ? b : { v: 1, months: {}, current: null }
}
const saveBook = (b) => write(FILE, b)

// what each part of a month lacks, in the owner's words
function notesOf(src, key, f, partial) {
  const name = monthName(key), out = {}
  const from = `${key}-01`, to = f.to
  const ch = src.chess
  if (!ch) out.sales = src.errors?.find((e) => e.startsWith('шахматка')) ? 'шахматка не ответила' : 'шахматка не подключена'
  else if (ch.logSince && ch.logSince > to) out.sales = `журнал шахматки начат ${ru(ch.logSince)} — продаж за ${name} нет`
  else if (ch.logSince && ch.logSince > from) out.sales = `журнал шахматки начат ${ru(ch.logSince)} — продажи за ${name} неполные`
  if (ch && !ch.pay) out.money = 'оплаты из шахматки не прочитались'
  if (!src.leads) out.leads = 'CRM не подключена'
  else if (!src.crmFirst || src.crmFirst > to) out.leads = `CRM ведётся с ${ru(src.crmFirst)} — клиентов за ${name} нет`
  else if (src.crmFirst > from) out.leads = `CRM ведётся с ${ru(src.crmFirst)} — клиенты за ${name} неполные`
  const ads = src.ads
  if (!ads) out.ads = 'архива рекламы нет'
  else if (ads.first > to) out.ads = 'рекламы в этом месяце не было'
  else if (ads.first > from) out.ads = `архив рекламы начат ${ru(ads.first)}`
  else if (ads.until < to) out.ads = `реклама по ${ru(ads.until)}`
  if (f.ads?.kztApprox) out.fx = 'курс доллара за часть дней неизвестен — в тенге по ближайшему известному курсу'
  const i = f.insta
  if (!i) out.insta = 'истории Instagram за этот месяц нет'
  else {
    const gaps = []
    if (i.netDays < i.days) gaps.push(i.netDays ? `подписки и отписки — за ${i.netDays} дн. из ${i.days}` : 'подписок и отписок нет')
    if (i.followersApprox) gaps.push('подписчики на конец — расчётом (сегодня минус подписки после)')
    if (i.posts == null) gaps.push('публикации неизвестны')
    if (i.stories == null) gaps.push('сторис офис записывает с 19.11.2026')
    if (gaps.length) out.insta = gaps.join('; ')
  }
  if (partial) out.month = `${name} ещё идёт — данные по ${ru(to)}`
  return out
}

export function monthRecord(src, key, { goals = null } = {}) {
  const today = src.today || ymd(new Date())
  const last = lastDayOf(key)
  const partial = last >= today
  const to = partial ? addDays(today, -1) : last
  const f = periodFacts(src, `${key}-01`, to)
  const values = { sales: f.sales, money: f.money, extra: f.extra, stock: f.stock, leads: f.leads, buyers: f.buyers, words: f.words, ads: f.ads, insta: f.insta, goals }
  return { key, from: `${key}-01`, to, partial, at: new Date().toISOString(), values, complete: notesOf(src, key, f, partial) }
}

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? null : x[k]), o)
const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ||= {}; x[ks.at(-1)] = v }

// a closed month against a fresh calculation: empty parts are filled, protected numbers that differ become revisions
export function reconcile(closed, fresh) {
  const at = new Date().toISOString()
  closed.revisions ||= []
  let changed = false
  for (const [g, v] of Object.entries(fresh.values)) {
    if (g === 'goals' || v == null || closed.values[g] != null) continue
    closed.values[g] = v
    if (fresh.complete[g]) closed.complete[g] = fresh.complete[g]; else delete closed.complete[g]
    closed.revisions.push({ at, field: g, filled: true })
    changed = true
  }
  for (const p of TRACK) {
    const was = getPath(closed.values, p), now = getPath(fresh.values, p)
    if (was == null || now == null || Math.abs(was - now) < 0.5) continue
    const lastRev = closed.revisions.filter((r) => r.field === p).at(-1)
    if (lastRev && lastRev.now === now) continue
    closed.revisions.push({ at, field: p, was, now })
    changed = true
  }
  closed.revisions = closed.revisions.slice(-50)
  return changed
}

// the months the archives can tell about, oldest first, up to the last complete one
export function knownMonths(src) {
  const firsts = [src.chess?.logSince, src.ads?.first, Object.keys(src.insta || {}).sort()[0], src.crmFirst].filter(Boolean).sort()
  if (!firsts.length) return []
  const end = (src.today || ymd(new Date())).slice(0, 7)
  const out = []
  for (let k = firsts[0].slice(0, 7); k < end; k = nextMonth(k)) out.push(k)
  return out
}

// Daily: backfill missing months, close the month that ended, check closed months for revisions, refresh the current one.
// goalsOf(key) gives the approved goals of that month (initiative state), or null.
export function refreshBook(src, { goalsOf = () => null } = {}) {
  const book = readBook()
  const today = src.today || ymd(new Date())
  const cur = today.slice(0, 7)
  const closedNow = []
  for (const key of knownMonths(src)) {
    const fresh = monthRecord(src, key, { goals: goalsOf(key) })
    const old = book.months[key]
    if (!old) {
      const backfilled = !book.current || book.current.key !== key
      book.months[key] = { ...fresh, closedAt: new Date().toISOString(), ...(backfilled ? { backfilled: true } : {}), revisions: [] }
      // the goals of the month were known while it ran: they stay with it
      if (book.current?.key === key && book.current.values.goals && !fresh.values.goals) book.months[key].values.goals = book.current.values.goals
      closedNow.push(key)
    } else reconcile(old, fresh)
  }
  // on the 1st the new month has no complete day yet
  book.current = today > `${cur}-01` ? monthRecord(src, cur, { goals: goalsOf(cur) }) : null
  book.at = new Date().toISOString()
  saveBook(book)
  return { book, closed: closedNow }
}

// every month, oldest first, the current one last (marked partial)
export function allMonths(book = readBook()) {
  const list = Object.values(book.months).sort((a, b) => a.key.localeCompare(b.key))
  if (book.current && !book.months[book.current.key]) list.push(book.current)
  return list
}

export function setMonthReport(key, report) {
  const book = readBook()
  const m = book.months[key]
  if (!m) return
  m.report = report
  saveBook(book)
}
