import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { P, isInside } from './paths.js'
import { buildArgs, childEnv, runClaude } from './claude.js'
import { describeTool, summarizeText } from './activity.js'
import { publicEmployee } from './employees.js'
import { renderHtml, checkHtml } from './render.js'
import { VIDEO_RE, storyboard, assembleReel, readSpec, todayDate } from './montage.js'
import { collectSales, cleanExports, DATA_RE } from './sales.js'
import { Learning } from './learning.js'
import { AdsArchive } from './ads-archive.js'
import { checkFacts } from './facts.js'
import { SalesArchive } from './sales-archive.js'
import { monthRules } from './initiative.js'
import { likeWork } from './post-results.js'

const RESERVED = ['_база', '_материалы', '_от_коллег', '_раскадровка', '_данные']
const MAX_COPY_BYTES = 25 * 1024 * 1024
const TERMINAL = new Set(['done', 'failed', 'cancelled'])

function today() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())
}

function titleOf(text) {
  const first = String(text).trim().split('\n')[0]
  return first.length > 80 ? first.slice(0, 77) + '…' : first
}

function copyDir(src, dst, skipTop = []) {
  if (!fs.existsSync(src)) return []
  const copied = []
  const walk = (s, d, rel) => {
    for (const ent of fs.readdirSync(s, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      if (!rel && skipTop.includes(ent.name)) continue
      const sp = path.join(s, ent.name)
      const dp = path.join(d, ent.name)
      const rp = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) walk(sp, dp, rp)
      else if (ent.isFile() && fs.statSync(sp).size <= MAX_COPY_BYTES) {
        fs.mkdirSync(d, { recursive: true })
        fs.copyFileSync(sp, dp)
        copied.push(rp)
      }
    }
  }
  walk(src, dst, '')
  return copied
}

// one list of problems per file, whatever check found them
function mergeIssues(...lists) {
  const by = new Map()
  for (const x of lists.flat()) by.set(x.file, [...(by.get(x.file) || []), ...x.issues])
  return [...by].map(([file, issues]) => ({ file, issues }))
}

function listOutputs(ws) {
  const out = []
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!rel && RESERVED.includes(ent.name)) continue
      const full = path.join(dir, ent.name)
      const rp = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) walk(full, rp)
      else if (ent.isFile()) out.push({ path: rp, size: fs.statSync(full).size })
    }
  }
  if (fs.existsSync(ws)) walk(ws, '')
  return out
}

export class Office extends EventEmitter {
  constructor({ store, cfg, employees, bin, browser, ffmpeg, meta, portal, crm }) {
    super()
    this.portal = portal
    this.crm = crm
    this.salesArchive = new SalesArchive({ portal })
    this.learning = new Learning({ bin, cfg, store, emp: (id) => this.emp(id) })
    // picks the queue up again after a subscription-limit pause
    setInterval(() => this.tick(), 60 * 1000).unref?.()
    this.store = store
    this.cfg = cfg
    this.employees = employees
    this.bin = bin
    this.browser = browser
    this.ffmpeg = ffmpeg
    this.meta = meta
    this.ads = new AdsArchive({ meta })
    this.running = new Map()
    this.planChain = Promise.resolve()
    this.lastActivity = new Map()
    this.side = new Map() // background work outside the task queue (initiative)
    this.stateTimer = null

    for (const ev of ['task', 'plan', 'event', 'usage']) store.on(ev, () => this.scheduleState())
    store.on('task', (t) => { if (TERMINAL.has(t.status)) this.checkPlanDone(t.planId) })
    // Tasks interrupted by a restart were marked failed on load; close their plans too.
    for (const p of store.plans) if (p.status === 'approved') this.checkPlanDone(p.id)
  }

  emp(id) { return this.employees.find((e) => e.id === id) }

  setSide(id, text) {
    if (text) this.side.set(id, { kind: 'think', text })
    else this.side.delete(id)
    this.scheduleState()
  }

  // ---------- state for the screen ----------

  scheduleState() {
    clearTimeout(this.stateTimer)
    this.stateTimer = setTimeout(() => this.emit('employees', this.employeeStates()), 80)
  }

  employeeStates() {
    const { tasks, plans } = this.store
    return this.employees.map((e) => {
      const base = { ...publicEmployee(e) }
      if (!e.active) return { ...base, status: 'soon' }
      if (e.id === 'manager') {
        const thinking = plans.find((p) => p.status === 'thinking')
        const waiting = plans.filter((p) => p.status === 'awaiting' || p.status === 'question')
        const queued = plans.filter((p) => p.status === 'queued').length
        if (thinking) return { ...base, status: 'working', activity: this.lastActivity.get(thinking.id) || { kind: 'think', text: 'Думает над планом' }, ref: thinking.id, queued }
        if (this.side.has(e.id)) return { ...base, status: 'working', activity: this.side.get(e.id), queued }
        if (waiting.length) return { ...base, status: 'waiting', activity: { kind: 'wait', text: `Ждёт вашего решения: ${waiting.length}` }, queued }
        return { ...base, status: 'idle', queued }
      }
      const mine = tasks.filter((t) => t.employee === e.id)
      const running = mine.find((t) => t.status === 'running')
      const queued = mine.filter((t) => t.status === 'queued').length
      const last = [...mine].reverse().find((t) => TERMINAL.has(t.status))
      const lastInfo = last ? { id: last.id, status: last.status, at: last.finishedAt } : null
      if (running) return { ...base, status: 'working', activity: this.lastActivity.get(running.id) || { kind: 'think', text: 'Приступает к задаче' }, ref: running.id, queued, last: lastInfo }
      if (this.side.has(e.id)) return { ...base, status: 'working', activity: this.side.get(e.id), queued, last: lastInfo }
      return { ...base, status: 'idle', queued, last: lastInfo }
    })
  }

  // ---------- manager ----------

  // about: id of a finished task the owner is replying to (a Telegram reply to the result message)
  requestPlan(text, { source = 'web', attachments = [], answerTo = null, about = null } = {}) {
    text = String(text || '').trim()
    if (!text) throw new Error('Пустое поручение')
    const prev = answerTo ? this.store.plan(answerTo) : null
    const plan = this.store.addPlan({
      status: 'queued',
      request: prev ? prev.request : text,
      answer: prev ? text : undefined,
      question: prev ? prev.question : undefined,
      source,
      about: about || undefined,
      attachments: prev ? [...(prev.attachments || []), ...attachments] : attachments,
    })
    if (prev) this.store.updatePlan(prev.id, { status: 'answered', answeredBy: plan.id })
    // a reply to a result is a correction the employee should learn from
    const replied = about && this.store.task(about)
    if (replied && replied.employee !== 'manager') this.learning.noteFeedback(replied, text)
    this.planChain = this.planChain.then(() => this.runPlan(plan.id)).catch((e) => console.error(e))
    return plan
  }

  async runPlan(planId) {
    const plan = this.store.plan(planId)
    if (!plan || plan.status !== 'queued') return
    const mgr = this.emp('manager')
    const active = this.employees.filter((e) => e.active && e.id !== 'manager')
    const inactive = this.employees.filter((e) => !e.active)
    if (!active.length) {
      this.store.updatePlan(planId, { status: 'failed', error: 'Нет ни одного подключённого сотрудника.' })
      return
    }

    const schema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        question: { type: 'string' },
        reply: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              employee: { type: 'string', enum: active.map((e) => e.id) },
              task: { type: 'string' },
              depends_on: { type: 'array', items: { type: 'integer' } },
              inputs: { type: 'array', items: { type: 'string' } },
            },
            required: ['employee', 'task'],
          },
        },
      },
      required: ['summary', 'steps'],
    }

    const lines = [
      `Сегодня: ${today()}`,
      '',
      'Поручение владельца:',
      `«${plan.request}»`,
    ]
    if (plan.question && plan.answer) {
      lines.push('', `Ты уже спросил: «${plan.question}»`, `Ответ владельца: «${plan.answer}»`)
    }
    lines.push(...this.conversation(plan))
    if (plan.attachments?.length) {
      lines.push('', `К поручению приложены файлы (у сотрудника они будут в папке _материалы): ${plan.attachments.map((a, i) => (DATA_RE.test(a) ? `выгрузка клиентов №${i + 1} (имена скрыты)` : path.basename(a))).join(', ')}`)
    }
    lines.push('', 'Кто сейчас работает:')
    for (const e of active) lines.push(`- ${e.id} — ${e.title}: ${e.about}`)
    if (inactive.length) {
      lines.push('', 'Кто ещё не подключён — задачи им давать нельзя:')
      for (const e of inactive) lines.push(`- ${e.title}: ${e.about} (${e.soon || 'позже'})`)
    }
    lines.push('', 'Если это поручение — верни план. Если это вопрос или реплика о том, что уже сделано, — ответь сам в reply, steps оставь пустым.')
    lines.push('Если шаг продолжает или переделывает готовую работу (план Алии, посты Мадины, отчёт), укажи в inputs её id из списка выше (например t-261012-4ae570): файлы этой работы окажутся у сотрудника в папке _от_коллег. Без inputs сотрудник прошлых файлов не увидит.')

    const ws = path.join(P.work, '_manager', planId)
    fs.mkdirSync(ws, { recursive: true })
    this.store.updatePlan(planId, { status: 'thinking', startedAt: new Date().toISOString() })
    this.store.appendEvent(planId, { kind: 'think', text: 'Думает над планом' })

    const { promise } = runClaude({
      bin: this.bin,
      args: buildArgs(mgr, { schema }),
      cwd: ws,
      input: lines.join('\n'),
      timeoutMs: 5 * 60 * 1000,
      env: childEnv(this.cfg.keepApiKey),
      onEvent: (e) => this.onEvent(planId, e),
    })
    const res = await promise
    this.lastActivity.delete(planId)
    const cost = res.result?.total_cost_usd
    const out = res.result?.structured_output

    if (!res.ok || !out) {
      this.store.updatePlan(planId, { status: 'failed', error: res.error || 'Руководитель не вернул план.', cost, finishedAt: new Date().toISOString() })
      this.emit('notify', { kind: 'plan_failed', plan: this.store.plan(planId) })
      return
    }

    const steps = (out.steps || [])
      .filter((s) => s && this.emp(s.employee)?.active && String(s.task || '').trim())
      .map((s, i) => ({
        employee: s.employee,
        task: String(s.task).trim(),
        dependsOn: (s.depends_on || []).filter((d) => Number.isInteger(d) && d >= 0 && d < i),
        inputs: [...new Set((s.inputs || []).map(String))].filter((id) => this.store.task(id)?.status === 'done').slice(0, 6),
      }))

    const question = String(out.question || '').trim()
    const reply = String(out.reply || '').trim()
    const status = steps.length ? 'awaiting' : question ? 'question' : reply ? 'replied' : 'failed'
    this.store.updatePlan(planId, {
      status,
      summary: String(out.summary || '').trim(),
      question: status === 'question' ? question : plan.question,
      reply: status === 'replied' ? reply : undefined,
      steps,
      cost,
      error: status === 'failed' ? 'Руководитель не предложил ни одного шага.' : undefined,
      finishedAt: new Date().toISOString(),
    })
    const kind = { question: 'plan_question', awaiting: 'plan_ready', replied: 'plan_reply' }[status] || 'plan_failed'
    this.emit('notify', { kind, plan: this.store.plan(planId) })
  }

  // What the manager needs to keep the thread: the result the owner replies to,
  // fresh results of the last 3 days and the last exchanges with the owner.
  conversation(plan) {
    const name = (id) => { const e = this.emp(id); return e ? `${e.name || e.title} (${e.title})` : id }
    const when = (iso) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
    const files = (t) => (t.files || []).filter((f) => !/\.(json|html?)$/i.test(f.path)).map((f) => f.path).slice(0, 8).join(', ')
    const out = []
    const about = plan.about && this.store.task(plan.about)
    if (about) {
      out.push('', 'Владелец отвечает на сообщение о готовой работе:',
        `${about.id} · ${name(about.employee)} — «${about.title}», ${when(about.finishedAt || about.createdAt)}`,
        `Задача: ${clip(about.text, 600)}`, `Итог: ${clip(about.result || about.error, 800)}`)
      if (files(about)) out.push(`Файлы: ${files(about)}`)
    }
    const since = Date.now() - 3 * 864e5
    const recent = this.store.tasks
      .filter((t) => ['done', 'failed'].includes(t.status) && t.id !== about?.id && Date.parse(t.finishedAt || t.createdAt) > since)
      .slice(-10).reverse()
    if (recent.length) {
      out.push('', 'Последние работы офиса (свежие сверху, владелец их уже получил):')
      for (const t of recent) {
        const f = files(t)
        out.push(`- ${t.id} · ${when(t.finishedAt || t.createdAt)} ${name(t.employee)}: «${t.title}» — ${t.status === 'done' ? 'готово' : 'не получилось'}${f ? `; файлы: ${f}` : ''}. ${clip(t.result || t.error, 200)}`)
      }
    }
    const talk = this.store.plans.filter((p) => p.id !== plan.id && p.status !== 'queued' && Date.parse(p.createdAt) > since).slice(-5)
    if (talk.length) {
      out.push('', 'Недавний разговор с владельцем:')
      for (const p of talk) {
        out.push(`- Владелец: «${clip(p.answer ? p.answer : p.request, 200)}»`)
        const said = p.reply || (p.status === 'question' ? `спросил: ${p.question}` : p.summary)
        if (said) out.push(`  Ты: ${clip(said, 200)}`)
      }
    }
    return out
  }

  approvePlan(planId) {
    const plan = this.store.plan(planId)
    if (!plan || plan.status !== 'awaiting') throw new Error('Этот план уже не ждёт решения')
    const ids = []
    plan.steps.forEach((s) => {
      const t = this.store.addTask({
        employee: s.employee,
        title: titleOf(s.task),
        text: s.task,
        source: 'plan',
        planId,
        attachments: plan.attachments || [],
        dependsOn: [...(s.inputs || []), ...s.dependsOn.map((d) => ids[d]).filter(Boolean)],
      })
      ids.push(t.id)
    })
    this.store.updatePlan(planId, { status: 'approved', taskIds: ids, approvedAt: new Date().toISOString() })
    this.tick()
    return this.store.plan(planId)
  }

  rejectPlan(planId) {
    const plan = this.store.plan(planId)
    if (!plan || !['awaiting', 'question'].includes(plan.status)) throw new Error('Этот план уже не ждёт решения')
    return this.store.updatePlan(planId, { status: 'rejected' })
  }

  checkPlanDone(planId) {
    if (!planId) return
    const plan = this.store.plan(planId)
    if (!plan || plan.status !== 'approved') return
    const tasks = plan.taskIds.map((id) => this.store.task(id)).filter(Boolean)
    if (!tasks.every((t) => TERMINAL.has(t.status))) return
    const ok = tasks.every((t) => t.status === 'done')
    this.store.updatePlan(planId, { status: ok ? 'done' : 'partial', finishedAt: new Date().toISOString() })
    this.emit('notify', { kind: 'plan_done', plan: this.store.plan(planId), tasks })
  }

  // ---------- tasks ----------

  addTask(employee, text, { source = 'web', attachments = [], dependsOn = [], proposal = null } = {}) {
    const e = this.emp(employee)
    if (!e || e.id === 'manager') throw new Error('Такого сотрудника нет')
    if (!e.active) throw new Error(`${e.title} ещё не подключён (${e.soon || 'позже'})`)
    text = String(text || '').trim()
    if (!text) throw new Error('Пустая задача')
    const t = this.store.addTask({ employee, title: titleOf(text), text, source, attachments, ...(dependsOn.length ? { dependsOn } : {}), ...(proposal ? { proposal } : {}) })
    this.tick()
    return t
  }

  cancelTask(id) {
    const t = this.store.task(id)
    if (!t) throw new Error('Задача не найдена')
    if (t.status === 'queued') return this.store.updateTask(id, { status: 'cancelled', finishedAt: new Date().toISOString() })
    if (t.status === 'running') { this.running.get(id)?.kill(); return t }
    throw new Error('Задача уже завершена')
  }

  retryTask(id) {
    const t = this.store.task(id)
    if (!t) throw new Error('Задача не найдена')
    return this.addTask(t.employee, t.text, { source: t.source, attachments: t.attachments })
  }

  tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const t of this.store.tasks) {
        if (t.status !== 'queued' || !t.dependsOn?.length) continue
        const broken = t.dependsOn.map((d) => this.store.task(d)).find((d) => !d || ['failed', 'cancelled'].includes(d.status))
        if (broken) this.store.updateTask(t.id, { status: 'cancelled', error: 'Не выполнен предыдущий шаг плана.', finishedAt: new Date().toISOString() })
      }
      // the subscription limit is over: wait for it to reset instead of failing the whole queue
      if (this.pausedUntil && Date.now() < this.pausedUntil) return
      while (this.running.size < this.cfg.maxParallel) {
        const busy = new Set([...this.running.values()].map((r) => r.employee))
        const next = this.store.tasks.find((t) =>
          t.status === 'queued' &&
          !busy.has(t.employee) &&
          this.emp(t.employee)?.active &&
          (t.dependsOn || []).every((d) => this.store.task(d)?.status === 'done'))
        if (!next) break
        this.startTask(next)
      }
    } finally {
      this.ticking = false
    }
  }

  prepareWorkspace(task) {
    const ws = path.join(P.work, task.id)
    fs.mkdirSync(ws, { recursive: true })
    // Images stay in knowledge/ассеты; mockups reach them through {{ASSETS}} at render time.
    const knowledge = copyDir(P.knowledge, path.join(ws, '_база'), ['README.md', 'ассеты'])
    let materials = []
    const matDir = path.join(ws, '_материалы')
    for (const rel of task.attachments || []) {
      const src = path.resolve(P.inbox, rel)
      if (!isInside(P.inbox, src) || !fs.existsSync(src)) continue
      const dst = path.join(matDir, path.basename(src))
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      materials.push(path.basename(src))
    }
    // Chats and tables may hold client names and phones: every employee gets them cleaned.
    // Analysts (sales) get theirs cleaned into _данные later, together with the rest of their data.
    if (!this.emp(task.employee)?.sales && materials.some((m) => DATA_RE.test(m))) {
      const notes = cleanExports(matDir, matDir, { keepOther: true })
      for (const n of notes.filter((x) => x.kind === 'ошибка')) this.store.appendEvent(task.id, { kind: 'error', text: `Файл не передан: ${n.error}` })
      materials = fs.readdirSync(matDir)
    }
    const colleagues = []
    for (const depId of task.dependsOn || []) {
      const dep = this.store.task(depId)
      if (!dep) continue
      const who = this.emp(dep.employee)?.title || dep.employee
      const dst = path.join(ws, '_от_коллег', `${who} — ${dep.id}`)
      copyDir(path.join(P.work, dep.id), dst, RESERVED)
      fs.writeFileSync(path.join(dst, 'итог.md'), `# ${who}: итог\n\n${dep.result || ''}\n`, 'utf8')
      colleagues.push(who)
    }
    return { ws, knowledge, materials, colleagues }
  }

  workerPrompt(task, { knowledge, materials, colleagues, videos, stats, sales, prev }) {
    const lines = [`Сегодня: ${today()}`, '', 'Задача:', task.text, '']
    lines.push(knowledge.length
      ? `База знаний — в папке _база (${knowledge.length} файлов).`
      : 'База знаний пока пустая. Если нужен факт о ЖК — ставь пометку [уточнить: …], не выдумывай.')
    if (materials.length) lines.push(`Файлы от владельца — в папке _материалы: ${materials.join(', ')}.`)
    if (colleagues.length) lines.push(`Результаты коллег — в папке _от_коллег (${colleagues.join(', ')}).`)
    if (videos?.length) {
      lines.push('', 'Видео и раскадровки (на каждом кадре подписана секунда):')
      for (const v of videos) {
        lines.push(`- _материалы/${v.name}: ${v.duration.toFixed(1)} с, ${v.width >= v.height ? 'горизонтальное' : 'вертикальное'}, раскадровка _раскадровка/${v.sheet} (кадр каждые ${v.step} с)`)
      }
      lines.push('', `Дата для ролика по умолчанию: ${todayDate()}.`)
    }
    if (stats) {
      const { current, previous } = stats.period
      lines.push('', `Свежие данные Meta — в папке _данные. Эта неделя: ${current.since} — ${current.until}, прошлая: ${previous.since} — ${previous.until}.`)
      if (stats.instagram) lines.push(`- _данные/instagram.json: подписчиков ${stats.instagram.followers}, публикаций за 2 недели ${stats.instagram.posts}; картинки лучших постов — _данные/посты/`)
      if (stats.ads) lines.push(`- _данные/реклама.json: объявлений за неделю ${stats.ads.ads}, расход ${stats.ads.spend} ${stats.ads.currency}; картинки креативов — _данные/креативы/`)
      for (const n of stats.notes) lines.push(`- Не удалось получить: ${n}`)
    }
    if (sales) {
      const b = sales.board
      lines.push('', `Свежие данные — в папке _данные (сегодня ${today()}):`)
      if (fs.existsSync(path.join(P.work, task.id, '_данные', 'история-продаж.md'))) lines.push('- _данные/история-продаж.md — вся история: продажи и брони по месяцам, путь брони (сколько доходят до продажи и за сколько дней), продажи по комнатности, остатки и изменения цен по ночным снимкам офиса')
      if (b) lines.push(`- _данные/шахматка.json — ${b.flats} квартир, свободно ${b.free}; цены не внесены у ${b.noPrice}`, `- _данные/продажи.json — по неделям за 8 недель (за последние 4: продаж ${b.sales4w}, новых броней ${b.bookings4w}) и все смены статусов`)
      if (sales.ads) lines.push(`- _данные/реклама.json — кампании за 30 и 90 дней и объявления за 30 дней: за 30 дней расход ${sales.ads.spend30} ${sales.ads.currency}, переписок и заявок ${sales.ads.results30}`)
      lines.push(`- _данные/крыша-расход.json — расход на Крышу, записей: ${sales.krisha}`)
      const ex = sales.exports.filter((x) => x.kind !== 'ошибка')
      if (ex.length) lines.push(`- _данные/клиенты/ — выгрузки владельца без имён и телефонов: ${ex.map((x) => `${x.file} (${x.kind}${x.messages ? `, сообщений ${x.messages}` : ''}${x.rows != null ? `, строк ${x.rows}` : ''})`).join('; ')}`)
      else lines.push('- Выгрузок с Крыши и чатов WhatsApp в этот раз нет.')
      for (const x of sales.exports.filter((x) => x.kind === 'ошибка')) lines.push(`- Не удалось прочитать ${x.file}: ${x.error}`)
      for (const n of sales.notes) lines.push(`- Не удалось получить: ${n}`)
    }
    if (fs.existsSync(path.join(P.work, task.id, '_данные', 'crm-сводка.md'))) lines.push('- _данные/crm-сводка.md — CRM компании: воронка, где и почему теряем клиентов, менеджеры, откуда приходят покупатели, какая реклама привела покупателей, кто покупает (пол, возраст), что покупают. Это факты о продажах — опирайся на них, а не на догадки по перепискам.')
    const rules = this.learning.rules(task.employee)
    if (rules.length) lines.push('', 'Чему ты научился на правках владельца — соблюдай:', ...rules.map((r) => `- ${r}`))
    // what the company already tried and how it ended (decisions and measured results)
    if (['manager', 'marketing', 'sales', 'revenue', 'smm'].includes(task.employee)) {
      let mem = ''
      try { mem = fs.readFileSync(path.join(P.data, 'memory', 'компания.md'), 'utf8').trim().split('\n').slice(-15).join('\n') } catch {}
      if (mem) lines.push('', 'Память компании — что уже пробовали и чем кончилось (не повторяй неудачное, развивай удачное):', mem)
    }
    const insights = this.learning.insights(task.employee)
    if (insights.length) lines.push('', 'Твои выводы с прошлых недель:', ...insights.map((r) => `- ${r}`))
    if (['manager', 'marketing', 'sales', 'revenue', 'smm'].includes(task.employee) && monthRules()) lines.push('', 'Правила месяца от Диаса (разбор прошлого месяца) — соблюдай:', monthRules())
    // what her published posts really did, measured by the office (post-results.js): her own first, the rest only as topic ideas
    if (task.employee === 'smm') {
      const memo = (f, n) => { try { return fs.readFileSync(path.join(P.data, 'memory', f), 'utf8').split('\n').filter((x) => x.trim()).slice(-n) } catch { return [] } }
      // the stories file starts with its baseline («обычный охват») and is short: read from the top, never the tail
      const res = memo('smm-результаты.md', 12), others = memo('smm-результаты-другие.md', 3), stories = memo('smm-сторис.md', 1000).slice(0, 20)
      if (res.length) lines.push('', 'Как зашли твои публикации из пакета (охват через 7 дней к обычному у таких же публикаций офиса; если цифры нет — Meta её не дала, это не ноль) — делай больше того, что выше обычного:', ...res, 'Лучшие публикации целиком — в _база/образцы/образцы.md.')
      if (stories.length) lines.push('', ...stories)
      if (others.length) lines.push('', 'Не твои публикации (рилсы маркетологов, ручные посты) — только идеи тем, подачу и формат с них не бери:', ...others)
      if (fs.existsSync(path.join(P.knowledge, 'образцы', 'понравилось.md'))) lines.push('', 'Работы, которые владелец оценил 👍, — в _база/образцы/понравилось.md: равняйся на них.')
      if (fs.existsSync(path.join(P.knowledge, 'ассеты-новые.md'))) lines.push('', 'Свежие фото и рендеры от владельца — в _база/ассеты-новые.md (путь, размер, что на фото): бери их в первую очередь, чтобы визуал не повторялся.')
    }
    if (prev) lines.push('', `Твой прошлый отчёт (${prev}) — в _данные/прошлый-отчёт.md. Проверь, сработали ли твои советы, и учти это.`)
    // what the owner approved or turned down before keeps work in line with their taste
    try {
      const mem = fs.readFileSync(path.join(P.data, 'memory', `${task.employee}.md`), 'utf8').trim().split('\n').slice(-10)
      if (mem.length) lines.push('', 'Решения владельца по твоим прошлым предложениям:', ...mem)
    } catch {}
    lines.push('', 'Сохрани результат файлами в текущую папку.')
    return lines.join('\n')
  }

  async prepareStoryboards(id, ws) {
    const dir = path.join(ws, '_материалы')
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => VIDEO_RE.test(n)) : []
    const out = path.join(ws, '_раскадровка')
    const videos = []
    for (const [i, name] of names.entries()) {
      const ev = { kind: 'read', text: `Раскадровка: ${name}` }
      this.lastActivity.set(id, ev)
      this.store.appendEvent(id, ev)
      fs.mkdirSync(out, { recursive: true })
      const sheet = `видео-${i + 1}.jpg`
      try {
        const info = await storyboard(this.ffmpeg, path.join(dir, name), path.join(out, sheet))
        videos.push({ name, sheet, ...info })
      } catch (err) {
        this.store.appendEvent(id, { kind: 'error', text: `Не получилось прочитать ${name}: ${err.message}` })
      }
    }
    return videos
  }

  async startTask(task) {
    const emp = this.emp(task.employee)
    const entry = { employee: task.employee, kill: () => {} }
    this.running.set(task.id, entry)
    this.store.updateTask(task.id, { status: 'running', startedAt: new Date().toISOString(), error: undefined })
    this.store.appendEvent(task.id, { kind: 'start', text: 'Приступает к задаче' })

    let prepared
    try {
      prepared = this.prepareWorkspace(task)
      if (emp.montage) {
        if (!this.ffmpeg) throw new Error('не найден ffmpeg — без него монтаж невозможен')
        prepared.videos = await this.prepareStoryboards(task.id, prepared.ws)
        // Fail early instead of paying for a run that has nothing to edit.
        if (!prepared.videos.length) {
          this.finishTask(task.id, { ok: false, error: 'Нет видео для монтажа. Приложите видео к поручению (кнопка «Файлы» или Telegram) и повторите.' })
          return
        }
      }
      if (emp.sales) {
        const ev = { kind: 'web', text: 'Забирает шахматку, продажи и рекламу' }
        this.lastActivity.set(task.id, ev)
        this.store.appendEvent(task.id, ev)
        try {
          prepared.sales = await collectSales({ portal: this.portal, meta: this.meta, dir: path.join(prepared.ws, '_данные'), materialsDir: path.join(prepared.ws, '_материалы'), withAds: true })
          await this.salesArchive.writeFor(path.join(prepared.ws, '_данные')).catch((err) => console.error('Архив продаж:', err.message))
          await this.crm?.writeFor(path.join(prepared.ws, '_данные')).catch((err) => console.error('CRM:', err.message))
          // the raw exports were turned into clean copies, so they are no longer "files from the owner"
          prepared.materials = fs.existsSync(path.join(prepared.ws, '_материалы')) ? fs.readdirSync(path.join(prepared.ws, '_материалы')) : []
        } catch (err) {
          this.finishTask(task.id, { ok: false, error: `Не удалось получить данные: ${err.message}. Проверьте ⚙ → «Шахматка: портал».` })
          return
        }
      }
      if (emp.sales || emp.meta) {
        const p = this.learning.previousReport(task.employee, task.id)
        if (p) {
          fs.mkdirSync(path.join(prepared.ws, '_данные'), { recursive: true })
          fs.writeFileSync(path.join(prepared.ws, '_данные', 'прошлый-отчёт.md'), p.text, 'utf8')
          prepared.prev = new Date(p.task.finishedAt).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })
        }
      }
      if (emp.meta) {
        const ev = { kind: 'web', text: 'Забирает цифры из Instagram и рекламного кабинета' }
        this.lastActivity.set(task.id, ev)
        this.store.appendEvent(task.id, ev)
        try {
          prepared.stats = await this.meta.collect(path.join(prepared.ws, '_данные'))
          try { this.ads.writeFor(path.join(prepared.ws, '_данные')) } catch (err) { console.error('Архив рекламы:', err.message) }
          await this.crm?.writeFor(path.join(prepared.ws, '_данные')).catch((err) => console.error('CRM:', err.message))
        } catch (err) {
          this.finishTask(task.id, { ok: false, error: `Не удалось получить данные Meta: ${err.message}` })
          return
        }
      }
    } catch (err) {
      this.finishTask(task.id, { ok: false, error: `Не удалось подготовить папку задачи: ${err.message}` })
      return
    }

    const { promise, kill } = runClaude({
      bin: this.bin,
      args: buildArgs(emp),
      cwd: prepared.ws,
      input: this.workerPrompt(task, prepared),
      timeoutMs: this.cfg.taskTimeoutMin * 60 * 1000,
      env: childEnv(this.cfg.keepApiKey),
      onEvent: (e) => this.onEvent(task.id, e),
    })
    entry.kill = kill
    promise.then((res) => this.finishTask(task.id, res, prepared.ws)).catch((err) => {
      console.error('Завершение задачи:', err.message)
      this.running.delete(task.id)
      this.store.updateTask(task.id, { status: 'failed', error: `Сбой при завершении: ${err.message}`, finishedAt: new Date().toISOString() })
      this.tick()
    })
  }

  // Returns the pages that became PNGs.
  async renderMockups(id, ws, only) {
    const pages = only || listOutputs(ws).filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path)
    if (!pages.length) return []
    if (!this.browser) {
      this.store.appendEvent(id, { kind: 'error', text: 'Не найден Chrome или Edge — макеты остались в HTML, картинки не нарисованы.' })
      return []
    }
    const done = []
    for (const f of pages) {
      const ev = { kind: 'write', text: `Рисует картинку: ${f.replace(/\.html?$/i, '.png')}` }
      this.lastActivity.set(id, ev)
      this.store.appendEvent(id, ev)
      this.store.updateTask(id, { activity: ev.text })
      try {
        await renderHtml(this.browser, path.join(ws, f))
        done.push(f)
      } catch (err) {
        this.store.appendEvent(id, { kind: 'error', text: `Не получилось нарисовать ${f}: ${err.message}` })
      }
    }
    return done
  }

  // Free layout check in Chrome (overlaps, covered or clipped text, off-canvas, tiny type).
  async checkDesign(ws, pages) {
    const found = []
    for (const f of pages) {
      try {
        const issues = await checkHtml(this.browser, path.join(ws, f))
        if (issues.length) found.push({ file: f, issues })
      } catch {}
    }
    return found
  }

  // Free checks — the layout in Chrome and every number against the base the employee was given.
  // At most one paid redo by the same employee, and only when a check found something.
  async reviewDesign(id, ws, emp, pages, res) {
    const extra = this.store.task(id)?.text || ''
    const check = async (htmls) => mergeIssues(await this.checkDesign(ws, htmls), checkFacts(ws, listOutputs(ws).map((f) => f.path), extra))
    const isHtml = (f) => /\.html?$/i.test(f)
    const found = await check(pages)
    if (!found.length) {
      this.store.appendEvent(id, { kind: 'done', text: 'Автопроверка: наездов, обрезанного текста и цифр не из базы нет' })
      return res
    }
    const ev = { kind: 'write', text: `Автопроверка нашла недочёты в ${found.length} файл(ах) — исправляет` }
    this.lastActivity.set(id, ev)
    this.store.appendEvent(id, ev)
    this.store.updateTask(id, { activity: ev.text })
    const input = [
      'Автопроверка офиса нашла ошибки в твоих файлах. Это короткая правка, не переделка.',
      '',
      ...found.map((x) => `${x.file}${isHtml(x.file) ? ` (картинка: ${x.file.replace(/\.html?$/i, '.png')})` : ''}:\n- ${x.issues.join('\n- ')}`),
      '',
      'Как исправить:',
      '- Вёрстка: открой png (Read), чтобы увидеть проблему, потом поправь html. Тексты и плашки не ставь position:absolute поверх друг друга: собери их в один столбец (display:flex; flex-direction:column; gap) — тогда блоки физически не наедут. Не помещается — убери лишнюю плашку или сократи текст, шрифт не меньше 22 px.',
      '- Цифры, которых нет в базе: найди верную в _база, _материалы или _от_коллег и поставь её; если такой нет — убери цифру или напиши [уточнить: что именно]. Сама ничего не высчитывай (цену за м², скидки, сроки).',
      '- Имена файлов и смысл текстов не меняй, другие файлы не трогай; если правишь подпись — поправь её и в пакет.json. Правила — _база/картинки-стиль-и-правила.md, раздел «Без наездов».',
      'В конце — одна строка: что исправила.',
    ].join('\n')
    const { promise, kill } = runClaude({
      bin: this.bin,
      args: buildArgs({ ...emp, maxTurns: Math.min(emp.maxTurns, 15) }),
      cwd: ws,
      input,
      timeoutMs: this.cfg.taskTimeoutMin * 60 * 1000,
      env: childEnv(this.cfg.keepApiKey),
      onEvent: (e) => this.onEvent(id, e),
    })
    const entry = this.running.get(id)
    if (entry) entry.kill = kill
    const fix = await promise
    const cost = fix.result?.total_cost_usd || 0
    let left = found
    if (fix.ok) {
      const again = await this.renderMockups(id, ws, found.map((x) => x.file).filter((f) => isHtml(f) && fs.existsSync(path.join(ws, f))))
      left = await check(again)
    }
    const note = left.length
      ? `⚠️ Автопроверка: проверьте — ${left.map((x) => `${x.file.replace(/\.html?$/i, '.png')}: ${x.issues[0]}`).join('; ')}`
      : `✅ Автопроверка: исправлено в ${found.length} файл(ах)`
    this.store.appendEvent(id, { kind: left.length ? 'error' : 'done', text: note })
    const r = res.result || {}
    return { ...res, result: { ...r, total_cost_usd: (r.total_cost_usd || 0) + cost, result: `${String(r.result || '').trim()}\n\n${note}` } }
  }

  // 👍 / 👎 from the owner under a result: 👎 with its reason becomes a lesson, Мадина's 👍 work becomes a sample
  rate(t, dir, why = '') {
    fs.mkdirSync(path.join(P.data, 'memory'), { recursive: true })
    fs.appendFileSync(path.join(P.data, 'memory', 'оценки.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), task: t.id, employee: t.employee, title: t.title, rating: dir, why })}\n`, 'utf8')
    if (dir === 'down') this.learning.noteFeedback(t, `👎 Владелец оценил работу как неудачную: ${why}`)
    else if (t.employee === 'smm') likeWork(t)
  }

  async makeReel(id, ws) {
    const ev = { kind: 'write', text: 'Монтирует ролик: reel.mp4' }
    this.lastActivity.set(id, ev)
    this.store.appendEvent(id, ev)
    this.store.updateTask(id, { activity: ev.text })
    const r = await assembleReel({ ff: this.ffmpeg, browser: this.browser, ws, spec: readSpec(ws), out: path.join(ws, 'reel.mp4') })
    this.store.appendEvent(id, { kind: 'done', text: `Ролик готов: ${r.total.toFixed(1)} с, кусков: ${r.clips}` })
  }

  async finishTask(id, res, ws) {
    const emp = this.emp(this.store.task(id)?.employee)
    if (res.ok && ws && emp) try { this.learning.noteReport(emp.id, ws) } catch {}
    if (res.ok && ws && emp?.meta) {
      try {
        const n = this.ads.takeForecasts(ws, id)
        if (n) this.store.appendEvent(id, { kind: 'done', text: `Прогнозов записано: ${n} — офис сам сверит их с фактом` })
      } catch {}
    }
    if (res.ok && ws && emp?.render) {
      const pages = await this.renderMockups(id, ws)
      if (this.cfg.designCheck !== false) {
        try { res = await this.reviewDesign(id, ws, emp, pages, res) } catch (err) { console.error('Автопроверка:', err.message) }
      }
    }
    if (res.ok && ws && emp?.montage) {
      try {
        await this.makeReel(id, ws)
      } catch (err) {
        res = { ...res, ok: false, error: `Не получилось смонтировать ролик: ${err.message}` }
      }
    }
    this.running.delete(id)
    this.lastActivity.delete(id)
    const r = res.result
    const files = ws ? listOutputs(ws) : []
    const patch = {
      finishedAt: new Date().toISOString(),
      cost: r?.total_cost_usd,
      turns: r?.num_turns,
      tokensIn: r?.usage ? (r.usage.input_tokens || 0) + (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0) : undefined,
      tokensOut: r?.usage?.output_tokens,
      files,
    }
    if (!res.ok && /лимит подписки/i.test(res.error || '')) {
      const reset = (this.store.usage?.fiveHourResetsAt || 0) * 1000
      this.pausedUntil = reset > Date.now() ? reset + 60 * 1000 : Date.now() + 30 * 60 * 1000
      const at = new Date(this.pausedUntil).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' })
      this.store.updateTask(id, { status: 'queued', error: undefined, startedAt: undefined, activity: `ждёт лимит подписки до ${at}` })
      this.store.appendEvent(id, { kind: 'wait', text: `Закончился лимит подписки — продолжу в ${at}` })
      if (!this.limitNotified || Date.now() - this.limitNotified > 3 * 3600e3) {
        this.limitNotified = Date.now()
        this.emit('notify', { kind: 'limit', until: at })
      }
      return
    }
    if (res.ok) {
      Object.assign(patch, { status: 'done', result: String(r.result || '').trim() })
      this.store.appendEvent(id, { kind: 'done', text: 'Готово' })
    } else {
      Object.assign(patch, { status: res.stopped && !res.timedOut ? 'cancelled' : 'failed', error: res.error, result: r?.result ? String(r.result).trim() : undefined })
      this.store.appendEvent(id, { kind: 'error', text: res.error || 'Ошибка' })
    }
    const task = this.store.updateTask(id, patch)
    if (task.status !== 'cancelled') this.emit('notify', { kind: task.status === 'done' ? 'task_done' : 'task_failed', task })
    this.tick()
  }

  onEvent(key, e) {
    if (e.type === 'rate_limit_event' && e.rate_limit_info) {
      const w = e.rate_limit_info.unifiedWindows || {}
      this.store.setUsage({
        status: e.rate_limit_info.status,
        fiveHour: w.five_hour?.utilization,
        fiveHourResetsAt: w.five_hour?.resetsAt,
        sevenDay: w.seven_day?.utilization,
        sevenDayResetsAt: w.seven_day?.resetsAt,
      })
      return
    }
    if (e.type === 'assistant') {
      for (const c of e.message?.content || []) {
        let ev = null
        if (c.type === 'tool_use') ev = describeTool(c.name, c.input)
        else if (c.type === 'text' && c.text?.trim()) ev = { kind: 'say', text: summarizeText(c.text) }
        else if (c.type === 'thinking' && this.lastActivity.get(key)?.kind !== 'think') ev = { kind: 'think', text: 'Думает' }
        if (!ev) continue
        this.lastActivity.set(key, ev)
        this.store.appendEvent(key, ev)
        if (this.store.task(key)) this.store.updateTask(key, { activity: ev.text })
      }
      return
    }
    if (e.type === 'user') {
      for (const c of e.message?.content || []) {
        if (c?.type === 'tool_result' && c.is_error) {
          const text = summarizeText(typeof c.content === 'string' ? c.content : JSON.stringify(c.content))
          this.store.appendEvent(key, { kind: 'error', text: `Не получилось: ${text}` })
        }
      }
    }
  }
}
