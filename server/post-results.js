// Мадина learns from what her posts really did, not only from the owner's corrections.
// Plain code, no Claude: once a day every Instagram post is measured about 3 and 7 days after it went out.
// The office's own posts (published from the weekly pack, matched by mediaId) are what Мадина learns from:
// their lines go to data/memory/smm-результаты.md, compared only with the office's posts of the same kind
// (videos with videos, pictures with pictures). Posts not from the pack (the marketers' reels, manual posts) go to
// smm-результаты-другие.md and are shown to her only as topic ideas. Stories are ranked among stories
// (insta-archive.js → smm-сторис.md). The best own posts become samples in knowledge/образцы/.
// A number Meta did not give is null (unknown), never 0; a failed measurement is tried again later.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { storyLines, storyArchive } from './insta-archive.js'

const FILE = path.join(P.data, 'memory', 'posts.json')
const LINES = path.join(P.data, 'memory', 'smm-результаты.md')
const OTHERS = path.join(P.data, 'memory', 'smm-результаты-другие.md')
const STORIES = path.join(P.data, 'memory', 'smm-сторис.md')
const SAMPLES = path.join(P.knowledge, 'образцы')
const METRICS = ['reach', 'saved', 'shares', 'total_interactions', 'views', 'follows', 'profile_visits']
// Meta gives no follows and profile visits for Reels (the office's post-videos are Reels too)
const REELS_METRICS = ['reach', 'saved', 'shares', 'total_interactions', 'views']
// measured between these ages in days: a figure taken later is not a 3- or 7-day figure
const WINDOWS = { d3: [3, 5], d7: [7, 9] }
// a post missed at 7–9 days (the office was down) is measured once up to this age, labelled, never compared
const LATE = 30
const MAX_TRIES = 3
const MAX_SAMPLES = 6
const MIN_GROUP = 4

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const ru = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit' })
const num = (v) => { const x = Array.isArray(v) ? v[0]?.value : v; return x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x) }
const fmt = (v) => Math.round(v).toLocaleString('ru-RU')
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const writeText = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, 'utf8') }
const typeOf = (m) => (m.media_product_type === 'REELS' ? 'Рилс' : m.media_type === 'CAROUSEL_ALBUM' ? 'Карусель' : m.media_type === 'VIDEO' ? 'Видео' : 'Пост')
const isVideo = (p) => p.type === 'Рилс' || p.type === 'Видео'
const group = (p) => `${p.own ? 'own' : 'other'}:${isVideo(p) ? 'video' : 'picture'}`
const GROUP_RU = { 'own:video': 'посты-видео офиса', 'own:picture': 'посты и карусели офиса', 'other:video': 'рилсы не из пакета', 'other:picture': 'посты не из пакета' }
const label = (p) => (p.own ? (p.type === 'Карусель' ? 'Карусель' : isVideo(p) ? 'Пост-видео' : 'Пост') : `${p.type} (не из пакета офиса)`)
const median = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const eng = (d) => (d.saved == null && d.shares == null ? null : (d.saved || 0) + (d.shares || 0))

// posts.json written before 19.11.2026: a failed measurement was stored as zeros, Reels got «follows 0»
function repair(state) {
  for (const p of Object.values(state.posts || {})) {
    for (const k of ['d3', 'd7']) {
      if (!p[k]) continue
      if (!p[k].reach) { delete p[k]; continue }
      if (isVideo(p)) for (const x of ['follows', 'profile_visits']) if (p[k][x] === 0) p[k][x] = null
    }
  }
  return state
}

// a post of the office's weekly pack (smm-pack keeps only the last 12 packs: an old mark is kept)
function tag(p, item) {
  if (item) { p.own = true; p.video = !!item.asVideo } else p.own ??= false
}

export class PostResults {
  constructor({ meta, smmPack }) {
    Object.assign(this, { meta, smmPack })
    this.state = repair(read(FILE, { day: '', posts: {} }))
    this.state.posts ||= {}
  }

  save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(this.state))
    fs.renameSync(`${FILE}.tmp`, FILE)
  }

  // once a day after 10:00; a run where Meta did not answer is repeated 2 hours later (at most 3 runs a day)
  start() {
    const due = () => {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
      if (this.state.day !== ymd(new Date()) && h >= 10 && !this.busy && !(this.state.retryAt > Date.now())) {
        this.busy = this.run().catch((e) => { console.error('Результаты постов:', e.message); this.state.retryAt = Date.now() + 2 * 3600e3 }).finally(() => { this.busy = null })
      }
    }
    setTimeout(due, 2 * 60 * 1000).unref?.()
    setInterval(due, 30 * 60 * 1000).unref?.()
  }

  // the account's posts of the last LATE days, page by page (bounded)
  async media(id) {
    const out = []
    let after
    for (let i = 0; i < 5; i++) {
      const r = await this.meta.api(`${id}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url', limit: 50, ...(after ? { after } : {}) })
      out.push(...(r.data || []))
      after = r.paging?.cursors?.after
      const oldest = out.at(-1)?.timestamp
      if (!r.paging?.next || !after || (oldest && Date.now() - Date.parse(oldest) > (LATE + 1) * 864e5)) break
    }
    return out
  }

  packItems() {
    const map = new Map()
    for (const x of (this.smmPack?.state?.packs || []).flatMap((p) => p.items || [])) if (x.mediaId) map.set(x.mediaId, x)
    return map
  }

  // lifetime numbers at this age; null when Meta did not answer (a published post never has 0 reach)
  async measure(m, age) {
    const reels = m.media_product_type === 'REELS'
    const asked = reels ? REELS_METRICS : METRICS
    const s = await this.meta.insights(m.id, asked, { period: 'lifetime' }).catch(() => ({}))
    const d = Object.fromEntries(METRICS.map((x) => [x, asked.includes(x) ? num(s[x]) : null]))
    if (!d.reach) return null
    d.age = Math.round(age * 10) / 10
    if (reels) {
      const w = num((await this.meta.insights(m.id, ['ig_reels_avg_watch_time'], {}).catch(() => ({}))).ig_reels_avg_watch_time)
      if (w != null) d.watch = Math.round(w / 100) / 10
    }
    return d
  }

  async run() {
    const id = this.meta.m?.igUserId
    if (!id) return
    const media = await this.media(id)
    const own = this.packItems()
    const now = Date.now()
    let failed = 0
    for (const m of media) {
      const age = (now - Date.parse(m.timestamp)) / 864e5
      if (age > LATE) continue
      const p = (this.state.posts[m.id] ||= { date: m.timestamp, type: typeOf(m), caption: String(m.caption || '').slice(0, 2200), link: m.permalink })
      tag(p, own.get(m.id))
      for (const [k, [from, to]] of Object.entries(WINDOWS)) {
        if (p[k] || age < from || age > to) continue
        const d = await this.measure(m, age)
        if (!d) { failed++; continue }
        p[k] = d
        if (k === 'd7') p.image = m.thumbnail_url || m.media_url || null
      }
      if (!p.d7 && !p.late && age > WINDOWS.d7[1]) {
        const d = await this.measure(m, age)
        if (d) { p.late = d; p.image ||= m.thumbnail_url || m.media_url || null } else failed++
      }
    }
    for (const [k, p] of Object.entries(this.state.posts)) if (now - Date.parse(p.date) > 180 * 864e5) delete this.state.posts[k]
    // older posts are not in the media list any more: tag them by the packs too (stored before `own` existed)
    for (const [k, p] of Object.entries(this.state.posts)) tag(p, own.get(k))
    const today = ymd(new Date())
    const tries = this.state.tries?.day === today ? this.state.tries : { day: today, n: 0 }
    tries.n++
    this.state.tries = tries
    if (failed && tries.n < MAX_TRIES) this.state.retryAt = now + 2 * 3600e3
    else { this.state.day = today; delete this.state.retryAt }
    if (failed) console.error(`Результаты постов: Meta не дала цифры по ${failed} замерам${tries.n < MAX_TRIES ? ' — повтор через 2 часа' : ''}`)
    this.save()
    this.writeLines()
    await this.pickSamples()
  }

  // usual 7-day reach of posts like this one (same group), published before it: the median of the last 20
  usual(id) {
    const p = this.state.posts[id], g = group(p)
    const r = Object.entries(this.state.posts).filter(([k, x]) => k !== id && x.d7?.reach && group(x) === g && x.date < p.date)
      .sort((a, b) => b[1].date.localeCompare(a[1].date)).slice(0, 20).map(([, x]) => x.d7.reach)
    return r.length >= MIN_GROUP ? { reach: median(r), n: r.length } : null
  }

  line(id) {
    const p = this.state.posts[id], d = p.d7 || p.late
    const u = p.d7 ? this.usual(id) : null
    const ratio = u ? d.reach / u.reach : null
    const verdict = ratio == null ? '' : ratio >= 1.3 ? ' — выше обычного' : ratio <= 0.7 ? ' — ниже обычного' : ' — как обычно'
    const parts = [p.d7
      ? `охват за 7 дней ${fmt(d.reach)}${u ? ` (×${ratio.toFixed(1).replace('.', ',')} к обычному ${fmt(u.reach)} у «${GROUP_RU[group(p)]}», по ${u.n})` : ' (сравнить не с чем: похожих публикаций пока меньше 4)'}`
      : `охват за ${Math.round(d.age)} дн. ${fmt(d.reach)} (замер опоздал — не сравнивается)`]
    if (p.d3?.reach) parts.push(`за 3 дня ${fmt(p.d3.reach)}`)
    if (isVideo(p) && d.views != null) parts.push(`просмотров ${fmt(d.views)}`)
    for (const [k, name] of [['saved', 'сохранений'], ['shares', 'репостов'], ['follows', 'подписок'], ['profile_visits', 'переходов в профиль']]) if (d[k] != null) parts.push(`${name} ${d[k]}`)
    if (d.watch) parts.push(`досмотр ${String(d.watch).replace('.', ',')} с`)
    return `- ${ru(p.date)} ${label(p)} «${p.caption.replace(/\s+/g, ' ').slice(0, 70)}…»: ${parts.join(', ')}${verdict}`
  }

  // the lines are rebuilt from posts.json every day: own posts, the others apart, the stories
  writeLines() {
    const done = Object.entries(this.state.posts).filter(([, p]) => p.d7 || p.late).sort((a, b) => a[1].date.localeCompare(b[1].date))
    const own = done.filter(([, p]) => p.own).map(([id]) => this.line(id)).slice(-25)
    const other = done.filter(([, p]) => !p.own).map(([id]) => this.line(id)).slice(-10)
    writeText(LINES, own.length ? `${own.join('\n')}\n` : '')
    writeText(OTHERS, other.length ? `${other.join('\n')}\n` : '')
    writeText(STORIES, `${storyLines(14).join('\n')}\n`)
  }

  // how a post did against posts of its own group: the mean of the ratios it has (reach, saves+shares,
  // interactions, views); null metrics are skipped, so Reels are ranked by what Meta gives for them
  scorer(list) {
    const meds = {}
    for (const g of new Set(list.map(([, p]) => group(p)))) {
      const ps = list.filter(([, p]) => group(p) === g).map(([, p]) => p.d7)
      meds[g] = ps.length >= MIN_GROUP ? { reach: median(ps.map((d) => d.reach)), eng: median(ps.map(eng)), total_interactions: median(ps.map((d) => d.total_interactions)), views: median(ps.map((d) => d.views)) } : null
    }
    return (p) => {
      const m = meds[group(p)]
      if (!m) return null
      const r = [['reach', p.d7.reach], ['eng', eng(p.d7)], ['total_interactions', p.d7.total_interactions], ['views', p.d7.views]]
        .filter(([k, v]) => v != null && m[k]).map(([k, v]) => v / m[k])
      return r.length ? r.reduce((t, x) => t + x, 0) / r.length : null
    }
  }

  // the office's own posts that did best (last 120 days) become samples; posts not from the pack only as topic ideas
  async pickSamples() {
    const since = Date.now() - 120 * 864e5
    const list = Object.entries(this.state.posts).filter(([, p]) => p.d7?.reach && Date.parse(p.date) > since)
    if (!list.length) return
    const score = this.scorer(list)
    const meds = Object.fromEntries([...new Set(list.map(([, p]) => group(p)))].map((g) => [g, median(list.filter(([, p]) => group(p) === g).map(([, p]) => p.d7.reach))]))
    const rank = (l) => l.map(([id, p]) => [id, p, score(p)]).filter(([, , s]) => s != null && s > 1.2).sort((a, b) => b[2] - a[2])
    const best = rank(list.filter(([, p]) => p.own)).slice(0, MAX_SAMPLES)
    const ideas = rank(list.filter(([, p]) => !p.own)).slice(0, 2)
    const nums = (p) => [['saved', 'сохранений'], ['shares', 'репостов'], ['follows', 'подписок']].filter(([k]) => p.d7[k] != null).map(([k, n]) => `${n} ${p.d7[k]}`).join(', ')
    fs.mkdirSync(SAMPLES, { recursive: true })
    const keep = new Set()
    const parts = []
    for (const [id, p] of best) {
      // the office's own mockup when it published the post, else Instagram's picture
      let pic = [`${id}.png`, `${id}.jpg`].find((f) => fs.existsSync(path.join(SAMPLES, f)))
      if (!pic) {
        const own = this.ownPicture(id)
        if (own) { pic = `${id}.png`; fs.copyFileSync(own, path.join(SAMPLES, pic)) }
        else if (p.image && await this.meta.download(p.image, path.join(SAMPLES, `${id}.jpg`))) pic = `${id}.jpg`
      }
      if (pic) keep.add(pic)
      parts.push([
        `## ${ru(p.date)} · ${label(p)} · охват ${fmt(p.d7.reach)} (обычно ${fmt(meds[group(p)])} у «${GROUP_RU[group(p)]}»)${nums(p) ? `, ${nums(p)}` : ''}`,
        pic ? `Картинка: образцы/${pic}` : 'Картинки нет',
        p.link || '',
        '', p.caption, '',
      ].join('\n'))
    }
    for (const f of fs.readdirSync(SAMPLES)) if (/\.(jpg|png)$/.test(f) && !keep.has(f)) fs.rmSync(path.join(SAMPLES, f), { force: true })
    fs.writeFileSync(path.join(SAMPLES, 'образцы.md'), [
      '# Образцы: публикации офиса Altyn Qala, которые сработали лучше всего',
      'Отобраны офисом сами по цифрам через 7 дней после выхода (охват, сохранения и репосты, просмотры — против обычного у таких же публикаций офиса), за последние 4 месяца. Равняйся на подачу, а не копируй: факты бери из базы.',
      '', ...(parts.length ? parts : ['Пока мало замеренных публикаций офиса, чтобы выбрать лучшие.', '']),
      ...(ideas.length ? [
        '# Не из пакета офиса (рилсы маркетологов, ручные посты) — только идеи тем',
        'Это не твои работы и другой формат: подачу с них не бери, смотри только, какая тема зашла.', '',
        ...ideas.map(([, p]) => `- ${ru(p.date)} ${p.type}: охват ${fmt(p.d7.reach)} (обычно ${fmt(meds[group(p)])}) — «${p.caption.replace(/\s+/g, ' ').slice(0, 160)}» ${p.link || ''}`),
      ] : []),
    ].join('\n'), 'utf8')
  }

  // the mockup the office itself published, if this post came from a weekly pack
  ownPicture(mediaId) {
    for (const pack of this.smmPack?.state.packs || []) {
      const x = pack.items.find((i) => i.mediaId === mediaId)
      if (x?.images[0] && fs.existsSync(x.images[0])) return x.images[0]
    }
    return null
  }
}

// A short result per published media id, for the weekly pack in the portal: posts at 3/7 days, stories at their last hour.
export function mediaResults() {
  const out = {}
  for (const [id, p] of Object.entries(read(FILE, { posts: {} }).posts || {})) {
    const d = p.d7 || p.late || p.d3
    if (!d?.reach) continue
    const when = p.d7 ? 'за 7 дней' : p.late ? `за ${Math.round(p.late.age)} дн.` : 'за 3 дня'
    out[id] = [`охват ${when} ${fmt(d.reach)}`, d.saved != null ? `сохранений ${d.saved}` : '', d.shares != null ? `репостов ${d.shares}` : ''].filter(Boolean).join(', ')
  }
  for (const s of Object.values(storyArchive())) {
    if (s.reach == null) continue
    out[s.id] = [`охват ${fmt(s.reach)}`, s.replies != null ? `ответов ${s.replies}` : '', s.profile_visits != null ? `в профиль ${s.profile_visits}` : '', s.nav?.tap_exit != null ? `вышли ${s.nav.tap_exit}` : ''].filter(Boolean).join(', ') + (Date.now() - Date.parse(s.date) < 23 * 36e5 ? ' (сторис ещё висит)' : '')
  }
  return out
}

// 👍 from the owner on Мадина's work: her pictures and text become samples next to the best posts
export function likeWork(task) {
  const dir = path.join(SAMPLES, 'понравилось')
  const pngs = (task.files || []).filter((f) => /\.png$/i.test(f.path)).slice(0, 3)
  fs.mkdirSync(dir, { recursive: true })
  const names = []
  for (const f of pngs) {
    const name = `${task.id}-${path.basename(f.path)}`
    try { fs.copyFileSync(path.join(P.work, task.id, f.path), path.join(dir, name)); names.push(name) } catch {}
  }
  const list = path.join(SAMPLES, 'понравилось.md')
  const old = fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split('\n## ').slice(1) : []
  const entry = [`${new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })} · ${task.title}`, names.length ? `Картинки: ${names.map((n) => `образцы/понравилось/${n}`).join(', ')}` : 'Без картинок', '', String(task.result || '').slice(0, 800)].join('\n')
  const kept = [...old, entry].slice(-8)
  const used = kept.join('\n')
  for (const f of fs.readdirSync(dir)) if (!used.includes(f)) fs.rmSync(path.join(dir, f), { force: true })
  fs.writeFileSync(list, `# Работы, которые владелец оценил 👍\nРавняйся на подачу и стиль; факты всё равно бери из базы.\n\n## ${kept.join('\n\n## ')}\n`, 'utf8')
}
