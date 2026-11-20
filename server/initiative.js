import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { P } from './paths.js'
import { buildArgs, childEnv, runClaude } from './claude.js'
import { numbersBrief } from './director.js'
import { loadSources, refreshBook, readBook, setMonthReport, monthLabel } from './months.js'
import { weekFacts, weekPrompt, weekSchema, weekMessage, weekHtml, weekMarkdown, cleanWords, lastWeekMonday, weeksBook, saveWeek, monthFacts, monthPrompt, monthSchema, monthMessage, monthHtml, monthMarkdown, monthXlsx, renderPdf, explainRefusals } from './reports.js'
import { adNumbers, adKinds } from './ads-archive.js'
import { lastDays, shift, kindByGoal, kindByResult, isPaid, KIND_RU } from './ads-rules.js'
import { followerLog, growth, followersFacts } from './followers.js'
import { readLog, isSale, isUnbook } from './sales-rules.js'
import { markOk, markFail, enabled, sourceAlerts } from './sources.js'
import { checkPlan, readBrief, storyRule, madinaLines } from './content-brief.js'

// Employees with initiative:
// - a watchdog checks Meta numbers every few hours with plain code (no Claude, no limit spent);
// - only when it spots something, Алия (marketing) looks into it and may propose an action;
// - every Monday the team holds a short planning meeting: up to 5 proposals for the week.
// Proposals reach the owner with "Делать / Не надо"; decisions are remembered per employee.

const FILE = path.join(P.data, 'initiative.json')
const MEMORY = path.join(P.data, 'memory')
const WATCH_EVERY_H = 3
const WEEKLY = { day: 1, hour: 10 } // Monday 10:00 Astana
const REPORTS = { day: 1, hour: 9 } // Monday 9:00: the weekly report (numbers by code, words by Диас), ready before the planning
const CONTENT = { day: 4, hour: 10 } // Thursday 10:00: Алия plans NEXT week, so the pack is approved before Monday
const MAX_PROPOSALS = 5
const RULES = () => path.join(MEMORY, 'правила-месяца.md')
// Нурлан proposes the month goals (no report): the portal button and the reports when a month has none
export const GOALS_TASK = 'Предложи цели на этот месяц для страницы «План»: выручка, продажи, предельная цена переписки, сколько трёхкомнатных продать и к какой дате. Считай от темпа, остатков и срока сдачи 2027. Сохрани только цели-месяца.json по образцу из твоих правил, отчёт не пиши. Ответ — 3–4 строки с цифрами и почему.'
export function monthRules() {
  try { return fs.readFileSync(RULES(), 'utf8').trim() } catch { return '' }
}

const WEEK_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { employee: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' }, task: { type: 'string' }, metric: { type: 'string' }, expected: { type: 'string' }, days: { type: 'integer' } }, required: ['employee', 'title', 'why', 'task'] } },
  },
  required: ['summary', 'items'],
}
const BANTER_HOURS = [10, 15] // AI-written office chatter, twice a working day

// Character that grows from experience: 0..1 traits plus a background mood (-1..1).
const START_TRAITS = {
  manager: { confidence: 0.7, sociability: 0.5, initiative: 0.7, mood: 0.2 },
  smm: { confidence: 0.6, sociability: 0.8, initiative: 0.7, mood: 0.3 },
  montazh: { confidence: 0.6, sociability: 0.2, initiative: 0.4, mood: 0 },
  marketing: { confidence: 0.6, sociability: 0.4, initiative: 0.5, mood: 0 },
  sales: { confidence: 0.5, sociability: 0.8, initiative: 0.6, mood: -0.1 },
  revenue: { confidence: 0.6, sociability: 0.3, initiative: 0.5, mood: 0 },
}
const TRAIT_RU = { confidence: 'уверенность', sociability: 'общительность', initiative: 'инициативность', mood: 'настроение' }

const BANTER_SCHEMA = {
  type: 'object',
  properties: {
    dialogues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          lines: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, text: { type: 'string' } }, required: ['who', 'text'] } },
        },
        required: ['a', 'b', 'lines'],
      },
    },
    thoughts: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, text: { type: 'string' }, mood: { type: 'integer' } }, required: ['who', 'text', 'mood'] } },
  },
  required: ['dialogues', 'thoughts'],
}

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const astana = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Almaty' }))
const addDays = (day, n) => ymd(new Date(Date.parse(`${day}T12:00:00+05:00`) + n * 864e5))
const weekday = (day) => new Date(`${day}T12:00:00+05:00`).getUTCDay()
// the Monday of next week (from Monday itself — the one in 7 days)
const nextMonday = () => { const today = ymd(new Date()); return addDays(today, ((8 - weekday(today)) % 7) || 7) }
const KRISHA_EVERY_D = 14
// What a decision is meant to move. Values come from the dashboard (plain code);
// 7 days after the work is done the office measures the metric again.
export const METRICS = {
  results: { label: 'переписки за неделю', dir: 'up', count: true },
  cpr: { label: 'цена переписки', dir: 'down' },
  ctr: { label: 'CTR рекламы', dir: 'up' },
  bookings: { label: 'брони за неделю', dir: 'up', count: true },
  sales: { label: 'продажи за неделю', dir: 'up', count: true },
  stale: { label: 'брони дольше недели', dir: 'down', count: true },
  revenue: { label: 'выручка за неделю', dir: 'up' },
  reach: { label: 'охват Instagram за неделю', dir: 'up' },
  follows: { label: 'новые подписчики за неделю', dir: 'up', count: true },
  posts: { label: 'публикации за неделю', dir: 'up', count: true },
}
const METRIC_OF_FINDING = { bron: 'stale', unbook: 'bookings', sale: 'reach', nopost: 'posts', noreel: 'reach' }
export const AREAS = { marketing: 'Маркетинг', sales: 'Продажи', revenue: 'Выручка', smm: 'SMM', montazh: 'Монтаж', manager: 'Управление' }
const SOURCES = { alert: 'Сторож рекламы', watch: 'Сторож направления', weekly: 'Планёрка Диаса', 'week-report': 'Отчёт недели', 'month-report': 'Отчёт месяца', 'content-plan': 'Контент-план Алии', signal: 'Командный центр', 'week-goal': 'План недели Нурлана', 'smm-pack': 'Пакет недели Мадины' }

// the verdict after a week: an observed change, never a proven cause
export function verdict(metric, base, now) {
  const m = METRICS[metric]
  if (!m || base == null || now == null) return { verdict: 'insufficient', note: 'нет данных для замера' }
  if (m.count && Math.max(base, now) < 3) return { verdict: 'insufficient', note: 'слишком мало событий, чтобы судить' }
  const delta = base ? Math.round(((now - base) / Math.abs(base)) * 100) : (now ? 100 : 0)
  const good = m.dir === 'up' ? delta : -delta
  return { delta, verdict: good >= 5 ? 'worked' : good <= -5 ? 'not' : 'flat', note: 'наблюдаемое изменение после выполнения, а не доказанная причина' }
}

// Алия's plan as data: { week, goal: {...}, items: [{ date, day, time, format, topic, idea, goal, by }] }
export function readPlan(taskId) {
  try { return JSON.parse(fs.readFileSync(path.join(P.work, taskId, 'контент-план.json'), 'utf8')) } catch { return null }
}
const workHours = (d = astana()) => d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 9 && d.getHours() < 18
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return `${t.getUTCFullYear()}-W${Math.ceil(((t - y) / 864e5 + 1) / 7)}`
}
const num = (v) => Number(v) || 0
// An ad alarm is sent again only when things got materially worse than when it was sent
// (by the alarm's kind: spend without results doubled, frequency +1, price +30%, CTR another −30%).
const WORSE = {
  noresult: (now, was) => now >= was * 2 && now - was >= 5,
  freq: (now, was) => now >= was + 1,
  cpc: (now, was) => now >= was * 1.3,
  ctr: (now, was) => now <= was * 0.7,
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    urgent: { type: 'boolean' },
    proposal: {
      type: 'object',
      properties: { employee: { type: 'string' }, title: { type: 'string' }, task: { type: 'string' } },
    },
  },
  required: ['message', 'urgent'],
}

const METRIC_KEYS = ['results', 'cpr', 'ctr', 'bookings', 'sales', 'stale', 'revenue', 'reach', 'follows', 'posts']
const WEEKLY_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'string' },
          task: { type: 'string' },
          metric: { type: 'string', enum: METRIC_KEYS },
          expected: { type: 'string' },
          days: { type: 'integer' },
        },
        required: ['from', 'title', 'why', 'task'],
      },
    },
  },
  required: ['proposals'],
}

export class Initiative extends EventEmitter {
  constructor({ cfg, office, store, meta, bin, employees }) {
    super()
    Object.assign(this, { cfg, office, store, meta, bin, employees })
    this.state = { lastWatch: 0, lastWeek: '', seen: {}, proposals: [], banter: null, banterSlot: '', characters: {}, krisha: { entries: [], lastAsk: 0 } }
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(FILE, 'utf8'))) } catch (e) {
      // keep a damaged file for recovery instead of overwriting it with an empty state
      if (fs.existsSync(FILE)) { try { fs.copyFileSync(FILE, FILE.replace(/\.json$/, `.broken-${Date.now()}.json`)) } catch {} }
      try { Object.assign(this.state, JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8'))) } catch {}
    }
    for (const [id, t] of Object.entries(START_TRAITS)) if (!this.state.characters[id]) this.state.characters[id] = { ...t, diary: [] }
    // the week the old chain of analyst reports already covered is not reported again after the update (19.11.2026)
    this.state.reportWeek ??= this.state.reportsWeek || ''
    this.busy = false
    office.on('notify', (n) => {
      if (n.kind === 'task_done') this.grow(n.task.employee, { confidence: 0.02, mood: 0.05 }, `сделал(а) «${n.task.title}»`)
      if (n.kind === 'task_failed') this.grow(n.task.employee, { confidence: -0.03, mood: -0.08 }, `не вышло «${n.task.title}»`)
    })
    store.on('task', (t) => { try { this.onPlanDone(t) } catch (e) { console.error('Контент-план:', e.message) } })
    // the business memory starts from the decisions already made
    if (!fs.existsSync(path.join(MEMORY, 'компания.jsonl'))) {
      for (const p of this.state.proposals.filter((x) => x.status !== 'new' && !['week-goal', 'month-goals', 'week-plan'].includes(x.kind))) { try { this.memorize(p) } catch {} }
    }
  }

  save() {
    fs.mkdirSync(P.data, { recursive: true })
    const text = JSON.stringify(this.state, null, 1)
    if (text === this.lastSaved) return
    // write-then-rename, so a power cut never leaves half a file; the previous one stays as .bak
    fs.writeFileSync(FILE + '.tmp', text, 'utf8')
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak')
    fs.renameSync(FILE + '.tmp', FILE)
    this.lastSaved = text
  }

  banterNow() {
    return this.state.banter
  }

  characters() {
    return this.state.characters
  }

  // Small, lasting shifts in character after real events, with a short diary line.
  grow(id, delta, note) {
    const c = this.state.characters[id]
    if (!c) return
    for (const [k, v] of Object.entries(delta)) {
      const lo = k === 'mood' ? -1 : 0
      c[k] = Math.round(Math.max(lo, Math.min(1, (c[k] ?? 0.5) + v)) * 100) / 100
    }
    if (note) c.diary = [...(c.diary || []), `${ymd(new Date())}: ${note}`].slice(-12)
    this.save()
    this.emit('characters', this.state.characters)
  }

  // The owner's praise: a real boost to confidence and mood, remembered in the diary.
  praise(id) {
    if (!this.state.characters[id]) throw new Error('Такого сотрудника нет')
    this.grow(id, { confidence: 0.04, mood: 0.15, initiative: 0.01 }, 'владелец похвалил 👏')
    this.emit('praise', id)
    return this.state.characters[id]
  }

  describe(id) {
    const c = this.state.characters[id]
    if (!c) return ''
    const lvl = (v) => (v >= 0.7 ? 'высокая' : v >= 0.4 ? 'средняя' : 'низкая')
    const mood = c.mood > 0.3 ? 'бодрое' : c.mood < -0.3 ? 'подавленное' : 'ровное'
    return `${TRAIT_RU.confidence} ${lvl(c.confidence)}, ${TRAIT_RU.sociability} ${lvl(c.sociability)}, ${TRAIT_RU.initiative} ${lvl(c.initiative)}, фоновое настроение ${mood}${c.diary?.length ? `; недавно: ${c.diary.slice(-3).join('; ')}` : ''}`
  }

  list() {
    return this.state.proposals.filter((p) => p.status === 'new').slice(-20)
  }

  start() {
    setTimeout(() => this.tick(), 60 * 1000).unref?.()
    setInterval(() => this.tick(), 5 * 60 * 1000).unref?.()
  }

  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const now = astana()
      const h = now.getHours()
      // no Telegram about sources at night: a night failure still failing goes out at 8:00, a night blip not at all
      if (h >= 8 && h < 22) this.watchSources()
      if (Date.now() - this.state.lastWatch > WATCH_EVERY_H * 3600e3 && h >= 8 && h < 22) await this.watch()
      // Monday at the set hour, or any later day of that week if the computer was off on Monday
      const due = (at) => now.getDay() !== at.day || h >= at.hour
      // the months: backfilled once, the ended one closed, the current one refreshed — every morning after the night archives
      if (this.state.monthsDay !== ymd(new Date()) && h >= 6) await this.refreshMonths().catch((e) => console.error('Месяцы:', e.message))
      // Monday 9:00: the weekly report — numbers by code, one run of Диас for the words; the planning goes after it
      if (this.state.reportWeek !== isoWeek(now) && due(REPORTS) && workHours(now)) {
        this.state.reportWeek = isoWeek(now)
        this.save()
        const r = await this.weekReport().catch((e) => ({ error: e.message }))
        if (r?.error) console.error('Отчёт недели:', r.error)
      }
      if (this.state.lastWeek !== isoWeek(now) && due(WEEKLY) && workHours(now) && !this.reportBusy) await this.weekly()
      // the notes of refused leads, once a day: Ерлан retells them in his own words (nothing queued — nothing run)
      if (this.state.notesDay !== ymd(new Date()) && workHours(now)) { this.state.notesDay = ymd(new Date()); this.save(); await this.explainNotes() }
      // Thursday 10:00 (or Fri–Sun if the server was off): next week's content plan, then Мадина's pack
      const wd = now.getDay(), thisMonday = addDays(nextMonday(), -7)
      // the week running when this schedule appeared (17.11.2026) already has its pack
      if (this.state.planFor === undefined) { this.state.planFor = thisMonday; this.save() }
      if (this.state.planFor !== nextMonday() && (wd > CONTENT.day || wd === 0 || (wd === CONTENT.day && h >= CONTENT.hour)) && h >= 9 && h < 21) this.weekPlan(nextMonday())
      // missed Thursday–Sunday altogether (server off): plan the rest of this week, Mon–Wed
      else if (![thisMonday, nextMonday()].includes(this.state.planFor) && wd >= 1 && wd < CONTENT.day && workHours(now)) {
        this.state.planFor = thisMonday
        this.save()
        try { this.office.addTask('marketing', this.contentPlanText(addDays(ymd(new Date()), 1), addDays(thisMonday, 6)), { source: 'content-plan' }) } catch (e) { console.error('Контент-план:', e.message) }
      }
      const slot = BANTER_HOURS.filter((x) => h >= x).pop()
      if (workHours(now) && slot !== undefined && this.state.banterSlot !== `${ymd(new Date())}-${slot}`) await this.banter(`${ymd(new Date())}-${slot}`)
      if (workHours(now)) this.askKrisha()
      const mo = this.cfg.morning === false ? { on: false } : this.cfg.morning || {}
      if (mo.on !== false && h >= (mo.hour ?? 9) && h < 21 && this.state.morningDay !== ymd(new Date())) await this.morning()
      // the 1st (up to the 3rd if the server was off) at 10:00: the monthly report on the month that ended
      const last = ymd(new Date(Date.parse(`${ymd(new Date()).slice(0, 7)}-01T12:00:00+05:00`) - 864e5)).slice(0, 7)
      if (now.getDate() <= 3 && h >= 10 && h < 21 && this.state.reviewMonth !== last) {
        const r = await this.monthReport(last).catch((e) => ({ error: e.message }))
        if (r?.error) console.error('Отчёт месяца:', r.error)
      }
      await this.measure().catch((e) => console.error('Замер результатов:', e.message))
      this.deliver()
    } catch (e) {
      console.error('Инициатива:', e.message)
    } finally {
      this.busy = false
    }
  }

  // ---------- Instagram content plan: Алия plans the week, the owner approves, Мадина prepares ----------

  smmGoal() {
    const g = this.cfg.smm || {}
    const end = new Date(`${g.goalDate || '2026-12-31'}T23:59:59+05:00`)
    const weeks = Math.max(1, Math.ceil((end - Date.now()) / (7 * 864e5)))
    return { ...g, weeks, until: end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' }) }
  }

  // from–to: next Monday–Sunday, or tomorrow–Sunday when planned in the middle of a week
  contentPlanText(from, to = addDays(from, 6)) {
    const g = this.smmGoal()
    const d = (x) => `${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][weekday(x)]} ${x.slice(8, 10)}.${x.slice(5, 7)}`
    const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) + 1
    const rule = storyRule(days)
    return [
      `Контент-план Instagram с ${d(from)} по ${d(to)} (даты в контент-план.json — от ${from} до ${to}, только эти дни).`,
      'Главное правило владельца: цель каждой публикации — продажи квартир. Сначала прочитай _данные/бриф-продаж.md — там пронумерованные факты Ф1, Ф2… (остатки и темп по комнатам, как платят, почему отказываются, кто пишет из рекламы, кто смотрит Instagram, что зашло). По ним реши, что продаём на этой неделе: какие квартиры, какое УТП, для кого.',
      `Сторис: ровно ${rule.sell} продающих и ${rule.trust} на доверие${days === 7 ? '' : ` (на ${days} дн. — пропорционально 5 + 2 в неделю)`}. Доверие — не «просто красиво»: каждая снимает конкретное возражение из брифа и ссылается на этот факт (отказ «Срок сдачи» → ход стройки; «Дорого» → рассрочка или цена за м²; «Ипотека» → условия оплаты). Посты, карусели и рилсы — тоже «продажа» или «доверие», без декоративных.`,
      'В контент-план.json сверху — "strategy": 3 короткие строки «что продаём на неделе и почему», в каждой номера фактов, например "Продаём 3-комн.: свободно 12, за 90 дн. продано 2 (Ф3)". У каждого пункта вместо прежнего goal: "kind": "продажа" или "доверие"; "focus": {"product": "3-комн.", "usp": "главный довод", "audience": "для кого", "objection": "только у доверия: какое возражение снимаем"}; "facts": ["Ф3", "Ф9"] — минимум 1, у продающих минимум 2; "why" — до 160 знаков своими словами.',
      'Цифры в why и strategy — только из фактов, на которые ссылаешься, и как в факте (без своего округления): офис сверит каждую, чужую цифру заменит фактами и покажет владельцу. Цифры в УТП — только из брифа или _база. Если какого-то факта нет (раздел «Нет данных») — не выдумывай.',
      `Подписчики — фон, не цель публикаций: ${g.followersGoal} к ${g.until} (осталось недель: ${g.weeks}). Сколько сейчас и какой темп — _данные/instagram.json. Новых подписчиков приводит в основном реклама; посты и сторис видят уже подписанные — их задача прогреть и продать, а профиль — витрина для пришедших из рекламы. Рилсы Instagram показывает и неподписанным.`,
      'В разделе «Цель» оцени, сколько подписчиков в неделю даёт реклама (подписчики по дням из instagram.json против расхода из реклама.json) и сколько органика. Бюджет не увеличивай сама — только предложи владельцу с расчётом.',
      `Норма недели: ${g.postsPerWeek} поста или карусели (делает Мадина), сторис ${g.storiesDaily ? 'каждый день' : 'по плану'} (делает Мадина), ${g.reelsPerWeek} рилсов — их снимают и монтируют маркетологи компании: поставь их в график отдельными слотами (тема — по желанию, как идея), Мадине и Тимуру их не поручай.`,
      'Время публикаций офис ставит сам: сторис около 12:00, посты около 19:00, каждый день — другая минута. В плане достаточно дня.',
      'Сторис — без наклеек Instagram (опрос, вопрос, слайдер, ссылка): офис публикует их сам, а наклейки так выложить нельзя. Вместо интерактива — призыв прямо на картинке: «напишите в WhatsApp», «сохраните», «перешлите тому, кто ищет квартиру».',
      'Если в _от_коллег есть свежий отчёт недели Диаса (отчёт-недели.md) — опирайся и на его выводы: откуда приходят клиенты, почему отказываются, что советует команда.',
    ].join('\n')
  }

  // the latest weekly report of Диас, if it is fresh (≤ 10 days): the content plan and the week plan read it
  lastWeekReport() {
    return this.store.tasks.filter((t) => t.source === 'director-report' && t.status === 'done' && Date.now() - Date.parse(t.finishedAt || 0) < 10 * 864e5).at(-1) || null
  }

  // the Thursday run: next Monday–Sunday, after the latest weekly report if there is one
  weekPlan(from) {
    this.state.planFor = from
    this.save()
    const review = this.lastWeekReport()
    try { return this.office.addTask('marketing', this.contentPlanText(from), { source: 'content-plan', dependsOn: review ? [review.id] : [] }) } catch (e) { console.error('Контент-план:', e.message) }
  }

  // a manual request (Telegram /content): Thu–Sun — next week (instead of the Thursday run),
  // Mon–Wed — from tomorrow to this Sunday, so Thursday's plan for next week does not overlap it
  contentPlan() {
    const wd = astana().getDay()
    if (wd >= CONTENT.day || wd === 0) return this.weekPlan(nextMonday())
    return this.office.addTask('marketing', this.contentPlanText(addDays(ymd(new Date()), 1), addDays(nextMonday(), -1)), { source: 'content-plan' })
  }

  // when Алия's plan is ready Мадина gets the posts and the stories at once (owner's decision 17.11.2026:
  // one approval a week — the finished pack); the plan stays visible in the portal
  onGoalDone(t) {
    if (t.employee !== 'revenue' || t.status !== 'done') return
    this.state.monthGoalsSent ??= []
    if (!this.state.monthGoalsSent.includes(t.id)) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(P.work, t.id, 'цели-месяца.json'), 'utf8'))
        this.state.monthGoalsSent = [...this.state.monthGoalsSent, t.id].slice(-30)
        const goals = { revenue: num(m.revenue) || null, sales: num(m.sales) || null, maxCpr: num(m.max_cpr) || null, threeRooms: num(m.three_rooms) || null, threeRoomsUntil: m.three_rooms_until || null, why: String(m.why || '').slice(0, 400) }
        this.add({ from: 'revenue', kind: 'month-goals', urgent: false, task: null, dueDays: 2, title: `Цели месяца: ${goals.sales || '—'} продаж${goals.revenue ? `, ≈${Math.round(goals.revenue / 1e6)} млн ₸` : ''}`, text: `${goals.maxCpr ? `Переписка не дороже ${goals.maxCpr} $. ` : ''}${goals.threeRooms ? `Продать ${goals.threeRooms} трёхкомнатных${goals.threeRoomsUntil ? ` до ${goals.threeRoomsUntil}` : ''}. ` : ''}${goals.why}`, goals })
      } catch {}
    }
    this.state.goalsSent ??= []
    if (this.state.goalsSent.includes(t.id)) return
    let g
    try { g = JSON.parse(fs.readFileSync(path.join(P.work, t.id, 'план-недели.json'), 'utf8')) } catch { return }
    this.state.goalsSent = [...this.state.goalsSent, t.id].slice(-30)
    const goal = { sales: num(g.sales), bookings: num(g.bookings), revenue: num(g.revenue), why: String(g.why || '').slice(0, 400) }
    this.add({
      from: 'revenue', kind: 'week-goal', urgent: false, task: null, dueDays: 1,
      title: `План недели: ${goal.sales} продаж, ${goal.bookings} броней`,
      text: `${goal.revenue ? `Выручка ≈${Math.round(goal.revenue / 1e6)} млн ₸. ` : ''}${goal.why}`,
      goal,
    })
  }

  onPlanDone(t) {
    this.onGoalDone(t)
    if (t.source !== 'content-plan' || t.status !== 'done') return
    this.state.plansSent ??= []
    if (this.state.plansSent.includes(t.id)) return
    this.state.plansSent = [...this.state.plansSent, t.id].slice(-30)
    const g = this.smmGoal()
    let plan = readPlan(t.id)
    // every argument checked by code against the brief Алия saw; the checked plan replaces her file
    // (her own «why» stays as why_alia), so Мадина, the portal and the pack read the same thing
    try {
      if (checkPlan(plan, readBrief(t.id))) fs.writeFileSync(path.join(P.work, t.id, 'контент-план.json'), JSON.stringify(plan, null, 1), 'utf8')
    } catch (e) { console.error('Проверка контент-плана:', e.message) }
    const argue = (story) => {
      const lines = madinaLines(plan, story)
      return lines.length ? `\n\nЗачем каждая ${story ? 'сторис' : 'публикация'} (решение Алии, цифры проверены офисом) — строй макет и текст вокруг этого. Каждая работает на продажи: заголовок на макете = УТП, на картинке — этот продукт (планировка или фото нужной квартиры), призыв — для этой аудитории. У «доверие» макет и текст отвечают на возражение фактом (ход стройки, условия оплаты, цена за м²). Цифры на макете и в тексте — только отсюда или из _база.\n${lines.join('\n')}` : ''
    }
    const own = (plan?.items || []).filter((x) => !/рилс|reels/i.test(x.format || ''))
    const posts = own.filter((x) => !/сторис|stor/i.test(x.format || '')).length || g.postsPerWeek
    const stories = own.filter((x) => /сторис|stor/i.test(x.format || '')).length || 7
    const p = this.add({
      from: 'marketing',
      kind: 'content-plan',
      silent: true,
      title: `Контент-план на неделю${plan?.week ? ` ${plan.week}` : ''}`,
      text: `${String(t.result || '').slice(0, 1500)}${plan?.checked?.note ? `\n\n${plan.checked.note}` : ''}\n\n${posts} ${posts === 1 ? 'пост' : 'поста'} и ${stories} сторис — Мадина рисует сразу, пакет придёт на утверждение; рилсы маркетологов стоят в графике отдельно. Полный план — в портале → Отчёты.`,
      tasks: [
        { employee: 'smm', dependsOn: [t.id], text: `Подготовь все посты и карусели недели по утверждённому контент-плану Алии (папка _от_коллег: контент-план.md и контент-план.json). Для каждого: пост-N.md (дата публикации — время офис поставит сам, около 19:00; текст, хэштеги, призыв «Напишите «+» в комментариях — пришлём цены и планировки в директ» (на «+» Instagram сам отвечает ссылкой на WhatsApp), сохранить или подписаться) и макет пост-N.html (для карусели — пост-N-1.html, пост-N-2.html…). Посты видят в основном уже подписанные — задача прогреть и продать; новичку из рекламы пост показывает, почему стоит подписаться. Рилсы маркетологов не делай. Макет поста — 1080x1350 (<meta name="size" content="1080x1350">). Обязательно запиши пакет.json — по нему офис сам опубликует посты после утверждения владельцем: {"items":[{"date":"ГГГГ-ММ-ДД","time":"ЧЧ:ММ","type":"post","images":["пост-1.png"],"caption":"полный текст поста с хэштегами, как он выйдет"}]} — для карусели images по порядку: ["пост-2-1.png","пост-2-2.png"]; имена картинок — как у макетов, но .png (офис нарисует их сам).${argue(false)}` },
        { employee: 'smm', dependsOn: [t.id], text: `Подготовь сторис на каждый день недели по утверждённому контент-плану Алии (папка _от_коллег: контент-план.md и контент-план.json): сторис.md — по дням текст, интерактив (опрос, вопрос, слайдер, ссылка) и время, и макеты сторис-1.html … сторис-7.html размером 1080x1920 (<meta name="size" content="1080x1920">). Сторис смотрят подписчики: прогрев и продажи — опросы, вопросы, ход стройки, планировки, «напишите в WhatsApp», «поделись с тем, кто ищет квартиру». Обязательно запиши пакет.json: {"items":[{"date":"ГГГГ-ММ-ДД","time":"12:00","type":"story","images":["сторис-1.png"],"sticker":null}]} — время офис поставит сам (около 12:00). Наклеек Instagram (опрос, вопрос, слайдер, ссылка) не ставь, sticker всегда null: офис публикует сторис сам, а наклейки так выложить нельзя. Интерактив замени призывом прямо на макете: «напишите в WhatsApp» и номер, «сохраните», «перешлите тому, кто ищет квартиру».${argue(true)}` },
      ],
    })
    this.decide(p.id, true)
  }

  // ---------- business memory: problem → hypothesis → decision → who → action → result ----------
  // Append-only, never trimmed: the company's experience grows with every decision.

  memorize(p) {
    const rec = {
      at: new Date().toISOString(), id: p.id, area: p.area || '', from: p.from, kind: p.kind,
      problem: String(p.text || '').slice(0, 400), hypothesis: p.expected || (p.metric ? `${METRICS[p.metric]?.label}: ${METRICS[p.metric]?.dir === 'up' ? 'вырастет' : 'снизится'}` : ''),
      decision: p.title, action: String(p.task?.text || p.tasks?.map((x) => x.text).join(' | ') || '').slice(0, 300),
      verdict: p.status === 'declined' ? 'declined' : p.result ? p.result.verdict : 'approved', decidedAt: p.decidedAt,
      result: p.result ? { metric: METRICS[p.metric]?.label, base: p.result.base, value: p.result.value, delta: p.result.delta } : null,
    }
    fs.mkdirSync(MEMORY, { recursive: true })
    fs.appendFileSync(path.join(MEMORY, 'компания.jsonl'), JSON.stringify(rec) + '\n', 'utf8')
    // a readable copy for the employees' prompts
    fs.writeFileSync(path.join(MEMORY, 'компания.md'), this.businessMemory(40).join('\n') + '\n', 'utf8')
  }

  businessRecords() {
    let lines = []
    try { lines = fs.readFileSync(path.join(MEMORY, 'компания.jsonl'), 'utf8').split('\n').filter(Boolean) } catch {}
    const byId = new Map()
    for (const l of lines) { try { const r = JSON.parse(l); byId.set(r.id, { ...byId.get(r.id), ...r }) } catch {} }
    return [...byId.values()].sort((a, b) => String(a.decidedAt || a.at).localeCompare(String(b.decidedAt || b.at)))
  }

  businessMemory(n = 20) {
    const word = { approved: 'утверждено, результат ещё не замерен', declined: 'владелец отклонил', worked: 'сработало', not: 'не сработало', flat: 'без заметного изменения', insufficient: 'данных недостаточно' }
    return this.businessRecords().slice(-n).map((r) => `- ${String(r.decidedAt || r.at).slice(0, 10)} [${r.area || r.from}] «${r.decision}»: ${r.problem.slice(0, 160)}${r.hypothesis ? ` → ждали: ${r.hypothesis}` : ''} → ${word[r.verdict] || r.verdict}${r.result ? ` (${r.result.metric}: ${r.result.base ?? '—'} → ${r.result.value ?? '—'})` : ''}`)
  }

  // the owner looks through the memory and decides to do something again
  reapprove(id) {
    const r = this.businessRecords().find((x) => x.id === id)
    if (!r?.action) throw new Error('Эту запись нельзя повторить')
    const old = this.state.proposals.find((p) => p.id === id)
    const employee = old?.task?.employee || old?.tasks?.[0]?.employee || r.from
    const p = this.add({ from: employee, kind: old?.kind === 'weekly' ? 'weekly' : 'signal', silent: true, urgent: false, title: r.decision, text: `Повторно из памяти бизнеса: ${r.problem}`, task: { employee, text: old?.task?.text || r.action }, metric: old?.metric || null, expected: r.hypothesis || '', again: id })
    return this.decide(p.id, true)
  }

  get strongModel() { return this.cfg.strongModel || 'opus' }

  // ---------- reports: the months book, the weekly and the monthly report (reports.js, months.js) ----------

  name(id) { return id === 'owner' ? 'Владелец' : this.employees.find((e) => e.id === id)?.name || id }
  teamLines() { return this.employees.filter((e) => e.active && e.id !== 'manager').map((e) => `- ${e.id} (${e.name || ''}, ${e.title})`) }
  teamIds() { return this.employees.filter((e) => e.active && e.id !== 'manager').map((e) => e.id) }

  // the approved goals of a month: the current ones, or an approved proposal of that month
  goalsOf(key) {
    if (this.state.goals?.month === key) return this.state.goals
    const p = this.state.proposals.filter((x) => x.kind === 'month-goals' && x.status === 'accepted' && String(x.decidedAt || '').slice(0, 7) === key).at(-1)
    return p?.goals ? { ...p.goals, month: key } : null
  }

  // media = the Instagram posts list (up to 20 requests): only for the months, the week does not use it
  async sources(fresh = false, media = true) {
    const live = await this.dashboardData?.(fresh).catch(() => null)
    return { live, src: await loadSources({ portal: this.office?.portal, crm: this.office?.crm, meta: media ? this.meta : null, live }) }
  }

  async refreshMonths() {
    this.state.monthsDay = ymd(new Date())
    this.save()
    const { src } = await this.sources()
    const { closed } = refreshBook(src, { goalsOf: (k) => this.goalsOf(k) })
    if (closed.length) console.log('Месяцы закрыты:', closed.join(', '))
  }

  // Ерлан retells the queued notes of refused leads (one cheap run, only when something is queued)
  async explainNotes() {
    try {
      const n = await explainRefusals({ crm: this.office?.crm, run: (...a) => this.run(...a) })
      if (n) console.log(`Заметки отказов: пересказано ${n}`)
    } catch (e) { console.error('Заметки отказов:', e.message) }
  }

  // the report's advice: proposals of kind 'weekly' (measured, remembered) answered by the buttons of the report itself
  adviceProposals(advice, { kind, taskId, days }) {
    return advice.map((a, i) => this.add({
      from: a.who === 'owner' ? 'manager' : a.who, kind: 'weekly', source: SOURCES[kind], silent: true, urgent: false,
      title: a.what.length > 70 ? `${a.what.slice(0, 69)}…` : a.what, text: a.expect ? `Чего ждём: ${a.expect}` : a.what,
      task: a.who === 'owner' ? null : { employee: a.who, text: `${a.what}${a.expect ? `\nЧего ждём: ${a.expect}` : ''}` },
      metric: METRICS[a.metric] ? a.metric : null, expected: a.expect || '', dueDays: days, report: taskId, n: i + 1,
    }))
  }

  openAdvice(task) { return this.state.proposals.filter((p) => p.report === task.id && p.status === 'new') }

  // a task of Диас holding the report's files in work/<id>/ (the portal serves them to the owner)
  async saveReport({ title, text, source, message, html, md, mdName, pdfName, xlsx }) {
    const task = this.store.addTask({ employee: 'manager', title, text, source, status: 'done', startedAt: new Date().toISOString() })
    const dir = path.join(P.work, task.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, mdName), md, 'utf8')
    const files = []
    if (this.browser) {
      try { const pdf = await renderPdf(this.browser, path.join(dir, `${pdfName}.html`), html); files.push({ path: path.basename(pdf), size: fs.statSync(pdf).size }) } catch (e) { console.error(`${title}, PDF:`, e.message) }
    }
    if (xlsx) { try { const f = xlsx(path.join(dir, `${pdfName}.xlsx`)); files.push({ path: path.basename(f), size: fs.statSync(f).size }) } catch (e) { console.error(`${title}, Excel:`, e.message) } }
    files.push({ path: mdName, size: Buffer.byteLength(md) })
    this.store.updateTask(task.id, { status: 'done', result: message, files, finishedAt: new Date().toISOString() })
    return this.store.task(task.id)
  }

  // Monday: the last complete Monday–Sunday. An existing report of that week is sent again unless force.
  async weekReport({ force = false } = {}) {
    if (this.reportBusy) return { error: 'Отчёт недели уже собирается' }
    const monday = lastWeekMonday(ymd(new Date()))
    const old = weeksBook().weeks[monday]
    const oldTask = old?.taskId && this.store.task(old.taskId)
    if (oldTask && !force) { this.emit('report', { task: oldTask, advice: this.openAdvice(oldTask) }); return { task: oldTask, again: true } }
    this.reportBusy = true
    try {
      await this.explainNotes()
      const { src } = await this.sources(false, false)
      const f = weekFacts(src, monday)
      if (f.kpis.every((k) => k.now == null) && !f.sources.length) return { error: 'Нет данных: шахматка, CRM и реклама не ответили' }
      const metrics = Object.keys(METRICS)
      const out = await this.run('manager', weekPrompt(f, { team: this.teamLines(), goals: this.goalsNow(), memory: this.businessMemory(8), rules: monthRules(), metrics: METRICS }), weekSchema(metrics), 'Пишет отчёт недели', { model: 'sonnet', effort: 'low', maxBudgetUsd: 0.4, timeoutMin: 6 })
      const w = cleanWords(out, f, { ids: this.teamIds(), metrics: METRICS, n: 3 })
      const names = (id) => this.name(id)
      const span = `${f.monday.slice(8, 10)}.${f.monday.slice(5, 7)}–${f.sunday.slice(8, 10)}.${f.sunday.slice(5, 7)}`
      const task = await this.saveReport({
        title: `Отчёт недели ${span}`, text: 'Цифры недели посчитаны кодом, слова — Диас', source: 'director-report',
        message: weekMessage(f, w, names), html: weekHtml(f, w, names), md: weekMarkdown(f, w, names), mdName: 'отчёт-недели.md', pdfName: `отчёт-недели-${f.monday}`,
      })
      const advice = this.adviceProposals(w.advice, { kind: 'week-report', taskId: task.id, days: 7 })
      if (w.sales != null) {
        const g = this.add({ from: 'revenue', kind: 'week-goal', silent: true, urgent: false, task: null, dueDays: 1, title: `План недели: ${w.sales} продаж, ${w.bookings ?? '—'} броней`, text: 'Диас по темпу четырёх недель (отчёт недели).', goal: { sales: w.sales, bookings: w.bookings ?? 0, revenue: 0, why: 'по темпу четырёх недель (отчёт недели)' } })
        try { this.decide(g.id, true) } catch {}
      }
      const k = (key) => f.kpis.find((x) => x.key === key)?.now ?? null
      saveWeek(monday, { from: f.monday, to: f.sunday, taskId: task.id, files: task.files.map((x) => x.path), phrase: w.phrase, sales: k('sales'), money: k('money'), leads: k('leads'), cpr: k('cpr'), currency: f.currency, extra: f.extra || 0, at: new Date().toISOString() })
      this.emit('report', { task, advice })
      this.askGoals()
      return { task }
    } finally { this.reportBusy = false }
  }

  // The 1st: closes the month (if not yet), one run of Диас writes the words and the 5 rules of the month (monthRules()).
  async monthReport(month, { force = false } = {}) {
    if (this.monthBusy) return { error: 'Отчёт месяца уже собирается' }
    const done = readBook().months[month]?.report
    const doneTask = done?.taskId && this.store.task(done.taskId)
    if (doneTask && !force) { this.state.reviewMonth = month; this.save(); this.emit('report', { task: doneTask, advice: this.openAdvice(doneTask) }); return { task: doneTask, again: true } }
    this.monthBusy = true
    this.state.reviewMonth = month
    this.save()
    try {
      await this.explainNotes()
      const { src, live } = await this.sources(true)
      const { book } = refreshBook(src, { goalsOf: (k) => this.goalsOf(k) })
      this.state.monthsDay = ymd(new Date())
      if (!book.months[month]) return { error: `Данных за ${monthLabel(month)} нет` }
      const pace = live?.home?.tiles?.find((t) => t.key === 'pace')?.detail || null
      const records = this.businessRecords().filter((r) => String(r.decidedAt || r.at).slice(0, 7) === month)
      const F = monthFacts(book, month, { pace, goals: this.goalsOf(month), leads: src.leads, records })
      const metrics = Object.keys(METRICS)
      const out = await this.run('manager', monthPrompt(F, { team: this.teamLines(), memory: this.businessMemory(15), rules: monthRules(), metrics: METRICS }), monthSchema(metrics), 'Пишет отчёт месяца', { model: this.strongModel, effort: 'medium', maxBudgetUsd: 2, timeoutMin: 12 })
      const w = cleanWords(out, F, { ids: this.teamIds(), metrics: METRICS, n: 5 })
      // the rules of the month: the same file every task and the week plan read (monthRules)
      if (w.rules.length) { fs.mkdirSync(MEMORY, { recursive: true }); fs.writeFileSync(RULES(), `${w.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`, 'utf8') }
      const names = (id) => this.name(id)
      const task = await this.saveReport({
        title: `Отчёт месяца: ${monthLabel(month)}`, text: 'Месяц закрыт: цифры посчитаны кодом, слова и правила месяца — Диас', source: 'month-report',
        message: monthMessage(F, w, names), html: monthHtml(F, w, names), md: monthMarkdown(F, w, names), mdName: 'отчёт-месяца.md', pdfName: `отчёт-месяца-${month}`,
        xlsx: (file) => monthXlsx(file, readBook()),
      })
      const advice = this.adviceProposals(w.advice, { kind: 'month-report', taskId: task.id, days: 14 })
      setMonthReport(month, { taskId: task.id, files: task.files.map((x) => x.path), phrase: w.phrase, at: new Date().toISOString() })
      this.emit('report', { task, advice })
      this.askGoals()
      return { task }
    } finally { this.monthBusy = false }
  }

  // the old name of the monthly review (Telegram /месяц and older callers)
  monthReview(month) { return this.monthReport(month) }

  // no approved goals for this month and nothing on the way: Нурлан proposes them (once a month)
  askGoals() {
    const month = ymd(new Date()).slice(0, 7)
    if (this.goalsNow() || this.state.goalsAsk === month || this.state.proposals.some((p) => p.kind === 'month-goals' && p.status === 'new')) return
    this.state.goalsAsk = month
    this.save()
    try { this.office.addTask('revenue', GOALS_TASK, { source: 'week-goal' }) } catch (e) { console.error('Цели месяца:', e.message) }
  }
  // ---------- goals of the month (Нурлан proposes, the owner approves or edits) ----------

  goalsNow() {
    const g = this.state.goals
    return g && g.month === ymd(new Date()).slice(0, 7) ? g : null
  }

  setGoals(v) {
    const n = (x) => (x === '' || x == null ? null : Number(x))
    const g = { ...(this.goalsNow() || {}), month: ymd(new Date()).slice(0, 7), revenue: n(v.revenue), sales: n(v.sales), maxCpr: n(v.maxCpr), threeRooms: n(v.threeRooms), threeRoomsUntil: v.threeRoomsUntil || null, why: String(v.why || this.goalsNow()?.why || '').slice(0, 400), approvedAt: new Date().toISOString(), editedByOwner: true }
    this.state.goals = g
    this.save()
    this.emit('changed')
    return g
  }

  // "Не актуально" / already turned into a task: the signal is hidden for 14 days
  dismiss(key, why, days = 14) {
    if (!key) return
    this.state.dismissed ??= {}
    const today = ymd(new Date())
    this.state.dismissed[key] = { at: today, why, until: ymd(new Date(Date.now() + days * 864e5)) }
    for (const [k, v] of Object.entries(this.state.dismissed)) if (v.until ? v.until < today : Date.parse(today) - Date.parse(v.at) > 14 * 864e5) delete this.state.dismissed[k]
    this.save()
    this.emit('changed')
  }

  // ---------- decisions: measure the result a week after the work is done ----------

  // older decisions were not linked to their tasks: find them by the task text
  tasksOf(p) {
    if (p.taskIds?.length) return p.taskIds.map((id) => this.store.task(id)).filter(Boolean)
    const texts = [p.task?.text, ...(p.tasks || []).map((x) => x.text)].filter(Boolean)
    return texts.length ? this.store.tasks.filter((t) => t.source === 'proposal' && texts.includes(t.text)) : []
  }

  doneAt(p) {
    if (p.status !== 'accepted') return null
    const tasks = this.tasksOf(p)
    if (!tasks.length) return p.task || p.tasks ? null : p.decidedAt
    if (!tasks.length || tasks.some((t) => !['done', 'failed', 'cancelled'].includes(t.status))) return null
    return tasks.map((t) => t.finishedAt || t.createdAt).sort().at(-1)
  }

  async measure() {
    if (!this.metricsNow || Date.now() - (this.state.lastMeasure || 0) < 6 * 3600e3) return
    const due = this.state.proposals.filter((p) => p.metric && !p.result && Date.now() - Date.parse(this.doneAt(p) || 'x') >= 7 * 864e5)
    this.state.lastMeasure = Date.now()
    if (!due.length) return this.save()
    const now = await this.metricsNow()
    for (const p of due) {
      // the source did not answer now (e.g. the payments): try again later, up to two weeks after the work was done
      if (now[p.metric] == null && p.base != null && Date.now() - Date.parse(this.doneAt(p)) < 14 * 864e5) continue
      p.result = { at: new Date().toISOString(), base: p.base ?? null, value: now[p.metric] ?? null, ...verdict(p.metric, p.base, now[p.metric]) }
      const word = { worked: 'сработало', not: 'не сработало', flat: 'без заметного изменения', insufficient: 'недостаточно данных' }[p.result.verdict]
      this.remember(p.from, `результат «${p.title}»: ${METRICS[p.metric].label} ${p.result.base ?? '—'} → ${p.result.value ?? '—'} — ${word}`)
      this.memorize(p)
    }
    this.save()
    this.emit('changed')
  }

  // ---------- the morning line: every day, the home page's numbers and up to three tasks, built by code ----------
  // A missing morning line is itself a signal: the office or the bot is down.
  async morning() {
    // tick runs every 5 minutes: a failed attempt is retried, at most 6 times a day
    const today = ymd(new Date())
    if (this.state.morningTry?.day === today && this.state.morningTry.n >= 6) return
    this.state.morningTry = { day: today, n: (this.state.morningTry?.day === today ? this.state.morningTry.n : 0) + 1 }
    try {
      const d = await this.dashboardData?.(true)
      if (!d?.home?.morning) throw new Error('нет данных главной')
      this.emit('say', d.home.morning)
      this.state.morningDay = today
    } catch (e) {
      console.error('Утренняя строка:', e.message)
    }
    this.save()
  }

  // ---------- Крыша: ad spend the office cannot see, asked every 2 weeks ----------

  askKrisha() {
    const k = this.state.krisha
    const last = k.entries.at(-1)
    const due = !last || Date.now() - Date.parse(last.at) >= KRISHA_EVERY_D * 864e5
    if (!due || Date.now() - k.lastAsk < 864e5) return
    k.lastAsk = Date.now()
    this.save()
    const since = last ? ` с ${last.at.split('-').reverse().join('.')}` : ' за последние 2 недели'
    this.emit('ask', `💰 Нурлан: сколько потратили на Крышу${since}? Ответьте командой, например: /krisha 150000`)
  }

  addKrisha(amount) {
    this.state.krisha.entries.push({ at: ymd(new Date()), amount })
    this.save()
  }

  // ---------- watchdog: plain code ----------

  // a source failing for 3+ hours: one plain Telegram message, and one when it answers again (sources.js)
  watchSources() {
    try {
      const msgs = sourceAlerts(enabled({ portal: this.office?.portal, meta: this.meta, crm: this.office?.crm }))
      if (msgs.length) this.emit('ask', msgs.join('\n\n'))
    } catch (e) { console.error('Источники данных:', e.message) }
  }

  async watch() {
    this.state.lastWatch = Date.now()
    this.save()
    if (!this.meta?.m?.token) return
    const alerts = []
    if (this.meta.m.adAccountId) {
      // a stopped account or a rejected ad: one plain message, no Claude
      await this.watchAccount().catch((e) => console.error('Сторож кабинета:', e.message))
      const ads = await this.watchAds().then((x) => { markOk('ads'); return x }, (e) => { console.error('Сторож рекламы:', e.message); markFail('ads', e); return null })
      if (ads) alerts.push(...this.newAdAlerts(ads))
    }
    const posts = this.meta.m.igUserId ? await this.watchPosts().catch(() => []) : []
    if (this.meta.m.igUserId && this.followers) await this.watchFollowers().catch((e) => console.error('Сторож подписчиков:', e.message))
    await this.watchTeam().catch((e) => console.error('Сторожа:', e.message))
    const today = ymd(new Date())
    alerts.push(...posts.filter((a) => {
      const last = this.state.seen[a.key]
      return !last || (Date.parse(today) - Date.parse(last)) / 864e5 >= 3
    }))
    if (!alerts.length) { this.save(); return }
    for (const a of posts) if (alerts.includes(a)) this.state.seen[a.key] = today
    this.save()
    await this.analyse(alerts)
  }

  // Ad alarms are kept by ad and kind until they stop firing: the same unresolved problem never reaches Алия
  // (a Claude run) twice — only when it got materially worse (WORSE). An alarm that has not fired for two days
  // counts as resolved and is forgotten, so a new episode is reported again.
  newAdAlerts(alerts) {
    const today = ymd(new Date())
    // first run after the old code: alarms it sent in the last 3 days (state.seen) are not news again
    if (!this.state.adAlerts) {
      this.state.adAlerts = {}
      for (const [k, d] of Object.entries(this.state.seen || {})) {
        if (/^(noresult|freq|cpc|ctr):/.test(k) && typeof d === 'string' && d > shift(today, -3)) this.state.adAlerts[k] = { day: d, last: d, value: null }
      }
    }
    const book = this.state.adAlerts
    const fresh = []
    for (const a of alerts) {
      const was = book[a.key]
      const worse = WORSE[a.key.split(':')[0]]
      if (!was || (worse && a.value != null && was.value != null && worse(a.value, was.value))) {
        fresh.push(a)
        book[a.key] = { day: today, last: today, value: a.value ?? null }
      } else was.last = today
    }
    for (const [k, v] of Object.entries(book)) if (v.last < shift(today, -2)) delete book[k]
    return fresh
  }

  // The ad account and the ads the owner keeps on: Meta stopped the account (debt, review, policy), the spend cap
  // is reached, or an active ad was rejected. One Telegram message per new state, built by code.
  async watchAccount() {
    const acc = await this.meta.account(0)
    if (!acc) return
    const st = (this.state.adAccount ||= { account: 'ok', cap: false, bad: {} })
    const out = []
    const key = acc.grace ? 'grace' : acc.active ? 'ok' : `${acc.status}:${acc.disable}`
    if (key === 'grace' && key !== st.account) out.push(`⚠️ Рекламный кабинет Meta${acc.name ? ` «${acc.name}»` : ''}: оплата не прошла (льготный период). Реклама ещё идёт, но Meta остановит её, если не оплатить — Ads Manager → «Оплата».`)
    else if (key !== 'ok' && key !== 'grace' && key !== st.account) out.push(`⛔ Рекламный кабинет Meta${acc.name ? ` «${acc.name}»` : ''}: ${acc.reason}. Пока это не исправить, реклама не показывается — Ads Manager → «Настройки кабинета» и «Оплата».`)
    st.account = key
    if (acc.active && acc.capReached && !st.cap) out.push(`⛔ В кабинете Meta исчерпан лимит расходов (${Math.round(acc.cap)} ${acc.currency}) — реклама остановлена. Поднять или снять лимит: Ads Manager → «Оплата» → «Лимит расходов аккаунта».`)
    st.cap = !!acc.capReached
    // the ads list may fail on its own (rate limit, timeout): the account news above still goes out, the ads wait
    const bad = await this.meta.adProblems().catch((e) => { console.error('Сторож кабинета (объявления):', e.message); return null })
    if (bad) {
      const now = {}
      for (const x of bad) {
        const k = `${x.id}:${x.st}`
        now[k] = st.bad?.[k] || ymd(new Date())
        if (!st.bad?.[k]) out.push(`⚠️ ${x.what}: «${x.name}»${x.why ? ` — ${x.why}` : ''}. Объявление включено, но не показывается: исправить или выключить в Ads Manager.`)
      }
      st.bad = now
    }
    this.save()
    if (out.length) this.emit('ask', out.join('\n\n'))
  }

  // Ерлан, Нурлан, Мадина and Тимур check their own areas; a finding goes straight to the owner as a proposal.
  async watchTeam() {
    const found = []
    const portal = this.office.portal
    if (portal?.status().configured) {
      const a = await portal.get('/api/analytics/apartments').catch(() => null)
      const h = await portal.get('/api/analytics/status-history?updated_since=' + ymd(new Date(Date.now() - 4 * 864e5))).catch(() => null)
      // money already entered in the chessboard: no reminder needed
      const paid = new Map(((await portal.get('/api/analytics/payments').catch(() => null))?.flats || []).map((x) => [x.number, x]))
      const entered = (n, to) => { const x = paid.get(n); return !!x && (to === 'Бронь' ? !!x.booking?.amount : !!x.down_payment?.amount || (x.payments || []).some((r) => r.paid_amount)) }
      if (a) {
        const byNum = new Map(a.apartments.map((x) => [x.number, x]))
        // hanging bookings are no longer one proposal each: the home page and the morning line list them as one task
        // a client moved to another flat is not a new deal, a sale or a dropped booking (sales-rules.js)
        for (const c of readLog(h?.changes)) {
          const x = byNum.get(c.number) || {}
          // a new deal: ask the owner to enter the money in the portal
          if (['Бронь', 'Рассрочка'].includes(c.to) && c.from !== c.to && !c.move && !this.state.seen[`pay:${c.id}`] && !entered(c.number, c.to)) {
            this.state.seen[`pay:${c.id}`] = ymd(new Date())
            this.emit('pay', { n: c.number, to: c.to, from: c.from })
          }
          if (isSale(c)) {
            found.push({ key: `sale:${c.id}`, from: 'smm', urgent: false, title: `🎉 Продана кв. ${c.number} — пост «новоселье»`, text: `Свежая продажа — повод для поста о спросе: «ещё одна семья выбрала …».`, task: `Квартира №${c.number} (${x.rooms || ''}-комн., ${x.area_m2 || ''} м²) только что продана. Сделай пост и сторис о том, что квартиры раскупают (без имён покупателей), с призывом успеть выбрать свою планировку. Факты — только из базы.` })
          }
          if (isUnbook(c)) found.push({ key: `unbook:${c.id}`, from: 'sales', urgent: true, title: `Сняли бронь с кв. ${c.number}`, text: `Клиент ушёл — стоит узнать почему и попробовать вернуть.`, task: `С квартиры №${c.number} сняли бронь. Подготовь менеджеру сообщение, чтобы вежливо узнать причину и предложить альтернативу (другая планировка, рассрочка), и что записать как причину отказа.` })
        }
      }
    }
    if (this.meta?.m?.token && this.meta.m.igUserId && workHours()) {
      const media = (await this.meta.api(`${this.meta.m.igUserId}/media`, { fields: 'timestamp,media_product_type', limit: 25 }).catch(() => ({}))).data || []
      const last = media[0] ? Date.parse(media[0].timestamp) : 0
      const reel = media.find((m) => m.media_product_type === 'REELS')
      const days = (t) => Math.floor((Date.now() - t) / 864e5)
      if (last && days(last) >= 3) found.push({ key: `nopost:${media[0].timestamp.slice(0, 10)}`, from: 'smm', urgent: false, title: `${days(last)} дня без публикаций`, text: 'Без постов охват и реакции падают почти вдвое. Предлагаю пост на завтра.', task: 'В Instagram давно не было публикаций. Сделай пост на завтра (текст и картинку в стиле Altyn Qala) на самую сильную тему недели — опирайся на выводы Алии в своих уроках и на базу.' })
      if (!reel || days(Date.parse(reel.timestamp)) >= 7) found.push({ key: `noreel:${reel?.timestamp?.slice(0, 10) || 'none'}`, from: 'montazh', urgent: false, title: 'Неделя без Reels', text: 'Reels дают больше всего охвата. Пришлите в Telegram свежие видео со стройки с подписью /montazh Ход строительства — смонтирую.', task: null })
    }
    const today = ymd(new Date())
    for (const f of found) {
      if (this.state.seen[f.key]) continue
      this.state.seen[f.key] = today
      this.add({ from: f.from, kind: 'watch', urgent: f.urgent, title: f.title, text: f.text, task: f.task ? { employee: f.from, text: f.task } : null, metric: METRIC_OF_FINDING[f.key.split(':')[0]] || null })
    }
    // the seen list keeps only the last 60 days
    for (const [k, d] of Object.entries(this.state.seen)) if (Date.parse(today) - Date.parse(d) > 60 * 864e5) delete this.state.seen[k]
    this.save()
  }

  // Complete days only, in the ad account's zone: the last 3 days (yesterday and two before) against the 7 before them.
  // Each ad is judged by what it is for (its settings, ads-rules.js): «no conversations» and «a conversation got
  // dearer» only for ads paid for conversations or forms; reach / profile ads are not expected to bring chats.
  async watchAds() {
    const tz = (await this.meta.account().catch(() => null))?.tz || this.meta.tz?.()
    const fields = 'ad_id,ad_name,campaign_name,objective,optimization_goal,spend,ctr,frequency,actions'
    const w3 = lastDays(tz, 3), w7 = lastDays(tz, 7, 4)
    // other projects in the same account (Парк) are left out by adInsights
    const recent = await this.meta.adInsights({ level: 'ad', fields, time_range: w3 })
    const before = await this.meta.adInsights({ level: 'ad', fields, time_range: w7 })
    const cur = this.meta.currency?.() || this.meta.status().adAccount?.currency || ''
    const kinds = adKinds()
    const kindOf = (r) => kinds[r.ad_id] || kindByGoal({ objective: r.objective, optimization: r.optimization_goal }) || kindByResult(adNumbers(r))
    // the result an ad is paid for: conversations of a chat ad, forms of a «Лиды» ad
    const got = (r, k = kindOf(r)) => { const n = adNumbers(r); return k === 'chat' ? n.chats : k === 'form' ? n.leads : 0 }
    const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
    const span = `${dm(w3.since)}–${dm(w3.until)}`
    const alerts = []
    const prev = new Map(before.map((a) => [a.ad_id, a]))
    let s3 = 0, c3 = 0, s7 = 0, c7 = 0
    for (const a of recent) {
      const k = kindOf(a), paid = isPaid(k)
      const spend = num(a.spend), conv = got(a, k)
      if (paid) { s3 += spend; c3 += conv }
      if (paid && spend >= 5 && conv === 0) {
        alerts.push({ ad: a.ad_id, key: `noresult:${a.ad_id}`, value: spend, urgent: true, text: `Объявление «${a.ad_name}» (реклама на ${k === 'form' ? 'форму-заявку' : 'переписки'}) потратило ${spend.toFixed(0)} ${cur} за 3 полных дня (${span}) и не принесло ни одной ${k === 'form' ? 'заявки' : 'переписки'}.` })
      }
      if (num(a.frequency) > 3.5) {
        alerts.push({ ad: a.ad_id, key: `freq:${a.ad_id}`, value: num(a.frequency), urgent: false, text: `У «${a.ad_name}» частота ${num(a.frequency).toFixed(1)} — аудитория видит его слишком часто, креатив устаёт.` })
      }
      const p = prev.get(a.ad_id)
      if (paid && p && conv >= 2 && got(p, k) >= 3) {
        const now = spend / conv, was = num(p.spend) / got(p, k)
        if (now >= was * 1.4) alerts.push({ ad: a.ad_id, key: `cpc:${a.ad_id}`, value: now, urgent: now >= was * 2, text: `${k === 'form' ? 'Заявка' : 'Переписка'} в «${a.ad_name}» подорожала: ${now.toFixed(2)} ${cur} вместо ${was.toFixed(2)} (+${Math.round((now / was - 1) * 100)}%).` })
      }
      if (p) {
        const ctrNow = num(a.ctr), ctrWas = num(p.ctr)
        if (ctrWas > 0 && ctrNow < ctrWas * 0.65) alerts.push({ ad: a.ad_id, key: `ctr:${a.ad_id}`, value: ctrNow, urgent: false, text: `CTR «${a.ad_name}» упал с ${ctrWas.toFixed(2)}% до ${ctrNow.toFixed(2)}%.` })
      }
    }
    for (const a of before) { const k = kindOf(a); if (isPaid(k)) { s7 += num(a.spend); c7 += got(a, k) } }
    const money = (v) => v >= 100 ? Math.round(v).toLocaleString('ru-RU') : v.toFixed(2)
    const cpr = (s, c) => c ? `${money(s / c)} ${cur}` : '—'
    if (c3 >= 3 && c7 >= 5 && s3 / c3 >= (s7 / c7) * 1.5) {
      alerts.push({ key: 'cpc:account', value: s3 / c3, urgent: true, text: `По всему кабинету переписка или заявка подорожала: ${(s3 / c3).toFixed(2)} ${cur} против ${(s7 / c7).toFixed(2)} неделей раньше (только реклама на переписки и форму).`,
        data: `Весь кабинет, реклама на переписки и форму: 3 полных дня ${span} — расход ${money(s3)} ${cur}, переписок и заявок ${c3}, цена ${cpr(s3, c3)}; 7 дней до этого — расход ${money(s7)} ${cur}, переписок и заявок ${c7}, цена ${cpr(s7, c7)}` })
    }
    // Алия gets the ad's own numbers and what it is for, not just the alarm, so she decides herself.
    // Ads already paused or finished are not worth an alarm.
    const line = (a) => {
      if (!a) return 'не крутилось'
      const spend = num(a.spend), n = adNumbers(a), k = kindOf(a)
      const result = k === 'form' ? `заявок через форму ${n.leads}, цена заявки ${cpr(spend, n.leads)}`
        : k === 'chat' ? `переписок ${n.chats}, цена переписки ${cpr(spend, n.chats)}, живых разговоров (клиент написал 3+ сообщения) ${n.deep}, цена живого ${cpr(spend, n.deep)}`
        : `переписок ${n.chats} (эта реклама не на переписки — по ним не судим)`
      return `цель — ${KIND_RU[k]}; расход ${money(spend)} ${cur}, ${result}, частота ${num(a.frequency).toFixed(1)}, CTR ${num(a.ctr).toFixed(2)}%`
    }
    const byId = new Map(recent.map((a) => [a.ad_id, a]))
    const off = new Set()
    for (const id of new Set(alerts.map((x) => x.ad).filter(Boolean))) {
      const info = await this.meta.api(id, { fields: 'effective_status,adset{end_time}' }).catch(() => null)
      const end = Date.parse(info?.adset?.end_time || '')
      if (/PAUSED|ARCHIVED|DELETED/.test(info?.effective_status || '') || end < Date.now()) { off.add(id); continue }
      const data = `«${byId.get(id).ad_name}»: 3 полных дня ${span} — ${line(byId.get(id))}; 7 дней до этого — ${line(prev.get(id))}${end ? `; крутится до ${new Date(end).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })}` : ''}`
      for (const x of alerts) if (x.ad === id) x.data = data
    }
    return alerts.filter((x) => !off.has(x.ad))
  }

  // Followers 3× above the usual day (or a net loss): Алия gets the live counter and everything that could move it
  // and writes the owner what happened, why (with the numbers), what one follower cost and what to do.
  async watchFollowers() {
    const log = followerLog()
    const g = growth(log, 24)
    if (g == null) return
    const norm = await this.followers.norm()
    if (!norm) return
    const up = g >= Math.max(3 * norm, 10), down = g <= -5
    if (!up && !down) return
    const key = up ? 'followers-up' : 'followers-down'
    const last = this.state.seen[key]
    if (last && Date.now() - Date.parse(last) < 2 * 864e5) return
    this.state.seen[key] = ymd(new Date())
    this.save()
    const deep = await this.meta.igDeep(10)
    const facts = followersFacts({ log, norm, deep, currency: this.meta.status().adAccount?.currency || '', goal: this.followers.goal() })
    const active = this.employees.filter((e) => e.active && e.id !== 'manager').map((e) => `${e.id} — ${e.name || ''}, ${e.title}`)
    const prompt = [
      `Сегодня: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}.`,
      up ? `Сторож офиса заметил: подписчиков Instagram за сутки +${g} — в ${(g / norm).toFixed(1)} раза больше обычного (${norm} в день).` : `Сторож офиса заметил: подписчиков Instagram за сутки ${g} — отписок больше, чем подписок.`,
      '', 'Ты уже открыла статистику Instagram и рекламный кабинет — вот цифры:', ...facts.map((x) => (x.startsWith('-') ? x : `- ${x}`)),
      '',
      'Напиши владельцу от первого лица, 5–7 коротких строк, просто, без жаргона, читает с телефона:',
      '1) сколько пришло и во сколько раз больше обычного; 2) что это вызвало — цепочкой из цифр выше (например: реклама на посещения профиля → посещений профиля в N раз больше обычного → подписки), различая факт, наблюдаемую связь и оценку; 3) сколько стоил один подписчик (оценка, если Meta не даёт точно); 4) что делать — усилить, держать или остановить, с конкретной цифрой бюджета или срока; 5) хватит ли этого темпа до цели.',
      'Не пиши «данных недостаточно»: живой счётчик и посещения профиля есть. Если Meta ещё не посчитала подписки за последние дни — так и скажи одной фразой и опирайся на живой счётчик. Ничего не проси владельца открыть или проверить.',
      'Если нужна работа сотрудника (пост, сторис, креатив) — заполни proposal: employee (id из списка), title (до 60 знаков), task (готовое поручение).',
      `Сотрудники: ${active.join('; ')}`,
      this.memory('marketing') ? `Прошлые решения владельца по твоим предложениям:\n${this.memory('marketing')}` : '',
    ].join('\n')
    const out = await this.run('marketing', prompt, PROPOSAL_SCHEMA, 'Разбирает скачок подписчиков')
    if (!out) return
    this.add({
      from: 'marketing', kind: 'alert', urgent: down,
      title: out.proposal?.title || (up ? `Подписчиков +${g} за сутки` : `Отписки: ${g} за сутки`),
      text: out.message,
      task: out.proposal?.employee && out.proposal?.task ? { employee: out.proposal.employee, text: out.proposal.task } : null,
      metric: 'follows',
    })
  }

  async watchPosts() {
    const id = this.meta.m.igUserId
    const media = (await this.meta.api(`${id}/media`, { fields: 'id,caption,timestamp,permalink,media_product_type', limit: 15 })).data || []
    const withReach = []
    for (const m of media) {
      const r = await this.meta.api(`${m.id}/insights`, { metric: 'reach', period: 'lifetime' }).catch(() => null)
      const reach = num(r?.data?.[0]?.values?.[0]?.value)
      if (reach) withReach.push({ ...m, reach })
    }
    const recent = withReach.filter((m) => Date.now() - Date.parse(m.timestamp) < 3 * 864e5)
    const older = withReach.filter((m) => !recent.includes(m)).map((m) => m.reach).sort((a, b) => a - b)
    if (older.length < 4) return []
    const median = older[Math.floor(older.length / 2)]
    return recent.filter((m) => m.reach >= median * 2).map((m) => ({
      key: `spike:${m.id}`,
      urgent: false,
      text: `Публикация «${String(m.caption || '').slice(0, 60)}» набрала охват ${m.reach} — в ${(m.reach / median).toFixed(1)} раза больше обычного (${median}). ${m.permalink}`,
    }))
  }

  // ---------- Claude runs ----------

  memory(id, lines = 20) {
    try {
      return fs.readFileSync(path.join(MEMORY, `${id}.md`), 'utf8').trim().split('\n').slice(-lines).join('\n')
    } catch { return '' }
  }

  remember(id, line) {
    fs.mkdirSync(MEMORY, { recursive: true })
    fs.appendFileSync(path.join(MEMORY, `${id}.md`), `- ${ymd(new Date())}: ${line}\n`, 'utf8')
  }

  async run(asId, prompt, schema, activity, over = {}) {
    const emp = this.employees.find((e) => e.id === asId)
    if (!emp || !this.bin) return null
    const ws = path.join(P.work, '_initiative', `${Date.now()}`)
    fs.mkdirSync(ws, { recursive: true })
    this.office.setSide(asId, activity)
    try {
      const { promise } = runClaude({
        bin: this.bin,
        args: buildArgs({ ...emp, tools: '', maxTurns: 3, maxBudgetUsd: 0.5, effort: 'low', ...over }, { schema }),
        cwd: ws,
        input: prompt,
        timeoutMs: (over.timeoutMin || 5) * 60 * 1000,
        env: childEnv(this.cfg.keepApiKey),
      })
      const res = await promise
      if (!res.ok) { console.error('Инициатива:', res.error); return null }
      return res.result?.structured_output || null
    } finally {
      this.office.setSide(asId, null)
      fs.rmSync(ws, { recursive: true, force: true })
    }
  }

  async analyse(alerts) {
    const active = this.employees.filter((e) => e.active && e.id !== 'manager').map((e) => `${e.id} — ${e.name || ''}, ${e.title}`)
    const data = [...new Set(alerts.map((a) => a.data).filter(Boolean))]
    const prompt = [
      `Сегодня: ${new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })}.`,
      'Сторож офиса заметил в цифрах Meta:',
      ...alerts.map((a) => `- ${a.urgent ? '[срочно] ' : ''}${a.text}`),
      ...(data.length ? ['', 'Ты уже открыла рекламный кабинет — вот цифры:', ...data.map((d) => `- ${d}`)] : []),
      '',
      'Напиши владельцу от первого лица, коротко (не больше 4 предложений на объявление — он читает с телефона), просто, без жаргона — как аналитик, который уже всё посмотрел сам: «Я посмотрела…». По каждому объявлению: на какие цифры посмотрела (частота: выше 3 — аудитория устала; цена переписки сейчас и раньше; CTR; расход), вывод и одна рекомендация — выключить, заменить креатив или оставить и проверить снова через N дней.',
      'Ничего не проси владельца открыть, посмотреть или проверить и не пиши «если…, то…»: цифры у тебя есть — реши сама. Если данных мало для вывода — так и скажи и назови, когда посмотришь снова. Выключает объявление владелец — ты только рекомендуешь.',
      'Образец: «Я посмотрела «Публикация в Instagram: …»: частота 3,4 — выше 3, аудитория устала; переписка подорожала с 1,20 до 1,90 $ (+58%). Рекомендую выключить — деньги уходят впустую.»',
      'urgent = true, только если промедление стоит денег прямо сейчас (реклама тратит впустую).',
      'Если нужна работа сотрудника (новый креатив вместо уставшего, текст) — заполни proposal: employee (id из списка), title (до 60 знаков), task (готовое поручение). Если хватит действия владельца в кабинете — proposal не нужен.',
      `Сотрудники: ${active.join('; ')}`,
      this.memory('marketing') ? `Прошлые решения владельца по твоим предложениям:\n${this.memory('marketing')}` : '',
    ].join('\n')
    const out = await this.run('marketing', prompt, PROPOSAL_SCHEMA, 'Разбирает, что заметил сторож')
    if (!out) return
    this.add({
      from: 'marketing',
      kind: 'alert',
      urgent: !!out.urgent || alerts.some((a) => a.urgent),
      title: out.proposal?.title || 'Замечено в рекламе',
      text: out.message,
      task: out.proposal?.employee && out.proposal?.task ? { employee: out.proposal.employee, text: out.proposal.task } : null,
      metric: 'cpr',
    })
  }

  async weekly(comment = '', previous = null) {
    if (!comment) { this.state.lastWeek = isoWeek(astana()); this.save() }
    const since = Date.now() - 7 * 864e5
    const done = this.store.tasks.filter((t) => t.status === 'done' && Date.parse(t.finishedAt) > since)
      .map((t) => `- ${t.employee}: ${t.title}`).slice(-20)
    let numbers = ''
    try { if (this.dashboardData) numbers = numbersBrief(await this.dashboardData()) } catch {}
    const team = this.employees.filter((e) => e.active && e.id !== 'manager').map((e) => `- ${e.id} (${e.name || ''}, ${e.title}): ${e.about}`)
    // the weekly report of Диас: its numbers, conclusions and the advice the owner already got with buttons
    const rep = this.lastWeekReport()
    let reports = ''
    if (rep) { try { reports = fs.readFileSync(path.join(P.work, rep.id, 'отчёт-недели.md'), 'utf8').slice(0, 3500) } catch { reports = String(rep.result || '').slice(0, 2000) } }
    const goals = this.goalsNow()
    const prompt = [
      `Сегодня ${new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Ты — Диас, руководитель офиса маркетинга и продаж застройщика Altyn Qala (ЖК «Altyn Qala 2» строится, сдача 2027; ЖК «Qala 4» — готовый дом).`,
      `Составь ОДИН план недели для всей команды: до ${MAX_PROPOSALS + 2} дел, только самое важное для целей. Владелец утвердит его одной кнопкой.`,
      'Каждое дело: employee (id исполнителя), title (до 60 знаков), why (одна фраза: какую проблему или цель решает), task (готовое поручение исполнителю), metric (какой показатель должно сдвинуть, один из: ' + Object.entries(METRICS).map(([k, m]) => `${k} — ${m.label}`).join('; ') + '), expected (ожидаемый эффект словами, без выдуманных процентов), days (срок в днях). И summary — 2–3 предложения: главная цель недели и главное ограничение.',
      'Опирайся на цели, цифры, отчёты и память компании: не повторяй то, что владелец отклонял, и то, что уже не сработало; развивай то, что сработало. Факты о ЖК не выдумывай.',
      comment ? `\nВладелец попросил изменить прошлый план: «${comment}». Учти это.\nПрошлый план: ${(previous?.items || []).map((x) => `${x.employee}: ${x.title}`).join('; ')}` : '',
      '', 'Команда:', ...team,
      goals ? `\nЦели месяца: ${JSON.stringify(goals)}` : '\nЦели месяца ещё не утверждены.',
      numbers ? `\nЦифры:\n${numbers}` : '',
      '', 'Сделано за неделю:', ...(done.length ? done : ['- ничего']),
      reports ? `\nОтчёт недели (цифры посчитаны кодом; его советы владелец уже получил отдельными кнопками — не повторяй их, дополняй):\n${reports}` : '',
      `\nПамять компании (решения и их результаты):\n${this.businessMemory(25).join('\n') || 'пока пусто'}`,
      monthRules() ? `\nПравила месяца — твой разбор прошлого месяца, план недели должен им следовать:\n${monthRules()}` : '',
    ].join('\n')
    const out = await this.run('manager', prompt, WEEK_PLAN_SCHEMA, 'Составляет план недели', { model: this.strongModel, effort: 'medium', maxBudgetUsd: 3, timeoutMin: 10 })
    if (!out?.items?.length) return null
    const ids = new Set(this.employees.filter((e) => e.active && e.id !== 'manager').map((e) => e.id))
    const items = out.items.slice(0, MAX_PROPOSALS + 2).map((x) => ({ ...x, employee: ids.has(x.employee) ? x.employee : 'smm' }))
    return this.add({ from: 'manager', kind: 'week-plan', urgent: false, task: null, dueDays: 1, title: `План недели${comment ? ' (исправленный)' : ''}`, text: out.summary || '', items })
  }

  // ---------- office chatter ----------

  // One cheap run writes short dialogues and thoughts grounded in what really happens in the office.
  async banter(slot) {
    this.state.banterSlot = slot
    this.save()
    const since = Date.now() - 2 * 864e5
    const recent = this.store.tasks.filter((t) => Date.parse(t.finishedAt || t.createdAt) > since)
      .map((t) => `- ${t.employee}: ${t.title} (${t.status})`).slice(-12)
    const pending = this.list().map((p) => `- ${p.from}: ${p.title}`)
    const team = this.employees.map((e) => `- ${e.id}: ${e.name || ''}, ${e.title}${e.active ? '' : ' (ещё не подключён, скучает)'}. Характер сейчас: ${this.describe(e.id)}`)
    const prompt = [
      `Сейчас ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}, Астана. Пиксельный офис маркетинга застройщика Altyn Qala.`,
      'Напиши живую болтовню сотрудников для экрана офиса, как в игре Sims: 5 коротких диалогов и 8 мыслей.',
      'Характеры: Диас (manager) — спокойный руководитель; Мадина (smm) — энергичная, тренды Instagram; Тимур (montazh) — молчун, монтаж; Алия (marketing) — педантичная, цифры, кофе; Ерлан (sales) — общительный, думает как продавец, разбирает брони и возражения; Нурлан (revenue) — сдержанный, в очках, считает выручку и темп продаж.',
      'Пиши в соответствии с текущим характером и настроением каждого (он меняется от опыта).',
      'Опирайся на реальные события ниже, шути по-доброму, можно про погоду и время года в Астане. Каждая реплика — до 45 знаков, по-русски. Никаких выдуманных цен, сроков и обещаний клиентам.',
      'Диалог: a и b — id сотрудников, lines — 3–4 реплики по очереди (who — id).',
      'Мысль: who — id, text — что у человека на уме, mood — от -2 (расстроен) до 2 (счастлив): по событиям, усталости, погоде.',
      '', 'Команда:', ...team,
      '', 'Последние задачи:', ...(recent.length ? recent : ['- пока тихо']),
      pending.length ? `\nЖдут решения владельца:\n${pending.join('\n')}` : '',
    ].join('\n')
    const emp = this.employees.find((e) => e.id === 'manager')
    if (!emp || !this.bin) return
    const ws = path.join(P.work, '_initiative', `banter-${Date.now()}`)
    fs.mkdirSync(ws, { recursive: true })
    try {
      // chatter needs no facts, so the cheapest model is enough
      const { promise } = runClaude({
        bin: this.bin,
        args: buildArgs({ ...emp, model: 'haiku', effort: 'low', tools: '', maxTurns: 2, maxBudgetUsd: 0.1, systemPrompt: 'Ты пишешь короткие реплики персонажей для экрана офиса. Отвечай только данными по схеме.' }, { schema: BANTER_SCHEMA }),
        cwd: ws,
        input: prompt,
        timeoutMs: 3 * 60 * 1000,
        env: childEnv(this.cfg.keepApiKey),
      })
      console.log('  Болтовня: запуск…')
      const res = await promise
      const out = res.ok ? res.result?.structured_output : null
      if (!out) { console.error('Болтовня не получилась:', res.error || 'пустой ответ', String(res.stderr || '').slice(-300)); return }
      console.log('  Болтовня: готово, диалогов', (out.dialogues || []).length)
      // the model may answer with names instead of ids: accept both
      const idOf = (v) => {
        const k = String(v || '').trim().toLowerCase()
        const e = this.employees.find((x) => x.id === k || (x.name && x.name.toLowerCase() === k) || x.title.toLowerCase() === k)
        return e?.id || null
      }
      const clip = (t) => String(t || '').slice(0, 60)
      this.state.banter = {
        at: new Date().toISOString(),
        dialogues: (out.dialogues || []).map((d) => ({ a: idOf(d.a), b: idOf(d.b), lines: (d.lines || []).map((l) => ({ who: idOf(l.who), text: clip(l.text) })).filter((l) => l.who) }))
          .filter((d) => d.a && d.b && d.a !== d.b && d.lines.length),
        thoughts: (out.thoughts || []).map((x) => ({ who: idOf(x.who), text: clip(x.text), mood: Math.max(-2, Math.min(2, Number(x.mood) || 0)) })).filter((x) => x.who),
      }
      if (!this.state.banter.dialogues.length) console.error('Болтовня: не разобрал ответ', JSON.stringify(out).slice(0, 300))
      for (const x of this.state.banter.thoughts) this.grow(x.who, { mood: x.mood * 0.02 })
      this.save()
      this.emit('banter', this.state.banter)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  }

  // ---------- proposals ----------

  add(p) {
    const due = new Date(Date.now() + (p.dueDays || (p.urgent ? 1 : p.kind === 'watch' ? 2 : 7)) * 864e5)
    const item = {
      id: crypto.randomBytes(4).toString('hex'), status: 'new', createdAt: new Date().toISOString(),
      area: AREAS[p.task?.employee || p.tasks?.[0]?.employee || p.from] || 'Другое',
      source: SOURCES[p.kind] || 'Офис', due: ymd(due), ...p,
    }
    delete item.dueDays
    if (item.silent) { item.sentAt = item.createdAt; item.sentInHours = true; delete item.silent }
    this.state.proposals.push(item)
    this.state.proposals = this.state.proposals.slice(-200)
    this.save()
    this.emit('changed')
    this.deliver()
    return item
  }

  // Urgent goes out at once, anything else waits for working hours.
  // Urgent ones sent outside working hours get a reminder once the day starts.
  deliver() {
    const inHours = workHours()
    for (const p of this.state.proposals) {
      if (p.status !== 'new') continue
      if (!p.sentAt && (p.urgent || inHours)) {
        p.sentAt = new Date().toISOString()
        p.sentInHours = inHours
        this.emit('proposal', p)
      } else if (p.sentAt && !p.sentInHours && !p.reminded && inHours) {
        p.reminded = true
        this.emit('remind', p)
      }
    }
    this.save()
  }

  decide(id, yes, only = null) {
    const p = this.state.proposals.find((x) => x.id === id)
    if (!p) throw new Error('Предложение не найдено')
    if (p.status !== 'new') throw new Error('По этому предложению уже есть решение')
    if (p.kind === 'week-plan') return this.decidePlan(p, yes, only)
    p.status = yes ? 'accepted' : 'declined'
    p.decidedAt = new Date().toISOString()
    if (yes && p.kind === 'month-goals') this.state.goals = { ...p.goals, month: ymd(new Date()).slice(0, 7), approvedAt: p.decidedAt }
    if (yes && p.metric && this.metricsNow) this.metricsNow().then((m) => { p.base = m[p.metric] ?? null; this.save() }).catch(() => {})
    if (yes && p.kind === 'week-goal') this.state.weekGoal = { ...p.goal, week: isoWeek(astana()), approvedAt: p.decidedAt }
    this.remember(p.from, `${yes ? 'одобрено' : 'отклонено'} — «${p.title}»`)
    this.grow(p.from, yes ? { initiative: 0.04, confidence: 0.03, mood: 0.1 } : { initiative: -0.02, mood: -0.05 }, `предложение «${p.title}» ${yes ? 'одобрили' : 'отклонили'}`)
    let task = null
    if (yes && p.task) task = this.office.addTask(p.task.employee, p.task.text, { source: 'proposal', proposal: p.id })
    if (yes && p.tasks) for (const x of p.tasks) task = this.office.addTask(x.employee, x.text, { source: 'proposal', dependsOn: x.dependsOn || [], proposal: p.id })
    if (task) p.taskIds = this.store.tasks.filter((t) => t.proposal === p.id).map((t) => t.id)
    if (!['week-goal', 'month-goals', 'smm-pack'].includes(p.kind)) this.memorize(p)
    this.save()
    if (p.kind === 'smm-pack') this.emit('smm-pack', p, yes)
    this.emit('changed')
    return { proposal: p, task }
  }

  // Диас's week plan: approve all, a part (only = indices) or nothing; every approved item becomes its own decision
  decidePlan(p, yes, only) {
    p.status = yes ? 'accepted' : 'declined'
    p.decidedAt = new Date().toISOString()
    p.children = []
    let task = null
    if (yes) {
      const pick = Array.isArray(only) ? only : p.items.map((_, i) => i)
      for (const i of pick) {
        const x = p.items[i]
        if (!x) continue
        const child = this.add({ from: x.employee, kind: 'weekly', silent: true, urgent: false, title: x.title, text: x.why, task: { employee: x.employee, text: x.task }, metric: METRICS[x.metric] ? x.metric : null, expected: x.expected || '', dueDays: x.days || 7, parent: p.id })
        const r = this.decide(child.id, true)
        task = r.task || task
        p.children.push(child.id)
      }
    }
    this.remember('manager', `план недели ${yes ? `утверждён (${p.children.length} из ${p.items.length})` : 'отклонён'}`)
    this.save()
    this.emit('changed')
    return { proposal: p, task, approved: p.children.length }
  }

  // "Изменить": the owner's comment goes back to Диас, he sends a new plan
  async revisePlan(id, comment) {
    const p = this.state.proposals.find((x) => x.id === id && x.kind === 'week-plan')
    if (!p || p.status !== 'new') return null
    p.status = 'declined'
    p.decidedAt = new Date().toISOString()
    p.revisedWith = String(comment).slice(0, 1000)
    this.save()
    return this.weekly(comment, p)
  }
}
