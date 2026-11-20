// Алия's long memory of advertising: every ad ever run, how it was set up and what it gave.
// Plain code, no Claude: a nightly pull from Meta (Meta keeps ~37 months, so every run sees the whole history).
// Ads come in three kinds that must never be compared with each other:
// - chat: the ad opens WhatsApp / Direct / Messenger; result = conversation, quality = «живой разговор»
//   (the client wrote 3+ messages; Meta counts it itself, the office never sees the texts); «блок» = blocked the chat;
// - form: «Лиды» with Meta's instant form; result = a filled form; its quality is unknown until leads are linked to bookings;
// - other: reach, engagement, profile visits — judged by followers and reach, not by conversations.
// Also Алия's forecasts: she writes прогноз.json in a report, the office checks it when the period is over.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { ours, ymdIn, shift, kindByGoal, refusedField, followsOf, visitsOf } from './ads-rules.js'
import { promos, adPortrait, regionsOf, hoursOf, placesOf, videosOf, otherReach, adsMore, KIND_HOURS } from './ads-more.js'

// a forecast is scored only on at least this many conversations (or live ones): fewer is chance, not skill
const MIN_SAMPLE = 10
const DIR = path.join(P.data, 'ads')
const FILE = path.join(DIR, 'archive.json')
const FORECASTS = path.join(DIR, 'forecasts.json')
const FIELDS = 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,video_avg_time_watched_actions'
// campaigns: reach is asked of Meta per campaign (a sum of ad reaches counts one person many times)
const CAMP_FIELDS = 'campaign_id,campaign_name,objective,spend,impressions,reach,frequency,inline_link_clicks,actions'
// Instagram profile visits from ads (Meta's field since Dec 2025); refused → remembered until a restart (meta.tryField)
const VISITS = 'instagram_profile_visits'
// a breakdown that may carry follows from ads: tried once per run of the office, kept only while it gives follows
const FOLLOW_BD = 'instagram_ads_follow_type'
// cut name → breakdowns and windows; region and hour — 90 days only (who writes now, not two years ago)
const CUTS = { age: ['age,gender', ['last_90d', 'maximum']], place: ['publisher_platform,platform_position', ['last_90d', 'maximum']], region: ['region', ['last_90d']], hour: [KIND_HOURS, ['last_90d']] }
// rows kept per cut: the archive stays small even with hourly rows
const CUT_ROWS = 4000
const WORDS = { female: 'женщины', male: 'мужчины', unknown: 'неизвестно', Unknown: 'неизвестно', instagram: 'Instagram', facebook: 'Facebook', audience_network: 'Audience Network', messenger: 'Messenger', feed: 'лента', instagram_reels: 'Reels', facebook_reels: 'Reels', instagram_stories: 'сторис', facebook_stories: 'сторис', instagram_explore: 'интересное', instagram_explore_grid_home: 'интересное', instagram_profile_feed: 'профиль', facebook_profile_feed: 'профиль', marketplace: 'маркетплейс', video_feeds: 'видеолента', search: 'поиск' }

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T12:00:00+05:00`) + n * 864e5))
const ru = (date) => (date ? date.split('-').reverse().join('.') : '')
const num = (v) => Number(v) || 0
const act = (actions, name) => num((actions || []).find((a) => a.action_type === name)?.value)
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const write = (f, v) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f) }

// video of an ad: 3-second views (video_view), watched to 25/50/75/100%, ThruPlay, average seconds watched
const videoOf = (r) => {
  const v = (k) => num(r[k]?.[0]?.value)
  const v3 = act(r.actions, 'video_view')
  if (!v('video_p25_watched_actions') && !v3) return null
  return { v3: v3 || null, p25: v('video_p25_watched_actions'), p50: v('video_p50_watched_actions'), p75: v('video_p75_watched_actions'), p100: v('video_p100_watched_actions'), thru: v('video_thruplay_watched_actions'), avg: v('video_avg_time_watched_actions') }
}

// conv = all results (conversations + forms), the same sum the dashboard uses.
// chats = conversations started (one metric everywhere); «all message contacts» (total_messaging_connection)
// also counts people who wrote before, so it is kept apart as conn and never stands in for chats.
export function adNumbers(r = {}) {
  const chats = act(r.actions, 'onsite_conversion.messaging_conversation_started_7d')
  const leads = Math.max(act(r.actions, 'lead'), act(r.actions, 'onsite_conversion.lead_grouped'))
  return {
    spend: num(r.spend), impr: num(r.impressions), reach: num(r.reach), clicks: num(r.inline_link_clicks),
    chats, leads, conv: chats + leads, conn: act(r.actions, 'onsite_conversion.total_messaging_connection'),
    deep: act(r.actions, 'onsite_conversion.messaging_user_depth_3_message_send'),
    block: act(r.actions, 'onsite_conversion.messaging_block'),
  }
}
// [spend, impr, clicks, chats, leads, deep, block] and, when Meta gives them, [7] Instagram profile visits, [8] follows from
// the ad; absent (or null) = unknown, never 0. Older readers sum only the first 7.
const pack = (n) => [n.spend, n.impr, n.clicks, n.chats, n.leads, n.deep, n.block]
const packMore = (r, vis, fol) => { const p = pack(adNumbers(r)); if (vis || fol) p.push(vis ? visitsOf(r) : null); if (fol) p.push(followsOf(r.actions) ?? 0); return p }
const ZERO = [0, 0, 0, 0, 0, 0, 0]
const add = (t, v) => t.map((s, i) => s + (v?.[i] || 0))

const GOAL = { OUTCOME_ENGAGEMENT: 'Взаимодействие', OUTCOME_LEADS: 'Лиды', OUTCOME_TRAFFIC: 'Трафик', OUTCOME_AWARENESS: 'Узнаваемость', OUTCOME_SALES: 'Продажи', MESSAGES: 'Сообщения', POST_ENGAGEMENT: 'Вовлечённость', LINK_CLICKS: 'Клики', REACH: 'Охват' }
const OPT = { CONVERSATIONS: 'переписки', LINK_CLICKS: 'клики', REACH: 'охват', POST_ENGAGEMENT: 'вовлечённость', IMPRESSIONS: 'показы', PROFILE_VISIT: 'посещения профиля', LEAD_GENERATION: 'лиды', THRUPLAY: 'просмотры видео', LANDING_PAGE_VIEWS: 'просмотры сайта' }
const STATUS = { ACTIVE: 'работает', PAUSED: 'выключено', CAMPAIGN_PAUSED: 'выключена кампания', ADSET_PAUSED: 'выключена группа', ARCHIVED: 'в архиве', DELETED: 'удалено' }
const WATCH = { budget: 'бюджет', dates: 'даты', audience: 'аудитория', goal: 'цель', places: 'места', status: 'статус' }
const METRIC = { cpr: 'цена результата (переписки или заявки)', cpq: 'цена живого разговора' }
const KIND = { chat: 'переписки', form: 'форма', other: 'прочее' }

// By the settings (Meta's codes kept in set.kind, or the goal line «цель → оптимизация → куда»);
// for ads Meta no longer describes — by what they gave. A «Лиды» campaign optimised for conversations is a chat ad.
export function kindOf(set, total = {}) {
  if (set?.kind) return set.kind
  const g = set?.goal || ''
  if (/ON_AD|LEAD_FORM|→ лиды|QUALITY_LEAD/.test(g)) return 'form'
  if (/WHATSAPP|MESSENGER|INSTAGRAM_DIRECT|MESSAGING|переписки|Сообщения/.test(g)) return 'chat'
  if (/Лиды/.test(g)) return 'form'
  if (g) return 'other'
  return total.leads > total.chats ? 'form' : total.chats ? 'chat' : 'other'
}

// { ad_id: kind } of an archive already read
export const kindsOf = (a) => Object.fromEntries(Object.entries(a?.ads || {}).map(([id, x]) => [id, kindOf(x.set, x.total)]))

// { ad_id: 'chat' | 'form' | 'other' } from the night archive; re-read only when the file changes
let kindsCache = { mtime: 0, kinds: {} }
export function adKinds() {
  try {
    const mtime = fs.statSync(FILE).mtimeMs
    if (mtime !== kindsCache.mtime) {
      const a = read(FILE, { ads: {} })
      kindsCache = { mtime, kinds: Object.fromEntries(Object.entries(a.ads || {}).map(([id, x]) => [id, kindOf(x.set, x.total)])) }
    }
    return kindsCache.kinds
  } catch { return {} }
}

// promotions, live portrait, regions, hours, placements and video of the archive, for the portal (files only, no Meta calls)
export function archiveMore(cfg = {}) {
  const a = read(FILE, null)
  if (!a || a.v !== 2) return null
  return adsMore(a, kindsOf(a), read(path.join(P.data, 'instagram', 'history.json'), { days: {} }).days || {}, cfg)
}

// «https://www.instagram.com/p/AbCdEfGhIjK/» → «AbCdEfGhIjK»
export const postOf = (url) => String(url || '').match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] || null

// One line of settings out of meta.adSettings().
function brief(s) {
  const k = s.кампания || {}, g = s.группа || {}, a = s.аудитория || {}, m = s.места_показа || {}
  const interests = (a.интересы_и_поведение || []).flat()
  const day = g.бюджет_в_день ?? k.бюджет_в_день, all = g.бюджет_всего ?? k.бюджет_всего
  return {
    goal: [GOAL[k.цель] || k.цель, OPT[g.оптимизация] || g.оптимизация, g.куда_ведёт && g.куда_ведёт !== 'UNDEFINED' ? g.куда_ведёт : ''].filter(Boolean).join(' → '),
    budget: day ? `${day}/день` : all ? `${all} на срок` : '',
    dates: [ru(g.начало), ru(g.конец)].filter(Boolean).join('–'),
    audience: [
      [...(a.города || []), ...(a.точки || []), ...(a.регионы || []), ...(a.страны || [])].join(', '),
      (a.возраст || []).filter(Boolean).join('–'),
      a.пол?.length === 1 ? (a.пол[0] === 1 ? 'мужчины' : 'женщины') : '',
      interests.length ? `интересы: ${interests.slice(0, 4).join(', ')}${interests.length > 4 ? '…' : ''}` : '',
      (a.свои_аудитории || []).length ? `свои: ${a.свои_аудитории.join(', ')}` : '',
      a.advantage_аудитория === 1 ? 'Advantage+' : '',
    ].filter(Boolean).join('; '),
    places: Array.isArray(m.платформы) ? m.платформы.join('+') : 'авто',
    status: STATUS[s.статус] || s.статус || '',
    start: g.начало || s.создано || '',
    // the promoted Instagram post: a lead from WhatsApp carries its link, so leads find their ad by it
    post: postOf(s.публикация),
    kind: kindByGoal({ objective: k.цель, optimization: g.оптимизация, destination: g.куда_ведёт }),
  }
}

// Promotions, who really talks (live conversations, regions, hours), placements and video — for Алия's history file
function moreSections(a, kinds, history, managerHours, money) {
  const cur = a.currency
  const out = []
  const dd = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—')
  const n = (v) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU'))
  const p = (v) => (v == null ? '—' : `${v}%`)
  const SRC = { meta: 'Meta', estimate: 'оценка', clicks: 'оценка по кликам' }
  const pr = promos(a, kinds, history)
  if (pr?.rows.length) {
    const vis = a.probe?.visits
    out.push('', '## Продвижения: охват, посещения профиля, новые подписчики (за всё время каждой кампании)',
      `«Продвигать» в Instagram (кампании «Публикация в Instagram: …») и реклама на охват / профиль. Охват — по кампании, как его считает Meta (охваты объявлений не складываются: один человек видел несколько). Посещения профиля — ${vis ? 'Meta считает сама (поле instagram_profile_visits)' : vis === false ? 'Meta это поле не отдала: у рекламы на профиль взяты клики по ссылке — это оценка' : 'появятся после ночного обновления'}. Подписчики: «Meta» — посчитала Meta; «оценка» — посещения профиля × доля «подписались ÷ зашли в профиль» всего аккаунта за те же дни (своя доля у каждой кампании, в скобках). Цену подписчика у рекламы на переписки не считаем.`,
      `| продвижение | даты | тип | расход ${cur} | охват | показы | в профиль | цена посещения | подписчиков | цена подписчика | источник |`, '|---|---|---|---|---|---|---|---|---|---|---|',
      ...pr.rows.slice(0, 25).map((x) => `| ${x.title.replace(/\|/g, '/').slice(0, 60)}${x.post ? ` (${x.post})` : ''} | ${dd(x.first)}–${dd(x.last)} | ${KIND[x.kind] || x.kind} | ${money(x.spend)} | ${n(x.reach)} | ${n(x.impr)} | ${n(x.visits)}${x.visitsSrc === 'clicks' ? ' (клики)' : ''} | ${x.cpv == null ? '—' : money(x.cpv)} | ${n(x.follows)} | ${x.cpf == null ? '—' : money(x.cpf)} | ${x.follows == null ? 'нет данных' : `${SRC[x.followsSrc]}${x.share != null ? ` (${String(x.share).replace('.', ',')}%)` : ''}`} |`),
      ...pr.notes.map((t) => `- ${t}`))
  }
  const pt = adPortrait(a, kinds)
  if (pt?.chats) {
    out.push('', '## Кто реально разговаривает: возраст и пол, последние 90 дней (реклама на переписки)',
      `Живой разговор — клиент написал 3+ сообщения. Всего ${pt.chats} переписок, из них живых ${pt.deep} (${p(pt.live)}); «неизвестно» не входит.`,
      `| кто | переписок | доля переписок | живых | доля живых | живые из переписок | цена переписки | цена живого |`, '|---|---|---|---|---|---|---|---|',
      ...pt.rows.map((g) => `| ${g.label} | ${g.chats} | ${p(g.shareChats)} | ${g.deep} | ${p(g.shareDeep)} | ${p(g.live)} | ${money(g.cpc)} | ${money(g.cpq)} |`),
      ...(pt.sex.length ? [`Пол: ${pt.sex.map((g) => `${g.label} — ${p(g.shareChats)} переписок и ${p(g.shareDeep)} живых, живой по ${money(g.cpq)} ${cur}`).join('; ')}.`] : []))
  }
  const or = otherReach(a, kinds)
  if (or?.length) out.push('', '## Реклама на охват / профиль: кому показали (возраст и пол, 90 дней — это не те, кто пишет)', '| кто | показов | доля показов | кликов | расход |', '|---|---|---|---|---|', ...or.slice(0, 8).map((g) => `| ${g.label} | ${n(g.impr)} | ${p(g.share)} | ${g.clicks} | ${money(g.spend)} |`))
  const rg = regionsOf(a, kinds)
  if (rg?.chats) {
    out.push('', '## Откуда пишут: регионы, последние 90 дней (реклама на переписки)',
      `Астана — ${p(rg.astana.shareChats)} переписок и ${p(rg.astana.shareDeep)} живых (живой по ${money(rg.astana.cpq)} ${cur}); другие регионы — ${p(rg.rest.shareChats)} и ${p(rg.rest.shareDeep)} (живой по ${money(rg.rest.cpq)} ${cur}).`,
      '| регион | переписок | доля | живых | доля живых | цена переписки | цена живого |', '|---|---|---|---|---|---|---|',
      ...rg.rows.slice(0, 10).map((g) => `| ${g.label} | ${g.chats} | ${p(g.shareChats)} | ${g.deep} | ${p(g.shareDeep)} | ${money(g.cpc)} | ${money(g.cpq)} |`))
  }
  const hr = hoursOf(a, kinds, managerHours, a.tz)
  if (hr?.chats) {
    out.push('', '## Когда пишут: часы по времени Астаны, последние 90 дней (реклама на переписки)',
      hr.known ? `Менеджер работает: ${hr.hours}. Вне этих часов пишут ${p(hr.outside)} переписок (${p(hr.outsideDeep)} живых); с учётом выходных — ≈${p(hr.outsideWeek)} (Meta не делит часы по дням недели, считаем дни похожими).` : 'Часы менеджера не заданы (managerHours) — сравнить не с чем.',
      `Чаще всего пишут в ${hr.peak.map((h) => `${h}:00–${h + 1}:00`).join(', ') || '—'}.${hr.moved ? ` Часы кабинета сдвинуты на ${hr.moved} ч к времени Астаны.` : ''}`,
      '| час | переписок | живых | менеджер |', '|---|---|---|---|',
      ...hr.byHour.filter((x) => x.chats).map((x) => `| ${String(x.h).padStart(2, '0')}:00 | ${x.chats} | ${x.deep} | ${x.work ? 'работает' : 'нет'} |`))
  }
  for (const [cut, title] of [['place:last_90d', 'последние 90 дней'], ['place:maximum', 'за всё время']]) {
    const pl = placesOf(a, kinds, cut)
    if (pl?.rows.length) out.push('', `## Места показа по группам: лента / Reels / сторис / прочее, ${title} (реклама на переписки)`, `| место | расход ${cur} | переписок | цена переписки | живых | цена живого | живые из переписок |`, '|---|---|---|---|---|---|---|', ...pl.rows.map((g) => `| ${g.label} | ${money(g.spend)} | ${g.chats} | ${money(g.cpc)} | ${g.deep} | ${money(g.cpq)} | ${p(g.live)} |`))
  }
  const vd = videosOf(a, kinds, { top: 12 })
  if (vd?.rows.length) {
    out.push('', '## Видео в рекламе: цепляет ли начало и досматривают ли (объявления, крутившиеся за 90 дней; итоги за всё время)',
      'Цепляет — 3-секундные просмотры ÷ показы; досматривают — досмотрели до конца ÷ 3-секундные просмотры.',
      '| объявление | показов | 3 сек | цепляет | 25% | 50% | 75% | 100% | досматривают | ср. время, с |', '|---|---|---|---|---|---|---|---|---|---|',
      ...vd.rows.map((v) => `| ${String(v.name || '').replace(/\|/g, '/').slice(0, 50)} (${v.id}) | ${n(v.impr)} | ${n(v.v3)} | ${p(v.hook)} | ${n(v.p25)} | ${n(v.p50)} | ${n(v.p75)} | ${n(v.p100)} | ${p(v.done)} | ${v.avg == null ? '—' : String(v.avg).replace('.', ',')} |`))
  }
  return out
}

export class AdsArchive {
  constructor({ meta }) {
    this.meta = meta
    this.busy = null
  }

  // First run right away (the whole history), then every night after 4:00.
  start() {
    const due = () => {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
      const a = read(FILE, null)
      if (!a || a.v !== 2 || (a.day !== ymd(new Date()) && h >= 4)) this.update().catch((e) => console.error('Архив рекламы:', e.message))
    }
    setTimeout(due, 90 * 1000).unref?.()
    setInterval(due, 30 * 60 * 1000).unref?.()
  }

  update() {
    if (!this.busy) this.busy = this.pull().finally(() => { this.busy = null })
    return this.busy
  }

  async all(pathname, params, version = null) {
    const out = []
    let after
    for (let i = 0; i < 40; i++) {
      const r = await this.meta.api(pathname, { ...params, limit: 500, ...(after ? { after } : {}) }, undefined, version)
      out.push(...(r.data || []))
      after = r.paging?.cursors?.after
      if (!r.paging?.next || !after) break
    }
    return out
  }

  async pull() {
    const m = this.meta.m
    if (!m?.token || !m.adAccountId) return
    const acc = `act_${m.adAccountId}`
    const old = read(FILE, { ads: {} })
    const today = ymd(new Date())
    // Meta's days are the ad account's days; today is not over yet and is left out of the daily history
    const info = await Promise.resolve(this.meta.account?.()).catch(() => null)
    const adToday = ymdIn(info?.tz || this.meta.tz?.())
    // another project in the same account (Парк and the configured exclusions) is not Алия's
    const mine = ours(this.meta.cfg)
    // the same call with Instagram profile visits when Meta knows the field (tryField: this version, then a newer one)
    const withVisits = (params) => (this.meta.tryField
      ? this.meta.tryField(VISITS, (v) => this.all(`${acc}/insights`, v ? { ...params, fields: `${params.fields},${VISITS}` } : params, v))
      : this.all(`${acc}/insights`, params).then((data) => ({ data, field: false })))
    const lifeR = await withVisits({ level: 'ad', date_preset: 'maximum', fields: FIELDS })
    const dailyR = await withVisits({ level: 'ad', date_preset: 'maximum', time_increment: 1, fields: 'ad_id,campaign_name,spend,impressions,inline_link_clicks,actions' })
    const life = lifeR.data.filter(mine), daily = dailyR.data.filter(mine)
    // follows from ads: only if Meta answers with such action types at all (then a missing one is a real 0)
    const followTypes = new Set()
    const hasFollows = (rows) => { let any = false; for (const r of rows) for (const x of r.actions || []) if (/follow/i.test(x.action_type || '') && !/unfollow/i.test(x.action_type || '')) { followTypes.add(x.action_type); any = true } return any }
    const lifeFol = hasFollows(life), dailyFol = hasFollows(daily)
    const ads = {}
    for (const r of life) {
      const was = old.ads[r.ad_id] || {}
      ads[r.ad_id] = {
        name: r.ad_name, campaign: r.campaign_name, ...(r.campaign_id ? { cid: r.campaign_id } : {}),
        total: { ...adNumbers(r), freq: num(r.frequency), video: videoOf(r), visits: lifeR.field ? visitsOf(r) : null, follows: lifeFol ? followsOf(r.actions) ?? 0 : null },
        set: was.set || null, changes: was.changes || [],
      }
    }
    // { day: { ad_id: pack } } — by ad, so every sum can be split by kind
    const days = {}
    const last = {}
    for (const r of daily) {
      if (!last[r.ad_id] || r.date_start > last[r.ad_id]) last[r.ad_id] = r.date_start
      if (r.date_start < adToday) (days[r.date_start] ||= {})[r.ad_id] = packMore(r, dailyR.field, dailyFol)
    }
    // every campaign as Meta counts it (reach of a campaign is never the sum of its ads); a failure keeps last night's
    let campaigns = old.campaigns || null
    let byBreakdown = null
    try {
      const cR = await withVisits({ level: 'campaign', date_preset: 'maximum', fields: CAMP_FIELDS })
      const rows = cR.data.filter(mine)
      const fol = hasFollows(rows)
      // no follows among the actions: a breakdown that may carry them is tried once per run of the office
      const st = (this.meta.fields ||= {})
      if (!fol && !lifeFol && st[FOLLOW_BD] !== false) {
        try {
          const bd = (await this.all(`${acc}/insights`, { level: 'campaign', date_preset: 'maximum', breakdowns: FOLLOW_BD, fields: 'campaign_id,campaign_name,actions' })).filter(mine)
          for (const r of bd) { const f = followsOf(r.actions); if (f != null) { byBreakdown ||= {}; byBreakdown[r.campaign_id] = (byBreakdown[r.campaign_id] || 0) + f; followTypes.add(`${FOLLOW_BD}:${r[FOLLOW_BD] ?? ''}`) } }
          // accepted but without follows: no use asking every night
          st[FOLLOW_BD] = !!byBreakdown
        } catch (e) { if (refusedField(e, FOLLOW_BD)) st[FOLLOW_BD] = false }
      }
      campaigns = {}
      for (const r of rows) {
        const n = adNumbers(r)
        campaigns[r.campaign_id] = {
          name: r.campaign_name, objective: r.objective || null, spend: n.spend, impr: n.impr, reach: num(r.reach), freq: num(r.frequency), clicks: n.clicks,
          chats: n.chats, deep: n.deep, leads: n.leads, visits: cR.field ? visitsOf(r) : null,
          follows: fol ? followsOf(r.actions) ?? 0 : byBreakdown ? byBreakdown[r.campaign_id] ?? 0 : null,
        }
      }
    } catch (e) { console.error('Архив рекламы, кампании:', e.message) }
    const probe = { at: new Date().toISOString(), visits: lifeR.field ? lifeR.version || true : false, follows: lifeFol || dailyFol ? 'actions' : byBreakdown ? 'breakdown' : null, followTypes: [...followTypes].slice(0, 10) }
    // settings are read once, and again only for ads that ran lately: that is where budgets and audiences change
    for (const [id, x] of Object.entries(ads)) {
      if (x.set && 'post' in x.set && (last[id] || '') < addDays(today, -35)) continue
      try {
        const set = brief(await this.meta.adSettings(id))
        if (x.set) for (const [k, label] of Object.entries(WATCH)) if ((x.set[k] || '') !== (set[k] || '')) x.changes.push({ date: today, text: `${label}: ${x.set[k] || '—'} → ${set[k] || '—'}` })
        x.changes = x.changes.slice(-20)
        x.set = set
      } catch {
        if (!x.set) x.set = { status: 'удалено' }
      }
    }
    // who wrote and where the ads were shown, by ad: last 90 days and all time
    const cuts = {}
    // the hour «09:00:00 - 09:59:59» is kept as «09» (the ad account's time zone)
    const word = (k, v) => (k === KIND_HOURS ? String(v || '').slice(0, 2) : WORDS[v] || v)
    for (const [name, [breakdowns, presets]] of Object.entries(CUTS)) {
      for (const preset of presets) {
        // a cut Meta refused tonight keeps last night's rows (old) rather than an empty table
        cuts[`${name}:${preset}`] = await this.all(`${acc}/insights`, { level: 'ad', date_preset: preset, breakdowns, fields: 'ad_id,campaign_name,spend,impressions,inline_link_clicks,actions' })
          .then((rows) => rows.filter(mine).slice(0, CUT_ROWS).map((r) => [r.ad_id, breakdowns.split(',').map((k) => word(k, r[k])).join(' · '), ...pack(adNumbers(r))]))
          .catch(() => old.cuts?.[`${name}:${preset}`] || [])
      }
    }
    // Meta gives new followers per day only for the last 30 days, so they are collected here day by day
    const followers = { ...(old.followers || {}) }
    if (m.igUserId) {
      const now = Math.floor(Date.now() / 1000)
      const f = await this.meta.insights(m.igUserId, ['follower_count'], { period: 'day', since: now - 29 * 86400, until: now }).catch(() => ({}))
      for (const x of Array.isArray(f.follower_count) ? f.follower_count : []) followers[ymd(new Date(Date.parse(x.end_time) - 864e5))] = num(x.value)
    }
    write(FILE, { v: 2, day: today, until: shift(adToday, -1), tz: info?.tz || null, at: new Date().toISOString(), currency: info?.currency || this.meta.status().adAccount?.currency || '', ads, days, cuts, followers, ...(campaigns ? { campaigns } : {}), probe })
    await this.checkForecasts(today).catch((e) => console.error('Прогнозы Алии:', e.message))
  }

  // прогноз.json from Алия's task: {"items":[{"ad_id":"…" or null,"label":"…","metric":"cpr"|"cpq","low":1.6,"high":2.2,"days":7}]}
  takeForecasts(ws, taskId) {
    let items
    try { items = JSON.parse(fs.readFileSync(path.join(ws, 'прогноз.json'), 'utf8')).items || [] } catch { return 0 }
    const today = ymd(new Date())
    const names = read(FILE, { ads: {} }).ads
    const list = read(FORECASTS, [])
    let n = 0
    for (const x of items.slice(0, 15)) {
      const low = num(x.low), high = num(x.high), days = Math.min(Math.max(Math.round(num(x.days)) || 7, 3), 30)
      if (!METRIC[x.metric] || !(low > 0) || !(high >= low)) continue
      const ad = /^\d{6,}$/.test(String(x.ad_id || '')) ? String(x.ad_id) : null
      list.push({ id: `${taskId}-${n++}`, made: today, ad, label: String(x.label || names[ad]?.name || '').slice(0, 120), metric: x.metric, low, high, days, until: addDays(today, days), status: ad ? 'open' : 'manual' })
    }
    write(FORECASTS, list.slice(-300))
    return n
  }

  // The forecast window is the `days` after the day it was made.
  async checkForecasts(today) {
    const list = read(FORECASTS, [])
    let changed = false
    for (const f of list) {
      if (f.status !== 'open' || f.until >= today) continue
      // a live conversation (3+ messages) can be finished a day or two later: give it time
      if (f.metric === 'cpq' && f.until >= addDays(today, -2)) continue
      const res = await this.meta.api(`${f.ad}/insights`, { fields: 'spend,actions', time_range: { since: addDays(f.made, 1), until: f.until } }).catch(() => undefined)
      if (res === undefined) continue
      const n = adNumbers(res.data?.[0])
      changed = true
      if (!n.spend) { f.status = 'no-data'; continue }
      const per = f.metric === 'cpr' ? n.conv : n.deep
      f.spend = n.spend
      f.n = per
      f.fact = per ? Math.round((n.spend / per) * 100) / 100 : null
      // under MIN_SAMPLE results the price is chance — unless so much was spent that even the top of the forecast
      // should have bought MIN_SAMPLE: then the miss is real (the fact is above the range)
      f.status = per >= MIN_SAMPLE ? (f.fact >= f.low && f.fact <= f.high ? 'hit' : 'miss')
        : n.spend >= f.high * MIN_SAMPLE ? 'miss' : 'small'
    }
    if (changed) write(FORECASTS, list)
  }

  // Short text files for Алия's task folder: the whole history and her forecasts' track record.
  writeFor(dir) {
    fs.mkdirSync(dir, { recursive: true })
    const a = read(FILE, null)
    if (!a || a.v !== 2) {
      fs.writeFileSync(path.join(dir, 'история-рекламы.md'), 'Архив рекламы ещё собирается — будет к следующей задаче.\n', 'utf8')
      return
    }
    const cur = a.currency
    const money = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 100 ? Math.round(v).toLocaleString('ru-RU') : v.toFixed(2).replace('.', ','))
    const per = (s, n) => (n ? money(s / n) : '—')
    const pct = (x, y) => (y ? `${Math.round((x / y) * 100)}%` : '—')
    const ctr = (clicks, impr) => (impr ? `${((clicks / impr) * 100).toFixed(2).replace('.', ',')}%` : '—')
    const cut = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || '—')
    const kinds = Object.fromEntries(Object.entries(a.ads).map(([id, x]) => [id, kindOf(x.set, x.total)]))
    // sums a { ad_id: pack } map into { chat, form, other }
    const split = (maps) => {
      const o = { chat: [...ZERO], form: [...ZERO], other: [...ZERO] }
      for (const mp of maps) for (const [id, v] of Object.entries(mp || {})) o[kinds[id] || 'other'] = add(o[kinds[id] || 'other'], v)
      return o
    }
    // [spend, impr, clicks, chats, leads, deep, block]
    const periodRow = (label, o) => {
      const c = o.chat, f = o.form
      return `| ${label} | ${money(c[0] + f[0] + o.other[0])} | ${money(c[0])} | ${c[3]} | ${per(c[0], c[3])} | ${c[5]} | ${per(c[0], c[5])} | ${pct(c[5], c[3])} | ${money(f[0])} | ${f[4]} | ${per(f[0], f[4])} | ${money(o.other[0])} |`
    }
    const periodHead = `| период | всего ${cur} | переписки: расход | переписок | цена переписки | живых (3+) | цена живого | доля живых | форма: расход | заявок | цена заявки | прочее: расход |\n|---|---|---|---|---|---|---|---|---|---|---|---|`
    // complete days only: the last one is yesterday of the ad account (older files may still hold the day of the pull)
    const until = a.until || addDays(a.day, -1)
    const dates = Object.keys(a.days).filter((d) => d <= until).sort()
    const range = (from, to) => split(dates.filter((d) => d >= from && d <= to).map((d) => a.days[d]))
    const monday = (d) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7))
    const upTo = (end) => (end > until ? ` (по ${ru(until).slice(0, 5)}, неполная)` : '')
    const weeks = []
    for (let w = monday(until), i = 0; i < 12; i++, w = addDays(w, -7)) weeks.push(periodRow(`${ru(w).slice(0, 5)}–${ru(addDays(w, 6)).slice(0, 5)}${upTo(addDays(w, 6))}`, range(w, addDays(w, 6))))
    const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort().reverse().map((mo) => periodRow(`${mo}${upTo(new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 0)).toISOString().slice(0, 10))}`, range(`${mo}-01`, `${mo}-31`)))
    const daily = []
    for (let i = 29; i >= 0; i--) {
      const d = addDays(until, -i), o = split([a.days[d]])
      daily.push(`| ${ru(d).slice(0, 5)} | ${money(o.chat[0] + o.form[0] + o.other[0])} | ${o.chat[3]} | ${o.chat[5]} | ${o.form[4]} | ${a.followers?.[d] ?? '—'} |`)
    }
    // breakdowns: rows [ad_id, label, ...pack] summed by label within one kind
    const cutTables = (title, rows) => {
      const out = []
      for (const kind of ['chat', 'form']) {
        const by = {}
        for (const [id, label, ...v] of rows || []) if (kinds[id] === kind) by[label] = add(by[label] || ZERO, v)
        const list = Object.entries(by).filter(([, v]) => v[0] >= 0.5).sort((x, y) => y[1][0] - x[1][0])
        if (!list.length) continue
        out.push('', `${title} — реклама на ${kind === 'chat' ? 'переписки' : 'форму-заявку'}`)
        if (kind === 'chat') out.push(`| кто / где | расход ${cur} | переписок | цена переписки | живых (3+) | цена живого | доля живых | CTR | блок |`, '|---|---|---|---|---|---|---|---|---|', ...list.map(([k, v]) => `| ${k} | ${money(v[0])} | ${v[3]} | ${per(v[0], v[3])} | ${v[5]} | ${per(v[0], v[5])} | ${pct(v[5], v[3])} | ${ctr(v[2], v[1])} | ${v[6]} |`))
        else out.push(`| кто / где | расход ${cur} | заявок | цена заявки | CTR |`, '|---|---|---|---|---|', ...list.map(([k, v]) => `| ${k} | ${money(v[0])} | ${v[4]} | ${per(v[0], v[4])} | ${ctr(v[2], v[1])} |`))
      }
      return out
    }
    const ads = Object.entries(a.ads).sort((x, y) => (y[1].set?.start || '').localeCompare(x[1].set?.start || ''))
    const adRow = ([id, x]) => {
      const t = x.total, s = x.set || {}, k = kinds[id]
      const result = k === 'chat' ? `${t.chats} переписок | ${per(t.spend, t.chats)}` : k === 'form' ? `${t.leads} заявок | ${per(t.spend, t.leads)}` : `${t.clicks} кликов | ${per(t.spend, t.clicks)}`
      const quality = k === 'chat' ? `${t.deep} | ${per(t.spend, t.deep)} | ${pct(t.deep, t.chats)}` : '— | — | —'
      return `| ${s.dates || '—'} | ${KIND[k]} | ${x.name.replace(/\|/g, '/').slice(0, 60)} (${id}) | ${s.goal || '—'} | ${s.budget || '—'} | ${cut(s.audience, 110)} | ${s.places || '—'} | ${money(t.spend)} | ${result} | ${quality} | ${t.freq.toFixed(1).replace('.', ',')} | ${ctr(t.clicks, t.impr)} | ${t.block} | ${t.video ? `${t.video.p25}→${t.video.p100} (${pct(t.video.p100, t.video.p25)}), ср. ${t.video.avg} с` : '—'} | ${s.status || '—'} |`
    }
    const line = (x, value, unit) => `- «${x.name}» (${x.set?.dates || '—'}) — ${value} ${cur} ${unit}, ${x.set?.goal || ''}; ${cut(x.set?.audience, 140)}`
    const chatRated = ads.filter(([id, x]) => kinds[id] === 'chat' && x.total.spend >= 10 && x.total.deep).sort((x, y) => x[1].total.spend / x[1].total.deep - y[1].total.spend / y[1].total.deep)
    const forms = ads.filter(([id, x]) => kinds[id] === 'form' && x.total.spend >= 5).sort((x, y) => x[1].total.spend / (x[1].total.leads || 0.01) - y[1].total.spend / (y[1].total.leads || 0.01))
    const changes = ads.flatMap(([, x]) => x.changes.map((c) => ({ ...c, name: x.name }))).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 30)
    const text = [
      `# История рекламы Altyn Qala — весь архив Meta, обновлено ${ru(a.day)}`,
      'Три типа рекламы — сравнивай только внутри типа:',
      '- переписки — реклама ведёт в WhatsApp / Direct / Messenger. Результат — переписка. Качество — живой разговор: клиент написал 3 и больше сообщений (так владелец меряет качество; Meta считает это сама, тексты переписок офису не видны). Блок — клиент заблокировал переписку.',
      '- форма — «Лиды»: человек оставляет телефон в форме Meta, без переписки. Результат — заявка. Её качество офис пока не видит (нужна связь заявок с бронями); живыми разговорами форму не оценивай.',
      '- прочее — охват, вовлечённость, посещения профиля: цель — подписчики и узнаваемость, по перепискам и заявкам такую рекламу не суди.',
      `Деньги — в валюте кабинета (${cur}). Дни — полные, последний — ${ru(until)}; парк-проект и другие исключённые кампании в архив не входят.`,
      '', '## По неделям (последние 12)', periodHead, ...weeks,
      '', '## По дням (последние 30 полных): расход и новые подписчики — чтобы связать рост подписчиков с рекламой', '| день | расход всего | переписок | живых (3+) | заявок (форма) | новых подписчиков |', '|---|---|---|---|---|---|', ...daily,
      '', '## По месяцам (весь кабинет)', periodHead, ...months,
      ...cutTables('## Кто пишет: возраст и пол, последние 90 дней', a.cuts?.['age:last_90d']),
      ...cutTables('## Кто пишет: возраст и пол, за всё время', a.cuts?.['age:maximum']),
      ...cutTables('## Места показа, последние 90 дней', a.cuts?.['place:last_90d']),
      ...cutTables('## Места показа, за всё время', a.cuts?.['place:maximum']),
      ...moreSections(a, kinds, read(path.join(P.data, 'instagram', 'history.json'), { days: {} }).days || {}, this.meta?.cfg?.managerHours || {}, money),
      '', '## Переписки: дешевле всего живой разговор (расход от 10)', ...chatRated.slice(0, 5).map(([, x]) => line(x, per(x.total.spend, x.total.deep), 'за живой разговор')),
      '', '## Переписки: дороже всего живой разговор', ...chatRated.slice(-5).reverse().map(([, x]) => line(x, per(x.total.spend, x.total.deep), 'за живой разговор')),
      ...(forms.length ? ['', '## Форма-заявка: цена заявки (дешёвые сверху)', ...forms.map(([, x]) => line(x, per(x.total.spend, x.total.leads), `за заявку (${x.total.leads} заявок)`))] : []),
      '', '## Все объявления (новые сверху; итоги за всё время)',
      '| даты | тип | объявление (id) | цель → оптимизация → куда | бюджет | аудитория | места | расход | результат | цена результата | живых | цена живого | доля живых | частота | CTR | блок | видео: 25% → до конца, ср. время | статус |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...ads.map(adRow),
      ...(changes.length ? ['', '## Изменения настроек', ...changes.map((c) => `- ${ru(c.date)} «${c.name}»: ${c.text}`)] : []),
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'история-рекламы.md'), `${text}\n`, 'utf8')

    const list = read(FORECASTS, [])
    const today = ymd(new Date())
    const checked = list.filter((f) => f.status === 'hit' || f.status === 'miss').reverse()
    const hits = checked.filter((f) => f.status === 'hit').length
    const small = list.filter((f) => f.status === 'small').reverse()
    const errs = checked.filter((f) => f.fact != null && (f.n == null || f.n >= MIN_SAMPLE)).map((f) => (f.fact - (f.low + f.high) / 2) / ((f.low + f.high) / 2))
    const bias = errs.length ? Math.round((errs.reduce((t, x) => t + x, 0) / errs.length) * 100) : null
    const span = (f) => `${METRIC[f.metric]} ${money(f.low)}–${money(f.high)} ${cur}`
    const manual = list.filter((f) => f.status === 'manual' && f.until < today && f.made >= addDays(today, -60))
    const open = list.filter((f) => f.status === 'open')
    const fc = [
      '# Твои прогнозы и как они сбылись',
      checked.length
        ? `Проверено ${checked.length}: в диапазон попала ${hits} (${pct(hits, checked.length)}).${bias != null ? ` В среднем факт ${bias >= 0 ? 'дороже' : 'дешевле'} середины прогноза на ${Math.abs(bias)}% — учти это в новых прогнозах.` : ''}`
        : 'Проверенных прогнозов ещё нет.',
      ...(checked.length ? ['', '## Проверенные (новые сверху)', ...checked.slice(0, 15).map((f) => `- ${ru(f.made)} «${f.label}»: прогноз — ${span(f)}; факт — ${f.fact == null ? `ни одной при расходе ${money(f.spend)} ${cur}` : `${money(f.fact)} ${cur}`} → ${f.status === 'hit' ? 'попала' : 'мимо'}`)] : []),
      ...(small.length ? ['', `## Не засчитаны: меньше ${MIN_SAMPLE} результатов — цена случайна`, ...small.slice(0, 10).map((f) => `- ${ru(f.made)} «${f.label}»: прогноз — ${span(f)}; результатов ${f.n || 0} при расходе ${money(f.spend)} ${cur}`)] : []),
      ...(open.length ? ['', '## Ждут проверки', ...open.map((f) => `- ${ru(f.made)} «${f.label}»: ${span(f)}, проверка после ${ru(f.until)}`)] : []),
      ...(manual.length ? ['', '## Без объявления — сверь сама по истории', ...manual.map((f) => `- ${ru(f.made)} «${f.label}»: ${span(f)} за ${ru(addDays(f.made, 1))}–${ru(f.until)}`)] : []),
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'прогнозы.md'), `${fc}\n`, 'utf8')
  }
}
