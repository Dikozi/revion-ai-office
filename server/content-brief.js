// The sales brief behind Алия's content plan (owner's decision 20.11.2026): every story and post is argued by numbers.
// Plain code, no Claude: numbered facts «Ф1…» from the chessboard, the CRM, the ad archive and Instagram are written into
// her content-plan task (_данные/бриф-продаж.md + .json). She cites them in контент-план.json; when the plan is done the
// office checks every number of her «why» against the cited facts (checkPlan) and the pack shows the argument (argOf).
// A source that did not answer gives no fact at all — never a 0, never a guess.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { readLog, salesIn } from './sales-rules.js'
import { crmSummary, realLeads, leadChannel } from './crm.js'
import { kindOf, kindsOf } from './ads-archive.js'
import { adPortrait, regionsOf, hoursOf, placesOf, videosOf, promos } from './ads-more.js'

const AUDIENCE = path.join(P.data, 'instagram', 'audience.json')
const AUD_METRICS = { followers: 'follower_demographics', reached: 'reached_audience_demographics', engaged: 'engaged_audience_demographics' }
const AUD_RU = { followers: 'Подписчики Instagram', reached: 'Охваченные в Instagram', engaged: 'Вовлечённые в Instagram (лайки, ответы, сохранения)' }
const FRAME_RU = { last_90_days: 'последние 90 дней', this_month: 'этот месяц', last_30_days: 'последние 30 дней', this_week: 'эта неделя', '': 'за всё время' }
const GENDER = { F: 'женщины', M: 'мужчины', U: 'неизвестно', f: 'женщины', m: 'мужчины', u: 'неизвестно' }
const AUD_EVERY = 6.5 * 864e5

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const ru = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const int = (v) => Math.round(v).toLocaleString('ru-RU')
const dec = (v) => (Math.round(v * 10) / 10).toLocaleString('ru-RU')
const mln = (v) => `${dec(v / 1e6)} млн`
const tys = (v) => `${int(v / 1000)} тыс.`
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const money = (v) => (v >= 100 ? int(v) : (Math.round(v * 100) / 100).toLocaleString('ru-RU'))
const median = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

// ---------- numbers: the same reader for the facts and for Алия's words ----------
// «20,5 млн», «412 тыс.», «1 489», «22%», «4,5» → [{ v, scaled }]; a digit glued to a letter (Ф3, Т2-07) is not a number
const NUM_RE = /(?<![\p{L}\d])(?<!\p{L}\d*[-–])(\d{1,3}(?:[   ]\d{3})+(?!\d)|\d+)(?:[.,](\d+))?(?:\s?(млрд|млн|тыс|%))?/gu
export function numbersIn(text) {
  const out = []
  for (const m of String(text || '').matchAll(NUM_RE)) {
    const v = Number(`${m[1].replace(/\D/g, '')}${m[2] ? `.${m[2]}` : ''}`)
    if (!Number.isFinite(v)) continue
    out.push({ v, scaled: v * ({ млрд: 1e9, млн: 1e6, тыс: 1e3 }[m[3]] || 1) })
  }
  return out
}
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
// a number of the words is right when it is a number of the facts, as written or rounded
const same = (w, f) => [w.v, w.scaled].some((x) => [f.v, f.scaled, Math.round(f.v), Math.round(f.v * 10) / 10, Math.round(f.scaled)].some((y) => near(x, y)))
// a «why» without a single number is not an argument: it must cite at least one number of its facts
export function numbersOk(text, facts) {
  const pool = facts.flatMap((f) => numbersIn(f.text))
  const own = numbersIn(text)
  return own.length > 0 && own.every((w) => pool.some((f) => same(w, f)))
}
const normId = (v) => { const m = String(v ?? '').match(/(\d+)/); return m ? `Ф${Number(m[1])}` : null }
const idsIn = (text) => [...String(text || '').matchAll(/[ФфFf]\s?-?(\d+)/g)].map((m) => `Ф${Number(m[1])}`)
// «(Ф1, Ф3)» means nothing to the owner
const dropIds = (text) => String(text || '').replace(/\s*\(?\s*[ФфFf]\s?-?\d+(?:\s*[,;и]\s*[ФфFf]?\s?-?\d+)*\s*\)?/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim()

// ---------- Instagram audience portrait: account-wide, cached for a week (a handful of calls) ----------

const busy = (e) => [1, 2, 4, 17, 32, 80002].includes(e?.graphCode) || /ограничила|timeout|timed out|aborted|fetch failed|ECONN|EAI_AGAIN|network/i.test(e?.message || '')
async function askAudience(meta, ig, metric, breakdown, frames) {
  let error = 'Meta не дала цифр'
  for (const tf of frames) {
    try {
      const j = await meta.api(`${ig}/insights`, { metric, period: 'lifetime', metric_type: 'total_value', breakdown, ...(tf ? { timeframe: tf } : {}) })
      const b = j.data?.[0]?.total_value?.breakdowns?.[0]
      const keys = b?.dimension_keys || breakdown.split(',')
      const rows = (b?.results || []).map((r) => {
        const d = Object.fromEntries(keys.map((k, i) => [k, String(r.dimension_values?.[i] ?? '')]))
        const label = [d.age, d.gender ? GENDER[d.gender] || d.gender : '', d.city ? d.city.split(',')[0].trim() : ''].filter(Boolean).join(' · ')
        return [label, Number(r.value)]
      }).filter(([l, v]) => l && Number.isFinite(v) && v > 0)
      if (rows.length) return { rows, frame: tf || '' }
      error = 'Meta не дала цифр (мало данных за период)'
    } catch (e) {
      error = clip(e.message, 120)
      if (busy(e)) break
      if (e.graphCode === 100 && !/timeframe/i.test(e.message)) return { error, unsupported: true }
    }
  }
  return { error }
}

// data/instagram/audience.json: { fetchedAt, frames: { key: timeframe }, unsupported: ['engaged:age,gender'], groups: { followers|reached|engaged: { ageGender|age|gender|city: [[label, n]], frame } }, errors }
export async function refreshAudience(meta, { force = false, now = Date.now(), file = AUDIENCE } = {}) {
  const old = read(file, null)
  if (!force && old?.fetchedAt && now - Date.parse(old.fetchedAt) < AUD_EVERY) return old
  const ig = meta?.m?.igUserId
  if (!meta?.m?.token || !ig || meta.error) return old
  const out = { fetchedAt: new Date(now).toISOString(), frames: { ...(old?.frames || {}) }, unsupported: [...(old?.unsupported || [])], groups: {}, errors: {} }
  for (const [key, metric] of Object.entries(AUD_METRICS)) {
    // the timeframe that worked last time goes first: usually one call per breakdown
    const base = key === 'followers' ? [null, 'this_month'] : ['last_90_days', 'this_month']
    const known = out.frames[key] === undefined ? [] : [out.frames[key] || null]
    const frames = [...new Set([...known, ...base])]
    const g = {}
    for (const bd of ['age,gender', 'city']) {
      let r = out.unsupported.includes(`${key}:${bd}`) ? { error: 'Meta не даёт такую разбивку' } : await askAudience(meta, ig, metric, bd, frames)
      if (r.unsupported) out.unsupported.push(`${key}:${bd}`)
      // the timeframe that worked goes first for the next breakdown too
      const keep = (f) => frames.splice(0, frames.length, ...new Set([f || null, ...frames]))
      if (r.rows) { g[bd === 'city' ? 'city' : 'ageGender'] = r.rows; g.frame = r.frame; out.frames[key] = r.frame; keep(r.frame); continue }
      out.errors[`${key}:${bd}`] = r.error
      // age and gender together refused: each one alone
      if (bd === 'age,gender') for (const one of ['age', 'gender']) { r = await askAudience(meta, ig, metric, one, frames); if (r.rows) { g[one] = r.rows; g.frame = r.frame; out.frames[key] = r.frame; keep(r.frame) } }
    }
    // what Meta did not give this time stays from the last time, marked with its date
    for (const part of ['ageGender', 'age', 'gender', 'city']) if (!g[part] && old?.groups?.[key]?.[part]) { g[part] = old.groups[key][part]; g.from = old.groups[key].from || old.fetchedAt; g.frame ??= old.groups[key].frame }
    out.groups[key] = g
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 1))
  fs.renameSync(`${file}.tmp`, file)
  return out
}

// ---------- the facts ----------

// inputs (each may be missing): { apartments, changes, crm: { leads, words }, ads (archive.json), posts (posts.json), stories, audience,
// history (Instagram days of history.json, for the follower estimate of promotions), cfg }
export function briefFrom(inp = {}, now = Date.now()) {
  const facts = [], missing = []
  const add = (area, text, data) => facts.push({ id: `Ф${facts.length + 1}`, area, text, nums: numbersIn(text).map((x) => x.v), ...(data ? { data } : {}) })
  const today = ymd(new Date(now))
  const back = (n) => ymd(new Date(now - n * 864e5))
  const cfg = inp.cfg || {}

  // 1. stock and pace (one sales rule with the portal: net of cancellations, client moves left out)
  const flats = inp.apartments
  if (Array.isArray(flats) && flats.length) {
    const byNum = new Map(flats.map((x) => [x.number, x]))
    const log = Array.isArray(inp.changes) ? readLog(inp.changes) : null
    const free = flats.filter((x) => x.status === 'Свободна')
    const win = (n) => {
      if (!log) return null
      const s = salesIn(log, back(n), today)
      const rooms = {}
      for (const c of s.deals) { const r = byNum.get(c.number)?.rooms; rooms[r] = (rooms[r] || 0) + 1 }
      for (const c of s.cancels) { const r = byNum.get(c.number)?.rooms; rooms[r] = (rooms[r] || 0) - 1 }
      return { net: s.net, deals: s.deals, rooms }
    }
    const w30 = win(30), w90 = win(90)
    add('stock', `Свободно ${free.length} из ${flats.length} квартир${w90 ? `; продано за 30 дн. — ${w30.net}, за 90 дн. — ${w90.net} (за вычетом отмен)` : ''}.`, { free: free.length, flats: flats.length, sold30: w30?.net ?? null, sold90: w90?.net ?? null })
    const ppm = (x) => x.price_per_m2_kzt || (x.price_kzt && x.area_m2 ? x.price_kzt / x.area_m2 : null)
    const rooms = [...new Set(flats.map((x) => x.rooms).filter((r) => r != null))].sort((a, b) => a - b)
    for (const r of rooms) {
      const f = free.filter((x) => x.rooms === r)
      const s90 = w90 ? w90.rooms[r] || 0 : null, s30 = w30 ? w30.rooms[r] || 0 : null
      if (!f.length && !s90) continue
      const p = f.map(ppm).filter(Boolean), prices = f.map((x) => x.price_kzt).filter(Boolean)
      const parts = [`${r}-комн.: свободно ${f.length}`]
      if (s90 != null) parts.push(`продано за 90 дн. — ${s90} (за 30 дн. — ${s30})`)
      if (s90 > 0 && f.length) parts.push(`при таком темпе остаток уйдёт за ≈${dec(f.length / (s90 / 3))} мес.`)
      else if (s90 === 0 && f.length) parts.push('за 90 дней ни одной продажи')
      if (p.length) parts.push(`средняя цена свободных — ${tys(p.reduce((t, v) => t + v, 0) / p.length)} ₸/м²`)
      if (prices.length) parts.push(`от ${mln(Math.min(...prices))} ₸`)
      add('stock', `${parts.join('; ')}.`, { rooms: r, free: f.length, sold90: s90, sold30: s30 })
    }
    // floors: only when the free flats really spread over several bands
    const bands = {}
    for (const x of free.filter((x) => x.floor > 0)) { const b = Math.floor((x.floor - 1) / 3); (bands[b] ||= []).push(x) }
    const bandList = Object.entries(bands).sort((a, b) => a[0] - b[0])
    if (bandList.length >= 2) {
      add('stock', `Свободные по этажам: ${bandList.map(([b, list]) => { const p = list.map(ppm).filter(Boolean); return `${b * 3 + 1}–${b * 3 + 3} эт. — ${list.length}${p.length ? ` (≈${tys(p.reduce((t, v) => t + v, 0) / p.length)} ₸/м²)` : ''}` }).join(', ')}.`)
    }
    const cheap = free.filter((x) => x.price_kzt).sort((a, b) => a.price_kzt - b.price_kzt)[0]
    if (cheap) add('stock', `Самый доступный вход: ${cheap.rooms}-комн.${cheap.area_m2 ? ` ${dec(cheap.area_m2)} м²` : ''} — ${mln(cheap.price_kzt)} ₸.`)
    const hv = cfg.handover
    if (hv?.date && Date.parse(hv.date) > now) {
      const months = (Date.parse(`${hv.date}T23:59:59+05:00`) - now) / (30.44 * 864e5)
      const proj = w90?.net > 0 ? Math.min(free.length, Math.round((w90.net / 3) * months)) : null
      add('stock', `Сдача дома — ${hv.label || ru(hv.date)}; до сдачи ≈${Math.round(months)} мес.${proj != null ? `; при темпе последних 90 дней к сдаче продадим ≈${proj} из ${free.length} свободных` : ''}.`)
    }
    // 2. how they pay: the deals of 90 days by their status now, and all sold flats
    if (w90?.deals.length) {
      const n = w90.deals.length, k = w90.deals.filter((c) => byNum.get(c.number)?.status === 'Рассрочка').length
      add('pay', `Из ${n} продаж за 90 дн. в рассрочку — ${k}${n >= 3 ? ` (${pct(k, n)}%)` : ''}, полной оплатой — ${n - k}.`, { n, installment: k })
    }
    const sold = flats.filter((x) => ['Рассрочка', 'Продана'].includes(x.status))
    if (sold.length) {
      const k = sold.filter((x) => x.status === 'Рассрочка').length
      add('pay', `Сейчас в рассрочке ${k} из ${sold.length} проданных квартир (${pct(k, sold.length)}%).`)
    }
    if (!log) missing.push('Журнал статусов шахматки не ответил — темпа продаж по комнатам нет.')
  } else missing.push('Шахматка не ответила — остатков, цен и темпа продаж в брифе нет.')

  // 3. CRM, last 60 days, real leads of this project only
  const leads = inp.crm?.leads ? realLeads(inp.crm.leads).filter((l) => l.project !== 'park') : null
  if (leads?.length) {
    const s = crmSummary(leads, { from: back(59), to: today })
    if (s.leads) {
      const steps = s.funnel.slice(1).map((x) => `${x.label.toLowerCase()} — ${x.count} (${pct(x.count, s.leads)}%)`)
      add('crm', `Обращений в CRM за 60 дн.: ${s.leads}${steps.length ? `; ${steps.join('; ')}` : ''}.`)
      const lost = s.refusals.reduce((t, [, v]) => t + v, 0)
      const words = inp.crm.words || {}
      const lostLeads = leads.filter((l) => l.stage === 'lost' && l.created_at && ymd(new Date(l.created_at)) >= back(59))
      const real = s.refusals.filter(([k]) => !['не указано', 'Не целевой'].includes(k) && !/^Другое/.test(k))
      for (const [reason, n] of real.slice(0, 3)) {
        const said = lostLeads.filter((l) => l.refusal_reason === reason).map((l) => words[l.id]?.words).filter(Boolean).slice(0, 2)
        add('objection', `Отказ «${reason}»: ${n} из ${lost} отказов за 60 дн. (${pct(n, lost)}%)${said.length ? `; своими словами: ${said.map((w) => `«${clip(w, 80)}»`).join('; ')}` : ''}.`, { reason, n, lost })
      }
      const none = s.refusals.find(([k]) => k === 'не указано')?.[1] || 0
      if (none && lost) missing.push(`Причина отказа не указана в CRM у ${none} из ${lost} отказов — по ним возражений не знаем.`)
      const ch = s.sources.slice(0, 4)
      if (ch.length) add('crm', `Откуда пишут (60 дн.): ${ch.map(([k, v]) => `${k} — ${pct(v, s.leads)}% (${v})`).join(', ')}.`)
    } else missing.push('В CRM нет обращений за 60 дней.')
  } else missing.push(!inp.crm ? 'CRM не подключена — причин отказа и каналов нет.' : inp.crm.leads ? 'CRM пустая — причин отказа и каналов нет.' : 'CRM не ответила — причин отказа и каналов нет.')

  // 4. who writes from the chat ads, last 90 days (Meta's age × gender cuts of the ad archive)
  const a = inp.ads
  let adTop = null
  if (a?.v === 2 && Array.isArray(a.cuts?.['age:last_90d'])) {
    const kinds = Object.fromEntries(Object.entries(a.ads || {}).map(([id, x]) => [id, kindOf(x.set, x.total)]))
    const by = {}
    for (const [id, label, spend, , , chats] of a.cuts['age:last_90d']) {
      if (kinds[id] !== 'chat') continue
      const g = (by[label] ||= { spend: 0, chats: 0 })
      g.spend += spend || 0
      g.chats += chats || 0
    }
    const list = Object.entries(by).filter(([l, g]) => g.chats > 0 && !/неизвестно/.test(l))
    const total = list.reduce((t, [, g]) => t + g.chats, 0)
    const cur = a.currency || ''
    if (total) {
      const top = [...list].sort((x, y) => y[1].chats - x[1].chats).slice(0, 2)
      adTop = { label: top[0][0], share: pct(top[0][1].chats, total) }
      add('ads', `По рекламе на переписки за 90 дн. чаще всех пишут: ${top.map(([l, g]) => `${l} — ${g.chats} переписок (${pct(g.chats, total)}%), ${money(g.spend / g.chats)} ${cur} за переписку`).join('; ')}.`)
      const enough = list.filter(([, g]) => g.chats >= Math.max(5, total * 0.05)).sort((x, y) => x[1].spend / x[1].chats - y[1].spend / y[1].chats)[0]
      if (enough && enough[0] !== top[0][0]) add('ads', `Дешевле всего переписка из рекламы (90 дн.): ${enough[0]} — ${money(enough[1].spend / enough[1].chats)} ${cur} (${enough[1].chats} переписок).`)
      const sex = { женщины: { spend: 0, chats: 0 }, мужчины: { spend: 0, chats: 0 } }
      for (const [l, g] of list) for (const k of Object.keys(sex)) if (l.includes(k)) { sex[k].spend += g.spend; sex[k].chats += g.chats }
      if (sex.женщины.chats && sex.мужчины.chats) add('ads', `Пишут по рекламе (90 дн.): женщины — ${pct(sex.женщины.chats, total)}% (${money(sex.женщины.spend / sex.женщины.chats)} ${cur} за переписку), мужчины — ${pct(sex.мужчины.chats, total)}% (${money(sex.мужчины.spend / sex.мужчины.chats)} ${cur}).`)
    } else missing.push('Реклама на переписки за 90 дней не дала разбивки по возрасту и полу.')
  } else missing.push('Архив рекламы ещё не собран — кто пишет из рекламы, неизвестно.')

  // 4b. the same archive: who really talks (live conversations), where from and when; placements; video; promotions
  if (a?.v === 2) {
    const kinds = kindsOf(a), cur = a.currency || ''
    const sh = (v) => (v == null ? 0 : v)
    const chatsW = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'переписка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'переписки' : 'переписок'}`
    const pt = adPortrait(a, kinds)
    if (pt?.deep) {
      const top = pt.rows.filter((g) => g.deep > 0).slice(0, 2)
      add('ads', `Живые разговоры (клиент написал 3+ сообщения) по рекламе за 90 дн.: ${pt.deep} из ${pt.chats} переписок (${pt.live}%); больше всего живых — ${top.map((g) => `${g.label} — ${g.deep} (${g.shareDeep}% живых), ${money(g.cpq)} ${cur} за живой`).join('; ')}.`)
      const cheap = pt.rows.filter((g) => g.cpq != null && g.deep >= Math.max(3, pt.deep * 0.05)).sort((x, y) => x.cpq - y.cpq)[0]
      if (cheap && cheap.label !== top[0]?.label) add('ads', `Дешевле всего живой разговор (90 дн.): ${cheap.label} — ${money(cheap.cpq)} ${cur} (${cheap.deep} живых; живыми становятся ${cheap.live}% переписок).`)
      const [f, m] = ['женщины', 'мужчины'].map((k) => pt.sex.find((g) => g.label === k))
      if (f?.deep && m?.deep) add('ads', `Живые разговоры по полу (90 дн.): женщины — ${f.shareDeep}% живых (${money(f.cpq)} ${cur} за живой), мужчины — ${m.shareDeep}% (${money(m.cpq)} ${cur}).`)
    } else if (pt?.chats) missing.push('Живых разговоров (3+ сообщения) по рекламе за 90 дней нет — «кто реально разговаривает» не построить.')
    const rg = regionsOf(a, kinds)
    if (rg?.chats) {
      const others = rg.rows.filter((g) => g.label !== 'Астана').slice(0, 2)
      add('ads', `Откуда пишут по рекламе (90 дн.): Астана — ${sh(rg.astana.shareChats)}% переписок и ${sh(rg.astana.shareDeep)}% живых; другие регионы — ${sh(rg.rest.shareChats)}% и ${sh(rg.rest.shareDeep)}%${others.length ? ` (больше всего: ${others.map((g) => `${g.label} — ${chatsW(g.chats)}`).join(', ')})` : ''}.`)
    } else missing.push(rg ? 'Реклама на переписки за 90 дней не дала разбивки по регионам.' : 'Разбивки рекламы по регионам ещё нет — архив соберёт её ночью.')
    const hr = hoursOf(a, kinds, cfg.managerHours, a.tz)
    if (hr?.chats && hr.known) {
      add('ads', `Когда пишут по рекламе (90 дн., время Астаны): вне часов менеджера (${hr.hours}) — ${hr.outside}% переписок${hr.deep ? ` и ${sh(hr.outsideDeep)}% живых` : ''}, с учётом выходных ≈${hr.outsideWeek}%; чаще всего пишут в ${hr.peak.map((h) => `${h}–${h + 1} ч`).join(', ')}.`)
    } else missing.push(!hr ? 'Разбивки рекламы по часам ещё нет — архив соберёт её ночью.' : !hr.chats ? 'Реклама на переписки за 90 дней не дала разбивки по часам.' : 'Часы работы менеджера не заданы — с ними не сравнить.')
    const pl = placesOf(a, kinds)
    const plr = (pl?.rows || []).filter((g) => g.chats > 0)
    if (plr.length >= 2) {
      add('place', `Места показа, реклама на переписки (90 дн.): ${plr.map((g) => `${g.label} — ${chatsW(g.chats)} по ${money(g.cpc)} ${cur}${g.deep ? `, живой по ${money(g.cpq)} ${cur}` : ', живых нет'}`).join('; ')}.`)
      const best = plr.filter((g) => g.deep >= 3).sort((x, y) => x.cpq - y.cpq)
      if (best.length >= 2) add('place', `Дешевле всего живой разговор — ${best[0].label}: ${money(best[0].cpq)} ${cur} против ${money(best.at(-1).cpq)} ${cur} (${best.at(-1).label}).`)
    } else if (pl) missing.push('Реклама на переписки за 90 дней шла меньше чем в двух местах показа — ленту, Reels и сторис не сравнить.')
    const vd = videosOf(a, kinds, { top: 3 })
    const vr = (vd?.rows || []).filter((v) => v.hook != null)
    for (const v of vr) add('video', `Видео в рекламе «${clip(v.name, 50)}» (за всё время): начало цепляет ${v.hook}% показов (${int(v.v3)} просмотров 3 сек. из ${int(v.impr)})${v.done != null ? `; до конца досматривают ${v.done}% начавших` : ''}${v.avg ? `; в среднем ${dec(v.avg)} с` : ''}.`)
    if (vd && !vr.length) missing.push(vd.rows.length ? 'У видео в рекламе Meta не дала просмотров 3 сек. — «цепляет ли начало» не посчитать.' : 'Видео в рекламе за 90 дней не крутились (или меньше 500 показов).')
    const pr = promos(a, kinds, inp.history || {})
    const pro = (pr?.rows || []).filter((x) => x.follows != null && x.last && x.last >= back(90))
    for (const x of pro.slice(0, 3)) add('promo', `Продвижение «${clip(x.title, 50)}» (${ru(x.first)}–${ru(x.last)}): ${x.follows} подписчиков${x.cpf != null ? ` по ${money(x.cpf)} ${cur}` : ''} (${x.followsSrc === 'meta' ? 'посчитала Meta' : 'оценка'}); посещений профиля ${x.visits}${x.visitsSrc === 'clicks' ? ' (по кликам)' : ''}${x.reach ? `, охват ${int(x.reach)}` : ''}, расход ${money(x.spend)} ${cur}.`)
    if (pr && !pro.length) missing.push(pr.rows.some((x) => x.last >= back(90)) ? 'У продвижений за 90 дней подписчики неизвестны (нет посещений профиля или истории Instagram за их дни).' : 'Продвижений постов за 90 дней не было.')
  }

  // 5. the Instagram audience: whole account only (Meta gives no portrait per post)
  const aud = inp.audience
  const top3 = (rows) => { const sum = rows.reduce((t, [, v]) => t + v, 0); return rows.filter(([l]) => !/неизвестно/.test(l)).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([l, v]) => ({ label: l, share: pct(v, sum) })) }
  let engTop = null
  for (const key of Object.keys(AUD_METRICS)) {
    const g = aud?.groups?.[key]
    const ag = g?.ageGender ? top3(g.ageGender) : null
    const parts = []
    if (ag?.length) parts.push(ag.map((x) => `${x.label} — ${x.share}%`).join(', '))
    else {
      if (g?.age) parts.push(`возраст: ${top3(g.age).map((x) => `${x.label} — ${x.share}%`).join(', ')}`)
      if (g?.gender) parts.push(`пол: ${top3(g.gender).map((x) => `${x.label} — ${x.share}%`).join(', ')}`)
    }
    if (g?.city) parts.push(`города: ${top3(g.city).map((x) => `${x.label} — ${x.share}%`).join(', ')}`)
    if (!parts.length) { const err = aud?.errors?.[`${key}:age,gender`]; if (aud) missing.push(`${AUD_RU[key]}: Meta не дала портрет${err && !/^Meta не дала/.test(err) ? ` (${err})` : ''}.`); continue }
    add('audience', `${AUD_RU[key]} (${key === 'followers' && !g.frame ? 'сейчас' : FRAME_RU[g.frame ?? ''] || g.frame}; весь аккаунт — Meta не делит портрет по постам${g.from ? `; данные от ${ru(ymd(new Date(g.from)))}` : ''}): ${parts.join('; ')}.`)
    if (ag?.length && key !== 'followers') engTop = { label: ag[0].label, share: ag[0].share, key }
  }
  if (!aud) missing.push('Портрет аудитории Instagram ещё не получен (Meta не подключена или не ответила).')
  if (adTop && engTop) add('audience', `Сравнение: пишут по рекламе — чаще всех ${adTop.label} (${adTop.share}% переписок); реагируют в Instagram — ${engTop.label} (${engTop.share}% ${engTop.key === 'engaged' ? 'вовлечённых' : 'охваченных'}).`)

  // 6. what worked in content: the office's own posts (60 days) and stories (30 days), with the argument they carried
  const tagOf = (x) => (x.arg ? ` [${x.arg}]` : '')
  const posts = Object.entries(inp.posts?.posts || {}).map(([id, p]) => ({ id, ...p })).filter((p) => p.own && p.d7?.reach && now - Date.parse(p.date) < 60 * 864e5)
  if (posts.length) {
    const mid = median(posts.map((p) => p.d7.reach))
    for (const p of [...posts].sort((x, y) => y.d7.reach - x.d7.reach).slice(0, 2)) {
      add('content', `Сильный пост за 60 дн.: ${ru(ymd(new Date(p.date)))} ${p.type === 'Карусель' ? 'карусель' : p.type === 'Рилс' || p.type === 'Видео' ? 'пост-видео' : 'пост'} «${clip(p.caption, 50)}» — охват ${int(p.d7.reach)}${posts.length >= 4 && mid ? ` (обычный ${int(mid)})` : ''}${p.d7.saved != null ? `, сохранений ${p.d7.saved}` : ''}${p.d7.profile_visits != null ? `, в профиль ${p.d7.profile_visits}` : ''}${tagOf(p)}.`)
    }
    const fmt = { Пост: [], Карусель: [], Видео: [] }
    for (const p of posts) (p.type === 'Карусель' ? fmt.Карусель : p.type === 'Рилс' || p.type === 'Видео' ? fmt.Видео : fmt.Пост).push(p.d7.reach)
    const f3 = Object.entries(fmt).filter(([, v]) => v.length >= 3)
    if (f3.length >= 2) add('content', `Средний охват своих публикаций за 60 дн.: ${f3.map(([k, v]) => `${{ Пост: 'посты', Карусель: 'карусели', Видео: 'посты-видео' }[k]} — ${int(v.reduce((t, x) => t + x, 0) / v.length)} (${v.length} шт.)`).join(', ')}.`)
  } else missing.push('Своих постов с замером за 60 дней пока нет — что зашло в ленте, неизвестно.')
  const stories = Object.values(inp.stories || {}).filter((s) => s.reach != null && s.ageH >= 20 && now - Date.parse(s.date) < 30 * 864e5 && now - Date.parse(s.date) > 24 * 36e5)
  const ownSt = stories.filter((s) => s.own).length >= 3 ? stories.filter((s) => s.own) : stories
  if (ownSt.length) {
    const mid = median(ownSt.map((s) => s.reach))
    for (const s of [...ownSt].sort((x, y) => y.reach - x.reach).slice(0, 2)) {
      add('content', `Сильная сторис за 30 дн.: ${ru(ymd(new Date(s.date)))} ${s.type === 'video' ? 'видео' : 'картинка'}${s.caption ? ` «${clip(s.caption, 40)}»` : ''} — охват ${int(s.reach)}${ownSt.length >= 4 ? ` (обычный ${int(mid)})` : ''}${s.replies != null ? `, ответов ${s.replies}` : ''}${s.profile_visits != null ? `, в профиль ${s.profile_visits}` : ''}${tagOf(s)}.`)
    }
    const vid = ownSt.filter((s) => s.type === 'video'), pic = ownSt.filter((s) => s.type !== 'video')
    const avg = (l, k = 'reach') => { const v = l.map((s) => s[k]).filter((x) => x != null); return v.length ? int(v.reduce((t, x) => t + x, 0) / v.length) : null }
    if (vid.length >= 3 && pic.length >= 3) add('content', `Сторис за 30 дн.: видео — средний охват ${avg(vid)} (${vid.length} шт.), картинки — ${avg(pic)} (${pic.length} шт.).`)
    // which arguments worked: the stories the office published with a kind (продажа / доверие)
    const sell = ownSt.filter((s) => /^продажа/.test(s.arg || '')), trust = ownSt.filter((s) => /^доверие/.test(s.arg || ''))
    if (sell.length >= 3 && trust.length >= 3) add('content', `Сторис с обоснованием за 30 дн.: «продажа» — средний охват ${avg(sell)}${avg(sell, 'profile_visits') != null ? `, в профиль ${avg(sell, 'profile_visits')}` : ''} (${sell.length} шт.); «доверие» — ${avg(trust)}${avg(trust, 'profile_visits') != null ? `, в профиль ${avg(trust, 'profile_visits')}` : ''} (${trust.length} шт.).`)
  } else missing.push('Сторис с полным замером за 30 дней нет — что зашло в сторис, неизвестно.')

  return { at: new Date(now).toISOString(), day: today, facts, missing }
}

const AREA_RU = { stock: 'Остатки и темп продаж', pay: 'Как платят', crm: 'Обращения (CRM)', objection: 'Возражения клиентов (CRM)', ads: 'Кто пишет из рекламы', place: 'Где показывать рекламу', video: 'Видео в рекламе', promo: 'Продвижения постов: подписчики', audience: 'Аудитория Instagram', content: 'Что зашло в контенте' }
export function briefText(b) {
  const lines = [
    `# Бриф продаж для контент-плана — ${ru(b.day)}`,
    'Факты посчитал офис по шахматке, CRM, рекламе и Instagram. Ссылайся на них номерами (Ф1, Ф2…). Цифры в «why» и «strategy» — только из фактов, на которые ссылаешься: офис проверит каждую цифру и заменит чужую фактами.',
  ]
  for (const [area, title] of Object.entries(AREA_RU)) {
    const list = b.facts.filter((f) => f.area === area)
    if (list.length) lines.push('', `## ${title}`, ...list.map((f) => `- ${f.id}. ${f.text}`))
  }
  if (b.missing.length) lines.push('', '## Нет данных — эти цифры не выдумывай', ...b.missing.map((m) => `- ${m}`))
  return `${lines.join('\n')}\n`
}

// For Алия's content-plan task: fetch what the office has, write the brief. Every source is optional.
export async function writeBrief(dir, { portal, crm, meta, cfg } = {}) {
  const inp = { cfg }
  if (portal?.status?.().configured) {
    inp.apartments = await portal.get('/api/analytics/apartments').then((a) => a.apartments).catch(() => null)
    if (inp.apartments) inp.changes = await portal.get('/api/analytics/status-history').then((h) => h.changes).catch(() => null)
  }
  if (crm?.status?.().configured) inp.crm = { leads: await crm.leads().catch(() => null), words: crm.refusalWords?.() || {} }
  inp.ads = read(path.join(P.data, 'ads', 'archive.json'), null)
  inp.posts = read(path.join(P.data, 'memory', 'posts.json'), null)
  inp.stories = read(path.join(P.data, 'instagram', 'stories.json'), null)
  inp.history = read(path.join(P.data, 'instagram', 'history.json'), null)?.days || null
  inp.audience = await refreshAudience(meta).catch((e) => { console.error('Аудитория Instagram:', e.message); return read(AUDIENCE, null) })
  const b = briefFrom(inp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'бриф-продаж.json'), JSON.stringify(b, null, 1), 'utf8')
  fs.writeFileSync(path.join(dir, 'бриф-продаж.md'), briefText(b), 'utf8')
  return b
}
export const readBrief = (taskId) => read(path.join(P.work, taskId, '_данные', 'бриф-продаж.json'), null)

// ---------- checking Алия's plan by code ----------

const KIND_RE = { продажа: /прода|sell|sale/i, доверие: /довер|trust/i }
const normKind = (k) => Object.keys(KIND_RE).find((x) => KIND_RE[x].test(String(k || ''))) || null
const isStory = (x) => /сторис|stor/i.test(x.format || '')
const isReel = (x) => /рилс|reel/i.test(x.format || '')
// stories: 5 selling + 2 trust per 7 days, proportionally for a shorter range
export const storyRule = (n) => { const trust = Math.round((2 * n) / 7); return { sell: n - trust, trust } }
// a fact in short: its first two parts, cut only between parts (never inside a number)
const short = (f) => f.text.replace(/\.$/, '').split('; ').slice(0, 2).join('; ')
const factsLine = (list) => list.map(short).reduce((s, x) => (!s ? x : `${s} · ${x}`.length <= 200 ? `${s} · ${x}` : s), '')

// Mutates and returns the plan: unknown fact ids dropped, every number of «why» checked against the cited facts,
// a failed «why» replaced by the facts themselves; plan.checked = what was corrected. A plan without arguments
// (made before 20.11.2026) is left as it was: returns null.
export function checkPlan(plan, brief) {
  if (!plan?.items?.length) return null
  const argued = plan.strategy || plan.items.some((x) => x.kind || x.why || x.facts || x.focus)
  if (!argued) return null
  if (plan.checked) return plan // checked once: a second pass would take the office's own facts for Алия's words
  const facts = new Map((brief?.facts || []).map((f) => [f.id, f]))
  const c = { at: new Date().toISOString(), brief: !!brief, items: 0, ok: 0, replaced: 0, none: 0, few: 0, unknownIds: 0, noObjection: 0, strategyFixed: 0 }
  for (const x of plan.items) {
    c.items++
    x.kind = normKind(x.kind)
    const f = x.focus && typeof x.focus === 'object' ? x.focus : x.focus ? { usp: String(x.focus) } : {}
    x.focus = Object.fromEntries(['product', 'usp', 'audience', 'objection'].map((k) => [k, clip(f[k], 80)]).filter(([, v]) => v))
    const ids = [...new Set((Array.isArray(x.facts) ? x.facts : x.facts != null ? [x.facts] : []).map(normId).filter(Boolean))]
    const known = ids.filter((id) => facts.has(id))
    c.unknownIds += ids.length - known.length
    x.facts = known
    x.fact_texts = known.map((id) => facts.get(id).text)
    const why = clip(x.why, 160)
    delete x.no_basis
    if (!known.length) { if (why) x.why_alia = why; x.why = ''; x.no_basis = true; x.arg_check = 'none'; c.none++ }
    else if (!why || !numbersOk(why, known.map((id) => facts.get(id)))) { if (why) x.why_alia = why; x.why = factsLine(known.map((id) => facts.get(id))); x.arg_check = 'replaced'; c.replaced++ }
    else { x.why = why; x.arg_check = 'ok'; c.ok++ }
    if (x.kind !== 'доверие' && known.length === 1) c.few++
    // a trust item must answer a real objection of the brief
    if (x.kind === 'доверие' && !known.some((id) => facts.get(id).area === 'objection')) c.noObjection++
  }
  // the strategy: each line keeps its own numbers only if they are in the facts it cites
  const raw = Array.isArray(plan.strategy) ? plan.strategy : String(plan.strategy || '').split('\n')
  const lines = []
  for (const line of raw.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3)) {
    const cited = idsIn(line).filter((id) => facts.has(id)).map((id) => facts.get(id))
    const text = dropIds(line)
    if (numbersOk(text, cited)) { lines.push(clip(text, 200)); continue }
    c.strategyFixed++
    if (cited.length) lines.push(short(cited[0]))
  }
  plan.strategy_checked = lines
  const st = plan.items.filter((x) => isStory(x))
  const need = storyRule(st.length)
  c.stories = { n: st.length, sell: st.filter((x) => x.kind === 'продажа').length, trust: st.filter((x) => x.kind === 'доверие').length, needSell: need.sell, needTrust: need.trust }
  const parts = []
  if (!brief) parts.push('бриф продаж не собрался — цифры не с чем сверить')
  if (c.replaced) parts.push(`у ${c.replaced} ${c.replaced === 1 ? 'пункта' : 'пунктов'} «почему» заменено цифрами офиса (у Алии были цифры не из брифа)`)
  if (c.none) parts.push(`${c.none} без обоснования — Алия не сослалась на цифры`)
  if (c.unknownIds) parts.push(`убрано ссылок на несуществующие факты: ${c.unknownIds}`)
  if (c.strategyFixed) parts.push(`строк стратегии поправлено: ${c.strategyFixed}`)
  if (st.length && (c.stories.sell !== need.sell || c.stories.trust !== need.trust)) parts.push(`сторис: ${c.stories.sell} продающих + ${c.stories.trust} на доверие вместо ${need.sell} + ${need.trust}`)
  if (c.noObjection) parts.push(`${c.noObjection} «доверие» без возражения из CRM`)
  c.note = parts.length ? `🔎 Проверка цифр: ${parts.join('; ')}.` : null
  plan.checked = c
  return plan
}

// the argument of one plan item for the pack (null for plans made before the arguments)
export function argOf(it) {
  if (!it || !it.arg_check) return null
  return { kind: it.kind || null, ...(it.focus || {}), why: it.why || '', facts: (it.fact_texts || []).slice(0, 3), check: it.arg_check }
}

// short label kept on a published item's results: «продажа · УТП: рассрочка 0%»
export function argLabel(arg) {
  if (!arg) return null
  return clip([arg.kind || 'без типа', arg.kind === 'доверие' && arg.objection ? `возражение: ${arg.objection}` : arg.usp ? `УТП: ${arg.usp}` : ''].filter(Boolean).join(' · '), 70)
}

// two lines under an item in Telegram (plain text)
export function argLines(arg) {
  if (!arg) return []
  const who = arg.audience ? ` · для: ${arg.audience}` : ''
  const head = arg.kind === 'доверие'
    ? `🛡 Снимаем возражение: ${arg.objection || arg.usp || '—'}${arg.objection && arg.usp ? ` · ${arg.usp}` : ''}${who}`
    : `🎯 Продаём: ${arg.product || '—'}${arg.usp ? ` · УТП: ${arg.usp}` : ''}${who}`
  const why = arg.check === 'none' ? '📊 Почему: без обоснования — Алия не сослалась на цифры' : arg.check === 'replaced' ? `📊 Цифры офиса: ${arg.why}` : `📊 Почему: ${arg.why}`
  return [clip(head, 220), clip(why, 230)]
}

// pack items ↔ plan items of the same date: a story to the k-th «Сторис» of that day, a post or carousel to the k-th post/carousel
export function attachArgs(items, plan) {
  if (!plan?.checked || !Array.isArray(plan.items)) return 0
  const pool = (date, story) => plan.items.filter((x) => x.date === date && !isReel(x) && isStory(x) === story)
  const used = {}
  let n = 0
  for (const x of [...items].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))) {
    if (x.type === 'reel' || x.arg) continue
    const key = `${x.date}-${x.type === 'story'}`
    const it = pool(x.date, x.type === 'story')[(used[key] = (used[key] ?? -1) + 1)]
    const arg = argOf(it)
    if (arg) { x.arg = arg; n++ }
  }
  return n
}

// the plan's items as lines for Мадина's task: what to sell, to whom, and the checked facts
export function madinaLines(plan, story) {
  if (!plan?.checked) return []
  const d = (x) => `${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(`${x.date}T12:00:00+05:00`).getUTCDay()]} ${ru(x.date)}`
  return plan.items.filter((x) => x.date && !isReel(x) && isStory(x) === story).map((x) => {
    const f = x.focus || {}
    const head = x.kind === 'доверие'
      ? `доверие: снимаем возражение «${f.objection || '—'}»${f.usp ? ` · довод: ${f.usp}` : ''}`
      : `продаём ${f.product || '—'}${f.usp ? ` · УТП: ${f.usp}` : ''}`
    return `- ${d(x)} ${x.format || ''} «${clip(x.topic, 60)}»: ${head}${f.audience ? ` · для: ${f.audience}` : ''}.${x.why && x.arg_check === 'ok' ? ` Почему: ${x.why.replace(/[.!]?$/, '.')}` : ''}${x.fact_texts?.length ? ` Цифры: ${x.fact_texts.map((t) => `«${t}»`).join(' ')}` : ' Цифр нет — без конкретных чисел.'}`
  })
}
