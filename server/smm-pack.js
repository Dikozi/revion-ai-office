// "Пакет недели": Мадина's posts and stories for the week, approved by the owner with one button,
// then published by the office itself at the planned time through the official Instagram API.
// Stories with stickers (polls, questions, links) cannot be published by the API: the owner gets a reminder.
// Every morning the office checks that yesterday's plan really appeared in Instagram.
// After the approval single-picture stories and posts become 15 s motion videos with music (server/motion.js);
// if a video fails or Instagram rejects it, the approved picture goes out instead.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { P, isInside } from './paths.js'
import { readPlan } from './initiative.js'
import { makeVideo, pickTrack } from './motion.js'

const FILE = path.join(P.data, 'smm-packs.json')
const PUB = path.join(P.data, 'smm', 'pub')
const VIDEOS = path.join(P.data, 'smm', 'video')
// publication slots chosen by the owner (17.11.2026): stories about 12:00, posts about 19:00,
// a different minute every weekday (index 0 = Sunday) so the account does not look like a robot
const SLOTS = { story: { hour: 12, minutes: [4, 0, 5, 3, 7, 2, 6] }, post: { hour: 19, minutes: [2, 4, 1, 6, 3, 0, 5] } }
const NO_RIGHTS = /permission|разрешени|доступ|\(#10\)|\(#200\)/i
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
const at = (x) => Date.parse(`${x.date}T${x.time || '12:00'}:00+05:00`)
const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const label = (x) => `${DAYS[new Date(`${x.date}T12:00:00+05:00`).getUTCDay()]} ${x.date.slice(8, 10)}.${x.date.slice(5, 7)} ${x.time || ''}`.trim()
const KIND = { post: 'пост', carousel: 'карусель', story: 'сторис', reel: 'рилс' }
const STICKER = { question: 'вопрос', poll: 'опрос', quiz: 'викторина', slider: 'слайдер', link: 'ссылка', countdown: 'обратный отсчёт', mention: 'упоминание', location: 'место' }
// Мадина may write a sticker as text or as {type, text, options, link_note}
export function stickerText(st) {
  if (!st) return null
  if (typeof st !== 'object') return String(st).slice(0, 300)
  const kind = STICKER[st.type] || st.type || 'наклейка'
  const opts = Array.isArray(st.options) ? ` — ${st.options.join(' / ')}` : ''
  const note = st.link_note || st.note || st.url || st.link
  return `${kind}: ${st.text || st.question || ''}${opts}${note ? ` (${note})` : ''}`.slice(0, 300)
}
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}` }

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300) || `ffmpeg ${code}`))))
  })
}

export class SmmPack extends EventEmitter {
  constructor({ cfg, store, office, initiative, meta, ffmpeg, browser }) {
    super()
    Object.assign(this, { cfg, store, office, initiative, meta, ffmpeg, browser })
    this.state = { packs: [] }
    try { this.state = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {}
    this.state.packs ??= []
    store.on('task', (t) => { try { this.onTask(t) } catch (e) { console.error('Пакет недели:', e.message) } })
    initiative.on('smm-pack', (p, yes) => { try { this.decide(p, yes) } catch (e) { console.error('Пакет недели:', e.message) } })
  }

  save() {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(this.state, null, 1), 'utf8')
    fs.renameSync(FILE + '.tmp', FILE)
  }

  get enabled() { return this.cfg.smm?.autopublish !== false }
  get videoOn() { return this.cfg.smm?.video !== false && !!this.browser && !!this.ffmpeg }
  current() { return this.state.packs.at(-1) || null }

  start() {
    setInterval(() => this.tick().catch((e) => console.error('Пакет недели:', e.message)), 60 * 1000).unref?.()
    try { this.upgrade() } catch (e) { console.error('Пакет недели:', e.message) }
    // public copies left by a publication cut short by a restart
    try { for (const d of fs.readdirSync(PUB)) { const dir = path.join(PUB, d); if (Date.now() - fs.statSync(dir).mtimeMs > 3600e3) fs.rmSync(dir, { recursive: true, force: true }) } } catch {}
    // videos of published weeks are not needed for long
    try { for (const f of fs.readdirSync(VIDEOS)) { const file = path.join(VIDEOS, f); if (Date.now() - fs.statSync(file).mtimeMs > 21 * 864e5) fs.rmSync(file, { force: true }) } } catch {}
  }

  // packs made before 17.11.2026: give their items the mockup (for the video) and the owner's slots;
  // server/pack-moves.json — one-time moves asked by the owner, each applied once
  upgrade() {
    let changed = false
    for (const pack of this.state.packs.filter((x) => ['review', 'approved'].includes(x.status))) {
      const seen = {}
      for (const x of pack.items.filter((i) => ['waiting', 'scheduled', 'day-review'].includes(i.status) && i.type !== 'reel' && !i.slotted).sort((a, b) => at(a) - at(b))) {
        if (x.html === undefined && x.images.length === 1) { const h = x.images[0].replace(/\.png$/i, '.html'); x.html = fs.existsSync(h) ? h : null }
        const key = `${x.date}-${x.type === 'story' ? 's' : 'p'}`
        x.time = this.slot(x.type, x.date, (seen[key] = (seen[key] ?? -1) + 1)) || x.time
        x.slotted = true
        changed = true
      }
    }
    let moves = []
    try { moves = JSON.parse(fs.readFileSync(new URL('./pack-moves.json', import.meta.url), 'utf8')) } catch {}
    this.state.moves ??= []
    for (const m of moves) {
      // a server update that comes a little late still applies the move (the item goes out at once)
      if (this.state.moves.includes(m.id) || Date.parse(`${m.to.replace(' ', 'T')}:00+05:00`) < Date.now() - 60 * 60e3) continue
      this.state.moves.push(m.id)
      changed = true
      const pack = this.state.packs.filter((x) => ['review', 'approved'].includes(x.status)).at(-1)
      const x = pack?.items.filter((i) => i.type === (m.type || 'story') && !i.manual && ['waiting', 'scheduled', 'day-review'].includes(i.status)).sort((a, b) => at(a) - at(b))[0]
      if (!x) continue
      const was = label(x)
      ;[x.date, x.time] = m.to.split(' ')
      this.emit('say', { text: `📅 По вашей просьбе ${KIND[x.type]} (${was}) переставлена на ${label(x)}.${this.videoOn && x.html ? ' Видео офис собирает сейчас — выйдет видео с музыкой.' : ''}${pack.status === 'review' ? '\n⚠️ Пакет ещё не утверждён — без «Утвердить неделю» она не выйдет.' : ''}` })
    }
    if (changed) this.save()
  }

  // the owner's slot for this kind and weekday; the k-th item of the same kind that day goes 40 min later
  slot(type, date, k = 0) {
    if (this.cfg.smm?.times === false) return null
    const s = { ...SLOTS, ...(this.cfg.smm?.times || {}) }[type === 'story' ? 'story' : 'post']
    if (!s) return null
    const m = (s.hour ?? 12) * 60 + (Number(s.minutes?.[new Date(`${date}T12:00:00+05:00`).getUTCDay()]) || 0) + k * 40
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  // ---------- 1. assemble ----------
  // A pack comes from Мадина's пакет.json: both tasks of an approved content plan, or any later redo of hers.
  // A new pack replaces the previous one; "Исправить день" replaces only that day's items.

  readItems(task, problems) {
    let list
    try { list = JSON.parse(fs.readFileSync(path.join(P.work, task.id, 'пакет.json'), 'utf8')).items || [] } catch { problems?.push(`«${task.title}» — нет файла пакет.json`); return [] }
    const out = []
    const seen = {}
    for (const it of list) {
      const images = (it.images || []).map((f) => path.join(P.work, task.id, String(f).replace(/\.html?$/i, '.png'))).filter((f) => isInside(path.join(P.work, task.id), f))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || '') || !images.length || images.some((f) => !fs.existsSync(f))) { problems?.push(`${it.date || '?'} ${KIND[it.type] || it.type || ''}: нет картинки`); continue }
      const type = it.type === 'story' ? 'story' : images.length > 1 ? 'carousel' : 'post'
      const sticker = type === 'story' ? stickerText(it.sticker) : null
      const key = `${it.date}-${type === 'story' ? 's' : 'p'}`
      const time = this.slot(type, it.date, (seen[key] = (seen[key] ?? -1) + 1)) || (/^\d{2}:\d{2}$/.test(it.time || '') ? it.time : '12:00')
      // the mockup behind a single picture: the office animates it after the approval
      const html = images.length === 1 ? images[0].replace(/\.png$/i, '.html') : null
      out.push({ id: crypto.randomBytes(4).toString('hex'), src: task.id, date: it.date, time, type, images, html: html && fs.existsSync(html) ? html : null, caption: String(it.caption || '').slice(0, 2200), sticker, manual: !!sticker, status: 'waiting' })
    }
    return out
  }

  // the content plan behind a task: its own chain of dependencies first, else the latest plan
  planOf(task) {
    const seen = new Set()
    const queue = [...(task?.dependsOn || [])]
    while (queue.length) {
      const id = queue.shift()
      if (seen.has(id)) continue
      seen.add(id)
      if (readPlan(id)) return id
      queue.push(...(this.store.task(id)?.dependsOn || []))
    }
    return this.store.tasks.filter((x) => x.source === 'content-plan' && x.status === 'done').at(-1)?.id || null
  }

  onTask(t) {
    if (t.employee !== 'smm' || !['done', 'failed', 'cancelled'].includes(t.status)) return
    const fixPack = this.state.packs.find((x) => x.fixes?.[t.id])
    if (fixPack) return this.applyFix(fixPack, t)
    const p = t.proposal && this.initiative.state.proposals.find((x) => x.id === t.proposal)
    let tasks, from
    if (p?.kind === 'content-plan') {
      if (this.state.packs.some((x) => x.plan === p.id)) return
      tasks = (p.taskIds || []).map((id) => this.store.task(id)).filter(Boolean)
      if (!tasks.length || tasks.some((x) => !['done', 'failed', 'cancelled'].includes(x.status))) return
      from = p.id
    } else {
      // any later redo counts once Мадина wrote a pack
      if (t.status !== 'done' || !fs.existsSync(path.join(P.work, t.id, 'пакет.json')) || this.state.packs.some((x) => x.plan === t.id)) return
      tasks = [t]
      from = t.id
    }
    const problems = []
    const items = tasks.filter((x) => x.status === 'done').flatMap((x) => this.readItems(x, problems))
    if (!items.length) {
      this.emit('say', { text: `⚠️ Пакет недели не собран: ${problems.join('; ') || 'Мадина не подготовила файлы'}. Черновики — в портале → SMM.` })
      return
    }
    // a redo may cover only some days: the other days of a pack still waiting for approval carry over;
    // an approved pack keeps its other days (Thursday's pack for next week must not stop this week)
    const covered = new Set(items.map((x) => x.date))
    for (const x of this.state.packs.filter((k) => k.status === 'review').flatMap((k) => k.items)) {
      if (x.type !== 'reel' && !covered.has(x.date) && ['waiting', 'scheduled', 'day-review'].includes(x.status) && at(x) > Date.now()) items.push({ ...x, id: crypto.randomBytes(4).toString('hex'), status: 'waiting' })
    }
    const plan = readPlan(this.planOf(tasks[0]))
    // the marketers' reels from Алия's plan: no files, only a reminder and the morning check
    for (const r of (plan?.items || []).filter((x) => /рилс|reels/i.test(x.format || '') && x.date)) {
      items.push({ id: crypto.randomBytes(4).toString('hex'), src: null, date: r.date, time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : '18:00', type: 'reel', images: [], caption: r.topic || r.idea || '', sticker: null, manual: true, status: 'waiting' })
    }
    items.sort((a, b) => at(a) - at(b))
    // the new pack replaces a pack under review entirely and an approved one only on its own dates
    const active = ['waiting', 'scheduled', 'day-review', 'fixing', 'late']
    for (const old of this.state.packs.filter((x) => ['review', 'approved'].includes(x.status))) {
      const whole = old.status === 'review'
      for (const x of old.items) if (active.includes(x.status) && (whole || covered.has(x.date))) x.status = 'superseded'
      if (!whole && old.items.some((x) => active.includes(x.status) && x.status !== 'late')) continue
      old.status = 'superseded'
      for (const x of old.items) if (active.includes(x.status)) x.status = 'superseded'
      for (const op of this.initiative.state.proposals.filter((x) => x.kind === 'smm-pack' && x.pack === old.id && x.status === 'new')) { op.status = 'superseded'; op.decidedAt = new Date().toISOString() }
    }
    this.initiative.save()
    const pack = { id: crypto.randomBytes(4).toString('hex'), plan: from, week: plan?.week || '', createdAt: new Date().toISOString(), status: 'review', items, problems, fixes: {} }
    this.state.packs = [...this.state.packs, pack].slice(-12)
    this.save()
    const auto = items.filter((x) => !x.manual).length
    const text = [
      `${plural(items.filter((x) => x.type === 'post' || x.type === 'carousel').length, 'пост', 'поста', 'постов')}, ${items.filter((x) => x.type === 'story').length} сторис${items.some((x) => x.type === 'reel') ? `, ${items.filter((x) => x.type === 'reel').length} рилс маркетологов` : ''} — по дням выше.`,
      `После «Утвердить неделю» ${plural(auto, 'публикация выйдет', 'публикации выйдут', 'публикаций выйдут')} по расписанию${this.videoOn ? ': сторис и посты — видео с музыкой (офис соберёт их сам), карусели — картинками' : ''}. Если какой-то день не нравится — «Исправить день»: Мадина переделает только его.${problems.length ? `\nНе вошло: ${problems.join('; ')}.` : ''}`,
    ].join('\n\n')
    this.initiative.add({ from: 'smm', kind: 'smm-pack', urgent: true, task: null, dueDays: 2, title: `Пакет недели${pack.week ? ` ${pack.week}` : ''}`, text, pack: pack.id, preview: items.filter((x) => x.images.length).map((x) => x.images[0]).slice(0, 10), days: this.dayTexts(pack.items) })
  }

  // one message per day: time, kind and the full text, as it will go out
  dayTexts(items) {
    const days = [...new Set(items.map((x) => x.date))].sort()
    return days.map((d) => {
      const list = items.filter((x) => x.date === d && !['superseded', 'declined'].includes(x.status))
      const lines = list.map((x) => `• ${x.time} — ${KIND[x.type]}${x.type === 'reel' ? ` (снимают маркетологи): ${x.caption}` : x.sticker ? ` с наклейкой «${x.sticker}» — выложите сами` : ''}${x.type !== 'reel' && x.caption ? `\n${x.caption}` : ''}`)
      return { date: d, text: `📅 ${label({ date: d }).trim()}\n\n${lines.join('\n\n')}`.slice(0, 3900) }
    })
  }

  dates(packId) {
    const pack = this.state.packs.find((x) => x.id === packId)
    if (!pack || !['review', 'approved'].includes(pack.status)) return []
    return [...new Set(pack.items.filter((x) => x.type !== 'reel' && ['waiting', 'scheduled', 'day-review', 'late'].includes(x.status) && at(x) > Date.now()).map((x) => x.date))].sort()
  }

  decide(p, yes) {
    const pack = this.state.packs.find((x) => x.id === p.pack)
    if (!pack || pack.status !== 'review') return
    pack.status = yes ? 'approved' : 'declined'
    pack.decidedAt = new Date().toISOString()
    const now = Date.now()
    for (const x of pack.items) {
      if (x.status === 'fixing') continue // that day waits for its own approval after the fix
      x.status = !yes ? 'declined' : at(x) < now - 10 * 60e3 ? 'late' : 'scheduled'
    }
    this.save()
    if (yes) {
      const late = pack.items.filter((x) => x.status === 'late')
      const fixing = [...new Set(pack.items.filter((x) => x.status === 'fixing').map((x) => label({ date: x.date }).trim()))]
      this.emit('say', { text: `✅ Неделя утверждена: ${plural(pack.items.filter((x) => x.status === 'scheduled' && !x.manual).length, 'публикация выйдет', 'публикации выйдут', 'публикаций выйдут')} по расписанию.${this.videoOn && pack.items.some((x) => x.html && x.status === 'scheduled') ? '\nВидео для сторис и постов офис соберёт сам в ближайший час.' : ''}${fixing.length ? `\nНа исправлении: ${fixing.join(', ')} — пришлю отдельно на утверждение.` : ''}${late.length ? `\nВремя уже прошло — не выйдут: ${late.map((x) => `${label(x)} ${KIND[x.type]}`).join(', ')}.` : ''}${this.enabled ? '' : '\n⚠️ Автопубликация выключена в настройках (smm.autopublish).'}` })
      this.makeVideos().catch((e) => console.error('Видео пакета:', e.message))
    }
  }

  // "Исправить день": Мадина redoes only that day, the rest of the week keeps its approval
  fixDay(packId, date, comment) {
    const pack = this.state.packs.find((x) => x.id === packId)
    if (!pack || !['review', 'approved'].includes(pack.status)) throw new Error('Этот пакет уже неактуален')
    const day = pack.items.filter((x) => x.date === date && x.type !== 'reel' && ['waiting', 'scheduled', 'day-review', 'late'].includes(x.status))
    if (!day.length) throw new Error('В этот день нечего исправлять: всё уже вышло или день пустой')
    // the tasks that really hold the pictures: a redo may point into its own _от_коллег
    const owner = (f) => {
      const rel = path.relative(P.work, f).split(path.sep)
      const i = rel.findIndex((s) => /t-\d{6}-[0-9a-f]{6}$/.test(s) && s.includes('—'))
      return { id: i >= 0 ? s6(rel[i]) : rel[0], tail: (i >= 0 ? rel.slice(i + 1) : rel.slice(1)).join('/') }
    }
    const s6 = (s) => s.match(/(t-\d{6}-[0-9a-f]{6})$/)[1]
    const where = (f) => { const o = owner(f); return `_от_коллег/${this.office.emp(this.store.task(o.id)?.employee)?.title || 'SMM'} — ${o.id}/${o.tail}` }
    const owners = [...new Set(day.flatMap((x) => x.images).map((f) => owner(f).id))].filter((id) => this.store.task(id))
    const text = [
      `Владелец просит исправить ${label({ date }).trim()} в пакете недели. Его правка: «${comment}».`,
      '', 'Сейчас в этот день:',
      ...day.map((x) => `- ${x.time} ${KIND[x.type]}${x.sticker ? ` (наклейка: ${x.sticker})` : ''}; картинки: ${x.images.map(where).join(', ')}${x.caption ? `; текст: «${x.caption}»` : ''}`),
      '', 'Переделай только этот день по правке владельца. Новые макеты рисуй у себя (html, офис нарисует png). Что правка не задевает — оставь: в images можно указать путь к прежней картинке в _от_коллег.',
      `Запиши пакет.json только с пунктами дня ${date}: {"items":[{"date":"${date}","time":"ЧЧ:ММ","type":"post" или "story","images":[...],"caption":"полный текст","sticker":null}]}. Остальные дни не трогай.`,
    ].join('\n')
    const task = this.office.addTask('smm', text, { source: 'pack-fix', dependsOn: owners })
    pack.fixes ??= {}
    pack.fixes[task.id] = date
    for (const x of day) { x.before = x.status; x.status = 'fixing' }
    this.save()
    return task
  }

  applyFix(pack, t) {
    const date = pack.fixes[t.id]
    delete pack.fixes[t.id]
    const old = pack.items.filter((x) => x.date === date && x.status === 'fixing')
    // the slot is the one of the fixed day, whatever date Мадина wrote
    const seen = {}
    const fresh = t.status === 'done' ? this.readItems(t).map((x) => { const k = x.type === 'story' ? 's' : 'p'; return { ...x, date, time: this.slot(x.type, date, (seen[k] = (seen[k] ?? -1) + 1)) || x.time } }) : []
    if (!fresh.length) {
      for (const x of old) { x.status = x.before || 'waiting'; delete x.before }
      this.save()
      this.emit('say', { text: `⚠️ Мадина не смогла исправить ${label({ date }).trim()} — день остался как был. ${t.error || ''}`.trim() })
      return
    }
    for (const x of old) x.status = 'superseded'
    const approved = pack.status === 'approved'
    for (const x of fresh) x.status = approved ? 'day-review' : 'waiting'
    pack.items = [...pack.items, ...fresh].sort((a, b) => at(a) - at(b))
    this.save()
    const day = this.dayTexts(fresh)[0]
    this.emit('day', { pack: pack.id, date, approved, text: `✏️ Мадина исправила ${label({ date }).trim()}.\n\n${day.text}${approved ? '' : '\n\nВойдёт в пакет — утвердите неделю как обычно.'}`, images: fresh.map((x) => x.images[0]).slice(0, 10) })
  }

  approveDay(packId, date) {
    const pack = this.state.packs.find((x) => x.id === packId)
    if (!pack || pack.status !== 'approved') throw new Error('Этот пакет уже неактуален')
    const list = pack.items.filter((x) => x.date === date && x.status === 'day-review')
    if (!list.length) throw new Error('Этот день уже утверждён')
    for (const x of list) x.status = at(x) < Date.now() - 10 * 60e3 ? 'late' : 'scheduled'
    this.save()
    this.makeVideos().catch((e) => console.error('Видео пакета:', e.message))
    return list.filter((x) => x.status === 'scheduled').length
  }

  // ---------- 2. motion videos, one at a time, earliest publication first ----------

  videoItems() {
    return this.state.packs.filter((p) => p.status === 'approved').flatMap((p) => p.items)
      .filter((x) => x.status === 'scheduled' && !x.manual && (x.type === 'story' || x.type === 'post') && x.html && !x.video && !x.videoError && at(x) - Date.now() > -20 * 60e3)
      .sort((a, b) => at(a) - at(b))
  }

  async makeVideos() {
    if (this.videoBusy || !this.videoOn) return
    this.videoBusy = true
    const failed = []
    try {
      const music = Array.isArray(this.cfg.smm?.music) && this.cfg.smm.music.length ? this.cfg.smm.music : undefined
      for (let x = this.videoItems()[0]; x; x = this.videoItems()[0]) {
        fs.mkdirSync(VIDEOS, { recursive: true })
        const out = path.join(VIDEOS, `${x.id}.mp4`)
        try {
          if (!fs.existsSync(x.html) || !fs.existsSync(x.images[0])) throw new Error('нет макета')
          const r = await makeVideo({ browser: this.browser, ffmpeg: this.ffmpeg, html: x.html, png: x.images[0], out, track: await pickTrack(music) })
          x.video = out
          x.music = r.track
        } catch (e) {
          x.videoError = String(e.message || e).slice(0, 200)
          failed.push(x)
        }
        this.save()
      }
    } finally {
      this.videoBusy = false
    }
    if (failed.length) this.emit('say', { text: `⚠️ Не собралось видео — выйдет утверждённая картинка, как раньше:\n${failed.map((x) => `• ${label(x)} ${KIND[x.type]}: ${x.videoError}`).join('\n')}` })
  }

  // ---------- 3. publish on time ----------

  // a slow video upload must not let the next minute publish the same item again
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try { await this.publishDue() } finally { this.ticking = false }
    this.makeVideos().catch((e) => console.error('Видео пакета:', e.message))
  }

  async publishDue() {
    const now = Date.now()
    for (const pack of this.state.packs.filter((x) => x.status === 'approved')) {
      for (const x of pack.items.filter((i) => i.status === 'scheduled' && at(i) <= now)) {
        if (now - at(x) > 6 * 3600e3) { x.status = 'missed'; this.save(); continue }
        if (x.manual) {
          x.status = 'reminded'
          this.save()
          this.emit('say', x.type === 'reel'
            ? { text: `🎬 Сейчас по плану рилс (${label(x)}): ${x.caption}. Его снимают и выкладывают маркетологи.` }
            : { text: `📲 Пора выложить сторис (${label(x)}) — с наклейкой: ${x.sticker}.\nКартинка ниже: сохраните и опубликуйте из Instagram, наклейку добавьте при публикации.`, files: x.images })
          continue
        }
        if (!this.enabled) continue
        // approved just before the time: wait up to 20 min for its video instead of posting the picture
        if (this.videoOn && x.html && !x.video && !x.videoError && (x.type === 'story' || x.type === 'post') && now - at(x) < 20 * 60e3) continue
        await this.publish(x).catch((e) => {
          x.tries = (x.tries || 0) + 1
          x.error = e.message
          if (x.tries >= 3 || NO_RIGHTS.test(e.message)) {
            x.status = 'failed'
            this.emit('say', { text: `⚠️ Не вышла публикация ${label(x)} (${KIND[x.type]}): ${e.message}${/permission|разрешени|доступ|#10|#200/i.test(e.message) ? '\nСкорее всего, у офиса нет права публиковать: нужно добавить его в настройках Meta Business (инструкция — в docs/возможности.md, раздел «Пакет недели»).' : ''}`, files: x.images.slice(0, 1) })
          }
        })
        this.save()
      }
    }
    this.remindUnapproved(now)
    await this.morningCheck().catch((e) => console.error('Проверка публикаций:', e.message))
  }

  // Nothing goes out without the button: a reminder 20 h and again 2 h before the first publication.
  remindUnapproved(now) {
    for (const pack of this.state.packs.filter((x) => x.status === 'review')) {
      const first = pack.items.filter((x) => x.type !== 'reel' && x.status === 'waiting' && at(x) > now).sort((a, b) => at(a) - at(b))[0]
      const p = this.initiative.state.proposals.find((x) => x.kind === 'smm-pack' && x.pack === pack.id && x.status === 'new')
      if (!first || !p) continue
      const left = at(first) - now
      const step = left <= 2 * 3600e3 ? 2 : left <= 20 * 3600e3 ? 1 : 0
      if (step <= (pack.reminded || 0)) continue
      pack.reminded = step
      this.save()
      this.emit('say', {
        text: `⏰ Пакет недели${pack.week ? ` ${pack.week}` : ''} ещё не утверждён. Первая публикация — ${label(first)} (${KIND[first.type]}): без кнопки она не выйдет.`,
        buttons: [[{ text: '✅ Утвердить неделю', callback_data: `py:${p.id}` }], [{ text: '✏️ Исправить день', callback_data: `kf:${pack.id}` }, { text: '✖️ Не публиковать', callback_data: `pn:${p.id}` }]],
      })
    }
  }

  // Instagram fetches files itself: JPEG copies (or the mp4) are served under an unguessable path while publishing
  async publicUrl(file) {
    const token = crypto.randomBytes(12).toString('hex')
    const dir = path.join(PUB, token)
    fs.mkdirSync(dir, { recursive: true })
    const video = /\.mp4$/i.test(file)
    const out = path.join(dir, path.basename(file).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') + (video ? '.mp4' : '.jpg'))
    if (video) fs.copyFileSync(file, out)
    else {
      if (!this.ffmpeg) throw new Error('нет ffmpeg для перевода картинки в JPEG')
      await run(this.ffmpeg.ffmpeg, ['-v', 'error', '-y', '-i', file, '-q:v', '2', out])
    }
    const base = String(this.cfg.portalWeb?.publicUrl || '').replace(/\/$/, '')
    if (!/^https:/.test(base)) throw new Error('у портала нет публичного адреса HTTPS')
    return { url: `${base}/pub/${token}/${encodeURIComponent(path.basename(out))}`, dir }
  }

  // a picture is ready in seconds, a video may take minutes
  async container(params, video = false) {
    const ig = this.meta.m.igUserId
    const c = await this.meta.post(`${ig}/media`, params)
    for (let i = 0; i < (video ? 60 : 20); i++) {
      const s = await this.meta.api(c.id, { fields: 'status_code' })
      if (s.status_code === 'FINISHED') return c.id
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram не принял файл (${s.status_code})`)
      await new Promise((r) => setTimeout(r, video ? 5000 : 3000))
    }
    throw new Error('Instagram слишком долго обрабатывает файл')
  }

  async publish(x) {
    const ig = this.meta.m.igUserId
    if (!this.meta.m.token || !ig) throw new Error('Instagram не подключён')
    const dirs = []
    try {
      let id = null
      // the motion video first; anything but missing rights falls back to the approved picture
      if (x.video && !x.videoError && this.cfg.smm?.video !== false && fs.existsSync(x.video)) {
        id = await this.videoContainer(x, dirs).catch((e) => {
          if (NO_RIGHTS.test(e.message)) throw e
          x.videoError = `Instagram не принял видео (${String(e.message).slice(0, 120)}) — вышла картинка`
          return null
        })
        x.asVideo = !!id
      }
      id ??= await this.pictureContainer(x, dirs)
      let done
      try {
        done = await this.meta.post(`${ig}/media_publish`, { creation_id: id })
      } catch (e) {
        if (!x.asVideo || NO_RIGHTS.test(e.message)) throw e
        // Instagram refused the finished video at the last step: the approved picture instead
        x.asVideo = false
        x.videoError = `Instagram не опубликовал видео (${String(e.message).slice(0, 120)}) — вышла картинка`
        done = await this.meta.post(`${ig}/media_publish`, { creation_id: await this.pictureContainer(x, dirs) })
      }
      x.mediaId = done.id
      x.status = 'published'
      x.publishedAt = new Date().toISOString()
      // saved at once: a restart now must not publish it again
      this.save()
      x.permalink = (await this.meta.api(done.id, { fields: 'permalink' }).catch(() => ({}))).permalink || ''
      if (x.type !== 'story') this.emit('say', { text: `✅ ${x.type === 'carousel' ? 'Вышла карусель' : x.asVideo ? 'Вышел пост-видео' : 'Вышел пост'} (${label(x)})${x.permalink ? `: ${x.permalink}` : ''}` })
    } finally {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
    }
  }

  async pictureContainer(x, dirs) {
    if (x.type === 'carousel') {
      const kids = []
      for (const f of x.images.slice(0, 10)) { const u = await this.publicUrl(f); dirs.push(u.dir); kids.push(await this.container({ image_url: u.url, is_carousel_item: 'true' })) }
      return this.container({ media_type: 'CAROUSEL', children: kids.join(','), caption: x.caption })
    }
    const u = await this.publicUrl(x.images[0]); dirs.push(u.dir)
    return this.container(x.type === 'story' ? { image_url: u.url, media_type: 'STORIES' } : { image_url: u.url, caption: x.caption })
  }

  // a story video, or a post as a reel shown in the feed with the approved picture as its cover
  async videoContainer(x, dirs) {
    const v = await this.publicUrl(x.video); dirs.push(v.dir)
    if (x.type === 'story') return this.container({ media_type: 'STORIES', video_url: v.url }, true)
    const c = await this.publicUrl(x.images[0]); dirs.push(c.dir)
    return this.container({ media_type: 'REELS', video_url: v.url, cover_url: c.url, caption: x.caption, share_to_feed: 'true' }, true)
  }

  // ---------- 3. morning check: did yesterday's plan appear? ----------

  async morningCheck() {
    const now = new Date()
    if (hm(now) < '08:30' || this.state.checked === ymd(now)) return
    this.state.checked = ymd(now)
    this.save()
    const yesterday = ymd(new Date(Date.now() - 864e5))
    const items = this.state.packs.filter((x) => x.status === 'approved').flatMap((p) => p.items).filter((x) => x.date === yesterday && !['declined', 'superseded'].includes(x.status))
    if (!items.length || !this.meta?.m?.token || !this.meta.m.igUserId) return
    const ig = this.meta.m.igUserId
    const media = ((await this.meta.api(`${ig}/media`, { fields: 'id,timestamp,media_product_type', limit: 30 }).catch(() => ({}))).data || []).filter((m) => ymd(new Date(m.timestamp)) === yesterday)
    const stories = ((await this.meta.api(`${ig}/stories`, { fields: 'timestamp' }).catch(() => ({}))).data || []).filter((m) => ymd(new Date(m.timestamp)) === yesterday)
    const missing = []
    // the office's own post-videos are reels too: only the marketers' ones count here
    const own = new Set(this.state.packs.flatMap((p) => p.items).map((x) => x.mediaId).filter(Boolean))
    let reels = media.filter((m) => m.media_product_type === 'REELS' && !own.has(m.id)).length
    let storyCount = stories.length - items.filter((x) => x.type === 'story' && x.status === 'published').length
    for (const x of items) {
      if (x.status === 'published') continue
      if (x.type === 'reel') { if (reels > 0) reels--; else missing.push(`рилс «${x.caption.slice(0, 60)}»`) ; continue }
      if (x.type === 'story' && x.manual) { if (storyCount > 0) storyCount--; else missing.push(`сторис ${x.time} с наклейкой (${x.sticker})`); continue }
      missing.push(`${KIND[x.type]} ${x.time}${x.error ? ` — ${x.error}` : ''}`)
    }
    if (missing.length) this.emit('say', { text: `🔎 Проверил вчерашний план Instagram — не вышло:\n${missing.map((m) => `• ${m}`).join('\n')}` })
  }
}

// /pub/<token>/<file>: the only public files of the portal, alive just while Instagram fetches them
export function publicFile(pathname) {
  // the names are made by publicUrl from [\w.-] only; the portal has already decoded the path
  const m = pathname.match(/^\/pub\/([0-9a-f]{24})\/([\w.-]+\.(?:jpg|mp4))$/)
  if (!m) return null
  const file = path.join(PUB, m[1], m[2])
  return isInside(PUB, file) && fs.existsSync(file) ? file : null
}
