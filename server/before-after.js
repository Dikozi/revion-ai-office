// «Тогда → Сейчас»: the case for a client — what changed after REVION started (owner's request 18.11.2026).
// Тогда = the three calendar months before REVION started (June–August 2026), Сейчас = from the start up to
// yesterday (September 2026 on). Real sums and real counts, month by month and in total (owner's decision
// 18.11.2026: no «per 30 days»); the current month is marked as not finished.
// Plain code, no Claude: chessboard (money, sales, bookings, stock), Instagram, the office's own work.
// The files show the real numbers month by month (owner's decision 18.11.2026: «прям на цифрах»);
// caveats and errors for the owner go only to Telegram.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { moneyEvents, received, extraIncome, undatedMoney } from './payments.js'
import { SOLD, readLog, soldDays, isSale, isCancel, isBooking, kzDay } from './sales-rules.js'
import { htmlToPdf } from './render.js'
import { writeXlsx } from './xlsx.js'

export const START = '2026-09' // REVION's first month (the office moved to the server on 08.10, the team began in September)
const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const dayCount = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5) + 1
const unix = (date, end = false) => Math.floor(new Date(`${date}T${end ? '23:59:59' : '00:00:00'}+05:00`).getTime() / 1000)
const ru = (day) => (day ? day.split('-').reverse().join('.') : '')
const avg = (v) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : null)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const plural = (n, one, few, many) => { const a = Math.abs(n) % 10, b = Math.abs(n) % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many }

// three months before the start, then every month from the start up to yesterday (today is not complete yet)
export function monthsOf(today, start = START) {
  const end = addDays(today, -1), endKey = end.slice(0, 7)
  const [sy, sm] = start.split('-').map(Number)
  const out = []
  for (let d = new Date(Date.UTC(sy, sm - 4, 1)); d.toISOString().slice(0, 7) <= endKey; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const key = d.toISOString().slice(0, 7)
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    const to = key === endKey ? end : last
    out.push({ key, label: MONTH[d.getUTCMonth()], gen: GEN[d.getUTCMonth()], year: d.getUTCFullYear(), from: `${key}-01`, to, days: dayCount(`${key}-01`, to), now: key >= start, partial: to < last })
  }
  return out
}

const inMonth = (m, day) => day >= m.from && day <= m.to

// ---------- 1. chessboard: money, sales, bookings, stock ----------

export function chessboard({ a, h, pay, months }) {
  const notes = [], owner = []
  const flats = a.apartments.map((x) => ({ n: x.number, r: x.rooms, m2: x.area_m2, price: x.price_kzt, ppm: x.price_per_m2_kzt, st: x.status, since: kzDay(x.status_changed_at) }))
  const byNum = new Map(flats.map((x) => [x.n, x]))
  // one sales rule with the portal (sales-rules.js): Almaty days, net of cancellations, client moves left out
  const log = readLog(h.changes)
  const logSince = a.history_since ? kzDay(a.history_since) : log[0]?.day || ''
  for (const [n, day] of soldDays(log)) if (byNum.has(n)) byNum.get(n).soldAt = day
  const sales = [], bookings = []
  for (const c of log) {
    // a cancelled pre-log sale (`preLog`): its +1 is in no month, so its −1 is not counted either
    if (isSale(c)) sales.push({ day: c.day, n: c.number, sign: 1 })
    else if (isCancel(c) && !c.preLog) sales.push({ day: c.day, n: c.number, sign: -1 })
    if (isBooking(c)) bookings.push(c.day)
  }
  // sold before the log started: the chessboard knows no date for them (status_changed_at comes from the log too),
  // so they are in no month — neither «Тогда» nor «Сейчас»
  let undated = 0
  for (const f of flats) if (SOLD.includes(f.st) && !f.soldAt) undated++
  // bookings before the log are known only from booking payments: not comparable with the log
  const bookingsOk = !logSince || logSince <= months[0].from
  // «Тогда» lacks the sales made before the log: no growth is drawn against such a base
  const salesGap = !!logSince && logSince > months[0].from && undated > 0
  if (logSince && logSince > months[0].from) {
    notes.push(`Журнал статусов в шахматке ведётся с ${ru(logSince)}; день продажи раньше этой даты шахматка не знает.`)
    owner.push(`Журнал статусов с ${ru(logSince)}: брони до него не сравнить (только по оплатам брони), поэтому клиенту брони не показаны.`)
    for (const p of pay?.flats || []) { const d = String(p.booking?.date || '').slice(0, 10); if (d && p.booking?.amount && d < logSince) bookings.push(d) }
  }
  if (undated) {
    notes.push(`Продано до начала журнала в неизвестный день: ${undated} кв. — в помесячных продажах не учтены${salesGap ? ', в том числе в «Тогда»: база «Тогда» по продажам и м² неполная, рост по ним не считаем' : ''}.`)
    owner.push(`Без даты продажи: ${undated} кв. — не вошли ни в «Тогда», ни в «Сейчас»${salesGap ? '; «Тогда» по продажам неполное, поэтому вместо роста стоит «база неполная»' : ''}.`)
  }
  if (!pay) { notes.push('Выручка посчитана по цене проданных квартир на дату продажи.'); owner.push('⚠️ Оплаты из шахматки не прочитались — выручка посчитана по ценам квартир.') }
  // «Продана» without payments and without a sale date: its money is in no month
  const lost = undatedMoney(flats, pay?.flats || null)
  const revenueGap = lost.length > 0 && !!logSince && logSince > months[0].from
  if (lost.length) {
    notes.push(`Деньги ${lost.length} ${plural(lost.length, 'квартиры', 'квартир', 'квартир')} «Продана» без внесённых оплат и без даты продажи (≈${mln(lost.reduce((t, x) => t + x.amount, 0))}) не вошли ни в один месяц${revenueGap ? '; база «Тогда» по выручке может быть неполной, рост выручки не считаем' : ''}.`)
    owner.push(`Без даты оплаты: кв. ${lost.map((x) => x.n).join(', ')} («Продана», оплаты не внесены) — внесите оплаты в шахматке, тогда деньги встанут в свой месяц.`)
  }
  // money of this phase only: data/extra-income.json (another phase) is never in revenue, only shown apart
  const events = moneyEvents(flats, pay?.flats || null)
  const extraList = extraIncome()
  const extra = months.map((m) => extraList.filter((x) => inMonth(m, x.date)).reduce((t, x) => t + Number(x.amount), 0))
  const rows = months.map((m, i) => {
    const s = sales.filter((x) => inMonth(m, x.day))
    const ppm = s.filter((x) => x.sign > 0).map((x) => byNum.get(x.n)).filter(Boolean).map((f) => f.ppm || (f.price && f.m2 ? f.price / f.m2 : null)).filter(Boolean)
    return {
      key: m.key, revenue: Math.round(received(events, addDays(m.from, -1), m.to).revenue), extra: extra[i],
      sales: s.reduce((t, x) => t + x.sign, 0), bookings: bookings.filter((d) => inMonth(m, d)).length,
      m2: s.reduce((t, x) => t + x.sign * (byNum.get(x.n)?.m2 || 0), 0), ppmList: ppm,
    }
  })
  const sellable = flats.filter((x) => SOLD.includes(x.st) || x.st === 'Свободна' || x.st === 'Бронь').length
  const soldNow = flats.filter((x) => SOLD.includes(x.st)).length
  // sold at the end of «тогда» = sold now minus every net change after it in the log
  const thenEnd = months.filter((m) => !m.now).at(-1).to
  let after = 0
  for (const c of log) {
    if (c.day <= thenEnd) continue
    if (isSale(c)) after++
    else if (isCancel(c)) after--
  }
  const soldThen = soldNow - after
  return { rows, sellable, soldNow, soldThen, logSince, bookingsOk, gap: { sales: salesGap, revenue: revenueGap || (!pay && salesGap), undated, lost: lost.length }, notes, owner }
}

// ---------- 2. Instagram ----------

async function instagram(meta, months) {
  const id = meta.m.igUserId
  const notes = [], owner = []
  const acc = await meta.api(id, { fields: 'username,followers_count,media_count' })
  const start = months[0].from
  const media = []
  let after = null
  for (let page = 0; page < 30; page++) {
    const r = await meta.api(`${id}/media`, { fields: 'id,timestamp,media_type,media_product_type,like_count,comments_count,permalink,caption', limit: 50, ...(after ? { after } : {}) }).catch((e) => { owner.push(`Список публикаций Instagram прочитан не полностью: ${e.message}`); return null })
    if (!r) break
    for (const x of r.data || []) media.push({ id: x.id, day: ymd(new Date(x.timestamp)), reels: x.media_product_type === 'REELS', carousel: x.media_type === 'CAROUSEL_ALBUM', likes: Number(x.like_count) || 0, comments: Number(x.comments_count) || 0, link: x.permalink || '', caption: String(x.caption || '').replace(/\s+/g, ' ').slice(0, 70) })
    after = r.paging?.cursors?.after
    if (!after || !r.paging?.next || (media.at(-1)?.day || '') < start) break
  }
  const inRange = media.filter((x) => x.day >= start)
  // the reach of every post, four at a time
  for (let i = 0; i < inRange.length; i += 4) {
    await Promise.all(inRange.slice(i, i + 4).map(async (x) => {
      const r = await meta.insights(x.id, ['reach'], { period: 'lifetime' }).catch(() => ({}))
      const v = Array.isArray(r.reach) ? r.reach[0]?.value : r.reach
      x.reach = Number.isFinite(Number(v)) && v != null ? Number(v) : null
    }))
  }
  // follows and account reach per month, in halves (Meta takes at most 30 days at once)
  const tv = async (metric, from, to, extra = {}) => (await meta.api(`${id}/insights`, { metric, period: 'day', metric_type: 'total_value', since: unix(from), until: unix(to, true), ...extra }).catch(() => null))
  let followsKnown = 0, reachKnown = 0
  const rows = []
  for (const m of months) {
    const halves = m.days > 16 ? [[m.from, addDays(m.from, 14)], [addDays(m.from, 15), m.to]] : [[m.from, m.to]]
    let follows = 0, unfollows = 0, reach = 0, fOk = 0, rOk = 0
    const extra = { views: [0, 0], profile_views: [0, 0], total_interactions: [0, 0] } // [sum, halves answered]
    for (const [from, to] of halves) {
      const f = await tv('follows_and_unfollows', from, to, { breakdown: 'follow_type' })
      const res = f?.data?.[0]?.total_value?.breakdowns?.[0]?.results
      if (res) { fOk++; for (const x of res) { if (x.dimension_values?.[0] === 'FOLLOWER') follows += x.value; if (x.dimension_values?.[0] === 'NON_FOLLOWER') unfollows += x.value } }
      const r = await tv('reach', from, to)
      const v = r?.data?.[0]?.total_value?.value
      if (v != null) { rOk++; reach += Number(v) }
      // views, profile visits, interactions: one call, or one by one if Meta rejects a metric
      let got = await tv(Object.keys(extra).join(','), from, to)
      if (!got) { got = { data: [] }; for (const k of Object.keys(extra)) got.data.push(...((await tv(k, from, to))?.data || [])) }
      for (const d of got.data || []) if (extra[d.name] && d.total_value?.value != null) { extra[d.name][0] += Number(d.total_value.value); extra[d.name][1]++ }
    }
    // a month counts only if Meta answered for all its parts
    const fAll = fOk === halves.length, rAll = rOk === halves.length
    const x = (k) => (extra[k][1] === halves.length ? extra[k][0] : null)
    if (fAll) followsKnown++
    if (rAll) reachKnown++
    const posts = inRange.filter((x) => inMonth(m, x.day))
    const reaches = posts.map((x) => x.reach).filter((v) => v != null)
    rows.push({
      key: m.key, posts: posts.length, reels: posts.filter((x) => x.reels).length, carousels: posts.filter((x) => x.carousel).length,
      likes: posts.length ? avg(posts.map((x) => x.likes + x.comments)) : null, postReach: reaches.length ? avg(reaches) : null,
      follows: fAll ? follows : null, unfollows: fAll ? unfollows : null, net: fAll ? follows - unfollows : null, reach: rAll ? reach : null,
      views: x('views'), profileViews: x('profile_views'), interactions: x('total_interactions'),
    })
  }
  // followers at the end of each month: today's count minus the net follows after that month
  for (let i = rows.length - 1, later = 0, known = true; i >= 0; i--) {
    rows[i].endFollowers = known && acc.followers_count != null ? acc.followers_count - later : null
    if (rows[i].net == null) known = false; else later += rows[i].net
  }
  // the best posts of each period by reach
  const best = (list) => list.filter((x) => x.reach != null).sort((a, b) => b.reach - a.reach).slice(0, 3)
  const nowFrom = months.find((m) => m.now)?.from
  const top = { then: best(inRange.filter((x) => x.day < nowFrom)), now: best(inRange.filter((x) => x.day >= nowFrom)) }
  if (followsKnown < months.length) notes.push(`Подписки и отписки Meta отдала за ${followsKnown} из ${months.length} месяцев — где пусто, Instagram не хранит эти данные так долго.`)
  if (reachKnown && reachKnown < months.length) notes.push(`Охват аккаунта есть за ${reachKnown} из ${months.length} месяцев.`)
  if (reachKnown) notes.push('Охват аккаунта за месяц сложен из двух половин месяца (так отдаёт Meta), поэтому он немного больше настоящего числа уникальных людей; «Тогда» и «Сейчас» считаются одинаково.')
  if (rows.some((r) => r.endFollowers != null)) notes.push('Подписчиков на конец месяца = сегодняшнее число минус подписки и отписки после этого месяца (по данным Meta); может немного отличаться от того, что показывал Instagram в тот день.')
  return { username: acc.username, followers: acc.followers_count, rows, top, notes, owner }
}

// ---------- 3. the office's own work ----------

function officeWork({ store, smmPack, initiative, employees, months }) {
  const day = (iso) => (iso ? ymd(new Date(iso)) : '')
  const done = store.tasks.filter((t) => t.status === 'done' && t.finishedAt)
  const published = (smmPack?.state?.packs || []).flatMap((p) => p.items).filter((x) => x.status === 'published' && x.publishedAt)
  const decided = (initiative?.state?.proposals || []).filter((p) => p.status === 'accepted' && p.decidedAt)
  const rows = months.map((m) => {
    const t = done.filter((x) => inMonth(m, day(x.finishedAt)))
    return {
      key: m.key, tasks: t.length,
      reports: t.filter((x) => ['weekly', 'director-report', 'content-plan', 'week-goal'].includes(x.source)).length,
      designs: t.filter((x) => ['smm', 'montazh'].includes(x.employee)).length,
      published: published.filter((x) => inMonth(m, day(x.publishedAt))).length,
      videos: published.filter((x) => inMonth(m, day(x.publishedAt)) && x.asVideo).length,
      decisions: decided.filter((p) => inMonth(m, day(p.decidedAt))).length,
    }
  })
  const now = months.filter((m) => m.now)
  const people = employees.filter((e) => e.active !== false).map((e) => ({
    name: e.name || e.id, title: e.title, tasks: done.filter((t) => t.employee === e.id && now.some((m) => inMonth(m, day(t.finishedAt)))).length,
  })).filter((x) => x.tasks).sort((a, b) => b.tasks - a.tasks)
  return { rows, people }
}

// ---------- the numbers for both versions ----------

export function summarize({ months, board, insta, office }) {
  const then = months.filter((m) => !m.now), now = months.filter((m) => m.now)
  const pick = (rows, key, list) => rows.filter((r) => list.some((m) => m.key === r.key)).map((r) => r[key])
  const total = (rows, key, list) => { const v = pick(rows, key, list); return v.every((x) => x == null) ? null : v.reduce((t, x) => t + (x || 0), 0) }
  const mean = (rows, key, list) => avg(pick(rows, key, list).filter((x) => x != null))
  // a ratio only against a positive base: a zero or negative «тогда» says nothing about growth
  const pair = (t, n) => ({ then: t, now: n, ratio: t > 0 && n != null ? n / t : null, pct: t > 0 && n != null ? (n / t - 1) * 100 : null })
  const s = {}
  if (board) {
    const b = board.rows
    s.revenue = pair(total(b, 'revenue', then), total(b, 'revenue', now))
    s.sales = pair(total(b, 'sales', then), total(b, 'sales', now))
    s.bookingsRaw = pair(total(b, 'bookings', then), total(b, 'bookings', now))
    s.bookings = board.bookingsOk ? s.bookingsRaw : null
    s.m2 = pair(total(b, 'm2', then), total(b, 'm2', now))
    // price per m²: the mean over every sale of the period, not a mean of monthly means
    s.ppm = pair(avg(pick(b, 'ppmList', then).flat()), avg(pick(b, 'ppmList', now).flat()))
    // an incomplete «Тогда» (sales before the status log, money without a date) gives no growth figure
    const gap = (p) => (p ? { ...p, ratio: null, pct: null, partial: true } : p)
    if (board.gap?.sales) { s.sales = gap(s.sales); s.m2 = gap(s.m2); s.ppm = gap(s.ppm) }
    if (board.gap?.revenue) s.revenue = gap(s.revenue)
    s.extra = { then: pick(b, 'extra', then).reduce((t, x) => t + x, 0), now: pick(b, 'extra', now).reduce((t, x) => t + x, 0) }
    s.share = { then: board.sellable ? board.soldThen / board.sellable : null, now: board.sellable ? board.soldNow / board.sellable : null }
  }
  if (insta) {
    const r = insta.rows
    s.posts = pair(total(r, 'posts', then), total(r, 'posts', now))
    s.reels = pair(total(r, 'reels', then), total(r, 'reels', now))
    s.postReach = pair(mean(r, 'postReach', then), mean(r, 'postReach', now))
    s.likes = pair(mean(r, 'likes', then), mean(r, 'likes', now))
    const known = (key, list) => list.every((m) => r.find((x) => x.key === m.key)?.[key] != null)
    // a period Meta did not answer for shows «—», the other one still shows its real total
    const both = (key) => { const t = known(key, then) ? total(r, key, then) : null, n = known(key, now) ? total(r, key, now) : null; return t == null && n == null ? null : pair(t, n) }
    s.follows = both('follows'); s.unfollows = both('unfollows'); s.net = both('net'); s.reach = both('reach')
    s.views = both('views'); s.profileViews = both('profileViews'); s.interactions = both('interactions')
    const end = r.find((x) => x.key === then.at(-1).key)?.endFollowers, first = r[0]?.endFollowers != null && r[0]?.net != null ? r[0].endFollowers - r[0].net : null
    s.followers = { start: first, thenEnd: end ?? null, now: insta.followers ?? null }
  }
  if (office) {
    const o = office.rows.filter((x) => now.some((m) => m.key === x.key))
    const sum = (key) => o.reduce((t, x) => t + x[key], 0)
    s.office = { tasks: sum('tasks'), reports: sum('reports'), designs: sum('designs'), published: sum('published'), videos: sum('videos'), decisions: sum('decisions') }
  }
  return s
}

// ---------- formatting ----------

const n1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('ru-RU').replace(/ /g, ' '))
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' '))
const pct = (v) => (v == null ? '—' : Math.abs(v) < 0.5 ? '0%' : `${v >= 0 ? '+' : '−'}${n0(Math.abs(v))}%`)
// «×2,3» for big growth, «+35%» otherwise; nothing against a zero or negative base
export function change(p) {
  if (!p || p.then == null || p.now == null) return '—'
  if (p.partial) return 'база неполная'
  if (!(p.then > 0)) return p.then === 0 && p.now > 0 ? 'с нуля' : '—'
  return p.ratio >= 1.95 ? `×${n1(p.ratio)}` : pct(p.pct)
}
const ok = (p) => p && (p.ratio != null || p.partial)
const up = (p) => (p?.ratio == null || Math.abs(p.pct) < 0.5 ? null : p.ratio >= 1)
const mlnN = (v) => (v == null ? '—' : n1(v / 1e6))
const mln = (v) => `${mlnN(v)} млн ₸`
const period = (list) => (list.length > 1 ? `${list[0].label}–${list.at(-1).label} ${list.at(-1).year}` : `${list[0].label} ${list[0].year}`)
const monthsWord = (n) => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
// how a month of «сейчас» compares with the average month of «тогда»
const vsThen = (v, base) => (base > 0 && v != null ? (v / base >= 1.95 ? `×${n1(v / base)}` : pct((v / base - 1) * 100)) : '')

// ---------- charts (inline SVG) ----------

function bars(values, { h = 120, w = 300, fmt = n0, labels, now = [], partial = [], avgLine = null, avgLabel = '' } = {}) {
  const max = Math.max(1, ...values.map((v) => v || 0), avgLine || 0)
  const bw = w / values.length
  const y = (v) => h - (v / max) * (h - 18)
  const line = avgLine > 0 ? `<line x1="0" y1="${y(avgLine)}" x2="${w}" y2="${y(avgLine)}" stroke="#7A8CA3" stroke-dasharray="4 3"/><text x="2" y="${y(avgLine) - 3}" text-anchor="start" font-size="8.5" fill="#5B6B7F">${esc(avgLabel)}</text>` : ''
  return `<svg viewBox="0 0 ${w} ${h + 34}" width="100%"><line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="#D5DCE6"/>${values.map((v, i) => {
    const bh = v > 0 ? Math.max(2, h - y(v)) : 0, x = i * bw + bw * 0.18, wd = bw * 0.64
    return `<rect x="${x}" y="${h - bh}" width="${wd}" height="${bh}" rx="4" fill="${now[i] ? '#3185E8' : '#A9BBD0'}" ${partial[i] ? 'fill-opacity=".7"' : ''}/>${v != null ? `<text x="${x + wd / 2}" y="${h - bh - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="#0B1728">${esc(fmt(v))}</text>` : ''}<text x="${x + wd / 2}" y="${h + 14}" text-anchor="middle" font-size="9.5" fill="#5B6B7F">${esc(labels[i])}${partial[i] ? '*' : ''}</text>`
  }).join('')}${line}</svg>`
}

function donut(share, color, label) {
  const r = 34, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, share || 0))
  return `<svg viewBox="0 0 100 100" width="92"><circle cx="50" cy="50" r="${r}" fill="none" stroke="#E6ECF3" stroke-width="12"/><circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="${c * v} ${c}" transform="rotate(-90 50 50)" stroke-linecap="round"/><text x="50" y="50" text-anchor="middle" font-size="17" font-weight="800" fill="#0B1728">${share == null ? '—' : `${Math.round(v * 100)}%`}</text><text x="50" y="66" text-anchor="middle" font-size="8.5" fill="#5B6B7F">${esc(label)}</text></svg>`
}

// a card «было → стало» with real numbers
function kpi(title, before, after, unit, p, sub = '') {
  const good = up(p), color = good == null ? '#0B1728' : good ? '#1E956B' : '#C2410C'
  return `<div class="kpi"><div class="kt">${esc(title)}</div><div class="kv"><span class="was">${esc(before)}</span> <span class="to">→</span> <span style="color:${color}">${esc(after)}</span> <span class="unit">${esc(unit)}</span></div><div class="ks">${p?.partial ? '<b>база «Тогда» неполная</b>' : p && change(p) !== '—' ? `<b style="color:${color}">${esc(change(p))}</b> к «Тогда»` : ''}${sub ? `${p && change(p) !== '—' ? ' · ' : ''}${esc(sub)}` : ''}</div></div>`
}

// the month table: every month with real numbers, the average month of each period and the growth
function monthTable({ months, board, insta, s }) {
  const then = months.filter((m) => !m.now)
  const cols = []
  if (board) cols.push({ h: 'Выручка, млн ₸', v: (i) => board.rows[i].revenue, f: mlnN, avg: s.revenue }, { h: 'Продажи, кв.', v: (i) => board.rows[i].sales, f: n0, avg: s.sales, one: true }, { h: 'Продано м²', v: (i) => board.rows[i].m2, f: n0, avg: s.m2 })
  if (!cols.length) return ''
  const base = (c) => avg(then.map((m) => c.v(months.indexOf(m)) ?? 0))
  const cell = (c, i) => {
    const v = c.v(i), m = months[i]
    return `<td>${esc(c.f(v))}${m.now && v != null && !c.avg?.partial ? `<span class="vs">${esc(vsThen(v, base(c)))}</span>` : ''}</td>`
  }
  const avgRow = (label, key, cls) => `<tr class="${cls}"><td>${esc(label)}</td>${cols.map((c) => `<td>${c.avg?.[key] == null ? '—' : esc(c.f(c.avg[key]))}</td>`).join('')}</tr>`
  const rows = []
  months.forEach((m, i) => {
    if (i === then.length) rows.push(avgRow(`Итого «Тогда» (${period(then)})`, 'then', 'avg'))
    rows.push(`<tr class="${m.now ? 'now' : ''}"><td>${esc(cap(m.label))}${m.partial ? ` <span class="muted">(по ${esc(ru(m.to).slice(0, 5))})</span>` : ''}</td>${cols.map((c) => cell(c, i)).join('')}</tr>`)
  })
  rows.push(avgRow(`Итого «Сейчас» (${period(months.filter((m) => m.now))}${months.at(-1).partial ? `, по ${ru(months.at(-1).to).slice(0, 5)}` : ''})`, 'now', 'avg'))
  rows.push(`<tr class="growth"><td>Рост</td>${cols.map((c) => `<td>${esc(change(c.avg))}</td>`).join('')}</tr>`)
  return `<table class="mt"><thead><tr><th>Месяц</th>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

// ---------- the Instagram page ----------

function instaPage({ months, insta, s, head, labels, isNow, partial }) {
  const then = months.filter((m) => !m.now), now = months.filter((m) => m.now)
  const r = insta.rows
  const card = (title, p, unit = '', sub = '') => (p && p.now != null ? kpi(title, n0(p.then), n0(p.now), unit, p, sub) : '')
  const f = s.followers || {}
  const fp = f.thenEnd != null && f.now != null ? { then: f.thenEnd, now: f.now, ratio: f.thenEnd > 0 ? f.now / f.thenEnd : null, pct: f.thenEnd > 0 ? (f.now / f.thenEnd - 1) * 100 : null } : null
  const cols = [
    { h: 'Подписались', k: 'follows', p: s.follows }, { h: 'Отписались', k: 'unfollows', p: s.unfollows, down: true }, { h: 'Прирост', k: 'net', p: s.net },
    { h: 'Подписчиков на конец', k: 'endFollowers', end: true }, { h: 'Охват аккаунта', k: 'reach', p: s.reach }, { h: 'Посещения профиля', k: 'profileViews', p: s.profileViews },
    { h: 'Публикаций (Reels)', k: 'posts', p: s.posts }, { h: 'Охват публикации, ср.', k: 'postReach', p: s.postReach, mean: true },
  ].filter((c) => r.some((x) => x[c.k] != null))
  const base = (c) => avg(then.map((m) => r[months.indexOf(m)][c.k]).filter((v) => v != null))
  const cell = (c, i) => {
    const v = r[i][c.k], m = months[i]
    if (v == null) return '<td>—</td>'
    const shown = c.k === 'posts' ? `${n0(v)}${r[i].reels ? ` (${r[i].reels})` : ''}` : n0(v)
    return `<td>${esc(shown)}${m.now && !c.end && !c.down && base(c) > 0 ? `<span class="vs">${esc(vsThen(v, base(c)))}</span>` : ''}</td>`
  }
  const tot = (key) => cols.map((c) => `<td>${c.end ? esc(n0(key === 'then' ? f.thenEnd : f.now)) : c.p?.[key] == null ? '—' : esc(n0(c.p[key]))}</td>`).join('')
  const rows = []
  months.forEach((m, i) => {
    if (i === then.length) rows.push(`<tr class="avg"><td>Итого «Тогда»</td>${tot('then')}</tr>`)
    rows.push(`<tr class="${m.now ? 'now' : ''}"><td>${esc(cap(m.label))}${m.partial ? '*' : ''}</td>${cols.map((c) => cell(c, i)).join('')}</tr>`)
  })
  rows.push(`<tr class="avg"><td>Итого «Сейчас»</td>${tot('now')}</tr>`)
  rows.push(`<tr class="growth"><td>Рост</td>${cols.map((c) => `<td>${esc(c.end ? (fp ? change(fp) : '—') : change(c.p))}</td>`).join('')}</tr>`)
  return `<section class="page">${head('Instagram', 3)}
    <h1 class="h1s">Instagram${insta.username ? ` @${esc(insta.username)}` : ''}: «Тогда» и «Сейчас»</h1>
    <div class="kpis k3">
      ${fp ? kpi('Подписчиков', n0(fp.then), n0(fp.now), '', fp, `конец ${then.at(-1).gen} → сейчас`) : ''}
      ${card('Новые подписчики', s.follows, '', 'итого за период')}
      ${card('Чистый прирост', s.net, '', 'подписались минус отписались')}
      ${card('Охват аккаунта', s.reach, '', 'людей увидели, итого')}
      ${card('Посещения профиля', s.profileViews, '', 'итого за период')}
      ${s.postReach?.then != null ? kpi('Охват публикации', n0(s.postReach.then), n0(s.postReach.now), '', s.postReach, 'в среднем на публикацию') : card('Публикаций', s.posts)}
    </div>
    <table class="mt it"><thead><tr><th>Месяц</th>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
    <div class="grid3">
      ${r.some((x) => x.endFollowers != null) ? `<div class="card"><h3>Подписчиков на конец месяца</h3>${bars(r.map((x) => x.endFollowers), { labels, now: isNow, partial, h: 95, fmt: (v) => (v >= 10000 ? `${n1(v / 1000)}k` : n0(v)) })}</div>` : ''}
      ${r.some((x) => x.net != null) ? `<div class="card"><h3>Прирост подписчиков</h3>${bars(r.map((x) => x.net), { labels, now: isNow, partial, h: 95 })}</div>` : `<div class="card"><h3>Средний охват публикации</h3>${bars(r.map((x) => x.postReach), { labels, now: isNow, partial, h: 95 })}</div>`}
      ${r.some((x) => x.reach != null) ? `<div class="card"><h3>Охват аккаунта</h3>${bars(r.map((x) => x.reach), { labels, now: isNow, partial, h: 95, fmt: (v) => (v >= 10000 ? `${n0(v / 1000)}k` : n0(v)) })}</div>` : ''}
    </div>
  </section>`
}

// ---------- the PDF ----------

export function pdfHtml({ months, board, insta, office, s, notes, who }) {
  const then = months.filter((m) => !m.now), now = months.filter((m) => m.now)
  const labels = months.map((m) => m.label.slice(0, 3))
  const isNow = months.map((m) => m.now), partial = months.map((m) => m.partial)
  const work = monthsWord(now.length)
  const thenAvg = (vals) => avg(vals.filter((_, i) => !months[i].now).map((v) => v || 0))
  const head = (title, page) => `<div class="top"><div class="brand"><span class="logo">R</span><b>REVION</b><span class="tag">Цифровая операционная система бизнеса</span></div><span class="pg">${esc(title)} · ${page}/${insta ? 3 : 2}</span></div>`
  const series = (key) => board.rows.map((r) => r[key])

  const page1 = `<section class="page">${head('Тогда → Сейчас', 1)}
    <div class="hero"><div class="eyebrow">Кейс · ${esc(who)}</div><h1>Что изменилось за ${esc(work)} работы с REVION</h1>
    <p class="lead"><b>«Тогда»</b> — ${esc(period(then))}, до REVION. <b>«Сейчас»</b> — ${esc(period(now))}, с REVION (по ${esc(ru(now.at(-1).to))}). Реальные суммы и количество продаж из шахматки${now.at(-1).partial ? `; ${esc(now.at(-1).label)} ещё идёт` : ''}.</p></div>
    <div class="kpis k2">
      ${board && s.revenue ? kpi('Выручка, итого за период', mlnN(s.revenue.then), mlnN(s.revenue.now), 'млн ₸', s.revenue) : ''}
      ${board && s.sales ? kpi('Продажи, итого за период', n0(s.sales.then), n0(s.sales.now), 'кв.', s.sales) : ''}
      ${board && s.share?.then != null ? kpi('Продано дома', String(board.soldThen), String(board.soldNow), `из ${board.sellable} кв.`, null, `${Math.round(s.share.then * 100)}% → ${Math.round(s.share.now * 100)}%`) : ''}
      ${insta && s.followers?.thenEnd != null ? kpi('Подписчиков в Instagram', n0(s.followers.thenEnd), n0(s.followers.now), '', { ratio: s.followers.thenEnd > 0 ? s.followers.now / s.followers.thenEnd : null, pct: s.followers.thenEnd > 0 ? (s.followers.now / s.followers.thenEnd - 1) * 100 : null, then: s.followers.thenEnd, now: s.followers.now }, `конец ${then.at(-1).gen} → сейчас`) : insta && s.follows ? kpi('Новые подписчики, итого', n0(s.follows.then), n0(s.follows.now), '', s.follows) : ''}
    </div>
    <h2>По месяцам</h2>${monthTable({ months, board, insta, s })}
  </section>`

  const revAvg = board ? thenAvg(series('revenue')) : null, salesAvg = board ? thenAvg(series('sales')) : null
  const thin = (p) => (p?.partial ? ' (база неполная)' : '')
  const page2 = `<section class="page">${head('Дашборд', 2)}
    <h1 class="h1s">Дашборд: «Тогда» и «Сейчас»</h1>
    <div class="legend"><span><i style="background:#A9BBD0"></i>Тогда · ${esc(period(then))}</span><span><i style="background:#3185E8"></i>Сейчас · ${esc(period(now))}</span><span class="muted">пунктир — средний месяц «Тогда»; * месяц ещё идёт</span></div>
    <div class="grid">
      ${board ? `<div class="card wide"><h3>Выручка по месяцам, млн ₸</h3><div class="note">полученные деньги (брони, взносы, рассрочки, полные оплаты)</div>${bars(series('revenue').map((v) => v / 1e6), { labels, now: isNow, partial, fmt: n1, avgLine: revAvg / 1e6, avgLabel: `в среднем «Тогда» ${n1(revAvg / 1e6)}${thin(s.revenue)}`, w: 620, h: 110 })}</div>
      <div class="card wide"><h3>Продажи по месяцам, квартир</h3><div class="note">новые продажи и рассрочки минус отмены</div>${bars(series('sales'), { labels, now: isNow, partial, avgLine: salesAvg, avgLabel: `в среднем «Тогда» ${n1(salesAvg)}${thin(s.sales)}`, w: 620, h: 100 })}</div>
      <div class="card"><h3>Продано м² по месяцам</h3><div class="note">площадь проданных квартир</div>${bars(series('m2'), { labels, now: isNow, partial, avgLine: thenAvg(series('m2')), avgLabel: `в среднем «Тогда»${thin(s.m2)}` })}</div>
      <div class="card"><h3>Продано дома</h3><div class="note">из ${board.sellable} квартир в продаже</div><div class="donuts">${donut(s.share?.then, '#A9BBD0', `${board.soldThen} кв.`)}<span class="arrow">→</span>${donut(s.share?.now, '#1E956B', `${board.soldNow} кв.`)}</div><div class="sell">конец ${esc(then.at(-1).gen)} → сегодня</div></div>` : ''}
    </div>
  </section>`

  const page3 = insta ? instaPage({ months, insta, s, head, labels, isNow, partial }) : ''

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>REVION · Тогда → Сейчас</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font: 10pt/1.45 Manrope, 'Segoe UI', Arial, sans-serif; color: #0B1728; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; padding: 13mm 13mm 11mm; page-break-after: always; position: relative; overflow: hidden; background: #fff; }
.page:last-child { page-break-after: auto; }
.top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #D5DCE6; padding-bottom: 7px; margin-bottom: 12px; }
.brand { display: flex; align-items: center; gap: 8px; }
.logo { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #173F68, #3185E8); color: #fff; font-weight: 800; display: grid; place-items: center; font-size: 12px; }
.tag, .pg { color: #5B6B7F; font-size: 8.5pt; }
.hero { background: linear-gradient(135deg, #0B1728, #173F68 60%, #3185E8); color: #fff; border-radius: 16px; padding: 16px 22px 14px; margin-bottom: 10px; }
.eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 8pt; color: #9CC3F5; font-weight: 700; }
h1 { font-size: 21pt; line-height: 1.15; margin: 6px 0 8px; font-weight: 800; }
.h1s { font-size: 16pt; margin: 0 0 8px; }
.lead { margin: 0; color: #DCE7F5; font-size: 10.5pt; }
h2 { font-size: 12.5pt; margin: 12px 0 6px; }
h3 { font-size: 10.5pt; margin: 0; }
.kpis { display: grid; gap: 8px; margin: 8px 0; }
.k2 { grid-template-columns: repeat(2, 1fr); } .k6 { grid-template-columns: repeat(3, 1fr); }
.kpi { border: 1px solid #D5DCE6; border-radius: 12px; padding: 9px 12px; background: #F5F7FA; }
.kt { font-size: 8.5pt; color: #5B6B7F; font-weight: 600; }
.kv { font-size: 18pt; font-weight: 800; line-height: 1.25; margin-top: 2px; white-space: nowrap; }
.kv .was { color: #7A8CA3; } .kv .to { color: #7A8CA3; font-weight: 600; } .kv .unit { font-size: 10pt; color: #5B6B7F; font-weight: 600; }
.ks { font-size: 8.5pt; color: #5B6B7F; }
.main { padding-left: 18px; margin: 0; } .main li { margin-bottom: 4px; font-size: 9.5pt; }
.legend { display: flex; gap: 14px; font-size: 8.5pt; margin-bottom: 6px; align-items: center; } .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; } .muted { color: #5B6B7F; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.card { border: 1px solid #D5DCE6; border-radius: 12px; padding: 9px 11px 6px; break-inside: avoid; }
.card.wide { grid-column: 1 / -1; margin-bottom: 0; }
.note { font-size: 7.8pt; color: #5B6B7F; margin: 2px 0; }
.nn { font-size: 8.5pt; color: #33475B; padding: 0 2px 2px; }
.vs { color: #1E956B; font-weight: 700; font-size: 8pt; margin-left: 4px; }
.donuts { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px 0 0; } .arrow { font-size: 18pt; color: #5B6B7F; }
.sell { text-align: center; font-size: 8.5pt; color: #5B6B7F; padding-bottom: 6px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; } th { background: #173F68; color: #fff; text-align: left; padding: 6px 8px; font-size: 8.8pt; } td { border-bottom: 1px solid #D5DCE6; padding: 4px 8px; }
.mt td { font-size: 9.5pt; } .mt tr.now td:first-child { font-weight: 700; color: #173F68; }
.mt tr.avg td { background: #F5F7FA; font-weight: 700; font-size: 9pt; } .mt tr.growth td { background: #E8F5EF; color: #1E956B; font-weight: 800; }
.notes li { margin-bottom: 5px; font-size: 9pt; color: #33475B; }
.foot { position: absolute; bottom: 9mm; left: 13mm; right: 13mm; font-size: 8pt; color: #5B6B7F; border-top: 1px solid #D5DCE6; padding-top: 5px; }
.it td, .it th { font-size: 8.2pt; padding: 3px 5px; } .it td { white-space: nowrap; } .it .vs { font-size: 7pt; margin-left: 2px; } .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 6px; } .grid3 h3 { font-size: 9.5pt; } .tops { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; } .tops ol { margin: 4px 0 0; padding-left: 16px; } .tops li { font-size: 8.4pt; margin-bottom: 3px; } .tops a { color: #173F68; text-decoration: none; }
.k3 { grid-template-columns: repeat(3, 1fr); } .kv.sm { font-size: 15pt; }
</style></head><body>${page1}${page2}${page3}</body></html>`
}

// ---------- the Excel: the same real numbers ----------

export function xlsxSheets({ months, board, insta, office, s, notes, who }) {
  const then = months.filter((m) => !m.now), now = months.filter((m) => m.now)
  const H = (v) => ({ v, s: 'h' })
  const num = (v, d = 0) => (v == null ? '—' : { v: Math.round(v * 10 ** d) / 10 ** d, s: d ? 'n1' : 'n0' })
  const ratio = (p) => (p?.partial ? 'база неполная' : p?.ratio == null ? '—' : { v: Math.round(p.ratio * 100) / 100, s: 'n1' })
  const lbl = (m) => `${cap(m.label)} ${m.year}${m.partial ? ` (по ${ru(m.to)})` : ''}`
  const head = [H('Месяц'), H('Период')]
  if (board) head.push(H('Выручка, млн ₸'), H('Продажи, кв.'), H('Продано м²'))
  if (office) head.push(H('Задач офиса'))
  const line = (i) => {
    const m = months[i], r = [lbl(m), m.now ? 'Сейчас' : 'Тогда']
    if (board) { const b = board.rows[i]; r.push(num(b.revenue / 1e6, 1), b.sales, num(b.m2)) }
    if (office) r.push(office.rows[i].tasks)
    return r
  }
  const avgLine = (label, key) => {
    const r = [{ v: label, s: 'b' }, '']
    if (board) r.push(num(s.revenue?.[key] / 1e6, 1), num(s.sales?.[key]), num(s.m2?.[key]))
    if (office) r.push('')
    return r
  }
  const growth = [{ v: 'Рост (во сколько раз)', s: 'b' }, '']
  if (board) growth.push(ratio(s.revenue), ratio(s.sales), ratio(s.m2))
  const table = [[{ v: 'REVION · «Тогда → Сейчас»', s: 't' }], [{ v: `${who}. Тогда — ${period(then)} (до REVION), Сейчас — ${period(now)} (с REVION, по ${ru(now.at(-1).to)}). Реальные суммы и количества, без пересчётов.`, s: 'sub' }], [], head]
  months.forEach((m, i) => { if (i === then.length) table.push(avgLine(`Итого «Тогда» (${period(then)})`, 'then')); table.push(line(i)) })
  table.push(avgLine(`Итого «Сейчас» (${period(now)}, по ${ru(now.at(-1).to)})`, 'now'), growth)
  const summary = [[{ v: 'Главное', s: 't' }], [], [H('Показатель'), H(`Тогда (${period(then)})`), H(`Сейчас (${period(now)}, по ${ru(now.at(-1).to)})`), H('Изменение')]]
  const add = (name, p, d = 0, k = 1) => { if (p && p.then != null) summary.push([name, num(p.then / k, d), num(p.now / k, d), change(p)]) }
  add('Выручка, млн ₸', s.revenue, 1, 1e6); add('Продажи, квартир', s.sales); add('Продано м²', s.m2); add('Цена м² в сделках (средняя), ₸', s.ppm)
  if (board && s.share?.then != null) summary.push(['Продано дома, квартир', `${board.soldThen} из ${board.sellable}`, `${board.soldNow} из ${board.sellable}`, `${Math.round(s.share.then * 100)}% → ${Math.round(s.share.now * 100)}%`])
  if (s.followers?.thenEnd != null) summary.push([`Подписчиков в Instagram (конец ${then.at(-1).gen} → сейчас)`, num(s.followers.thenEnd), num(s.followers.now), s.followers.thenEnd > 0 ? change({ then: s.followers.thenEnd, now: s.followers.now, ratio: s.followers.now / s.followers.thenEnd, pct: (s.followers.now / s.followers.thenEnd - 1) * 100 }) : '—'])
  add('Новые подписчики', s.follows); add('Чистый прирост подписчиков', s.net); add('Охват аккаунта', s.reach); add('Посещения профиля', s.profileViews); add('Публикаций в Instagram', s.posts); add('Охват публикации (средний)', s.postReach)
  const igSheet = insta ? (() => {
    const rr = [[{ v: `Instagram${insta.username ? ` @${insta.username}` : ''}`, s: 't' }], [{ v: `Подписчиков сейчас: ${n0(insta.followers)}. Реальные числа по месяцам из Meta.`, s: 'sub' }], [], [H('Месяц'), H('Подписались'), H('Отписались'), H('Прирост'), H('Подписчиков на конец'), H('Охват аккаунта'), H('Просмотры'), H('Посещения профиля'), H('Взаимодействия'), H('Публикаций'), H('Из них Reels'), H('Охват публикации (ср.)'), H('Реакции на пост (ср.)')]]
    const v = (x) => (x == null ? '—' : num(x))
    const tline = (label, key) => [{ v: label, s: 'b' }, v(s.follows?.[key]), v(s.unfollows?.[key]), v(s.net?.[key]), v(key === 'then' ? s.followers?.thenEnd : s.followers?.now), v(s.reach?.[key]), v(s.views?.[key]), v(s.profileViews?.[key]), v(s.interactions?.[key]), v(s.posts?.[key]), v(s.reels?.[key]), v(s.postReach?.[key]), s.likes?.[key] != null ? num(s.likes[key], 1) : '—']
    months.forEach((m, i) => {
      if (i === then.length) rr.push(tline(`Итого «Тогда» (${period(then)})`, 'then'))
      const x = insta.rows[i]
      rr.push([lbl(m), v(x.follows), v(x.unfollows), v(x.net), v(x.endFollowers), v(x.reach), v(x.views), v(x.profileViews), v(x.interactions), x.posts, x.reels, v(x.postReach), x.likes != null ? num(x.likes, 1) : '—'])
    })
    rr.push(tline(`Итого «Сейчас» (${period(now)}, по ${ru(now.at(-1).to)})`, 'now'))
    const fp = s.followers?.thenEnd > 0 ? { ratio: s.followers.now / s.followers.thenEnd } : null
    rr.push([{ v: 'Рост (во сколько раз)', s: 'b' }, ratio(s.follows), ratio(s.unfollows), ratio(s.net), ratio(fp), ratio(s.reach), ratio(s.views), ratio(s.profileViews), ratio(s.interactions), ratio(s.posts), ratio(s.reels), ratio(s.postReach), ratio(s.likes)])
    rr.push([], [H('Лучшие публикации'), H('Дата'), H('Тип'), H('Охват'), H('Реакции'), H('Ссылка')])
    for (const [name, list] of [['«Сейчас»', insta.top?.now || []], ['«Тогда»', insta.top?.then || []]]) for (const x of list) rr.push([`${name}: ${x.caption || ''}`, ru(x.day), x.reels ? 'Reels' : x.carousel ? 'Карусель' : 'Пост', x.reach, x.likes + x.comments, x.link])
    return { name: 'Instagram', cols: [40, 12, 12, 10, 14, 14, 12, 14, 14, 11, 11, 16, 16], rows: rr }
  })() : null
  const sheets = [{ name: 'По месяцам', cols: [42, 9, 15, 13, 12, 12, 13, 20, 12], rows: table }, { name: 'Главное', cols: [32, 24, 34, 16], rows: summary }]
  if (igSheet) sheets.push(igSheet)
  if (office) {
    const rows = [[{ v: 'Работа офиса REVION', s: 't' }], [], [H('Месяц'), H('Задач выполнено'), H('Отчёты и планы'), H('Макеты и ролики'), H('Вышло автоматически'), H('Из них видео'), H('Решений по предложениям')]]
    months.forEach((m, i) => { const r = office.rows[i]; rows.push([lbl(m), r.tasks, r.reports, r.designs, r.published, r.videos, r.decisions]) })
    rows.push([], [H('Сотрудник'), H('Роль'), H('Задач за «Сейчас»')])
    for (const p of office.people) rows.push([p.name, p.title, p.tasks])
    sheets.push({ name: 'Работа офиса', cols: [24, 34, 16, 16, 20, 13, 22], rows })
  }
  sheets.push({ name: 'Оговорки', cols: [120], rows: [[{ v: 'Источники и оговорки', s: 't' }], [], ...['Выручка — полученные деньги этой очереди по датам оплат из шахматки; продажи — по журналу статусов шахматки (новые продажи и рассрочки минус отмены).', 'Все цифры — реальные суммы и количества за месяцы, без пересчётов; текущий месяц ещё идёт, итог «Сейчас» неполный.', ...notes, 'Рост совпал по времени с запуском REVION; на продажи влияют и другие факторы (сезон, цены, реклама) — это наблюдаемая связь, а не доказанная причина.'].map((x) => [{ v: x, s: 'sub' }])] })
  return sheets
}

// ---------- the owner's message: what to check before sending ----------

export function ownerText({ months, s, owner, pdfError }) {
  const then = months.filter((m) => !m.now), now = months.filter((m) => m.now)
  const L = [`📊 Отчёт «Тогда → Сейчас» готов: ${period(then)} против ${period(now)} (по ${ru(now.at(-1).to)}). В PDF и Excel — настоящие цифры по месяцам.`]
  if (ok(s.revenue)) L.push(`• Выручка: ${mln(s.revenue.then)} → ${mln(s.revenue.now)} (${change(s.revenue)})`)
  if (s.sales) L.push(`• Продажи: ${n0(s.sales.then)} → ${n0(s.sales.now)} кв. (${change(s.sales)})`)
  if (s.extra?.now || s.extra?.then) L.push(`• Не вошло в выручку (деньги вне шахматки, другая очередь): ${mln(s.extra.then)} «Тогда», ${mln(s.extra.now)} «Сейчас»`)
  if (s.bookingsRaw) L.push(`• Брони: ${n0(s.bookingsRaw.then)} → ${n0(s.bookingsRaw.now)} — в отчёт не вошли: до 11.08 шахматка знает только оплаченные брони`)
  if (owner.length || pdfError) L.push('', 'Проверьте перед отправкой:', ...owner.map((x) => `• ${x}`), ...(pdfError ? [`• ⚠️ PDF не получился (${pdfError}) — прислал только Excel.`] : []))
  L.push('', 'Если оплаты за июнь–август внесены в шахматку не полностью, «Тогда» занижено и рост выглядит больше, чем есть.')
  return L.join('\n')
}

// ---------- everything ----------

export async function beforeAfter({ portal, meta, store, smmPack, initiative, employees, browser, who = 'Застройщик жилого комплекса, Астана', start = START }) {
  const today = ymd(new Date())
  const months = monthsOf(today, start)
  const notes = [], owner = []
  let board = null, insta = null
  if (portal?.status().configured) {
    try {
      const [a, h, pay] = await Promise.all([portal.get('/api/analytics/apartments'), portal.get('/api/analytics/status-history'), portal.get('/api/analytics/payments').catch(() => null)])
      board = chessboard({ a, h, pay, months })
      notes.push(...board.notes); owner.push(...board.owner)
    } catch (e) { owner.push(`⚠️ Шахматка не ответила (${e.message}) — в отчёте нет выручки и продаж, клиенту такой отчёт не отправляйте.`) }
  } else owner.push('⚠️ Шахматка не подключена — в отчёте нет выручки и продаж.')
  if (meta?.m?.token && meta.m.igUserId) {
    try { insta = await instagram(meta, months); notes.push(...insta.notes); owner.push(...insta.owner) } catch (e) { owner.push(`Instagram не ответил (${e.message}) — раздела Instagram в отчёте нет.`) }
  }
  const office = officeWork({ store, smmPack, initiative, employees, months })
  const s = summarize({ months, board, insta, office })
  const data = { months, board, insta, office, s, notes, owner, who }
  const dir = path.join(P.data, 'reports')
  fs.mkdirSync(dir, { recursive: true })
  const base = path.join(dir, `REVION-тогда-сейчас-${today}`)
  const files = [writeXlsx(`${base}.xlsx`, xlsxSheets(data))]
  let pdfError = browser ? null : 'на сервере не найден Chrome'
  if (browser) {
    fs.writeFileSync(`${base}.html`, pdfHtml(data), 'utf8')
    try { files.unshift(await htmlToPdf(browser, `${base}.html`)) } catch (e) { pdfError = e.message } finally { fs.rmSync(`${base}.html`, { force: true }) }
  }
  return { files, text: ownerText({ ...data, pdfError }), data }
}
