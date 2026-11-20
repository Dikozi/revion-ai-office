// Instagram numbers Meta does not keep: plain code, no Claude, run on the hourly followers tick.
// 1) Stories: their insights disappear 24 h after they go out, so every hour each live story is measured
//    and its latest snapshot kept in data/instagram/stories.json (newest 400).
// 2) The account by day: once a night yesterday (and the two days before, Meta counts follows late) goes
//    into data/instagram/history.json for good; the first runs also go back as far as Meta still answers.
// A number Meta did not give is null (unknown), never 0.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { followerLog } from './followers.js'
import { argLabel } from './content-brief.js'

const DIR = path.join(P.data, 'instagram')
const STORIES = path.join(DIR, 'stories.json')
const HISTORY = path.join(DIR, 'history.json')
const MAX_STORIES = 400
const STORY_METRICS = ['reach', 'views', 'replies', 'shares', 'follows', 'profile_visits', 'total_interactions', 'navigation']
const DAY_METRICS = ['views', 'profile_views', 'profile_links_taps', 'website_clicks', 'accounts_engaged', 'total_interactions']
const BACKFILL_DAYS = 730
const BACKFILL_STEP = 10

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T12:00:00+05:00`) + n * 864e5))
const unix = (date, end = false) => Math.floor(Date.parse(`${date}T${end ? '23:59:59' : '00:00:00'}+05:00`) / 1000)
const hour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const write = (f, v) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f) }
const val = (v) => { const x = Array.isArray(v) ? v[0]?.value : v; return x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x) }
// Meta limiting calls, a bad token, a timeout or a network/server hiccup: stop now, try again next hour
const busy = (e) => [1, 2, 80002].includes(e?.graphCode) || /ограничила число запросов|Токен Meta|не ответила|#80002|too many calls|unexpected error|unknown error|retry|temporar|timeout|timed out|aborted|fetch failed|ECONN|EAI_AGAIN|socket|network/i.test(e?.message || '')
// Meta says this metric or breakdown does not exist for the account: not asked again until a restart
const unsupported = (e) => e?.graphCode === 100 || /\(#100\)|not supported|unsupported|does not support|invalid metric|invalid parameter|must be one of|should be one of/i.test(e?.message || '')

// { id: { id, date, type: 'photo'|'video', link, own, pack, asVideo, at, ageH, reach, views, …, nav: {tap_forward, …} } }
export function storyArchive() { return read(STORIES, {}) }
// { days: { 'YYYY-MM-DD': { followers, new_followers, follows, unfollows, reach, reach_new, reach_followers, reach_by_type, views, profile_views, … } }, … }
export function instaHistory() { return read(HISTORY, { days: {} }) }

export class InstaArchive {
  constructor({ meta, smmPack }) {
    Object.assign(this, { meta, smmPack })
    this.bad = new Set() // metrics Meta refuses for this account: not asked again until a restart
  }

  async tick() {
    const m = this.meta.m
    if (!m?.token || !m.igUserId || this.meta.error) return
    await this.stories().catch((e) => console.error('Сторис:', e.message))
    await this.history().catch((e) => console.error('История Instagram:', e.message))
  }

  // all metrics in one call; if Meta refuses it, one by one, and a metric refused while others came is remembered
  async tolerant(id, metrics, params) {
    const ask = metrics.filter((x) => !this.bad.has(x))
    const pick = (j) => Object.fromEntries((j.data || []).map((d) => [d.name, d]))
    const out = {}
    if (!ask.length) return out
    try { return pick(await this.meta.api(`${id}/insights`, { metric: ask.join(','), ...params })) } catch (e) { if (busy(e)) throw e }
    const failed = []
    for (const metric of ask) {
      try { Object.assign(out, pick(await this.meta.api(`${id}/insights`, { metric, ...params }))) } catch (e) { if (busy(e)) throw e; if (unsupported(e)) failed.push(metric) }
    }
    if (Object.keys(out).length) for (const x of failed) this.bad.add(x)
    return out
  }

  packItems() {
    const map = new Map()
    for (const x of (this.smmPack?.state?.packs || []).flatMap((p) => p.items || [])) if (x.mediaId) map.set(x.mediaId, x)
    return map
  }

  // ---------- stories: the last snapshot before they vanish ----------

  async stories() {
    const ig = this.meta.m.igUserId
    const live = (await this.meta.api(`${ig}/stories`, { fields: 'id,media_type,timestamp,permalink' })).data || []
    if (!live.length) return 0
    const all = storyArchive()
    const own = this.packItems()
    let limited = false
    for (const s of live) {
      // Meta is limiting the calls: stop here, keep what came (the same app publishes the pack)
      let r = null
      try { r = await this.tolerant(s.id, STORY_METRICS, { period: 'lifetime' }) } catch (e) { if (busy(e)) break }
      let nav = null
      if (!this.bad.has('navigation:breakdown')) {
        try {
          const j = await this.meta.api(`${s.id}/insights`, { metric: 'navigation', breakdown: 'story_navigation_action_type', period: 'lifetime' })
          const res = j.data?.[0]?.total_value?.breakdowns?.[0]?.results
          if (res) nav = Object.fromEntries(res.map((x) => [String(x.dimension_values?.[0] || '').toLowerCase(), val(x.value)]))
        } catch (e) { if (busy(e)) limited = true; else if (unsupported(e)) this.bad.add('navigation:breakdown') }
      }
      const item = own.get(s.id)
      const old = all[s.id] || {}
      const next = {
        id: s.id, date: s.timestamp, type: s.media_type === 'VIDEO' ? 'video' : 'photo', link: s.permalink || old.link || '',
        own: !!item, pack: item?.id || null, asVideo: item ? !!item.asVideo : null, time: item?.time || null, caption: item ? String(item.caption || '').slice(0, 120) : '',
        arg: item?.arg ? argLabel(item.arg) : old.arg || null,
      }
      // a failed request keeps the earlier numbers: a null never overwrites a known value
      const nums = Object.fromEntries(STORY_METRICS.map((k) => [k, val(r?.[k]?.total_value?.value ?? r?.[k]?.values)]))
      for (const k of STORY_METRICS) next[k] = nums[k] ?? old[k] ?? null
      next.nav = nav || old.nav || null
      if (nums.reach != null || old.at == null) { next.at = new Date().toISOString(); next.ageH = Math.round((Date.now() - Date.parse(s.timestamp)) / 36e5 * 10) / 10 }
      else { next.at = old.at; next.ageH = old.ageH }
      all[s.id] = next
      if (limited) break
    }
    const kept = Object.values(all).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, MAX_STORIES)
    write(STORIES, Object.fromEntries(kept.map((x) => [x.id, x])))
    return live.length
  }

  // ---------- the account by day, kept for good ----------

  async history() {
    const h = instaHistory()
    h.days ||= {}
    const today = ymd(new Date())
    let changed = false
    if (h.night !== today && hour() >= 3) {
      for (let i = 3; i >= 1; i--) await this.day(h, addDays(today, -i)).catch((e) => { if (busy(e)) throw e })
      await this.newFollowers(h)
      this.liveFollowers(h)
      h.night = today
      h.at = new Date().toISOString()
      changed = true
    }
    // going back a few days every hour until Meta has nothing older (or stops answering)
    const b = (h.backfill ||= { done: false, next: addDays(today, -4), empty: 0, fails: 0 })
    if (!b.done && h.night) {
      for (let k = 0; k < BACKFILL_STEP && !b.done; k++) {
        const got = await this.day(h, b.next).catch((e) => (busy(e) ? 'busy' : 'fail'))
        // a passing outage only pauses; three days of it on the same date count as one refusal
        if (got === 'busy') { b.stuck = (b.stuck || 0) + 1; if (b.stuck < 72) break; b.stuck = 0 }
        if (got === 'busy' || got === 'fail') { if (++b.fails >= 6) b.done = true; break }
        b.fails = 0
        b.stuck = 0
        b.empty = got ? 0 : b.empty + 1
        b.next = addDays(b.next, -1)
        if (b.empty >= 14 || b.next < addDays(today, -BACKFILL_DAYS)) b.done = true
      }
      if (b.done) b.until = b.next
      changed = true
    }
    if (changed) write(HISTORY, h)
  }

  // one Astana day; true when Meta gave at least one number that is not 0 (an empty old day comes as zeros too)
  async day(h, date) {
    const id = this.meta.m.igUserId
    const range = { period: 'day', metric_type: 'total_value', since: unix(date), until: unix(date, true) }
    const one = async (metric, extra) => {
      try { return (await this.meta.api(`${id}/insights`, { metric, ...range, ...extra })).data?.[0] || null } catch (e) { if (busy(e)) throw e; return undefined }
    }
    const split = (d) => Object.fromEntries((d?.total_value?.breakdowns?.[0]?.results || []).map((r) => [r.dimension_values.join('/'), val(r.value)]))
    const fu = await one('follows_and_unfollows', { breakdown: 'follow_type' })
    const rf = await one('reach', { breakdown: 'follow_type' })
    const rt = await one('reach', { breakdown: 'media_product_type' })
    const rest = await this.tolerant(id, DAY_METRICS, range)
    // every request refused: the range is out of what Meta keeps, or Meta is down
    if (fu === undefined && rf === undefined && rt === undefined && !Object.keys(rest).length) throw new Error('Meta не дала данных за день')
    const f = split(fu), r = split(rf), byType = split(rt)
    const row = {
      follows: f.FOLLOWER ?? null, unfollows: f.NON_FOLLOWER ?? null,
      reach: val(rf?.total_value?.value), reach_new: r.NON_FOLLOWER ?? null, reach_followers: r.FOLLOWER ?? null,
      reach_by_type: Object.keys(byType).length ? byType : null,
      ...Object.fromEntries(DAY_METRICS.map((k) => [k, val(rest[k]?.total_value?.value)])),
    }
    const old = h.days[date] || {}
    const merged = { ...old }
    for (const [k, v] of Object.entries(row)) merged[k] = v ?? old[k] ?? null
    h.days[date] = merged
    return Object.values(row).some((v) => typeof v === 'number' && v !== 0)
  }

  // Meta's new followers per day (it keeps only the last 30 days); end_time is the end of the day
  async newFollowers(h) {
    const now = Math.floor(Date.now() / 1000)
    const j = await this.meta.api(`${this.meta.m.igUserId}/insights`, { metric: 'follower_count', period: 'day', since: now - 29 * 86400, until: now }).catch(() => null)
    for (const x of j?.data?.[0]?.values || []) {
      const d = ymd(new Date(Date.parse(x.end_time) - 864e5))
      if (val(x.value) != null && h.days[d]) h.days[d].new_followers = val(x.value)
      else if (val(x.value) != null) h.days[d] = { new_followers: val(x.value) }
    }
  }

  // the follower count at the end of each day from the office's hourly log
  liveFollowers(h) {
    const last = {}
    for (const [t, n] of followerLog()) last[ymd(new Date(t))] = n
    const today = ymd(new Date())
    for (const [d, n] of Object.entries(last)) if (d < today) (h.days[d] ||= {}).followers = n
  }
}

// Stories of the last `days`, ranked among stories only (a story is never compared with a post). Lines for Мадина.
export function storyLines(days = 14) {
  const since = Date.now() - days * 864e5
  const ended = Object.values(storyArchive()).filter((s) => Date.parse(s.date) > since && s.reach != null && Date.now() - Date.parse(s.date) > 24 * 36e5)
  // the last snapshot came early (the office or Meta was down): its reach is not final, it is not ranked
  const cut = ended.filter((s) => s.ageH != null && s.ageH < 20)
  const done = ended.filter((s) => !cut.includes(s))
  const cutLines = cut.length ? ['Замер неполный (не ранжируются):', ...cut.map((s) => `- ${new Date(s.date).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit' })} ${s.type === 'video' ? 'видео' : 'картинка'}: охват ${s.reach} — замер через ${Math.round(s.ageH)} ч после выхода`)] : []
  if (!done.length) return cutLines
  const own = done.filter((s) => s.own)
  const list = own.length >= 3 ? own : done
  const mid = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
  const usual = mid(list.map((s) => s.reach))
  const avg = (l) => Math.round(l.reduce((t, s) => t + s.reach, 0) / l.length)
  const ru = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit' })
  const name = (s) => `${ru(s.date)}${s.time ? ` ${s.time}` : ''} ${s.type === 'video' ? 'видео' : 'картинка'}${s.arg ? ` [${s.arg}]` : ''}${s.caption ? ` «${s.caption.replace(/\s+/g, ' ').slice(0, 50)}»` : ''}${s.own ? '' : ' (не из пакета)'}`
  const exits = (s) => s.nav?.tap_exit ?? null
  const extra = (s) => [s.replies != null ? `ответов ${s.replies}` : '', s.profile_visits != null ? `в профиль ${s.profile_visits}` : '', s.follows != null ? `подписок ${s.follows}` : '', exits(s) != null ? `вышли ${exits(s)}` : ''].filter(Boolean).join(', ')
  const line = (s) => `- ${name(s)}: охват ${s.reach}${usual ? ` (×${(s.reach / usual).toFixed(1).replace('.', ',')})` : ''}${extra(s) ? `, ${extra(s)}` : ''}`
  const out = [`Сторис за ${days} дней (${own.length >= 3 ? 'из пакета офиса' : 'все'}, ${list.length} шт., замер в последний час жизни; сравнивай сторис только со сторис): обычный охват ${usual ?? '—'}.`]
  const vid = list.filter((s) => s.type === 'video'), pic = list.filter((s) => s.type !== 'video')
  out.push(vid.length >= 3 && pic.length >= 3 ? `Видео: ${vid.length} шт., средний охват ${avg(vid)}; картинки: ${pic.length} шт., средний охват ${avg(pic)}.` : 'Видео против картинок: пока мало сторис для сравнения (нужно по 3 и больше).')
  if (list.length >= 5) {
    const sorted = [...list].sort((a, b) => b.reach - a.reach)
    out.push('Лучше всех:', ...sorted.slice(0, 2).map(line), 'Слабее всех:', ...sorted.slice(-2).map(line))
  } else out.push(...list.map(line))
  return [...out, ...cutLines]
}
