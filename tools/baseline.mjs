// Snapshot of the current state ("ДО") from what the office can read: chessboard portal, Meta ads, Instagram.
// Saves data/baseline/<date>.json and prints a summary. Run again later for "ПОСЛЕ" — same formulas.
// Usage: node tools/baseline.mjs
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../server/config.js'
import { Meta } from '../server/meta.js'
import { Portal } from '../server/portal.js'
import { P } from '../server/paths.js'

const cfg = loadConfig()
const meta = new Meta(cfg)
const portal = new Portal(cfg)
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const today = new Date()
const ago = (days) => ymd(new Date(Date.now() - days * 864e5))
const out = { date: ymd(today), portal: null, ads: null, instagram: null, notes: [] }

// ---------- chessboard ----------
try {
  const a = await portal.get('/api/analytics/apartments')
  const h = await portal.get('/api/analytics/status-history')
  const by = {}
  for (const x of a.apartments) by[x.status] = (by[x.status] || 0) + 1
  const sold = a.apartments.filter((x) => x.sold)
  const month = (iso) => iso.slice(0, 7)
  const flow = {}
  for (const c of h.changes) {
    const m = month(c.changed_at)
    flow[m] ??= {}
    flow[m][c.to] = (flow[m][c.to] || 0) + 1
  }
  out.portal = {
    complexes: [...new Set(a.apartments.map((x) => `${x.complex} ${x.phase} очередь`))],
    total: a.count,
    byStatus: by,
    soldCount: sold.length,
    soldArea: Math.round(sold.reduce((s, x) => s + (x.area_m2 || 0), 0) * 10) / 10,
    withPrice: a.apartments.filter((x) => x.price_kzt).length,
    soldWithPrice: sold.filter((x) => x.price_kzt).length,
    soldRevenueKnown: sold.reduce((s, x) => s + (x.price_kzt || 0), 0),
    freeArea: Math.round(a.apartments.filter((x) => x.status === 'Свободна').reduce((s, x) => s + (x.area_m2 || 0), 0) * 10) / 10,
    historySince: a.history_since,
    statusChanges: h.count,
    changesByMonth: flow,
    roomsSold: sold.reduce((o, x) => ((o[x.rooms] = (o[x.rooms] || 0) + 1), o), {}),
    roomsFree: a.apartments.filter((x) => x.status === 'Свободна').reduce((o, x) => ((o[x.rooms] = (o[x.rooms] || 0) + 1), o), {}),
  }
} catch (e) { out.notes.push('Шахматка: ' + e.message) }

// ---------- Meta ads ----------
const ACT = (acts, type) => Number((acts || []).find((x) => x.action_type === type)?.value || 0)
const CONV = 'onsite_conversion.messaging_conversation_started_7d'
const LEADS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']
const pickLeads = (acts) => Math.max(...LEADS.map((t) => ACT(acts, t)))
try {
  const act = `act_${String(meta.m.adAccountId).replace(/^act_/, '')}`
  const fields = 'spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpm,actions'
  const period = async (days) => {
    const r = (await meta.api(`${act}/insights`, { fields, time_range: JSON.stringify({ since: ago(days), until: ymd(today) }) })).data?.[0] || {}
    const conv = ACT(r.actions, CONV), leads = pickLeads(r.actions)
    return { days, spend: +r.spend || 0, impressions: +r.impressions || 0, reach: +r.reach || 0, linkClicks: +r.inline_link_clicks || 0, ctr: +r.ctr || 0, cpm: +r.cpm || 0, conversations: conv, leads, costPerConversation: conv ? +(r.spend / conv).toFixed(2) : null }
  }
  const monthly = (await meta.api(`${act}/insights`, { fields: 'spend,actions', time_increment: 'monthly', time_range: JSON.stringify({ since: ago(180), until: ymd(today) }) })).data || []
  const campaigns = (await meta.api(`${act}/insights`, { level: 'campaign', fields: 'campaign_name,spend,actions,ctr', time_range: JSON.stringify({ since: ago(90), until: ymd(today) }), limit: 100 })).data || []
  const ads = (await meta.api(`${act}/insights`, { level: 'ad', fields: 'ad_name,campaign_name,spend,actions,ctr', time_range: JSON.stringify({ since: ago(90), until: ymd(today) }), limit: 300 })).data || []
  const conv = (x) => ACT(x.actions, CONV) + pickLeads(x.actions)
  out.ads = {
    currency: meta.m.adAccounts?.find((a) => a.id?.includes(String(meta.m.adAccountId).replace(/^act_/, '')))?.currency || 'USD',
    last30: await period(30),
    last90: await period(90),
    byMonth: monthly.map((m) => ({ month: m.date_start.slice(0, 7), spend: +m.spend || 0, conversations: conv(m) })),
    campaigns90: campaigns.map((c) => ({ name: c.campaign_name, spend: +c.spend || 0, conversations: conv(c), costPer: conv(c) ? +(c.spend / conv(c)).toFixed(2) : null })).sort((a, b) => b.spend - a.spend),
    topAds90: ads.map((x) => ({ name: x.ad_name, campaign: x.campaign_name, spend: +x.spend || 0, conversations: conv(x), ctr: +x.ctr || 0 })).sort((a, b) => b.conversations - a.conversations).slice(0, 5),
    adsCount90: ads.length,
  }
} catch (e) { out.notes.push('Реклама Meta: ' + e.message) }

// ---------- Instagram ----------
try {
  const id = meta.m.igUserId
  const acc = await meta.api(id, { fields: 'username,followers_count,media_count' })
  const since = Math.floor((Date.now() - 30 * 864e5) / 1000), until = Math.floor(Date.now() / 1000)
  const tv = async (metric) => {
    try { return (await meta.api(`${id}/insights`, { metric, period: 'day', metric_type: 'total_value', since, until })).data?.[0]?.total_value?.value ?? null } catch { return null }
  }
  const media = (await meta.api(`${id}/media`, { fields: 'timestamp,media_product_type', limit: 100 })).data || []
  const recent = media.filter((m) => Date.parse(m.timestamp) > Date.now() - 30 * 864e5)
  out.instagram = {
    username: acc.username, followers: acc.followers_count, posts: acc.media_count,
    last30: { reach: await tv('reach'), views: await tv('views'), interactions: await tv('total_interactions'), profileLinksTaps: await tv('profile_links_taps'), posts: recent.length, reels: recent.filter((m) => m.media_product_type === 'REELS').length },
  }
} catch (e) { out.notes.push('Instagram: ' + e.message) }

// ---------- what cannot be measured yet ----------
const krisha = (() => { try { return JSON.parse(fs.readFileSync(path.join(P.data, 'initiative.json'), 'utf8')).krisha?.entries || [] } catch { return [] } })()
out.notMeasured = [
  'Общее число лидов по всем каналам (WhatsApp, Instagram, Крыша, 2ГИС, звонки, риэлторы) — единого учёта нет',
  'Источник каждого лида и каждой сделки — не фиксируется',
  'Скорость первого ответа и доля обработанных лидов — не фиксируется',
  'Показы квартир — не фиксируются',
  'Причины отказов — не фиксируются',
  'Follow-up (повторные касания) — не контролируются',
  'Звонки — не записываются и не анализируются',
  'Связь «креатив → лид → бронь → продажа → выручка» — нет сквозной аналитики',
  krisha.length ? null : 'Расход на Крышу — ещё не вносился',
].filter(Boolean)

fs.mkdirSync(path.join(P.data, 'baseline'), { recursive: true })
const file = path.join(P.data, 'baseline', `${out.date}.json`)
fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8')
console.log(JSON.stringify(out, null, 1))
console.log('saved', file)
