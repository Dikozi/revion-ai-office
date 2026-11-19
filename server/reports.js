// The weekly and the monthly report (owner's decisions 19.11.2026): short, clear, visual.
// Code computes every number and chart (months.js periodFacts); ONE run of Диас writes only the words:
// a phrase, conclusions, advice (and for the month — the 5 rules other prompts follow, monthRules()).
// Weekly: Telegram message (4 numbers with arrows, the phrase, 3 advice with buttons) + a one-page PDF.
// Monthly: Telegram message + PDF of 4 pages + Excel with every month as a row. Both are kept as tasks of Диас
// (work/<task>/: PDF, Excel, a Markdown copy for the portal and colleagues) and listed on the portal page «Отчёты».
// Refusal notes: Ерлан retells the anonymised notes of refused leads in his own words (one cheap run, ≤40 notes).
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { htmlToPdf } from './render.js'
import { writeXlsx } from './xlsx.js'
import { REASON_LIST, leadChannel, realLeads } from './crm.js'
import { periodFacts, addDays, ru, monthName, monthLabel, allMonths, prevMonth } from './months.js'
import { C, esc, n0, n1, n2, mln, plural, change, kpiTile, vbars, hbars, funnel, CHART_CSS } from './charts.js'

const WEEKS = path.join(P.data, 'reports', 'weeks.json')
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f) }
const dm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '')
const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const dayRu = (d) => `${+d.slice(8, 10)} ${GEN[+d.slice(5, 7) - 1]}`
const spanRu = (a, b) => (a.slice(5, 7) === b.slice(5, 7) ? `${+a.slice(8, 10)}–${dayRu(b)}` : `${dayRu(a)} – ${dayRu(b)}`)
const sorted = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])
const avgOf = (v) => { const x = v.filter((y) => y != null); return x.length ? x.reduce((t, y) => t + y, 0) / x.length : null }
const cur$ = (c) => (/USD/i.test(c || '') ? '$' : c || '')
const price = (v, c) => (v == null ? '—' : `${n2(v)} ${cur$(c)}`.trim())
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s }

export function weeksBook() { const b = read(WEEKS, null); return b?.weeks ? b : { weeks: {} } }
export function saveWeek(monday, entry) { const b = weeksBook(); b.weeks[monday] = { ...(b.weeks[monday] || {}), ...entry }; write(WEEKS, b) }

// the Monday of the last complete Monday–Sunday week
export function lastWeekMonday(today) {
  const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  return addDays(today, -wd - 7)
}

// ---------- schemas ----------

export function adviceSchema(metrics, n) {
  return { type: 'array', minItems: 1, maxItems: n, items: { type: 'object', properties: { who: { type: 'string' }, what: { type: 'string' }, expect: { type: 'string' }, metric: { type: 'string', enum: metrics } }, required: ['who', 'what', 'expect'] } }
}
export const weekSchema = (metrics) => ({
  type: 'object',
  properties: { phrase: { type: 'string' }, conclusions: { type: 'array', items: { type: 'string' }, maxItems: 3 }, advice: adviceSchema(metrics, 3), week_sales: { type: 'integer' }, week_bookings: { type: 'integer' } },
  required: ['phrase', 'conclusions', 'advice'],
})
export const monthSchema = (metrics) => ({
  type: 'object',
  properties: { phrase: { type: 'string' }, conclusions: { type: 'array', items: { type: 'string' }, maxItems: 5 }, advice: adviceSchema(metrics, 5), rules: { type: 'array', items: { type: 'string' }, maxItems: 5 }, checked: { type: 'string' } },
  required: ['phrase', 'conclusions', 'advice', 'rules'],
})
export const NOTES_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' }, words: { type: 'string' } }, required: ['id', 'reason', 'words'] } } },
  required: ['items'],
}

// ---------- refusal notes → own words ----------

export function notesPrompt(items) {
  return [
    'Ты — Ерлан, аналитик продаж застройщика Altyn Qala. Ниже заметки менеджеров к клиентам, которые отказались. Имена, телефоны и номера уже скрыты.',
    `Для каждой строки верни: id; reason — короткая причина: одна из списка (${REASON_LIST.join('; ')}) или своя короткая категория до 30 знаков; если из заметки причина не ясна — «Причина не ясна»; words — своими словами, до 90 знаков, что на самом деле случилось с клиентом (например: «узнал цену и ушёл думать, на повторные сообщения не отвечает»).`,
    'В words — без имён, телефонов, номеров квартир и лидов, не копируй заметку дословно, не выдумывай того, чего в ней нет.',
    '', 'id | причина в CRM | заметка', ...items.map((x) => `${x.id} | ${x.reason} | ${x.text.replace(/\|/g, '/')}`),
  ].join('\n')
}

// one run for up to 40 queued notes; nothing queued — nothing run
export async function explainRefusals({ crm, run }) {
  const items = crm?.pendingNotes?.(40) || []
  if (!items.length || !run) return 0
  const out = await run('sales', notesPrompt(items), NOTES_SCHEMA, 'Читает заметки к отказам', { model: 'sonnet', effort: 'low', maxBudgetUsd: 0.3, timeoutMin: 5 })
  if (!out?.items?.length) return 0
  const known = new Map(items.map((x) => [String(x.id), x]))
  const got = out.items.filter((x) => known.has(String(x.id))).map((x) => ({ ...x, id: String(x.id), h: known.get(String(x.id)).h }))
  crm.saveRefusalWords(got)
  return got.length
}

// ---------- the week ----------

const KPIS = [
  { key: 'money', label: 'Деньги получены', icon: '💰', good: 'up', get: (f) => f.money?.received, money: true },
  { key: 'sales', label: 'Продажи', icon: '🏠', good: 'up', get: (f) => f.sales?.net },
  { key: 'leads', label: 'Новые клиенты', icon: '👥', good: 'up', get: (f) => f.leads?.total },
  { key: 'cpr', label: 'Цена переписки', icon: '💬', good: 'down', get: (f) => f.ads?.cpr, price: true },
]

function topRefusals(f, n = 3) {
  return sorted(f.leads?.refusals).slice(0, n).map(([reason, count]) => ({ reason, count, words: [...new Set((f.words || []).filter((w) => w.reason === reason).map((w) => w.words))].slice(0, 2) }))
}

export function weekFacts(src, monday) {
  const at = (k) => periodFacts(src, addDays(monday, 7 * k), addDays(monday, 7 * k + 6))
  const weeks = [-7, -6, -5, -4, -3, -2, -1, 0].map(at)
  const cur = weeks[7], prev = weeks[6], before = weeks.slice(2, 6).concat([prev]).slice(-4)
  const currency = cur.ads?.currency || prev.ads?.currency || 'USD'
  const kpis = KPIS.map((k) => {
    const v = before.map(k.get).filter((x) => x != null)
    return { ...k, get: undefined, now: k.get(cur) ?? null, prev: k.get(prev) ?? null, avg: v.length >= 2 ? avgOf(v) : null }
  })
  const notes = []
  if (!src.chess) notes.push('Шахматка не ответила — продаж и денег в отчёте нет.')
  else if (!src.chess.pay) notes.push('Оплаты из шахматки не прочитались — денег недели нет.')
  if (!src.leads) notes.push('CRM не подключена — клиентов и отказов нет.')
  else if (src.crmFirst > addDays(monday, -28)) notes.push(`CRM ведётся с ${ru(src.crmFirst)} — среднее по клиентам неполное.`)
  if (!cur.ads) notes.push('Цифр рекламы за неделю нет.')
  return {
    monday, sunday: addDays(monday, 6), currency, kpis, cur, prev,
    series: weeks.map((w) => ({ from: w.from, to: w.to, label: dm(w.from), sales: w.sales?.net ?? null, money: w.money?.received ?? null })),
    funnel: [
      { label: 'Новые клиенты', value: cur.leads?.total ?? null, src: 'CRM' },
      { label: 'Консультация', value: cur.leads?.consult ?? null, src: 'CRM' },
      { label: 'Бронь', value: cur.sales?.bookings ?? null, src: 'шахматка' },
      { label: 'Продажа', value: cur.sales ? Math.max(0, cur.sales.net) : null, src: 'шахматка' },
    ],
    sources: sorted(cur.leads?.sources), buyers: sorted(cur.buyers?.sources), refusals: topRefusals(cur), lost: cur.leads?.lost ?? null,
    extra: cur.extra, notes,
  }
}

const fmtKpi = (k, v, c) => (v == null ? 'нет данных' : k.money ? mln(v) : k.price ? price(v, c) : n0(v))

export function weekPrompt(f, { team = [], goals = null, memory = [], rules = '', metrics = {} } = {}) {
  const c = f.currency
  const k = (key) => f.kpis.find((x) => x.key === key)
  const line = (x) => `- ${x.label}: ${fmtKpi(x, x.now, c)} (прошлая неделя ${fmtKpi(x, x.prev, c)}; среднее 4 недель ${x.avg == null ? 'нет данных' : fmtKpi(x, x.avg, c)})`
  return [
    `Ты — Диас, руководитель офиса маркетинга и продаж застройщика Altyn Qala (ЖК «Altyn Qala 2», 2 очередь, сдача 2027). Неделя ${dm(f.monday)}–${dm(f.sunday)} закончилась. Цифры ниже посчитал код — им можно доверять, других цифр не придумывай.`,
    'Напиши только слова для короткого отчёта владельцу (он маркетолог, не аналитик, читает с телефона), простыми словами:',
    '- phrase — одна фраза до 140 знаков: главное за неделю;',
    '- conclusions — ровно 3 вывода, каждый до 160 знаков: факт с цифрой → что это значит. Разделяй факт и вероятную причину, совпадение по времени не выдавай за причину; если данных мало — так и скажи;',
    `- advice — ровно 3 совета на эту неделю: who — id исполнителя из списка ниже или owner, если сделать должен владелец; what — готовое поручение до 200 знаков; expect — чего ждём, словами, без выдуманных процентов; metric — какой показатель должен сдвинуться (${Object.entries(metrics).map(([key, m]) => `${key} — ${m.label}`).join('; ')});`,
    '- week_sales и week_bookings — реалистичный план продаж и броней на эту неделю (целые числа) от темпа 4 недель.',
    '', 'Команда:', ...team,
    '', `Цифры недели ${dm(f.monday)}–${dm(f.sunday)}:`, ...f.kpis.map(line),
    f.extra ? `- Деньги вне шахматки (другая очередь, НЕ выручка, в сравнения не входят): ${mln(f.extra)}` : '',
    `- Брони за неделю: ${f.cur.sales?.bookings ?? 'нет данных'}, снято броней: ${f.cur.sales?.unbooked ?? 'нет данных'}, отмен продаж: ${f.cur.sales?.cancels ?? 'нет данных'}`,
    `- Воронка недели: ${f.funnel.map((s) => `${s.label} ${s.value ?? 'нет данных'}`).join(' → ')} (клиенты и консультации — CRM, брони и продажи — шахматка)`,
    `- Продажи по неделям (8 недель): ${f.series.map((s) => s.sales ?? '—').join(', ')}`,
    `- Деньги по неделям, млн ₸: ${f.series.map((s) => (s.money == null ? '—' : n1(s.money / 1e6))).join(', ')}`,
    `- Откуда клиенты: ${f.sources.map(([k, v]) => `${k} ${v}`).join(', ') || 'нет данных'}`,
    `- Откуда покупатели: ${f.buyers.map(([k, v]) => `${k} ${v}`).join(', ') || 'нет данных'}`,
    `- Отказы недели: ${f.lost ?? 'нет данных'}; главные причины: ${f.refusals.map((r) => `${r.reason} ${r.count}${r.words.length ? ` («${r.words.join('»; «')}»)` : ''}`).join('; ') || 'нет'}`,
    f.cur.ads ? `- Реклама: расход ${n0(f.cur.ads.spend)} ${cur$(c)}, из них на охват и профиль ${n0(f.cur.ads.spendReach)} ${cur$(c)}; переписок ${f.cur.ads.chats}, заявок с формы ${f.cur.ads.forms}` : '',
    goals ? `- Цели месяца: ${JSON.stringify({ sales: goals.sales, revenue: goals.revenue, maxCpr: goals.maxCpr })}` : '- Целей месяца нет.',
    ...(f.notes.length ? ['', 'Чего не хватает в данных:', ...f.notes.map((x) => `- ${x}`)] : []),
    memory.length ? `\nРешения последних недель и их замеры:\n${memory.join('\n')}` : '',
    rules ? `\nПравила месяца (советы должны им следовать):\n${rules}` : '',
  ].filter((x) => x !== '').join('\n')
}

// what Диас wrote, made safe: right lengths, known people, known metrics; nothing written — words from the numbers
export function cleanWords(out, f, { ids = [], metrics = {}, n = 3 } = {}) {
  const who = (x) => { const k = String(x || '').toLowerCase().trim(); return k === 'owner' || k === 'владелец' ? 'owner' : ids.includes(k) ? k : 'owner' }
  const advice = (out?.advice || []).slice(0, n).map((a) => ({ who: who(a.who), what: short(a.what, 220), expect: short(a.expect, 140), metric: metrics[a.metric] ? a.metric : null })).filter((a) => a.what)
  const phrase = short(out?.phrase, 180) || autoPhrase(f)
  return { phrase, conclusions: (out?.conclusions || []).map((x) => short(x, 200)).filter(Boolean).slice(0, n === 3 ? 3 : 5), advice, rules: (out?.rules || []).map((x) => short(x, 260)).filter(Boolean).slice(0, 5), checked: short(out?.checked, 400), sales: Number.isInteger(out?.week_sales) ? out.week_sales : null, bookings: Number.isInteger(out?.week_bookings) ? out.week_bookings : null, auto: !out }
}

function autoPhrase(f) {
  const s = f.kpis?.find((k) => k.key === 'sales')
  return s?.now != null ? `Продаж за неделю: ${s.now} (было ${s.prev ?? '—'}).` : 'Цифры недели собраны кодом; слова Диаса не получились.'
}

const arrowTg = (k) => {
  const ch = change(k.now, k.prev, k.good)
  if (!ch.text || ch.dir === 0) return ch.text === 'без изменений' ? '→' : ''
  return `${ch.good ? '🟢' : '🔴'}${ch.dir > 0 ? '↑' : '↓'}`
}

export function weekMessage(f, w, names) {
  const c = f.currency
  const lines = [
    `📊 Отчёт недели · ${spanRu(f.monday, f.sunday)}`, '━━━━━━━━━━━━━━',
    ...f.kpis.map((k) => `${k.icon} ${k.label}: ${fmtKpi(k, k.now, c)}${k.now != null ? ` ${arrowTg(k)}` : ''}${k.prev != null ? ` (было ${fmtKpi(k, k.prev, c)})` : ''}`),
    ...(f.extra ? [`   + вне шахматки ${mln(f.extra)} — не выручка`] : []),
    '', w.phrase,
  ]
  if (w.advice.length) {
    lines.push('', '📌 Советы на неделю:')
    w.advice.forEach((a, i) => lines.push(`${i + 1}. ${a.who === 'owner' ? 'Вам' : names(a.who)}: ${a.what}${a.expect ? `\n   ждём: ${a.expect}` : ''}`))
  }
  if (w.sales != null || w.bookings != null) lines.push('', `🎯 План недели: ${w.sales ?? '—'} ${plural(w.sales ?? 0, 'продажа', 'продажи', 'продаж')}, ${w.bookings ?? '—'} ${plural(w.bookings ?? 0, 'бронь', 'брони', 'броней')}`)
  lines.push('', `📎 Подробно — в PDF.${w.advice.length ? ' Утвердить советы — кнопками ниже.' : ''}`)
  return lines.join('\n')
}

// ---------- PDF pieces ----------

const BASE_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font: 9.5pt/1.4 'Segoe UI', 'DejaVu Sans', Arial, sans-serif; color: ${C.ink}; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 296.5mm; padding: 9mm 10mm 8mm; display: flex; flex-direction: column; gap: 3.2mm; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
.top { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid ${C.navy}; padding-bottom: 2.5mm; }
.brand { display: flex; align-items: center; gap: 7px; }
.logo { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, ${C.navy}, ${C.blue} 55%, ${C.green}); color: #fff; font-weight: 800; display: grid; place-items: center; font-size: 12px; }
.brand b { letter-spacing: 2px; font-size: 11pt; }
.brand span { color: ${C.muted}; font-size: 8.5pt; }
.pg { color: ${C.muted}; font-size: 8.5pt; text-align: right; }
.pg b { color: ${C.ink}; font-size: 10.5pt; display: block; }
h1 { font-size: 15pt; margin: 0; line-height: 1.2; }
h2 { font-size: 10.5pt; margin: 0 0 4px; color: ${C.navy}; }
h2 small { color: ${C.muted}; font-weight: 500; font-size: 8pt; }
.phrase { font-size: 13pt; font-weight: 700; line-height: 1.3; background: ${C.bg}; border-left: 4px solid ${C.blue}; padding: 3mm 4mm; border-radius: 0 8px 8px 0; }
.kpis { display: grid; gap: 3mm; }
.k4 { grid-template-columns: repeat(4, 1fr); } .k3 { grid-template-columns: repeat(3, 1fr); }
.row { display: grid; gap: 3mm; }
.r2 { grid-template-columns: 1fr 1fr; } .r3 { grid-template-columns: 1fr 1fr 1fr; } .r32 { grid-template-columns: 1.25fr 1fr; }
.card { border: 1px solid ${C.line}; border-radius: 10px; padding: 3mm 3.5mm; background: #fff; min-width: 0; }
.list { margin: 0; padding-left: 15px; } .list li { margin-bottom: 3px; }
.adv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
.adv.a5 { grid-template-columns: 1fr; gap: 2mm; }
.ad { background: ${C.bg}; border-radius: 9px; padding: 2.5mm 3mm; }
.ad .n { display: inline-grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: ${C.navy}; color: #fff; font-weight: 800; font-size: 8pt; margin-right: 4px; }
.ad .who { font-weight: 700; color: ${C.navy}; }
.ad .what { margin-top: 3px; }
.ad .exp { color: ${C.green}; font-size: 8.3pt; margin-top: 3px; }
.ref { display: flex; flex-direction: column; gap: 4px; }
.ref .rr b { font-size: 9.5pt; } .ref .rr span { color: ${C.muted}; }
.ref .w { font-size: 8.3pt; color: ${C.ink}; font-style: italic; margin-left: 8px; }
.foot { margin-top: auto; font-size: 7.5pt; color: ${C.muted}; border-top: 1px solid ${C.line}; padding-top: 2mm; }
table.t { width: 100%; border-collapse: collapse; font-size: 8.3pt; }
table.t th { text-align: left; color: ${C.muted}; font-weight: 600; border-bottom: 1px solid ${C.line}; padding: 2px 4px; }
table.t td { border-bottom: 1px solid ${C.bg}; padding: 2px 4px; }
table.t td.n, table.t th.n { text-align: right; white-space: nowrap; }
.good { color: ${C.green}; font-weight: 700; } .bad { color: ${C.red}; font-weight: 700; } .mut { color: ${C.muted}; }
.goal { display: grid; grid-template-columns: 30% 1fr 30%; gap: 6px; align-items: center; font-size: 8.7pt; margin-bottom: 4px; }
.bar { height: 10px; background: ${C.bg}; border-radius: 5px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 5px; }
${CHART_CSS}`

const head = (title, right, page) => `<div class="top"><div class="brand"><span class="logo">R</span><b>REVION</b><span>${esc(title)}</span></div><div class="pg"><b>${esc(right)}</b>${page ? esc(page) : ''}</div></div>`
const doc = (title, pages) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${pages.join('')}</body></html>`
const adviceCards = (advice, names, cls = '') => (advice.length ? `<div class="adv ${cls}">${advice.map((a, i) => `<div class="ad"><span class="n">${i + 1}</span><span class="who">${esc(a.who === 'owner' ? 'Вам' : names(a.who))}</span><div class="what">${esc(a.what)}</div>${a.expect ? `<div class="exp">ждём: ${esc(a.expect)}</div>` : ''}</div>`).join('')}</div>` : '<div class="nodata">советов нет</div>')
const refusalsBlock = (list, total) => (list.length ? `<div class="ref">${list.map((r) => `<div><div class="rr"><b>${esc(r.reason)}</b> <span>— ${n0(r.count)}${total ? ` из ${n0(total)}` : ''}</span></div>${r.words.map((w) => `<div class="w">«${esc(w)}»</div>`).join('')}</div>`).join('')}</div>` : `<div class="nodata">${total === 0 ? 'отказов не было' : 'нет данных'}</div>`)
const items = (pairs) => pairs.map(([label, value]) => ({ label, value }))

export function weekHtml(f, w, names) {
  const c = f.currency
  const tiles = f.kpis.map((k) => kpiTile({ label: k.label, now: k.now, prev: k.prev, avg: k.avg, good: k.good, fmt: (v) => (k.money ? mln(v) : k.price ? price(v, c) : n0(v)) }))
  const sales = f.series.map((s) => s.sales), money = f.series.map((s) => (s.money == null ? null : s.money / 1e6))
  const labels = f.series.map((s) => s.label), hot = f.series.map((_, i) => i === 7)
  const page = `<section class="page">
    ${head('Отчёт недели', spanRu(f.monday, f.sunday), 'понедельник–воскресенье')}
    <div class="phrase">${esc(w.phrase)}</div>
    <div class="kpis k4">${tiles.join('')}</div>
    <div class="row r2">
      <div class="card"><h2>Продажи по неделям <small>квартир, за вычетом отмен</small></h2>${vbars(sales, labels, { hot, h: 118, w: 330 })}</div>
      <div class="card"><h2>Деньги по неделям <small>млн ₸, полученные</small></h2>${vbars(money, labels, { hot, h: 118, w: 330, fmt: n1, color: C.green })}</div>
    </div>
    <div class="row r3">
      <div class="card"><h2>Воронка недели</h2>${funnel(f.funnel)}</div>
      <div class="card"><h2>Откуда клиенты</h2>${hbars(items(f.sources), { max: 5 })}</div>
      <div class="card"><h2>Откуда покупатели</h2>${hbars(items(f.buyers), { max: 5, color: C.green, empty: f.cur.sales?.net === 0 ? 'продаж не было' : 'нет данных' })}</div>
    </div>
    <div class="row r2">
      <div class="card"><h2>Почему отказываются</h2>${refusalsBlock(f.refusals, f.lost)}</div>
      <div class="card"><h2>Выводы</h2>${w.conclusions.length ? `<ol class="list">${w.conclusions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<div class="nodata">выводов нет</div>'}</div>
    </div>
    <div class="card"><h2>Советы на неделю${w.sales != null ? ` <small>план недели: ${w.sales} ${plural(w.sales, 'продажа', 'продажи', 'продаж')}, ${w.bookings ?? '—'} ${plural(w.bookings ?? 0, 'бронь', 'брони', 'броней')}</small>` : ''}</h2>${adviceCards(w.advice, names)}</div>
    <div class="foot">Клиенты и консультации — CRM, брони, продажи и деньги — шахматка (продажи за вычетом отмен, перенос клиента — не продажа). Цена переписки — только реклама на переписки и форму-заявку.${f.extra ? ` Вне шахматки получено ${esc(mln(f.extra))} — это не выручка, в сравнения не входит.` : ''}${f.notes.length ? ` ${esc(f.notes.join(' '))}` : ''}</div>
  </section>`
  return doc(`Отчёт недели ${dm(f.monday)}–${dm(f.sunday)}`, [page])
}

export function weekMarkdown(f, w, names) {
  const c = f.currency
  const t = [`# Отчёт недели ${dm(f.monday)}–${dm(f.sunday)}`, '', `**${w.phrase}**`, '', '## Цифры', '| показатель | неделя | прошлая | среднее 4 недель |', '|---|---|---|---|',
    ...f.kpis.map((k) => `| ${k.label} | ${fmtKpi(k, k.now, c)} | ${fmtKpi(k, k.prev, c)} | ${k.avg == null ? '—' : fmtKpi(k, k.avg, c)} |`),
    ...(f.extra ? ['', `Вне шахматки: ${mln(f.extra)} — не выручка.`] : []),
    '', `## Воронка недели`, f.funnel.map((s) => `${s.label} ${s.value ?? '—'}`).join(' → '),
    '', '## Откуда клиенты', f.sources.map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- нет данных',
    '', '## Откуда покупатели', f.buyers.map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- нет данных',
    '', '## Почему отказываются', ...(f.refusals.length ? f.refusals.map((r) => `- ${r.reason} — ${r.count}${r.words.length ? `: «${r.words.join('»; «')}»` : ''}`) : ['- нет данных']),
    '', '## Выводы', ...w.conclusions.map((x, i) => `${i + 1}. ${x}`),
    '', '## Советы на неделю', ...w.advice.map((a, i) => `${i + 1}. ${a.who === 'owner' ? 'Владелец' : names(a.who)}: ${a.what}${a.expect ? ` — ждём: ${a.expect}` : ''}`),
    ...(f.notes.length ? ['', '## Полнота данных', ...f.notes.map((x) => `- ${x}`)] : []),
  ]
  return `${t.join('\n')}\n`
}

// ---------- the month ----------

const MONTH_KPIS = [
  { key: 'sales', label: 'Продажи', get: (m) => m.values.sales?.net, good: 'up', fmt: n0 },
  { key: 'money', label: 'Деньги получены', get: (m) => m.values.money?.received, good: 'up', fmt: mln },
  { key: 'leads', label: 'Новые клиенты', get: (m) => m.values.leads?.total, good: 'up', fmt: n0 },
  { key: 'cpr', label: 'Цена переписки', get: (m) => m.values.ads?.cpr, good: 'down', price: true },
  { key: 'spend', label: 'Расход на рекламу', get: (m) => m.values.ads?.spendKzt, good: 'neutral', fmt: mln },
  { key: 'followers', label: 'Подписчики на конец', get: (m) => m.values.insta?.followersEnd, good: 'up', fmt: n0 },
]
const mon3 = (key, i) => `${monthName(key).slice(0, 3)}${key.slice(5) === '01' || i === 0 ? ` ${key.slice(2, 4)}` : ''}`

// numbers of the month and of all months for the charts; extra (goals, pace, conversion, decisions) from the caller
export function monthFacts(book, key, { pace = null, goals = null, leads = null, records = [], words = {} } = {}) {
  const list = allMonths(book)
  const i = list.findIndex((m) => m.key === key)
  const m = list[i]
  if (!m) return null
  const prev = list[i - 1] || null
  const before = list.slice(Math.max(0, i - 12), i)
  const currency = m.values.ads?.currency || prev?.values.ads?.currency || 'USD'
  const kpis = MONTH_KPIS.map((k) => ({ ...k, get: undefined, now: k.get(m) ?? null, prev: prev ? k.get(prev) ?? null : null, avg: avgOf(before.map(k.get)), fmt: k.price ? (v) => price(v, currency) : k.fmt }))
  // the charts: every month from the first one that knows the value
  const upto = list.slice(0, i + 1)
  const series = (get) => {
    const from = upto.findIndex((x) => get(x) != null)
    const part = from < 0 ? [] : upto.slice(from)
    return { values: part.map(get), labels: part.map((x, j) => mon3(x.key, j)), hot: part.map((x) => x.key === key), partial: part.map((x) => !!x.partial) }
  }
  const v = m.values
  const g = goals || v.goals || null
  const goalRows = g ? [
    g.sales != null && { label: 'Продажи', plan: g.sales, fact: v.sales?.net ?? null, fmt: n0 },
    g.revenue != null && { label: 'Деньги', plan: g.revenue, fact: v.money?.received ?? null, fmt: mln },
    g.maxCpr != null && { label: 'Цена переписки не выше', plan: g.maxCpr, fact: v.ads?.cpr ?? null, fmt: (x) => price(x, currency), lower: true },
  ].filter(Boolean) : []
  // conversion by source over all the CRM time: a month is too short for it
  let conv = []
  if (leads?.length) {
    const o = {}
    for (const l of realLeads(leads)) { const s = leadChannel(l).label; o[s] ??= { leads: 0, bought: 0 }; o[s].leads++; if (l.stage === 'sale') o[s].bought++ }
    conv = Object.entries(o).map(([label, x]) => ({ label, ...x, conv: x.leads ? Math.round((x.bought / x.leads) * 1000) / 10 : null })).sort((a, b) => b.bought - a.bought || b.leads - a.leads)
  }
  const shares = (r) => { const tot = Object.values(r || {}).reduce((t, x) => t + x, 0); return tot ? Object.fromEntries(Object.entries(r).map(([k, x]) => [k, Math.round((x / tot) * 100)])) : {} }
  const refNow = shares(v.leads?.refusals), refPrev = shares(prev?.values.leads?.refusals)
  const refusals = sorted(v.leads?.refusals).slice(0, 6).map(([reason, count]) => ({ reason, count, share: refNow[reason], prevShare: prev?.values.leads ? refPrev[reason] ?? 0 : null }))
  const explained = [...new Set((v.words || []).map((x) => `${x.reason}: ${x.words}`))].slice(0, 5)
  const word = { approved: 'утверждено, не замерено', declined: 'отклонено', worked: 'сработало', not: 'не сработало', flat: 'без заметного изменения', insufficient: 'данных мало' }
  const decisions = records.filter((r) => r.verdict !== 'declined').map((r) => ({ title: r.decision, from: r.from, verdict: r.verdict, word: word[r.verdict] || r.verdict, result: r.result }))
  return {
    key, m, prev, currency, kpis, goalRows, pace,
    charts: {
      sales: series((x) => x.values.sales?.net), money: series((x) => (x.values.money?.received == null ? null : x.values.money.received / 1e6)), leads: series((x) => x.values.leads?.total),
      cpr: series((x) => x.values.ads?.cpr), followers: series((x) => x.values.insta?.followersEnd), spend: series((x) => (x.values.ads?.spendKzt == null ? null : x.values.ads.spendKzt / 1e3)),
    },
    buyers: sorted(v.buyers?.sources), sources: sorted(v.leads?.sources), conv,
    rooms: sorted(v.sales?.rooms), floors: sorted(v.sales?.floors), pay: sorted(v.sales?.pay),
    refusals, explained, lost: v.leads?.lost ?? null, decisions,
    complete: Object.values(m.complete || {}), revisions: (m.revisions || []).filter((r) => !r.filled).slice(-5),
    recent: list.slice(Math.max(0, i - 5), i + 1).reverse(),
    months: list.length,
  }
}

export function monthPrompt(F, { team = [], memory = [], rules = '', metrics = {} } = {}) {
  const c = F.currency, v = F.m.values
  const name = monthLabel(F.key)
  return [
    `Ты — Диас, руководитель офиса маркетинга и продаж застройщика Altyn Qala (ЖК «Altyn Qala 2», 2 очередь, сдача 2027). ${name} закончился. Цифры ниже посчитал код — им можно доверять, других цифр не придумывай.`,
    'Напиши только слова для месячного отчёта владельцу (маркетолог, не аналитик), простыми словами:',
    '- phrase — одна фраза до 160 знаков: итог месяца;',
    '- conclusions — 3–5 выводов, каждый до 180 знаков: факт с цифрой → что это значит; разделяй факт и вероятную причину;',
    `- advice — 3–5 советов на следующий месяц: who — id исполнителя или owner; what — поручение до 200 знаков; expect — чего ждём; metric — один из: ${Object.entries(metrics).map(([k, m]) => `${k} — ${m.label}`).join('; ')};`,
    '- rules — ровно 5 правил на месяц для всей команды: конкретных и проверяемых, что делать или не делать и почему (по цифрам месяца); их будут читать в каждой задаче;',
    '- checked — 1–2 предложения: что из советов прошлого месяца сработало, что нет (по замерам ниже).',
    '', 'Команда:', ...team,
    '', `Главные цифры (${name}; было — прошлый месяц; среднее — до 12 месяцев до него):`,
    ...F.kpis.map((k) => `- ${k.label}: ${k.now == null ? 'нет данных' : k.fmt(k.now)} (было ${k.prev == null ? 'нет данных' : k.fmt(k.prev)}; среднее ${k.avg == null ? 'нет данных' : k.fmt(k.avg)})`),
    v.extra ? `- Деньги вне шахматки (НЕ выручка): ${mln(v.extra)}` : '',
    `- Брони ${v.sales?.bookings ?? '—'}, снято броней ${v.sales?.unbooked ?? '—'}, отмен продаж ${v.sales?.cancels ?? '—'}; остаток квартир на конец ${v.stock?.left ?? '—'}`,
    F.goalRows.length ? `- Цели месяца: ${F.goalRows.map((g) => `${g.label}: план ${g.fmt(g.plan)}, факт ${g.fact == null ? 'нет данных' : g.fmt(g.fact)}`).join('; ')}` : '- Целей месяца не утверждали.',
    F.pace ? `- Темп к сдаче: продаём ${n1(F.pace.perMonth)} кв. в месяц, нужно ${F.pace.need == null ? '—' : n1(F.pace.need)}; продано ${F.pace.sold} из ${F.pace.target}` : '',
    `- Продажи по месяцам: ${F.charts.sales.values.map((x, i) => `${F.charts.sales.labels[i]} ${x ?? '—'}`).join(', ')}`,
    `- Клиенты по месяцам: ${F.charts.leads.values.map((x, i) => `${F.charts.leads.labels[i]} ${x ?? '—'}`).join(', ') || 'нет данных'}`,
    `- Цена переписки по месяцам, ${cur$(c)}: ${F.charts.cpr.values.slice(-8).map((x, i, a) => `${F.charts.cpr.labels.slice(-a.length)[i]} ${x == null ? '—' : n2(x)}`).join(', ') || 'нет данных'}`,
    `- Откуда клиенты: ${F.sources.map(([k, x]) => `${k} ${x}`).join(', ') || 'нет данных'}`,
    `- Откуда покупатели: ${F.buyers.map(([k, x]) => `${k} ${x}`).join(', ') || 'нет данных'}`,
    F.conv.length ? `- Конверсия в продажу по источникам за всё время CRM: ${F.conv.map((x) => `${x.label} ${x.bought} из ${x.leads}`).join(', ')}` : '',
    `- Что купили: ${F.rooms.map(([k, x]) => `${k} ${x}`).join(', ') || '—'}; этажи: ${F.floors.map(([k, x]) => `${k} ${x}`).join(', ') || '—'}; оплата: ${F.pay.map(([k, x]) => `${k} ${x}`).join(', ') || '—'}`,
    `- Отказы: ${F.lost ?? 'нет данных'}; причины: ${F.refusals.map((r) => `${r.reason} ${r.share}%${r.prevShare != null ? ` (было ${r.prevShare}%)` : ''}`).join(', ') || '—'}`,
    F.explained.length ? `- Своими словами (заметки менеджеров): ${F.explained.map((x) => `«${x}»`).join('; ')}` : '',
    F.decisions.length ? `\nСоветы и решения прошлого месяца и их замер:\n${F.decisions.slice(0, 10).map((d) => `- «${d.title}» → ${d.word}${d.result ? ` (${d.result.metric}: ${d.result.base ?? '—'} → ${d.result.value ?? '—'})` : ''}`).join('\n')}` : '\nСоветов прошлого месяца с замером нет.',
    F.complete.length ? `\nЧего не хватает в данных: ${F.complete.join('; ')}` : '',
    memory.length ? `\nПамять компании (последние решения):\n${memory.join('\n')}` : '',
    rules ? `\nПравила прошлого месяца (проверь, помогли ли):\n${rules}` : '',
  ].filter((x) => x !== '').join('\n')
}

export function monthMessage(F, w, names) {
  const name = monthLabel(F.key)
  const lines = [`🗓 Отчёт месяца · ${name}`, '━━━━━━━━━━━━━━',
    ...F.kpis.slice(0, 5).map((k) => `${{ sales: '🏠', money: '💰', leads: '👥', cpr: '💬', spend: '📣', followers: '📱' }[k.key]} ${k.label}: ${k.now == null ? 'нет данных' : k.fmt(k.now)}${k.now != null && k.good !== 'neutral' ? ` ${arrowTg(k)}` : ''}${k.prev != null ? ` (было ${k.fmt(k.prev)})` : ''}`),
    ...(F.m.values.extra ? [`   + вне шахматки ${mln(F.m.values.extra)} — не выручка`] : []),
    '', w.phrase]
  if (w.advice.length) { lines.push('', '📌 Советы на месяц:'); w.advice.forEach((a, i) => lines.push(`${i + 1}. ${a.who === 'owner' ? 'Вам' : names(a.who)}: ${a.what}`)) }
  if (w.rules.length) lines.push('', '📏 5 правил месяца — команда получает их в каждой задаче (в PDF).')
  lines.push('', `📎 PDF и Excel со всеми месяцами — ниже${w.advice.length ? '; советы утвердить кнопками' : ''}.`)
  return lines.join('\n')
}

const chartCard = (title, unit, s, opt = {}) => `<div class="card"><h2>${esc(title)} <small>${esc(unit)}</small></h2>${vbars(s.values, s.labels, { hot: s.hot, partial: s.partial, h: 150, w: 330, ...opt })}</div>`

export function monthHtml(F, w, names) {
  const name = monthLabel(F.key), v = F.m.values, c = F.currency
  const total = F.months
  const pg = (n) => `страница ${n} из 4`
  const tiles = F.kpis.map((k) => kpiTile({ label: k.label, now: k.now, prev: k.prev, avg: k.avg, good: k.good, fmt: k.fmt, sub: k.key === 'spend' && v.ads ? `${n0(v.ads.spend)} ${cur$(c)}` : '' }))
  const goal = (g) => {
    const share = g.fact == null || !g.plan ? null : g.lower ? (g.fact <= g.plan ? 1 : g.plan / g.fact) : Math.min(1, g.fact / g.plan)
    const ok = g.fact != null && (g.lower ? g.fact <= g.plan : g.fact >= g.plan)
    return `<div class="goal"><span>${esc(g.label)}</span><span class="bar"><i style="width:${share == null ? 0 : Math.max(3, share * 100)}%;background:${ok ? C.green : C.amber}"></i></span><span>${g.fact == null ? '<span class="mut">нет данных</span>' : `<b class="${ok ? 'good' : 'bad'}">${esc(g.fmt(g.fact))}</b>`} из ${esc(g.fmt(g.plan))}${ok ? ' ✓' : ''}</span></div>`
  }
  const p = F.pace
  const p1 = `<section class="page">
    ${head('Отчёт месяца', name, pg(1))}
    <h1>Общая картина</h1>
    <div class="phrase">${esc(w.phrase)}</div>
    <div class="kpis k3">${tiles.join('')}</div>
    <div class="row r2">
      <div class="card"><h2>Цели месяца: план и факт</h2>${F.goalRows.length ? F.goalRows.map(goal).join('') : '<div class="nodata">целей на этот месяц не утверждали</div>'}</div>
      <div class="card"><h2>Темп к сдаче дома</h2>${p ? `<div class="kv">${n1(p.perMonth)} <span class="ku">кв. в месяц сейчас</span></div><div class="ks">нужно ${p.need == null ? '—' : n1(p.need)} в месяц, чтобы к сдаче (${esc(p.handover || '')}) продать ${n0(p.target)}; продано ${n0(p.sold)}, осталось ${n0(p.toGo)}</div><div class="bar" style="margin-top:6px"><i style="width:${p.target ? Math.max(3, (p.sold / p.target) * 100) : 0}%;background:${p.need && p.perMonth >= p.need ? C.green : C.amber}"></i></div><div class="ks">${p.need ? (p.perMonth >= p.need ? '<b class="good">успеваем</b>' : p.perMonth >= p.need * 0.8 ? '<b style="color:#B7791F">впритык</b>' : '<b class="bad">отстаём</b>') : ''}</div>` : '<div class="nodata">нет данных</div>'}</div>
    </div>
    <div class="card"><h2>Выводы</h2>${w.conclusions.length ? `<ol class="list">${w.conclusions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<div class="nodata">выводов нет</div>'}</div>
    <div class="card"><h2>Последние месяцы <small>все месяцы — на следующей странице и в Excel</small></h2><table class="t"><tr><th>Месяц</th><th class="n">Продажи</th><th class="n">Брони</th><th class="n">Деньги</th><th class="n">Клиенты</th><th class="n">Цена переписки</th><th class="n">Подписчики</th></tr>${F.recent.map((x) => `<tr${x.key === F.key ? ' style="font-weight:700"' : ''}><td>${esc(monthLabel(x.key))}</td><td class="n">${n0(x.values.sales?.net)}</td><td class="n">${n0(x.values.sales?.bookings)}</td><td class="n">${esc(mln(x.values.money?.received))}</td><td class="n">${n0(x.values.leads?.total)}</td><td class="n">${esc(price(x.values.ads?.cpr, x.values.ads?.currency))}</td><td class="n">${n0(x.values.insta?.followersEnd)}</td></tr>`).join('')}</table><div class="unit">«—» — нет данных за месяц</div></div>
    <div class="card"><h2>Что ещё случилось</h2><table class="t"><tr><td>Брони за месяц</td><td class="n">${n0(v.sales?.bookings)}</td><td>Снято броней</td><td class="n">${n0(v.sales?.unbooked)}</td><td>Отмен продаж</td><td class="n">${n0(v.sales?.cancels)}</td></tr>
      <tr><td>Средняя цена м² сделок</td><td class="n">${v.sales?.ppm ? `${n0(v.sales.ppm)} ₸` : '—'}</td><td>Осталось квартир</td><td class="n">${n0(v.stock?.left)}</td><td>Вне шахматки (не выручка)</td><td class="n">${v.extra ? esc(mln(v.extra)) : '—'}</td></tr></table></div>
    <div class="foot">Было — ${esc(F.prev ? monthLabel(F.prev.key) : 'нет прошлого месяца')}; среднее — обычный месяц за год до этого (сколько месяцев известно). Продажи — за вычетом отмен; деньги — полученные по шахматке; цена переписки — только реклама на переписки и форму-заявку.</div>
  </section>`
  const ch = F.charts
  const p2 = `<section class="page">
    ${head('Отчёт месяца', name, pg(2))}
    <h1>Динамика по всем месяцам</h1>
    <div class="mut" style="font-size:8.5pt">Синим — ${esc(monthName(F.key))}; бледным — остальные месяцы; * месяц ещё идёт; «н/д» — нет данных за месяц. Всего в истории ${n0(total)} ${plural(total, 'месяц', 'месяца', 'месяцев')}.</div>
    <div class="row r2">${chartCard('Продажи', 'квартир', ch.sales)}${chartCard('Деньги получены', 'млн ₸', ch.money, { fmt: n1, color: C.green })}</div>
    <div class="row r2">${chartCard('Новые клиенты', 'из CRM', ch.leads)}${chartCard('Цена переписки', cur$(c), ch.cpr, { fmt: n2, color: C.navy })}</div>
    <div class="row r2">${chartCard('Подписчики на конец месяца', 'Instagram', ch.followers, { color: C.navy })}${chartCard('Расход на рекламу', 'тыс. ₸ по курсу дня', ch.spend, { color: C.navy })}</div>
    <div class="foot">Расход в тенге — по курсу Нацбанка на каждый день расхода. Подписчики на конец месяца — по счётчику офиса, раньше — расчётом от подписок и отписок.${F.complete.length ? ` Полнота: ${esc(F.complete.join('; '))}.` : ''}</div>
  </section>`
  const convRows = F.conv.slice(0, 7)
  const refRows = F.refusals.map((r) => `<tr><td>${esc(r.reason)}</td><td class="n">${n0(r.count)}</td><td class="n"><b>${r.share}%</b></td><td class="n">${r.prevShare == null ? '<span class="mut">—</span>' : `${r.prevShare}% ${r.share > r.prevShare ? '<span class="bad">↑</span>' : r.share < r.prevShare ? '<span class="good">↓</span>' : '→'}`}</td></tr>`).join('')
  const p3 = `<section class="page">
    ${head('Отчёт месяца', name, pg(3))}
    <h1>Кто покупает и откуда</h1>
    <div class="row r2">
      <div class="card"><h2>Откуда покупатели <small>${esc(monthName(F.key))}</small></h2>${hbars(items(F.buyers), { color: C.green, empty: v.sales?.net === 0 ? 'продаж не было' : 'нет данных' })}</div>
      <div class="card"><h2>Откуда клиенты <small>${esc(monthName(F.key))}</small></h2>${hbars(items(F.sources))}</div>
    </div>
    <div class="card"><h2>Конверсия в продажу по источникам <small>за всё время CRM</small></h2>${convRows.length ? `<table class="t"><tr><th>Источник</th><th class="n">Клиентов</th><th class="n">Купили</th><th class="n">Конверсия</th></tr>${convRows.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${n0(x.leads)}</td><td class="n">${n0(x.bought)}</td><td class="n">${x.conv == null ? '—' : `${n1(x.conv)}%`}</td></tr>`).join('')}</table>` : '<div class="nodata">нет данных</div>'}</div>
    <div class="row r3">
      <div class="card"><h2>Комнатность</h2>${hbars(items(F.rooms), { color: C.navy, empty: 'продаж не было' })}</div>
      <div class="card"><h2>Этажи</h2>${hbars(items(F.floors), { color: C.navy, empty: 'продаж не было' })}</div>
      <div class="card"><h2>Оплата</h2>${hbars(items(F.pay), { color: C.navy, empty: 'продаж не было' })}</div>
    </div>
    <div class="row r32">
      <div class="card"><h2>Почему отказываются <small>доля причин и как было</small></h2>${refRows ? `<table class="t"><tr><th>Причина</th><th class="n">Отказов</th><th class="n">Доля</th><th class="n">Прошлый месяц</th></tr>${refRows}</table>` : `<div class="nodata">${F.lost === 0 ? 'отказов не было' : 'нет данных'}</div>`}</div>
      <div class="card"><h2>Своими словами</h2>${F.explained.length ? `<ul class="list">${F.explained.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="nodata">заметок менеджеров к отказам нет — только причины из CRM</div>'}</div>
    </div>
    <div class="foot">Покупатели — сделки шахматки; источник — из CRM, если клиент там есть, иначе «Источник неизвестен». Клиенты — новые настоящие лиды CRM (без тестов и спама). Отказы — по дате отказа; «своими словами» — пересказ заметок менеджеров без имён и телефонов.</div>
  </section>`
  const dec = F.decisions.slice(0, 10).map((d) => `<tr><td>${esc(short(d.title, 70))}</td><td>${esc(names(d.from))}</td><td class="${d.verdict === 'worked' ? 'good' : d.verdict === 'not' ? 'bad' : 'mut'}">${esc(d.word)}</td><td class="n">${d.result ? `${esc(d.result.metric || '')}: ${esc(String(d.result.base ?? '—'))} → ${esc(String(d.result.value ?? '—'))}` : ''}</td></tr>`).join('')
  const p4 = `<section class="page">
    ${head('Отчёт месяца', name, pg(4))}
    <h1>Следующий месяц</h1>
    <div class="card"><h2>Советы на месяц</h2>${adviceCards(w.advice, names, 'a5')}</div>
    <div class="card"><h2>5 правил месяца <small>команда получает их в каждой задаче</small></h2>${w.rules.length ? `<ol class="list">${w.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<div class="nodata">правил нет</div>'}</div>
    <div class="card"><h2>Как сработали советы прошлого месяца</h2>${w.checked ? `<p style="margin:0 0 4px">${esc(w.checked)}</p>` : ''}${dec ? `<table class="t"><tr><th>Решение</th><th>Кто</th><th>Итог</th><th class="n">Замер</th></tr>${dec}</table>` : '<div class="nodata">решений с замером в прошлом месяце нет</div>'}</div>
    ${F.complete.length || F.revisions.length ? `<div class="card"><h2>Полнота данных</h2><ul class="list">${F.complete.map((x) => `<li>${esc(x)}</li>`).join('')}${F.revisions.map((r) => `<li>Исправление: ${esc(r.field)} было ${esc(String(r.was))} → стало ${esc(String(r.now))} (${esc(ru(r.at.slice(0, 10)))}); в отчёте — закрытое значение</li>`).join('')}</ul></div>` : ''}
    <div class="foot">Итог решения — наблюдаемое изменение показателя через неделю после выполнения, а не доказанная причина. Закрытый месяц не переписывается: если цифра позже изменилась, это записано как исправление.</div>
  </section>`
  return doc(`Отчёт месяца ${name}`, [p1, p2, p3, p4])
}

export function monthMarkdown(F, w, names) {
  const name = monthLabel(F.key)
  return `${[`# Отчёт месяца: ${name}`, '', `**${w.phrase}**`, '', '## Главные цифры', '| показатель | месяц | прошлый | среднее |', '|---|---|---|---|',
    ...F.kpis.map((k) => `| ${k.label} | ${k.now == null ? 'нет данных' : k.fmt(k.now)} | ${k.prev == null ? '—' : k.fmt(k.prev)} | ${k.avg == null ? '—' : k.fmt(k.avg)} |`),
    ...(F.goalRows.length ? ['', '## Цели месяца', ...F.goalRows.map((g) => `- ${g.label}: план ${g.fmt(g.plan)}, факт ${g.fact == null ? 'нет данных' : g.fmt(g.fact)}`)] : []),
    '', '## Выводы', ...w.conclusions.map((x, i) => `${i + 1}. ${x}`),
    '', '## Откуда покупатели', ...(F.buyers.length ? F.buyers.map(([k, x]) => `- ${k}: ${x}`) : ['- нет данных']),
    '', '## Почему отказываются', ...(F.refusals.length ? F.refusals.map((r) => `- ${r.reason}: ${r.share}%${r.prevShare != null ? ` (было ${r.prevShare}%)` : ''}`) : ['- нет данных']), ...F.explained.map((x) => `- «${x}»`),
    '', '## Советы на месяц', ...w.advice.map((a, i) => `${i + 1}. ${a.who === 'owner' ? 'Владелец' : names(a.who)}: ${a.what}${a.expect ? ` — ждём: ${a.expect}` : ''}`),
    '', '## 5 правил месяца', ...w.rules.map((x, i) => `${i + 1}. ${x}`),
    ...(w.checked ? ['', '## Советы прошлого месяца', w.checked] : []),
    ...(F.complete.length ? ['', '## Полнота данных', ...F.complete.map((x) => `- ${x}`)] : []),
  ].join('\n')}\n`
}

// Excel: every month as a row, then sources, buyers, refusals and revisions
export function monthXlsx(file, book) {
  const list = allMonths(book)
  const H = (v) => ({ v, s: 'h' })
  const num = (v, d = 0) => (v == null ? '' : { v: Math.round(v * 10 ** d) / 10 ** d, s: d ? 'n1' : 'n0' })
  const cur = list.find((m) => m.values.ads?.currency)?.values.ads.currency || 'USD'
  const label = (m) => `${monthLabel(m.key)}${m.partial ? ` (по ${ru(m.to)}, неполный)` : ''}`
  const main = [[{ v: 'REVION · все месяцы', s: 't' }], [{ v: 'Продажи — за вычетом отмен; деньги — полученные по шахматке; вне шахматки — не выручка. Пусто — нет данных (не ноль).', s: 'sub' }], [],
    ['Месяц', 'Продажи', 'Отмены', 'Новые брони', 'Снято броней', 'Деньги получены, ₸', 'Вне шахматки, ₸', 'Цена м² сделок, ₸', 'Осталось квартир', 'Новые клиенты', 'Консультации', 'Отказы', `Расход на рекламу, ${cur}`, 'Расход, ₸', 'Переписки и заявки', `Цена переписки, ${cur}`, 'Подписчики на конец', 'Подписались', 'Отписались', 'Охват (сумма по дням)', 'Посещения профиля', 'Публикации', 'Reels', 'Сторис', 'Полнота данных'].map(H),
    ...list.map((m) => { const v = m.values; return [label(m), num(v.sales?.net), num(v.sales?.cancels), num(v.sales?.bookings), num(v.sales?.unbooked), num(v.money?.received), num(v.extra || null), num(v.sales?.ppm), num(v.stock?.left), num(v.leads?.total), num(v.leads?.consult), num(v.leads?.lost), num(v.ads?.spend, 1), num(v.ads?.spendKzt), num(v.ads ? v.ads.chats + v.ads.forms : null), num(v.ads?.cpr, 1), num(v.insta?.followersEnd), num(v.insta?.follows), num(v.insta?.unfollows), num(v.insta?.reach), num(v.insta?.profileViews), num(v.insta?.posts), num(v.insta?.reels), num(v.insta?.stories), Object.values(m.complete || {}).join('; ')] })]
  const cross = (title, get) => {
    const keys = [...new Set(list.flatMap((m) => Object.keys(get(m) || {})))]
    return [[{ v: title, s: 't' }], [], [H('Месяц'), ...keys.map(H)], ...list.filter((m) => get(m)).map((m) => [label(m), ...keys.map((k) => num(get(m)[k] ?? 0))])]
  }
  const revs = [[{ v: 'Исправления закрытых месяцев', s: 't' }], [{ v: 'Закрытый месяц не переписывается: если цифра позже посчиталась иначе, она записана здесь, а в отчётах остаётся закрытое значение.', s: 'sub' }], [], [H('Месяц'), H('Что'), H('Было'), H('Стало'), H('Когда')],
    ...list.flatMap((m) => (m.revisions || []).map((r) => [monthLabel(m.key), r.filled ? `${r.field} (дополнено)` : r.field, r.filled ? '' : num(r.was), r.filled ? '' : num(r.now), ru(String(r.at).slice(0, 10))]))]
  return writeXlsx(file, [
    { name: 'По месяцам', cols: [26, 9, 8, 10, 10, 16, 14, 14, 10, 11, 11, 8, 13, 14, 12, 12, 13, 11, 11, 14, 13, 10, 8, 8, 60], rows: main },
    { name: 'Источники клиентов', cols: [26, 16, 16, 16, 16, 16, 16, 16, 16], rows: cross('Новые клиенты по источникам', (m) => m.values.leads?.sources) },
    { name: 'Покупатели', cols: [26, 16, 16, 16, 16, 16, 16, 16], rows: cross('Покупатели по источникам', (m) => m.values.buyers?.sources) },
    { name: 'Отказы', cols: [26, 18, 18, 18, 18, 18, 18, 18, 18], rows: cross('Отказы по причинам', (m) => m.values.leads?.refusals) },
    { name: 'Исправления', cols: [18, 22, 14, 14, 14], rows: revs },
  ])
}

// html → PDF next to it; the html is removed
export async function renderPdf(browser, file, html) {
  fs.writeFileSync(file, html, 'utf8')
  try { return await htmlToPdf(browser, file) } finally { fs.rmSync(file, { force: true }) }
}

// the portal page «Отчёты»: weeks and months with their key numbers; no PDF links for weeks without one
export function reportsArchive(book, weeks = weeksBook()) {
  const months = allMonths(book).map((m) => {
    const v = m.values
    return { key: m.key, label: monthLabel(m.key), partial: !!m.partial, backfilled: !!m.backfilled, sales: v.sales?.net ?? null, money: v.money?.received ?? null, extra: v.extra || 0, leads: v.leads?.total ?? null, cpr: v.ads?.cpr ?? null, currency: v.ads?.currency || null, spendKzt: v.ads?.spendKzt ?? null, followers: v.insta?.followersEnd ?? null, bookings: v.sales?.bookings ?? null, complete: Object.values(m.complete || {}), revisions: (m.revisions || []).filter((r) => !r.filled).length, report: m.report || null }
  })
  const list = Object.entries(weeks.weeks || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 26).map(([monday, w]) => ({ monday, ...w }))
  return { months, weeks: list }
}

export { prevMonth }
