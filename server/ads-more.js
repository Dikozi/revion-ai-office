// What the night ad archive (ads-archive.js) tells beyond the price of a conversation (owner's choice 20.11.2026):
// 1) promotions («Продвигать», «Публикация в Instagram: …»): reach, profile visits and new followers per campaign;
// 2) the portrait of those who really talk: age × gender by live conversations, regions, hours against the manager's hours;
// 3) placements by the price of a (live) conversation, and video: does the start hook, do they watch to the end.
// Plain code, no Claude, no Meta calls: everything is read from archive.json and the Instagram history (insta-archive.js).
// Unknown stays null with a note in words — never a 0 in its place.

export const KIND_HOURS = 'hourly_stats_aggregated_by_advertiser_time_zone'
const ASTANA = 'Asia/Almaty'

const num = (v) => Number(v) || 0
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const shift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const span = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5) + 1

// an ad that leads to the Instagram profile (its settings line «цель → оптимизация → куда»)
export const toProfile = (set) => /посещения профиля|INSTAGRAM_PROFILE|PROFILE_VISIT/.test(set?.goal || '')
const PROMO_NAME = /Публикация в Instagram|Instagram post|Продвиж/i
export const promoName = (name) => String(name || '').replace(/^Публикация в Instagram:\s*/i, '').trim() || String(name || '')

// ---------- followers: the account's «followed ÷ visited the profile» ----------

// over the days [from, to] of the Instagram history ({ day: { follows, profile_views } }); half the days must be known
export function followShare(history, from, to) {
  if (!from || !to || to < from) return null
  let f = 0, v = 0, n = 0
  const all = span(from, to)
  for (let d = from, i = 0; d <= to && i < 1200; d = shift(d, 1), i++) {
    const x = history?.[d]
    if (x?.follows != null && x?.profile_views > 0) { f += x.follows; v += x.profile_views; n++ }
  }
  if (!n || !v || n < all / 2) return null
  return { share: Math.min(1, f / v), days: n, of: all }
}

// ---------- 1. promotions ----------

// Every promotion of the archive: a campaign for reach / profile / engagement, or a boosted post («Публикация в Instagram»).
// Reach — the campaign's own (Meta), never a sum of its ads. Profile visits — Meta's field; without it, link clicks of
// profile ads (estimate). Follows — Meta's when it gives them; else visits × the account's «followed ÷ visited» of those days.
export function promos(a, kinds = {}, history = {}) {
  if (a?.v !== 2 || !a.ads) return null
  const camps = {}, of = {}
  for (const [id, x] of Object.entries(a.ads)) {
    const key = x.cid || `name:${x.campaign || x.name}`
    const c = (camps[key] ||= { key, id: x.cid || null, name: x.campaign || x.name, ads: [], spendBy: {}, post: null, profile: false, first: null, last: null })
    c.ads.push(id)
    of[id] = c
    const k = kinds[id] || 'other'
    c.spendBy[k] = (c.spendBy[k] || 0) + num(x.total?.spend)
    c.post ||= x.set?.post || null
    if (toProfile(x.set)) c.profile = true
  }
  for (const [d, m] of Object.entries(a.days || {})) {
    for (const [id, p] of Object.entries(m || {})) {
      const c = of[id]
      if (!c || !(p?.[0] > 0)) continue
      if (!c.first || d < c.first) c.first = d
      if (!c.last || d > c.last) c.last = d
    }
  }
  const rows = []
  for (const c of Object.values(camps)) {
    const kind = Object.entries(c.spendBy).sort((x, y) => y[1] - x[1])[0]?.[0] || 'other'
    if (!(kind === 'other' || c.profile || PROMO_NAME.test(c.name))) continue
    const t = (c.id && a.campaigns?.[c.id]) || null
    const ads = c.ads.map((id) => a.ads[id].total || {})
    const sum = (k) => ads.reduce((s, x) => s + num(x[k]), 0)
    const spend = t ? num(t.spend) : sum('spend')
    if (!(spend > 0)) continue
    let visits = null, visitsSrc = null
    if (t?.visits != null) { visits = num(t.visits); visitsSrc = 'meta' }
    else if (ads.length && ads.every((x) => x.visits != null)) { visits = sum('visits'); visitsSrc = 'meta' }
    else if (c.profile) { visits = t ? num(t.clicks) : sum('clicks'); visitsSrc = 'clicks' }
    let follows = null, followsSrc = null, share = null
    if (t?.follows != null) { follows = num(t.follows); followsSrc = 'meta' }
    else if (ads.length && ads.every((x) => x.follows != null)) { follows = sum('follows'); followsSrc = 'meta' }
    else if (visits != null) {
      const fs = followShare(history, c.first, c.last)
      if (fs) { follows = Math.round(visits * fs.share); followsSrc = 'estimate'; share = r2(fs.share * 100) }
    }
    const paid = kind === 'chat' || kind === 'form'
    rows.push({
      id: c.id, name: c.name, title: promoName(c.name), kind, post: c.post ? `https://www.instagram.com/p/${c.post}/` : null,
      first: c.first, last: c.last, spend: r2(spend), impr: t ? num(t.impr) : sum('impr'),
      reach: t ? num(t.reach) : null, visits, visitsSrc, follows, followsSrc, share,
      // a promotion paid for conversations is judged by conversations: no price per follower
      cpf: !paid && follows > 0 ? r2(spend / follows) : null, cpv: visits > 0 ? r2(spend / visits) : null,
    })
  }
  rows.sort((x, y) => (y.last || '').localeCompare(x.last || '') || y.spend - x.spend)
  const notes = []
  if (!a.campaigns) notes.push('охват по кампаниям появится после ночного обновления архива')
  if (a.probe && a.probe.visits === false) notes.push('Meta не отдала посещения профиля из рекламы — у рекламы на профиль взяты клики по ссылке (оценка)')
  if (rows.some((x) => x.followsSrc === 'estimate')) notes.push('подписки с рекламы Meta не даёт — оценка: посещения профиля × доля «подписались ÷ зашли в профиль» всего аккаунта за те же дни')
  if (rows.some((x) => x.visits != null && x.follows == null)) notes.push('у части продвижений нет истории Instagram за их дни — подписчики неизвестны')
  return { rows, notes, currency: a.currency || '' }
}

// Followers from ads over [from, to] (a week, a month) by the daily packs: [7] profile visits, [8] follows.
// followers — from all ads; promo — from reach / profile ads (kind 'other') with their spend and price per follower.
export function promoPeriod(a, kinds = {}, history = {}, from, to) {
  if (a?.v !== 2 || !a.days) return null
  const until = a.until || (a.day ? shift(a.day, -1) : null)
  const dates = Object.keys(a.days).sort()
  if (!dates.length || !until || from > until || to < dates[0]) return null
  const end = to < until ? to : until
  const o = { spendPromo: 0, visits: 0, visitsPromo: 0, clicksProfile: 0, follows: 0, followsPromo: 0 }
  let visitsKnown = true, followsKnown = true, rows = 0
  for (let d = from < dates[0] ? dates[0] : from; d <= end; d = shift(d, 1)) {
    for (const [id, p] of Object.entries(a.days[d] || {})) {
      if (!Array.isArray(p)) continue
      rows++
      const promo = (kinds[id] || 'other') === 'other'
      if (promo) o.spendPromo += num(p[0])
      if (toProfile(a.ads?.[id]?.set)) o.clicksProfile += num(p[2])
      if (p[7] != null) { o.visits += p[7]; if (promo) o.visitsPromo += p[7] } else if (num(p[0]) > 0) visitsKnown = false
      if (p[8] != null) { o.follows += p[8]; if (promo) o.followsPromo += p[8] } else if (num(p[0]) > 0) followsKnown = false
    }
  }
  const out = { from: from < dates[0] ? dates[0] : from, to: end, spendPromo: r2(o.spendPromo), visits: null, visitsSrc: null, followers: null, followersPromo: null, followersSrc: null, share: null, cpf: null, accountFollows: null, currency: a.currency || '' }
  // the account's follows of the same days (Instagram history), to compare
  let af = 0, afDays = 0
  for (let d = out.from; d <= end; d = shift(d, 1)) if (history?.[d]?.follows != null) { af += history[d].follows; afDays++ }
  if (afDays) out.accountFollows = af
  out.accountDays = afDays
  out.days = span(out.from, end)
  if (!rows) { Object.assign(out, { visits: 0, followers: 0, followersPromo: 0, followersSrc: 'meta', visitsSrc: 'meta', note: 'реклама не крутилась' }); return out }
  if (followsKnown && rows) { out.followers = o.follows; out.followersPromo = o.followsPromo; out.followersSrc = 'meta' }
  if (visitsKnown) { out.visits = o.visits; out.visitsSrc = 'meta' } else if (o.clicksProfile) { out.visits = o.clicksProfile; out.visitsSrc = 'clicks' }
  if (out.followers == null && out.visits != null) {
    const fs = followShare(history, out.from, end)
    if (fs) {
      out.share = r2(fs.share * 100)
      out.followers = Math.round(out.visits * fs.share)
      out.followersPromo = Math.round((out.visitsSrc === 'meta' ? o.visitsPromo : o.clicksProfile) * fs.share)
      out.followersSrc = 'estimate'
    } else out.note = 'нет истории Instagram за эти дни — подписчиков с рекламы не оценить'
  } else if (out.followers == null) out.note = 'Meta не дала ни подписок, ни посещений профиля из рекламы'
  if (out.followersPromo > 0 && o.spendPromo > 0) out.cpf = r2(o.spendPromo / out.followersPromo)
  return out
}

// ---------- 2. who really talks ----------

// cut rows [ad_id, label, spend, impr, clicks, chats, leads, deep, block] of one kind, summed by label
export function cutGroups(rows, kinds = {}, kind = 'chat') {
  const by = {}
  for (const r of rows || []) {
    const [id, label, spend, impr, clicks, chats, leads, deep, block] = r
    if ((kinds[id] || 'other') !== kind) continue
    const g = (by[label] ||= { label, spend: 0, impr: 0, clicks: 0, chats: 0, leads: 0, deep: 0, block: 0 })
    g.spend += num(spend); g.impr += num(impr); g.clicks += num(clicks); g.chats += num(chats); g.leads += num(leads); g.deep += num(deep); g.block += num(block)
  }
  return Object.values(by)
}
const priced = (g, chats, deep) => ({ ...g, spend: r2(g.spend), cpc: g.chats ? r2(g.spend / g.chats) : null, cpq: g.deep ? r2(g.spend / g.deep) : null, live: pct(g.deep, g.chats), shareChats: pct(g.chats, chats), shareDeep: pct(g.deep, deep) })

// age × gender of chat ads, 90 days: all conversations next to live ones (3+ messages)
export function adPortrait(a, kinds = {}, cut = 'age:last_90d') {
  const rows = a?.cuts?.[cut]
  if (!Array.isArray(rows)) return null
  const all = cutGroups(rows, kinds, 'chat')
  const known = all.filter((g) => g.chats > 0 && !/неизвестно/.test(g.label))
  const chats = known.reduce((t, g) => t + g.chats, 0), deep = known.reduce((t, g) => t + g.deep, 0)
  if (!chats) return { rows: [], chats: 0, deep: 0, sex: [] }
  const sex = ['женщины', 'мужчины'].map((s) => {
    const g = known.filter((x) => x.label.includes(s)).reduce((o, x) => ({ label: s, spend: o.spend + x.spend, chats: o.chats + x.chats, deep: o.deep + x.deep }), { label: s, spend: 0, chats: 0, deep: 0 })
    return priced(g, chats, deep)
  }).filter((g) => g.chats)
  return { rows: known.map((g) => priced(g, chats, deep)).sort((x, y) => y.deep - x.deep || y.chats - x.chats), chats, deep, sex, live: pct(deep, chats) }
}

// reach / profile ads by age × gender: whom they were shown to (not who writes)
export function otherReach(a, kinds = {}, cut = 'age:last_90d') {
  const rows = a?.cuts?.[cut]
  if (!Array.isArray(rows)) return null
  const list = cutGroups(rows, kinds, 'other').filter((g) => g.impr > 0 && !/неизвестно/.test(g.label))
  const impr = list.reduce((t, g) => t + g.impr, 0)
  return list.map((g) => ({ label: g.label, spend: r2(g.spend), impr: g.impr, clicks: g.clicks, share: pct(g.impr, impr) })).sort((x, y) => y.impr - x.impr)
}

const REGION_RU = { astana: 'Астана', 'nur-sultan': 'Астана', almaty: 'Алматы', shymkent: 'Шымкент', 'akmola region': 'Акмолинская обл.', 'karaganda region': 'Карагандинская обл.', 'almaty region': 'Алматинская обл.', 'pavlodar region': 'Павлодарская обл.', 'kostanay region': 'Костанайская обл.', 'north kazakhstan region': 'Северо-Казахстанская обл.', 'east kazakhstan region': 'Восточно-Казахстанская обл.', 'west kazakhstan region': 'Западно-Казахстанская обл.', 'aktobe region': 'Актюбинская обл.', 'atyrau region': 'Атырауская обл.', 'mangystau region': 'Мангистауская обл.', 'kyzylorda region': 'Кызылординская обл.', 'zhambyl region': 'Жамбылская обл.', 'turkistan region': 'Туркестанская обл.', 'south kazakhstan region': 'Туркестанская обл.', 'ulytau region': 'Улытауская обл.', 'abai region': 'Абайская обл.', 'zhetysu region': 'Жетысуская обл.' }
export const regionRu = (label) => REGION_RU[String(label || '').trim().toLowerCase()] || label
const isAstana = (label) => /astana|nur-sultan|астана|нур-султан/i.test(label || '')

// conversations by region (Meta's `region`), 90 days: Astana against the rest
export function regionsOf(a, kinds = {}) {
  const rows = a?.cuts?.['region:last_90d']
  if (!Array.isArray(rows)) return null
  const list = cutGroups(rows, kinds, 'chat').filter((g) => g.chats > 0 && !/неизвестно|unknown/i.test(g.label))
  const chats = list.reduce((t, g) => t + g.chats, 0), deep = list.reduce((t, g) => t + g.deep, 0)
  if (!chats) return { rows: [], chats: 0, deep: 0 }
  const by = {}
  for (const g of list) { const k = regionRu(g.label); const x = (by[k] ||= { label: k, spend: 0, chats: 0, deep: 0 }); x.spend += g.spend; x.chats += g.chats; x.deep += g.deep }
  const out = Object.values(by).map((g) => priced(g, chats, deep)).sort((x, y) => y.chats - x.chats)
  const ast = out.filter((g) => isAstana(g.label)).reduce((o, g) => ({ spend: o.spend + g.spend, chats: o.chats + g.chats, deep: o.deep + g.deep }), { spend: 0, chats: 0, deep: 0 })
  const rest = { spend: list.reduce((t, g) => t + g.spend, 0) - ast.spend, chats: chats - ast.chats, deep: deep - ast.deep }
  return { rows: out, chats, deep, astana: priced({ label: 'Астана', ...ast }, chats, deep), rest: priced({ label: 'другие регионы', ...rest }, chats, deep) }
}

// hours of the zone `tz` east of UTC, now (Kazakhstan has no summer time; a US zone of the ad account would)
function offsetH(tz) {
  try {
    const d = new Date()
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]))
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d.getTime() / 6e4) * 6e4) / 36e5)
  } catch { return 5 }
}
const DAY_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
// «пн–пт 9–18, сб 10–14» from cfg.managerHours ({ 1: [9, 18], …, 6: [10, 14] }; a missing day is a day off)
export function hoursText(mh = {}) {
  const parts = []
  for (let d = 1; d <= 7; d++) {
    const w = mh[d % 7]
    if (!w) continue
    const key = `${w[0]}–${w[1]}`
    const last = parts.at(-1)
    if (last && last.key === key && last.to === d - 1) last.to = d; else parts.push({ key, from: d, to: d })
  }
  return parts.map((x) => `${DAY_RU[x.from % 7]}${x.to > x.from ? `–${DAY_RU[x.to % 7]}` : ''} ${x.key}`).join(', ')
}

// Conversations by hour (Meta gives the ad account's hours, all days together), moved to Astana time and set against the
// manager's hours: «outside» = an hour no working day covers; «outsideWeek» ≈ with days off, if every day is alike.
export function hoursOf(a, kinds = {}, managerHours = {}, tz = null) {
  const rows = a?.cuts?.['hour:last_90d']
  if (!Array.isArray(rows)) return null
  const move = offsetH(ASTANA) - offsetH(tz || a.tz || ASTANA)
  const by = Array.from({ length: 24 }, (_, h) => ({ h, chats: 0, deep: 0, spend: 0 }))
  for (const g of cutGroups(rows, kinds, 'chat')) {
    const h0 = Number(String(g.label).slice(0, 2))
    if (!Number.isInteger(h0) || h0 < 0 || h0 > 23) continue
    const x = by[(((h0 + move) % 24) + 24) % 24]
    x.chats += g.chats; x.deep += g.deep; x.spend += g.spend
  }
  const chats = by.reduce((t, x) => t + x.chats, 0), deep = by.reduce((t, x) => t + x.deep, 0)
  if (!chats) return { byHour: by.map((x) => ({ h: x.h, chats: 0, deep: 0 })), chats: 0, deep: 0, hours: hoursText(managerHours) }
  const wins = Object.entries(managerHours || {}).filter(([, w]) => Array.isArray(w) && w.length === 2)
  const covered = (h) => wins.filter(([, [s, e]]) => h >= s && h < e).length
  let out = 0, outDeep = 0, outWeek = 0
  for (const x of by) {
    const c = covered(x.h)
    if (!c) { out += x.chats; outDeep += x.deep }
    outWeek += x.chats * (1 - c / 7)
  }
  const peak = [...by].sort((x, y) => y.chats - x.chats).slice(0, 3).filter((x) => x.chats).map((x) => x.h)
  return {
    byHour: by.map((x) => ({ h: x.h, chats: x.chats, deep: x.deep, work: covered(x.h) > 0 })), chats, deep, hours: hoursText(managerHours), known: wins.length > 0,
    outside: pct(out, chats), outsideDeep: pct(outDeep, deep), outsideWeek: Math.round((outWeek / chats) * 100), peak, moved: move || 0,
  }
}

// ---------- 3. placements and video ----------

const PLACE = (label) => (/Reels/.test(label) ? 'Reels' : /сторис/.test(label) ? 'сторис' : /лента|видеолента/.test(label) ? 'лента' : 'прочее')
// chat ads by placement (feed / Reels / stories / other): the price of a conversation and of a live one
export function placesOf(a, kinds = {}, cut = 'place:last_90d') {
  const rows = a?.cuts?.[cut]
  if (!Array.isArray(rows)) return null
  const list = cutGroups(rows, kinds, 'chat')
  const by = {}
  for (const g of list) {
    const k = PLACE(g.label)
    const x = (by[k] ||= { label: k, spend: 0, chats: 0, deep: 0, impr: 0, parts: [] })
    x.spend += g.spend; x.chats += g.chats; x.deep += g.deep; x.impr += g.impr
    if (g.spend >= 0.5) x.parts.push(g.label)
  }
  const chats = Object.values(by).reduce((t, x) => t + x.chats, 0), deep = Object.values(by).reduce((t, x) => t + x.deep, 0)
  return { rows: Object.values(by).filter((x) => x.spend >= 0.5).map((x) => priced(x, chats, deep)).sort((x, y) => y.spend - x.spend), chats, deep }
}

// Ad videos that ran in the last `days` days: does the start hook (3-second views ÷ impressions), do they watch to the end
// (100% ÷ 3-second views), average seconds. Lifetime numbers of each ad; small ones (under `minImpr` impressions) left out.
export function videosOf(a, kinds = {}, { days = 90, top = 6, minImpr = 500 } = {}) {
  if (a?.v !== 2 || !a.ads) return null
  const until = a.until || (a.day ? shift(a.day, -1) : null)
  const since = until ? shift(until, -(days - 1)) : null
  const lastOf = {}
  for (const [d, m] of Object.entries(a.days || {})) for (const [id, p] of Object.entries(m || {})) if (p?.[0] > 0 && (!lastOf[id] || d > lastOf[id])) lastOf[id] = d
  const list = Object.entries(a.ads)
    .filter(([id, x]) => x.total?.video && num(x.total.impr) >= minImpr && (!since || (lastOf[id] || '') >= since))
    .map(([id, x]) => {
      const v = x.total.video, impr = num(x.total.impr)
      const v3 = v.v3 ?? null
      return {
        id, name: x.name, kind: kinds[id] || 'other', impr, v3, p25: v.p25 ?? null, p50: v.p50 ?? null, p75: v.p75 ?? null, p100: v.p100 ?? null, avg: v.avg ?? null,
        hook: v3 != null ? pct(v3, impr) : null, done: v3 && v.p100 != null ? pct(v.p100, v3) : null, last: lastOf[id] || null,
      }
    })
    .sort((x, y) => y.impr - x.impr)
  return { rows: list.slice(0, top), total: list.length }
}

// ---------- all of it for the portal (compact) ----------

export function adsMore(a, kinds, history, cfg = {}) {
  if (a?.v !== 2) return null
  const p = promos(a, kinds, history)
  const pr = p?.rows || []
  const withF = pr.filter((x) => x.follows != null)
  const portrait = adPortrait(a, kinds)
  return {
    currency: a.currency || '', day: a.day || null,
    promos: { rows: pr.slice(0, 10), byFollowers: [...withF].sort((x, y) => y.follows - x.follows).slice(0, 3), byCost: withF.filter((x) => x.cpf != null && x.follows >= 3).sort((x, y) => x.cpf - y.cpf).slice(0, 3), notes: p?.notes || [] },
    portrait: portrait ? { rows: portrait.rows.slice(0, 6), sex: portrait.sex, chats: portrait.chats, deep: portrait.deep, live: portrait.live ?? null } : null,
    regions: regionsOf(a, kinds), hours: hoursOf(a, kinds, cfg.managerHours, a.tz),
    places: placesOf(a, kinds), videos: videosOf(a, kinds),
  }
}
