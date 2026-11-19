// Money actually received per deal, read from the chessboard (/api/analytics/payments):
// booking, first payment, installment payments; "Продана" without any of them = full price on the sale date.
// Everything is entered in the chessboard; the office only reads it.
// Money the chessboard does not know about (another phase, other projects) lives in data/extra-income.json:
// { "items": [{ "date": "YYYY-MM-DD", "amount": 13000000, "kind": "full", "label": "…" }] }.
// One rule (audit 19.11.2026): it is never part of revenue, comparisons, goals or decisions — only shown
// to the owner as a separate line «вне шахматки» (extraIncome()).
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'

export function extraIncome() {
  try { return (JSON.parse(fs.readFileSync(path.join(P.data, 'extra-income.json'), 'utf8')).items || []).filter((x) => x.date && x.amount > 0) } catch { return [] }
}

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const DEAL = ['Бронь', 'Рассрочка', 'Продана']

// flats: [{ n, price, st, soldAt, since }] from the chessboard (soldAt null = sale day unknown); pay: the `flats` list of the payments API or null.
// Every event of this phase, dated or not (an auto full price without a sale date has date null).
function allEvents(flats, pay, today) {
  const byNum = new Map((pay || []).map((p) => [p.number, p]))
  const out = []
  for (const f of flats) {
    const p = byNum.get(f.n)
    if (!DEAL.includes(f.st)) continue
    const booking = p?.booking?.amount || 0
    // soldAt null = sold on an unknown day (moved from a pre-log sale): the status date is the move, not the sale
    const sold = f.soldAt === null ? null : f.soldAt || f.since || null
    if (booking) out.push({ n: f.n, kind: 'booking', amount: booking, date: p.booking.date || f.since })
    // the booking is part of the first payment, so only the rest arrives on the start date
    if (p?.down_payment?.amount) {
      const rest = p.down_payment.amount - booking
      if (rest > 0) out.push({ n: f.n, kind: 'first', amount: rest, date: p.down_payment.date || sold })
    }
    for (const r of p?.payments || []) {
      if (r.paid_date && r.paid_amount) out.push({ n: f.n, kind: 'installment', amount: r.paid_amount, date: r.paid_date })
      else if (r.due_date && r.due_amount && r.due_date > today) out.push({ n: f.n, kind: 'installment', amount: r.due_amount, date: r.due_date, planned: true })
    }
    const paidAny = p?.down_payment?.amount || (p?.payments || []).some((r) => r.paid_amount)
    if (f.st === 'Продана' && f.price && !paidAny && f.price > booking) out.push({ n: f.n, kind: 'full', amount: f.price - booking, date: sold, auto: true })
  }
  return out
}

// Money of the chessboard by date; extra income is not here (see extraIncome()).
export function moneyEvents(flats, pay, today = ymd(new Date())) {
  return allEvents(flats, pay, today).filter((x) => x.date)
}

// «Продана» without payments and without a sale date: its full price is in no month.
export function undatedMoney(flats, pay, today = ymd(new Date())) {
  return allEvents(flats, pay, today).filter((x) => !x.date && x.auto).map((x) => ({ n: x.n, amount: x.amount }))
}

// «Продана» with some payments entered but less than the price: the rest is not received and not scheduled.
export function shortPaid(flats, pay, today = ymd(new Date())) {
  if (!pay) return []
  const ev = allEvents(flats, pay, today)
  const out = []
  for (const f of flats) {
    if (f.st !== 'Продана' || !f.price) continue
    const all = ev.filter((x) => x.n === f.n)
    if (all.some((x) => x.auto)) continue
    const mine = all.filter((x) => x.date)
    const paid = mine.filter((x) => !x.planned).reduce((t, x) => t + x.amount, 0)
    const planned = mine.filter((x) => x.planned).reduce((t, x) => t + x.amount, 0)
    const short = f.price - paid - planned
    if (paid && short >= 1000) out.push({ n: f.n, price: f.price, paid, planned, short })
  }
  return out
}

// Received money in (from, to] — the same bounds the chessboard weeks use.
export function received(events, from, to, today = ymd(new Date())) {
  const s = { revenue: 0, booking: 0, first: 0, installment: 0, full: 0 }
  for (const x of events) {
    if (x.planned || x.date > today || x.date <= from || x.date > to) continue
    s[x.kind] += x.amount
    s.revenue += x.amount
  }
  return s
}

// Scheduled, not yet due, in (from, to].
export function planned(events, from, to) {
  return events.filter((x) => x.planned && x.date > from && x.date <= to).reduce((t, x) => t + x.amount, 0)
}

// Deals whose money is not entered in the chessboard yet. Without the payments list (the API did not answer)
// nothing is known, so nothing is blamed on the owner.
export function unfilled(flats, pay) {
  if (!pay) return []
  const byNum = new Map((pay || []).map((p) => [p.number, p]))
  return flats.filter((f) => {
    const p = byNum.get(f.n)
    if (f.st === 'Бронь') return !p?.booking?.amount
    if (f.st === 'Рассрочка') return !p?.down_payment?.amount && !(p?.payments || []).some((r) => r.paid_amount)
    return false
  }).map((f) => ({ n: f.n, st: f.st }))
}

// One row per deal for the analysts.
export function deals(flats, pay) {
  const byNum = new Map((pay || []).map((p) => [p.number, p]))
  const events = moneyEvents(flats, pay)
  const empty = new Set(unfilled(flats, pay).map((x) => x.n))
  const short = new Map(shortPaid(flats, pay).map((x) => [x.n, x.short]))
  return flats.filter((f) => DEAL.includes(f.st)).map((f) => {
    const p = byNum.get(f.n)
    const mine = events.filter((x) => x.n === f.n)
    return {
      n: f.n, st: f.st, price: f.price || null,
      paid: mine.filter((x) => !x.planned).reduce((t, x) => t + x.amount, 0),
      planned: mine.filter((x) => x.planned).reduce((t, x) => t + x.amount, 0),
      overdue: p?.overdue || 0, overdueSince: p?.overdue_since || null, next: p?.next_due || null,
      filled: !!pay && !empty.has(f.n), auto: mine.some((x) => x.auto), short: short.get(f.n) || 0,
    }
  })
}
