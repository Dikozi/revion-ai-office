// Followers: the office writes the Instagram follower count every hour. Meta's own daily «follower_count»
// comes 1–2 days late, so «how many came in the last 24 hours» is answered from this log, without waiting.
// Plain code, no Claude: one cheap request an hour. Also the facts Алия needs to explain a jump:
// what reached people who do not follow yet, profile visits, which ads ran, what was published.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { markOk, markFail } from './sources.js'

const FILE = path.join(P.data, 'instagram', 'followers.json')
const ymd = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(t))
const median = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }

// [[ms, count], …]
export function followerLog() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}

// net change over the last hours; null while the log does not cover most of the window
export function growth(log, hours) {
  if (log.length < 2) return null
  const [tNow, nNow] = log.at(-1)
  const from = log.find(([t]) => t >= tNow - hours * 3600e3 - 30 * 60e3)
  if (!from || tNow - from[0] < hours * 3600e3 * 0.75) return null
  return nNow - from[1]
}

// net change by Astana day (the first day of the log is incomplete and left out).
// After a gap (the office was down) the change covers several days: such a day gets a third value,
// the number of days it spans, and is not a real «day»: [day, change] or [day, change, span].
export function byDay(log) {
  const last = {}
  for (const [t, n] of log) last[ymd(t)] = n
  const days = Object.keys(last).sort()
  return days.slice(1).map((d, i) => {
    const span = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${days[i]}T12:00:00Z`)) / 864e5)
    return span > 1 ? [d, last[d] - last[days[i]], span] : [d, last[d] - last[days[i]]]
  })
}
const dayText = ([d, n, span]) => `${d.slice(8)}.${d.slice(5, 7)} ${n >= 0 ? '+' : ''}${n}${span ? ` (за ${span} дн.: офис не записывал счётчик)` : ''}`

export class Followers {
  constructor({ meta, cfg }) {
    this.meta = meta
    this.cfg = cfg
  }

  start() {
    // the same hourly tick keeps stories and the account's days before Meta forgets them (insta-archive.js)
    const tick = () => this.snap().catch((e) => console.error('Подписчики:', e.message)).then(() => this.archive?.tick()).catch((e) => console.error('Архив Instagram:', e.message))
    setTimeout(tick, 90 * 1000).unref?.()
    setInterval(tick, 60 * 60 * 1000).unref?.()
  }

  async snap() {
    const m = this.meta.m
    if (!m?.token || !m.igUserId) return
    // the hourly answer of Instagram is what the «Данные: …» line shows (sources.js)
    let a
    try { a = await this.meta.api(m.igUserId, { fields: 'followers_count' }) } catch (e) { markFail('insta', e); throw e }
    markOk('insta')
    if (a.followers_count == null) return
    const keep = Date.now() - 400 * 864e5
    const log = followerLog().filter(([t]) => t >= keep)
    log.push([Date.now(), a.followers_count])
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(log))
    fs.renameSync(`${FILE}.tmp`, FILE)
  }

  // usual new followers per day: the own log of the last 14 full days, or Meta's daily count while the log is young
  async norm() {
    const today = ymd(Date.now())
    // a day after a gap holds several days of growth: not a usual day
    const own = byDay(followerLog()).filter(([d, , span]) => d < today && !span).slice(-14).map(([, n]) => n)
    if (own.length >= 7) return median(own)
    const m = this.meta.m
    // the last two weeks: older days (before the ads) would make an ordinary ad day look like a jump
    const since = Math.floor((Date.now() - 16 * 864e5) / 1000), until = Math.floor((Date.now() - 2 * 864e5) / 1000)
    const j = await this.meta.api(`${m.igUserId}/insights`, { metric: 'follower_count', period: 'day', since, until }).catch(() => null)
    return median((j?.data?.[0]?.values || []).map((v) => v.value))
  }

  goal() {
    const g = this.cfg?.smm || {}
    const end = Date.parse(`${g.goalDate || '2026-12-31'}T23:59:59+05:00`)
    return { goal: g.followersGoal || 2000, date: g.goalDate || '2026-12-31', days: Math.max(1, Math.ceil((end - Date.now()) / 864e5)) }
  }
}

// The facts behind a jump, as plain lines for Алия: live counter, then what moved it.
export function followersFacts({ log, norm, deep, currency, goal }) {
  const now = log.at(-1)?.[1]
  const g24 = growth(log, 24), g72 = growth(log, 72)
  const days = byDay(log).slice(-7)
  const usual = (key) => median(deep.daily.slice(0, -3).map((d) => d[key]))
  const lines = [
    `Подписчиков сейчас ${now}. Живой счётчик офиса (без задержки Meta): за 24 часа ${g24 == null ? '—' : `${g24 >= 0 ? '+' : ''}${g24}`}, за 72 часа ${g72 == null ? '—' : `${g72 >= 0 ? '+' : ''}${g72}`}. Обычно ${norm} в день${norm && g24 != null ? ` — сейчас в ${(g24 / norm).toFixed(1)} раза больше` : ''}.`,
    days.length ? `По дням (живой счётчик): ${days.map(dayText).join(', ')}.` : '',
    `Из статистики Instagram по дням (последние 3 дня против обычного за предыдущие ${Math.max(0, deep.daily.length - 3)}):`,
    ...deep.daily.slice(-3).map((d) => `- ${d.day.slice(8)}.${d.day.slice(5, 7)}: посещений профиля ${d.profile_views ?? '—'} (обычно ${usual('profile_views') ?? '—'}), охват неподписанных ${d.reach_new ?? '—'} (обычно ${usual('reach_new') ?? '—'}), охват от рекламы ${d.reach_by_type?.AD ?? 0}, подписок ${d.follows ?? 'Meta ещё не посчитала'}, отписок ${d.unfollows ?? '—'}`),
  ]
  if (deep.ads.length) {
    lines.push('Реклама за последние 3 дня:')
    for (const a of deep.ads) lines.push(`- «${a.name}» (${a.goal}): расход ${a.spend} ${currency}, охват ${a.reach}${a.profileVisits != null ? `, посещений профиля ${a.profileVisits}${a.visitsEstimate ? ' (оценка по кликам)' : ''} по ${a.profileVisits ? (a.spend / a.profileVisits).toFixed(2) : '—'} ${currency}` : ''}${a.follows != null ? `, подписок с рекламы ${a.follows} (Meta)` : ''}${a.chats ? `, переписок ${a.chats}` : ''}`)
  } else lines.push('Реклама за последние 3 дня не крутилась.')
  const fresh = [...deep.media, ...deep.stories].filter((x) => Date.now() - Date.parse(x.date) < 3 * 864e5)
  lines.push(fresh.length ? `Опубликовано за 3 дня: ${fresh.map((x) => `${x.type} ${x.date.slice(8, 10)}.${x.date.slice(5, 7)} — подписок ${x.follows ?? '— (Meta не даёт для Reels)'}, посещений профиля ${x.profile_visits ?? '—'}, охват ${x.reach ?? '—'}`).join('; ')}.` : 'За 3 дня публикаций и сторис не было.')
  const fromMedia = fresh.reduce((t, x) => t + (x.follows || 0), 0)
  // older files have no `profile`: an ad with visits was a profile ad then
  const profileSpend = deep.ads.filter((a) => a.profile ?? a.profileVisits != null).reduce((t, a) => t + a.spend, 0)
  if (g72 != null && profileSpend) {
    const est = Math.max(0, g72 - fromMedia)
    // Reels (the office's post-videos too) and stories older than a day have no follows here: unknown, not 0
    const unknown = fresh.filter((x) => x.follows == null).length
    lines.push(`Оценка: из прироста за 72 часа (${g72}) с публикаций и сторис пришло ${fromMedia}${unknown ? ` (ещё у ${unknown} публикаций подписки неизвестны — Meta не даёт их для Reels; сторис старше суток здесь не видны)` : ''}, остальные ≈${est} — с рекламы на профиль и прочего; расход на такую рекламу за 3 дня ${profileSpend.toFixed(2)} ${currency} → ≈${est ? (profileSpend / est).toFixed(2) : '—'} ${currency} за подписчика (оценка: Meta не показывает подписки по объявлению${unknown ? '; доля рекламы может быть завышена, а цена подписчика — занижена' : ''}).`)
  }
  if (goal && now != null) lines.push(`Цель: ${goal.goal} к ${goal.date}; осталось ${Math.max(0, goal.goal - now)} за ${goal.days} дн. — нужно ≈${Math.max(0, Math.ceil(((goal.goal - now) / goal.days) * 7))} в неделю.`)
  return lines.filter(Boolean)
}
