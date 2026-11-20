import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { saveConfig } from './config.js'
import { followerLog, growth, byDay } from './followers.js'
import { DEFAULT_TZ, dayAgo, ours, kindByGoal, KIND_RU, accountActive, accountGrace, accountReason, AD_PROBLEM, refusedField, followsOf, visitsOf } from './ads-rules.js'
import { adKinds } from './ads-archive.js'

// Read-only access to Instagram and the Meta ad account. The office fetches the numbers itself
// and hands the analyst plain files: the token never reaches an employee.

const VERSION = 'v23.0'
// insights fields Meta added after v23.0 (instagram_profile_visits, Dec 2025) are tried on this version too
export const NEWER_VERSION = 'v24.0'
const MAX_IMAGE = 5 * 1024 * 1024

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)

function explain(err) {
  if (!err) return 'Meta не ответила'
  if (err.code === 190) return 'Токен Meta недействителен или истёк — создайте новый (⚙ → Meta).'
  if ([4, 17, 32, 613, 80004].includes(err.code)) return 'Meta временно ограничила число запросов — попробуйте через час.'
  if (err.code === 10 || err.code === 200 || /permission/i.test(err.message || '')) return `Не хватает разрешения у токена: ${err.message}`
  return err.message || 'ошибка Meta'
}

// Last 7 full days and the 7 days before them, by the calendar of `tz` (Astana unless the ad account says otherwise).
export function weeks(tz = DEFAULT_TZ) {
  return {
    current: { since: dayAgo(tz, 7), until: dayAgo(tz, 1) },
    previous: { since: dayAgo(tz, 14), until: dayAgo(tz, 8) },
  }
}
// insights fields that tell what an ad is for; if Meta rejects them, the call is repeated without them
const GOAL_FIELDS = ['objective', 'optimization_goal']

const unix = (date, end = false) => Math.floor(new Date(`${date}T${end ? '23:59:59' : '00:00:00'}+05:00`).getTime() / 1000)

export class Meta extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.error = null
  }

  get m() { return this.cfg.meta }

  status() {
    const m = this.m
    const acc = (m.adAccounts || []).find((a) => a.id === m.adAccountId)
    return {
      configured: !!m.token,
      instagram: m.igUsername || null,
      adAccount: acc ? { id: acc.id, name: acc.name, currency: acc.currency, tz: acc.tz || null } : null,
      adAccounts: (m.adAccounts || []).map((a) => ({ id: a.id, name: a.name })),
      error: this.error,
    }
  }

  async api(pathname, params = {}, token = this.m.token, version = null) {
    const url = new URL(`https://graph.facebook.com/${version || this.m.apiVersion || VERSION}/${pathname}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) {
      const msg = explain(data.error)
      if (data.error?.code === 190) this.setError(msg)
      // the Graph code travels with the error: callers tell «not supported» (#100) from a passing failure
      throw Object.assign(new Error(msg), { graphCode: data.error?.code })
    }
    return data
  }

  async post(pathname, params = {}) {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    const res = await fetch(`https://graph.facebook.com/${this.m.apiVersion || VERSION}/${pathname}`, { method: 'POST', headers: { Authorization: `Bearer ${this.m.token}` }, body, signal: AbortSignal.timeout(60000) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) {
      const msg = `${explain(data.error)}${data.error?.code ? ` (#${data.error.code})` : ''}`
      if (data.error?.code === 190) this.setError(msg)
      throw new Error(msg)
    }
    return data
  }

  // Every page of a Graph list (bounded): Meta cuts long lists into pages of `limit`.
  async list(pathname, params = {}, maxPages = 20, version = null) {
    const out = []
    let after
    for (let i = 0; i < maxPages; i++) {
      const r = await this.api(pathname, { limit: 500, ...params, ...(after ? { after } : {}) }, undefined, version)
      out.push(...(r.data || []))
      after = r.paging?.cursors?.after
      if (!r.paging?.next || !after) break
    }
    return out
  }

  // Insights rows of the ad account, all pages, our own campaigns only (ads-rules.js ours).
  // `fields` may name objective / optimization_goal: if Meta refuses them, they are dropped.
  async adInsights(params, version = null) {
    const act = `act_${String(this.m.adAccountId).replace(/^act_/, '')}`
    let rows
    try { rows = await this.list(`${act}/insights`, params, 20, version) } catch (e) {
      // only when Meta refused the fields: a rate limit or a timeout must not double the calls
      if (!/objective|optimization_goal|nonexist|#100|invalid|not valid/i.test(String(e.message))) throw e
      const fields = String(params.fields || '').split(',').filter((f) => !GOAL_FIELDS.includes(f)).join(',')
      if (fields === params.fields) throw e
      rows = await this.list(`${act}/insights`, { ...params, fields }, 20, version)
    }
    return rows.filter(ours(this.cfg))
  }

  // A field Meta added lately: asked on the version in use, then on NEWER_VERSION. `call(version)` asks with the field,
  // `call(null)` without it. A refusal is remembered until a restart (this.fields[field] = false); a working version is kept.
  async tryField(field, call) {
    const st = (this.fields ||= {})
    if (st[field] !== false) {
      for (const v of st[field] ? [st[field]] : [...new Set([this.m.apiVersion || VERSION, NEWER_VERSION])]) {
        try { const data = await call(v); st[field] = v; return { data, field: true, version: v } } catch (e) { if (!refusedField(e, field)) throw e }
      }
    }
    const was = st[field]
    st[field] = false
    // the call fails without the field too: the field was not the problem — ask again next time
    const data = await call(null).catch((e) => { if (was !== false) delete st[field]; throw e })
    return { data, field: false }
  }

  // The ad account's state: is it running, why not, its time zone and currency. Cached for `maxAgeMs`.
  // Money (amount_spent, balance, spend_cap) comes in cents of the account currency.
  async account(maxAgeMs = 10 * 60e3) {
    if (!this.m.token || !this.m.adAccountId) return null
    if (this._acc && this._acc.id === this.m.adAccountId && Date.now() - this._acc.at < maxAgeMs) return this._acc
    const act = `act_${String(this.m.adAccountId).replace(/^act_/, '')}`
    const r = await this.api(act, { fields: 'name,currency,account_status,disable_reason,timezone_name,amount_spent,spend_cap,balance' })
      .catch(() => this.api(act, { fields: 'name,currency,account_status,disable_reason,timezone_name' }))
    const cents = (v) => (v == null || v === '' ? null : Number(v) / 100)
    const status = Number(r.account_status) || 0, disable = Number(r.disable_reason) || 0
    const spent = cents(r.amount_spent), cap = cents(r.spend_cap) || null
    const out = {
      at: Date.now(), id: this.m.adAccountId, name: r.name || '', currency: r.currency || '', tz: r.timezone_name || null,
      status, disable, active: accountActive(status), grace: accountGrace(status), reason: accountReason(status, disable),
      spent, cap, capReached: !!cap && spent != null && spent >= cap, balance: cents(r.balance),
    }
    // the zone and currency are kept in the config: windows stay right even when this call fails later
    const entry = (this.m.adAccounts || []).find((a) => a.id === this.m.adAccountId)
    if (entry && ((out.tz && entry.tz !== out.tz) || (out.currency && entry.currency !== out.currency))) {
      if (out.tz) entry.tz = out.tz
      if (out.currency) entry.currency = out.currency
      saveConfig(this.cfg)
    }
    this._acc = out
    return out
  }

  // the ad account's time zone: Meta's days (date_start) are in it
  tz() { return this._acc?.tz || this.status().adAccount?.tz || DEFAULT_TZ }
  currency() { return this._acc?.currency || this.status().adAccount?.currency || '' }

  // Ads the owner keeps switched on that Meta does not show: rejected, with an error, without billing info.
  async adProblems() {
    const act = `act_${String(this.m.adAccountId).replace(/^act_/, '')}`
    const base = 'name,status,effective_status,campaign{name,status},adset{status,end_time}'
    const params = { effective_status: Object.keys(AD_PROBLEM) }
    const list = await this.list(`${act}/ads`, { ...params, fields: `${base},issues_info,ad_review_feedback` }, 5)
      .catch(() => this.list(`${act}/ads`, { ...params, fields: base }, 5))
    const now = Date.now()
    return list.filter(ours(this.cfg))
      .filter((a) => a.status === 'ACTIVE' && (a.campaign?.status || 'ACTIVE') === 'ACTIVE' && (a.adset?.status || 'ACTIVE') === 'ACTIVE' && !(Date.parse(a.adset?.end_time || '') < now))
      .map((a) => {
        const review = Object.values(a.ad_review_feedback?.global || {}).filter(Boolean)
        const issue = (a.issues_info || []).map((x) => x.error_summary || x.error_message).filter(Boolean)
        return { id: a.id, name: a.name, campaign: a.campaign?.name || '', st: a.effective_status, what: AD_PROBLEM[a.effective_status] || a.effective_status, why: String(review[0] || issue[0] || '').slice(0, 200) }
      })
  }

  setError(msg) {
    this.error = msg
    this.emit('status')
  }

  async configure(token, adAccountId) {
    if (token) {
      token = String(token).trim()
      if (!/^EA[A-Za-z0-9]{40,}$/.test(token)) throw new Error('Это не похоже на токен Meta: он начинается с EA… и очень длинный.')
      const errors = []
      const pages = await this.api('me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: 50 }, token)
        .catch((e) => { errors.push(e.message); return { data: [] } })
      const ads = await this.api('me/adaccounts', { fields: 'name,account_id,currency,account_status', limit: 50 }, token)
        .catch((e) => { errors.push(e.message); return { data: [] } })
      const ig = (pages.data || []).map((p) => p.instagram_business_account).find(Boolean)
      const accounts = (ads.data || []).map((a) => ({ id: a.account_id, name: a.name, currency: a.currency }))
      if (!ig && !accounts.length) {
        throw new Error(errors[0] || 'Токен работает, но к нему не привязаны ни Instagram, ни рекламный кабинет. Назначьте их пользователю системы.')
      }
      Object.assign(this.m, {
        token,
        igUserId: ig?.id || '',
        igUsername: ig?.username || '',
        adAccounts: accounts,
        adAccountId: accounts.find((a) => a.id === adAccountId)?.id || accounts[0]?.id || '',
      })
    } else if (adAccountId) {
      if (!(this.m.adAccounts || []).some((a) => a.id === adAccountId)) throw new Error('Такого рекламного кабинета нет среди доступных.')
      this.m.adAccountId = adAccountId
    }
    saveConfig(this.cfg)
    this.error = null
    this.emit('status')
    return this.status()
  }

  unlink() {
    Object.assign(this.m, { token: '', igUserId: '', igUsername: '', adAccountId: '', adAccounts: [] })
    saveConfig(this.cfg)
    this.error = null
    this.emit('status')
    return this.status()
  }

  async download(url, file) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      const buf = Buffer.from(await res.arrayBuffer())
      if (!res.ok || !buf.length || buf.length > MAX_IMAGE) return null
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, buf)
      return file
    } catch {
      return null
    }
  }

  // Tries all metrics at once, then one by one: Meta rejects the whole call if a single metric is unsupported.
  // A metric Meta did not give is null (unknown), never 0: callers must not count it as a real zero.
  async insights(id, metrics, params) {
    const pick = (data) => Object.fromEntries((data.data || []).map((d) => [d.name, d.total_value?.value ?? d.values ?? null]))
    const out = Object.fromEntries(metrics.map((m) => [m, null]))
    try {
      return { ...out, ...pick(await this.api(`${id}/insights`, { metric: metrics.join(','), ...params })) }
    } catch {
      for (const metric of metrics) {
        try { Object.assign(out, pick(await this.api(`${id}/insights`, { metric, ...params }))) } catch {}
      }
      return out
    }
  }

  // What moves followers, by day: follows and unfollows, profile visits, reach to people who do not follow yet
  // and by content type (AD / POST / REEL / STORY / CAROUSEL); follows and profile visits of recent posts and of
  // today's stories (Meta gives no follows for Reels); ads of the last 3 days with profile visits and their price.
  async igDeep(days = 10) {
    const id = this.m.igUserId
    const tv = (metric, d, extra = {}) => this.api(`${id}/insights`, { metric, period: 'day', metric_type: 'total_value', since: unix(d), until: unix(d, true), ...extra }).catch(() => ({}))
    const split = (j) => Object.fromEntries((j.data?.[0]?.total_value?.breakdowns?.[0]?.results || []).map((r) => [r.dimension_values.join('/'), r.value]))
    const daily = []
    for (let i = days; i >= 0; i--) {
      const d = ymd(new Date(Date.now() - i * 864e5))
      const [fu, rf, rt, pv] = await Promise.all([tv('follows_and_unfollows', d, { breakdown: 'follow_type' }), tv('reach', d, { breakdown: 'follow_type' }), tv('reach', d, { breakdown: 'media_product_type' }), tv('profile_views,profile_links_taps', d)])
      const f = split(fu), r = split(rf)
      const p = Object.fromEntries((pv.data || []).map((x) => [x.name, x.total_value?.value ?? null]))
      // FOLLOWER = accounts that followed, NON_FOLLOWER = accounts that unfollowed; empty while Meta has not counted the day
      daily.push({ day: d, follows: f.FOLLOWER ?? null, unfollows: f.NON_FOLLOWER ?? null, profile_views: p.profile_views ?? null, link_taps: p.profile_links_taps ?? null, reach_new: r.NON_FOLLOWER ?? null, reach_followers: r.FOLLOWER ?? null, reach_by_type: split(rt) })
    }
    const val = (j) => Object.fromEntries((j.data || []).map((x) => [x.name, x.values?.[0]?.value ?? x.total_value?.value ?? null]))
    const recent = ((await this.api(`${id}/media`, { fields: 'id,timestamp,media_type,media_product_type,permalink', limit: 12 }).catch(() => ({}))).data || [])
    const media = []
    for (const x of recent) {
      const reels = x.media_product_type === 'REELS'
      const v = val(await this.api(`${x.id}/insights`, { metric: reels ? 'reach' : 'follows,profile_visits,reach' }).catch(() => ({})))
      media.push({ date: x.timestamp, type: reels ? 'Reels' : x.media_type === 'CAROUSEL_ALBUM' ? 'Карусель' : 'Пост', link: x.permalink, follows: reels ? null : v.follows ?? null, profile_visits: reels ? null : v.profile_visits ?? null, reach: v.reach ?? null })
    }
    const stories = []
    for (const x of ((await this.api(`${id}/stories`, { fields: 'id,timestamp' }).catch(() => ({}))).data || [])) {
      const v = val(await this.api(`${x.id}/insights`, { metric: 'follows,profile_visits,reach,navigation' }).catch(() => ({})))
      stories.push({ date: x.timestamp, type: 'Сторис', follows: v.follows ?? null, profile_visits: v.profile_visits ?? null, reach: v.reach ?? null, taps: v.navigation ?? null })
    }
    const ads = []
    if (this.m.adAccountId) {
      const day = (n) => ymd(new Date(Date.now() - n * 864e5))
      const base = { level: 'ad', fields: 'ad_id,ad_name,campaign_name,spend,reach,actions', time_range: { since: day(2), until: day(0) } }
      // Instagram profile visits from ads (Meta's own count, Dec 2025); without it — link clicks of profile ads, an estimate
      const got = await this.tryField('instagram_profile_visits', (v) => this.adInsights(v ? { ...base, fields: `${base.fields},instagram_profile_visits` } : base, v)).catch(() => ({ data: [], field: false }))
      const rows = got.data.filter((r) => Number(r.spend) > 0)
      const GOALS = { PROFILE_VISIT: 'посещения профиля', CONVERSATIONS: 'переписки', LEAD_GENERATION: 'форма-заявка', REACH: 'охват', LINK_CLICKS: 'клики', POST_ENGAGEMENT: 'вовлечённость', IMPRESSIONS: 'показы', THRUPLAY: 'просмотры видео' }
      this._dest ??= {}
      for (const r of rows) {
        this._dest[r.ad_id] ??= (await this.api(r.ad_id, { fields: 'adset{destination_type,optimization_goal}' }).catch(() => ({}))).adset || {}
        const s = this._dest[r.ad_id]
        const act = (t) => Number((r.actions || []).find((a) => a.action_type === t)?.value || 0)
        // for an ad that leads to the Instagram profile Meta counts the visit as a link click
        const toProfile = s.destination_type === 'INSTAGRAM_PROFILE' || s.optimization_goal === 'PROFILE_VISIT'
        const follows = followsOf(r.actions)
        ads.push({ name: r.ad_name, goal: toProfile ? 'посещения профиля' : GOALS[s.optimization_goal] || s.optimization_goal || '—', profile: toProfile, spend: Number(r.spend), reach: Number(r.reach || 0), profileVisits: got.field ? visitsOf(r) : toProfile ? act('link_click') : null, visitsEstimate: !got.field && toProfile, ...(follows != null ? { follows } : {}), chats: act('onsite_conversion.messaging_conversation_started_7d') })
      }
    }
    return { daily, media, stories, ads }
  }

  async collectInstagram(dir, w) {
    const id = this.m.igUserId
    const account = await this.api(id, { fields: 'username,followers_count,follows_count,media_count' })
    const totals = {}
    for (const [name, range] of Object.entries(w)) {
      totals[name] = await this.insights(id, ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'follows_and_unfollows'], {
        period: 'day', metric_type: 'total_value', since: unix(range.since), until: unix(range.until, true),
      })
    }
    const followerDaily = await this.insights(id, ['follower_count'], { period: 'day', since: unix(w.previous.since), until: unix(w.current.until, true) })

    const since = unix(w.previous.since)
    const media = (await this.api(`${id}/media`, {
      fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url',
      limit: 40,
    })).data || []
    const recent = media.filter((p) => Date.parse(p.timestamp) / 1000 >= since)
    const posts = []
    for (const p of recent) {
      const stats = await this.insights(p.id, ['reach', 'views', 'saved', 'shares', 'total_interactions'], { period: 'lifetime' })
      // milliseconds in Meta's answer
      const watch = p.media_product_type === 'REELS' ? (await this.insights(p.id, ['ig_reels_avg_watch_time'], {})).ig_reels_avg_watch_time : null
      posts.push({
        id: p.id,
        date: p.timestamp,
        // a fresh post has not gathered its reach yet: compare posts of a similar age
        age_days: Math.floor((Date.now() - Date.parse(p.timestamp)) / 864e5),
        ...(watch ? { avg_watch_sec: Math.round((Array.isArray(watch) ? watch[0]?.value : watch) / 100) / 10 } : {}),
        type: p.media_product_type === 'REELS' ? 'Reels' : p.media_type === 'CAROUSEL_ALBUM' ? 'Карусель' : p.media_type === 'VIDEO' ? 'Видео' : 'Фото',
        caption: String(p.caption || '').slice(0, 400),
        link: p.permalink,
        likes: p.like_count,
        comments: p.comments_count,
        ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Array.isArray(v) ? v[0]?.value : v])),
        _image: p.thumbnail_url || (p.media_type === 'VIDEO' ? null : p.media_url),
      })
    }
    // Only the strongest posts get a picture: every image the analyst opens costs tokens.
    posts.sort((a, b) => (b.reach || 0) - (a.reach || 0))
    for (const [i, p] of posts.entries()) {
      if (i < 6 && p._image) {
        const file = await this.download(p._image, path.join(dir, 'посты', `пост-${i + 1}.jpg`))
        if (file) p.image = `_данные/посты/пост-${i + 1}.jpg`
      }
      delete p._image
    }

    // the office's own hourly counter (Meta's follower_count lags 1–2 days) and what moved followers by day
    const log = followerLog()
    const followersLive = log.length ? { now: log.at(-1)[1], at: new Date(log.at(-1)[0]).toISOString(), last24h: growth(log, 24), last72h: growth(log, 72), byDay: byDay(log).slice(-30).map(([d, n, span]) => (span ? [d, n, `за ${span} дн. — офис не записывал счётчик, это не прирост одного дня`] : [d, n])) } : null
    const deep = await this.igDeep(10).catch(() => null)
    const data = { account, followersLive, period: w, totals, followerDaily, deep, posts }
    fs.writeFileSync(path.join(dir, 'instagram.json'), JSON.stringify(data, null, 1), 'utf8')
    return { posts: posts.length, followers: account.followers_count }
  }

  async collectAds(dir, w) {
    const act = `act_${this.m.adAccountId}`
    const fields = 'campaign_name,adset_name,ad_id,ad_name,objective,optimization_goal,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions,cost_per_action_type,' +
      'video_p25_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,video_avg_time_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking'
    // the kind of every ad by its settings (the night archive), else by Meta's objective: conversations, form or reach/profile
    const kinds = adKinds()
    const periods = {}
    for (const [name, range] of Object.entries(w)) {
      periods[name] = (await this.adInsights({ level: 'ad', fields, time_range: range }))
        .map((r) => ({ тип: KIND_RU[kinds[r.ad_id] || kindByGoal({ objective: r.objective, optimization: r.optimization_goal }) || 'other'], ...r }))
    }
    const acc = { ...((this.m.adAccounts || []).find((a) => a.id === this.m.adAccountId) || { id: this.m.adAccountId }), ...(this._acc ? { currency: this._acc.currency || undefined, tz: this._acc.tz, статус: this._acc.reason } : {}) }

    const top = [...periods.current].sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0)).slice(0, 8)
    const creatives = []
    for (const [i, ad] of top.entries()) {
      try {
        const info = await this.api(ad.ad_id, { fields: 'creative{id,body,title,object_type}' })
        const c = info.creative || {}
        const thumb = c.id ? await this.api(c.id, { fields: 'thumbnail_url,image_url', thumbnail_width: 600, thumbnail_height: 600 }).catch(() => ({})) : {}
        const url = thumb.image_url || thumb.thumbnail_url
        const file = url ? await this.download(url, path.join(dir, 'креативы', `креатив-${i + 1}.jpg`)) : null
        creatives.push({ ad_id: ad.ad_id, ad_name: ad.ad_name, text: String(c.body || c.title || '').slice(0, 400), type: c.object_type, image: file ? `_данные/креативы/креатив-${i + 1}.jpg` : null })
      } catch {}
    }

    const data = { account: acc, period: w, правило: 'Полные дни по часовому поясу кабинета; парк-проект и другие исключённые кампании убраны. Цену переписки считай только по объявлениям типа «переписки», цену заявки — по «форма-заявка»; «охват / профиль» по перепискам не суди.', ads: periods, creatives }
    fs.writeFileSync(path.join(dir, 'реклама.json'), JSON.stringify(data, null, 1), 'utf8')
    await this.collectSettings(dir, [...new Set(Object.values(periods).flat().map((a) => a.ad_id))]).catch(() => {})
    const spend = periods.current.reduce((s, a) => s + Number(a.spend || 0), 0)
    return { ads: periods.current.length, spend: Math.round(spend), currency: acc.currency || '' }
  }

  // How each ad was launched: campaign objective, budget, optimisation, audience, placements.
  // Budgets come in cents of the account currency.
  async collectSettings(dir, adIds) {
    const out = []
    for (const id of adIds.slice(0, 40)) {
      try { out.push(await this.adSettings(id)) } catch {}
    }
    fs.writeFileSync(path.join(dir, 'настройки.json'), JSON.stringify(out, null, 1), 'utf8')
    return out.length
  }

  async adSettings(id) {
    const money = (v) => (v == null ? null : Number(v) / 100)
    const names = (list) => (list || []).map((x) => x.name || x.key || x.id).filter(Boolean)
    const ad = await this.api(id, { fields: 'name,effective_status,created_time,creative{call_to_action_type,object_type,body,title,instagram_permalink_url},adset{name,effective_status,optimization_goal,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,destination_type,start_time,end_time,targeting,promoted_object},campaign{name,objective,effective_status,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_categories}' })
    const s = ad.adset || {}, c = ad.campaign || {}, t = s.targeting || {}
    const geo = t.geo_locations || {}
    return {
      объявление: ad.name, ad_id: id, статус: ad.effective_status, создано: ad.created_time?.slice(0, 10),
      кнопка: ad.creative?.call_to_action_type, тип_креатива: ad.creative?.object_type, текст: String(ad.creative?.body || ad.creative?.title || '').slice(0, 300), публикация: ad.creative?.instagram_permalink_url || null,
      кампания: { название: c.name, цель: c.objective, статус: c.effective_status, стратегия_ставки: c.bid_strategy, бюджет_в_день: money(c.daily_budget), бюджет_всего: money(c.lifetime_budget), спецкатегории: c.special_ad_categories },
      группа: {
        название: s.name, статус: s.effective_status, оптимизация: s.optimization_goal, оплата_за: s.billing_event, стратегия_ставки: s.bid_strategy, ставка: money(s.bid_amount),
        бюджет_в_день: money(s.daily_budget), бюджет_всего: money(s.lifetime_budget), куда_ведёт: s.destination_type, начало: s.start_time?.slice(0, 10), конец: s.end_time?.slice(0, 10),
        приложение_или_страница: s.promoted_object,
      },
      аудитория: {
        города: (geo.cities || []).map((x) => `${x.name}${x.radius ? ` +${x.radius} ${x.distance_unit === 'mile' ? 'миль' : 'км'}` : ''}`),
        регионы: names(geo.regions), страны: geo.countries, точки: (geo.custom_locations || []).map((x) => `${x.name || `${x.latitude},${x.longitude}`} +${x.radius} ${x.distance_unit || 'км'}`),
        возраст: [t.age_min, t.age_max], пол: t.genders, языки: t.locales,
        интересы_и_поведение: (t.flexible_spec || []).map((g) => Object.values(g).flat().map((x) => x.name).filter(Boolean)),
        исключено: t.exclusions ? Object.values(t.exclusions).flat().map((x) => x.name).filter(Boolean) : [],
        свои_аудитории: names(t.custom_audiences), исключённые_аудитории: names(t.excluded_custom_audiences),
        advantage_аудитория: t.targeting_automation?.advantage_audience,
      },
      места_показа: { платформы: t.publisher_platforms || 'Advantage+ (автоматически)', instagram: t.instagram_positions, facebook: t.facebook_positions, устройства: t.device_platforms },
    }
  }

  // Writes instagram.json, реклама.json and pictures into dir. Throws only if nothing at all could be read.
  async collect(dir) {
    if (!this.m.token) throw new Error('Meta не подключена: откройте ⚙ → Meta и вставьте токен.')
    fs.mkdirSync(dir, { recursive: true })
    const w = weeks()
    const summary = { period: w, notes: [] }
    if (this.m.igUserId) {
      try { summary.instagram = await this.collectInstagram(dir, w) } catch (e) { summary.notes.push(`Instagram: ${e.message}`) }
    } else summary.notes.push('Instagram не привязан к токену.')
    if (this.m.adAccountId) {
      // ad days are the ad account's days
      await this.account().catch(() => null)
      try { summary.ads = await this.collectAds(dir, weeks(this.tz())) } catch (e) { summary.notes.push(`Реклама: ${e.message}`) }
    } else summary.notes.push('Рекламный кабинет не привязан к токену.')
    if (!summary.instagram && !summary.ads) throw new Error(summary.notes.join(' '))
    return summary
  }
}
