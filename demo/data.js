// Made-up data of a residential developer for the REVION demo: «Altyn Qala Group», ЖК «Altyn Qala», 2 очередь.
// The company, the building, every flat, client, manager and number here are invented — nothing comes from a real
// company or person. The data keeps the shape the production portal gets from the office, so every page renders as
// it does for the real business. The story: the lead form brings cheap leads and no bookings, Reels sells flats,
// two bookings are stuck and two installment payments are late.

const DAY = 864e5
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const ago = (n) => ymd(new Date(Date.now() - n * DAY))
const stamp = (n, h = 12, m = 0) => `${ago(n)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
const COMPLEX = 'ЖК «Altyn Qala», 2 очередь'

// deterministic «random», so the demo looks the same on every start
let seed = 20261119
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

// ---------- the building: 2 entrances, floors 2–12, 4 flats per floor ----------

const PLAN = [{ r: 1, m2: 38.4 }, { r: 2, m2: 56.7 }, { r: 3, m2: 82.3 }, { r: 2, m2: 61.9 }]
const BASE_PPM = 430000

function building() {
  const flats = []
  let n = 0
  for (const e of [1, 2]) {
    for (let f = 2; f <= 12; f++) {
      PLAN.forEach((p, i) => {
        n++
        const m2 = Math.round((p.m2 + (e === 2 ? 0.6 : 0) + (i === 3 && f > 8 ? 1.2 : 0)) * 10) / 10
        const ppm = BASE_PPM + (f - 2) * 4500 + (p.r === 1 ? 15000 : 0)
        flats.push({ n, e, f, r: p.r, m2, ppm, price: Math.round((m2 * ppm) / 1000) * 1000, st: 'Свободна', since: null })
      })
    }
  }
  return flats
}

// Every sale: [flat, days ago it was sold, «Продана» = paid in full / «Рассрочка» = 30% now and 12 monthly payments]
function history(flats) {
  const sold = []
  const order = flats.filter((x) => x.f <= 10).sort((a, b) => a.f - b.f || a.n - b.n)
  // denser in recent weeks: 46 sales over ~7 months, 9 of them in the last 4 weeks
  const offsets = [2, 4, 6, 9, 12, 15, 19, 23, 26, 31, 34, 38, 41, 45, 49, 54, 58, 61, 66, 71, 76, 80, 85, 91, 97, 103, 108, 114, 120, 126, 133, 139, 146, 152, 158, 164, 170, 176, 182, 188, 193, 197, 201, 204, 207, 209]
  const used = new Set()
  offsets.forEach((d, i) => {
    let k = (i * 7) % order.length
    while (used.has(k)) k = (k + 1) % order.length
    used.add(k)
    sold.push({ flat: order[k], days: d, kind: i % 3 === 1 ? 'Рассрочка' : 'Продана', bookedDays: d + 6 + Math.floor(rnd() * 10) })
  })
  return sold
}

function demoBoard() {
  const flats = building()
  const sales = history(flats)
  const now = Date.now()
  for (const s of sales) Object.assign(s.flat, { st: s.kind, since: ago(s.days), soldAt: ago(s.days) })
  // two flats held back by the company
  for (const x of flats.filter((f) => f.f === 12 && f.r === 3)) { x.st = 'Не продаётся'; x.since = ago(200) }
  // current bookings: two of them stuck for more than a week
  const free = () => flats.filter((x) => x.st === 'Свободна')
  const bookings = [[12, 'stale'], [10, 'stale'], [4], [2], [1]].map(([d]) => { const x = free()[Math.floor(rnd() * free().length)]; x.st = 'Бронь'; x.since = ago(d); x.bookedDays = d; return x })

  // ---- money events: bookings, first payments, installments, full payments ----
  const ev = []
  const BOOKING = 500000
  for (const s of sales) {
    const p = s.flat.price
    ev.push({ n: s.flat.n, kind: 'booking', amount: BOOKING, day: ago(s.bookedDays) })
    if (s.kind === 'Продана') ev.push({ n: s.flat.n, kind: 'full', amount: p - BOOKING, day: ago(s.days) })
    else {
      const first = Math.round(p * 0.3) - BOOKING
      ev.push({ n: s.flat.n, kind: 'first', amount: first, day: ago(s.days) })
      const rest = p - BOOKING - first, monthly = Math.round(rest / 12)
      for (let k = 1; k <= 12; k++) ev.push({ n: s.flat.n, kind: 'installment', amount: k === 12 ? rest - monthly * 11 : monthly, day: ago(s.days - k * 30), planned: true })
    }
  }
  for (const x of bookings) ev.push({ n: x.n, kind: 'booking', amount: BOOKING, day: x.since })
  // two installment payments are late: due, not paid
  const late = sales.filter((s) => s.kind === 'Рассрочка' && s.days > 60).slice(0, 2)
  const lateDue = new Set(late.map((s) => ev.find((e) => e.n === s.flat.n && e.kind === 'installment' && e.day <= ago(3) && e.day >= ago(40))).filter(Boolean))
  const today = ago(0)
  const paid = ev.filter((e) => e.day <= today && !lateDue.has(e))
  const received = (from, to) => {
    const s = { revenue: 0, booking: 0, first: 0, installment: 0, full: 0 }
    for (const e of paid) if (e.day > from && e.day <= to) { s[e.kind] += e.amount; s.revenue += e.amount }
    return s
  }
  const planned = (from, to) => ev.filter((e) => e.planned && e.day > from && e.day <= to).reduce((t, e) => t + e.amount, 0)

  // ---- sales by period ----
  const span = (fromDays, toDays) => {
    const from = ago(fromDays), to = ago(toDays)
    const deals = sales.filter((s) => s.flat.soldAt > from && s.flat.soldAt <= to)
    const booked = ev.filter((e) => e.kind === 'booking' && e.day > from && e.day <= to).length
    const cash = received(from, to)
    const contract = deals.reduce((t, s) => t + s.flat.price, 0)
    return {
      from, to, partial: false, sales: deals.length, revenue: cash.revenue, contract, noPrice: 0, cash,
      bookings: booked, unbooked: fromDays >= 28 && toDays === 0 ? 1 : 0, cancelled: 0,
      deals: deals.map((s) => ({ n: s.flat.n, r: s.flat.r, m2: s.flat.m2, price: s.flat.price, ppm: s.flat.ppm, st: s.kind, at: s.flat.soldAt })),
    }
  }
  const weeks = []
  for (let w = 7; w >= 0; w--) weeks.push(span((w + 1) * 7, w * 7))
  const hist = []
  for (let w = 12; w >= 0; w--) hist.push(span((w + 1) * 7, w * 7))
  const periods = {}
  for (const [k, d] of Object.entries({ week: 7, month: 28, quarter: 91 })) periods[k] = { days: d, cur: span(d, 0), prev: span(d * 2, d) }

  const status = flats.reduce((o, x) => ((o[x.st] = (o[x.st] || 0) + 1), o), {})
  const SOLD = ['Продана', 'Рассрочка']
  const soldFlats = flats.filter((x) => SOLD.includes(x.st))
  const freeFlats = flats.filter((x) => x.st === 'Свободна')
  const left = flats.filter((x) => x.st === 'Свободна' || x.st === 'Бронь')
  const stale = flats.filter((x) => x.st === 'Бронь').map((x) => ({ ...x, days: Math.floor((now - Date.parse(x.since)) / DAY) })).filter((x) => x.days >= 7).sort((a, b) => b.days - a.days)
  const pace = weeks.slice(-4).reduce((t, w) => t + w.sales, 0) / 4
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
  const avg = (list) => Math.round(list.reduce((t, x) => t + x.ppm, 0) / (list.length || 1))
  const changes = [
    ...sales.map((s) => ({ n: s.flat.n, from: 'Бронь', to: s.kind, t: Date.parse(s.flat.soldAt) + 15 * 3600e3 })),
    ...sales.map((s) => ({ n: s.flat.n, from: 'Свободна', to: 'Бронь', t: Date.parse(ago(s.bookedDays)) + 11 * 3600e3 })),
    ...bookings.map((x) => ({ n: x.n, from: 'Свободна', to: 'Бронь', t: Date.parse(x.since) + 16 * 3600e3 })),
  ].sort((a, b) => b.t - a.t).slice(0, 30).map((c) => ({ n: c.n, from: c.from, to: c.to, at: new Date(c.t).toISOString().slice(0, 16).replace('T', ' ') }))
  const lastDay = (i) => { const t = new Date(now + 5 * 3600e3); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + i + 1, 0)).toISOString().slice(0, 10) }
  const lateList = [...lateDue].map((e) => ({ n: e.n, amount: e.amount, since: e.day }))
  const thisWeekFrom = (() => { const t = new Date(now + 5 * 3600e3); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10) })()
  const monthFrom = today.slice(0, 8) + '01'
  const inRange = (from) => { const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(from)) / DAY) + 1); return span(days, 0) }

  return {
    complex: COMPLEX, total: flats.length, status, weeks, stale, flats: flats.map(({ soldAt, bookedDays, ...x }) => x), since: ago(210),
    thisWeek: { ...inRange(thisWeekFrom), from: thisWeekFrom }, thisMonth: { ...inRange(monthFrom), from: monthFrom, threeRooms: 1 },
    periods, history: hist,
    unbooked30: [{ n: freeFlats[3].n, at: ago(17), price: freeFlats[3].price, r: freeFlats[3].r }],
    changes, priced: flats.length,
    revenue: {
      known: soldFlats.reduce((t, x) => t + x.price, 0), soldPriced: soldFlats.length, sold: soldFlats.length,
      avgPpmSold: avg(soldFlats), avgPpmFree: avg(freeFlats), basePpm: BASE_PPM, lowSales: [],
      pace: Math.round(pace * 10) / 10, forecastWeeks: pace > 0 ? Math.ceil(freeFlats.length / pace) : null,
      freeM2: Math.round(freeFlats.reduce((t, x) => t + x.m2, 0)),
    },
    byRooms: group((x) => `${x.r}-комн.`),
    revenueByRooms: Object.values(soldFlats.reduce((o, x) => { const k = `${x.r}-комн.`; o[k] ??= { key: k, revenue: 0, count: 0, m2: 0 }; o[k].revenue += x.price; o[k].count++; o[k].m2 += x.m2; return o }, {})).sort((a, b) => b.revenue - a.revenue),
    potential: freeFlats.reduce((t, x) => t + x.price, 0),
    byFloors: group((x) => `${band(x.f)} этаж`),
    toSell: { left: left.length, booked: bookings.length, sold: soldFlats.length, sellable: soldFlats.length + left.length, net: weeks.slice(-13).reduce((t, w) => t + w.sales, 0), days: 91, leftPriced: left.length, leftValue: left.reduce((t, x) => t + x.price, 0) },
    cash: {
      received: received('0000-00-00', today).revenue, planned: planned(today, '9999-12-31'), next30: planned(today, ago(-30)), restOfMonth: planned(today, lastDay(0)),
      unfilled: [], overdue: lateList.reduce((t, x) => t + x.amount, 0), linked: true, payments: 'ok', unavailable: null, extra: [],
      nextMonths: [1, 2, 3].map((i) => ({ month: lastDay(i).slice(0, 7), planned: planned(lastDay(i - 1), lastDay(i)) })), overdueList: lateList, short: [],
    },
  }
}

// ---------- signals, ads, CRM, reports ----------

function signals(b) {
  const [s1, s2] = b.stale
  const late = b.cash.overdueList
  const mln = (v) => `${(v / 1e6).toFixed(1).replace('.', ',')} млн ₸`
  return [
    {
      key: 'demo-lead-form', level: 'critical', section: 'marketing', from: 'marketing',
      what: 'Лид-форма «Квартиры от 17 млн»: 42 заявки и 0 броней',
      why: 'За 4 недели на неё ушло 360 000 ₸. Заявки дешёвые — по 8 571 ₸, но ни одна не дошла до показа.',
      impact: { amount: 360000, text: '360 000 ₸ рекламы без единой брони' },
      cause: { kind: 'link', text: '7 из 10 клиентов из формы не берут трубку: форма собирает людей, которые нажали «отправить», не читая цену.' },
      action: { employee: 'marketing', title: 'Перевести бюджет лид-формы в Reels с переписками в WhatsApp', expected: '+1–2 брони в месяц при том же бюджете', days: 2 },
    },
    {
      key: 'demo-stale', level: 'attention', section: 'sales', from: 'sales',
      what: `Брони кв. ${s1.n} и ${s2.n} висят ${s1.days} и ${s2.days} дней`,
      why: 'Обычно от брони до договора проходит 8 дней. Клиенты внесли по 500 000 ₸ и перестали выходить на связь.',
      impact: { amount: s1.price + s2.price, text: `${mln(s1.price + s2.price)} в сделках под риском` },
      cause: { kind: 'probable', text: 'Вероятная причина: оба клиента ждут одобрения ипотеки — так записано в CRM после показа.' },
      action: { employee: 'sales', title: 'Позвонить обоим клиентам и предложить рассрочку на время ожидания банка', expected: 'перевести хотя бы одну бронь в договор', days: 2 },
    },
    {
      key: 'demo-late', level: 'attention', section: 'revenue', from: 'revenue',
      what: `Просрочка по рассрочке: кв. ${late.map((x) => x.n).join(' и ')}`,
      why: 'Плановые платежи не поступили. Чем дольше ждём, тем сложнее вернуть график.',
      impact: { amount: b.cash.overdue, text: `${mln(b.cash.overdue)} не получено в срок` },
      cause: { kind: 'fact', text: 'По графику в шахматке платёж был, отметки об оплате нет.' },
      action: { employee: 'revenue', title: 'Сначала проверить, внесена ли оплата в шахматку, затем — звонок менеджера', expected: 'вернуть платежи в график', days: 3 },
    },
    {
      key: 'demo-manager', level: 'attention', section: 'sales', from: 'sales',
      what: 'У менеджера Ольги броней в 3 раза меньше',
      why: '61 обращение → 1 бронь (2%). У Айгерим — 74 → 5 (7%).',
      impact: { text: 'при конверсии Айгерим было бы ещё ≈3 брони' },
      cause: { kind: 'probable', text: 'Вероятная причина: Ольга отвечает в среднем через 2 часа и не приглашает на показ в первом разговоре.' },
      action: { employee: 'sales', title: 'Разобрать 5 последних отказов Ольги и дать скрипт приглашения на показ', expected: 'конверсия Ольги до 5%', days: 3 },
    },
    {
      key: 'demo-reels', level: 'opportunity', section: 'revenue', from: 'revenue',
      what: 'Reels «Вид с 11 этажа» продал 3 квартиры — можно усилить',
      why: '210 000 ₸ → 23 переписки → 3 продажи на 67 млн ₸.',
      impact: { text: 'каждые 70 000 ₸ рекламы — одна квартира' },
      cause: { kind: 'fact', text: 'Клиенты из Reels доходят до показа вдвое чаще: 38% против 17%.' },
      action: { employee: 'marketing', title: 'Поднять бюджет Reels на 30% на 2 недели и сравнить цену брони', expected: '+1–2 продажи', days: 14 },
    },
    {
      key: 'demo-expensive', level: 'opportunity', section: 'sales', from: 'sales',
      what: '11 клиентов ушли из-за цены — предложить рассрочку',
      why: 'Каждый третий отказ — «дорого». Эти клиенты уже были на показе и выбрали планировку.',
      impact: { text: 'до 11 возможных сделок' },
      cause: { kind: 'fact', text: 'Причина отказа отмечена в CRM у каждого клиента.' },
      action: { employee: 'sales', title: 'Позвонить 11 клиентам с рассрочкой 0% на 12 месяцев', expected: '1–2 брони', days: 5 },
    },
  ]
}

const ROWS = [
  { id: 'd1', name: 'Лид-форма «Квартиры от 17 млн»', campaign: 'Лиды · Facebook и Instagram', kind: 'form', spend: 90000, results: 11, chats: 0, deep: 0, leads: 11, cpq: null, cpl: 8182, ctr: 1.8, freq: 1.7, verdict: 'off', sales: 0, revenue: 0 },
  { id: 'd2', name: 'Reels «Вид с 11 этажа»', campaign: 'Переписки WhatsApp · Instagram', kind: 'chat', spend: 52500, results: 6, chats: 6, deep: 4, leads: 0, cpq: 13125, cpl: null, ctr: 2.6, freq: 1.3, verdict: 'scale', sales: 1, revenue: 23400000 },
  { id: 'd3', name: 'Сторис «Ход строительства, ноябрь»', campaign: 'Переписки WhatsApp · Instagram', kind: 'chat', spend: 60000, results: 9, chats: 9, deep: 4, leads: 0, cpq: 15000, cpl: null, ctr: 1.5, freq: 2.0, verdict: 'keep', sales: 1, revenue: 25800000 },
  { id: 'd4', name: 'Пост «Рассрочка 0% на 12 месяцев»', campaign: 'Переписки WhatsApp · Facebook', kind: 'chat', spend: 57500, results: 7, chats: 7, deep: 3, leads: 0, cpq: 19167, cpl: null, ctr: 1.1, freq: 2.7, verdict: 'keep', sales: 0, revenue: 0 },
]

const REPORT = `# Отчёт недели ${ago(10).slice(8, 10)}.${ago(10).slice(5, 7)}–${ago(4).slice(8, 10)}.${ago(4).slice(5, 7)}

**Продали 2 квартиры, получили 31,4 млн ₸.** На рекламу ушло 260 000 ₸ — 130 000 ₸ на одну продажу.

## ✅ Что работает
- Reels «Вид с 11 этажа»: 6 переписок → 1 продажа (2-комн., 23,4 млн ₸).
- Айгерим приглашает на показ в первом разговоре — у неё лучшая конверсия: 7%.

## ⚠️ Где пробелы
- Лид-форма: 11 заявок и 0 броней — 90 000 ₸ ушли впустую.
- Две брони висят дольше 10 дней: клиенты ждут ипотеку.
- Два платежа по рассрочке не поступили в срок.

## 🔧 Что улучшить
- Перевести бюджет лид-формы в Reels.
- Предложить ждущим ипотеку рассрочку на время одобрения.
- Проверить оплаты в шахматке и позвонить по просрочке.

## 🎯 Главное на неделю
Перевести 90 000 ₸ из лид-формы в Reels и перевести хотя бы одну зависшую бронь в договор.`

const SHORT = {
  marketing: '📣 **Реклама за неделю:** 260 000 ₸ → 33 обращения, 22 живых разговора.\n\n- ✅ Reels «Вид с 11 этажа» — самая дешёвая бронь.\n- ⚠️ Лид-форма: 11 заявок, ни одной брони.\n- 🔧 Совет: бюджет формы — в Reels.',
  sales: '🤝 **Продажи за неделю:** 2 продажи, 3 брони.\n\n- ⚠️ 2 брони висят дольше 10 дней.\n- ⚠️ Ольга: конверсия 2%, ответ через 2 часа.\n- 🔧 Совет: приглашать на показ в первом разговоре.',
  revenue: '💰 **Деньги за неделю:** получено 31,4 млн ₸, по рассрочкам придёт ещё 18,6 млн ₸ за 30 дней.\n\n- ⚠️ Просрочка по 2 рассрочкам.\n- 🔧 11 клиентов ушли из-за цены — предложить рассрочку 0%.',
}

function losses(b) {
  return [
    { title: 'Долгие брони', level: 'attention', kind: 'fact', text: `${b.stale.length} брони дольше недели: кв. ${b.stale.map((x) => x.n).join(', ')}`, amount: b.stale.reduce((t, x) => t + x.price, 0), section: 'sales' },
    { title: 'Просрочка по рассрочке', level: 'attention', kind: 'fact', text: `${b.cash.overdueList.length} платежа не поступили в срок`, amount: b.cash.overdue, section: 'revenue' },
    { title: 'Реклама без броней', level: 'critical', kind: 'link', text: 'Лид-форма: 42 заявки за 4 недели, ни одного показа', amount: 360000, section: 'marketing' },
    { title: 'Ушли из-за цены', level: 'opportunity', kind: 'fact', text: '11 клиентов после показа — «дорого»', note: 'сумма не считается: это не потерянная выручка', section: 'sales' },
  ]
}

function change(b) {
  const c = b.periods.month.cur, p = b.periods.month.prev
  const avgC = c.contract / (c.sales || 1), avgP = p.contract / (p.sales || 1)
  return {
    period: '4 недели к предыдущим 4', revenue: c.revenue, prev: p.revenue, delta: p.revenue ? Math.round(((c.revenue - p.revenue) / p.revenue) * 100) : null,
    factors: [
      { label: 'Количество продаж', text: `${c.sales} против ${p.sales}`, amount: Math.round((c.sales - p.sales) * avgP) },
      { label: 'Средний чек', text: `${(avgC / 1e6).toFixed(1).replace('.', ',')} млн против ${(avgP / 1e6).toFixed(1).replace('.', ',')} млн`, amount: Math.round((avgC - avgP) * c.sales) },
    ],
    links: [
      { kind: 'link', sign: 1, label: 'Reels с переписками', text: 'с ним связаны 3 из последних продаж' },
      { kind: 'fact', sign: -1, label: 'Просрочка по рассрочке', text: `${(b.cash.overdue / 1e6).toFixed(1).replace('.', ',')} млн ₸ не пришло в срок` },
    ],
    missing: [],
  }
}

export function demoData() {
  seed = 20261119
  const now = new Date().toISOString()
  const board = demoBoard()
  const SIGNALS = signals(board)
  const month = board.periods.month
  const days = []
  for (let i = 13; i >= 0; i--) {
    const k = [0.8, 1.1, 0.9, 1.2, 1, 0.7, 1.3][i % 7]
    const chats = Math.round(3.1 * k), deep = Math.round(1.9 * k), leads = Math.round(1.6 * k)
    days.push({ date: ago(i), spend: Math.round(37000 * k), results: chats + leads, chats, deep, leads, clicks: Math.round(140 * k), impressions: Math.round(11000 * k), spendChat: Math.round(24000 * k), spendForm: Math.round(13000 * k) })
  }
  const week = (cur) => ({ spend: cur ? 260000 : 245000, results: cur ? 33 : 36, chats: cur ? 22 : 21, deep: cur ? 11 : 9, leads: cur ? 11 : 15, cpr: cur ? 7879 : 6806, ctr: cur ? 1.7 : 1.6, cpq: cur ? 11818 : 11667, cpl: cur ? 8182 : 6533, live: cur ? 34 : 29, impressions: 76000, clicks: 980 })
  const reports = [
    { id: 'demo-r1', employee: 'manager', name: 'Диас', title: 'Отчёт недели: что работает, где пробелы, что улучшить', at: new Date(Date.now() - 2 * DAY).toISOString(), type: 'director', area: 'Управление', result: REPORT, files: [], decision: null },
    ...Object.entries(SHORT).map(([employee, result], i) => ({ id: `demo-r${i + 2}`, employee, name: { marketing: 'Алия', sales: 'Ерлан', revenue: 'Нурлан' }[employee], title: { marketing: 'Реклама и Instagram за неделю', sales: 'Продажи за неделю', revenue: 'Деньги за неделю' }[employee], at: new Date(Date.now() - (2 * DAY + (i + 1) * 3600e3)).toISOString(), type: 'weekly', area: { marketing: 'Маркетинг', sales: 'Продажи', revenue: 'Выручка' }[employee], result, files: [], decision: null })),
  ]
  const trend = (key) => board.weeks.map((w) => w[key])
  return {
    at: now,
    top: {
      period: 'за 4 недели к предыдущим 4',
      kpis: [
        { key: 'revenue', label: 'Получено денег', value: month.cur.revenue, prev: month.prev.revenue, money: true, trend: trend('revenue') },
        { key: 'sales', label: 'Продано квартир', value: month.cur.sales, prev: month.prev.sales, trend: trend('sales') },
        { key: 'leads', label: 'Обращения', value: 214, prev: 236, trend: [61, 58, 63, 57, 55, 52, 54, 53] },
        { key: 'spend', label: 'Расход на рекламу', value: 1040000, prev: 990000, unit: '₸', neutral: true, trend: [240000, 250000, 245000, 255000, 250000, 265000, 260000, 265000] },
      ],
      text: 'Обращений стало на 9% меньше, а продаж — больше: Reels приводит меньше людей, но они доходят до показа.',
    },
    signals: SIGNALS,
    board,
    losses: losses(board),
    change: change(board),
    plan: { weekPlan: null, items: [], problems: [], chances: [] },
    ads: {
      currency: '₸', days, cur: week(true), prev: week(false),
      month: { cur: { spend: 1040000, results: 214 }, prev: { spend: 990000, results: 236 } },
      rows: ROWS, median: { chat: 13500, form: 8182 },
    },
    insta: {
      followers: 4870, cur: { reach: 26400, follows: 112, posts: 6, interactions: 1310 }, prev: { reach: 21800, follows: 87, posts: 5, interactions: 1040 }, follows: [],
      posts: [
        { date: ago(3), link: '#', caption: 'Вид с 11 этажа: закат над городом из 2-комнатной', type: 'Reels', image: null, likes: 344, comments: 41, reach: 9800, saved: 212, shares: 66 },
        { date: ago(5), link: '#', caption: 'Ход строительства: ноябрь — монолит 10 этажа', type: 'Фото', image: null, likes: 128, comments: 9, reach: 4100, saved: 37, shares: 12 },
        { date: ago(8), link: '#', caption: '5 вопросов, которые стоит задать застройщику до брони', type: 'Карусель', image: null, likes: 201, comments: 23, reach: 6300, saved: 175, shares: 48 },
        { date: ago(11), link: '#', caption: 'Рассрочка 0% на 12 месяцев: как это работает', type: 'Reels', image: null, likes: 263, comments: 57, reach: 7600, saved: 149, shares: 33 },
      ],
    },
    crm: {
      fresh: { stale: false },
      cur: {
        leads: 214,
        funnel: [
          { key: 'lead', label: 'Обращения', count: 214, conv: null },
          { key: 'contacted', label: 'Связались', count: 158, conv: 74 },
          { key: 'consult', label: 'Консультация', count: 96, conv: 61 },
          { key: 'show_done', label: 'Показ', count: 41, conv: 43 },
          { key: 'booking', label: 'Бронь', count: 12, conv: 29 },
          { key: 'sale', label: 'Сделка', count: month.cur.sales, conv: Math.round((month.cur.sales / 12) * 100) },
        ],
        refusals: [['Дорого', 11], ['Не отвечает', 9], ['Ипотека / банк не одобрил', 6], ['Срок сдачи', 4], ['Купил в другом месте', 3]],
        noNext: 17, noNextIds: [1042, 1047, 1051, 1056, 1063, 1068, 1071], overdue: 8, overdueIds: [998, 1004, 1011, 1019],
        replyMedianMin: 23, slowReplies: 14, reactivate: 11,
        lostAfter: [['Консультация', 18], ['Показ', 9], ['Связались', 6]],
        managers: [{ name: 'Айгерим', leads: 74, sales: 5, bookings: 5, replyMin: 12 }, { name: 'Данияр', leads: 79, sales: 4, bookings: 4, replyMin: 25 }, { name: 'Ольга', leads: 61, sales: 1, bookings: 1, replyMin: 118 }],
        lead_quality: { good: 45, note: 'Качественный лид — клиент ответил и обсуждал квартиру. Пустые чаще всего приходят из лид-формы.' },
        best: [
          { title: 'Клиенты из Reels доходят до показа вдвое чаще', note: '38% против 17% по остальной рекламе' },
          { title: 'Пригласили на показ в первом разговоре — броней втрое больше', note: 'конверсия 9% против 3%' },
          { title: 'Чаще всего покупают 2-комнатные на 6–10 этажах', note: '58% сделок за 3 месяца' },
        ],
      },
      prev: { leads: 236, funnel: [{ count: 236 }, { count: 166 }, { count: 97 }, { count: 38 }, { count: 10 }, { count: month.prev.sales }] },
    },
    money: {
      received: month.cur.revenue, prev: month.prev.revenue, fromAds: Math.round(month.cur.revenue * 0.8), spend: 1040000, sales: month.cur.sales, salesFromAds: Math.max(1, month.cur.sales - 2), expected30: board.cash.next30,
      channels: [
        { name: 'Reels', spend: 210000, sales: 3, revenue: 67200000 },
        { name: 'Сторис', spend: 240000, sales: 2, revenue: 48600000 },
        { name: 'Посты', spend: 230000, sales: 1, revenue: 25100000 },
        { name: 'Лид-форма', spend: 360000, sales: 0, revenue: 0 },
      ],
    },
    reports,
    archive: demoArchive(),
  }
}

// the page «Отчёты»: 14 made-up months of the developer (the current one still running) and 4 weekly reports
function demoArchive() {
  const now = new Date(Date.now() + 5 * 3600e3)
  const NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
  const sales = [4, 5, 3, 6, 5, 7, 6, 5, 8, 7, 9, 8, 10, 6]
  const months = sales.map((s, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13 + i, 1))
    const key = d.toISOString().slice(0, 7), last = i === 13
    return {
      key, label: `${NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`, partial: last, backfilled: i < 10, sales: s, money: s * 14200000 + (i % 3) * 3100000, extra: 0,
      leads: i < 4 ? null : Math.round(s * 24 + (i % 4) * 9), cpr: 9800 - i * 210 + (i % 3) * 160, currency: '₸', spendKzt: 820000 + i * 18000, followers: 3200 + i * 130, bookings: s + 3,
      complete: i < 4 ? ['CRM подключена позже — клиентов за этот месяц нет'] : last ? [`${NAMES[d.getUTCMonth()]} ещё идёт`] : [], revisions: i === 9 ? 1 : 0,
      report: last ? null : { taskId: `demo-m${i}`, files: ['отчёт-месяца.pdf', 'отчёт-месяца.xlsx'], phrase: '' },
    }
  })
  const weeks = [0, 1, 2, 3].map((k) => {
    const to = new Date(Date.now() - ((now.getUTCDay() + 6) % 7 + 1 + k * 7) * DAY), from = new Date(to.getTime() - 6 * DAY)
    return {
      monday: from.toISOString().slice(0, 10), from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), taskId: `demo-w${k}`, files: ['отчёт-недели.pdf'],
      phrase: ['Две продажи и три брони: Reels приводит покупателей, а лид-форма — нет.', 'Клиентов меньше, но они чаще приходят на показ: сработала рассрочка 0%.', 'Спокойная неделя: одна продажа, реклама подешевела.', 'Слабая неделя: два клиента ушли к конкурентам из-за срока сдачи.'][k],
      sales: [2, 3, 1, 1][k], money: [31400000, 38900000, 17600000, 15200000][k], leads: [53, 54, 52, 55][k], cpr: [7879, 8120, 8410, 8960][k], currency: '₸',
    }
  })
  return { months, weeks }
}

// Plan and SMM samples: not part of the public demo (its pages stay «главное»), only for checking
// the design of every page on the computer: node demo/server.js --all
export function previewExtra() {
  const d = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
  const task = (id, area, title, responsible, status, due, extra = {}) => ({ id, area, title, responsible, status, due: d(due), why: 'Из рекомендации на главной', source: 'сигнал «Критично»', expected: '', ...extra })
  const SIGNALS = signals(demoData().board)
  return {
    plan: {
      weekPlan: { id: 'demo-wp', title: 'План недели', summary: 'Главное на неделю: перевести бюджет лид-формы в Reels и довести зависшие брони до договора.', items: [
        { employee: 'marketing', title: 'Перевести бюджет лид-формы в Reels', days: 2, why: '360 000 ₸ без единой брони', expected: '+1–2 брони в месяц' },
        { employee: 'sales', title: 'Позвонить двум клиентам с долгими бронями', days: 2, why: 'брони висят дольше 10 дней', expected: '1 договор' },
        { employee: 'smm', title: 'Три Reels с видами из окон 9–11 этажей', days: 4, why: 'Reels продаёт лучше всего', expected: 'больше живых разговоров' },
        { employee: 'revenue', title: 'Проверить просрочку по рассрочке', days: 3, why: '2 платежа не поступили', expected: 'вернуть платежи в график' },
      ] },
      goal: { sales: 3, bookings: 4, why: 'Темп последних 4 недель — 2,3 продажи в неделю, в работе 5 броней.' },
      fact: { sales: 1, bookings: 2, from: d(-3) },
      items: [
        task('p1', 'Маркетинг', 'Перевести бюджет лид-формы в Reels', 'marketing', 'proposed', 2),
        task('p2', 'Продажи', 'Скрипт приглашения на показ', 'sales', 'approved', 3),
        task('p3', 'SMM', 'Три Reels с видами из окон', 'smm', 'in_work', 4),
        task('p4', 'Продажи', 'Разбор звонков Ольги', 'sales', 'in_work', 2),
        task('p5', 'Выручка', 'Рассрочка 0% для ушедших из-за цены', 'revenue', 'done', -1),
        task('p6', 'Маркетинг', 'Новая аудитория для сторис «ход строительства»', 'marketing', 'measured', -9, { result: { verdict: 'worked', base: 16400, value: 12900, note: 'Живой разговор подешевел на 21%.' }, metric: 'цена живого разговора' }),
      ],
      problems: SIGNALS.filter((s) => s.level === 'critical' || s.level === 'attention'),
      chances: SIGNALS.filter((s) => s.level === 'opportunity'),
    },
    memory: [
      { at: d(-20), decidedAt: d(-20), area: 'Маркетинг', problem: 'Сторис дорожали третью неделю', hypothesis: 'Аудитория устала от рендеров', decision: 'Сторис с реальной стройкой и датой', verdict: 'worked', result: 'живой разговор −21%' },
      { at: d(-34), decidedAt: d(-34), area: 'Продажи', problem: 'Клиенты пропадали после консультации', hypothesis: 'Не было приглашения на показ', decision: 'Приглашать на показ в первом разговоре', verdict: 'flat' },
    ],
    smm: {
      goal: 6000, until: '31 декабря', now: 4870, pace: 112, need: 160, weeks: 6, postsPerWeek: 3, reelsPerWeek: '2',
      plan: { week: '23–29 нояб.', status: 'accepted', items: [
        { date: d(4), day: 'пн', format: 'Пост', time: '19:04', topic: 'Планировка недели: 2-комн. 61,9 м²', by: 'Мадина' },
        { date: d(4), day: 'пн', format: 'Сторис', time: '12:00', topic: 'Ход строительства: монолит 11 этажа' },
        { date: d(5), day: 'вт', format: 'Рилс (маркетологи)', time: '19:00', topic: 'Вид с 11 этажа на закате' },
        { date: d(6), day: 'ср', format: 'Карусель', time: '19:06', topic: '5 вопросов застройщику до брони', by: 'Мадина' },
        { date: d(7), day: 'чт', format: 'Сторис', time: '12:07', topic: 'Отзыв семьи, купившей 3-комнатную' },
        { date: d(8), day: 'пт', format: 'Пост', time: '19:00', topic: 'Рассрочка 0% на 12 месяцев', by: 'Мадина' },
        { date: d(9), day: 'сб', format: 'Сторис', time: '12:06', topic: 'Шоурум открыт в выходные' },
      ] },
      pack: { week: '23–29 нояб.', status: 'waiting', proposal: 'demo-pack', items: [
        { date: d(0), time: '12:07', type: 'story', status: 'published', caption: 'Шоурум открыт в выходные', video: 'Close Up', result: 'охват 860, ответов 7, в профиль 12, вышли 31' },
        { date: d(4), time: '19:04', type: 'post', status: 'waiting', caption: 'Планировка недели' },
        { date: d(6), time: '19:06', type: 'carousel', status: 'waiting', caption: '5 вопросов застройщику' },
        { date: d(5), time: '19:00', type: 'reel', manual: true, status: 'waiting', caption: 'Вид с 11 этажа' },
      ] },
      stats: { posts: 31, base: 5200, formats: [{ name: 'Reels', posts: 11, reach: 8100 }, { name: 'Карусели', posts: 8, reach: 5700 }, { name: 'Фото', posts: 12, reach: 3600 }], topics: [{ name: 'Вид из окна', posts: 6, reach: 8800 }, { name: 'Ход строительства', posts: 9, reach: 4300 }, { name: 'Рассрочка', posts: 5, reach: 6200 }], objects: [{ name: '2-комнатные', posts: 10, reach: 6100 }, { name: '3-комнатные', posts: 7, reach: 5300 }] },
    },
  }
}
