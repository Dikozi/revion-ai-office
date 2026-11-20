import { readPlan, METRICS, AREAS } from './initiative.js'
import { crmSummary, whoBuys, byAd, crmPulse } from './crm.js'
import { moneyEvents, received, planned, unfilled, extraIncome, shortPaid } from './payments.js'
import { SOLD, readLog, soldDays, salesIn, isUnbook, kzDay, kzStamp, basePpm } from './sales-rules.js'
import { adNumbers, adKinds, archiveMore } from './ads-archive.js'
import { dayAgo, lastDays, kindByGoal, kindByResult, isPaid } from './ads-rules.js'
import { usdKzt } from './fx.js'
import { mediaResults } from './post-results.js'
import { markOk, markFail, enabled, sourceList } from './sources.js'
import { readBook } from './months.js'
import { reportsArchive } from './reports.js'

// Numbers for the portal: chessboard, Meta ads, Instagram, analysts' reports and proposals.
// Plain code, no Claude. Cached for 10 minutes so opening the portal costs nothing.
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const daysAgo = (n) => ymd(new Date(Date.now() - n * 864e5))
const unix = (date, end = false) => Math.floor(new Date(`${date}T${end ? '23:59:59' : '00:00:00'}+05:00`).getTime() / 1000)
const num = (v) => Number(v) || 0
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null)
const round = (v, d = 2) => Number(num(v).toFixed(d))
const REPORTERS = ['marketing', 'sales', 'revenue', 'smm', 'montazh']
const CASH_RU = { booking: 'Оплаты броней', first: 'Первоначальные взносы', installment: 'Платежи по рассрочке', full: 'Полные оплаты' }
const MONTH_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const nf = (v, d = 1) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d })
const mln = (v) => nf(v / 1e6, Math.abs(v) >= 1e8 ? 0 : 1)
const dm = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '')

export class Dashboard {
  constructor({ store, meta, portal, initiative, employees, crm, smmPack }) {
    Object.assign(this, { store, meta, portal, initiative, employees, crm, smmPack })
    this.cache = null
    this.loading = null
  }

  async get(force = false) {
    if (!force && this.cache && Date.now() - this.cache.at < 10 * 60e3) return this.live(this.cache)
    this.loading ??= this.build().then((d) => (this.cache = d)).finally(() => { this.loading = null })
    return this.live(await this.loading)
  }

  // tasks and proposals change often and cost nothing: always fresh
  live(d0) {
    const d = { ...d0, board: this.withCash(d0.board), sources: this.sources() }
    const judged = this.judge(d)
    judged.top = this.top(d)
    judged.losses = this.losses(d)
    const goals = this.goals(d)
    return { ...d, reports: this.reports(), proposals: this.initiative.list(), team: this.team(), smm: this.smm(d), ...judged, kpi: this.kpi(d), change: this.change(d), goals, home: this.safeHome(d, goals), memory: this.memoryNow(d), plan: this.plan(d, judged), metrics: this.metricsFrom(d), weekGoal: this.initiative.state.weekGoal || null, archive: this.archive() }
  }

  // the page «Отчёты»: every month and the weekly reports (months.json, weeks.json — files, no requests)
  archive() {
    try { return reportsArchive(readBook()) } catch (e) { console.error('Архив отчётов:', e.message); return null }
  }

  // how fresh every source is: the book is kept by the sources themselves, so this is always current
  sources() {
    try { return sourceList(enabled({ portal: this.portal, meta: this.meta, crm: this.crm })) } catch (e) { console.error('Источники данных:', e.message); return [] }
  }

  async build() {
    const notes = []
    // part: recorded for the «Данные: …» line (sources.js); the chessboard records itself in portal.get
    const safe = (name, fn, part) => fn().then((v) => { if (part) markOk(part); return v }, (e) => { notes.push(`${name}: ${e.message}`); if (part) markFail(part, e); return null })
    const [board, ads, insta] = await Promise.all([
      this.portal.status().configured ? safe('Шахматка', () => this.board()) : null,
      this.meta.m.token && this.meta.m.adAccountId ? safe('Реклама Meta', () => this.ads(), 'ads') : null,
      this.meta.m.token && this.meta.m.igUserId ? safe('Instagram', () => this.insta(), 'insta') : null,
    ])
    // the payments list did not answer: money numbers are incomplete, and that is not the owner's fault
    if (board?.payError) notes.push(`Оплаты шахматки: ${board.payError}`)
    const krisha = this.initiative.state.krisha?.entries || []
    let crm = null
    if (this.crm?.status().configured) {
      const leads = await safe('CRM', () => this.crm.leads())
      const syncedAt = this.crm.status().syncedAt
      // a copy the CRM has not refreshed is still shown, marked: the screens say how old it is
      if (leads) crm = { cur: crmSummary(leads, { from: daysAgo(27), to: daysAgo(0) }), prev: crmSummary(leads, { from: daysAgo(55), to: daysAgo(28) }), who: whoBuys(leads), ads: byAd(leads).slice(0, 20), syncedAt, pulse: crmPulse(leads, { syncedAt, hours: this.initiative.cfg?.managerHours }), fresh: { stale: !!leads.stale, ageH: leads.ageH ?? null, error: leads.error || '' } }
    }
    return { at: Date.now(), board, ads, insta, krisha, crm, notes }
  }

  // ---------- chessboard ----------

  async board() {
    // payments are optional: without them revenue counts only "Продана" at full price; a failure is kept as payError
    let payError = null
    const [a, h, pay] = await Promise.all([this.portal.get('/api/analytics/apartments'), this.portal.get('/api/analytics/status-history'), this.portal.get('/api/analytics/payments').catch((e) => { payError = e.message || 'нет ответа'; return null })])
    const now = Date.now()
    const flats = a.apartments.map((x) => ({ n: x.number, e: x.entrance, f: x.floor, r: x.rooms, m2: x.area_m2, price: x.price_kzt, ppm: x.price_per_m2_kzt, st: x.status, since: kzDay(x.status_changed_at) }))
    const byNum = new Map(flats.map((x) => [x.n, x]))
    // one sales rule for every screen (sales-rules.js): Almaty days, net of cancellations, client moves left out
    const log = readLog(h.changes)
    for (const [n, day] of soldDays(log)) if (byNum.has(n)) byNum.get(n).soldAt = day
    const status = flats.reduce((o, x) => ((o[x.st] = (o[x.st] || 0) + 1), o), {})
    const price = (c) => num(byNum.get(c.number)?.price)
    // sales of the days (from, to]: net count, contract sum (cancelled prices taken away), deals still standing
    const salesOf = (from, to) => {
      const s = salesIn(log, from, to)
      return {
        s, sales: s.net, revenue: s.deals.reduce((t, c) => t + price(c), 0) - s.cancels.reduce((t, c) => t + price(c), 0),
        noPrice: s.deals.filter((c) => !price(c)).length - s.cancels.filter((c) => !price(c)).length,
      }
    }
    const dayBefore = (d) => ymd(new Date(Date.parse(`${d}T12:00:00+05:00`) - 864e5))
    const weeks = []
    for (let w = 7; w >= 0; w--) {
      const from = daysAgo((w + 1) * 7), to = daysAgo(w * 7)
      const x = salesOf(from, to)
      weeks.push({ from, to, bookings: x.s.bookings, unbooked: x.s.unbooked, sales: x.sales, revenue: x.revenue, noPrice: x.noPrice })
    }
    const monday = (() => { const t = new Date(Date.now() + 5 * 3600e3); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10) })()
    const today = ymd(new Date())
    const wk = salesOf(dayBefore(monday), today)
    const monthStart = today.slice(0, 8) + '01'
    const mt = salesOf(dayBefore(monthStart), today)
    // three-room flats sold and still sold, by their sale day (goal «3-комн. до …»)
    const soldThree = flats.filter((x) => SOLD.includes(x.st) && x.r === 3 && x.soldAt).map((x) => x.soldAt)
    const thisMonth = { from: monthStart, sales: mt.sales, revenue: mt.revenue, bookings: mt.s.bookings, threeRooms: mt.s.deals.filter((c) => byNum.get(c.number)?.r === 3).length - mt.s.cancels.filter((c) => byNum.get(c.number)?.r === 3).length, soldThree }
    const thisWeek = { from: monday, sales: wk.sales, bookings: wk.s.bookings, revenue: wk.revenue }
    const since = a.history_since ? kzDay(a.history_since) : log[0]?.day || ''
    const span = (fromDays, toDays) => {
      const from = daysAgo(fromDays), to = daysAgo(toDays)
      const x = salesOf(from, to)
      return {
        from, to, partial: !!since && from < since,
        sales: x.sales, revenue: x.revenue, noPrice: x.noPrice,
        bookings: x.s.bookings, unbooked: x.s.unbooked, cancelled: x.s.cancels.length,
        deals: x.s.deals.map((c) => { const f = byNum.get(c.number) || {}; return { n: c.number, r: f.r, m2: f.m2, price: f.price || null, ppm: f.ppm || null, st: c.to, at: c.day } }),
      }
    }
    const periods = {}
    for (const [k, d] of Object.entries({ week: 7, month: 28, quarter: 91 })) periods[k] = { days: d, cur: span(d, 0), prev: span(d * 2, d) }
    const history = []
    for (let w = 12; w >= 0; w--) { const x = span((w + 1) * 7, w * 7); if (!since || x.to >= since) history.push({ from: x.from, to: x.to, sales: x.sales, revenue: x.revenue, bookings: x.bookings }) }
    const unbooked30 = log.filter((c) => isUnbook(c) && c.day > daysAgo(30)).map((c) => ({ n: c.number, at: c.day, price: byNum.get(c.number)?.price || null, r: byNum.get(c.number)?.r }))
    const stale = flats.filter((x) => x.st === 'Бронь' && x.since).map((x) => ({ ...x, days: Math.floor((now - Date.parse(x.since)) / 864e5) })).filter((x) => x.days >= 7).sort((p, q) => q.days - p.days)
    const free = flats.filter((x) => x.st === 'Свободна')
    const sold = flats.filter((x) => SOLD.includes(x.st))
    // net sales: a deal that went back to «Свободна» (cancelled) is taken away again
    const net = (fromDays, toDays) => salesIn(log, daysAgo(fromDays), daysAgo(toDays)).net
    const paceDays = since ? Math.min(91, Math.max(7, Math.round((now - Date.parse(since)) / 864e5))) : 91
    // still to sell: free and booked; «Не продаётся» and other statuses are out of the count
    const left = flats.filter((x) => x.st === 'Свободна' || x.st === 'Бронь')
    const leftPpm = left.filter((x) => x.ppm), soldPpm = sold.filter((x) => x.ppm)
    const avgPpm = leftPpm.length ? leftPpm.reduce((t, x) => t + x.ppm, 0) / leftPpm.length : soldPpm.length ? soldPpm.reduce((t, x) => t + x.ppm, 0) / soldPpm.length : 0
    const toSell = {
      left: left.length, booked: left.filter((x) => x.st === 'Бронь').length, sold: sold.length, sellable: sold.length + left.length,
      net: net(paceDays, 0), days: paceDays,
      leftPriced: left.filter((x) => x.price).length,
      leftValue: avgPpm || left.every((x) => x.price) ? Math.round(left.reduce((t, x) => t + (x.price || num(x.m2) * avgPpm), 0)) : null,
    }
    const soldPriced = sold.filter((x) => x.price)
    const last4 = weeks.slice(-4)
    const pace = last4.reduce((s, w) => s + w.sales, 0) / 4
    const group = (key) => {
      const out = {}
      for (const x of flats) {
        const k = key(x)
        out[k] ??= { total: 0, free: 0, booked: 0, sold: 0 }
        out[k].total++
        if (x.st === 'Свободна') out[k].free++
        else if (x.st === 'Бронь') out[k].booked++
        else if (SOLD.includes(x.st)) out[k].sold++
      }
      return out
    }
    const band = (f) => (f <= 3 ? '1–3' : f <= 6 ? '4–6' : f <= 9 ? '7–9' : '10+')
    return {
      complex: [...new Set(a.apartments.map((x) => `${x.complex}, ${x.phase} очередь`))].join('; '),
      total: flats.length, status, weeks, stale, flats, pay: pay?.flats || null, payError, thisWeek, thisMonth, periods, history, since, unbooked30,
      changes: log.slice(-30).reverse().map((c) => ({ n: c.number, from: c.from, to: c.to, at: kzStamp(c.changed_at), ...(c.move ? { move: c.move === 'in' ? `перенос клиента из кв. ${c.movedFrom}` : `клиент перенесён в кв. ${c.movedTo}` } : {}) })),
      priced: flats.filter((x) => x.price).length,
      revenue: {
        known: soldPriced.reduce((s, x) => s + num(x.price), 0),
        soldPriced: soldPriced.length,
        sold: sold.length,
        avgPpmSold: soldPriced.length ? Math.round(soldPriced.reduce((s, x) => s + num(x.ppm), 0) / soldPriced.length) : null,
        avgPpmFree: free.filter((x) => x.ppm).length ? Math.round(free.filter((x) => x.ppm).reduce((s, x) => s + num(x.ppm), 0) / free.filter((x) => x.ppm).length) : null,
        basePpm: basePpm(this.initiative?.cfg),
        lowSales: soldPriced.filter((x) => x.ppm && x.ppm < basePpm(this.initiative?.cfg)).map((x) => ({ n: x.n, ppm: x.ppm })),
        pace: round(pace, 1),
        forecastWeeks: pace > 0 ? Math.ceil(free.length / pace) : null,
        freeM2: Math.round(free.reduce((s, x) => s + num(x.m2), 0)),
      },
      byRooms: group((x) => `${x.r}-комн.`),
      revenueByRooms: Object.values(soldPriced.reduce((o, x) => { const k = `${x.r}-комн.`; o[k] ??= { key: k, revenue: 0, count: 0, m2: 0 }; o[k].revenue += num(x.price); o[k].count++; o[k].m2 += num(x.m2); return o }, {})).sort((p, q) => q.revenue - p.revenue),
      potential: (() => { const ppm = free.filter((x) => x.ppm); const avg = ppm.length ? ppm.reduce((t, x) => t + x.ppm, 0) / ppm.length : (soldPriced.length ? soldPriced.reduce((t, x) => t + num(x.ppm), 0) / soldPriced.length : 0); return avg ? Math.round(free.reduce((t, x) => t + (x.price || num(x.m2) * avg), 0)) : null })(),
      byFloors: group((x) => `${band(x.f)} этаж`),
      toSell,
    }
  }

  // Revenue = money actually received (payments.js); the sum of contract prices stays as `contract`.
  withCash(b) {
    if (!b) return b
    const ev = moneyEvents(b.flats, b.pay)
    const today = ymd(new Date())
    const dayBefore = (d) => ymd(new Date(Date.parse(`${d}T12:00:00+05:00`) - 864e5))
    const cash = (x, from = x.from, to = x.to) => { const s = received(ev, from, to); return { ...x, contract: x.revenue, revenue: s.revenue, cash: s } }
    const now = new Date(Date.now() + 5 * 3600e3)
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    const lastDay = (i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 0)).toISOString().slice(0, 10)
    // installments due in the next three months, by their schedules
    const nextMonths = [1, 2, 3].map((i) => ({ month: lastDay(i).slice(0, 7), planned: planned(ev, lastDay(i - 1), lastDay(i)) }))
    const overdueList = (b.pay || []).filter((p) => num(p.overdue) > 0).map((p) => ({ n: p.number, amount: num(p.overdue), since: p.overdue_since ? String(p.overdue_since).slice(0, 10) : null }))
    return {
      ...b,
      weeks: b.weeks.map((w) => cash(w)), history: b.history.map((w) => cash(w)),
      periods: Object.fromEntries(Object.entries(b.periods).map(([k, v]) => [k, { ...v, cur: cash(v.cur), prev: cash(v.prev) }])),
      thisMonth: cash(b.thisMonth, dayBefore(b.thisMonth.from), today),
      thisWeek: cash(b.thisWeek, dayBefore(b.thisWeek.from), today),
      // money outside the chessboard (extra) is never in these sums: it is listed apart as «вне шахматки».
      // payments: 'ok' | 'unavailable' (the API did not answer — the money numbers are incomplete, «unfilled» is empty);
      // short: «Продана» with less paid than the price, the rest not scheduled either
      cash: {
        received: received(ev, '0000-00-00', today).revenue, planned: planned(ev, today, '9999-12-31'), next30: planned(ev, today, daysAgo(-30)), restOfMonth: planned(ev, today, monthEnd),
        unfilled: unfilled(b.flats, b.pay), overdue: (b.pay || []).reduce((t, p) => t + num(p.overdue), 0), linked: !!b.pay,
        payments: b.pay ? 'ok' : 'unavailable', unavailable: b.pay ? null : `шахматка не ответила (оплаты)${b.payError ? `: ${b.payError}` : ''}`,
        extra: extraIncome(), nextMonths, overdueList, short: shortPaid(b.flats, b.pay),
      },
    }
  }

  // ---------- Meta ads ----------

  async ads() {
    // the account first: its time zone sets the days, its currency the money, its status why ads stand still
    const account = await this.meta.account().catch(() => null)
    const tz = account?.tz || this.meta.tz()
    const ago = (n) => dayAgo(tz, n)
    // what an ad is for — by its settings (night archive, else Meta's objective), never by what it gave that day
    const kinds = adKinds()
    const kindOf = (r, n) => kinds[r.ad_id] || kindByGoal({ objective: r.objective, optimization: r.optimization_goal }) || kindByResult(n)
    // 56 complete days ending yesterday (a half-finished today looks like a fall); other projects (Парк) left out
    const daily = await this.meta.adInsights({ level: 'ad', fields: 'ad_id,campaign_name,objective,optimization_goal,spend,impressions,inline_link_clicks,actions', time_range: { since: ago(56), until: ago(1) }, time_increment: 1 })
    const days = {}
    // counts are what all ads brought; prices only by the ads paid for that result: conversations of chat ads
    // (chatChats, chatDeep), forms of «Лиды» (formLeads). Reach / profile-visit spend is kept apart (spendReach).
    const ZERO = { spend: 0, results: 0, clicks: 0, impressions: 0, chats: 0, deep: 0, leads: 0, spendChat: 0, spendForm: 0, spendReach: 0, chatChats: 0, chatDeep: 0, formLeads: 0 }
    for (let i = 56; i >= 1; i--) days[ago(i)] = { date: ago(i), ...ZERO }
    for (const r of daily) {
      const d = days[r.date_start]
      if (!d) continue
      const n = adNumbers(r), kind = kindOf(r, n)
      d.spend += n.spend; d.results += n.conv; d.clicks += n.clicks; d.impressions += n.impr
      d.chats += n.chats; d.deep += n.deep; d.leads += n.leads
      if (kind === 'chat') { d.spendChat += n.spend; d.chatChats += n.chats; d.chatDeep += n.deep }
      else if (kind === 'form') { d.spendForm += n.spend; d.formLeads += n.leads }
      else d.spendReach += n.spend
    }
    const cprOf = (t) => (t.chatChats + t.formLeads ? round((t.spendChat + t.spendForm) / (t.chatChats + t.formLeads)) : null)
    const list = Object.values(days).map((d) => ({ ...d, spend: round(d.spend), cpr: cprOf(d) }))
    const sum = (part) => {
      const t = part.reduce((o, d) => Object.fromEntries(Object.keys(ZERO).map((k) => [k, o[k] + d[k]])), { ...ZERO })
      return {
        spend: round(t.spend), results: t.results, paid: t.chatChats + t.formLeads, cpr: cprOf(t), ctr: t.impressions ? round((t.clicks / t.impressions) * 100) : null, impressions: t.impressions, clicks: t.clicks,
        chats: t.chats, deep: t.deep, leads: t.leads, chatChats: t.chatChats, chatDeep: t.chatDeep, spendChat: round(t.spendChat), spendForm: round(t.spendForm), spendReach: round(t.spendReach),
        cpq: t.chatDeep ? round(t.spendChat / t.chatDeep) : null, cpl: t.formLeads ? round(t.spendForm / t.formLeads) : null, live: t.chats ? Math.round((t.deep / t.chats) * 100) : null,
      }
    }
    const cur = sum(list.slice(-7)), prev = sum(list.slice(-14, -7))
    const month = { cur: sum(list.slice(-28)), prev: sum(list.slice(0, 28)) }

    const rows = (await this.meta.adInsights({ level: 'ad', fields: 'ad_id,ad_name,campaign_name,objective,optimization_goal,spend,impressions,frequency,inline_link_clicks,ctr,actions', time_range: lastDays(tz, 7) }))
      .map((r) => {
        const n = adNumbers(r), kind = kindOf(r, n), got = kind === 'chat' ? n.chats : n.leads
        return {
          id: r.ad_id, name: r.ad_name, campaign: r.campaign_name, kind, spend: round(r.spend), results: n.conv, cpr: isPaid(kind) && got ? round(n.spend / got) : null, ctr: round(r.ctr), freq: round(r.frequency, 1),
          chats: n.chats, deep: n.deep, leads: n.leads, cpq: kind === 'chat' && n.deep ? round(n.spend / n.deep) : null, cpl: kind === 'form' && n.leads ? round(n.spend / n.leads) : null,
        }
      })
      .sort((p, q) => q.spend - p.spend)
    // each kind is judged by its own price: a live conversation for chat ads, a filled form for «Лиды»
    const mid = (vals) => { const v = vals.filter(Boolean).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null }
    const median = { chat: mid(rows.filter((r) => r.kind === 'chat').map((r) => r.cpq)), form: mid(rows.filter((r) => r.kind === 'form').map((r) => r.cpl)) }
    for (const r of rows) {
      const price = r.kind === 'chat' ? r.cpq : r.cpl, med = median[r.kind], got = r.kind === 'chat' ? r.chats : r.leads
      r.verdict = r.kind === 'other' ? 'reach'
        : !got && r.spend >= 5 ? 'off'
        : r.kind === 'chat' && !r.deep && r.chats >= 3 ? 'empty'
        : med && price && price >= med * 1.5 && r.spend >= 5 ? 'off'
        : med && price && price <= med * 0.8 && (r.kind === 'chat' ? r.deep : r.leads) >= 3 ? 'scale'
        : r.freq > 3.5 ? 'tired'
        : r.spend < 3 && got < 3 ? 'watch' : 'keep'
    }
    // thumbnails only for the biggest spenders: one request each
    await Promise.all(rows.slice(0, 8).map(async (r) => {
      try { r.thumb = (await this.meta.api(r.id, { fields: 'creative{thumbnail_url}', thumbnail_width: 160, thumbnail_height: 160 })).creative?.thumbnail_url || null } catch {}
    }))
    // ads switched on that Meta does not show (rejected, with an error, no billing info)
    const problems = account ? await this.meta.adProblems().catch(() => []) : []
    const currency = account?.currency || this.meta.currency() || 'USD'
    // 8 weekly sums: the small trend lines on the first screen
    const weeks = [...Array(8)].map((_, i) => sum(list.slice(i * 7, i * 7 + 7)))
    // promotions and followers, who really talks, placements, video — from the night archive (no Meta calls)
    let more = null
    try { more = archiveMore(this.initiative?.cfg || this.meta.cfg || {}) } catch (e) { console.error('Портал, архив рекламы:', e.message) }
    return {
      currency, tz, until: ago(1), days: list.slice(-14), weeks, cur, prev, month, rows, median, problems, more,
      account: account ? { name: account.name, status: account.status, active: account.active, grace: !!account.grace, reason: account.reason, capReached: account.capReached, cap: account.cap, spent: account.spent, balance: account.balance } : null,
      lastSpend: [...list].reverse().find((x) => x.spend > 0)?.date || null,
    }
  }

  // ---------- Instagram ----------

  async insta() {
    const id = this.meta.m.igUserId
    const account = await this.meta.api(id, { fields: 'username,followers_count,media_count' })
    const total = async (from, to) => {
      const r = await this.meta.insights(id, ['reach', 'views', 'total_interactions'], { period: 'day', metric_type: 'total_value', since: unix(daysAgo(from)), until: unix(daysAgo(to), true) })
      return { reach: num(r.reach), views: num(r.views), interactions: num(r.total_interactions) }
    }
    const [cur, prev] = await Promise.all([total(6, 0), total(13, 7)])
    const fd = await this.meta.insights(id, ['follower_count'], { period: 'day', since: unix(daysAgo(13)), until: unix(ymd(new Date()), true) })
    const follows = (Array.isArray(fd.follower_count) ? fd.follower_count : []).map((v) => ({ date: String(v.end_time || '').slice(0, 10), value: num(v.value) }))
    const media = (await this.meta.api(`${id}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count', limit: 12 })).data || []
    const posts = await Promise.all(media.map(async (p) => {
      const s = await this.meta.insights(p.id, ['reach', 'saved', 'shares'], { period: 'lifetime' })
      const v = (x) => num(Array.isArray(x) ? x[0]?.value : x)
      return {
        date: p.timestamp?.slice(0, 10), link: p.permalink, caption: String(p.caption || '').slice(0, 160),
        type: p.media_product_type === 'REELS' ? 'Reels' : p.media_type === 'CAROUSEL_ALBUM' ? 'Карусель' : p.media_type === 'VIDEO' ? 'Видео' : 'Фото',
        image: p.thumbnail_url || (p.media_type === 'VIDEO' ? null : p.media_url),
        likes: num(p.like_count), comments: num(p.comments_count), reach: v(s.reach), saved: v(s.saved), shares: v(s.shares),
      }
    }))
    const weekPosts = posts.filter((p) => p.date >= daysAgo(6)).length
    const prevPosts = posts.filter((p) => p.date >= daysAgo(13) && p.date < daysAgo(6)).length
    return {
      username: account.username, followers: num(account.followers_count),
      cur: { ...cur, follows: follows.filter((f) => f.date > daysAgo(7)).reduce((s, f) => s + f.value, 0), posts: weekPosts },
      prev: { ...prev, follows: follows.filter((f) => f.date <= daysAgo(7)).reduce((s, f) => s + f.value, 0), posts: prevPosts },
      follows, posts,
    }
  }

  // averages per format, topic (keywords in the caption) and complex; a guide, not a proof
  contentStats(i) {
    if (!i?.posts.length) return null
    const TOPICS = [['Ход строительства', /стро(ит|йк)|ход работ|монолит|этаж(?!ей)/i], ['Планировки', /планиров|м²|кв\.?\s?м|комнатн/i], ['Цены и рассрочка', /цен|рассроч|₸|тенге|ипотек|скидк/i], ['Готовое жильё', /готов|ключ|заселен/i], ['Коммерция и аренда', /аренд|коммерч/i], ['Район и инфраструктура', /район|школ|парк|двор|инфраструкт/i]]
    const OBJECTS = [['Altyn Qala 2', /altyn qala/i], ['Qala 4', /qala/i]]
    const avg = (list) => (list.length ? Math.round(list.reduce((t, p) => t + p.reach, 0) / list.length) : 0)
    const by = (pairs) => pairs.map(([name, re]) => { const list = i.posts.filter((p) => re.test(p.caption)); return { name, posts: list.length, reach: avg(list), saved: list.reduce((t, p) => t + p.saved, 0) } }).filter((x) => x.posts).sort((a, b) => b.reach - a.reach)
    const types = [...new Set(i.posts.map((p) => p.type))].map((t) => { const list = i.posts.filter((p) => p.type === t); return { name: t, posts: list.length, reach: avg(list), saved: list.reduce((s, p) => s + p.saved, 0) } }).sort((a, b) => b.reach - a.reach)
    return { formats: types, topics: by(TOPICS), objects: by(OBJECTS), base: avg(i.posts), posts: i.posts.length }
  }

  // ---------- business memory with relevance: a decision about a flat is outdated once the flat moved on ----------

  memoryNow(d) {
    const flats = new Map((d.board?.flats || []).map((f) => [String(f.n), f]))
    const day = (iso) => (iso ? String(iso).slice(8, 10) + '.' + String(iso).slice(5, 7) : '')
    const recs = this.initiative.businessRecords().slice(-60).reverse()
    return recs.map((r) => {
      const when = String(r.decidedAt || r.at).slice(0, 10)
      const nums = [...new Set([...`${r.decision} ${r.action} ${r.problem}`.matchAll(/кв(?:артир[аыуе]?)?\.?\s*№?\s*(\d{1,4})/gi)].map((m) => m[1]))]
      let stale = null
      for (const n of nums) {
        const f = flats.get(n)
        if (f?.since && f.since > when) { stale = `с тех пор кв. ${n}: «${f.st}» с ${day(f.since)}`; break }
      }
      // an unanswered, declined signal older than two weeks has passed
      if (!stale && r.verdict === 'declined' && ['watch', 'alert'].includes(r.kind) && Date.now() - Date.parse(when) > 14 * 864e5) stale = 'прошло больше двух недель'
      const canRedo = !!r.action && ['declined', 'approved', 'not', 'flat', 'insufficient'].includes(r.verdict)
      return { ...r, stale, canRedo: canRedo && !stale }
    })
  }

  // ---------- goals of the month: plan, fact, forecast, chance, what limits ----------

  goals(d) {
    const g = this.initiative.goalsNow()
    const b = d.board, a = d.ads
    if (!b) return { goals: g, empty: 'нужна шахматка' }
    const now = new Date(Date.now() + 5 * 3600e3)
    const daysIn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
    const dayOf = now.getUTCDate()
    const left = daysIn - dayOf
    const m = b.thisMonth
    const last28 = b.periods.month.cur
    // new deals bring bookings and first payments at the recent pace; installments come by their schedule
    const pace = { sales: Math.max(0, last28.sales) / 28, revenue: (last28.cash.booking + last28.cash.first + last28.cash.full) / 28 }
    const forecast = { sales: Math.round((m.sales + pace.sales * left) * 10) / 10, revenue: Math.round(m.revenue + b.cash.restOfMonth + pace.revenue * left) }
    const chance = (plan, fc) => (!plan ? null : fc >= plan ? 'высокая' : fc >= plan * 0.8 ? 'средняя' : 'низкая')
    const avgCheck = b.revenue.soldPriced ? b.revenue.known / b.revenue.soldPriced : null
    const booked = b.flats.filter((x) => x.st === 'Бронь')
    const bookedMoney = booked.reduce((t, x) => t + (x.price || avgCheck || 0), 0)
    // without the payments list the month's money is counted by flat prices, not received: no sum, no forecast
    const noPay = b.cash.payments === 'unavailable'
    if (noPay) forecast.revenue = null
    const out = { goals: g, month: m.from.slice(0, 7), dayOf, daysIn, left, fact: noPay ? { ...m, revenue: null } : m, forecast, pace: { salesWeek: Math.round(pace.sales * 70) / 10 }, booked: { count: booked.length, money: Math.round(bookedMoney) } }
    if (!g) return out
    out.revenue = g.revenue ? { plan: g.revenue, fact: m.revenue, forecast: forecast.revenue, chance: chance(g.revenue, forecast.revenue), gap: Math.max(0, g.revenue - forecast.revenue) } : null
    if (out.revenue && noPay) Object.assign(out.revenue, { fact: null, forecast: null, chance: null, gap: 0, partial: true })
    out.sales = g.sales ? { plan: g.sales, fact: m.sales, forecast: forecast.sales, chance: chance(g.sales, forecast.sales), gap: Math.max(0, Math.ceil(g.sales - forecast.sales)) } : null
    out.cpr = g.maxCpr && a?.cur.cpr ? { plan: g.maxCpr, fact: a.cur.cpr, ok: a.cur.cpr <= g.maxCpr, currency: a.currency } : null
    if (g.threeRooms) {
      const since = String(g.approvedAt || m.from).slice(0, 10)
      const sold = (m.soldThree || []).filter((x) => x >= since).length
      out.threeRooms = { plan: g.threeRooms, fact: sold, until: g.threeRoomsUntil, free: b.byRooms['3-комн.']?.free ?? null }
    }
    // coverage: what the current bookings could close of the gap
    const gapMoney = out.revenue?.gap || 0
    out.coverage = gapMoney ? { money: Math.round(bookedMoney), pct: Math.round((bookedMoney / gapMoney) * 100) } : null
    // what to do to get closer — arithmetic first, the limiting factor marked as probable
    const steps = []
    if (out.sales?.gap) steps.push(`Нужно ещё ≈${out.sales.gap} ${out.sales.gap === 1 ? 'продажа' : 'продажи'} сверх прогноза до конца месяца — при темпе ${out.pace.salesWeek} в неделю.`)
    if (booked.length) steps.push(`Довести до сделки брони в работе: ${booked.map((x) => `кв. ${x.n}`).join(', ')} — это ≈${Math.round(bookedMoney / 1e6)} млн ₸${out.coverage ? ` (${out.coverage.pct}% разрыва)` : ''}.`)
    if (out.cpr && !out.cpr.ok) steps.push(`Переписка дороже цели: ${out.cpr.fact} против ${out.cpr.plan} ${out.cpr.currency} — Алия разберёт, где подорожало.`)
    if (out.threeRooms && out.threeRooms.fact < out.threeRooms.plan) steps.push(`Трёхкомнатные: продано ${out.threeRooms.fact} из ${out.threeRooms.plan} по цели — нужна отдельная реклама и посты про них.`)
    if (a && b.weeks.at(-1)) {
      const conv = a.cur.results ? b.weeks.at(-1).bookings / a.cur.results : 0
      out.limit = a.cur.results < a.prev.results * 0.85 ? 'Вероятное ограничение — мало обращений: переписок меньше, чем неделю назад.' : conv < 0.04 ? 'Вероятное ограничение — обращения редко доходят до брони.' : 'Обращения и брони в норме — главное довести брони до сделки.'
    }
    out.steps = steps
    return out
  }

  // the follower goal and this week's content plan
  smm(d) {
    const g = this.initiative.smmGoal()
    const now = d.insta?.followers ?? null
    const pace = d.insta ? d.insta.cur.follows : null
    const need = now == null ? null : Math.max(0, Math.ceil((g.followersGoal - now) / g.weeks))
    const t = this.store.tasks.filter((x) => x.source === 'content-plan' && x.status === 'done').at(-1)
    const plan = t ? readPlan(t.id) : null
    const prop = t && this.initiative.state.proposals.find((p) => p.kind === 'content-plan' && p.tasks?.[0]?.dependsOn?.[0] === t.id)
    return {
      goal: g.followersGoal, until: g.until, goalDate: g.goalDate, weeks: g.weeks, now, pace, need,
      postsPerWeek: g.postsPerWeek, reelsPerWeek: g.reelsPerWeek, stats: this.contentStats(d.insta),
      pack: this.packNow(),
      plan: t ? { task: t.id, at: t.finishedAt, week: plan?.week || '', items: plan?.items || [], status: prop?.status || 'new', proposal: prop?.status === 'new' ? prop.id : null } : null,
    }
  }

  packNow() {
    const p = this.smmPack?.current()
    if (!p) return null
    const prop = this.initiative.state.proposals.find((x) => x.kind === 'smm-pack' && x.pack === p.id)
    // the week still going out from an earlier approved pack is shown too
    const today = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    const earlier = (this.smmPack.state.packs || []).filter((k) => k !== p && k.status === 'approved').flatMap((k) => k.items).filter((x) => x.date >= today && x.status !== 'superseded')
    const res = mediaResults()
    const arg = (a) => (a ? { kind: a.kind, product: a.product || '', usp: a.usp || '', audience: a.audience || '', objection: a.objection || '', why: a.why || '', check: a.check } : null)
    return { week: p.week, status: p.status, proposal: prop?.status === 'new' ? prop.id : null, strategy: p.strategy || [], check: p.check || '', items: [...earlier, ...p.items].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).map((x) => ({ date: x.date, time: x.time, type: x.type, manual: x.manual, sticker: x.sticker, status: x.status, caption: x.caption.slice(0, 160), permalink: x.permalink || '', error: x.error || '', video: x.video ? (x.music || 'есть') : '', videoError: x.videoError || '', result: (x.mediaId && res[x.mediaId]) || '', arg: arg(x.arg) })) }
  }

  // ---------- office side ----------

  name(id) { return this.employees.find((e) => e.id === id)?.name || id }

  team() {
    const why = (t) => {
      const p = t?.proposal && this.initiative.state.proposals.find((x) => x.id === t.proposal)
      const src = { weekly: 'недельный отчёт', 'content-plan': 'контент-план', 'week-goal': 'план недели', telegram: 'поручение из Telegram', web: 'поручение владельца', plan: 'план руководителя' }[t?.source]
      return p ? { source: p.source, why: p.text, goal: p.expected || (p.metric ? METRICS[p.metric]?.label : '') } : t ? { source: src || 'офис', why: '', goal: '' } : null
    }
    return this.employees.filter((e) => e.active).map((e) => {
      const running = this.store.tasks.find((t) => t.employee === e.id && t.status === 'running')
      const queue = this.store.tasks.filter((t) => t.employee === e.id && t.status === 'queued')
      const last = this.store.tasks.filter((t) => t.employee === e.id && t.status === 'done').at(-1)
      return { id: e.id, name: e.name, title: e.title, busy: !!running, doing: running?.title || null, reason: why(running), queue: queue.map((t) => t.title).slice(0, 5), last: last ? { title: last.title, at: last.finishedAt } : null }
    })
  }

  reports() {
    return this.store.tasks
      .filter((t) => t.status === 'done' && (REPORTERS.includes(t.employee) || ['director-report', 'month-report'].includes(t.source)))
      .slice(-60).reverse()
      .map((t) => {
        const p = t.proposal && this.initiative.state.proposals.find((x) => x.id === t.proposal)
        const type = t.source === 'director-report' ? 'director' : t.source === 'month-report' ? 'month' : t.source === 'weekly' ? 'weekly' : t.source === 'content-plan' ? 'plan' : t.source === 'week-goal' ? 'plan' : p ? 'decision' : ['smm', 'montazh'].includes(t.employee) ? 'draft' : 'request'
        return {
          id: t.id, employee: t.employee, name: this.name(t.employee), title: t.title, at: t.finishedAt || t.createdAt, weekly: t.source === 'weekly', type,
          area: AREAS[t.employee] || 'Другое', result: String(t.result || '').slice(0, 6000), files: (t.files || []).map((f) => f.path),
          decision: p ? { title: p.title, source: p.source, why: p.text, status: p.status, metric: p.metric ? METRICS[p.metric]?.label : null, result: p.result || null } : null,
        }
      })
  }

  // ---------- metrics for decisions ----------

  metricsFrom(d) {
    const w0 = d.board?.weeks.at(-1)
    return {
      results: d.ads?.cur.results ?? null, cpr: d.ads?.cur.cpr ?? null, ctr: d.ads?.cur.ctr ?? null,
      // without the payments the revenue is incomplete: no measurement rather than a false «не сработало»
      bookings: w0?.bookings ?? null, sales: w0?.sales ?? null, stale: d.board ? d.board.stale.length : null, revenue: d.board?.cash.payments === 'unavailable' ? null : w0?.revenue ?? null,
      reach: d.insta?.cur.reach ?? null, follows: d.insta?.cur.follows ?? null, posts: d.insta?.cur.posts ?? null,
    }
  }

  async metricsNow() { return (await this.get()).metrics }

  // ---------- the first screen: 4 numbers for the same 4 weeks and one plain sentence ----------

  top(d) {
    const b = d.board, a = d.ads
    const kpis = []
    const m = b?.periods.month
    if (m) {
      const noPay = b.cash.payments === 'unavailable'
      kpis.push({ key: 'revenue', label: 'Выручка', value: noPay ? null : m.cur.revenue, prev: m.prev.partial || noPay ? null : m.prev.revenue, money: true, trend: noPay ? [] : b.weeks.map((w) => w.revenue) })
      kpis.push({ key: 'sales', label: 'Продажи', value: m.cur.sales, prev: m.prev.partial ? null : m.prev.sales, trend: b.weeks.map((w) => w.sales) })
    }
    if (a?.month) {
      kpis.push({ key: 'leads', label: 'Обращения', value: a.month.cur.results, prev: a.month.prev.results, trend: a.weeks?.map((w) => w.results) })
      kpis.push({ key: 'spend', label: 'Расход', value: a.month.cur.spend, prev: a.month.prev.spend, unit: a.currency, neutral: true, trend: a.weeks?.map((w) => w.spend) })
    }
    const pct = (k) => (k && k.prev ? Math.round(((k.value - k.prev) / k.prev) * 100) : null)
    const [rev, , leads] = [kpis.find((k) => k.key === 'revenue'), null, kpis.find((k) => k.key === 'leads')]
    const r = b?.cash.payments === 'unavailable' ? null : pct(rev), l = pct(leads)
    const parts = []
    if (r != null) parts.push(`Выручка ${r >= 0 ? 'выросла' : 'снизилась'} на ${Math.abs(r)}%`)
    if (l != null) parts.push(`обращений из рекламы стало ${l >= 0 ? 'больше' : 'меньше'} на ${Math.abs(l)}%`)
    let text = parts.length ? parts.join(', а ') + '.' : 'Данных за 4 недели пока мало.'
    text = text.charAt(0).toUpperCase() + text.slice(1)
    if (!d.crm) text += ' Какая именно реклама привела покупателей, пока не видно — для этого нужна связь переписок с клиентами (WhatsApp или CRM).'
    return { period: 'за 4 недели к предыдущим 4', kpis, text }
  }

  // ---------- the home page: three numbers with a colour, up to three things to do today, one phrase ----------
  // Everything here is plain arithmetic: no Claude, so it can be shown and sent every morning for free.

  home(d, goals) {
    const b = d.board, a = d.ads, c = d.crm
    if (!b && !a && !c) return null
    const cfg = this.initiative.cfg || {}
    const today = ymd(new Date())
    const tiles = []

    // 1. pace to the handover: sold per month now against what is needed to sell `share` of the flats in time
    if (b?.toSell) {
      const t = b.toSell, hv = cfg.handover || {}
      const end = Date.parse(`${hv.date || '2027-09-30'}T23:59:59+05:00`)
      const monthsLeft = (end - Date.now()) / (30.44 * 864e5)
      const target = Math.ceil((hv.share ?? 1) * t.sellable)
      const toGo = Math.max(0, target - t.sold)
      const perMonth = Math.max(0, t.net) / (t.days / 30.44)
      const need = monthsLeft > 0 ? toGo / monthsLeft : null
      const period = t.days >= 84 ? 'за 3 месяца' : `за ${Math.round(t.days / 7)} нед.`
      const atHandover = monthsLeft > 0 ? Math.max(0, Math.round(toGo - perMonth * monthsLeft)) : toGo
      const valueOk = t.leftValue && t.leftPriced >= t.left * 0.5
      const detail = {
        perMonth: round(perMonth, 1), need: need == null ? null : round(need, 1), toGo, target, share: hv.share ?? 1, sold: t.sold, sellable: t.sellable, left: t.left, booked: t.booked,
        handover: hv.label || hv.date, monthsLeft: round(Math.max(0, monthsLeft), 1), period, atHandover,
        atHandoverValue: valueOk && t.left ? Math.round((t.leftValue / t.left) * atHandover) : null, leftPriced: t.leftPriced,
        lastFlat: perMonth > 0 ? ymd(new Date(Date.now() + (toGo / perMonth) * 30.44 * 864e5)).slice(0, 7) : null,
        weeks: (b.history || []).map((w) => ({ from: w.from, to: w.to, sales: w.sales })),
        leadsNeed: this.leadsNeed(b, a, need, perMonth),
      }
      let tile
      if (!toGo) tile = { big: `${t.sold} из ${target}`, sub: 'продано · цель к сдаче', status: 'green', word: 'цель достигнута' }
      else if (monthsLeft <= 2) tile = { big: `осталось ${toGo} кв.`, sub: monthsLeft > 0 ? `до сдачи ${hv.label || ''}` : 'срок сдачи прошёл', status: monthsLeft > 0 ? 'amber' : 'red', word: monthsLeft > 0 ? 'последние месяцы' : 'срок прошёл' }
      else {
        const ratio = perMonth / need
        tile = { big: `${nf(perMonth)} из ${nf(need)}`, sub: `квартиры в месяц · ${period}`, status: ratio >= 1 ? 'green' : ratio >= 0.8 ? 'amber' : 'red', word: ratio >= 1 ? 'успеваем' : ratio >= 0.8 ? 'впритык' : 'отстаём' }
      }
      tiles.push({ key: 'pace', name: 'Темп к сдаче', main: true, ...tile, detail })
    }

    // 2. money of the month: received since the 1st against the month plan; too early to judge before the 10th
    if (b) {
      const now = new Date(Date.now() + 5 * 3600e3)
      const month = now.getUTCMonth(), dayOf = now.getUTCDate()
      const noPay = b.cash.payments === 'unavailable'
      const fact = noPay ? null : b.thisMonth.revenue
      const r = goals?.revenue
      const detail = {
        fact, cash: noPay ? null : b.thisMonth.cash, plan: r?.plan ?? null, forecast: goals?.forecast?.revenue ?? null, chance: r?.chance ?? null,
        restOfMonth: b.cash.restOfMonth, nextMonths: b.cash.nextMonths, overdue: b.cash.overdueList, extra: b.cash.extra.filter((x) => x.date >= b.thisMonth.from), monthIn: MONTH_IN[month],
        unavailable: b.cash.unavailable,
      }
      let tile
      // without the payments list «Продана» counts at full price on the sale day — not money received: no sum at all
      if (noPay) tile = { big: 'нет данных', sub: r?.plan ? `план ${mln(r.plan)} млн ₸` : 'получено с 1-го числа', status: 'grey', word: 'оплаты не прочитались' }
      else if (r?.plan) {
        const early = dayOf < 10 && fact < r.plan
        tile = { big: `${mln(fact)} из ${mln(r.plan)} млн ₸`, sub: 'получено · план месяца', status: early ? 'grey' : { высокая: 'green', средняя: 'amber', низкая: 'red' }[r.chance] || 'grey', word: early ? 'рано судить' : { высокая: 'успеваем', средняя: 'впритык', низкая: 'отстаём' }[r.chance] || '' }
      } else tile = { big: `${mln(fact)} млн ₸`, sub: `получено в ${MONTH_IN[month]}`, status: 'grey', word: 'плана нет' }
      tiles.push({ key: 'money', name: `Деньги ${MONTH_OF[month]}`, ...tile, detail })
    }

    // 3. new clients: CRM leads of the last 7 days against an ordinary week (Meta conversations without a CRM)
    {
      let cur = null, usual = null, prev = null, name = 'Новые клиенты', detail = null
      if (c?.pulse) {
        const w = c.pulse.weeks
        cur = w[0].count
        const full = w.slice(1, 5).filter((x) => x.full)
        if (full.length >= 2) usual = full.reduce((s, x) => s + x.count, 0) / full.length
        else prev = w[1].count
        detail = { kind: 'crm', fewWeeks: usual == null, weeks: w, sources: c.pulse.sources, nonTarget: c.pulse.nonTarget, since: c.pulse.firstAt?.slice(0, 10) || null, chats: a?.cur.chats ?? null, deep: a?.cur.deep ?? null, cpq: a?.cur.cpq ?? null, currency: a?.currency || '' }
      } else if (a?.weeks?.length) {
        name = 'Переписки из рекламы'
        cur = a.cur.chats
        const back = a.weeks.slice(-5, -1).map((x) => x.chats)
        usual = back.length >= 2 ? back.reduce((s, x) => s + x, 0) / back.length : null
        detail = { kind: 'ads', weeks: a.weeks.map((x) => x.chats), chats: a.cur.chats, cpq: a.cur.cpq, deep: a.cur.deep, currency: a.currency }
      }
      if (cur != null) {
        let status = 'grey', word = usual == null ? 'мало истории' : 'как обычно'
        // small numbers jump by chance: a colour needs both a share and an absolute gap
        if (usual != null && cur < usual * 0.6 && usual - cur >= 6) { status = 'red'; word = 'мало' }
        else if (usual != null && cur < usual * 0.8 && usual - cur >= 4) { status = 'amber'; word = 'меньше обычного' }
        else if (usual != null && cur > usual * 1.2 && cur - usual >= 4) { status = 'green'; word = 'больше обычного' }
        // the CRM copy is older than 3 hours: the count may miss the newest clients, no colour
        if (c?.fresh?.ageH > 3) { status = 'grey'; word = 'CRM не обновлялась' }
        const sub = usual != null ? `за неделю · обычно ${Math.round(usual)}` : prev != null ? `за неделю · неделей раньше ${prev}` : 'за неделю'
        tiles.push({ key: 'leads', name, big: String(cur), sub, status, word, detail })
      }
    }

    // up to three things to do today: someone does them, there is a number or a sum, they vanish once done
    const dismissed = this.initiative.state.dismissed || {}
    const off = (k) => { const v = dismissed[k]; return !!v && (!v.until || v.until >= today) }
    const tasks = []
    const add = (x) => { const keys = x.keys.filter((k) => !off(k)); if (keys.length) tasks.push({ ...x, keys, key: keys.join('|') }) }
    const w = c?.pulse?.waiting || []
    if (w.length) add({ kind: 'wait', sev: 'red', who: 'Менеджер', keys: w.map((x) => `wait:${x.id}`), text: `Ответить ${w.length} ${plural(w.length, 'клиенту', 'клиентам', 'клиентам')} — ${w.length === 1 ? 'ждёт' : 'ждут'} первого ответа дольше 2 часов (в CRM: ${w.slice(0, 5).map((x) => `№${x.id}`).join(', ')})` })
    const due = (b?.cash.overdueList || []).filter((x) => !x.since || x.since <= daysAgo(3))
    if (due.length) {
      const sum = due.reduce((t, x) => t + x.amount, 0)
      const oldest = due.map((x) => x.since).filter(Boolean).sort()[0]
      add({ kind: 'overdue', sev: oldest && oldest <= daysAgo(14) ? 'red' : 'amber', who: 'Менеджер', keys: due.map((x) => `overdue:${x.n}:${x.since || ''}`), text: `Проверить, внесена ли оплата кв. ${due.map((x) => x.n).join(', ')} — по шахматке просрочено ${sum >= 1e6 ? `${mln(sum)} млн ₸` : `${nf(sum, 0)} ₸`}${oldest ? ` с ${dm(oldest)}` : ''}` })
    }
    if (b?.stale.length) {
      const days = b.stale.map((x) => x.days)
      const lo = Math.min(...days), hi = Math.max(...days)
      add({ kind: 'stale', sev: hi >= 14 ? 'red' : 'amber', who: 'Менеджер', keys: b.stale.map((x) => `stale:${x.n}:${x.since}`), text: `Позвонить по ${b.stale.length} ${plural(b.stale.length, 'брони', 'броням', 'броням')} (кв. ${b.stale.map((x) => x.n).join(', ')}) — ${b.stale.length === 1 ? 'висит' : 'висят'} ${lo === hi ? hi : `${lo}–${hi}`} ${plural(hi, 'день', 'дня', 'дней')}` })
    }
    if (a?.days?.length) {
      const lastSpend = a.lastSpend
      // in the account's own days: a.until is its last complete day, so spend on it means idle 1
      const idle = lastSpend ? Math.round((Date.parse(a.until || today) - Date.parse(lastSpend)) / 864e5) + (a.until ? 1 : 0) : 56
      const acc = a.account, bad = a.problems || []
      // the reason first: a stopped account or a rejected ad is not «реклама не крутится»
      if (acc?.grace) add({ kind: 'ads', sev: 'amber', who: 'Вы', link: 'marketing', keys: [`adsacct:${acc.status}`], text: `Рекламный кабинет Meta: оплата не прошла — реклама ещё идёт, но Meta остановит её, если не оплатить. Ads Manager → «Оплата»` })
      else if (acc && !acc.active) add({ kind: 'ads', sev: 'red', who: 'Вы', link: 'marketing', keys: [`adsacct:${acc.status}`], text: `Рекламный кабинет Meta: ${acc.reason} — реклама не показывается. Исправить в Ads Manager → «Настройки» / «Оплата»` })
      else if (acc?.capReached) add({ kind: 'ads', sev: 'red', who: 'Вы', link: 'marketing', keys: [`adscap:${acc.cap}`], text: `Исчерпан лимит расходов кабинета Meta (${nf(acc.cap, 0)} ${a.currency === 'USD' ? '$' : a.currency}) — реклама остановлена. Поднять или снять лимит в Ads Manager → «Оплата»` })
      else if (bad.length) add({ kind: 'ads', sev: 'red', who: 'Вы', link: 'marketing', keys: bad.map((x) => `adbad:${x.id}:${x.st}`), text: `${bad[0].what}: «${String(bad[0].name).replace(/^Публикация в Instagram:\s*/i, '').slice(0, 50)}»${bad[0].why ? ` — ${bad[0].why}` : ''}${bad.length > 1 ? ` (и ещё ${bad.length - 1})` : ''}. Исправить в Ads Manager` })
      else if (idle >= 2) add({ kind: 'ads', sev: 'amber', who: 'Вы', link: 'marketing', keys: [`adsstop:${lastSpend || 'none'}`], text: `Реклама не крутится ${lastSpend ? `${idle} ${plural(idle, 'день', 'дня', 'дней')}` : 'больше 8 недель'} — продлить «Продвигать» или запустить новую? Решение за вами` })
    }
    const unb = (b?.unbooked30 || []).filter((x) => x.at > daysAgo(7))
    if (unb.length) add({ kind: 'unbook', sev: 'amber', who: 'Менеджер', keys: unb.map((x) => `unbook:${x.n}:${x.at}`), text: `Узнать, почему сняли бронь с кв. ${unb.map((x) => x.n).join(', ')}, и записать причину в CRM` })
    const ORDER = ['wait', 'overdue', 'stale', 'ads', 'unbook']
    tasks.sort((p, q) => (p.sev === 'red' ? 0 : 1) - (q.sev === 'red' ? 0 : 1) || ORDER.indexOf(p.kind) - ORDER.indexOf(q.kind))

    // the phrase says what the tiles cannot: what the lagging pace asks of the ads
    const pace = tiles.find((x) => x.key === 'pace')
    const ln = pace?.detail?.leadsNeed
    const phrase = !pace || pace.status === 'green' || !ln ? null
      : ln.needChats > ln.haveChats ? `Чтобы успеть к сдаче, нужно ≈${ln.needChats} переписок из рекламы в месяц, сейчас ≈${ln.haveChats}${ln.extraSpend ? ` — это ещё ≈${nf(ln.extraSpend, 0)} ${ln.currency === 'USD' ? '$' : ln.currency} в месяц, решение за вами` : ''}.`
      : `Переписок из рекламы хватает (≈${ln.haveChats} в месяц) — отстаём из-за того, что мало переписок доходят до продажи.`

    // what the numbers above do not know yet: one grey line instead of separate alarms
    const gaps = []
    if (b && b.priced < b.total) gaps.push(`цены у ${b.priced} из ${b.total} квартир`)
    if (b?.cash.unfilled.length) gaps.push(`оплаты не внесены у ${b.cash.unfilled.length} ${plural(b.cash.unfilled.length, 'сделки', 'сделок', 'сделок')}`)
    if (c?.pulse && (!c.pulse.withApartment || !c.pulse.withAd)) gaps.push(`CRM пока без ${[!c.pulse.withApartment && 'номера квартиры', !c.pulse.withAd && 'ссылки на рекламу'].filter(Boolean).join(' и ')}`)
    if (!c && !this.crm?.status().configured) gaps.push('CRM не подключена')
    const fx = usdKzt()

    // the morning Telegram line: the same numbers, built by code; a source that did not answer is never «спокойно»
    // a key source that fails or has gone stale (sources.js) names itself; a note of a source the book does not know stays as before
    const bad = (d.sources || []).filter((x) => x.key && x.morning)
    const known = { Шахматка: 'chess', 'Оплаты шахматки': 'chess', 'Реклама Meta': 'ads', Instagram: 'insta', CRM: 'crm' }
    const covered = new Set((d.sources || []).map((x) => x.id))
    const other = (d.notes || []).map((n) => String(n).split(':')[0]).filter((n) => !covered.has(known[n]))
    const failed = [...bad.map((x) => x.name), ...other]
    const warn = [...bad.map((x) => `⚠️ ${x.morning}`), ...(other.length ? [`⚠️ Не ответили: ${other.join(', ')} — по ним цифр сегодня нет`] : [])].join('\n')
    const short = tiles.map((x) => `${x.name}: ${x.big}${x.word ? ` (${x.word})` : ''}`).join('\n')
    const morning = (tasks.length
      ? `☀️ Сделать сегодня:\n${tasks.slice(0, 3).map((x, i) => `${i + 1}. ${x.who}: ${x.text}`).join('\n')}${tasks.length > 3 ? `\n…и ещё ${tasks.length - 3} — появятся, когда эти будут сделаны` : ''}${warn ? `\n\n${warn}` : ''}\n\n${short}`
      : warn ? `${warn}\nСрочных дел по остальным данным не видно.\n\n${short}`
      : `✓ Спокойно: срочных дел нет.\n\n${short}`) + (phrase ? `\n\n${phrase}` : '')
    return { tiles, tasks: tasks.slice(0, 3), more: Math.max(0, tasks.length - 3), phrase, gaps, fx, morning, failed }
  }

  // a mistake in the home page must not take the whole portal down: the old overview is shown instead
  safeHome(d, goals) {
    try { return this.home(d, goals) } catch (e) { console.error('Главная:', e.message); return null }
  }

  // How many conversations a month the needed pace asks for, and roughly what that costs.
  // Rough on purpose: conversion = sales / ad conversations of the last 8 weeks, not every sale came from an ad.
  leadsNeed(b, a, need, perMonth) {
    if (!a?.weeks?.length || !b?.history?.length || !need || need <= perMonth) return null
    const chats8 = a.weeks.reduce((t, x) => t + x.chats, 0)
    const sales8 = b.history.slice(-8).reduce((t, x) => t + x.sales, 0)
    if (!chats8 || !(sales8 > 0)) return null
    const last4 = a.weeks.slice(-4)
    // only money spent on chat ads buys chats: forms («Лиды») and reach are left out
    const chats4 = last4.reduce((t, x) => t + x.chats, 0), spend4 = last4.reduce((t, x) => t + (x.spendChat || 0), 0)
    // the price of a conversation: chat-ad money over chat-ad conversations only
    const chatChats4 = last4.reduce((t, x) => t + (x.chatChats ?? x.chats), 0)
    const perSale = chats8 / sales8
    const needChats = Math.round(need * perSale)
    const haveChats = Math.round((chats4 * 30.44) / 28)
    const perChat = chatChats4 && spend4 ? spend4 / chatChats4 : null
    const extra = perChat && needChats > haveChats ? Math.round((needChats - haveChats) * perChat) : null
    const fx = usdKzt()
    return { perSale: round(perSale, 0), needChats, haveChats, extraSpend: extra, currency: a.currency, extraKzt: extra && fx && a.currency === 'USD' ? Math.round(extra * fx.usd) : null, fx: fx ? { usd: fx.usd, date: fx.date } : null }
  }

  // ---------- top KPIs: value, change, trend, status ----------

  kpi(d) {
    const b = d.board, a = d.ads
    const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
    const out = []
    if (b) {
      const last4 = b.weeks.slice(-4), prev4 = b.weeks.slice(0, 4)
      // the previous 4 weeks started before the status log: no comparison (the same check as top())
      const part = !!b.since && prev4[0].from < b.since
      const noPay = b.cash.payments === 'unavailable'
      const note = noPay ? 'шахматка не ответила (оплаты) — суммы нет' : b.cash.unfilled.length ? `без оплат: ${b.cash.unfilled.length} ${plural(b.cash.unfilled.length, 'сделка', 'сделки', 'сделок')}` : 'получено денег'
      out.push({ key: 'revenue', label: 'Выручка, 4 недели', value: noPay ? null : sum(last4, 'revenue'), prev: part || noPay ? null : sum(prev4, 'revenue'), unit: '₸', trend: noPay ? [] : b.weeks.map((w) => w.revenue), note })
      out.push({ key: 'sales', label: 'Продажи, 4 недели', value: sum(last4, 'sales'), prev: part ? null : sum(prev4, 'sales'), trend: b.weeks.map((w) => w.sales) })
    }
    if (a) {
      out.push({ key: 'results', label: 'Переписки, 7 дней', value: a.cur.results, prev: a.prev.results, trend: a.days.map((x) => x.results) })
      out.push({ key: 'spend', label: 'Расход на рекламу, 7 дней', value: a.cur.spend, prev: a.prev.spend, unit: a.currency, neutral: true, trend: a.days.map((x) => x.spend) })
      out.push({ key: 'cpr', label: 'Цена переписки', value: a.cur.cpr, prev: a.prev.cpr, unit: a.currency, lower: true, trend: a.days.map((x) => x.cpr ?? null), note: a.cur.spendReach ? `только реклама на переписки и форму; на охват/профиль — ещё ${a.cur.spendReach} ${a.currency}` : '' })
    }
    if (a && b) {
      const w0 = b.weeks.at(-1), w1 = b.weeks.at(-2)
      out.push({ key: 'conv', label: 'Брони на 100 переписок', value: a.cur.results ? Math.round((w0.bookings / a.cur.results) * 1000) / 10 : null, prev: a.prev.results ? Math.round((w1.bookings / a.prev.results) * 1000) / 10 : null, note: 'грубо: не все брони пришли из рекламы' })
    }
    out.push({ key: 'romi', label: 'ROMI', value: null, empty: d.crm ? (d.crm.pulse?.withAd ? 'по объявлениям — в «Продажах», по CRM' : 'CRM пока не передаёт, с какой рекламы пришла сделка') : 'нужна CRM: источник каждой сделки' })
    return out
  }

  // ---------- why revenue changed: exact arithmetic + observed links ----------

  change(d) {
    const b = d.board
    if (!b) return null
    const cur = b.weeks.slice(-4), prev = b.weeks.slice(0, 4)
    const agg = (list) => {
      const o = { revenue: 0, sales: 0, bookings: 0 }
      for (const k of Object.keys(CASH_RU)) o[k] = list.reduce((t, w) => t + w.cash[k], 0)
      for (const k of ['revenue', 'sales', 'bookings']) o[k] = list.reduce((t, w) => t + w[k], 0)
      return o
    }
    const c = agg(cur), p = agg(prev)
    const part = !!b.since && prev[0].from < b.since
    const mln = (v) => `${Math.round(v / 1e5) / 10} млн ₸`
    // received money = bookings + first payments + installments + full payments: the change splits exactly by kind
    const factors = Object.keys(CASH_RU).filter((k) => c[k] || p[k]).map((k) => ({ kind: 'fact', sign: Math.sign(c[k] - p[k]), label: CASH_RU[k], text: `${mln(p[k])} → ${mln(c[k])}`, amount: c[k] - p[k] }))
    const links = []
    links.push({ kind: 'link', sign: Math.sign(c.sales - p.sales), label: 'Новые сделки', text: `${p.sales} → ${c.sales} за 4 недели — дают взнос сейчас и платежи по рассрочке потом` })
    links.push({ kind: 'link', sign: Math.sign(c.bookings - p.bookings), label: 'Брони', text: `${p.bookings} → ${c.bookings} за 4 недели — брони сегодня становятся продажами завтра` })
    if (d.ads) links.push({ kind: 'link', sign: Math.sign(d.ads.cur.results - d.ads.prev.results), label: 'Переписки из рекламы', text: `${d.ads.prev.results} → ${d.ads.cur.results} за 7 дней; ${d.crm ? 'какая реклама привела покупателей — в «Продажах», по CRM' : 'связь с продажами без CRM не доказать'}` })
    if (b.stale.length) links.push({ kind: 'probable', sign: -1, label: 'Зависшие брони', text: `${b.stale.length} дольше недели — вероятный фактор, который тормозит продажи` })
    const missing = []
    if (b.cash.payments === 'unavailable') missing.push('шахматка не ответила (оплаты) — выручка посчитана по ценам проданных квартир на день продажи, это не полученные деньги (может быть завышена)')
    if (b.cash.unfilled.length) missing.push(`по ${b.cash.unfilled.length} ${plural(b.cash.unfilled.length, 'сделке', 'сделкам', 'сделкам')} не внесены оплаты — их деньги не вошли в выручку`)
    if (part) missing.push(`журнал шахматки ведётся с ${dm(b.since)} — предыдущие 4 недели неполные, процент не считаем`)
    if (!d.crm) missing.push('источники сделок и этапы воронки появятся с CRM')
    return { period: '4 недели к предыдущим 4', revenue: c.revenue, prev: p.revenue, delta: p.revenue && !part && b.cash.payments !== 'unavailable' ? Math.round(((c.revenue - p.revenue) / p.revenue) * 100) : null, factors, links, missing }
  }

  // ---------- "first of all": what happened, why it matters, money, what to do ----------

  judge(d) {
    const dismissed = this.initiative.state.dismissed || {}
    const props = this.initiative.list()
    const b = d.board, a = d.ads, i = d.insta
    const avgPrice = b?.revenue.soldPriced ? b.revenue.known / b.revenue.soldPriced : null
    const signals = []
    const add = (x) => { if (!dismissed[x.key]) signals.push(x) }
    // goals and the week plan live on the Plan page, not among the events
    for (const p of props.filter((x) => !['week-goal', 'month-goals', 'week-plan', 'smm-pack'].includes(x.kind))) {
      add({ key: `p:${p.id}`, level: p.urgent ? 'critical' : p.kind === 'week-goal' ? 'attention' : 'opportunity', what: p.title, why: p.text, from: p.from, proposal: p.id, metric: p.metric, due: p.due, expected: p.expected, cause: { kind: p.kind === 'alert' ? 'probable' : 'link', text: '' }, section: section(p.from) })
    }
    if (b?.stale.length) {
      const priced = b.stale.filter((x) => x.price)
      const money = priced.reduce((t, x) => t + x.price, 0) + (b.stale.length - priced.length) * (avgPrice || 0)
      add({ key: `stale:${b.stale.map((x) => x.n).join(',')}`, level: 'critical', from: 'sales', section: 'sales',
        what: `${b.stale.length} ${plural(b.stale.length, 'бронь висит', 'брони висят', 'броней висят')} дольше недели`,
        why: `Кв. ${b.stale.slice(0, 5).map((x) => `${x.n} (${x.days} дн.)`).join(', ')}. Долгая бронь часто заканчивается отказом.`,
        impact: money ? { amount: money, text: `под риском ≈${Math.round(money / 1e6)} млн ₸${priced.length < b.stale.length ? ' (часть — по средней цене)' : ''}` } : null,
        cause: { kind: 'probable', text: 'Вероятная причина: клиент сомневается или ждёт условий — без звонка не узнать.' },
        action: { employee: 'sales', title: 'Скрипт звонка по зависшим броням', text: `Брони дольше недели: ${b.stale.map((x) => `кв. ${x.n} (${x.r}-комн., ${x.days} дн.)`).join(', ')}. Подготовь менеджеру короткий скрипт звонка по каждой и 2–3 аргумента, чтобы довести до сделки (факты — только из базы).`, metric: 'stale', expected: 'меньше зависших броней, часть перейдёт в продажи', days: 2 } })
    }
    const off = a?.rows.filter((r) => r.verdict === 'off') || []
    if (off.length) {
      const waste = off.reduce((t, r) => t + r.spend, 0)
      add({ key: `off:${off.map((r) => r.id).join(',')}`, level: 'critical', from: 'marketing', section: 'marketing',
        what: `${off.length} ${plural(off.length, 'объявление тратит', 'объявления тратят', 'объявлений тратят')} без отдачи`,
        why: off.slice(0, 3).map((r) => `«${r.name}»: ${r.spend} ${a.currency}, ${r.kind === 'form' ? `заявок ${r.leads}` : `переписок ${r.chats}, живых ${r.deep}`}`).join('; '),
        impact: { amount: waste, currency: a.currency, text: `${Math.round(waste)} ${a.currency} за неделю на объявления без результата или в 1,5 раза дороже среднего` },
        cause: { kind: 'fact', text: 'Факт: расход есть, переписок нет или они в 1,5 раза дороже средних.' },
        action: { employee: 'marketing', title: 'Что выключить и чем заменить', text: `Объявления без отдачи: ${off.map((r) => `«${r.name}» (${r.spend} ${a.currency}, переписок ${r.results}, частота ${r.freq})`).join('; ')}. Разбери по каждому: выключить или поменять креатив/настройку — пошагово по экранам Ads Manager.`, metric: 'cpr', expected: 'дешевле переписка', days: 1 } })
    }
    if (a && a.prev.cpr && a.cur.cpr && a.cur.cpr > a.prev.cpr * 1.2) {
      const extra = (a.cur.cpr - a.prev.cpr) * (a.cur.paid ?? a.cur.results)
      const tired = a.rows.filter((r) => r.freq > 3).length
      add({ key: `cpr:${a.cur.cpr}`, level: 'attention', from: 'marketing', section: 'marketing',
        what: `Переписка подорожала на ${pct(a.cur.cpr, a.prev.cpr)}%`, why: `${a.prev.cpr} → ${a.cur.cpr} ${a.currency} за неделю.`,
        impact: { amount: extra, currency: a.currency, text: `≈${Math.round(extra)} ${a.currency} переплаты за неделю` },
        cause: { kind: tired ? 'probable' : 'link', text: tired ? `Вероятный фактор: у ${tired} объявл. частота выше 3 — аудитория устала.` : 'Данных недостаточно для вывода о причине: Алия разберёт по объявлениям.' },
        action: { employee: 'marketing', title: 'Почему подорожала переписка', text: `Цена переписки выросла с ${a.prev.cpr} до ${a.cur.cpr} ${a.currency}. Найди по объявлениям, где подорожало, и что поменять (креатив, аудитория, бюджет) — пошагово.`, metric: 'cpr', expected: 'вернуть цену переписки к прошлой неделе', days: 2 } })
    }
    if (b) {
      const c = b.weeks.slice(-4).reduce((t, w) => t + w.sales, 0), p = b.weeks.slice(0, 4).reduce((t, w) => t + w.sales, 0)
      const part = !!b.since && b.weeks[0].from < b.since
      if (p > 0 && c < p && !part) add({ key: `salesdown:${c}:${p}`, level: 'attention', from: 'sales', section: 'sales',
        what: `Продаж меньше на ${Math.abs(pct(c, p))}%`, why: `${p} → ${c} за 4 недели к предыдущим 4.`,
        impact: avgPrice ? { amount: (p - c) * avgPrice, text: `≈${Math.round(((p - c) * avgPrice) / 1e6)} млн ₸ недополучено по среднему чеку` } : null,
        cause: { kind: 'link', text: d.crm ? 'На каком этапе теряем — воронка CRM в «Продажах»: обращений меньше или они реже доходят до брони.' : 'Без CRM не видно, на каком этапе теряем: обращений меньше или они реже доходят до брони.' },
        action: { employee: 'sales', title: 'Где теряем продажи', text: 'Продаж за 4 недели меньше, чем за предыдущие 4. Разбери по журналу статусов и рекламе, на каком этапе вероятнее всего теряем, и что сделать менеджеру на этой неделе.', metric: 'sales', expected: 'вернуть темп продаж', days: 3 } })
    }
    if (b?.cash.unfilled.length) add({ key: `unpaid:${b.cash.unfilled.map((x) => x.n).join(',')}`, level: 'attention', from: 'revenue', section: 'revenue',
      what: `Не внесены оплаты по ${b.cash.unfilled.length} ${plural(b.cash.unfilled.length, 'сделке', 'сделкам', 'сделкам')}`, why: `Кв. ${b.cash.unfilled.map((x) => x.n).join(', ')}. Пока сумм нет, деньги по ним не входят в выручку.`,
      cause: { kind: 'fact', text: 'Факт: выручка считается только по внесённым оплатам.' }, owner: 'Внесите бронь, взнос и платежи в шахматке' })
    if (b && b.priced < b.total * 0.5) add({ key: 'prices', level: 'attention', from: 'revenue', section: 'revenue',
      what: `Цены внесены только у ${b.priced} из ${b.total} квартир`, why: 'Выручка, прогноз и потери считаются только по квартирам с ценой.',
      cause: { kind: 'fact', text: 'Факт: без цен расчёты неполные.' }, owner: 'Внесите цены в шахматку' })
    // sales below the base price are discounts entered by managers on purpose: no signal (owner, 19.11.2026)
    if (i && i.cur.posts === 0) add({ key: `noposts:${daysAgo(0)}`, level: 'attention', from: 'smm', section: 'smm', what: 'За неделю нет публикаций', why: 'Подписчики не видят свежих поводов — посты работают на прогрев и продажи.',
      cause: { kind: 'fact', text: 'Факт.' }, action: { employee: 'smm', title: 'Пост на завтра', text: 'Сделай пост на завтра (текст и картинку в стиле Altyn Qala) на самую сильную тему недели — по выводам Алии и базе.', metric: 'posts', expected: 'регулярные публикации', days: 1 } })
    const best = a?.rows.filter((r) => r.verdict === 'scale') || []
    if (best.length) {
      const r = best[0], chat = r.kind === 'chat'
      const what = chat ? 'живой разговор (клиент написал 3+ сообщения)' : 'заявку из формы', price = chat ? r.cpq : r.cpl, med = chat ? a.median.chat : a.median.form
      const got = chat ? `${r.deep} живых разговоров из ${r.chats} переписок` : `${r.leads} заявок`
      add({ key: `scale:${best.map((x) => x.id).join(',')}`, level: 'opportunity', from: 'marketing', section: 'marketing',
        what: `«${r.name}» даёт ${chat ? 'живой разговор' : 'заявку'} дешевле среднего`, why: `${price} ${a.currency} за ${what} против ${med} в среднем, ${got} за неделю.`,
        cause: { kind: 'fact', text: 'Факт за неделю; держится ли эффект при большем бюджете — проверяется тестом.' },
        action: { employee: 'marketing', title: 'Как масштабировать лучшее объявление', text: `Объявление «${r.name}» даёт ${what} по ${price} ${a.currency} (среднее ${med}), ${got} за неделю. Предложи, как масштабировать: на сколько поднять бюджет, дублировать ли на новые аудитории — пошагово и с расчётом; бюджет меняет владелец.`, metric: 'results', expected: 'больше результатов по той же цене', days: 2 } })
    }
    if (i) {
      const sorted = [...i.posts].sort((p, q) => q.reach - p.reach)
      const median = sorted[Math.floor(sorted.length / 2)]?.reach || 0
      const hot = i.posts.find((p) => p.date >= daysAgo(6) && median && p.reach >= median * 2)
      if (hot) add({ key: `hot:${hot.link}`, level: 'opportunity', from: 'marketing', section: 'smm', what: `Пост набрал охват в ${Math.round(hot.reach / median)} раза выше обычного`, why: `«${hot.caption.slice(0, 70)}» — ${hot.reach}.`,
        cause: { kind: 'fact', text: 'Факт; почему зашёл — версия Алии.' },
        action: { employee: 'marketing', title: 'Продвигать ли сильный пост', text: `Пост ${hot.link} набрал охват ${hot.reach} при обычном ${median}. Стоит ли продвигать его рекламой на подписки и с какими настройками — пошагово; бюджет решает владелец.`, metric: 'follows', expected: 'больше новых подписчиков', days: 2 } })
    }
    for (const w of this.wins(d)) add({ key: `win:${w.title}`, level: 'positive', from: w.from, section: w.section, what: w.title, why: w.text || '', value: w.value, delta: w.delta, cause: { kind: 'fact', text: '' } })

    const order = { critical: 0, attention: 1, opportunity: 2, positive: 3 }
    signals.sort((p, q) => order[p.level] - order[q.level])
    // "what to do now": the 3–5 most important actions
    const todo = signals.filter((x) => x.action || x.proposal || x.owner).slice(0, 5).map((x) => ({
      key: x.key, level: x.level, what: x.action?.title || x.what, why: x.what, from: x.action?.employee || x.from, proposal: x.proposal,
      owner: x.owner || null, expected: x.action?.expected || x.expected || (x.metric ? METRICS[x.metric]?.label : ''),
      metric: x.action?.metric || x.metric, due: x.due || (x.action ? daysAgo(-(x.action.days || 3)) : null),
    }))
    return { signals: signals.slice(0, 12), todo, first: signals.filter((x) => x.level === 'critical' || x.level === 'attention'), wins: signals.filter((x) => x.level === 'positive'), advice: signals.filter((x) => x.level === 'opportunity' && x.proposal) }
  }

  // "where we lose money": every item with the sum when it can be counted, honest when it can't
  losses(d) {
    const b = d.board, a = d.ads
    const out = []
    if (b) {
      const avgPrice = b.revenue.soldPriced ? b.revenue.known / b.revenue.soldPriced : null
      if (b.stale.length) {
        const money = b.stale.reduce((t, x) => t + (x.price || avgPrice || 0), 0)
        out.push({ level: 'critical', title: 'Долгие брони', text: `${b.stale.length} дольше недели: кв. ${b.stale.map((x) => x.n).join(', ')}`, amount: money || null, kind: 'probable', note: 'под риском, если клиент откажется', section: 'sales' })
      }
      if (b.unbooked30.length) {
        const money = b.unbooked30.reduce((t, x) => t + (x.price || avgPrice || 0), 0)
        out.push({ level: 'attention', title: 'Сорванные брони за 30 дней', text: `${b.unbooked30.length}: кв. ${b.unbooked30.map((x) => x.n).join(', ')} — причина отказа нигде не записана`, amount: money || null, kind: 'fact', note: 'сделки, которые были близко', section: 'sales' })
      }
      const worst = Object.entries(b.byRooms).filter(([, v]) => v.total >= 5).sort((p, q) => q[1].free / q[1].total - p[1].free / p[1].total)[0]
      if (worst && worst[1].free / worst[1].total >= 0.8) {
        const free = b.flats.filter((x) => `${x.r}-комн.` === worst[0] && x.st === 'Свободна')
        const money = free.reduce((t, x) => t + (x.price || avgPrice || 0), 0)
        out.push({ level: 'attention', title: `${worst[0]} почти не продаются`, text: `свободно ${worst[1].free} из ${worst[1].total} (${Math.round((worst[1].free / worst[1].total) * 100)}%)`, amount: money || null, kind: 'fact', note: 'деньги «заморожены» в остатке', section: 'revenue' })
      }
      if (b.priced < b.total) out.push({ level: 'attention', title: 'Нет цен в шахматке', text: `у ${b.total - b.priced} из ${b.total} квартир — потери и выручку по ним не посчитать`, amount: null, kind: 'fact', section: 'revenue' })
    }
    if (a) {
      const off = a.rows.filter((r) => r.verdict === 'off')
      if (off.length) out.push({ level: 'critical', title: 'Реклама без отдачи', text: off.map((r) => `«${r.name}»`).join(', '), amount: off.reduce((t, r) => t + r.spend, 0), currency: a.currency, kind: 'fact', note: 'за 7 дней', section: 'marketing' })
      if (a.prev.cpq && a.cur.cpq > a.prev.cpq * 1.2) out.push({ level: 'attention', title: 'Живой разговор подорожал', text: `цена ${a.prev.cpq} → ${a.cur.cpq} ${a.currency}`, amount: (a.cur.cpq - a.prev.cpq) * (a.cur.chatDeep ?? a.cur.deep), currency: a.currency, kind: 'fact', note: 'за 7 дней к прошлой неделе', section: 'marketing' })
    }
    // what only a CRM can show: real numbers once it is connected (CRM numbers, no names), a placeholder before
    const c = d.crm
    if (c) {
      const w = c.pulse?.waiting || []
      if (w.length) out.push({ level: 'critical', title: 'Лиды без ответа', text: `${w.length} ждут первого ответа дольше 2 рабочих часов (в CRM: ${w.slice(0, 5).map((x) => `№${x.id}`).join(', ')})`, amount: null, kind: 'fact', section: 'sales' })
      if (c.cur?.overdue) out.push({ level: 'attention', title: 'Просроченные действия менеджера', text: `${c.cur.overdue} за 28 дней${c.cur.overdueIds?.length ? ` (в CRM: ${c.cur.overdueIds.slice(0, 5).map((x) => `№${x}`).join(', ')})` : ''}`, amount: null, kind: 'fact', section: 'sales' })
      const why = (c.cur?.refusals || []).filter(([k]) => k !== 'не указано').slice(0, 3)
      if (why.length) out.push({ level: 'attention', title: 'Частые причины отказов', text: why.map(([k, v]) => `${k} — ${v}`).join(', '), amount: null, kind: 'fact', note: 'за 28 дней, по CRM', section: 'sales' })
    } else for (const t of ['Лиды без ответа', 'Просроченные действия менеджера', 'Частые причины отказов']) out.push({ level: 'empty', title: t, text: 'появится после подключения CRM', amount: null, kind: 'empty' })
    return out
  }

  wins(d) {
    const wins = []
    const a = d.ads, b = d.board, i = d.insta
    const win = (ok, title, value, delta, section, from) => { if (ok) wins.push({ title, value, delta, section, from }) }
    if (a) {
      win(a.cur.results > a.prev.results, 'Больше переписок', a.cur.results, pct(a.cur.results, a.prev.results), 'marketing', 'marketing')
      win(a.cur.cpr && a.prev.cpr && a.cur.cpr < a.prev.cpr, 'Переписка дешевле', `${a.cur.cpr} ${a.currency}`, pct(a.cur.cpr, a.prev.cpr), 'marketing', 'marketing')
    }
    if (b) {
      const [w1, w0] = b.weeks.slice(-2)
      win(w0.sales > 0 && w0.sales >= w1.sales, 'Продажи за неделю', w0.sales, pct(w0.sales, w1.sales), 'sales', 'sales')
      win(w0.bookings > w1.bookings, 'Больше броней', w0.bookings, pct(w0.bookings, w1.bookings), 'sales', 'sales')
    }
    if (i) {
      win(i.cur.reach > i.prev.reach, 'Охват Instagram вырос', i.cur.reach, pct(i.cur.reach, i.prev.reach), 'smm', 'smm')
      win(i.cur.follows > i.prev.follows, 'Подписчиков прибавилось больше', `+${i.cur.follows}`, pct(i.cur.follows, i.prev.follows), 'smm', 'smm')
    }
    return wins.slice(0, 3)
  }

  // ---------- the Plan page: goal, problems, opportunities, decisions ----------

  plan(d, judged) {
    const st = this.initiative.state
    const since = Date.now() - 30 * 864e5
    const status = (p) => {
      if (p.status === 'new') return 'proposed'
      if (p.status === 'declined') return 'declined'
      if (p.result) return 'measured'
      const tasks = this.initiative.tasksOf(p)
      if (tasks.some((t) => t.status === 'running')) return 'in_work'
      if (this.initiative.doneAt(p)) return 'done'
      return tasks.length || p.task || p.tasks ? 'approved' : 'done'
    }
    const items = st.proposals.filter((p) => Date.parse(p.createdAt) > since && !['week-goal', 'week-plan', 'month-goals'].includes(p.kind)).reverse().map((p) => ({
      id: p.id, title: p.title, why: p.text, source: p.source || { alert: 'Сторож рекламы', watch: 'Сторож направления', weekly: 'Планёрка Диаса' }[p.kind] || 'Офис', area: p.area || AREAS[p.task?.employee || p.from] || 'Другое', from: p.from,
      responsible: p.task?.employee || p.tasks?.[0]?.employee || p.from, due: p.due || null, status: status(p),
      expected: p.expected || (p.metric ? `${METRICS[p.metric].label}: ${METRICS[p.metric].dir === 'up' ? 'вырасти' : 'снизиться'}` : ''),
      metric: p.metric ? METRICS[p.metric].label : null, base: p.base ?? null, result: p.result || null,
      decidedAt: p.decidedAt || null, doneAt: this.initiative.doneAt(p),
    }))
    const g = st.weekGoal && st.weekGoal.week === isoWeekNow() ? st.weekGoal : null
    const pending = st.proposals.filter((p) => p.kind === 'week-goal' && p.status === 'new').at(-1)
    const weekPlan = st.proposals.filter((p) => p.kind === 'week-plan' && p.status === 'new').at(-1)
    const goalsProposal = st.proposals.filter((p) => p.kind === 'month-goals' && p.status === 'new').at(-1)
    return {
      goal: g, goalProposal: pending ? { id: pending.id, ...pending.goal } : null, fact: d.board?.thisWeek || null,
      weekPlan: weekPlan ? { id: weekPlan.id, summary: weekPlan.text, items: weekPlan.items, title: weekPlan.title } : null,
      goalsProposal: goalsProposal ? { id: goalsProposal.id, ...goalsProposal.goals } : null,
      problems: judged.signals.filter((x) => x.level === 'critical' || x.level === 'attention'),
      chances: judged.signals.filter((x) => x.level === 'opportunity' || x.level === 'positive'),
      items,
    }
  }

  // what each role may see: management sees everything, a sales manager only sales
  forRole(d, role) {
    if (role !== 'sales') return d
    const mine = (x) => ['sales'].includes(x.from) || x.section === 'sales'
    return {
      at: d.at, notes: [], board: d.board, ads: null, insta: null, krisha: [], smm: null,
      reports: d.reports.filter((r) => r.employee === 'sales'),
      proposals: [], team: d.team, first: d.first.filter(mine).map((x) => ({ ...x, proposal: undefined })), wins: d.wins.filter(mine), advice: [],
      losses: [], weekGoal: null, goals: null, memory: [], home: null, archive: null,
      top: d.top ? { ...d.top, kpis: d.top.kpis.filter((k) => k.key === 'sales'), text: '' } : null,
      crm: d.crm,
      signals: d.signals.filter(mine).map((x) => ({ ...x, proposal: undefined, action: undefined })), todo: [], kpi: d.kpi.filter((k) => ['sales'].includes(k.key)), change: null, plan: null, metrics: {},
    }
  }
}

function isoWeekNow() {
  const d = new Date(Date.now() + 5 * 3600e3)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return `${t.getUTCFullYear()}-W${Math.ceil(((t - y) / 864e5 + 1) / 7)}`
}

function section(from) {
  return { marketing: 'marketing', sales: 'sales', revenue: 'revenue', smm: 'smm', montazh: 'smm' }[from] || 'overview'
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}
