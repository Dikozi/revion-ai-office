// One sales rule for every screen and report (wave 1 of the analytics audit, 19.11.2026).
// - A day is an Asia/Almaty day (UTC+5, no DST): the chessboard log sends UTC timestamps.
// - A sale = a flat entering «Продана»/«Рассрочка» from another status; «Рассрочка» → «Продана» is the same deal.
// - A cancellation = leaving them for another status; sales in a period are net of cancellations.
// - A client moved to another flat (sales-portal move-actions: the new flat takes the deal status, the old one
//   becomes «Свободна» seconds later) is neither a new sale/booking nor a cancellation.
// - The sale date of a flat = the day its current deal entered the sold statuses (a move keeps the old date;
//   a move from a flat sold before the log leaves the date unknown: null).
// - A cancellation of a deal whose sale is not in the log (sold before it, incl. a later «Рассрочка» ↔ «Продана»
//   or a client moved in from such a flat) is not taken from sales: its +1 is in no period either (`preLog`);
//   stock counts still see it.
// - The base price per m²: config `basePpm`, 350 000 ₸ by default. Cheaper sales are listed, never alarmed.
export const SOLD = ['Продана', 'Рассрочка']
export const DEAL = ['Бронь', 'Рассрочка', 'Продана']
// a move is one server action (claim, then release, seconds apart): a pair only when it is the single one within a minute
const MOVE_GAP = 60e3

export const basePpm = (cfg) => Number(cfg?.basePpm) > 0 ? Number(cfg.basePpm) : 350000

// a full timestamp → its Almaty day; a bare date (no time) is taken as it is
export function kzDay(iso) {
  if (!iso) return null
  const s = String(iso)
  if (!s.includes('T')) return s.slice(0, 10)
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t + 5 * 3600e3).toISOString().slice(0, 10) : s.slice(0, 10)
}

// «YYYY-MM-DD HH:MM» in Almaty time
export function kzStamp(iso) {
  const s = String(iso || '')
  const t = s.includes('T') ? Date.parse(s) : NaN
  return Number.isFinite(t) ? new Date(t + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : s.slice(0, 16).replace('T', ' ')
}

// The status log as the office reads it: sorted by time, with the Almaty `day` and client moves marked
// (`move: 'in'` on the new flat, `move: 'out'` on the released one). Moves need real timestamps.
export function readLog(changes) {
  const list = [...(changes || [])].filter((c) => c && c.changed_at).sort((x, y) => String(x.changed_at).localeCompare(String(y.changed_at))).map((c) => ({ ...c, day: kzDay(c.changed_at) }))
  const timed = (c) => String(c.changed_at).includes('T')
  const near = (c, t) => timed(c) && Math.abs(Date.parse(c.changed_at) - t) <= MOVE_GAP
  const isOut = (c) => DEAL.includes(c.from) && c.to === 'Свободна' && timed(c)
  for (const out of list) {
    if (!isOut(out) || out.move) continue
    const t = Date.parse(out.changed_at)
    const ins = list.filter((c) => !c.move && c.number !== out.number && c.to === out.from && !DEAL.includes(c.from) && near(c, t))
    if (ins.length !== 1) continue
    const into = ins[0]
    // another flat released with the same status around the new one: which client moved is unknown — no move
    const outs = list.filter((c) => !c.move && c.number !== into.number && isOut(c) && c.from === out.from && near(c, Date.parse(into.changed_at)))
    if (outs.length !== 1) continue
    out.move = 'out'; out.movedTo = into.number; into.move = 'in'; into.movedFrom = out.number
  }
  // where each flat's current deal came from: 'log' = its sale is in the log; anything else = before the log
  const deal = new Map(), carried = new Map()
  for (const c of list) {
    if (c.move === 'out') { carried.set(c.movedTo, deal.get(c.number)); deal.set(c.number, null); continue }
    if (c.move === 'in') {
      const src = carried.has(c.number) ? carried.get(c.number) : deal.get(c.movedFrom)
      carried.delete(c.number)
      deal.set(c.number, src === 'log' ? 'log' : 'pre')
      continue
    }
    if (isSale(c)) deal.set(c.number, 'log')
    else if (isCancel(c)) {
      if (deal.get(c.number) !== 'log') c.preLog = true
      deal.set(c.number, null)
    }
  }
  return list
}

export const isSale = (c) => SOLD.includes(c.to) && !SOLD.includes(c.from) && c.move !== 'in'
export const isCancel = (c) => SOLD.includes(c.from) && !SOLD.includes(c.to) && c.move !== 'out'
export const isBooking = (c) => c.to === 'Бронь' && c.from !== 'Бронь' && c.move !== 'in'
export const isUnbook = (c) => c.from === 'Бронь' && c.to === 'Свободна' && c.move !== 'out'

// number → day the current deal entered the sold statuses; null = sold, day unknown (moved from a pre-log sale)
export function soldDays(log) {
  const out = new Map()
  for (const c of log) {
    if (!SOLD.includes(c.to) || SOLD.includes(c.from)) continue
    out.set(c.number, c.move === 'in' ? out.get(c.movedFrom) ?? null : c.day)
  }
  return out
}

// Sales in the days (from, to]: `deals` = sales of the period not cancelled inside it, `cancels` = cancellations
// of earlier sales made inside the log; net = deals − cancels. Also new bookings and bookings taken off (moves excluded).
export function salesIn(log, from, to) {
  const deals = [], cancels = []
  let bookings = 0, unbooked = 0
  for (const c of log) {
    if (c.day <= from || c.day > to) continue
    if (isSale(c)) deals.push(c)
    else if (isCancel(c)) {
      const i = deals.findLastIndex((x) => x.number === c.number)
      if (i >= 0) deals.splice(i, 1)
      else if (!c.preLog) cancels.push(c)
    }
    if (isBooking(c)) bookings++
    if (isUnbook(c)) unbooked++
  }
  return { deals, cancels, net: deals.length - cancels.length, bookings, unbooked }
}
