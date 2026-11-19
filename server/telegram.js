import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { P } from './paths.js'
import { saveConfig } from './config.js'
import { safeName, uniqueInboxPath } from './http.js'
import { ROLES } from './auth.js'
import { addAssets } from './assets.js'
import { beforeAfter } from './before-after.js'
import { weeksBook, lastWeekMonday } from './reports.js'
import { readBook } from './months.js'

const MAX_DOWNLOAD = 20 * 1024 * 1024 // Bot API limit for files the bot receives
const MAX_SEND = 50 * 1024 * 1024 // and for files it sends
const MAX_TEXT = 3900

const HELP = [
  'Я — пульт вашего офиса.',
  '',
  'Напишите поручение — руководитель составит план и пришлёт его на утверждение.',
  'Фото или видео с подписью — поручение с материалами.',
  'Фото или видео без подписи — сохраню и приложу к следующему поручению.',
  '',
  'Напрямую сотруднику: /smm текст задачи',
  'Ролик из видео: пришлите видео, затем /montazh Ход строительства',
  'Свежие фото и рендеры в базу картинок: фото файлом с подписью /фото altyn qala ход стройки октябрь',
  'Отчёт по Instagram и рекламе: /marketing разбор недели',
  'Оценить работу: 👍 / 👎 под результатом — сотрудник учтёт (👎 спросит, что не так)',
  'Похвалить сотрудника: /praise Мадина',
  'Расход на Крышу за 2 недели: /krisha 150000',
  'Контент-план Instagram на следующую неделю (обычно сам в четверг): /content',
  'Отчёт «Тогда → Сейчас» для клиента (PDF и Excel без сумм, вам — настоящие цифры): /доипосле',
  'Отчёт недели — цифры, график, советы (сам в понедельник): /report, собрать заново: /report заново',
  'Отчёт месяца — PDF, Excel и 5 правил на новый месяц (сам 1-го числа): /месяц, заново: /месяц заново',
  '/portal — открыть портал (дашборд, отчёты, офис)',
  '/status — кто чем занят',
  '/clear — забыть сохранённые фото',
  '/help — эта подсказка',
].join('\n')

// reasons behind 👎: one tap instead of typing
const WHY = { fact: 'Ошибка в фактах', style: 'Не в стиле Altyn Qala', weak: 'Скучно, не цепляет', long: 'Слишком длинно', other: 'Другое…' }

function clip(text, max = MAX_TEXT) {
  text = String(text || '')
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export class Telegram extends EventEmitter {
  constructor({ cfg, office, store }) {
    super()
    this.cfg = cfg
    this.office = office
    this.store = store
    this.offset = 0
    try { this.offset = JSON.parse(fs.readFileSync(path.join(P.data, 'telegram-offset.json'), 'utf8')).offset || 0 } catch {}
    this.bot = null
    this.error = null
    this.abort = null
    this.pending = []
    this.albums = new Map()
    office.on('notify', (n) => this.notify(n).catch((e) => console.error('Telegram:', e.message)))
  }

  get token() { return this.cfg.telegram.token }
  get owner() { return this.cfg.telegram.ownerChatId }

  status() {
    return {
      configured: !!this.token,
      linked: !!this.owner,
      code: this.owner ? null : this.cfg.telegram.linkCode,
      bot: this.bot,
      error: this.error,
    }
  }

  setError(msg) {
    this.error = msg
    this.emit('status')
  }

  async configure(token) {
    if (!/^\d+:[\w-]{30,}$/.test(token)) throw new Error('Это не похоже на токен бота. Он выглядит так: 1234567890:AAH…')
    const me = await this.call('getMe', {}, token)
    this.stop()
    this.cfg.telegram.token = token
    this.cfg.telegram.ownerChatId = null
    this.cfg.telegram.linkCode = String(crypto.randomInt(100000, 999999))
    saveConfig(this.cfg)
    this.bot = me.username
    this.error = null
    this.start()
    this.emit('status')
  }

  unlink() {
    this.cfg.telegram.ownerChatId = null
    this.cfg.telegram.linkCode = String(crypto.randomInt(100000, 999999))
    saveConfig(this.cfg)
    this.emit('status')
  }

  async call(method, params = {}, token = this.token) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: method === 'getUpdates' && this.abort
        ? AbortSignal.any([this.abort.signal, AbortSignal.timeout(65000)])
        : AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) {
      const err = new Error(data.description || `Telegram ответил ошибкой ${res.status}`)
      err.code = data.error_code || res.status
      err.retryAfter = data.parameters?.retry_after
      throw err
    }
    return data.result
  }

  start() {
    if (!this.token || this.abort) return
    this.abort = new AbortController()
    this.loop().catch((e) => console.error('Telegram:', e.message))
  }

  stop() {
    this.abort?.abort()
    this.abort = null
  }

  async loop() {
    const signal = this.abort.signal
    try {
      const me = await this.call('getMe')
      this.bot = me.username
      this.setMenu(this.owner)
      for (const u of this.auth?.state.users || []) this.setMenu(u.id)
      await this.call('deleteWebhook', { drop_pending_updates: false }).catch(() => {})
      this.setError(null)
    } catch (e) {
      this.setError(`Не удалось подключиться к боту: ${e.message}`)
      // a wrong token stays wrong; anything else (no internet at boot) is retried with backoff
      if (/401|unauthorized|not found/i.test(e.message)) { this.abort = null; return }
      this.retry = Math.min((this.retry || 5) * 2, 300)
      await new Promise((r) => setTimeout(r, this.retry * 1000))
      if (!signal.aborted) return this.loop()
      return
    }
    this.retry = 0
    while (!signal.aborted) {
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] })
        if (this.error) this.setError(null)
        await this.flushOutbox()
        for (const u of updates) {
          // saved before handling: after a restart the same message is not processed twice
          this.offset = u.update_id + 1
          this.saveOffset()
          await this.handle(u).catch((e) => console.error('Telegram, обработка:', e.message))
        }
      } catch (e) {
        if (signal.aborted) break
        if (e.code === 401) { this.setError('Токен бота больше не действует. Вставьте новый.'); this.abort = null; return }
        this.setError(`Нет связи с Telegram: ${e.message}. Пробую снова…`)
        await new Promise((r) => setTimeout(r, (e.retryAfter || 5) * 1000))
      }
    }
  }

  // Messages that could not go out (no internet, Telegram down) wait in data/outbox.json
  // and are sent as soon as the connection is back.
  send(text, extra = {}) {
    if (!this.owner) return Promise.resolve(null)
    const params = { chat_id: this.owner, text: clip(text), ...extra }
    return this.call('sendMessage', params).catch((e) => {
      if (!this.lost(e)) throw e
      this.queue({ method: 'sendMessage', params })
      return null
    })
  }

  // network trouble, not a refusal: worth sending again later
  lost(e) { return !e.code || e.code >= 500 || e.code === 429 || /fetch failed|timeout|network|ECONN|ENOTFOUND|aborted/i.test(e.message) }

  outbox() { try { return JSON.parse(fs.readFileSync(path.join(P.data, 'outbox.json'), 'utf8')) } catch { return [] } }
  setOutbox(list) {
    const file = path.join(P.data, 'outbox.json')
    if (!list.length) return fs.rmSync(file, { force: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify(list.slice(-200)), 'utf8')
    fs.renameSync(file + '.tmp', file)
  }
  queue(item) { this.setOutbox([...this.outbox(), { ...item, at: Date.now() }]) }

  async flushOutbox() {
    const list = this.outbox()
    if (!list.length || this.flushing) return
    this.flushing = true
    try {
      while (list.length) {
        const it = list[0]
        try {
          if (it.method === 'file') await this.sendFile(it.file, true)
          else await this.call(it.method, it.params)
        } catch (e) {
          if (this.lost(e)) break // still offline: keep the rest for the next round
        }
        list.shift()
        this.setOutbox(list)
      }
    } finally {
      this.flushing = false
    }
  }

  saveOffset() {
    try { fs.writeFileSync(path.join(P.data, 'telegram-offset.json'), JSON.stringify({ offset: this.offset })) } catch {}
  }

  // the weekly pack preview: up to 10 pictures as one album
  async sendAlbum(files) {
    files = files.filter((f) => fs.existsSync(f)).slice(0, 10)
    if (!files.length || !this.owner) return null
    if (files.length === 1) return this.sendFile(files[0])
    const form = new FormData()
    form.append('chat_id', String(this.owner))
    form.append('media', JSON.stringify(files.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }))))
    files.forEach((f, i) => form.append(`f${i}`, new Blob([fs.readFileSync(f)]), path.basename(f)))
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMediaGroup`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) throw new Error(data.description || 'не удалось отправить альбом')
    return data.result
  }

  useSmmPack(pack) {
    this.smmPack = pack
    pack.on('day', async ({ pack: id, date, approved, text, images }) => {
      if (!this.owner || !this.token) return
      try {
        await this.sendAlbum(images).catch((e) => console.error('Telegram, альбом:', e.message))
        const buttons = approved ? [[{ text: '✅ Утвердить день', callback_data: `ky:${id}:${date}` }, { text: '✏️ Исправить ещё', callback_data: `kd:${id}:${date}` }]] : [[{ text: '✏️ Исправить ещё', callback_data: `kd:${id}:${date}` }]]
        await this.send(text, { reply_markup: { inline_keyboard: buttons } })
      } catch (e) { console.error('Telegram:', e.message) }
    })
    pack.on('say', async ({ text, files = [], buttons }) => {
      if (!this.owner || !this.token) return
      try {
        await this.send(text, buttons ? { reply_markup: { inline_keyboard: buttons } } : undefined)
        for (const f of files) await this.sendFile(f)
      } catch (e) { console.error('Telegram:', e.message) }
    })
  }

  async sendFile(file, noQueue = false) {
    try {
      return await this.sendFileNow(file)
    } catch (e) {
      if (noQueue || !this.lost(e) || !fs.existsSync(file)) throw e
      this.queue({ method: 'file', file })
      return null
    }
  }

  async sendFileNow(file) {
    // Videos go as real videos (playable and saveable to the phone's gallery);
    // as a document Telegram turns a silent mp4 into a GIF. Images stay documents to avoid compression.
    const video = /\.(mp4|mov)$/i.test(file)
    const form = new FormData()
    form.append('chat_id', String(this.owner))
    form.append(video ? 'video' : 'document', new Blob([fs.readFileSync(file)]), path.basename(file))
    if (video) form.append('supports_streaming', 'true')
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${video ? 'sendVideo' : 'sendDocument'}`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) { const err = new Error(data.description || 'не удалось отправить файл'); err.code = data.error_code || res.status; throw err }
    return data.result
  }

  async handle(u) {
    if (u.callback_query) return this.onCallback(u.callback_query)
    const m = u.message
    if (!m || m.chat?.type !== 'private') return
    const text = (m.text || m.caption || '').trim()

    // portal: invites and logins work for any chat, the auth module decides who gets in
    const deep = text.match(/^\/start\s+(login|inv)_([\w-]{8,64})$/)
    if (deep && this.auth && this.owner) return this.onPortalStart(m, deep[1], deep[2])

    if (!this.owner) {
      // the 6-digit code cannot be guessed: 5 wrong tries from a chat and that chat is ignored
      this.tries ??= new Map()
      const tries = this.tries.get(m.chat.id) || 0
      if (tries >= 5) return
      const hit = text.match(/^\/start\s+(\d{6})$/)
      if (hit && hit[1] !== this.cfg.telegram.linkCode) this.tries.set(m.chat.id, tries + 1)
      if (hit && hit[1] === this.cfg.telegram.linkCode) {
        this.cfg.telegram.ownerChatId = m.chat.id
        this.cfg.telegram.linkCode = ''
        saveConfig(this.cfg)
        this.emit('status')
        return this.send(`Готово, бот привязан к вам.\n\n${HELP}`)
      }
      return this.call('sendMessage', { chat_id: m.chat.id, text: 'Чтобы привязать бота, отправьте /start и шестизначный код с экрана офиса.' })
    }
    if (m.chat.id !== this.owner) {
      // people with portal access get only the portal button, never the office controls
      const typed = text.match(/^\/login\s+(\d{6})$/)
      if (typed && this.auth) return this.onTypedLogin(m.chat.id, m.from.id, typed[1])
      if (this.auth?.user(m.from?.id)) return this.call('sendMessage', { chat_id: m.chat.id, text: `Это бот офиса Altyn Qala. ${this.portalHint()}`, ...this.portalButton() })
      return
    }
    if (!this.cfg.telegram.ownerName && m.from?.first_name) { this.cfg.telegram.ownerName = m.from.first_name; saveConfig(this.cfg) }

    if (m.photo || m.document || m.video) return this.onFile(m, text)
    if (m.voice || m.audio || m.video_note) return this.send('Голосовые пока не понимаю — напишите текстом.')
    if (!text) return

    if (text.startsWith('/')) return this.onCommand(text)

    const replyTo = m.reply_to_message?.message_id
    const planId = replyTo && (this.planEdits?.get(replyTo) || this.initiative?.state.proposals.find((p) => p.kind === 'week-plan' && p.status === 'new' && p.tgMessageId === replyTo)?.id)
    if (planId) {
      this.planEdits?.delete(replyTo)
      this.initiative.revisePlan(planId, text).catch((e) => console.error('План недели:', e.message))
      return this.send('🗓 Диас переделывает план с учётом ваших правок — пришлю новый.', { reply_to_message_id: m.message_id })
    }
    const rated = replyTo && this.rateWhy?.get(replyTo)
    if (rated) {
      this.rateWhy.delete(replyTo)
      const t = this.store.task(rated)
      if (t) this.office.rate(t, 'down', text)
      return this.send(`👎 Записал в уроки${t ? ` (${this.office.emp(t.employee)?.name || t.employee})` : ''}. Переделать — ответьте на результат, что исправить.`, { reply_to_message_id: m.message_id })
    }
    const fix = replyTo && this.packFix?.get(replyTo)
    if (fix && this.smmPack) {
      this.packFix.delete(replyTo)
      try {
        this.smmPack.fixDay(fix.pack, fix.date, text)
        return this.send('✏️ Передал Мадине — переделает только этот день и пришлю на утверждение.', { reply_to_message_id: m.message_id })
      } catch (e) { return this.send(`⚠️ ${e.message}`, { reply_to_message_id: m.message_id }) }
    }
    const asked = replyTo && this.store.plans.find((p) => p.status === 'question' && p.tgMessageId === replyTo)
    // a reply to a result (its text or one of its files) tells the manager which work is meant
    const about = replyTo && !asked ? this.store.tasks.find((t) => (t.tgMessageIds || []).includes(replyTo)) : null
    // a reply to a bot message: the manager must see what it was about, not only the short answer
    const quoted = !asked && !about && m.reply_to_message?.from?.is_bot ? String(m.reply_to_message.text || m.reply_to_message.caption || '').trim() : ''
    // "внесено" on a payment reminder needs no manager: the office reads the chessboard itself
    if (/^💰 Кв\. \d+/.test(quoted) && text.length < 80 && /внес|внёс|оплат|готов|сделал|сделано|заполн|^ок|^да([ .!,]|$)|^\+/i.test(text)) {
      return this.send('👍 Спасибо! Офис сам забирает оплаты из шахматки — пересчитывать ничего не нужно. В портале выручка обновится в течение 10 минут.', { reply_to_message_id: m.message_id })
    }
    const attachments = this.takePending()
    const ask = quoted ? `В ответ на сообщение офиса: «${quoted.slice(0, 800)}»

Ответ владельца: ${text}` : text
    const plan = this.office.requestPlan(ask, { source: 'telegram', attachments, answerTo: asked ? asked.id : null, about: about ? about.id : null })
    const note = attachments.length ? ` Приложил фото: ${attachments.length}.` : ''
    return this.send(`Передал руководителю.${note}`, { reply_to_message_id: m.message_id }).then(() => plan)
  }

  takePending() {
    const list = this.pending
    this.pending = []
    return list
  }

  async onCommand(text) {
    const [cmd, ...rest] = text.split(/\s+/)
    const arg = rest.join(' ').trim()
    const name = cmd.slice(1).split('@')[0].toLowerCase()
    if (name === 'start' || name === 'help') return this.send(HELP)
    if (name === 'report' || name === 'отчёт' || name === 'отчет' || name === 'неделя') {
      const force = /заново|new|снова/i.test(arg)
      this.initiative.weekReport({ force }).then((r) => { if (r?.error) this.send(`⚠️ ${r.error}`) }).catch((e) => this.send(`⚠️ ${e.message}`))
      const ready = weeksBook().weeks[lastWeekMonday(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date()))]?.taskId
      return force || !ready ? this.send('📊 Собираю отчёт недели: цифры считает код, Диас пишет выводы и советы. Пришлю через 2–3 минуты.') : undefined
    }
    if (name === 'login' && this.auth) return this.onTypedLogin(this.owner, this.owner, arg)
    if (name === 'content' || name === 'контент') {
      this.initiative.contentPlan()
      return this.send('📅 Алия составляет контент-план, Мадина сразу нарисует посты и сторис — пришлю готовый «Пакет недели» на утверждение.')
    }
    if (name === 'доипосле' || name === 'before' || name === 'тогдасейчас') {
      if (this.reportBusy) return this.send('⏳ Уже собираю отчёт «Тогда → Сейчас».')
      this.reportBusy = true
      beforeAfter({ portal: this.office.portal, meta: this.office.meta, store: this.store, smmPack: this.smmPack, initiative: this.initiative, employees: this.office.employees, browser: this.office.browser })
        .then(async (r) => { await this.send(r.text); for (const f of r.files) await this.sendFile(f) })
        .catch((e) => this.send(`⚠️ Отчёт «Тогда → Сейчас» не собрался: ${e.message}`).catch(() => {}))
        .finally(() => { this.reportBusy = false })
      return this.send('📊 Собираю отчёт «Тогда → Сейчас»: шахматка, Instagram, работа офиса. Пришлю PDF и Excel через 2–3 минуты.')
    }
    if (name === 'portal' || name === 'портал') return this.send(`🏢 Портал REVION. ${this.portalHint()}`, this.portalButton())
    if (name === 'praise' || name === 'похвала') {
      const who = this.office.employees.find((e) => e.name && arg && e.name.toLowerCase().startsWith(arg.toLowerCase().slice(0, 3)))
      if (!who) return this.send('Кого похвалить? Например: /praise Мадина')
      this.initiative.praise(who.id)
      return this.send(`👏 Передал. ${who.name} рад(а)!`)
    }
    if (name === 'krisha' || name === 'крыша') {
      const amount = Number(arg.replace(/[^\d]/g, ''))
      if (!amount) return this.send('Напишите сумму в тенге после команды, например: /krisha 150000')
      this.initiative.addKrisha(amount)
      return this.send(`Записал: Крыша — ${amount.toLocaleString('ru-RU')} ₸. Напомню через 2 недели.`)
    }
    if (name === 'clear') { this.pending = []; return this.send('Сохранённые фото забыл.') }
    if (name === 'status') {
      const lines = this.office.employeeStates().map((e) => {
        if (e.status === 'soon') return `▫️ ${e.name ? e.name + ", " : ""}${e.title} — ${e.soon}`
        const icon = e.status === 'working' ? '🟢' : e.status === 'waiting' ? '🟡' : '⚪️'
        const what = e.activity?.text || (e.status === 'idle' ? 'свободен' : '')
        const q = e.queued ? `, в очереди: ${e.queued}` : ''
        return `${icon} ${e.name ? e.name + ", " : ""}${e.title} — ${what}${q}`
      })
      return this.send(lines.join('\n'))
    }
    if (name === 'месяц' || name === 'month') {
      const now = new Date()
      const last = new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(now).slice(0, 7)}-01T12:00:00+05:00`) - 864e5)
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(last).slice(0, 7)
      const force = /заново|new|снова/i.test(arg)
      this.initiative.monthReport(month, { force }).then((r) => { if (r?.error) this.send(`⚠️ ${r.error}`) }).catch((e) => this.send(`⚠️ ${e.message}`))
      return force || !readBook().months[month]?.report ? this.send('🗓 Собираю отчёт месяца: PDF, Excel и правила на месяц. Пришлю через несколько минут.') : undefined
    }
    if (name === 'фото' || name === 'photo') {
      if (!arg) return this.send('Напишите после команды, что на фото и какой ЖК, например: /фото altyn qala ход стройки октябрь')
      const files = this.takePending()
      if (!files.length) return this.send('Пришлите фото с подписью /фото описание — или сначала фото, потом команду.')
      const { added, skipped } = addAssets(files, arg)
      if (!added.length) return this.send(`Это не фото (${skipped.join(', ')}). Нужны jpg или png.`)
      return this.send(`📸 Добавил в базу картинок: ${added.length} — ${added.map((x) => `${x.file} (${x.shape})`).join(', ')}. Мадина увидит их в следующей задаче.\nСовет: отправляйте фото «файлом» — так Telegram не сжимает качество.${skipped.length ? `\nНе картинки, пропустил: ${skipped.join(', ')}` : ''}`)
    }
    const emp = this.office.emp(name)
    if (emp && emp.id !== 'manager') {
      if (!arg) return this.send(`Напишите задачу после команды: /${emp.id} текст задачи`)
      try {
        const t = this.office.addTask(emp.id, arg, { source: 'telegram', attachments: this.takePending() })
        return this.send(`Поставил в очередь: ${emp.title}. Задача ${t.id}.`)
      } catch (e) {
        return this.send(e.message)
      }
    }
    return this.send(`Не знаю такой команды.\n\n${HELP}`)
  }

  async download(fileId, name) {
    const info = await this.call('getFile', { file_id: fileId })
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${info.file_path}`, { signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error('не удалось скачать файл')
    const dest = uniqueInboxPath(safeName(name || path.basename(info.file_path)))
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    return path.relative(P.inbox, dest).split(path.sep).join('/')
  }

  async onFile(m, caption) {
    let fileId, name, size
    if (m.photo) {
      const best = m.photo[m.photo.length - 1]
      fileId = best.file_id; size = best.file_size; name = `фото-${m.message_id}.jpg`
    } else if (m.video) {
      fileId = m.video.file_id; size = m.video.file_size; name = m.video.file_name || `видео-${m.message_id}.mp4`
    } else {
      fileId = m.document.file_id; size = m.document.file_size; name = m.document.file_name || `файл-${m.message_id}`
    }
    if (size && size > MAX_DOWNLOAD) {
      return this.send(`Файл «${name}» больше 20 МБ — Telegram не даёт ботам скачивать такие. Отправьте видео сжатым (обычным видео, не файлом) или приложите его на компьютере в окне офиса.`)
    }

    if (m.media_group_id) {
      // Album items arrive one by one and videos take seconds to download, so the album
      // is closed only after a quiet pause with no download in progress.
      const album = this.albums.get(m.media_group_id) || { files: [], caption: '', inflight: 0 }
      this.albums.set(m.media_group_id, album)
      if (caption) album.caption = caption
      clearTimeout(album.timer)
      album.inflight++
      try {
        album.files.push(await this.download(fileId, name))
      } finally {
        album.inflight--
        this.armAlbum(m.media_group_id)
      }
      return
    }
    return this.afterFiles([await this.download(fileId, name)], caption)
  }

  armAlbum(id) {
    const album = this.albums.get(id)
    if (!album) return
    clearTimeout(album.timer)
    album.timer = setTimeout(() => { if (!album.inflight) this.finishAlbum(id) }, 4000)
  }

  finishAlbum(id) {
    const album = this.albums.get(id)
    this.albums.delete(id)
    if (album?.files.length) this.afterFiles(album.files, album.caption).catch((e) => console.error('Telegram:', e.message))
  }

  useInitiative(initiative) {
    this.initiative = initiative
    const show = (p, again) => {
      if (!this.owner || !this.token) return
      const who = this.office.emp(p.from)
      if (p.kind === 'week-plan') {
        const name = (id) => this.office.emp(id)?.name || id
        const lines = p.items.map((x, i) => `${i + 1}. ${name(x.employee)}: ${x.title}${x.days ? ` — до ${new Date(Date.now() + x.days * 864e5).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' })}` : ''}\n   зачем: ${x.why}${x.expected ? `\n   ждём: ${x.expected}` : ''}`)
        const text = `${again ? '⏰ Напоминаю — ' : ''}🗓 ${p.title} от Диаса\n\n${p.text}\n\n${lines.join('\n\n')}\n\nЧтобы убрать отдельные дела — откройте «План» в портале.`
        const buttons = [[{ text: '✅ Утвердить всё', callback_data: `py:${p.id}` }], [{ text: '✏️ Изменить', callback_data: `pe:${p.id}` }, { text: '✖️ Отклонить', callback_data: `pn:${p.id}` }]]
        this.send(text, { reply_markup: { inline_keyboard: buttons } }).then((msg) => { if (msg) { p.tgMessageId = msg.message_id; this.initiative.save() } }).catch((e) => console.error('Telegram:', e.message))
        return
      }
      if (p.kind === 'smm-pack') {
        const buttons = [[{ text: '✅ Утвердить неделю', callback_data: `py:${p.id}` }], [{ text: '✏️ Исправить день', callback_data: `kf:${p.pack}` }, { text: '✖️ Не публиковать', callback_data: `pn:${p.id}` }]]
        this.sendAlbum(p.preview || []).catch((e) => console.error('Telegram, альбом:', e.message))
          .then(async () => { for (const d of p.days || []) await this.send(d.text).catch(() => {}) })
          .then(() => this.send(`${again ? '⏰ Напоминаю — ' : ''}📦 ${p.title} от Мадины — на утверждение

${p.text}`, { reply_markup: { inline_keyboard: buttons } }))
          .catch((e) => console.error('Telegram:', e.message))
        return
      }
      const head = p.kind === 'month-review' ? '🗓 Разбор месяца от Диаса' : p.kind === 'month-goals' ? '🎯 Цели месяца на утверждение' : p.kind === 'week-goal' ? '🎯 План недели на утверждение' : p.kind === 'content-plan' ? '📅 Контент-план на утверждение' : p.kind === 'weekly' ? '💡 Предложение на неделю' : p.urgent ? '🚨 Срочно' : '📈 Заметили в цифрах'
      const text = `${again ? '⏰ Напоминаю — ' : ''}${head}\nот: ${who?.name || p.from} (${who?.title || ''})\n\n${p.title}\n${p.text}`
      const buttons = ['week-goal', 'month-goals'].includes(p.kind)
        ? [[{ text: '✅ Утвердить', callback_data: `py:${p.id}` }, { text: '✖️ Не надо', callback_data: `pn:${p.id}` }]]
        : p.task || p.tasks
        ? [[{ text: '✅ Делать', callback_data: `py:${p.id}` }, { text: '✖️ Не надо', callback_data: `pn:${p.id}` }]]
        : [[{ text: '👍 Понял', callback_data: `py:${p.id}` }, { text: '✖️ Неважно', callback_data: `pn:${p.id}` }]]
      this.send(text, { reply_markup: { inline_keyboard: buttons } }).catch((e) => console.error('Telegram:', e.message))
    }
    initiative.on('proposal', (p) => show(p, false))
    // the weekly and the monthly report: a short message with a button pair per advice, then the PDF (and Excel);
    // a reply to any of them goes back to Диас
    initiative.on('report', async ({ task: t, advice = [] }) => {
      if (!this.owner || !this.token) return
      const ids = []
      const rows = advice.map((p) => [{ text: `✅ ${p.n || ''} Делать`.replace('  ', ' '), callback_data: `wy:${p.id}` }, { text: `✖️ ${p.n || ''} Не надо`.replace('  ', ' '), callback_data: `wn:${p.id}` }])
      const parts = []
      for (const block of String(t.result || '').split(/\n\s*\n/)) {
        if (parts.length && (parts.at(-1) + '\n\n' + block).length <= MAX_TEXT) parts[parts.length - 1] += '\n\n' + block
        else parts.push(block)
      }
      for (const [i, part] of parts.entries()) {
        const msg = await this.send(part, i === parts.length - 1 && rows.length ? { reply_markup: { inline_keyboard: rows } } : {}).catch((e) => console.error('Telegram:', e.message))
        if (msg) ids.push(msg.message_id)
      }
      for (const f of (t.files || []).filter((x) => /\.(pdf|xlsx)$/i.test(x.path))) {
        const sent = await this.sendFile(path.join(P.work, t.id, f.path)).catch((e) => console.error('Telegram, файл:', e.message))
        if (sent) ids.push(sent.message_id)
      }
      this.store.updateTask(t.id, { tgMessageIds: ids })
    })
    // older callers: a task with a card and a PDF
    initiative.on('director', async (t) => {
      if (!this.owner || !this.token) return
      const ids = []
      // a long explained report is split at blank lines instead of being cut off
      const parts = []
      for (const block of String(t.result || '').split(/\n\s*\n/)) {
        if (parts.length && (parts.at(-1) + '\n\n' + block).length <= MAX_TEXT) parts[parts.length - 1] += '\n\n' + block
        else parts.push(block)
      }
      for (const part of parts) {
        const msg = await this.send(part).catch((e) => console.error('Telegram:', e.message))
        if (msg) ids.push(msg.message_id)
      }
      for (const f of (t.files || []).filter((x) => /\.pdf$/i.test(x.path))) {
        const sent = await this.sendFile(path.join(P.work, t.id, f.path)).catch((e) => console.error('Telegram, файл:', e.message))
        if (sent) ids.push(sent.message_id)
      }
      this.store.updateTask(t.id, { tgMessageIds: ids })
    })
    initiative.on('remind', (p) => show(p, true))
    initiative.on('ask', (text) => this.send(text).catch(() => {}))
    // the morning line: numbers and tasks of the home page, with a button to the portal
    initiative.on('say', (text) => this.send(text, this.portalButton()).catch((e) => console.error('Telegram:', e.message)))
    initiative.on('pay', ({ n, to, from }) => {
      const text = to === 'Продана'
        ? `💰 Кв. ${n} — продана. Если оплата была не полной суммой сразу, впишите в шахматке взнос и платежи — иначе выручка посчитает всю цену квартиры${from === 'Бронь' ? ' (за вычетом брони)' : ''}.`
        : to === 'Бронь'
          ? `💰 Кв. ${n} — новая бронь. Впишите в шахматке сумму и дату оплаты брони, иначе её не будет в выручке.`
          : `💰 Кв. ${n} — рассрочка. Впишите в шахматке первоначальный взнос и график платежей, иначе деньги по ней не войдут в выручку.`
      const url = /^https:/.test(this.cfg.portal?.url || '') ? this.cfg.portal.url : ''
      this.send(text, url ? { reply_markup: { inline_keyboard: [[{ text: '📋 Открыть шахматку', url }]] } } : {}).catch((e) => console.error('Telegram:', e.message))
    })
  }

  async afterFiles(files, caption) {
    if (!caption) {
      this.pending.push(...files)
      return this.send(`Сохранил файлов: ${files.length}. Всего ждут поручения: ${this.pending.length}.\nНапишите, что с ними сделать, — передам руководителю вместе с файлами.`)
    }
    const attachments = [...this.takePending(), ...files]
    if (caption.startsWith('/')) {
      this.pending = attachments
      return this.onCommand(caption)
    }
    this.office.requestPlan(caption, { source: 'telegram', attachments })
    return this.send(`Передал руководителю вместе с файлами (${attachments.length}). План пришлю на утверждение.`)
  }

  async onCallback(q) {
    if (String(q.data || '').startsWith('lg:') && this.auth) return this.onLoginTap(q)
    if (q.message?.chat?.id !== this.owner) return this.call('answerCallbackQuery', { callback_query_id: q.id })
    const [action, planId, extra] = String(q.data || '').split(':')
    let answer = ''
    let status = ''
    try {
      if (action === 'ap') { this.office.approvePlan(planId); answer = 'Утверждено'; status = '✅ Утверждено — раздаю задачи.' }
      else if (action === 'rj') { this.office.rejectPlan(planId); answer = 'Отклонено'; status = '✖️ Отклонено.' }
      else if (action === 'pr') {
        this.initiative.praise(planId)
        const who = this.office.emp(planId)
        answer = `${who?.name || 'Сотрудник'} рад(а) 😊`
      }
      else if (action === 'rt' || action === 'rr') {
        const t = this.store.task(planId)
        if (!t) throw new Error('Задача не найдена')
        const who = this.office.emp(t.employee)?.name || 'Сотрудник'
        if (action === 'rt' && extra === 'up') {
          this.office.rate(t, 'up')
          try { this.initiative.praise(t.employee) } catch {}
          answer = 'Спасибо!'
          status = `👍 Хорошо — ${who} запомнит${t.employee === 'smm' ? ', картинки ушли в образцы' : ''}.`
        } else if (action === 'rt') {
          await this.send('👎 Что не так? Выберите причину — или «Другое» и напишите своими словами.', { reply_markup: { inline_keyboard: Object.entries(WHY).map(([k, l]) => [{ text: l, callback_data: `rr:${t.id}:${k}` }]) } })
          return this.call('answerCallbackQuery', { callback_query_id: q.id, text: 'Что не так?' }).catch(() => {})
        } else if (extra === 'other') {
          this.rateWhy ??= new Map()
          const ask = await this.send('Напишите, что не так, одной-двумя фразами — ответом на это сообщение.', { reply_markup: { force_reply: true } })
          if (ask) this.rateWhy.set(ask.message_id, t.id)
          return this.call('answerCallbackQuery', { callback_query_id: q.id, text: 'Напишите' }).catch(() => {})
        } else {
          this.office.rate(t, 'down', WHY[extra] || extra)
          answer = 'Записал'
          status = `👎 ${WHY[extra] || extra} — записал в уроки (${who}). Переделать — ответьте на результат, что исправить.`
        }
      }
      else if (action === 'pe') {
        this.planEdits ??= new Map()
        const ask = await this.send('✏️ Что поменять в плане? Ответьте на это сообщение — Диас пересоберёт план.', { reply_markup: { force_reply: true } })
        if (ask) this.planEdits.set(ask.message_id, planId)
        answer = 'Напишите, что поменять'
      }
      else if (action === 'kf' && this.smmPack) {
        const days = this.smmPack.dates(planId)
        if (!days.length) throw new Error('Исправлять уже нечего')
        const name = (d) => new Date(`${d}T12:00:00+05:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' })
        const rows = []
        for (let i = 0; i < days.length; i += 3) rows.push(days.slice(i, i + 3).map((d) => ({ text: name(d), callback_data: `kd:${planId}:${d}` })))
        await this.send('✏️ Какой день исправить?', { reply_markup: { inline_keyboard: rows } })
        answer = 'Выберите день'
        return this.call('answerCallbackQuery', { callback_query_id: q.id, text: answer }).catch(() => {})
      }
      else if (action === 'kd' && this.smmPack) {
        this.packFix ??= new Map()
        const name = new Date(`${extra}T12:00:00+05:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' })
        const ask = await this.send(`✏️ Что исправить в ${name}? Ответьте на это сообщение — Мадина переделает только этот день.`, { reply_markup: { force_reply: true } })
        if (ask) this.packFix.set(ask.message_id, { pack: planId, date: extra })
        return this.call('answerCallbackQuery', { callback_query_id: q.id, text: 'Напишите правку' }).catch(() => {})
      }
      else if (action === 'ky' && this.smmPack) {
        const n = this.smmPack.approveDay(planId, extra)
        answer = 'День утверждён'
        status = `✅ День утверждён — ${n} ${n === 1 ? 'публикация выйдет' : 'публикации выйдут'} по расписанию.`
      }
      else if (action === 'wy' || action === 'wn') {
        // one advice of a report: only its own pair of buttons goes, the others stay
        const r = this.initiative.decide(planId, action === 'wy')
        const n = r.proposal?.n ? `${r.proposal.n}. ` : ''
        answer = action === 'wy' ? 'Принято' : 'Отклонено'
        const line = action === 'wy' ? `✅ ${n}Принято${r.task ? ` — задача у: ${this.office.emp(r.task.employee)?.name || r.task.employee}` : ''}` : `✖️ ${n}Не надо — запомнил`
        const rest = (q.message.reply_markup?.inline_keyboard || []).filter((row) => !row.some((b) => String(b.callback_data || '').endsWith(`:${planId}`)))
        await this.call('answerCallbackQuery', { callback_query_id: q.id, text: answer }).catch(() => {})
        return this.call('editMessageText', { chat_id: this.owner, message_id: q.message.message_id, text: clip(`${q.message.text}\n\n${line}`), reply_markup: { inline_keyboard: rest } }).catch(() => {})
      }
      else if (action === 'py' || action === 'pn') {
        const r = this.initiative.decide(planId, action === 'py')
        answer = action === 'py' ? 'Принято' : 'Отклонено'
        status = action === 'py'
          ? (r.approved != null ? `✅ План утверждён: ${r.approved} дел ушли исполнителям.` : r.task ? `✅ Принято — задача поставлена: ${this.office.emp(r.task.employee)?.name || r.task.employee}.` : '✅ Принято.')
          : '✖️ Не надо — запомнил.'
      }
    } catch (e) {
      answer = e.message
    }
    await this.call('answerCallbackQuery', { callback_query_id: q.id, text: answer }).catch(() => {})
    if (status) {
      await this.call('editMessageText', { chat_id: this.owner, message_id: q.message.message_id, text: clip(`${q.message.text}\n\n${status}`) }).catch(() => {})
    } else {
      await this.call('editMessageReplyMarkup', { chat_id: this.owner, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {})
    }
  }

  useAuth(auth) { this.auth = auth }

  get portalUrl() { return this.cfg.portalWeb?.publicUrl || '' }

  portalHint() {
    if (/^https:/.test(this.portalUrl)) return 'Откройте портал кнопкой ниже или кнопкой «Портал» слева от поля ввода.'
    return 'Портал пока открывается только на компьютере офиса: http://localhost:' + (this.cfg.portalWeb?.port || 3780)
  }

  portalButton() {
    if (!/^https:/.test(this.portalUrl)) return {}
    return { reply_markup: { inline_keyboard: [[{ text: '🏢 Открыть портал', web_app: { url: this.portalUrl } }]] } }
  }

  // the "Портал" button next to the message field
  setMenu(chat) {
    if (!/^https:/.test(this.portalUrl) || !chat) return
    this.call('setChatMenuButton', { chat_id: chat, menu_button: { type: 'web_app', text: 'Портал', web_app: { url: this.portalUrl } } }).catch(() => {})
  }

  async onPortalStart(m, kind, t) {
    const chat = m.chat.id
    if (kind === 'inv') {
      const r = this.auth.acceptInvite(t, m.from)
      if (r.error) return this.call('sendMessage', { chat_id: chat, text: r.error })
      await this.call('sendMessage', { chat_id: chat, text: `Здравствуйте, ${r.user.name}! Вам открыт доступ к порталу REVION — ${ROLES[r.user.role]}.\n\n${this.portalHint()}`, ...this.portalButton() })
      this.setMenu(chat)
      return this.send(`🔑 ${r.user.name}${r.user.tg ? ` (@${r.user.tg})` : ''} получил(а) доступ к порталу: ${ROLES[r.user.role]}. Убрать доступ можно в портале → «Доступ».`)
    }
    if (!this.auth.user(m.from?.id)) return this.call('sendMessage', { chat_id: chat, text: 'У вас нет доступа к порталу. Попросите у владельца приглашение.' })
    const l = this.auth.loginRequest(t)
    if (!l) return this.call('sendMessage', { chat_id: chat, text: 'Ссылка для входа устарела. Обновите страницу портала и нажмите «Войти» ещё раз.' })
    const nums = new Set([l.code])
    while (nums.size < 3) nums.add(String(crypto.randomInt(10, 100)))
    const order = [...nums].sort(() => Math.random() - 0.5)
    return this.call('sendMessage', {
      chat_id: chat,
      text: '🔐 Вход в портал REVION\n\nНажмите число, которое видите на странице входа.\nЕсли вы сейчас не входите в портал — ничего не нажимайте.',
      reply_markup: { inline_keyboard: [order.map((n) => ({ text: n, callback_data: `lg:${t}:${n}` })), [{ text: 'Это не я', callback_data: `lg:${t}:x` }]] },
    })
  }

  async onTypedLogin(chat, userId, word) {
    const err = this.auth.confirmTyped(String(word).replace(/\D/g, ''), userId)
    return this.call('sendMessage', { chat_id: chat, text: err ? `🔐 ${err}` : '✅ Вход в портал подтверждён. Вернитесь на страницу портала.' })
  }

  async onLoginTap(q) {
    const [, id, code] = String(q.data).split(':')
    let err = null
    if (code === 'x') { this.auth.logins.delete(id); err = 'Вход отменён.' } else err = this.auth.confirmLogin(id, q.from.id, code)
    await this.call('answerCallbackQuery', { callback_query_id: q.id, text: err || 'Готово' }).catch(() => {})
    await this.call('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: err ? `🔐 ${err}` : '✅ Вход подтверждён. Вернитесь на страницу портала.' }).catch(() => {})
  }

  async notify(n) {
    if (!this.owner || !this.token) return
    const title = (id) => { const e = this.office.emp(id); return e ? (e.name ? `${e.name} (${e.title})` : e.title) : id }

    if (n.kind === 'plan_ready') {
      const steps = n.plan.steps.map((s, i) => `${i + 1}. ${title(s.employee)}: ${s.task}`).join('\n\n')
      const msg = await this.send(`📋 План от руководителя\n\n${n.plan.summary}\n\n${steps}`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Утвердить', callback_data: `ap:${n.plan.id}` }, { text: '✖️ Отклонить', callback_data: `rj:${n.plan.id}` }]] },
      })
      if (msg) this.store.updatePlan(n.plan.id, { tgMessageId: msg.message_id })
      return
    }
    if (n.kind === 'plan_question') {
      const msg = await this.send(`❓ Руководитель уточняет:\n\n${n.plan.question}\n\nОтветьте на это сообщение: смахните его влево или нажмите «Ответить».`)
      if (msg) this.store.updatePlan(n.plan.id, { tgMessageId: msg.message_id })
      return
    }
    if (n.kind === 'limit') return this.send(`⏸ Закончился лимит подписки Claude. Задачи подождут и продолжатся сами примерно в ${n.until}.`)
    if (n.kind === 'plan_reply') return this.send(`💬 Руководитель:\n\n${n.plan.reply}`)
    if (n.kind === 'plan_failed') return this.send(`⚠️ Руководитель не смог составить план.\n${n.plan.error || ''}`)
    if (n.kind === 'task_failed') return this.send(`⚠️ ${title(n.task.employee)}: ${n.task.title}\n\n${n.task.error || 'Ошибка'}`)
    // weekly reports go to Диас, not to the owner: he sends one report for all of them
    if (n.kind === 'task_done' && ['weekly', 'content-plan', 'week-goal'].includes(n.task.source)) return
    if (n.kind === 'task_done') {
      // A rendered mockup is sent as its PNG; the HTML source stays on the computer.
      const all = n.task.files || []
      const pngs = new Set(all.map((f) => f.path.toLowerCase()))
      const files = all
        .filter((f) => !/\.json$/i.test(f.path)) // монтаж.json is the editor's working file
        .filter((f) => !/\.html?$/i.test(f.path) || !pngs.has(f.path.toLowerCase().replace(/\.html?$/, '.png')))
        .slice(0, 8)
      const list = files.length ? `\n\nФайлы: ${files.map((f) => f.path).join(', ')}` : ''
      const ids = []
      // Telegram shows Markdown marks as they are, so headings and bold are cleaned off
      const result = String(n.task.result || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/`/g, '')
      const msg = await this.send(`✅ ${title(n.task.employee)}: ${n.task.title}\n\n${result}${list}`, {
        reply_markup: { inline_keyboard: [[{ text: '👍 Хорошо', callback_data: `rt:${n.task.id}:up` }, { text: '👎 Не то', callback_data: `rt:${n.task.id}:dn` }]] },
      })
      if (msg) ids.push(msg.message_id)
      for (const f of files) {
        const full = path.join(P.work, n.task.id, f.path)
        if (f.size > 0 && f.size <= MAX_SEND) {
          const sent = await this.sendFile(full).catch((e) => console.error('Telegram, файл:', e.message))
          if (sent) ids.push(sent.message_id)
        }
      }
      this.store.updateTask(n.task.id, { tgMessageIds: ids })
      return
    }
    if (n.kind === 'plan_done' && n.tasks.length > 1) {
      return this.send(`${n.plan.status === 'done' ? '🏁 План выполнен' : '⚠️ План выполнен не полностью'}: ${n.plan.summary}`)
    }
  }
}
