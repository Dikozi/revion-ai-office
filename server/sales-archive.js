// Ерлан's and Нурлан's long memory of sales. Plain code, no Claude.
// The chessboard keeps a log of status changes (since 11.08.2026) but not of prices, so every night the office
// also saves its own snapshot: prices, statuses and stock. From both it writes _данные/история-продаж.md:
// months, the path of a booking (how many end in a sale, in how many days), sales by rooms, stock and price changes.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { SOLD, readLog, isSale, isCancel, isBooking, isUnbook, kzDay } from './sales-rules.js'

const DIR = path.join(P.data, 'sales')
const FILE = path.join(DIR, 'archive.json')
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const ru = (date) => (date ? date.split('-').reverse().join('.') : '')
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const mln = (v) => `${(v / 1e6).toFixed(1).replace('.', ',')} млн`

export class SalesArchive {
  constructor({ portal }) {
    this.portal = portal
    this.busy = null
  }

  start() {
    const due = () => {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
      const a = read(FILE, null)
      if ((!a || (a.day !== ymd(new Date()) && h >= 4)) && !this.busy) this.busy = this.snapshot().catch((e) => console.error('Архив продаж:', e.message)).finally(() => { this.busy = null })
    }
    setTimeout(due, 2 * 60 * 1000).unref?.()
    setInterval(due, 30 * 60 * 1000).unref?.()
  }

  async snapshot() {
    if (!this.portal?.status().configured) return
    const a = await this.portal.get('/api/analytics/apartments')
    const s = read(FILE, { prices: {}, statuses: {}, stock: {} })
    const today = ymd(new Date())
    const stock = {}
    for (const x of a.apartments) {
      const n = String(x.number)
      const pl = (s.prices[n] ||= [])
      if (x.price_kzt && pl.at(-1)?.[1] !== x.price_kzt) pl.push([today, x.price_kzt])
      const sl = (s.statuses[n] ||= [])
      if (sl.at(-1)?.[1] !== x.status) sl.push([today, x.status])
      stock[x.status] = (stock[x.status] || 0) + 1
    }
    s.stock[today] = stock
    s.day = today
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(s))
    fs.renameSync(`${FILE}.tmp`, FILE)
  }

  async writeFor(dir) {
    const a = await this.portal.get('/api/analytics/apartments')
    const h = await this.portal.get('/api/analytics/status-history')
    const s = read(FILE, { prices: {}, statuses: {}, stock: {} })
    const flat = new Map(a.apartments.map((x) => [x.number, x]))
    // one sales rule with the portal (sales-rules.js): Almaty days, client moves are neither sales nor cancellations
    const changes = readLog(h.changes)

    // months of the log
    const months = {}
    for (const c of changes) {
      const m = (months[c.day.slice(0, 7)] ||= { bookings: 0, dropped: 0, sales: 0, cancels: 0, sum: 0, ppm: [] })
      if (isBooking(c)) m.bookings++
      if (isUnbook(c)) m.dropped++
      if (isSale(c)) { m.sales++; const f = flat.get(c.number); m.sum += f?.price_kzt || 0; if (f?.price_per_m2_kzt) m.ppm.push(f.price_per_m2_kzt) }
      // a cancelled pre-log sale: its sale is in no month, so it is not taken away (sales-rules.js)
      if (isCancel(c) && !c.preLog) { m.cancels++; m.sum -= flat.get(c.number)?.price_kzt || 0 }
    }
    // the path of every booking: a sale, a cancellation, or still waiting
    const paths = []
    for (const [i, c] of changes.entries()) {
      if (!isBooking(c)) continue
      // a booking moved with its client to another flat is followed there
      let n = c.number, at = i, next = null
      for (let hop = 0; hop < 5; hop++) {
        next = changes.slice(at + 1).find((x) => x.number === n) || null
        if (next?.move !== 'out') break
        const into = changes.find((x) => x.move === 'in' && x.number === next.movedTo && x.movedFrom === n)
        n = next.movedTo; at = changes.indexOf(into); next = null
      }
      paths.push({ n: c.number, from: c.day, end: next ? (SOLD.includes(next.to) ? 'sale' : next.to === 'Свободна' ? 'dropped' : 'other') : 'open', days: next ? days(c.day, next.day) : days(c.day, ymd(new Date())) })
    }
    const by = (k) => paths.filter((p) => p.end === k)
    const sold = changes.filter(isSale)
    const rooms = (list) => Object.entries(list.reduce((o, c) => { const r = flat.get(c.number)?.rooms ?? '?'; o[r] = (o[r] || 0) + 1; return o }, {})).sort().map(([r, n]) => `${r}-комн.: ${n}`).join(', ') || '—'
    const since90 = ymd(new Date(Date.now() - 90 * 864e5))
    const stockDays = Object.keys(s.stock).sort().slice(-30)
    const priceMoves = Object.entries(s.prices).filter(([, pl]) => pl.length > 1).flatMap(([n, pl]) => pl.slice(1).map((p, i) => `- ${ru(p[0])} кв. ${n}: ${mln(pl[i][1])} → ${mln(p[1])} ₸`))
    const text = [
      `# История продаж — журнал шахматки с ${ru(kzDay(h.history_since))}${stockDays.length ? `, ночные снимки офиса с ${ru(stockDays[0])}` : ''}`,
      'Продажа = переход в «Продана» или «Рассрочка» из другого статуса; «продаж» — за вычетом отмен в этом месяце (отмена продажи, сделанной до начала журнала, не вычитается: сама продажа ни в один месяц не попала); перенос клиента в другую квартиру — не продажа и не снятая бронь. Дни — по времени Астаны. Цена м² — по текущим ценам шахматки (цены в момент продажи журнал не хранит; с ночных снимков офиса изменения цен видны ниже).',
      '', '## По месяцам', '| месяц | новых броней | снято броней | продаж (отмен) | сумма договоров | средняя цена м² проданных |', '|---|---|---|---|---|---|',
      ...Object.entries(months).sort().reverse().map(([m, x]) => `| ${m} | ${x.bookings} | ${x.dropped} | ${x.sales - x.cancels}${x.cancels ? ` (${x.cancels})` : ''} | ${x.sum ? `${mln(x.sum)} ₸` : '—'} | ${x.ppm.length ? `${Math.round(x.ppm.reduce((t, v) => t + v, 0) / x.ppm.length).toLocaleString('ru-RU')} ₸` : '—'} |`),
      '', '## Путь брони',
      `Броней в журнале: ${paths.length}. Дошли до продажи: ${by('sale').length}${by('sale').length ? ` (медиана ${median(by('sale').map((p) => p.days))} дн., от ${Math.min(...by('sale').map((p) => p.days))} до ${Math.max(...by('sale').map((p) => p.days))})` : ''}. Сняты: ${by('dropped').length}${by('dropped').length ? ` (медиана ${median(by('dropped').map((p) => p.days))} дн.)` : ''}. Другое (например, «Не продаётся»): ${by('other').length}. Ещё висят: ${by('open').length}${by('open').length ? ` (${by('open').map((p) => `кв. ${p.n} — ${p.days} дн.`).join(', ')})` : ''}.`,
      '', '## Продажи по комнатности', `За всё время журнала: ${rooms(sold)}.`, `За 90 дней: ${rooms(sold.filter((c) => c.day >= since90))}.`,
      ...(stockDays.length ? ['', '## Остатки по дням (снимки офиса)', '| день | свободно | бронь | рассрочка | продана | не продаётся |', '|---|---|---|---|---|---|', ...stockDays.map((d) => { const x = s.stock[d]; return `| ${ru(d).slice(0, 5)} | ${x['Свободна'] || 0} | ${x['Бронь'] || 0} | ${x['Рассрочка'] || 0} | ${x['Продана'] || 0} | ${x['Не продаётся'] || 0} |` })] : []),
      '', '## Изменения цен (снимки офиса)', ...(priceMoves.length ? priceMoves.slice(-30) : ['- пока не было']),
    ].join('\n')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'история-продаж.md'), `${text}\n`, 'utf8')
  }
}
