import { OfficeScene } from './office.js'

// opened from the portal by management: watch only, the portal server refuses any action anyway
if (new URLSearchParams(location.search).has('view')) document.documentElement.classList.add('view-only')

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const local = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`office:${key}`); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem(`office:${key}`, JSON.stringify(value)) } catch {}
  },
}

const TERMINAL = new Set(['done', 'failed', 'cancelled'])
const STATUS_RU = {
  queued: 'в очереди', running: 'в работе', done: 'готово', failed: 'ошибка', cancelled: 'отменено',
  thinking: 'думает', awaiting: 'ждёт решения', question: 'вопрос', approved: 'выполняется',
  rejected: 'отклонён', answered: 'отвечено', partial: 'частично', replied: 'ответил',
  working: 'работает', waiting: 'ждёт вас', idle: 'свободен', soon: 'скоро',
}
const ICON = { read: '📖', write: '✏️', search: '🔍', web: '🌐', run: '⚙️', tool: '🧩', think: '💭', say: '💬', start: '▶️', done: '✅', error: '⚠️', wait: '⏳' }

const S = {
  ready: false,
  employees: [],
  tasks: [],
  plans: [],
  usage: {},
  telegram: {},
  claude: null,
  events: new Map(),
  loadingEvents: new Map(),
  selected: null,
  drawer: null,
  hiddenPlans: new Set(local.get('hiddenPlans', [])),
}

const taskById = (id) => S.tasks.find((t) => t.id === id)
const planById = (id) => S.plans.find((p) => p.id === id)
const emp = (id) => S.employees.find((e) => e.id === id)
const empName = (e) => (e?.name ? `${e.name} · ${e.title}` : e?.title || '')
const empTitle = (id) => (emp(id) ? empName(emp(id)) : id)

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, '0')
const sameDay = (a, b) => a.toDateString() === b.toDateString()
const isToday = (iso) => !!iso && sameDay(new Date(iso), new Date())

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return `сегодня, ${fmtTime(iso)}`
  if (sameDay(d, yesterday)) return `вчера, ${fmtTime(iso)}`
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${fmtTime(iso)}`
}

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин ${pad(s % 60)} с`
  return `${Math.floor(m / 60)} ч ${pad(m % 60)} мин`
}

const fmtCost = (x) => (x == null ? '' : x < 0.01 ? '<$0.01' : `$${x.toFixed(2)}`)
const fmtTok = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : b >= 1024 ? `${Math.round(b / 1024)} КБ` : `${b} Б`)

function fmtReset(sec) {
  if (!sec) return ''
  const d = new Date(sec < 1e12 ? sec * 1000 : sec)
  return sameDay(d, new Date()) ? `в ${fmtTime(d)}` : `${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })} в ${fmtTime(d)}`
}

// ---------- safe mini markdown ----------

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(«])\*(?!\s)([^*]+?)\*(?=$|[\s.,:;!?)»])/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function tableHTML(rows) {
  const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const isSep = (r) => /^[\s|:-]+$/.test(r) && r.includes('-')
  if (rows.length < 2 || !isSep(rows[1])) return `<p>${rows.map(inline).join('<br>')}</p>`
  const head = cells(rows[0])
  const body = rows.slice(2).map(cells)
  return `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
    body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function md(src) {
  const out = []
  let para = []
  let list = null
  let code = null
  let table = null
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = [] } }
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  const flushTable = () => { if (table) { out.push(tableHTML(table)); table = null } }
  const flushAll = () => { flushPara(); closeList(); flushTable() }

  for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (code) {
      if (/^\s*```/.test(raw)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null } else code.push(raw)
      continue
    }
    if (/^\s*```/.test(raw)) { flushAll(); code = []; continue }
    const line = raw.trimEnd()
    if (/^\s*\|.*\|$/.test(line)) { flushPara(); closeList(); (table ||= []).push(line); continue }
    flushTable()
    if (!line.trim()) { flushPara(); closeList(); continue }
    let m
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushAll()
      const n = Math.min(4, m[1].length + 1)
      out.push(`<h${n}>${inline(m[2])}</h${n}>`)
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll()
      out.push('<hr>')
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara()
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inline(m[1])}</li>`)
    } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      flushPara()
      if (list !== 'ol') { closeList(); out.push(`<ol start="${Number(m[1])}">`); list = 'ol' }
      out.push(`<li>${inline(m[2])}</li>`)
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushAll()
      out.push(`<blockquote>${inline(m[1])}</blockquote>`)
    } else {
      closeList()
      para.push(line)
    }
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
  flushAll()
  return out.join('')
}

// ---------- server ----------

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Office': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)
  return data
}

async function upload(file, name) {
  const res = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'X-Office': '1', 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)
  return data
}

async function loadEvents(key) {
  if (S.loadingEvents.has(key)) return
  S.loadingEvents.set(key, [])
  try {
    const res = await fetch(`/api/events/${key}`)
    const list = res.ok ? await res.json() : []
    const last = list.length ? list[list.length - 1].at : ''
    const late = S.loadingEvents.get(key).filter((e) => e.at > last)
    S.events.set(key, [...list, ...late])
  } catch {
    S.events.set(key, [])
  }
  S.loadingEvents.delete(key)
  for (const ul of $$(`[data-log="${key}"]`)) {
    ul.innerHTML = logItems(key)
    ul.scrollTop = ul.scrollHeight
  }
}

// ---------- toasts ----------

function toast(title, text = '', kind = 'ok', onClick) {
  const box = $('#toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  el.dataset.k = kind
  el.innerHTML = `<b>${esc(title)}</b>${text ? `<span class="small muted">${esc(text.length > 160 ? text.slice(0, 157) + '…' : text)}</span>` : ''}`
  el.addEventListener('click', () => { onClick?.(); el.remove() })
  box.appendChild(el)
  while (box.children.length > 4) box.firstChild.remove()
  setTimeout(() => el.remove(), kind === 'err' ? 12000 : 7000)
}

async function run(button, fn, okText) {
  if (button) button.disabled = true
  try {
    const r = await fn()
    if (okText) toast(okText)
    return r
  } catch (err) {
    toast('Не получилось', err.message, 'err')
  } finally {
    if (button) button.disabled = false
  }
}

// ---------- attachments ----------

function attacher(chipsEl) {
  const files = []
  const render = () => {
    chipsEl.innerHTML = files.map((f, i) => `
      <span class="chip${f.path ? '' : ' is-loading'}" title="${esc(f.name)}">
        <span>${f.path ? '📄' : '⏳'} ${esc(f.name)}</span>
        <button type="button" data-i="${i}" aria-label="Убрать файл">✕</button>
      </span>`).join('')
  }
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]')
    if (b) { files.splice(Number(b.dataset.i), 1); render() }
  })
  return {
    async add(list) {
      for (const file of list) {
        if (file.size > 1024 * 1024 * 1024) { toast('Файл слишком большой', `${file.name}: больше 1 ГБ`, 'err'); continue }
        const item = { name: file.name || 'image.png', path: null }
        files.push(item)
        render()
        try {
          const r = await upload(file, item.name)
          Object.assign(item, { path: r.path, name: r.name })
        } catch (err) {
          const i = files.indexOf(item)
          if (i >= 0) files.splice(i, 1)
          toast('Файл не загрузился', `${item.name}: ${err.message}`, 'err')
        }
        render()
      }
    },
    busy: () => files.some((f) => !f.path),
    paths: () => files.filter((f) => f.path).map((f) => f.path),
    clear() { files.length = 0; render() },
  }
}

// ---------- rendering helpers ----------

function statusLine(e) {
  if (e.status === 'soon') return `подключим: ${e.soon || 'позже'}`
  if (e.status === 'working') return e.activity?.text || 'работает'
  if (e.status === 'waiting') return e.activity?.text || 'ждёт вас'
  return e.queued ? `свободен · в очереди ${e.queued}` : 'свободен'
}

const badge = (s) => `<span class="badge" data-s="${esc(s)}"><span class="dot"></span>${esc(STATUS_RU[s] || s)}</span>`

const avatar = (e, big) => `<img class="avatar${big ? ' avatar-lg' : ''}" src="img/team/${esc(e.id)}${big ? '' : '-desk'}.png" alt="" aria-hidden="true">`

// Character that grows from experience (server keeps it): traits as bars plus recent diary.
function characterBlock(e) {
  const c = S.characters?.[e.id]
  if (!c) return ''
  const bar = (label, v) => `<div class="trait"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`
  const mood = c.mood > 0.3 ? '😊 бодрое' : c.mood < -0.3 ? '😕 подавленное' : '🙂 ровное'
  return `<details class="character"><summary class="small">Характер · настроение ${mood}</summary>
    ${bar('Уверенность', c.confidence)}${bar('Общительность', c.sociability)}${bar('Инициативность', c.initiative)}
    ${c.diary?.length ? `<ul class="diary small muted">${c.diary.slice(-5).reverse().map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
  </details>`
}

function proposalsBlock() {
  const list = S.proposals || []
  if (!list.length) return ''
  return `<h3>Предложения сотрудников</h3><ul class="list">${list.map((p) => {
    const e = emp(p.from)
    const head = p.kind === 'weekly' ? '💡' : p.urgent ? '🚨' : '📈'
    return `<li><div class="card proposal${p.urgent ? ' is-err' : ''}">
      <div class="row-title">${head} ${esc(p.title)}</div>
      <p class="small muted">${esc(e ? empName(e) : p.from)}</p>
      <p class="small">${esc(p.text)}</p>
      <div class="form-actions">${p.task
        ? `<button class="btn btn-primary btn-sm" data-act="prop-yes" data-id="${p.id}">Делать</button><button class="btn btn-sm" data-act="prop-no" data-id="${p.id}">Не надо</button>`
        : `<button class="btn btn-primary btn-sm" data-act="prop-yes" data-id="${p.id}">Понял</button><button class="btn btn-sm" data-act="prop-no" data-id="${p.id}">Неважно</button>`}</div>
    </div></li>`
  }).join('')}</ul>`
}

function taskRow(t) {
  return `<li><button class="row" data-act="task" data-id="${t.id}">
    <span class="row-main"><span class="row-title">${esc(t.title)}</span>
    <span class="row-sub">${esc(empTitle(t.employee))} · ${esc(fmtWhen(t.finishedAt || t.createdAt))}</span></span>
    ${badge(t.status)}</button></li>`
}

function planRow(p) {
  return `<li><button class="row" data-act="plan" data-id="${p.id}">
    <span class="row-main"><span class="row-title">${esc(p.summary || p.request)}</span>
    <span class="row-sub">${esc(fmtWhen(p.createdAt))}${p.source === 'telegram' ? ' · из Telegram' : ''}</span></span>
    ${badge(p.status)}</button></li>`
}

const logItem = (ev) => `<li data-k="${esc(ev.kind)}"><time>${fmtTime(ev.at)}</time><span>${ICON[ev.kind] || '•'}</span><span class="${ev.kind === 'say' ? 'say' : ''}">${esc(ev.text)}</span></li>`

function logItems(key) {
  const list = S.events.get(key)
  if (!list) return '<li><span></span><span></span><span class="muted">Загружаю…</span></li>'
  if (!list.length) return '<li><span></span><span></span><span class="muted">Пока пусто</span></li>'
  return list.slice(-120).map(logItem).join('')
}

function logHTML(key) {
  if (!S.events.has(key)) loadEvents(key)
  return `<ul class="log" data-log="${esc(key)}">${logItems(key)}</ul>`
}

function waitingFor(t) {
  const dep = (t.dependsOn || []).map(taskById).find((d) => d && d.status !== 'done')
  return dep ? `ждёт: ${empTitle(dep.employee)}` : `поставлена ${fmtWhen(t.createdAt)}`
}

// ---------- top bar ----------

function renderLimits() {
  const u = S.usage || {}
  const one = (el, frac, resets, name) => {
    const expired = resets && (resets < 1e12 ? resets * 1000 : resets) < Date.now()
    const val = $('.limit-val', el)
    const bar = $('.bar i', el)
    if (frac == null) {
      val.textContent = '—'
      bar.style.width = '0'
      el.title = `${name}: появится после первой задачи`
      el.dataset.level = 'low'
      return
    }
    const pct = expired ? 0 : Math.round(frac * 100)
    val.textContent = `${pct}%`
    bar.style.width = `${Math.min(100, pct)}%`
    el.dataset.level = pct >= 90 ? 'high' : pct >= 70 ? 'mid' : 'low'
    el.title = expired ? `${name}: окно обновилось` : `${name}: использовано ${pct}%. Обнулится ${fmtReset(resets)}`
  }
  one($('#limit5'), u.fiveHour, u.fiveHourResetsAt, 'Лимит на 5 часов')
  one($('#limit7'), u.sevenDay, u.sevenDayResetsAt, 'Недельный лимит')
}

function renderTitle() {
  const n = S.plans.filter((p) => p.status === 'awaiting' || p.status === 'question').length
  document.title = n ? `(${n}) Офис` : 'Офис'
}

function renderBoard() {
  const running = S.tasks.filter((t) => t.status === 'running').length + S.plans.filter((p) => p.status === 'thinking').length
  const queued = S.tasks.filter((t) => t.status === 'queued').length + S.plans.filter((p) => p.status === 'queued').length
  const doneToday = S.tasks.filter((t) => t.status === 'done' && isToday(t.finishedAt)).length
  scene.setBoard({ running, queued, doneToday })
}

// ---------- plans strip ----------

function visiblePlans() {
  const now = Date.now()
  return S.plans.filter((p) => {
    if (['queued', 'thinking', 'awaiting', 'question', 'approved'].includes(p.status)) return true
    if (['failed', 'partial', 'replied'].includes(p.status) && !S.hiddenPlans.has(p.id)) {
      return now - new Date(p.finishedAt || p.createdAt).getTime() < 12 * 3600e3
    }
    return false
  })
}

function stepsList(p) {
  return `<ol class="plan-steps">${(p.steps || []).map((s, i) => {
    const t = p.taskIds?.[i] ? taskById(p.taskIds[i]) : null
    const after = s.dependsOn?.length ? ` <span class="muted small">(после шага ${s.dependsOn.map((d) => d + 1).join(', ')})</span>` : ''
    const state = t ? ` <button class="linklike small" data-act="task" data-id="${t.id}">${esc(STATUS_RU[t.status])} →</button>` : ''
    return `<li><span class="who">${esc(empTitle(s.employee))}:</span> ${esc(s.task)}${after}${state}</li>`
  }).join('')}</ol>`
}

function planCard(p) {
  const req = `<div class="plan-req" title="${esc(p.request)}">«${esc(p.request)}»${p.source === 'telegram' ? ' · из Telegram' : ''}</div>`
  const files = p.attachments?.length ? ` · файлов: ${p.attachments.length}` : ''
  switch (p.status) {
    case 'queued':
      return `<div class="plan-head"><span class="badge" data-s="queued">в очереди</span><b>Поручение ждёт, пока руководитель закончит предыдущее</b></div>${req}`
    case 'thinking':
      return `<div class="plan-head"><span class="spinner"></span><b>Руководитель составляет план…</b>
        <button class="btn btn-sm btn-ghost" data-act="emp" data-id="manager">Смотреть</button></div>${req}`
    case 'awaiting':
      return `<div class="plan-head"><b>План от руководителя</b>${badge('awaiting')}</div>${req}
        ${p.summary ? `<p class="plan-summary">${esc(p.summary)}</p>` : ''}
        ${stepsList(p)}
        <div class="plan-actions">
          <button class="btn btn-ok" data-act="approve" data-id="${p.id}">Утвердить</button>
          <button class="btn" data-act="reject" data-id="${p.id}">Отклонить</button>
          <span class="muted small">шагов: ${p.steps.length}${files}</span>
        </div>`
    case 'question':
      return `<div class="plan-head"><b>Руководитель уточняет</b>${badge('question')}</div>${req}
        <p class="plan-summary"><b>${esc(p.question)}</b></p>
        <form class="plan-answer" data-answer="${p.id}">
          <input type="text" name="answer" placeholder="Ваш ответ…" required aria-label="Ответ руководителю">
          <button class="btn btn-primary">Ответить</button>
          <button class="btn" type="button" data-act="reject" data-id="${p.id}">Отменить</button>
        </form>`
    case 'failed':
      return `<div class="plan-head"><b>Руководитель не смог составить план</b>${badge('failed')}</div>${req}
        <p class="plan-summary err-text">${esc(p.error || 'Неизвестная ошибка')}</p>
        <div class="plan-actions">
          <button class="btn btn-sm" data-act="replan" data-id="${p.id}">Попробовать снова</button>
          <button class="btn btn-sm btn-ghost" data-act="hide-plan" data-id="${p.id}">Скрыть</button>
        </div>`
    case 'replied':
      return `<div class="plan-head"><b>Руководитель отвечает</b>${badge('replied')}
        <button class="btn btn-sm btn-ghost" data-act="hide-plan" data-id="${p.id}">Скрыть</button></div>${req}
        <p class="plan-summary">${esc(p.reply)}</p>`
    case 'partial':
      return `<div class="plan-head"><b>План выполнен не полностью</b>${badge('partial')}
        <button class="btn btn-sm" data-act="plan" data-id="${p.id}">Открыть</button>
        <button class="btn btn-sm btn-ghost" data-act="hide-plan" data-id="${p.id}">Скрыть</button></div>${req}`
    case 'approved': {
      const tasks = (p.taskIds || []).map(taskById).filter(Boolean)
      const done = tasks.filter((t) => t.status === 'done').length
      return `<div class="plan-head">
        <span class="progress">${tasks.map((t) => `<i data-s="${t.status}" title="${esc(empTitle(t.employee))}: ${esc(STATUS_RU[t.status])}"></i>`).join('')}</span>
        <b class="row-title">${esc(p.summary || p.request)}</b>
        <span class="muted small">${done}/${tasks.length}</span>
        <button class="btn btn-sm btn-ghost" data-act="plan" data-id="${p.id}">Подробнее</button></div>`
    }
    default:
      return ''
  }
}

function planSig(p) {
  return JSON.stringify([p.status, p.summary, p.question, p.error, p.steps?.length, (p.taskIds || []).map((id) => taskById(id)?.status)])
}

function renderPlans() {
  const box = $('#plans')
  const keep = new Map($$('.plan', box).map((el) => [el.dataset.id, el]))
  let prev = null
  for (const p of visiblePlans()) {
    const sig = planSig(p)
    let el = keep.get(p.id)
    keep.delete(p.id)
    if (!el || el.dataset.sig !== sig) {
      const fresh = document.createElement('div')
      fresh.className = `plan${['approved', 'queued', 'thinking', 'partial'].includes(p.status) ? ' is-compact' : ''}`
      Object.assign(fresh.dataset, { id: p.id, status: p.status, sig })
      fresh.innerHTML = planCard(p)
      if (el) el.replaceWith(fresh)
      el = fresh
    }
    const want = prev ? prev.nextSibling : box.firstChild
    if (el !== want) box.insertBefore(el, want)
    prev = el
  }
  for (const el of keep.values()) el.remove()
}

// ---------- side panel ----------

let sideKey = null

function warnings() {
  const out = []
  if (S.claude && !S.claude.found) {
    out.push(`<div class="card is-err"><p><b>Claude Code не найден.</b></p><p class="small">Установите его по инструкции из README, войдите в аккаунт командой <code>claude</code> и перезапустите офис.</p></div>`)
  }
  if (S.usage?.status === 'rejected') {
    out.push(`<div class="card is-warn"><p><b>Лимит подписки исчерпан.</b></p><p class="small">Новые задачи будут падать до обновления лимита ${esc(fmtReset(S.usage.fiveHourResetsAt))}.</p></div>`)
  }
  return out.join('')
}

function telegramCard() {
  const tg = S.telegram || {}
  const err = tg.error ? `<p class="small err-text">${esc(tg.error)}</p>` : ''
  if (!tg.configured) {
    return `<div class="card"><p>Подключите бота — сможете давать поручения, присылать фото и утверждать планы с телефона.</p>${err}
      <button class="btn btn-sm" data-act="settings">Подключить</button></div>`
  }
  if (!tg.linked) {
    const bot = esc(tg.bot || '')
    return `<div class="card is-warn"><p>Бот ${bot ? `<b>@${bot}</b> ` : ''}готов. Отправьте ему: <span class="code">/start ${esc(tg.code)}</span></p>${err}
      ${bot ? `<a class="btn btn-sm btn-primary" href="https://t.me/${bot}?start=${esc(tg.code)}" target="_blank" rel="noopener">Открыть бота</a>` : ''}</div>`
  }
  return `<div class="card"><p>✓ Бот <b>@${esc(tg.bot)}</b> привязан. Поручения можно давать из Telegram.</p>${err}</div>`
}

function renderOverview() {
  const recent = S.tasks.filter((t) => t.status === 'done' || t.status === 'failed').slice(-8).reverse()
  const doneToday = S.tasks.filter((t) => t.status === 'done' && isToday(t.finishedAt)).length
  const costToday = [...S.tasks, ...S.plans].filter((x) => isToday(x.finishedAt)).reduce((a, x) => a + (x.cost || 0), 0)
  $('#side').innerHTML = `
    <h2>Офис</h2>
    <p class="about">Напишите поручение руководителю в строке сверху. Он составит план, вы утвердите — и сотрудники возьмутся за работу. Нажмите на сотрудника, чтобы увидеть, чем он занят.</p>
    ${warnings()}
    ${proposalsBlock()}
    <h3>Команда</h3>
    <ul class="list">${S.employees.map((e) => `<li><button class="row" data-act="emp" data-id="${e.id}">${avatar(e)}
      <span class="row-main"><span class="row-title">${esc(empName(e))}</span><span class="row-sub">${esc(statusLine(e))}</span></span>
      ${badge(e.status)}</button></li>`).join('')}</ul>
    <h3>Готовые результаты</h3>
    ${recent.length ? `<ul class="list">${recent.map(taskRow).join('')}</ul>` : '<p class="empty">Пока пусто — здесь появятся результаты работы.</p>'}
    <h3>Telegram</h3>
    ${telegramCard()}
    <p class="hint" style="margin-top:16px">Сегодня готово задач: ${doneToday}${costToday ? ` · ≈${fmtCost(costToday)} в пересчёте на цены API (по подписке деньги не списываются, расходуется лимит)` : ''}</p>`
}

function employeeTop(e) {
  if (e.status === 'soon') {
    return `<div class="card"><p><b>Подключим: ${esc(e.soon || 'позже')}.</b></p><p class="small">Пока руководитель не даёт ему задач. Место за столом уже ждёт.</p></div>`
  }
  if (e.id === 'manager') {
    const thinking = S.plans.find((p) => p.status === 'thinking')
    const waiting = S.plans.filter((p) => p.status === 'awaiting' || p.status === 'question')
    const queued = S.plans.filter((p) => p.status === 'queued')
    let html = ''
    if (thinking) {
      html += `<h3>Сейчас</h3><div class="now">
        <div class="now-title">Составляет план</div>
        <div class="muted small">«${esc(thinking.request)}»</div>
        <div class="now-act">${ICON[e.activity?.kind] || '💭'} ${esc(e.activity?.text || 'Думает')}</div>
        <div class="now-foot"><span>идёт <span data-since="${esc(thinking.startedAt)}"></span></span></div>
        ${logHTML(thinking.id)}</div>`
    } else if (waiting.length) {
      html += `<div class="card is-warn"><p><b>Ждёт вашего решения</b> — план над офисом (${waiting.length}).</p></div>`
    } else {
      html += `<div class="card"><p>Свободен. Напишите поручение в строке сверху или боту в Telegram.</p>
        <button class="btn btn-sm" data-act="focus-ask">Написать поручение</button></div>`
    }
    if (queued.length) html += `<p class="hint" style="margin-top:8px">Ещё поручений в очереди: ${queued.length}</p>`
    return html
  }

  let html = ''
  const running = e.ref ? taskById(e.ref) : null
  if (running) {
    html += `<h3>Сейчас</h3><div class="now">
      <button class="linklike now-title" data-act="task" data-id="${running.id}">${esc(running.title)}</button>
      <div class="now-act">${ICON[e.activity?.kind] || '💭'} ${esc(e.activity?.text || 'Работает')}</div>
      <div class="now-foot"><span>идёт <span data-since="${esc(running.startedAt)}"></span></span>
        <button class="btn btn-sm btn-danger" data-act="cancel" data-id="${running.id}">Остановить</button></div>
      ${logHTML(running.id)}</div>`
  } else {
    html += '<p class="empty" style="margin-top:12px">Свободен — ждёт задач.</p>'
  }
  const queued = S.tasks.filter((t) => t.employee === e.id && t.status === 'queued')
  if (queued.length) {
    html += `<h3>В очереди · ${queued.length}</h3><ul class="list">${queued.map((t) => `<li><div class="row is-static">
      <span class="row-main"><button class="linklike row-title" data-act="task" data-id="${t.id}">${esc(t.title)}</button>
      <span class="row-sub">${esc(waitingFor(t))}</span></span>
      <button class="btn btn-sm" data-act="cancel" data-id="${t.id}">Убрать</button></div></li>`).join('')}</ul>`
  }
  return html
}

function employeeBottom(e) {
  if (e.status === 'soon') return ''
  if (e.id === 'manager') {
    const plans = S.plans.slice(-10).reverse()
    return `<h3>Последние планы</h3>${plans.length ? `<ul class="list">${plans.map(planRow).join('')}</ul>` : '<p class="empty">Планов пока не было.</p>'}`
  }
  const done = S.tasks.filter((t) => t.employee === e.id && TERMINAL.has(t.status)).slice(-10).reverse()
  return `<h3>Готовые задачи</h3>${done.length ? `<ul class="list">${done.map(taskRow).join('')}</ul>` : '<p class="empty">Пока ничего не сделано.</p>'}`
}

function directForm(e) {
  if (e.status === 'soon' || e.id === 'manager') return ''
  return `<h3>Поставить задачу напрямую</h3>
    <form class="form" id="directForm" autocomplete="off">
      <textarea rows="3" name="text" placeholder="Например: придумай 3 идеи для сторис на эту неделю" aria-label="Текст задачи"></textarea>
      <div class="chips" id="directChips"></div>
      <div class="form-actions">
        <button class="btn btn-primary">В очередь</button>
        <label class="btn btn-ghost" title="Приложить фото или файлы"><input type="file" multiple hidden id="directFiles">📎 Файлы</label>
      </div>
      <p class="hint">Без плана руководителя — быстрее и дешевле. Если нужны несколько сотрудников, пишите руководителю.</p>
    </form>`
}

let directAttach = null

function renderEmployee(e, full) {
  const side = $('#side')
  if (full) {
    side.innerHTML = `
      <div class="side-head">
        <button class="btn btn-icon" data-act="back" aria-label="Ко всему офису" title="Ко всему офису">←</button>
        ${avatar(e, true)}
        <div class="row-main"><h2>${esc(e.name || e.title)}</h2>${e.name ? `<div class="muted small">${esc(e.title)}</div>` : ''}<div class="muted small" id="empStatus"></div></div>
      </div>
      <p class="about">${esc(e.about)}</p>
      ${characterBlock(e)}
      <div class="form-actions" style="margin-top:8px"><button class="btn btn-sm" data-act="praise" data-id="${e.id}">👏 Похвалить</button></div>
      <div data-dyn="top"></div>
      ${directForm(e)}
      <div data-dyn="bottom"></div>`
    const form = $('#directForm')
    directAttach = form ? attacher($('#directChips')) : null
    if (form) {
      $('#directFiles').addEventListener('change', (ev) => { directAttach.add([...ev.target.files]); ev.target.value = '' })
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault()
        const text = form.text.value.trim()
        if (!text) return form.text.focus()
        if (directAttach.busy()) return toast('Подождите', 'Файлы ещё загружаются', 'warn')
        const ok = await run(form.querySelector('.btn-primary'), () => post('/api/tasks', { employee: e.id, text, attachments: directAttach.paths() }), 'Задача поставлена в очередь')
        if (ok) { form.text.value = ''; directAttach.clear() }
      })
    }
  }
  $('#empStatus').innerHTML = `${badge(e.status)}${e.model && e.status !== 'soon' ? ` <span>модель: ${esc(e.model)}</span>` : ''}`

  const top = $('[data-dyn="top"]', side)
  const oldLog = $('.log', top)
  const keep = oldLog && {
    key: oldLog.dataset.log,
    top: oldLog.scrollTop,
    atBottom: oldLog.scrollTop + oldLog.clientHeight >= oldLog.scrollHeight - 6,
  }
  top.innerHTML = employeeTop(e)
  const newLog = $('.log', top)
  if (newLog) newLog.scrollTop = keep && keep.key === newLog.dataset.log && !keep.atBottom ? keep.top : newLog.scrollHeight
  $('[data-dyn="bottom"]', side).innerHTML = employeeBottom(e)
  tickTimers()
}

function renderSide() {
  if (!S.ready) { $('#side').innerHTML = '<p class="empty">Подключаюсь к офису…</p>'; return }
  const e = S.selected ? emp(S.selected) : null
  const key = e ? `${e.id}:${e.status === 'soon'}` : 'overview'
  const full = key !== sideKey
  sideKey = key
  if (e) renderEmployee(e, full)
  else renderOverview()
}

function select(id) {
  S.selected = id && emp(id) ? id : null
  scene.select(S.selected)
  renderSide()
}

// ---------- drawer ----------

const textCache = new Map()

function fileBlock(t, f) {
  const url = `/files/${t.id}/${f.path.split('/').map(encodeURIComponent).join('/')}`
  const ext = f.path.split('.').pop().toLowerCase()
  const isText = ['md', 'txt', 'csv', 'json'].includes(ext) && f.size < 300 * 1024
  let body = ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) body = `<img src="${url}" alt="${esc(f.path)}" loading="lazy">`
  else if (ext === 'mp4') body = `<video src="${url}" controls preload="metadata"></video>`
  else if (isText) body = `<div class="${ext === 'md' ? 'md' : ''}" data-src="${url}" data-ext="${ext}">Загружаю…</div>`
  return `<div class="file">
    <div class="file-head"><b title="${esc(f.path)}">${esc(f.path)}</b><span class="muted small">${fmtSize(f.size)}</span>
      ${isText ? `<button class="btn btn-sm" data-act="copy" data-url="${url}">Копировать</button>` : ''}
      <a class="btn btn-sm" href="${url}" target="_blank" rel="noopener">Открыть</a>
      <a class="btn btn-sm" href="${url}?download">Скачать</a></div>
    ${body ? `<div class="file-body">${body}</div>` : ''}</div>`
}

async function fetchText(url) {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Ошибка ${r.status}`)))))
  }
  try { return await textCache.get(url) } catch (e) { textCache.delete(url); throw e }
}

function fillTextPreviews(root) {
  for (const el of $$('[data-src]', root)) {
    fetchText(el.dataset.src).then((text) => {
      el.innerHTML = el.dataset.ext === 'md' ? md(text) : `<pre class="md">${esc(text)}</pre>`
    }).catch((err) => { el.textContent = `Не удалось открыть: ${err.message}` })
  }
}

function taskDrawer(t) {
  const facts = [badge(t.status)]
  if (t.startedAt && t.finishedAt) facts.push(`<span>за ${fmtDur(new Date(t.finishedAt) - new Date(t.startedAt))}</span>`)
  if (t.turns) facts.push(`<span>ходов: ${t.turns}</span>`)
  if (t.tokensIn != null) facts.push(`<span title="Прочитано / написано токенов">токены: ${fmtTok(t.tokensIn)} → ${fmtTok(t.tokensOut)}</span>`)
  if (t.cost != null) facts.push(`<span title="В пересчёте на цены API. По подписке деньги не списываются.">≈${fmtCost(t.cost)}</span>`)

  let html = `<div class="facts">${facts.join('')}</div>`
  if (t.status === 'running') {
    const e = emp(t.employee)
    html += `<div class="now" style="margin-top:12px">
      <div class="now-act">${ICON[e?.activity?.kind] || '💭'} ${esc(e?.ref === t.id ? e.activity?.text : t.activity || 'Работает')}</div>
      <div class="now-foot"><span>идёт <span data-since="${esc(t.startedAt)}"></span></span>
        <button class="btn btn-sm btn-danger" data-act="cancel" data-id="${t.id}">Остановить</button></div>
      ${logHTML(t.id)}</div>`
  }
  if (t.status === 'queued') {
    html += `<p>${esc(waitingFor(t))}. <button class="btn btn-sm" data-act="cancel" data-id="${t.id}">Убрать из очереди</button></p>`
  }
  if (t.error) html += `<p class="err-text">${esc(t.error)}</p>`
  if (t.result) html += `<h3>Итог</h3><div class="md">${md(t.result)}</div>`
  if (t.files?.length) html += `<h3>Файлы · ${t.files.length}</h3>${t.files.map((f) => fileBlock(t, f)).join('')}`
  html += `<h3>Задание</h3><p class="task-text">${esc(t.text)}</p>`
  if (t.attachments?.length) {
    html += `<p class="small">Приложено: ${t.attachments.map((a) => `<a href="/inbox/${a.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener">${esc(a.split('/').pop())}</a>`).join(', ')}</p>`
  }
  if (t.planId) html += `<p class="small"><button class="linklike" data-act="plan" data-id="${t.planId}">Открыть план, из которого эта задача →</button></p>`
  if (TERMINAL.has(t.status)) {
    html += `<div class="plan-actions"><button class="btn" data-act="retry" data-id="${t.id}">${t.status === 'done' ? 'Сделать ещё раз' : 'Повторить'}</button></div>
      <h3>Ход работы</h3>${logHTML(t.id)}`
  }
  return html
}

function planDrawer(p) {
  const facts = [badge(p.status)]
  if (p.cost != null) facts.push(`<span title="В пересчёте на цены API">план ≈${fmtCost(p.cost)}</span>`)
  if (p.source === 'telegram') facts.push('<span>из Telegram</span>')
  let html = `<div class="facts">${facts.join('')}</div>
    <h3>Поручение</h3><p class="task-text">${esc(p.request)}</p>`
  if (p.question && p.answer) html += `<p><b>Руководитель спросил:</b> ${esc(p.question)}<br><b>Вы ответили:</b> ${esc(p.answer)}</p>`
  if (p.status === 'question') html += `<p><b>Вопрос:</b> ${esc(p.question)}</p><p class="hint">Ответить можно в карточке над офисом.</p>`
  if (p.reply) html += `<h3>Ответ руководителя</h3><p>${esc(p.reply)}</p>`
  if (p.error) html += `<p class="err-text">${esc(p.error)}</p>`
  if (p.summary) html += `<h3>План</h3><p>${esc(p.summary)}</p>`
  if (p.steps?.length) html += stepsList(p)
  if (p.status === 'awaiting') {
    html += `<div class="plan-actions"><button class="btn btn-ok" data-act="approve" data-id="${p.id}">Утвердить</button>
      <button class="btn" data-act="reject" data-id="${p.id}">Отклонить</button></div>`
  }
  if (p.status === 'failed') html += `<div class="plan-actions"><button class="btn" data-act="replan" data-id="${p.id}">Попробовать снова</button></div>`
  if (p.status === 'thinking') html += `<h3>Сейчас</h3>${logHTML(p.id)}`
  return html
}

function renderDrawer() {
  if (!S.drawer) return
  const { type, id } = S.drawer
  const item = type === 'task' ? taskById(id) : planById(id)
  if (!item) return closeDrawer()
  const body = $('#drawerBody')
  const log = $('.log', body)
  const logState = log && { key: log.dataset.log, top: log.scrollTop, atBottom: log.scrollTop + log.clientHeight >= log.scrollHeight - 6 }
  const scroll = body.scrollTop
  if (type === 'task') {
    $('#drawerMeta').textContent = `${empTitle(item.employee)} · ${fmtWhen(item.createdAt)}${item.source === 'telegram' ? ' · из Telegram' : ''}`
    $('#drawerTitle').textContent = item.title
    body.innerHTML = taskDrawer(item)
  } else {
    $('#drawerMeta').textContent = `Руководитель · ${fmtWhen(item.createdAt)}`
    $('#drawerTitle').textContent = item.summary || item.request
    body.innerHTML = planDrawer(item)
  }
  body.scrollTop = scroll
  const newLog = $('.log', body)
  if (newLog) newLog.scrollTop = logState && logState.key === newLog.dataset.log && !logState.atBottom ? logState.top : newLog.scrollHeight
  fillTextPreviews(body)
  tickTimers()
}

function openDrawer(type, id) {
  const changed = S.drawer?.type !== type || S.drawer?.id !== id
  S.drawer = { type, id }
  $('#drawer').hidden = false
  if (changed) $('#drawerBody').scrollTop = 0
  renderDrawer()
  $('#drawer [data-close].btn').focus({ preventScroll: true })
}

function closeDrawer() {
  S.drawer = null
  $('#drawer').hidden = true
}

// ---------- settings ----------

function tokenForm() {
  return `<form class="form" data-form="token" autocomplete="off" style="margin-top:8px">
    <input type="password" name="token" placeholder="Токен от BotFather, например 123456789:AA…" required aria-label="Токен бота">
    <div class="form-actions"><button class="btn btn-primary btn-sm">Сохранить</button></div></form>`
}

function telegramSettings() {
  const tg = S.telegram || {}
  const err = tg.error ? `<div class="card is-err"><p class="small">${esc(tg.error)}</p></div>` : ''
  if (!tg.configured) {
    return `<ol class="small">
        <li>Откройте в Telegram <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> и отправьте <code>/newbot</code>.</li>
        <li>Придумайте имя и адрес бота (адрес должен заканчиваться на <code>bot</code>).</li>
        <li>BotFather пришлёт токен — длинную строку с двоеточием. Вставьте её ниже.</li>
      </ol>${tokenForm()}${err}`
  }
  const bot = esc(tg.bot || '')
  if (!tg.linked) {
    return `<p>Бот ${bot ? `<b>@${bot}</b>` : ''} подключён. Осталось привязать ваш чат — отправьте боту:</p>
      <p><span class="code">/start ${esc(tg.code)}</span></p>
      ${bot ? `<div class="form-actions"><a class="btn btn-primary btn-sm" href="https://t.me/${bot}?start=${esc(tg.code)}" target="_blank" rel="noopener">Открыть бота</a></div>` : ''}
      <p class="hint" style="margin-top:8px">После привязки бот слушается только ваш чат, остальным не отвечает.</p>
      ${err}<details style="margin-top:8px"><summary class="small">Сменить бота</summary>${tokenForm()}</details>`
  }
  return `<p>✓ Бот <b>@${bot}</b> привязан к вашему чату.</p>
    <p class="hint">Пишите боту поручения, присылайте фото, утверждайте планы кнопками. Команды: /status, /smm, /help.</p>
    <div class="form-actions" style="margin-top:8px"><button class="btn btn-sm btn-danger" data-act="unlink">Отвязать чат</button></div>
    ${err}<details style="margin-top:8px"><summary class="small">Сменить бота</summary>${tokenForm()}</details>`
}

function metaTokenForm() {
  return `<form class="form" data-form="meta" autocomplete="off" style="margin-top:8px">
    <input type="password" name="token" placeholder="Токен Meta, начинается с EA…" required aria-label="Токен Meta">
    <div class="form-actions"><button class="btn btn-primary btn-sm">Сохранить</button></div></form>`
}

function metaSettings() {
  const m = S.meta || {}
  const err = m.error ? `<div class="card is-err"><p class="small">${esc(m.error)}</p></div>` : ''
  if (!m.configured) {
    return `<p class="small">Нужен для маркетолога-аналитика. Доступ только на чтение: офис забирает цифры сам, токен сотрудникам не передаётся.</p>
      <ol class="small">
        <li><a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</a> → «Создать приложение» → тип «Бизнес», привязать к бизнес-портфелю компании.</li>
        <li><a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">Настройки компании → Пользователи системы</a> → «Добавить», роль «Сотрудник».</li>
        <li>«Назначить активы»: рекламный аккаунт, страница Facebook и Instagram — с правом просмотра.</li>
        <li>«Создать токен»: ваше приложение, срок «Никогда», разрешения <code>ads_read</code>, <code>read_insights</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>instagram_basic</code>, <code>instagram_manage_insights</code>, <code>business_management</code>.</li>
        <li>Вставьте токен ниже.</li>
      </ol>${metaTokenForm()}${err}`
  }
  const accounts = m.adAccounts || []
  const select = accounts.length > 1
    ? `<label class="small">Рекламный кабинет <select data-meta-account>${accounts.map((a) =>
        `<option value="${esc(a.id)}"${a.id === m.adAccount?.id ? ' selected' : ''}>${esc(a.name)} (${esc(a.id)})</option>`).join('')}</select></label>`
    : ''
  return `<p>✓ Подключено.</p>
    <p class="small">Instagram: ${m.instagram ? `<b>@${esc(m.instagram)}</b>` : 'не найден'}<br>
      Реклама: ${m.adAccount ? `<b>${esc(m.adAccount.name)}</b> (${esc(m.adAccount.currency || '')})` : 'не найдена'}</p>
    ${select}
    <div class="form-actions" style="margin-top:8px"><button class="btn btn-sm btn-danger" data-act="unlink-meta">Отключить</button></div>
    ${err}<details style="margin-top:8px"><summary class="small">Заменить токен</summary>${metaTokenForm()}</details>`
}

function portalSettings() {
  const p = S.portal || {}
  const form = `<form class="form" data-form="portal" autocomplete="off" style="margin-top:8px">
    <input type="url" name="url" placeholder="Адрес портала, например https://….vercel.app" value="${esc(p.url || '')}" required aria-label="Адрес портала">
    <input type="password" name="key" placeholder="Ключ API"${p.configured ? '' : ' required'} aria-label="Ключ API портала">
    <div class="form-actions"><button class="btn btn-primary btn-sm">Сохранить и проверить</button></div></form>`
  const err = p.error ? `<div class="card is-err"><p class="small">${esc(p.error)}</p></div>` : ''
  if (!p.configured) {
    return `<p class="small">Нужно для Ерлана и Нурлана. Только чтение: офис сам забирает квартиры, статусы и цены, ключ сотрудникам не передаётся.</p>${form}${err}`
  }
  return `<p>${p.ok ? '✓ Подключено, портал отвечает.' : '⚠️ Сохранено, но портал пока не ответил.'}</p>
    <p class="small">Адрес: <code>${esc(p.url)}</code></p>
    <div class="form-actions" style="margin-top:8px"><button class="btn btn-sm btn-danger" data-act="unlink-portal">Отключить</button></div>
    ${err}<details style="margin-top:8px"${p.ok ? '' : ' open'}><summary class="small">Изменить адрес или ключ</summary>${form}</details>`
}

function crmSettings() {
  const c = S.crm || {}
  const form = `<form class="form" data-form="crm" autocomplete="off" style="margin-top:8px">
    <input type="url" name="url" placeholder="Адрес API, например https://crm.example.kz/api/analytics/leads" value="${esc(c.url || '')}" required aria-label="Адрес API CRM">
    <input type="password" name="key" placeholder="Ключ от разработчиков CRM"${c.configured ? '' : ' required'} aria-label="Ключ API CRM">
    <div class="form-actions"><button class="btn btn-primary btn-sm">Сохранить и проверить</button></div></form>`
  const err = c.error ? `<div class="card is-err"><p class="small">${esc(c.error)}</p></div>` : ''
  if (!c.configured) {
    return `<p class="small">Для Ерлана, Нурлана и Алии: воронка, причины отказов, какая реклама привела покупателей и кто покупает. Только чтение, без имён и телефонов; ключ сотрудникам не передаётся.</p>${form}${err}`
  }
  const when = c.syncedAt ? new Date(c.syncedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const unknown = [...(c.unknown?.stages || []).map((x) => `этап «${x}»`), ...(c.unknown?.sources || []).map((x) => `источник «${x}»`)]
  return `<p>${c.ok ? '✓ Подключено, CRM отвечает.' : '⚠️ Сохранено, но CRM пока не ответила.'}</p>
    <p class="small">${c.count ? `Лидов в офисе: ${c.count}${when ? ` · обновлено ${esc(when)}` : ''}. Изменения забираются раз в час, весь список — каждую ночь.` : 'Первая загрузка идёт…'}</p>
    ${c.notes?.at ? `<p class="small">${c.notes.withNote ? `Заметки менеджеров к отказам приходят (${c.notes.withNote} из ${c.notes.lost}${c.notes.field ? `, поле «${esc(c.notes.field)}»` : ''}) — Ерлан пересказывает их своими словами, без имён и телефонов; сами заметки офис не хранит.` : c.notes.lost ? 'Заметки менеджеров к отказам не приходят — в отчётах только причина отказа из CRM.' : 'Отказов в CRM пока нет.'}</p>` : ''}
    ${unknown.length ? `<p class="small">Офис пока не понял: ${unknown.map(esc).join(', ')} — они считаются как «Лиды» и «Другое».</p>` : ''}
    <div class="form-actions" style="margin-top:8px"><button class="btn btn-sm" data-act="sync-crm">Обновить сейчас</button><button class="btn btn-sm btn-danger" data-act="unlink-crm">Отключить</button></div>
    ${err}<details style="margin-top:8px"${c.ok ? '' : ' open'}><summary class="small">Изменить адрес или ключ</summary>${form}</details>`
}

function renderSettings() {
  if (!$('#settings').open) return
  const theme = local.get('theme', 'auto')
  const themes = { auto: 'Как в системе', light: 'Светлое', dark: 'Тёмное' }
  $('#settingsBody').innerHTML = `
    <section><h3>Telegram-бот</h3>${telegramSettings()}</section>
    <section><h3>Meta: Instagram и реклама</h3>${metaSettings()}</section>
    <section><h3>Шахматка: портал</h3>${portalSettings()}</section>
    <section><h3>CRM: клиенты и сделки</h3>${crmSettings()}</section>
    <section><h3>Claude Code</h3>${S.claude?.found
      ? `<p class="small">Найден: <code>${esc(S.claude.path)}</code></p><p class="hint">Сотрудники работают по вашей подписке Claude. Расход лимита виден сверху справа.</p>`
      : `<div class="card is-err"><p>Claude Code не найден.</p><p class="small">Установите его (инструкция в README), войдите в аккаунт командой <code>claude</code> и перезапустите офис. Если он установлен в необычное место — укажите путь в файле <code>data/config.json</code>, поле <code>"claudePath"</code>.</p></div>`}</section>
    <section><h3>Оформление</h3><div class="form-actions">${Object.entries(themes).map(([v, label]) =>
      `<label class="btn btn-sm"><input type="radio" name="theme" value="${v}"${theme === v ? ' checked' : ''}> ${label}</label>`).join('')}</div></section>`
}

function openSettings() {
  const dlg = $('#settings')
  if (!dlg.open) dlg.showModal()
  renderSettings()
}

function applyTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v
  else delete document.documentElement.dataset.theme
}

// ---------- live updates ----------

let flushTimer = 0
const dirty = new Set()
function invalidate(...parts) {
  for (const p of parts) dirty.add(p)
  if (!flushTimer) flushTimer = setTimeout(flushRender, 40)
}
function flushRender() {
  flushTimer = 0
  const d = new Set(dirty)
  dirty.clear()
  if (d.has('limits')) renderLimits()
  if (d.has('plans')) renderPlans()
  if (d.has('board')) renderBoard()
  if (d.has('side')) renderSide()
  if (d.has('drawer')) renderDrawer()
  if (d.has('settings')) renderSettings()
  renderTitle()
}

function onTask(t) {
  const i = S.tasks.findIndex((x) => x.id === t.id)
  const prev = i >= 0 ? S.tasks[i] : null
  if (i >= 0) S.tasks[i] = t
  else S.tasks.push(t)
  if (S.tasks.length > 400) S.tasks.splice(0, S.tasks.length - 400)
  if (prev && prev.status !== t.status) {
    if (t.status === 'running' && t.planId) scene.fly('manager', t.employee)
    // colleagues hand their reports over: Алия and Ерлан → Нурлан on Mondays
    if (t.status === 'running') for (const d of t.dependsOn || []) { const dep = taskById(d); if (dep && dep.employee !== t.employee) scene.fly(dep.employee, t.employee) }
    if (t.status === 'done') {
      scene.fly(t.employee, 'manager')
      toast(`${empTitle(t.employee)}: готово`, t.title, 'ok', () => openDrawer('task', t.id))
    }
    if (t.status === 'failed') toast(`${empTitle(t.employee)}: не получилось`, t.error || t.title, 'err', () => openDrawer('task', t.id))
  }
  invalidate('plans', 'board', 'side', 'drawer')
}

function onPlan(p) {
  const i = S.plans.findIndex((x) => x.id === p.id)
  const prev = i >= 0 ? S.plans[i] : null
  if (i >= 0) S.plans[i] = p
  else S.plans.push(p)
  if (prev && prev.status !== p.status) {
    if (p.status === 'awaiting') toast('План готов', 'Руководитель ждёт вашего «да» — карточка над офисом', 'warn')
    if (p.status === 'question') toast('Руководитель уточняет', p.question, 'warn')
    if (p.status === 'replied') toast('Руководитель ответил', p.reply, 'ok')
    if (p.status === 'failed') toast('Руководитель не справился', p.error, 'err')
    if (p.status === 'done') toast('План выполнен', p.summary || p.request, 'ok', () => openDrawer('plan', p.id))
    if (p.status === 'partial') toast('План выполнен не полностью', p.summary || p.request, 'err', () => openDrawer('plan', p.id))
  }
  invalidate('plans', 'board', 'side', 'drawer')
}

function onEvent({ key, entry }) {
  if (S.loadingEvents.has(key)) { S.loadingEvents.get(key).push(entry); return }
  const list = S.events.get(key)
  if (!list) return
  list.push(entry)
  if (list.length > 300) list.splice(0, list.length - 300)
  for (const ul of $$(`[data-log="${key}"]`)) {
    const atBottom = ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 6
    if (ul.children.length === 1 && !ul.firstElementChild.dataset.k) ul.innerHTML = ''
    ul.insertAdjacentHTML('beforeend', logItem(entry))
    if (atBottom) ul.scrollTop = ul.scrollHeight
  }
}

function connect() {
  const es = new EventSource('/api/stream')
  const on = (type, fn) => es.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)) } catch (err) { console.error(type, err) } })
  on('snapshot', (d) => {
    Object.assign(S, { employees: d.employees, tasks: d.tasks, plans: d.plans, usage: d.usage || {}, telegram: d.telegram || {}, meta: d.meta || {}, portal: d.portal || {}, crm: d.crm || {}, proposals: d.proposals || [], claude: d.claude, ready: true })
    scene.setBanter(d.banter)
    S.characters = d.characters || {}
    scene.setCharacters(S.characters)
    scene.setEmployees(S.employees)
    if (S.selected && !emp(S.selected)) S.selected = null
    sideKey = null
    invalidate('limits', 'plans', 'board', 'side', 'drawer', 'settings')
  })
  on('employees', (list) => {
    S.employees = list
    scene.setEmployees(list)
    invalidate('side')
  })
  on('task', onTask)
  on('plan', onPlan)
  on('usage', (u) => { S.usage = u; invalidate('limits', 'side') })
  on('event', onEvent)
  on('telegram', (tg) => { S.telegram = tg; invalidate('side', 'settings') })
  on('meta', (m) => { S.meta = m; invalidate('settings') })
  on('portal', (p) => { S.portal = p; invalidate('settings') })
  on('crm', (c) => { S.crm = c; invalidate('settings') })
  on('proposals', (list) => { S.proposals = list; sideKey = null; invalidate('side') })
  on('banter', (b) => scene.setBanter(b))
  on('characters', (c) => { S.characters = c; scene.setCharacters(c); sideKey = null; invalidate('side') })
  on('praise', ({ id }) => scene.praised(id))
  es.onopen = () => { $('#conn').hidden = true }
  es.onerror = () => { $('#conn').hidden = false }
}

function tickTimers() {
  const now = Date.now()
  for (const el of $$('[data-since]')) {
    const since = Date.parse(el.dataset.since)
    el.textContent = Number.isFinite(since) ? fmtDur(now - since) : ''
  }
}

// ---------- wiring ----------

const scene = new OfficeScene($('#scene'), $('#overlay'), (id) => select(id))
const askAttach = attacher($('#askChips'))
applyTheme(local.get('theme', 'auto'))

const askText = $('#askText')
const grow = () => { askText.style.height = 'auto'; askText.style.height = `${Math.min(askText.scrollHeight + 2, 140)}px` }
askText.addEventListener('input', grow)
askText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#ask').requestSubmit() }
})
askText.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])]
  if (files.length) { e.preventDefault(); askAttach.add(files) }
})
$('#askFiles').addEventListener('change', (e) => { askAttach.add([...e.target.files]); e.target.value = '' })
$('#ask').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = askText.value.trim()
  if (!text) return askText.focus()
  if (askAttach.busy()) return toast('Подождите', 'Файлы ещё загружаются', 'warn')
  const ok = await run($('#ask .btn-primary'), () => post('/api/request', { text, attachments: askAttach.paths() }), 'Руководитель получил поручение')
  if (ok) { askText.value = ''; grow(); askAttach.clear() }
})

document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
document.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])]
  if (!files.length) return
  e.preventDefault()
  if (directAttach && e.target.closest?.('#directForm')) directAttach.add(files)
  else askAttach.add(files)
})

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-close]')) return closeDrawer()
  const el = ev.target.closest('[data-act]')
  if (!el) return
  const { act, id } = el.dataset
  if (el.tagName === 'A') ev.preventDefault()
  switch (act) {
    case 'emp': return select(id)
    case 'back': return select(null)
    case 'task': return openDrawer('task', id)
    case 'plan': return openDrawer('plan', id)
    case 'settings': return openSettings()
    case 'focus-ask': return askText.focus()
    case 'approve': return run(el, () => post(`/api/plans/${id}/approve`), 'План утверждён — сотрудники приступают')
    case 'reject': return run(el, () => post(`/api/plans/${id}/reject`))
    case 'replan': {
      const p = planById(id)
      if (p) run(el, () => post('/api/request', { text: p.request, attachments: p.attachments || [] }), 'Поручение отправлено снова')
      return
    }
    case 'hide-plan':
      S.hiddenPlans.add(id)
      local.set('hiddenPlans', [...S.hiddenPlans].slice(-100))
      return invalidate('plans')
    case 'cancel': {
      const t = taskById(id)
      if (t?.status === 'running' && !confirm('Остановить задачу? Сделанное до этого момента останется в папке задачи.')) return
      return run(el, () => post(`/api/tasks/${id}/cancel`))
    }
    case 'retry': {
      const t = await run(el, () => post(`/api/tasks/${id}/retry`), 'Задача снова в очереди')
      if (t?.id) openDrawer('task', t.id)
      return
    }
    case 'copy': {
      try {
        await navigator.clipboard.writeText(await fetchText(el.dataset.url))
        toast('Скопировано', 'Текст файла в буфере обмена')
      } catch (err) {
        toast('Не удалось скопировать', err.message, 'err')
      }
      return
    }
    case 'unlink':
      if (confirm('Отвязать Telegram-чат? Бот перестанет принимать поручения, пока вы снова не привяжете его кодом.')) {
        const tg = await run(el, () => post('/api/telegram/unlink'))
        if (tg) { S.telegram = tg; invalidate('side', 'settings') }
      }
      return
    case 'praise': {
      const r = await run(el, () => post(`/api/praise/${id}`))
      if (r) toast(`${emp(id)?.name || 'Сотрудник'} рад(а) 😊`, 'Уверенность и настроение выросли')
      return
    }
    case 'prop-yes':
    case 'prop-no': {
      const r = await run(el, () => post(`/api/proposals/${id}/${act === 'prop-yes' ? 'yes' : 'no'}`), act === 'prop-yes' ? 'Принято' : 'Отклонено — сотрудник запомнит')
      if (r) { S.proposals = (S.proposals || []).filter((p) => p.id !== id); sideKey = null; invalidate('side') }
      return
    }
    case 'unlink-portal':
      if (confirm('Отключить портал шахматки? Ерлан и Нурлан перестанут получать данные о квартирах.')) {
        const p = await run(el, () => post('/api/portal/unlink'))
        if (p) { S.portal = p; invalidate('settings') }
      }
      break
    case 'unlink-crm':
      if (confirm('Отключить CRM? Аналитика перестанет видеть воронку и покупателей, пока вы снова не вставите ключ.')) {
        const c = await run(el, () => post('/api/crm/unlink'))
        if (c) { S.crm = c; invalidate('settings') }
      }
      break
    case 'sync-crm': {
      const c = await run(el, () => post('/api/crm/sync'), 'Обновлено')
      if (c) { S.crm = c; invalidate('settings') }
      break
    }
    case 'unlink-meta':
      if (confirm('Отключить Meta? Маркетолог-аналитик перестанет получать цифры, пока вы снова не вставите токен.')) {
        const m = await run(el, () => post('/api/meta/unlink'))
        if (m) { S.meta = m; invalidate('settings') }
      }
  }
})

document.addEventListener('submit', async (ev) => {
  const form = ev.target
  if (form.matches('[data-answer]')) {
    ev.preventDefault()
    const text = form.answer.value.trim()
    if (!text) return
    await run(form.querySelector('.btn-primary'), () => post('/api/request', { text, answerTo: form.dataset.answer }), 'Ответ отправлен руководителю')
  } else if (form.matches('[data-form="token"]')) {
    ev.preventDefault()
    const tg = await run(form.querySelector('.btn-primary'), () => post('/api/settings/telegram', { token: form.token.value.trim() }), 'Бот подключён')
    if (tg) { S.telegram = tg; invalidate('side', 'settings') }
  } else if (form.matches('[data-form="portal"]')) {
    ev.preventDefault()
    const p = await run(form.querySelector('.btn-primary'), () => post('/api/settings/portal', { url: form.url.value.trim(), key: form.key.value.trim() }), 'Сохранено')
    if (p) { S.portal = p; invalidate('settings') }
  } else if (form.matches('[data-form="crm"]')) {
    ev.preventDefault()
    const c = await run(form.querySelector('.btn-primary'), () => post('/api/settings/crm', { url: form.url.value.trim(), key: form.key.value.trim() }), 'Сохранено')
    if (c) { S.crm = c; invalidate('settings') }
  } else if (form.matches('[data-form="meta"]')) {
    ev.preventDefault()
    const m = await run(form.querySelector('.btn-primary'), () => post('/api/settings/meta', { token: form.token.value.trim() }), 'Meta подключена')
    if (m) { S.meta = m; invalidate('settings') }
  }
})

document.addEventListener('change', async (ev) => {
  if (ev.target.name === 'theme') { local.set('theme', ev.target.value); applyTheme(ev.target.value) }
  if (ev.target.matches('[data-meta-account]')) {
    const m = await run(ev.target, () => post('/api/settings/meta', { adAccountId: ev.target.value }), 'Рекламный кабинет выбран')
    if (m) { S.meta = m; invalidate('settings') }
  }
})

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || $('#settings').open) return
  if (S.drawer) closeDrawer()
  else if (S.selected && !ev.target.closest?.('input, textarea')) select(null)
})

$('#settingsBtn').addEventListener('click', openSettings)
setInterval(tickTimers, 1000)
renderSide()
renderLimits()
connect()
