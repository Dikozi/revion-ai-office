// REVION portal: one page, hash routes, data from /p/data.
const $ = (s, el = document) => el.querySelector(s)
const root = $('#root')
// light by default; the choice is remembered on this device
const theme = { get: () => { try { return localStorage.getItem('revion-theme') || 'light' } catch { return 'light' } }, set: (v) => { try { localStorage.setItem('revion-theme', v) } catch {} document.documentElement.dataset.theme = v } }
document.documentElement.dataset.theme = theme.get()
const tg = window.Telegram?.WebApp
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 }))
const money = (n, cur = '₸') => (n == null ? '—' : cur === '₸' && Math.abs(n) >= 1e6 ? `${fmt(n / 1e6, 1)} млн ₸` : `${fmt(n, cur === '₸' ? 0 : 2)} ${cur}`)
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' }) : '')
const when = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }) : '')
const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`
const avatar = (id, lg) => `<img class="avatar${lg ? ' lg' : ''}" src="/office/img/team/${esc(id)}-desk.png" alt="">`

const NAMES = { manager: 'Диас', smm: 'Мадина', montazh: 'Тимур', marketing: 'Алия', sales: 'Ерлан', revenue: 'Нурлан' }
const ROLES_OF = { manager: 'руководитель', smm: 'SMM', montazh: 'монтаж', marketing: 'маркетолог', sales: 'аналитик продаж', revenue: 'аналитик выручки' }

const PAGES = [
  { id: 'overview', title: 'Обзор', icon: 'dashboard', roles: ['owner', 'boss', 'sales'] },
  { id: 'plan', title: 'План', icon: 'task_alt', roles: ['owner', 'boss'] },
  { id: 'marketing', title: 'Маркетинг', icon: 'campaign', roles: ['owner', 'boss'] },
  { id: 'sales', title: 'Продажи', icon: 'apartment', roles: ['owner', 'boss', 'sales'] },
  { id: 'revenue', title: 'Выручка', icon: 'payments', roles: ['owner', 'boss'] },
  { id: 'smm', title: 'SMM', icon: 'photo_library', roles: ['owner', 'boss'] },
  { id: 'office', title: 'Живой офис', icon: 'groups', roles: ['owner', 'boss'] },
  { id: 'reports', title: 'Отчёты', icon: 'description', roles: ['owner', 'boss', 'sales'] },
  { id: 'access', title: 'Настройки / Доступ', icon: 'settings', roles: ['owner'], system: true },
]

// REVION brand mark (the R of four ribbons) and wordmark, from the brand kit; gradient ids are per use
const MARK = (id) => `<svg class="mark" viewBox="-20 -20 450 410" aria-hidden="true"><defs><linearGradient id="${id}t" x1="0" y1="0.8" x2="1" y2="0"><stop stop-color="#173F68"/><stop offset=".4" stop-color="#3185E8"/><stop offset="1" stop-color="#1E956B"/></linearGradient><linearGradient id="${id}i" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1d3a5f"/><stop offset=".42" stop-color="#2a5d93"/><stop offset="1" stop-color="#3185E8"/></linearGradient><linearGradient id="${id}s" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#173F68"/><stop offset=".4" stop-color="#3185E8"/><stop offset="1" stop-color="#1E956B"/></linearGradient><linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1E956B"/><stop offset=".38" stop-color="#3185E8"/><stop offset="1" stop-color="#173F68"/></linearGradient></defs><path fill="url(#${id}i)" d="M224 81C258 81 276 92 276 119C276 156 248 183 210 183H116L281 241C334 226 354 183 343 145C333 107 288 80 224 81Z"/><path fill="url(#${id}t)" d="M0 0H238C313 0 365 48 365 121C365 167 345 201 317 221C346 181 342 148 321 121C300 94 269 82 234 82H76C64 82 58 78 51 68Z"/><path fill="url(#${id}s)" d="M28 188L170 369H103C56 369 28 339 28 295Z"/><path fill="url(#${id}l)" d="M28 188C31 183 35 183 43 183H208C239 183 257 195 278 222L411 369H335C305 369 285 356 264 331L152 211C136 192 122 183 102 183H43C34 183 31 184 28 188Z"/></svg>`
const WORDMARK = '<svg class="wordmark" viewBox="0 0 453 60" aria-label="REVION"><g fill="currentColor"><path d="M0 0H33C46 0 53 7 53 17S46 34 33 34H7V60H0V27H33C41 27 46 24 46 17S41 7 33 7H0ZM29 31H38L57 60H48Z"/><path transform="translate(87 0)" d="M0 0H49V7H7V26H45V33H7V53H49V60H0Z"/><path transform="translate(164 0)" d="M0 0H8L30 51L52 0H60L34 60H26Z"/><path transform="translate(260 0)" d="M0 0H7V60H0Z"/><path transform="translate(300 0)" d="M32 0C11 0 0 12 0 30S11 60 32 60S64 48 64 30S53 0 32 0ZM32 7C48 7 57 16 57 30S48 53 32 53S7 44 7 30S16 7 32 7Z"/><path transform="translate(396 0)" d="M0 0H8L50 49V0H57V60H49L7 11V60H0Z"/></g></svg>'
const brand = (id) => `<div class="logo">${MARK(id)}<div>${WORDMARK}<span>Цифровая операционная система бизнеса</span></div></div>`

let ME = null
let DATA = null
let loadedAt = 0

// ---------- network ----------

async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office': '1' }, body: JSON.stringify(body) }
  const r = await fetch(path, { credentials: 'same-origin', ...opt })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) { ME = null; showLogin(); throw new Error('Нужно войти') }
  if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`)
  return data
}

function toast(text) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.setAttribute('role', 'status')
  t.textContent = text
  document.body.append(t)
  setTimeout(() => t.remove(), 3200)
}

// ---------- login ----------

async function boot() {
  if (tg?.initData) {
    tg.ready(); tg.expand()
    try { await api('/p/login/telegram', { initData: tg.initData }) } catch (e) { return showLogin(e.message) }
  }
  try { ME = await api('/p/me') } catch { return }
  render()
}

let polling = null
function showLogin(error = '') {
  clearInterval(polling)
  root.innerHTML = `<div class="login"><div class="card">
    ${brand('lg')}
    <h1>Вход в портал</h1>
    <p class="muted">Без паролей: вход подтверждается в нашем Telegram-боте.</p>
    ${error ? `<p class="chip red" style="white-space:normal">${esc(error)}</p>` : ''}
    <div id="loginBody"><button class="btn btn-primary" id="loginBtn" style="width:100%;padding:12px">${icon('send')} Войти через Telegram</button></div>
  </div></div>`
  $('#loginBtn').onclick = startLogin
}

async function startLogin() {
  const body = $('#loginBody')
  body.innerHTML = '<span class="spin"></span>'
  let l
  try { l = await api('/p/login/start', {}) } catch (e) { body.innerHTML = `<p class="chip red" style="white-space:normal">${esc(e.message)}</p>`; return }
  body.innerHTML = `
    <p style="margin:18px 0 4px"><b>Отправьте боту @${esc(l.bot)} с телефона:</b></p>
    <div class="code-big" style="font-size:34px;letter-spacing:1px" aria-label="Команда для бота">/login ${esc(l.word)}</div>
    <button class="btn btn-sm" type="button" id="copyLogin">${icon('content_copy')} Скопировать</button>
    <p class="small muted" style="margin:18px 0 8px">Или, если Telegram открыт на этом устройстве:</p>
    <a class="btn" style="width:100%" href="${esc(l.link)}" target="_blank" rel="noopener">${icon('open_in_new')} Открыть бота и выбрать число ${esc(l.code)}</a>
    <p class="small muted" style="margin-top:14px"><span class="spin"></span> Жду подтверждения… Код действует 5 минут.</p>`
  $('#copyLogin').onclick = () => navigator.clipboard?.writeText(`/login ${l.word}`).then(() => toast('Скопировано'), () => {})
  clearInterval(polling)
  polling = setInterval(async () => {
    try {
      const r = await api('/p/login/poll', { id: l.id })
      if (r.ok) { clearInterval(polling); ME = await api('/p/me'); render() }
      if (r.expired) { clearInterval(polling); showLogin('Время вышло или вход отменён. Попробуйте ещё раз.') }
    } catch {}
  }, 2000)
}

// ---------- shell ----------

const page = () => {
  const id = location.hash.replace(/^#\/?/, '') || 'overview'
  const p = shownPages().find((x) => x.id === id)
  return p || PAGES[0]
}
const shownPages = () => PAGES.filter((x) => x.roles.includes(ME.user.role) && (!ME.demo || ME.demo.pages.includes(x.id)))

async function render() {
  const p = page()
  const pages = shownPages()
  const nav = pages.filter((x) => !x.system).map((x) => `<a href="#/${x.id}" class="${x.id === p.id ? 'on' : ''}">${icon(x.icon)}<span>${x.title}</span></a>`).join('')
  root.innerHTML = `<div class="app">
    <aside class="side">
      ${brand('sd')}
      <div class="company"><span class="company-mark">${ME.demo ? esc([...ME.demo.company.trim()][0] || 'R') : 'Altyn Qala'}</span><div><b>${ME.demo ? esc(ME.demo.company.split(' · ')[0]) : 'Altyn Qala'}</b><span>${ME.demo ? 'демо-версия' : 'строительная компания'}</span></div></div>
      <nav class="nav">${nav}</nav>
      <nav class="nav nav-system">${pages.filter((x) => x.system).map((x) => `<a href="#/${x.id}" class="${x.id === p.id ? 'on' : ''}">${icon(x.icon)}<span>${x.title}</span></a>`).join('')}</nav>
      <div class="side-foot">
        ${avatar('manager')}
        <div class="who"><b>${esc(ME.user.name)}</b><span class="small muted">${esc(ME.user.roleName)}</span></div>
        <button class="btn btn-ghost btn-sm" id="themeBtn" title="Светлая / тёмная тема" aria-label="Сменить тему">${icon(theme.get() === 'dark' ? 'light_mode' : 'dark_mode')}</button>${ME.demo ? '' : `<button class="btn btn-ghost btn-sm" id="logout" title="Выйти" aria-label="Выйти">${icon('logout')}</button>`}
      </div>
    </aside>
    <main class="content">${ME.demo ? '<div class="demo-strip">Демо-версия REVION · данные условные</div>' : ''}<div id="page"></div></main>
    <nav class="tabbar">${nav}</nav>
  </div>`
  $('#themeBtn').onclick = () => { theme.set(theme.get() === 'dark' ? 'light' : 'dark'); render() }
  if ($('#logout')) $('#logout').onclick = async () => { await api('/p/logout', {}).catch(() => {}); ME = null; showLogin() }
  const el = $('#page')
  if (p.id === 'access') return accessPage(el)
  if (!DATA || Date.now() - loadedAt > 5 * 60e3) {
    el.innerHTML = '<div class="empty"><span class="spin"></span> Собираю данные…</div>'
    try { await load() } catch (e) { el.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(e.message)}</div>`; return }
  }
  CHARTS.length = 0
  ;({ overview, plan: planPage, marketing, sales, revenue, smm, reports, office: officePage })[p.id](el)
  paintCharts()
}

async function load(fresh) {
  DATA = await api('/p/data' + (fresh ? '?fresh=1' : ''))
  loadedAt = Date.now()
}

window.addEventListener('hashchange', () => { if (ME) { render(); window.scrollTo(0, 0) } })

function header(title, sub, right = '') {
  const upd = DATA ? `Данные на ${when(new Date(DATA.at).toISOString())}` : ''
  return `<div class="head"><div><h1>${title}</h1><div class="sub">${sub || upd}</div></div><div class="chips">${right}<button class="btn btn-sm btn-ghost theme-mobile" data-act="theme" aria-label="Сменить тему">${icon(theme.get() === 'dark' ? 'light_mode' : 'dark_mode')}</button>${ME.user.role === 'owner' && DATA ? `<button class="btn btn-sm" data-act="refresh">${icon('refresh')} Обновить</button>` : ''}</div></div>`
}

// global actions
document.addEventListener('click', (ev) => { const p = ev.target.closest('[data-more]'); if (p) p.classList.toggle('open') })
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  if (ME?.demo && act !== 'theme') {
    toast({ yes: '✅ Утверждено. В рабочей системе задача уйдёт исполнителю, а через 7 дней — замер результата.', 'signal-task': '✅ Утверждено. В рабочей системе задача уйдёт исполнителю, а через 7 дней — замер результата.', no: 'Отклонено — система запомнит решение.', 'signal-dismiss': 'Скрыто на 2 недели.', refresh: 'Данные обновлены.' }[act] || 'В демо-версии кнопки показывают, как это работает.')
    return
  }
  try {
    if (act === 'refresh') { el.disabled = true; await load(true); render(); toast('Данные обновлены') }
    if (act === 'yes' || act === 'no') {
      el.disabled = true
      const r = await api(`/p/proposals/${el.dataset.id}/${act}`, {})
      toast(act === 'yes' ? (r.task ? `Принято — задача у: ${NAMES[r.task.employee] || r.task.employee}` : 'Принято') : 'Отклонено — сотрудник запомнит')
      await load(); render()
    }
    if (act === 'signal-task') {
      el.disabled = true
      const r = await api('/p/signals/act', { key: el.dataset.key })
      toast(r.task ? `Задача поставлена: ${NAMES[r.task.employee] || r.task.employee}. Видно в «Плане»` : 'Готово')
      await load(); render()
    }
    if (act === 'signal-dismiss') { el.disabled = true; await api('/p/signals/dismiss', { key: el.dataset.key }); toast('Скрыто на 2 недели'); await load(); render() }
    if (act === 'home-done' || act === 'home-hide') { el.disabled = true; await api('/p/home/hide', { key: el.dataset.key, done: act === 'home-done' }); toast(act === 'home-done' ? 'Отмечено. Если данные не изменятся, дело вернётся завтра.' : 'Скрыто на 2 недели'); await load(); render() }
    if (act === 'goal-ask') { el.disabled = true; await api('/p/week-goal/ask', {}); toast('Нурлан считает план недели — пришлю в Telegram на утверждение') }
    if (act === 'theme') { theme.set(theme.get() === 'dark' ? 'light' : 'dark'); render(); return }
    if (act === 'mem-again') {
      if (!confirm('Поставить эту задачу снова? Она уйдёт исполнителю сразу.')) return
      el.disabled = true
      const r = await api(`/p/memory/${el.dataset.id}/again`, {})
      toast(r.task ? `Задача поставлена: ${NAMES[r.task.employee] || r.task.employee}` : 'Готово')
      await load(); render(); return
    }
    if (act === 'goals-ask') { el.disabled = true; await api('/p/goals/ask', {}); toast('Нурлан считает цели месяца — пришлю на утверждение') }
    if (act === 'goals-edit') { $('#goalsForm')?.classList.toggle('hidden') }
    if (act === 'plan-ask') { el.disabled = true; await api('/p/week-plan/ask', {}); toast('Диас составляет план недели — пришлю в Telegram и сюда, 3–5 минут') }
    if (act === 'wp-edit') { $('#wpEdit')?.classList.toggle('hidden') }
    if (act === 'wp-yes') {
      const only = [...document.querySelectorAll('[data-wp]')].filter((x) => x.checked).map((x) => Number(x.dataset.wp))
      if (!only.length) { toast('Отметьте хотя бы одно дело или нажмите «Отклонить»'); return }
      el.disabled = true
      const r = await api(`/p/proposals/${el.dataset.id}/yes`, { only })
      toast(`План утверждён: ${r.approved} дел ушли исполнителям`)
      await load(); render()
    }
    if (act === 'praise') { await api(`/p/praise/${el.dataset.id}`, {}); toast(`${NAMES[el.dataset.id]} рад(а) 😊`) }
  } catch (e) { toast(e.message); el.disabled = false }
})

document.addEventListener('submit', async (ev) => {
  const form = ev.target
  if (form.id === 'goalsForm') {
    ev.preventDefault()
    try { await api('/p/goals', Object.fromEntries(new FormData(form))); toast('Цели сохранены'); await load(); render() } catch (e) { toast(e.message) }
  }
  if (form.id === 'wpEdit') {
    ev.preventDefault()
    const comment = form.comment.value.trim()
    if (!comment) { toast('Напишите, что поменять'); return }
    try { await api(`/p/week-plan/${form.querySelector('button').dataset.id}/revise`, { comment }); toast('Диас переделывает план — пришлю новый'); await load(); render() } catch (e) { toast(e.message) }
  }
})

// ---------- small charts (SVG) ----------

function spark(values, color = 'var(--primary)') {
  const v = values.filter((x) => x != null)
  if (v.length < 2) return ''
  const max = Math.max(...v), min = Math.min(...v)
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 96 + 2},${26 - ((x - min) / (max - min || 1)) * 22}`).join(' ')
  return `<svg class="chart" viewBox="0 0 100 28" style="width:84px" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

// a full-width trend under a big number: a soft line with a light fill
let trendId = 0
function trendLine(values, color) {
  const v = values.filter((x) => x != null)
  if (v.length < 2) return ''
  const max = Math.max(...v), min = Math.min(...v), id = `tr${++trendId}`
  const xy = v.map((x, i) => [(i / (v.length - 1)) * 196 + 2, 30 - ((x - min) / (max - min || 1)) * 24])
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return `<svg class="trend" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="2,34 ${line} 198,34" fill="url(#${id})"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`
}

// "Premium bars": the sum above each bar, the second measure as pills under the axis,
// the best period outlined, the average dashed. One scale only, so nothing gets mixed up.
const niceMax = (m) => {
  if (m <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(m))
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((v) => v >= m)
}

// charts are drawn at the real width of their card, so the text stays readable in narrow columns
const CHARTS = []
function bars(items, opts) {
  CHARTS.push([items, opts])
  return `<div class="chart-host" data-chart="${CHARTS.length - 1}"></div>`
}

function paintCharts() {
  for (const host of document.querySelectorAll('[data-chart]')) {
    const c = CHARTS[host.dataset.chart]
    if (c) host.innerHTML = barsSvg(c[0], c[1], Math.max(300, Math.round(host.clientWidth)))
  }
}
let resizeTimer
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(paintCharts, 150) })

function barsSvg(items, { value, label, show = (v) => fmt(v), pill, pillShow = (v) => fmt(v), zero = 'нет продаж', avgLabel = 'среднее', color = 'var(--primary)', lowBest = false }, W) {
  const n = items.length
  if (!n) return '<div class="empty">Нет данных</div>'
  const narrow = W < 560
  const H = pill ? 262 : 236, L = narrow ? 40 : 54, R = narrow ? 50 : 84, T = 26
  const base = H - (pill ? 64 : 36)
  const vals = items.map((x) => x[value] || 0)
  const max = niceMax(Math.max(...vals))
  const y = (v) => T + (base - T) * (1 - v / max)
  const step = (W - L - R) / n, bw = Math.min(narrow ? 26 : 46, step * 0.62)
  // the outlined bar is the best one: the highest, or the lowest above zero for a price
  const best = lowBest ? vals.indexOf(Math.min(...vals.filter((v) => v > 0))) : vals.indexOf(Math.max(...vals))
  const avg = vals.reduce((a, b) => a + b, 0) / n
  const small = n > 10 || narrow
  const fs = small ? 10 : 12
  let svg = ''
  // scale
  for (const t of [0, max / 2, max]) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" ${t ? 'stroke-dasharray="2 5"' : ''}/>`
    svg += `<text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(show(t))}</text>`
  }
  items.forEach((x, i) => {
    const v = vals[i]
    const cx = L + step * i + step / 2
    const top = y(v)
    const isBest = i === best && v > 0
    const tip = `${x[label]}: ${show(v)}${pill ? ` · ${pillShow(x[pill] || 0)}` : ''}`
    if (v > 0) {
      svg += `<rect class="bar-grow" style="animation-delay:${i * 45}ms" x="${cx - bw / 2}" y="${top}" width="${bw}" height="${base - top}" rx="${Math.min(9, bw / 4)}" fill="${color}" opacity="${isBest ? 1 : 0.42}"><title>${esc(tip)}</title></rect>`
      if (isBest) svg += `<rect x="${cx - bw / 2 - 5}" y="${top - 5}" width="${bw + 10}" height="${base - top + 10}" rx="${Math.min(12, bw / 4 + 3)}" fill="none" stroke="${color}" stroke-width="1.5"/>`
      if (!small || isBest || step > 40) svg += `<text x="${cx}" y="${top - (isBest ? 11 : 7)}" text-anchor="middle" style="font-size:${fs}px;font-weight:${isBest ? 800 : 700};fill:${isBest ? color : 'var(--text)'}">${esc(show(v))}</text>`
    } else {
      svg += `<text x="${cx}" y="${base - 8}" text-anchor="middle" style="font-size:${small ? 9 : 11}px;opacity:.75">${esc(step < 60 ? '—' : i === n - 1 ? 'пока 0' : zero)}</text>`
    }
    if (pill) {
      const t = pillShow(x[pill] || 0)
      const pw = Math.min(step - 4, 12 + t.length * (small ? 5.6 : 6.6)), ph = small ? 16 : 19
      const on = (x[pill] || 0) > 0
      svg += `<rect x="${cx - pw / 2}" y="${base + 10}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="${isBest ? 'var(--amber)' : on ? 'var(--amber-tint)' : 'var(--surface-2)'}"/>`
      svg += `<text x="${cx}" y="${base + 10 + ph / 2 + 4}" text-anchor="middle" style="font-size:${small ? 9 : 11}px;font-weight:700;fill:${isBest ? '#3a2a00' : on ? 'var(--amber-ink)' : 'var(--muted)'}">${esc(t)}</text>`
    }
    if (!small || i % 2 === (n - 1) % 2) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(x[label])}</text>`
  })
  // the average line goes over the bars
  if (avg > 0) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="7 5"/><circle cx="${W - R}" cy="${y(avg)}" r="3" fill="var(--amber)"/>`
    svg += `<text x="${W - R + 6}" y="${y(avg) - 3}" style="font-size:10px;fill:var(--amber-ink)">${esc(avgLabel)}</text><text x="${W - R + 6}" y="${y(avg) + 11}" style="font-size:${narrow ? 10 : 12}px;font-weight:800;fill:var(--amber-ink)">${esc(show(avg))}</text>`
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${svg}</svg>`
}

function donut(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  let a = -Math.PI / 2, svg = ''
  for (const p of parts) {
    const da = (p.value / total) * Math.PI * 2
    if (!p.value) continue
    const large = da > Math.PI ? 1 : 0
    const x1 = 60 + 46 * Math.cos(a), y1 = 60 + 46 * Math.sin(a), x2 = 60 + 46 * Math.cos(a + da - 0.0001), y2 = 60 + 46 * Math.sin(a + da - 0.0001)
    svg += `<path d="M${x1} ${y1} A46 46 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${p.color}" stroke-width="16"><title>${esc(p.label)}: ${p.value}</title></path>`
    a += da
  }
  return `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
    <svg class="chart" viewBox="0 0 120 120" style="width:130px;flex:none" role="img">${svg}<text x="60" y="58" text-anchor="middle" style="font:800 22px var(--sans);fill:var(--text)">${total}</text><text x="60" y="76" text-anchor="middle">квартир</text></svg>
    <div class="legend" style="flex-direction:column;gap:6px">${parts.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} — <b style="color:var(--text)">${p.value}</b></span>`).join('')}</div></div>`
}

function delta(cur, prev, { lowerIsBetter = false } = {}) {
  if (cur == null || prev == null || !prev) return ''
  const d = Math.round(((cur - prev) / prev) * 100)
  if (!d) return '<span class="delta">0%</span>'
  const good = lowerIsBetter ? d < 0 : d > 0
  return `<span class="delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`
}

function kpi(label, value, extra = '', sp = '') {
  return `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="row">${extra || '<span></span>'}${sp}</div></div>`
}

// ---------- markdown (reports) ----------

function md(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  let out = '', list = null, table = []
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,!?:]|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  const flushList = () => { if (list) { out += `</${list}>`; list = null } }
  const flushTable = () => {
    if (!table.length) return
    const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => inline(c.trim())))
    out += `<table><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    table = []
  }
  for (const raw of lines) {
    const l = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(l)) { flushList(); table.push(l); continue }
    flushTable()
    let m
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { flushList(); const h = Math.min(3, m[1].length); out += `<h${h}>${inline(m[2])}</h${h}>`; continue }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { flushList(); out += '<ul>'; list = 'ul' } out += `<li>${inline(m[1])}</li>`; continue }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { flushList(); out += '<ol>'; list = 'ol' } out += `<li>${inline(m[1])}</li>`; continue }
    if ((m = l.match(/^>\s?(.*)$/))) { flushList(); out += `<blockquote>${inline(m[1])}</blockquote>`; continue }
    flushList()
    if (/^-{3,}$/.test(l)) { out += '<hr>'; continue }
    if (l.trim()) out += `<p>${inline(l)}</p>`
  }
  flushList(); flushTable()
  return `<div class="md">${out}</div>`
}

const fileUrl = (r, f) => `/files/${r.id}/${f.split('/').map(encodeURIComponent).join('/')}`
const latest = (emp) => DATA.reports.find((r) => r.employee === emp)

function reportCard(emp, title) {
  const r = latest(emp)
  if (!r) return `<div class="card"><div class="card-head"><div class="who-line">${avatar(emp)}<h2>${title}</h2></div></div><div class="empty">${NAMES[emp]} ещё не присылал(а) отчётов.</div></div>`
  return `<div class="card"><div class="card-head"><div class="who-line">${avatar(emp)}<div><h2>${title}</h2><div class="small muted">${esc(r.title)} · ${when(r.at)}</div></div></div><a class="btn btn-sm" href="#/reports" data-report="${r.id}">Открыть</a></div>${md(r.result.slice(0, 1800) + (r.result.length > 1800 ? '…' : ''))}</div>`
}

const LEVEL = { critical: ['Критично', 'red'], attention: ['Внимание', 'amber'], opportunity: ['Возможность', 'green'], positive: ['Плюс', 'green'] }
const CAUSE = { fact: 'Факт', link: 'Наблюдаемая связь', probable: 'Вероятная причина', proven: 'Доказано' }
const canSee = (id) => shownPages().some((p) => p.id === id)

function causeLine(c) {
  if (!c?.text) return ''
  return `<div class="cause"><span class="ck ck-${c.kind}">${CAUSE[c.kind] || ''}</span> ${esc(c.text)}</div>`
}

function signalCard(s) {
  const owner = ME.user.role === 'owner'
  const [lvl] = LEVEL[s.level] || ['']
  const more = s.section && s.section !== page().id && canSee(s.section) ? `<a class="btn btn-sm btn-ghost" href="#/${s.section}">Подробнее ${icon('arrow_forward')}</a>` : ''
  let buttons = ''
  if (owner && s.proposal) buttons = `<button class="btn btn-sm btn-primary" data-act="yes" data-id="${s.proposal}">Делать</button><button class="btn btn-sm" data-act="no" data-id="${s.proposal}">Не надо</button>`
  else if (owner && s.action) buttons = `<button class="btn btn-sm btn-primary" data-act="signal-task" data-key="${esc(s.key)}">Создать задачу</button><button class="btn btn-sm" data-act="signal-dismiss" data-key="${esc(s.key)}">Не актуально</button>`
  else if (owner && s.level !== 'positive') buttons = `<button class="btn btn-sm" data-act="signal-dismiss" data-key="${esc(s.key)}">Не актуально</button>`
  return `<div class="signal lvl-${s.level}">
    <span class="tag">${lvl}${s.from ? ` · ${esc(NAMES[s.from] || '')}` : ''}</span>
    <b>${esc(s.what)}</b>
    ${s.why ? `<p title="Нажмите, чтобы прочитать целиком" data-more>${esc(s.why)}</p>` : ''}
    ${s.value != null ? `<div class="sig-val">${esc(typeof s.value === 'number' ? fmt(s.value) : s.value)}${s.delta ? ` <span class="delta good">${s.delta > 0 ? '+' : ''}${s.delta}%</span>` : ''}</div>` : ''}
    ${s.impact?.text ? `<div class="impact">${icon('payments')} ${esc(s.impact.text)}</div>` : ''}
    ${causeLine(s.cause)}
    ${s.action ? `<div class="todo-line">${icon('arrow_right_alt')} ${esc(s.action.title)} — ${esc(NAMES[s.action.employee] || '')}</div>` : s.owner ? `<div class="todo-line">${icon('person')} ${esc(s.owner)}</div>` : ''}
    <div class="actions">${buttons}${more}</div>
  </div>`
}

function kpiCard(k) {
  if (k.empty) return `<div class="card kpi kpi-empty"><div class="label">${esc(k.label)}</div><div class="value muted">—</div><div class="small muted">${esc(k.empty)}</div></div>`
  const show = (v) => (v == null ? '—' : k.key === 'revenue' ? money(v) : k.unit ? money(v, k.unit) : fmt(v, 1))
  const d = k.value != null && k.prev ? Math.round(((k.value - k.prev) / Math.abs(k.prev)) * 100) : null
  const good = d == null || d === 0 || k.neutral ? '' : (k.lower ? d < 0 : d > 0) ? 'good' : 'bad'
  const badge = d == null ? '<span class="small muted">нет сравнения</span>' : `<span class="delta ${good}" title="было ${esc(show(k.prev))}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d)}%</span>`
  return `<div class="card kpi"><div class="label">${esc(k.label)}</div><div class="value">${esc(show(k.value))}</div><div class="row">${badge}${spark(k.trend || [], k.lower ? 'var(--amber)' : 'var(--primary)')}</div>${k.note ? `<div class="small muted" style="margin-top:4px">${esc(k.note)}</div>` : ''}</div>`
}

function todoList(list) {
  const owner = ME.user.role === 'owner'
  if (!list.length) return '<div class="empty">Срочных дел нет 👍</div>'
  return `<ol class="todo">${list.map((t, i) => `<li class="todo-item lvl-${t.level}">
    <span class="num">${i + 1}</span>
    <div class="grow"><b>${esc(t.what)}</b>
      <div class="small muted">${t.why && t.why !== t.what ? `${esc(t.why)} · ` : ''}${t.owner ? 'делаете вы' : `${esc(NAMES[t.from] || '')}`}${t.due ? ` · до ${day(t.due)}` : ''}</div>
      ${t.expected ? `<div class="small">Ожидаем: ${esc(t.expected)}</div>` : ''}</div>
    ${owner && t.proposal ? `<button class="btn btn-sm btn-primary" data-act="yes" data-id="${t.proposal}">Утвердить</button>` : owner && !t.owner ? `<button class="btn btn-sm btn-primary" data-act="signal-task" data-key="${esc(t.key)}">Утвердить</button>` : ''}
  </li>`).join('')}</ol>`
}

function changeCard(c) {
  if (!c) return '<div class="empty">Шахматка не подключена.</div>'
  const mln = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v) / 1e6, 1)} млн ₸`
  return `<div class="change-head"><div><div class="small muted">Выручка, ${esc(c.period)}</div><div class="big">${money(c.revenue)}</div></div>${c.delta != null ? `<span class="delta ${c.delta >= 0 ? 'good' : 'bad'}">${c.delta > 0 ? '▲' : '▼'} ${Math.abs(c.delta)}%</span>` : ''}</div>
    <div class="small muted" style="margin:10px 0 4px">Что повлияло (точный расчёт: продажи × средний чек)</div>
    ${c.factors.map((f) => `<div class="factor ${f.amount > 0 ? 'up' : f.amount < 0 ? 'down' : ''}"><span>${f.amount > 0 ? '+' : f.amount < 0 ? '−' : '·'}</span><div class="grow"><b>${esc(f.label)}</b> <span class="small muted">${esc(f.text)}</span></div><b>${mln(f.amount)}</b></div>`).join('') || '<div class="small muted">Продаж с ценой не было — разложить нечего.</div>'}
    <div class="small muted" style="margin:12px 0 4px">Связанные показатели — не доказанная причина</div>
    ${c.links.map((f) => `<div class="factor ${f.sign > 0 ? 'up' : f.sign < 0 ? 'down' : ''}"><span>${f.sign > 0 ? '+' : f.sign < 0 ? '−' : '·'}</span><div class="grow"><span class="ck ck-${f.kind}">${CAUSE[f.kind]}</span> <b>${esc(f.label)}</b> <span class="small muted">${esc(f.text)}</span></div></div>`).join('')}
    ${c.missing.length ? `<p class="small muted" style="margin:10px 0 0">Чего не хватает: ${esc(c.missing.join('; '))}.</p>` : ''}`
}

// ---------- pages ----------

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Almaty' }))
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
}

const STATUS = { proposed: ['Предложено', ''], approved: ['Утверждено', 'blue'], in_work: ['В работе', 'amber'], done: ['Выполнено', 'green'], measured: ['Результат измерен', 'green'], declined: ['Отклонено', 'red'] }
const VERDICT_RU = { worked: ['сработало', 'green'], not: ['не сработало', 'red'], flat: ['без заметного изменения', ''], insufficient: ['недостаточно данных', ''] }

function goalBlock(p) {
  const owner = ME.user.role === 'owner'
  const f = p.fact || {}
  const row = (label, goal, fact, show = fmt) => {
    const pct = goal ? Math.min(100, Math.round((fact / goal) * 100)) : 0
    return `<div class="goal-row"><div class="goal-top"><b>${label}</b><span>${show(fact)} <span class="muted">из ${show(goal)}</span></span></div><div class="meter"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--primary)' : 'var(--amber)'}"></i></div></div>`
  }
  if (p.goal) return `<div class="grid g3">${row('Продажи', p.goal.sales, f.sales || 0)}${row('Брони', p.goal.bookings, f.bookings || 0)}${p.goal.revenue ? row('Выручка', p.goal.revenue, f.revenue || 0, (v) => money(v)) : '<div class="goal-row muted small">Выручку Нурлан не посчитал: мало цен в шахматке.</div>'}</div>
    ${p.goal.why ? `<p class="small muted" style="margin:12px 0 0">Нурлан: ${esc(p.goal.why)}</p>` : ''}`
  if (p.goalProposal) return `<div class="signal lvl-attention"><span class="tag">Нурлан предлагает</span><b>${p.goalProposal.sales} продаж, ${p.goalProposal.bookings} броней${p.goalProposal.revenue ? `, ≈${fmt(p.goalProposal.revenue / 1e6, 1)} млн ₸` : ''}</b><p>${esc(p.goalProposal.why || '')}</p>
    ${owner ? `<div class="actions"><button class="btn btn-sm btn-primary" data-act="yes" data-id="${p.goalProposal.id}">Утвердить</button><button class="btn btn-sm" data-act="no" data-id="${p.goalProposal.id}">Не надо</button></div>` : ''}</div>`
  return `<div class="empty">Цели на эту неделю ещё нет. Нурлан предлагает её в понедельник вместе с отчётом.${owner ? `<div style="margin-top:12px"><button class="btn btn-primary" data-act="goal-ask">${icon('target')} Попросить Нурлана сейчас</button></div>` : ''}</div>`
}

// ---------- goals of the month, Диас's week plan, business memory ----------

const CHANCE = { высокая: 'green', средняя: 'amber', низкая: 'red' }

function goalsCard(gs, full) {
  if (!gs) return ''
  const owner = ME.user.role === 'owner'
  const p = DATA.plan || {}
  const head = `<div class="card-head"><h2>${icon('flag')} Цели месяца${gs.month ? ` · ${new Date(gs.month + '-15').toLocaleDateString('ru-RU', { month: 'long' })}` : ''}</h2>${gs.left != null ? `<span class="small muted">день ${gs.dayOf} из ${gs.daysIn}</span>` : ''}</div>`
  if (!gs.goals) {
    const prop = p.goalsProposal
    if (prop) return `<section class="card" style="margin-top:16px">${head}<div class="signal lvl-attention"><span class="tag">Нурлан предлагает</span><b>${prop.sales || '—'} продаж${prop.revenue ? `, ≈${fmt(prop.revenue / 1e6, 1)} млн ₸` : ''}${prop.maxCpr ? ` · переписка ≤ ${prop.maxCpr} $` : ''}${prop.threeRooms ? ` · ${prop.threeRooms} трёхкомнатных` : ''}</b><p>${esc(prop.why || '')}</p>
      ${owner ? `<div class="actions"><button class="btn btn-sm btn-primary" data-act="yes" data-id="${prop.id}">Утвердить</button><button class="btn btn-sm" data-act="no" data-id="${prop.id}">Не надо</button><button class="btn btn-sm btn-ghost" data-act="goals-edit">Поправить цифры</button></div>` : ''}</div>${owner ? goalsForm(prop) : ''}</section>`
    return `<section class="card" style="margin-top:16px">${head}${gs.forecast ? `<p class="small" style="margin:0 0 8px">Без цели: факт месяца ${money(gs.fact.revenue)} и ${gs.fact.sales} ${plural(gs.fact.sales, 'продажа', 'продажи', 'продаж')}, прогноз до конца месяца ≈${money(gs.forecast.revenue)} и ${fmt(gs.forecast.sales, 1)} продаж (по темпу последних 4 недель).</p>` : ''}<div class="empty">Целей на месяц ещё нет. Нурлан предложит их в понедельничном отчёте.${owner ? `<div class="chips" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-act="goals-ask">${icon('target')} Попросить Нурлана сейчас</button><button class="btn" data-act="goals-edit">Вписать самому</button></div>` : ''}</div>${owner ? goalsForm({}) : ''}</section>`
  }
  const row = (label, x, show) => x ? `<div class="goal-line">
      <div class="goal-top"><b>${label}</b><span class="chip ${CHANCE[x.chance] || ''}">${x.chance ? `вероятность ${x.chance}` : x.partial ? 'оплаты не прочитались — суммы нет' : ''}</span></div>
      <div class="goal-nums"><span>план <b>${show(x.plan)}</b></span><span>факт <b>${show(x.fact)}</b></span><span>прогноз <b>${show(x.forecast)}</b></span>${x.gap ? `<span class="bad-text">не хватает <b>${show(x.gap)}</b></span>` : ''}</div>
      <div class="meter meter-goal"><i style="width:${Math.min(100, Math.round((x.fact / x.plan) * 100))}%"></i><em style="left:${Math.min(100, Math.round((x.forecast / x.plan) * 100))}%"></em></div></div>` : ''
  const mln = (v) => money(v)
  return `<section class="card" style="margin-top:16px">${head}
    <div class="grid g2">
      <div>${row('Выручка', gs.revenue, mln)}${row('Продажи', gs.sales, (v) => fmt(v, 1))}
        ${gs.cpr ? `<div class="goal-line"><div class="goal-top"><b>Цена переписки</b><span class="chip ${gs.cpr.ok ? 'green' : 'red'}">${gs.cpr.ok ? 'в норме' : 'дороже цели'}</span></div><div class="goal-nums"><span>цель ≤ <b>${gs.cpr.plan} ${esc(gs.cpr.currency)}</b></span><span>сейчас <b>${gs.cpr.fact} ${esc(gs.cpr.currency)}</b></span></div></div>` : ''}
        ${gs.threeRooms ? `<div class="goal-line"><div class="goal-top"><b>Трёхкомнатные</b>${gs.threeRooms.until ? `<span class="small muted">до ${day(gs.threeRooms.until)}</span>` : ''}</div><div class="goal-nums"><span>цель <b>${gs.threeRooms.plan}</b></span><span>продано <b>${gs.threeRooms.fact}</b></span>${gs.threeRooms.free != null ? `<span>свободно <b>${gs.threeRooms.free}</b></span>` : ''}</div></div>` : ''}
        <p class="small muted" style="margin:6px 0 0">Прогноз = факт месяца + темп последних 4 недель × оставшиеся ${gs.left} дн. Полоска — факт, отметка — прогноз.</p>
      </div>
      <div>
        ${gs.coverage ? `<div class="goal-line"><b>Покрытие разрыва бронями</b><div class="small">В бронях ≈${fmt(gs.booked.money / 1e6, 1)} млн ₸ — это ${gs.coverage.pct}% того, чего не хватает до плана.</div></div>` : ''}
        ${gs.limit ? `<div class="cause" style="margin-bottom:8px"><span class="ck ck-probable">Вероятная причина</span> ${esc(gs.limit)}</div>` : ''}
        ${gs.steps?.length ? `<b class="small">Что сделать, чтобы приблизиться к плану</b><ul class="small" style="margin:6px 0 0;padding-left:18px">${gs.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="small muted">Идём по плану.</div>'}
        ${gs.goals.why ? `<p class="small muted">Нурлан: ${esc(gs.goals.why)}</p>` : ''}
        ${owner && full ? `<button class="btn btn-sm btn-ghost" data-act="goals-edit">${icon('edit')} Изменить цели</button>` : ''}
      </div>
    </div>${owner && full ? goalsForm(gs.goals) : ''}</section>`
}

function goalsForm(g) {
  const v = (x) => (x == null ? '' : esc(x))
  return `<form class="goals-form hidden" id="goalsForm">
    <label>Выручка за месяц, ₸<input name="revenue" inputmode="numeric" value="${v(g.revenue)}" placeholder="120000000"></label>
    <label>Продаж за месяц<input name="sales" inputmode="numeric" value="${v(g.sales)}" placeholder="6"></label>
    <label>Переписка не дороже, $<input name="maxCpr" inputmode="decimal" value="${v(g.maxCpr)}" placeholder="2.5"></label>
    <label>Трёхкомнатных продать<input name="threeRooms" inputmode="numeric" value="${v(g.threeRooms)}" placeholder="2"></label>
    <label>…до даты<input name="threeRoomsUntil" type="date" value="${v(g.threeRoomsUntil)}"></label>
    <button class="btn btn-primary">Сохранить цели</button>
  </form>`
}

function weekPlanCard(wp) {
  const owner = ME.user.role === 'owner'
  if (!wp) return owner ? `<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${icon('event_note')} План недели от Диаса</h2><button class="btn btn-sm" data-act="plan-ask">${icon('auto_awesome')} Попросить Диаса составить план</button></div><p class="small muted" style="margin:0">Диас присылает план по понедельникам после отчётов: одно сообщение на всю команду, «Утвердить всё / Изменить / Отклонить».</p></section>` : ''
  return `<section class="card week-plan" style="margin-bottom:16px"><div class="card-head"><h2>${icon('event_note')} ${esc(wp.title)} — на утверждение</h2><span class="chip amber">ждёт вас</span></div>
    ${wp.summary ? `<p style="margin:0 0 10px">${esc(wp.summary)}</p>` : ''}
    <div class="list">${wp.items.map((x, i) => `<label class="list-item wp-item">${owner ? `<input type="checkbox" checked data-wp="${i}">` : `<span class="num">${i + 1}</span>`}${avatar(x.employee)}<div class="grow"><b>${esc(x.title)}</b> <span class="small muted">· ${esc(NAMES[x.employee] || x.employee)}${x.days ? ` · до ${day(new Date(Date.now() + x.days * 864e5).toISOString())}` : ''}</span><div class="small muted">зачем: ${esc(x.why)}</div>${x.expected ? `<div class="small">ждём: ${esc(x.expected)}</div>` : ''}</div></label>`).join('')}</div>
    ${owner ? `<div class="chips" style="margin-top:12px"><button class="btn btn-primary" data-act="wp-yes" data-id="${wp.id}">Утвердить выбранное</button><button class="btn" data-act="wp-edit">Изменить</button><button class="btn btn-ghost" data-act="no" data-id="${wp.id}">Отклонить</button></div>
      <form class="hidden" id="wpEdit" style="margin-top:10px"><textarea name="comment" rows="2" placeholder="Что поменять: например, «Мадине — про трёхкомнатные, Тимура не загружать»" style="width:100%"></textarea><button class="btn btn-primary btn-sm" style="margin-top:6px" data-id="${wp.id}">Отправить Диасу</button></form>` : ''}
  </section>`
}

const MEM_VERDICT = { approved: ['утверждено, ждёт замера', ''], declined: ['отклонено владельцем', ''], worked: ['сработало', 'green'], not: ['не сработало', 'red'], flat: ['без изменения', ''], insufficient: ['мало данных', ''] }

function memoryCard(list) {
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('psychology')} Память бизнеса</h2><span class="small muted">проблема → гипотеза → решение → кто → что сделали → результат</span></div>
    ${list?.length ? `<div class="table-wrap"><table><thead><tr><th>Когда</th><th>Проблема</th><th>Гипотеза</th><th>Решение</th><th>Итог</th></tr></thead><tbody>${list.map((r) => `<tr class="${r.stale ? 'mem-stale' : ''}"><td class="small">${day(r.decidedAt || r.at)}<div class="muted">${esc(r.area || '')}</div></td><td class="small">${esc(r.problem.slice(0, 140))}</td><td class="small">${esc(r.hypothesis || '—')}</td><td><b class="small">${esc(r.decision)}</b><div class="small muted">${r.verdict === 'declined' ? 'не утвердил владелец' : 'утвердил владелец'}</div></td><td>${r.stale ? `<span class="chip">не актуально</span><div class="small muted">${esc(r.stale)}</div>` : `<span class="chip ${(MEM_VERDICT[r.verdict] || ['', ''])[1]}">${(MEM_VERDICT[r.verdict] || [r.verdict])[0]}</span>`}${r.result ? `<div class="small muted">${esc(r.result.metric || '')}: ${fmt(r.result.base, 2)} → ${fmt(r.result.value, 2)}</div>` : ''}${ME.user.role === 'owner' && r.canRedo ? `<div style="margin-top:6px"><button class="btn btn-sm" data-act="mem-again" data-id="${r.id}">${icon('replay')} ${r.verdict === 'declined' ? 'Утвердить' : 'Повторить'}</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Память копится всегда и не стирается. Диас и сотрудники сверяются с ней перед новыми предложениями: не повторяют неудачное и развивают удачное. Итоги — наблюдаемые изменения, а не доказанные причины.</p>` : '<div class="empty">Память начнёт заполняться с ваших следующих решений «Делать / Не надо».</div>'}
  </section>`
}

function lossesMini(list) {
  const top = (list || []).filter((x) => x.amount).slice(0, 4)
  if (!top.length) return ''
  return `<div class="card"><div class="card-head"><h2>${icon('money_off')} Потенциальные потери</h2>${canSee('revenue') ? '<a class="btn btn-sm btn-ghost" href="#/revenue">Все</a>' : ''}</div>
    <div class="list">${top.map((x) => `<div class="list-item loss"><span class="dot lvl-dot-${x.level}"></span><div class="grow"><b>${esc(x.title)}</b><div class="small muted clamp">${esc(x.text)}</div></div><b class="loss-sum">${x.currency ? money(x.amount, x.currency) : money(x.amount)}</b></div>`).join('')}</div></div>`
}

function goalsMini(gs) {
  if (!gs?.goals || !gs.revenue) return ''
  const x = gs.revenue
  return `<div class="card"><div class="card-head"><h2>${icon('flag')} План месяца</h2>${canSee('plan') ? '<a class="btn btn-sm btn-ghost" href="#/plan">План</a>' : ''}</div>
    <div class="goal-nums"><span>план <b>${money(x.plan)}</b></span><span>факт <b>${money(x.fact)}</b></span><span>прогноз <b>${money(x.forecast)}</b></span></div>
    <div class="meter meter-goal" style="margin:8px 0"><i style="width:${Math.min(100, Math.round((x.fact / x.plan) * 100))}%"></i><em style="left:${Math.min(100, Math.round((x.forecast / x.plan) * 100))}%"></em></div>
    <div class="small">${x.chance ? `<span class="chip ${CHANCE[x.chance]}">вероятность ${x.chance}</span>` : x.partial ? '<span class="chip">оплаты не прочитались — суммы нет</span>' : ''}${x.gap ? ` не хватает ≈${fmt(x.gap / 1e6, 1)} млн ₸` : ''}</div>
    ${gs.limit ? `<div class="small muted" style="margin-top:6px">${esc(gs.limit)}</div>` : ''}</div>`
}

let planArea = ''

const VERDICT = { scale: ['green', 'Масштабировать', 'живой разговор или заявка дешевле среднего по своему типу, и их достаточно'], keep: ['', 'Оставить', 'в норме'], tired: ['amber', 'Наблюдать', 'частота выше 3,5 — аудитория устаёт'], watch: ['amber', 'Наблюдать', 'мало данных для вывода'], empty: ['amber', 'Проверить', 'переписки есть, а живых разговоров (3+ сообщений) нет'], reach: ['', 'Охват', 'цель — охват и подписчики: по перепискам не судим'], off: ['red', 'Остановить', 'расход без результата или в 1,5 раза дороже среднего по своему типу'] }
const AD_KIND = { chat: 'переписки', form: 'форма', other: 'охват' }
// what the ad brought, in its own terms: conversations and live ones, or filled forms
const adResult = (r, cur) => r.kind === 'form' ? [`${fmt(r.leads)} ${plural(r.leads, 'заявка', 'заявки', 'заявок')}`, money(r.cpl, cur), 'за заявку'] : r.kind === 'chat' ? [`${fmt(r.chats)} ${plural(r.chats, 'переписка', 'переписки', 'переписок')} · ${fmt(r.deep)} живых`, money(r.cpq, cur), 'за живой разговор'] : [`${fmt(r.results)}`, '—', '']

function marketingDetail(el) {
  const a = DATA.ads, i = DATA.insta
  if (!a && !i) { el.innerHTML = header('Маркетинг') + '<div class="card empty">Meta не подключена — в офисе ⚙ → Meta.</div>'; return }
  let k = ''
  if (a) {
    k += kpi('Расход за 7 дней', money(a.cur.spend, a.currency), delta(a.cur.spend, a.prev.spend), spark(a.days.map((d) => d.spend)))
    // reach / profile-visit ads are paid for followers, not conversations: their money is never in a conversation's price
    if (a.cur.spendReach || a.prev.spendReach) k += kpi('Реклама на охват/профиль', money(a.cur.spendReach, a.currency), '<span class="small muted">не входит в цену переписки</span>')
    if (a.cur.cpr != null) k += kpi('Цена переписки или заявки', money(a.cur.cpr, a.currency), delta(a.cur.cpr, a.prev.cpr, { lowerIsBetter: true }))
    k += kpi('Переписки', fmt(a.cur.chats), delta(a.cur.chats, a.prev.chats), spark(a.days.map((d) => d.chats)))
    k += kpi('Живые разговоры', `${fmt(a.cur.deep)}${a.cur.live != null ? ` <span class="small muted">${a.cur.live}%</span>` : ''}`, delta(a.cur.deep, a.prev.deep), spark(a.days.map((d) => d.deep)))
    k += kpi('Цена живого разговора', money(a.cur.cpq, a.currency), delta(a.cur.cpq, a.prev.cpq, { lowerIsBetter: true }))
    if (a.cur.leads || a.prev.leads) k += kpi('Заявки из формы', `${fmt(a.cur.leads)} <span class="small muted">по ${money(a.cur.cpl, a.currency)}</span>`, delta(a.cur.leads, a.prev.leads))
    k += kpi('CTR', a.cur.ctr == null ? '—' : `${fmt(a.cur.ctr, 2)}%`, delta(a.cur.ctr, a.prev.ctr))
  }
  if (i) {
    k += kpi('Охват Instagram', fmt(i.cur.reach), delta(i.cur.reach, i.prev.reach))
    k += kpi('Подписчики', fmt(i.followers), i.cur.follows ? `<span class="delta good">+${i.cur.follows}</span>` : '')
  }
  const rows = a?.rows || []
  const linked = rows.some((r) => r.sales != null)
  el.innerHTML = `
    ${header(`Маркетинг`, `Последние 7 дней к предыдущим 7 · ведёт Алия`)}
    <div class="kpis">${k}</div>
    ${a ? (DATA.money ? moneyChain(a) : chainCard(a, DATA.board)) : ''}
    ${a ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Расход и переписки по дням</h2><div class="legend"><span><i style="background:var(--accent)"></i>расход, ${esc(a.currency)}</span><span><i style="background:var(--amber);border-radius:99px"></i>переписки</span></div></div>
      ${bars(a.days.map((d) => ({ ...d, l: day(d.date) })), { value: 'spend', label: 'l', show: (v) => `${fmt(v, v < 10 ? 1 : 0)} ${a.currency === 'USD' ? '$' : a.currency}`, pill: 'results', pillShow: (v) => `${v}`, zero: 'нет показов', avgLabel: 'в среднем', color: 'var(--accent)' })}</section>` : ''}
    ${a ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Объявления за неделю</h2><span class="small muted">в среднем: живой разговор ${money(a.median?.chat, a.currency)}${a.median?.form ? ` · заявка ${money(a.median.form, a.currency)}` : ''}</span></div>
      <div class="table-wrap"><table><thead><tr><th>Объявление</th><th>Тип</th><th class="num">Расход</th><th class="num">Результат</th><th class="num">Цена</th>${linked ? '<th class="num">Продажи</th><th class="num">Окупаемость</th>' : ''}<th class="num">CTR</th><th class="num">Частота</th><th>Вердикт</th></tr></thead><tbody>
      ${rows.map((r) => { const [got, price, unit] = adResult(r, a.currency); return `<tr><td><div class="ad-name">${r.thumb ? `<img class="thumb" src="${esc(r.thumb)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}<div><b>${esc(r.name)}</b><small>${esc(r.campaign)}</small></div></div></td>
        <td class="small">${AD_KIND[r.kind] || ''}</td><td class="num">${money(r.spend, a.currency)}</td><td class="num">${got}</td><td class="num">${price}<div class="small muted">${unit}</div></td>${linked ? `<td class="num">${fmt(r.sales || 0)}</td><td class="num"><b style="color:${r.revenue > r.spend ? 'var(--primary)' : 'var(--red)'}">×${fmt(r.spend ? r.revenue / r.spend : 0, 1)}</b></td>` : ''}<td class="num">${fmt(r.ctr, 2)}%</td><td class="num">${fmt(r.freq, 1)}</td>
        <td><span class="chip ${VERDICT[r.verdict][0]}" title="${esc(VERDICT[r.verdict][2])}">${VERDICT[r.verdict][1]}</span></td></tr>` }).join('') || '<tr><td colspan="8" class="empty">За неделю объявления не крутились.</td></tr>'}
      </tbody></table></div><p class="small muted" style="margin-top:8px">Живой разговор — клиент написал 3 и больше сообщений (Meta считает сама, тексты не видны). Форму-заявку меряем ценой заявки; ${DATA.crm?.ads?.length ? 'какая реклама привела покупателей — в «Продажах», по CRM.' : 'брони и продажи по рекламе станут видны с WhatsApp API или CRM.'}</p></section>` : ''}
    ${a?.more ? adsMore(a.more) : ''}
    <section class="grid split" style="margin-top:16px">
      ${reportCard('marketing', 'Отчёт Алии')}
      <div class="card"><div class="card-head"><h2>Лучшие посты Instagram</h2></div>${i ? postsGrid([...i.posts].sort((p, q) => q.reach - p.reach).slice(0, 4)) : '<div class="empty">Instagram не подключён.</div>'}</div>
    </section>`
}

// promotions and followers, who really talks, placements, video — counted by the office from the night ad archive
const dm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '')
const SRC_CHIP = { meta: ['green', 'Meta'], estimate: ['amber', 'оценка'] }
function adsMore(m) {
  const c = m.currency || ''
  const pc = (v) => (v == null ? '—' : `${v}%`)
  const out = []
  const pr = m.promos?.rows || []
  if (pr.length) {
    const name = (x) => esc(String(x.title || x.name || '').slice(0, 60))
    const tops = [
      m.promos.byFollowers?.[0] ? `Больше всего подписчиков: <b>«${name(m.promos.byFollowers[0])}»</b> — ${fmt(m.promos.byFollowers[0].follows)}` : '',
      m.promos.byCost?.[0] ? `дешевле всего подписчик: <b>«${name(m.promos.byCost[0])}»</b> — ${money(m.promos.byCost[0].cpf, c)}` : '',
    ].filter(Boolean)
    out.push(`<section class="card ads-more" style="margin-top:16px"><div class="card-head"><h2>${icon('person_add')} Продвижения: подписчики с рекламы</h2><span class="small muted">за всё время каждого продвижения</span></div>
      ${tops.length ? `<p class="small" style="margin:0 0 8px">${tops.join('; ')}.</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Продвижение</th><th>Даты</th><th class="num">Расход</th><th class="num">Охват</th><th class="num">В профиль</th><th class="num">Подписчики</th><th class="num">Цена подписчика</th></tr></thead><tbody>
      ${pr.slice(0, 8).map((x) => `<tr><td>${x.post ? `<a href="${esc(x.post)}" target="_blank" rel="noopener">${name(x)}</a>` : name(x)}${x.kind === 'chat' ? '<div class="small muted">реклама на переписки</div>' : ''}</td><td class="small nw">${x.first ? `${dm(x.first)}–${dm(x.last)}` : '—'}</td><td class="num">${money(x.spend, c)}</td><td class="num">${fmt(x.reach)}</td><td class="num">${fmt(x.visits)}${x.visitsSrc === 'clicks' ? '<div class="small muted">по кликам</div>' : ''}</td><td class="num">${x.follows == null ? '<span class="muted">нет данных</span>' : `${fmt(x.follows)} <span class="chip ${SRC_CHIP[x.followsSrc]?.[0] || ''}">${SRC_CHIP[x.followsSrc]?.[1] || ''}</span>`}</td><td class="num">${money(x.cpf, c)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Охват — по кампании, как считает Meta (охваты объявлений не складываются).${pr.some((x) => x.followsSrc === 'estimate') ? ' «Оценка» — посещения профиля × доля «подписались ÷ зашли в профиль» всего аккаунта за те же дни: Meta не даёт подписки по рекламе.' : ''}${m.promos.notes?.length ? ` ${esc(m.promos.notes.filter((t) => !/^подписки с рекламы Meta/.test(t)).map((t) => t[0].toUpperCase() + t.slice(1)).join('. '))}${m.promos.notes.some((t) => !/^подписки с рекламы Meta/.test(t)) ? '.' : ''}` : ''}</p></section>`)
  }
  const pt = m.portrait, rg = m.regions, hr = m.hours
  const left = pt?.chats ? `<div class="card"><div class="card-head"><h2>${icon('forum')} Кто реально разговаривает</h2><span class="small muted">90 дней · реклама на переписки</span></div>
    ${pt.rows.map((g) => `<div class="stat-row"><span class="grow">${esc(g.label)} <span class="small muted">· ${fmt(g.deep)} живых из ${fmt(g.chats)}</span></span><div class="meter" style="width:80px"><i style="width:${Math.max(3, g.shareDeep || 0)}%;background:var(--primary)"></i></div><b>${pc(g.shareDeep)}</b><span class="small muted" style="min-width:76px;text-align:right">${money(g.cpq, c)}</span></div>`).join('')}
    <p class="small muted" style="margin:8px 0 0">Доля — от всех живых разговоров (клиент написал 3+ сообщения), справа — цена живого. ${pt.sex?.length ? `Пол: ${esc(pt.sex.map((g) => `${g.label} — ${g.shareDeep ?? 0}% живых, живой по ${money(g.cpq, c)}`).join('; '))}.` : ''}</p></div>` : ''
  const hourBars = hr?.chats ? (() => { const max = Math.max(1, ...hr.byHour.map((x) => x.chats)); return `<div style="display:flex;align-items:flex-end;gap:2px;height:56px;margin-top:10px" aria-label="Переписки по часам">${hr.byHour.map((x) => `<i title="${x.h}:00 — ${x.chats} переписок${x.work ? '' : ', менеджер не работает'}" style="flex:1;min-width:0;height:${Math.max(2, Math.round((x.chats / max) * 100))}%;border-radius:2px;background:${x.work ? 'var(--accent)' : 'var(--amber)'}"></i>`).join('')}</div><div class="small muted" style="display:flex;justify-content:space-between"><span>0 ч</span><span>12 ч</span><span>23 ч</span></div>` })() : ''
  const right = rg?.chats || hr?.chats ? `<div class="card"><div class="card-head"><h2>${icon('schedule')} Откуда и когда пишут</h2><span class="small muted">90 дней · время Астаны</span></div>
    ${rg?.chats ? `<div class="stat-row"><span class="grow">Астана</span><b>${pc(rg.astana.shareChats)}</b><span class="small muted">переписок · ${pc(rg.astana.shareDeep)} живых</span></div><div class="stat-row"><span class="grow">Другие регионы${rg.rows.find((g) => g.label !== 'Астана') ? ` <span class="small muted">· больше всего ${esc(rg.rows.find((g) => g.label !== 'Астана').label)}</span>` : ''}</span><b>${pc(rg.rest.shareChats)}</b><span class="small muted">переписок · ${pc(rg.rest.shareDeep)} живых</span></div>` : ''}
    ${hr?.chats ? `${hourBars}<div class="legend" style="margin-top:6px"><span><i style="background:var(--accent)"></i>менеджер работает</span><span><i style="background:var(--amber)"></i>не работает</span></div>
      <p class="small" style="margin:8px 0 0">${hr.known ? `Вне часов менеджера (${esc(hr.hours)}) пишут <b>${pc(hr.outside)}</b>, с выходными ≈${pc(hr.outsideWeek)}.` : 'Часы менеджера не заданы.'}${hr.peak?.length ? ` Чаще всего — в ${hr.peak.map((h) => `${h}–${h + 1} ч`).join(', ')}.` : ''}</p>` : ''}</div>` : ''
  if (left || right) out.push(`<section class="grid g2" style="margin-top:16px">${left}${right}</section>`)
  const pl = (m.places?.rows || []).filter((g) => g.chats > 0)
  const vd = m.videos?.rows || []
  const places = pl.length ? `<div class="card ads-more"><div class="card-head"><h2>${icon('view_carousel')} Места показа</h2><span class="small muted">90 дней · реклама на переписки</span></div>
    <div class="table-wrap"><table><thead><tr><th>Место</th><th class="num">Переписок</th><th class="num">Цена переписки</th><th class="num">Цена живого</th></tr></thead><tbody>${pl.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${fmt(g.chats)}</td><td class="num">${money(g.cpc, c)}</td><td class="num">${money(g.cpq, c)}</td></tr>`).join('')}</tbody></table></div></div>` : ''
  const videos = vd.length ? `<div class="card ads-more"><div class="card-head"><h2>${icon('movie')} Видео в рекламе</h2><span class="small muted">крутились за 90 дней</span></div>
    <div class="table-wrap"><table><thead><tr><th>Видео</th><th class="num">Цепляет</th><th class="num">До конца</th><th class="num">Ср. время</th></tr></thead><tbody>${vd.slice(0, 5).map((v) => `<tr><td style="min-width:150px">${esc(String(v.name || '').replace(/^Публикация в Instagram:\s*/i, '').slice(0, 50))}<div class="small muted">${fmt(v.impr)} показов</div></td><td class="num">${pc(v.hook)}</td><td class="num">${pc(v.done)}</td><td class="num">${v.avg == null ? '—' : `${fmt(v.avg, 1)} с`}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin:8px 0 0">Цепляет — сколько показов досмотрели хотя бы 3 секунды; до конца — сколько из них досмотрели видео целиком.</p></div>` : ''
  if (places || videos) out.push(`<section class="grid g2" style="margin-top:16px">${places}${videos}</section>`)
  return out.join('')
}

function postsGrid(posts) {
  const best = Math.max(0, ...posts.map((p) => p.reach))
  return `<div class="posts">${posts.map((p) => `<a class="post" href="${esc(p.link)}" target="_blank" rel="noopener">
    ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.caption.slice(0, 80))}" loading="lazy">` : `<div class="ph">${icon('movie')}</div>`}
    ${p.reach && p.reach === best ? '<span class="chip green best">лучший</span>' : ''}
    <div class="meta"><span>${icon('visibility')} ${fmt(p.reach)}</span><span>${esc(p.type)} · ${day(p.date)}</span></div></a>`).join('') || '<div class="empty">Постов нет.</div>'}</div>`
}

// ---------- three levels: the first screen, the side panel, the full analytics ----------

function openPanel(title, html) {
  let p = $('#sidepanel')
  if (!p) { p = document.createElement('div'); p.id = 'sidepanel'; p.className = 'sidepanel'; document.body.append(p) }
  p.innerHTML = `<div class="sp-backdrop" data-close-panel></div><aside class="sp-body" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sp-head"><h2>${esc(title)}</h2><button class="btn btn-ghost btn-sm" data-close-panel aria-label="Закрыть">${icon('close')}</button></div><div class="sp-content">${html}</div></aside>`
  p.classList.add('open')
  document.body.classList.add('no-scroll')
}
function closePanel() { $('#sidepanel')?.classList.remove('open'); document.body.classList.remove('no-scroll') }
document.addEventListener('click', (ev) => { if (ev.target.closest('[data-close-panel]')) closePanel() })
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePanel() })

const WHY_LEVEL = { critical: 'Если не заняться сейчас, компания может потерять деньги или клиента.', attention: 'Это ухудшает результат, но время на решение есть.', opportunity: 'Здесь можно получить больше при тех же затратах.', positive: 'Это работает — стоит сохранить.' }

const SEC_ICON = { 'Что случилось': 'error', 'Почему': 'help', 'Что сделать': 'task_alt' }

function signalDetail(s) {
  const owner = ME.user.role === 'owner'
  const sec = (t, body) => (body ? `<div class="sp-sec"><div class="sp-label">${SEC_ICON[t] ? `<span class="sec-icon">${icon(SEC_ICON[t])}</span>` : ''}${t}</div>${body}</div>` : '')
  let buttons = ''
  if (owner && s.proposal) buttons = `<button class="btn btn-primary" data-act="yes" data-id="${s.proposal}">Утвердить</button><button class="btn" data-act="no" data-id="${s.proposal}">Не надо</button>`
  else if (owner && s.action) buttons = `<button class="btn btn-primary" data-act="signal-task" data-key="${esc(s.key)}">Утвердить</button><button class="btn" data-act="signal-dismiss" data-key="${esc(s.key)}">Не актуально</button>`
  else if (owner && s.level !== 'positive') buttons = `<button class="btn" data-act="signal-dismiss" data-key="${esc(s.key)}">Не актуально</button>`
  const go = s.section && canSee(s.section) ? `<a class="btn btn-ghost" href="#/${s.section}" data-close-panel>Открыть раздел ${icon('arrow_forward')}</a>` : ''
  return `<span class="tag-line lvl-${s.level}">${(LEVEL[s.level] || [''])[0]}${s.from ? ` · ${esc(NAMES[s.from] || '')}` : ''}</span>
    ${sec('Что случилось', `${s.why ? `<p>${esc(s.why)}</p>` : `<b>${esc(s.what)}</b>`}${s.impact?.text ? `<p class="muted">${esc(s.impact.text.charAt(0).toUpperCase() + s.impact.text.slice(1))}.</p>` : ''}`)}
    ${sec('Почему', s.cause?.text ? `<p><span class="ck ck-${s.cause.kind}">${CAUSE[s.cause.kind] || ''}</span> ${esc(s.cause.text)}</p>` : '<p class="muted">Причину по данным назвать нельзя — нужна проверка.</p>')}
    ${sec('Что сделать', s.action ? `<p><b>${esc(s.action.title)}</b> — ${esc(NAMES[s.action.employee] || '')}${s.action.days ? `, срок ${s.action.days} дн.` : ''}</p>${s.action.expected ? `<p class="muted">Ожидаем: ${esc(s.action.expected)}</p>` : ''}${owner ? '<p class="small muted">«Утвердить» — задача уйдёт исполнителю, результат замерим через 7 дней.</p>' : ''}` : s.owner ? `<p>${esc(s.owner)} — это делаете вы.</p>` : s.proposal ? `<p>${esc(s.what)}</p>` : '<p class="muted">Действий не требуется.</p>')}
    <div class="chips sp-actions">${buttons}${go}</div>`
}

function itemDetail(x) {
  const owner = ME.user.role === 'owner'
  const sec = (t, body) => (body ? `<div class="sp-sec"><div class="sp-label">${t}</div>${body}</div>` : '')
  return `${sec('Задача', `<b>${esc(x.title)}</b>`)}
    ${sec('Почему появилась', `<p>${esc(x.why || '—')}</p><p class="muted">Источник: ${esc(x.source)}</p>`)}
    ${sec('Кто и когда', `<p>${esc(NAMES[x.responsible] || x.responsible)}${x.due ? ` · срок ${day(x.due)}` : ''} · <span class="chip ${STATUS[x.status][1]}">${STATUS[x.status][0]}</span></p>`)}
    ${sec('Чего ждём', x.expected ? `<p>${esc(x.expected)}</p>${x.metric ? `<p class="muted">Показатель: ${esc(x.metric)}${x.base != null ? `, на старте ${fmt(x.base, 2)}` : ''}</p>` : ''}` : '')}
    ${sec('Результат', x.result ? `<p><span class="chip ${VERDICT_RU[x.result.verdict][1]}">${VERDICT_RU[x.result.verdict][0]}</span> ${fmt(x.result.base, 2)} → ${fmt(x.result.value, 2)}</p><p class="muted">${esc(x.result.note)}</p>` : x.status === 'done' && x.metric ? '<p class="muted">Замер — через 7 дней после выполнения.</p>' : '')}
    ${owner && x.status === 'proposed' ? `<div class="chips sp-actions"><button class="btn btn-primary" data-act="yes" data-id="${x.id}">Делать</button><button class="btn" data-act="no" data-id="${x.id}">Не надо</button></div>` : ''}`
}

document.addEventListener('click', (ev) => {
  const s = ev.target.closest('[data-open-signal]')
  if (s) { const sig = (DATA?.signals || []).find((x) => x.key === s.dataset.openSignal); if (sig) openPanel(sig.what, signalDetail(sig)); return }
  const t = ev.target.closest('[data-open-item]')
  if (t) { const it = (DATA?.plan?.items || []).find((x) => x.id === t.dataset.openItem); if (it) openPanel('Задача', itemDetail(it)); return }
  const lv = ev.target.closest('[data-level-signals]')
  if (lv) {
    const list = DATA.signals.filter((x) => x.level === lv.dataset.levelSignals)
    openPanel(`${(LEVEL[lv.dataset.levelSignals] || [''])[0]} · ${list.length}`, `<div class="list">${list.map((x) => `<button class="list-item sp-row" data-open-signal="${esc(x.key)}"><span class="dot lvl-dot-${x.level}"></span><span class="grow"><b>${esc(x.what)}</b><span class="small muted clamp">${esc(x.impact?.text || x.why || '')}</span></span>${icon('chevron_right')}</button>`).join('')}</div>`)
    return
  }
  if (ev.target.closest('[data-all-signals]')) {
    const list = DATA.signals
    openPanel(`Все события и рекомендации · ${list.length}`, `<div class="list">${list.map((x) => `<button class="list-item sp-row" data-open-signal="${esc(x.key)}"><span class="dot lvl-dot-${x.level}"></span><span class="grow"><b>${esc(x.what)}</b><span class="small muted clamp">${esc(x.impact?.text || x.why || '')}</span></span>${icon('chevron_right')}</button>`).join('')}</div>`)
  }
})

function bigKpi(k) {
  const d = k.value != null && k.prev ? Math.round(((k.value - k.prev) / Math.abs(k.prev)) * 100) : null
  const good = d == null || !d || k.neutral ? '' : d > 0 ? 'good' : 'bad'
  const show = k.money ? money(k.value) : k.unit ? money(k.value, k.unit) : fmt(k.value)
  const badge = d == null ? '<span class="small muted">нет сравнения</span>' : `<span class="delta ${good}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d)}%</span>`
  const color = good === 'bad' ? 'var(--red)' : k.neutral ? 'var(--accent)' : 'var(--primary)'
  return `<div class="card kpi big"><div class="kpi-top"><div class="label">${esc(k.label)}</div>${badge}</div><div class="value">${esc(show)}</div>${(k.trend || []).filter((v) => v != null).length > 1 ? `<div class="kpi-spark">${trendLine(k.trend, color)}</div>` : ''}</div>`
}

// ---------- the home page: one phrase, three numbers with a colour, up to three things to do today ----------
// Everything else is one tap away: a tile opens «why this colour», the old signals live behind «Все сигналы».

const ST = { red: 'red', amber: 'amber', green: 'green', grey: '' }
const ym = (s) => (s ? new Date(`${s}-15T12:00:00+05:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' }) : '')
const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const inMonth = (s) => (s ? `в ${MONTH_IN[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)} года` : '')
// a fractional number takes the «few» form: 10,5 месяца, 4,3 квартиры
const pluralF = (v, one, few, many) => (Number.isInteger(Math.round(v * 10) / 10) ? plural(Math.round(v), one, few, many) : few)
const months = (v) => `${fmt(v, 1)} ${pluralF(v, 'месяц', 'месяца', 'месяцев')}`

function homeTile(t) {
  return `<button class="card kpi big home-tile st-${t.status}${t.main ? ' main' : ''}" data-home-tile="${esc(t.key)}" aria-label="${esc(t.name)}: подробнее">
    <div class="kpi-top"><div class="label">${esc(t.name)}</div>${t.word ? `<span class="chip ${ST[t.status] || ''}">${esc(t.word)}</span>` : ''}</div>
    <div class="value">${esc(t.big)}</div><div class="small muted">${esc(t.sub || '')}</div>
    <span class="tile-more small">Почему ${icon('chevron_right')}</span></button>`
}

function homeTasks(h) {
  const owner = ME.user.role === 'owner'
  const rows = h.tasks.map((x) => `<div class="list-item home-task"><span class="dot lvl-dot-${x.sev === 'red' ? 'critical' : 'attention'}"></span>
    <div class="grow"><div class="small muted">${esc(x.who)}</div><b>${esc(x.text)}</b></div>
    ${owner ? `<div class="chips">${x.link && canSee(x.link) ? `<a class="btn btn-sm" href="#/${x.link}">Открыть</a>` : `<button class="btn btn-sm btn-primary" data-act="home-done" data-key="${esc(x.key)}">Сделано</button>`}<button class="btn btn-sm btn-ghost" data-act="home-hide" data-key="${esc(x.key)}">Не актуально</button></div>` : ''}</div>`).join('')
  return `<section class="card home-todo"><div class="card-head"><h2>${icon('task_alt')} Сделать сегодня</h2><span class="small muted">не больше трёх · пропадает само, когда сделано</span></div>
    ${rows ? `<div class="list">${rows}</div>${h.more ? `<p class="small muted" style="margin:8px 0 0">…и ещё ${h.more}: появятся, когда эти будут сделаны.</p>` : ''}` : '<div class="empty">Сегодня спасать нечего ✓ Остальное идёт по плану.</div>'}</section>`
}

function tileDetail(t) {
  const d = t.detail || {}
  const sec = (title, body) => (body ? `<div class="sp-sec"><div class="sp-label">${title}</div>${body}</div>` : '')
  const go = (page, label) => (canSee(page) ? `<div class="chips sp-actions"><a class="btn btn-ghost" href="#/${page}" data-close-panel>${label} ${icon('arrow_forward')}</a></div>` : '')
  if (t.key === 'pace') {
    const whole = d.share >= 1 ? 'все квартиры' : `${Math.round(d.share * 100)}% квартир`
    const ln = d.leadsNeed
    return `<span class="tag-line">${t.word ? `<span class="chip ${ST[t.status] || ''}">${esc(t.word)}</span>` : ''}</span>
      ${sec('Что видно', `<p>Продаём <b>${fmt(d.perMonth, 1)}</b> ${pluralF(d.perMonth, 'квартиру', 'квартиры', 'квартир')} в месяц (${esc(d.period)}). ${d.need != null ? `Чтобы к сдаче (${esc(d.handover)}) продать ${whole}, нужно <b>${fmt(d.need, 1)}</b> в месяц.` : ''}</p>
        <p class="muted">Продано ${d.sold} из ${d.sellable}. Осталось продать ${d.toGo}${d.booked ? `, из них в брони ${d.booked}` : ''}. До сдачи ≈${months(d.monthsLeft)}.</p>`)}
      ${sec('Если ничего не менять', d.toGo ? `<p>${d.lastFlat ? `Последняя квартира уйдёт ≈ <b>${inMonth(d.lastFlat)}</b>.` : 'При нынешнем темпе распродажа не закончится.'} ${d.atHandover ? `К сдаче останется ≈<b>${d.atHandover}</b> ${plural(d.atHandover, 'квартира', 'квартиры', 'квартир')}${d.atHandoverValue ? ` — это ≈${money(d.atHandoverValue)}` : ''}.` : 'К сдаче успеваем.'}</p>${d.atHandover && !d.atHandoverValue ? `<p class="small muted">Сумму не считаю: цены внесены у ${d.leftPriced} из ${d.left} непроданных квартир.</p>` : ''}` : '<p>Цель к сдаче уже выполнена.</p>')}
      ${ln ? sec('Сколько обращений нужно', `<p>Сейчас на одну продажу приходится ≈${ln.perSale} ${plural(ln.perSale, 'переписка', 'переписки', 'переписок')} из рекламы. Чтобы успеть, нужно ≈<b>${ln.needChats}</b> переписок в месяц, сейчас ≈${ln.haveChats}.</p>${ln.extraSpend ? `<p>Это ещё ≈<b>${money(ln.extraSpend, ln.currency)}</b> рекламы в месяц${ln.extraKzt ? ` (≈${money(ln.extraKzt)} по курсу Нацбанка ${fmt(ln.fx.usd, 2)} ₸ на ${day(ln.fx.date)})` : ''}. Решение о бюджете — за вами.</p>` : ''}<p class="small muted">Грубая оценка: не все продажи пришли из рекламы, а за 8 недель продаж мало. Точнее станет, когда CRM начнёт передавать ссылку на рекламу.</p>`) : ''}
      ${sec('Продажи по неделям', d.weeks?.length ? bars(d.weeks.map((w) => ({ ...w, l: day(w.to) })), { value: 'sales', label: 'l', show: (v) => fmt(v), zero: 'нет продаж', avgLabel: 'в среднем' }) : '')}
      ${go('revenue', 'Открыть Выручку')}`
  }
  if (t.key === 'money') {
    const fc = d.forecast != null ? `<p>Прогноз на конец месяца: <b>${money(d.forecast)}</b>${d.plan ? ` при плане ${money(d.plan)}` : ''}.</p>` : ''
    return `<span class="tag-line">${t.word ? `<span class="chip ${ST[t.status] || ''}">${esc(t.word)}</span>` : ''}</span>
      ${sec('Получено', d.unavailable ? `<p>Сумму не показываю: ${esc(d.unavailable)}. Без оплат квартиры «Продана» считались бы целиком в день продажи — это не полученные деньги.</p>` : `<p>С 1-го числа пришло <b>${money(d.fact)}</b>.</p>${cashSplit(d.cash)}${d.extra?.length ? `<p class="small muted">Отдельно, вне шахматки (в эту сумму и план не входит): ${d.extra.map((x) => `${money(x.amount)} — ${esc(x.label || 'поступление')}`).join('; ')}.</p>` : ''}`)}
      ${sec('До конца месяца', `${fc}<p class="muted">${d.restOfMonth ? `По графикам рассрочек до конца месяца ещё придёт ≈${money(d.restOfMonth)}.` : 'По графикам рассрочек до конца месяца платежей нет.'}${d.plan ? '' : ' Плана на месяц нет: его предлагает Нурлан, утверждаете вы.'}</p><p class="small muted">До 10-го числа цвет серый: одна полная оплата может перевернуть весь месяц.</p>`)}
      ${sec('Следующие месяцы', d.nextMonths?.length ? `<div class="list">${d.nextMonths.map((m) => `<div class="list-item"><span class="grow">${esc(ym(m.month))}</span><b>${money(m.planned)}</b></div>`).join('')}</div><p class="small muted">Только платежи по графикам рассрочек. Новые продажи добавятся сверху.</p>` : '')}
      ${sec('Просрочки', d.overdue?.length ? `<div class="list">${d.overdue.map((x) => `<div class="list-item"><span class="grow">кв. ${esc(x.n)}${x.since ? ` <span class="small muted">с ${day(x.since)}</span>` : ''}</span><b>${money(x.amount)}</b></div>`).join('')}</div><p class="small muted">Сначала проверьте, внесена ли оплата в шахматку: просрочка бывает, когда платёж пришёл, а его ещё не вписали.</p>` : '')}
      ${go('plan', 'Цели месяца')}`
  }
  if (t.key === 'leads') {
    const wk = (d.weeks || []).slice().reverse()
    const weeks = d.kind === 'crm'
      ? bars(wk.map((w, i) => ({ v: w.count, l: i === wk.length - 1 ? 'эта' : `−${wk.length - 1 - i} нед.`, partial: !w.full })).filter((x, i) => i === wk.length - 1 || !x.partial || x.v), { value: 'v', label: 'l', show: (v) => fmt(v), zero: '0', avgLabel: 'в среднем', color: 'var(--accent)' })
      : bars((d.weeks || []).map((v, i, a) => ({ v, l: i === a.length - 1 ? 'эта' : `−${a.length - 1 - i} нед.` })), { value: 'v', label: 'l', show: (v) => fmt(v), zero: '0', avgLabel: 'в среднем', color: 'var(--accent)' })
    return `<span class="tag-line">${t.word ? `<span class="chip ${ST[t.status] || ''}">${esc(t.word)}</span>` : ''}</span>
      ${sec('По неделям', `${weeks}${d.kind === 'crm' && d.since ? `<p class="small muted">CRM ведётся с ${day(d.since)}${d.fewWeeks ? ' — пока за спиной меньше двух полных недель, «обычной недели» нет и цвет серый' : ''}.</p>` : ''}`)}
      ${d.kind === 'crm' ? sec('Откуда за неделю', d.sources?.length ? `<div class="list">${d.sources.map(([k, v]) => `<div class="list-item"><span class="grow">${esc(k)}</span><b>${v}</b></div>`).join('')}</div>` : '<p class="muted">За неделю новых нет.</p>') : ''}
      ${d.kind === 'crm' && d.nonTarget?.of ? sec('Нецелевые', `<p>${d.nonTarget.pct}% обращений за месяц менеджер отметил «Не целевой» (${d.nonTarget.n} из ${d.nonTarget.of}). Считаю только обращения старше 3 дней: свежие ещё не разобраны.</p>`) : ''}
      ${d.chats != null || d.deep != null ? sec('Реклама за неделю', `<p>Переписок из рекламы: <b>${fmt(d.chats ?? 0)}</b>, из них живых разговоров (клиент написал 3+ сообщения): <b>${fmt(d.deep ?? 0)}</b>${d.cpq ? `, живой разговор стоит ${money(d.cpq, d.currency)}` : ''}.</p>`) : ''}
      ${go('sales', 'Открыть Продажи')}`
  }
  return ''
}

// «Данные: шахматка ✓ 10:02 · Meta ✓ · CRM ⚠ 5 ч назад»: where the numbers come from and how fresh they are;
// a tap (or hover) says what went wrong, in plain words
const SRC_CLASS = { ok: 'ok', fail: 'bad', stale: 'warn', unknown: '' }
function sourcesLine(list) {
  if (!list?.length) return ''
  return `<div class="src-line small" role="group" aria-label="Откуда данные и насколько они свежие"><span>Данные:</span>${list.map((x) => `<button type="button" class="src ${SRC_CLASS[x.state] || ''}" data-src="${esc(x.id)}" title="${esc(x.text)}" aria-expanded="false">${esc(x.name)} ${esc(x.label)}</button>`).join('<span class="src-sep" aria-hidden="true">·</span>')}</div>
    <div class="src-why small" hidden></div>`
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-src]')
  if (!b) return
  const box = b.closest('.src-line')?.nextElementSibling
  const x = (DATA?.sources || []).find((s) => s.id === b.dataset.src)
  if (!box || !x) return
  const open = b.getAttribute('aria-expanded') === 'true'
  b.parentElement.querySelectorAll('[data-src]').forEach((e) => e.setAttribute('aria-expanded', 'false'))
  box.hidden = open
  box.className = `src-why small ${SRC_CLASS[x.state] || ''}`
  box.textContent = x.text
  if (!open) b.setAttribute('aria-expanded', 'true')
})

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-home-tile]')
  if (!el) return
  const t = (DATA?.home?.tiles || []).find((x) => x.key === el.dataset.homeTile)
  if (t) { openPanel(t.name, tileDetail(t)); paintCharts() }
})

function homeView(el) {
  const owner = ME.user.role === 'owner'
  const h = DATA.home
  const wp = DATA.plan?.weekPlan
  const n = (DATA.signals || []).length
  el.innerHTML = `
    ${header(`${greeting()}, ${esc(ME.user.name)}`, `Данные на ${when(new Date(DATA.at).toISOString())}`)}
    ${sourcesLine(DATA.sources)}
    ${h.phrase ? `<div class="card headline"><span class="hl-icon">${icon('insights')}</span><p>${esc(h.phrase)}</p></div>` : ''}
    <section class="kpis home-tiles" style="margin-top:18px">${h.tiles.map(homeTile).join('')}</section>
    ${homeTasks(h)}
    ${wp && owner ? `<a class="card banner" href="#/plan">${icon('event_note')}<span class="grow"><b>Диас прислал план недели</b><span class="small muted"> · ${wp.items.length} дел — утвердите</span></span>${icon('arrow_forward')}</a>` : ''}
    <div class="home-foot small muted">${h.gaps?.length ? `<span>Чего не хватает данным: ${esc(h.gaps.join(' · '))}</span>` : ''}${n ? `<button class="btn btn-sm btn-ghost" data-all-signals>Все сигналы и рекомендации · ${n}</button>` : ''}</div>
    ${owner && !ME.demo ? `<form class="card ask" id="ask" style="margin-top:20px"><textarea name="text" rows="1" placeholder="Поручение руководителю… например: «Подготовь пост про ход строительства»" aria-label="Поручение руководителю"></textarea><button class="btn btn-primary">${icon('send')} Отправить</button></form>` : ''}`
  const form = $('#ask')
  if (form) form.onsubmit = async (ev) => {
    ev.preventDefault()
    const text = form.text.value.trim()
    if (!text) return
    try { await api('/p/ask', { text }); form.text.value = ''; toast('Руководитель получил поручение — план придёт в Telegram') } catch (e) { toast(e.message) }
  }
}

function overview(el) {
  if (DATA.home?.tiles?.length) return homeView(el)
  const owner = ME.user.role === 'owner'
  const top = DATA.top || { kpis: [], text: '' }
  const wp = DATA.plan?.weekPlan
  const col = ([level, title, empty]) => {
    const list = DATA.signals.filter((s) => s.level === level)
    return `<div class="card home-col col-${level}"><div class="card-head"><h2 class="col-title"><span class="dot lvl-dot-${level}"></span>${title}</h2>${list.length ? `<span class="count">${list.length}</span>` : ''}</div>
      <div class="list">${list.slice(0, 4).map((s) => `<button class="list-item sp-row" data-open-signal="${esc(s.key)}"><span class="dot lvl-dot-${level}"></span><span class="grow"><b>${esc(s.what)}</b>${s.impact?.text ? `<span class="small muted clamp">${esc(s.impact.text)}</span>` : ''}</span>${icon('chevron_right')}</button>`).join('') || `<div class="empty">${empty}</div>`}</div>
      ${list.length > 4 ? `<button class="btn btn-sm btn-ghost" data-level-signals="${level}">Ещё ${list.length - 4}</button>` : ''}</div>`
  }
  el.innerHTML = `
    ${header(`${greeting()}, ${esc(ME.user.name)}`, `Состояние бизнеса ${esc(top.period || '')} · данные на ${when(new Date(DATA.at).toISOString())}`)}
    <section class="kpis kpis-4">${top.kpis.map(bigKpi).join('')}</section>
    ${top.text ? `<div class="card headline"><span class="hl-icon">${icon('insights')}</span><p>${esc(top.text)}</p></div>` : ''}
    ${wp && owner ? `<a class="card banner" href="#/plan">${icon('event_note')}<span class="grow"><b>Диас прислал план недели</b><span class="small muted"> · ${wp.items.length} дел — утвердите</span></span>${icon('arrow_forward')}</a>` : ''}
    <section class="grid g3" style="margin-top:20px">${[['critical', 'Критично', 'Срочного нет 👍'], ['attention', 'Обратить внимание', 'Всё в норме'], ['opportunity', 'Возможности', 'Пока нечего усилить']].map(col).join('')}</section>
    <p class="small muted" style="margin-top:8px">Нажмите на строку — откроется: что случилось, почему и что сделать.</p>
    ${owner && !ME.demo ? `<form class="card ask" id="ask" style="margin-top:20px"><textarea name="text" rows="1" placeholder="Поручение руководителю… например: «Подготовь пост про ход строительства»" aria-label="Поручение руководителю"></textarea><button class="btn btn-primary">${icon('send')} Отправить</button></form>` : ''}`
  const form = $('#ask')
  if (form) form.onsubmit = async (ev) => {
    ev.preventDefault()
    const text = form.text.value.trim()
    if (!text) return
    try { await api('/p/ask', { text }); form.text.value = ''; toast('Руководитель получил поручение — план придёт в Telegram') } catch (e) { toast(e.message) }
  }
}

// ---------- plan: goal and progress, 4 counters, 3 priorities; the rest in tabs ----------

let planTab = 'tasks'

function planPage(el) {
  const p = DATA.plan
  if (!p) { el.innerHTML = header('План') + '<div class="card empty">Нет доступа.</div>'; return }
  const owner = ME.user.role === 'owner'
  const order = ['Маркетинг', 'Продажи', 'Выручка', 'SMM', 'Монтаж', 'Управление', 'Другое']
  const present = order.filter((x) => p.items.some((i) => i.area === x))
  if (planArea && !present.includes(planArea)) planArea = ''
  const shown = p.items.filter((x) => x.status !== 'declined' && (!planArea || x.area === planArea))
  const COLS = ['proposed', 'approved', 'in_work', 'done', 'measured']
  const count = (k) => p.items.filter((x) => x.status === k).length
  const card = (x) => `<div class="kcard" data-open-item="${x.id}" role="button" tabindex="0">
    <div class="kcard-top"><span class="chip">${esc(x.area)}</span>${x.due ? `<span class="small muted">до ${day(x.due)}</span>` : ''}</div>
    <b>${esc(x.title)}</b>
    <div class="kcard-who">${avatar(x.responsible)}<span class="small">${esc(NAMES[x.responsible] || x.responsible)}</span></div>
    ${x.result ? `<span class="chip ${VERDICT_RU[x.result.verdict][1]}">${VERDICT_RU[x.result.verdict][0]}</span>` : ''}
  </div>`
  const prio = p.items.filter((x) => ['in_work', 'approved', 'proposed'].includes(x.status)).sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9'))).slice(0, 3)
  const g = p.goal || p.goalProposal
  const f = p.fact || {}
  const TABS = [['tasks', 'Все задачи'], ['signals', 'Проблемы и возможности'], ['goals', 'Цели месяца'], ['memory', 'История решений']]
  const tabBody = {
    tasks: () => `<div class="chips" style="margin-bottom:12px"><button class="chip ${!planArea ? 'on' : ''}" data-area="">Все направления</button>${present.map((x) => `<button class="chip ${planArea === x ? 'on' : ''}" data-area="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      ${shown.length ? `<div class="kanban">${COLS.map((k) => { const list = shown.filter((x) => x.status === k); return `<div class="kcol kcol-${k}"><div class="kcol-head"><span class="chip ${STATUS[k][1]}">${STATUS[k][0]}</span><b>${list.length}</b></div>${list.map(card).join('') || '<div class="kempty small muted">пусто</div>'}</div>` }).join('')}</div>` : '<div class="empty">Задач за 30 дней нет.</div>'}`,
    signals: () => `<div class="grid g2">
      <div><h3 style="margin-bottom:8px">Проблемы · ${p.problems.length}</h3><div class="list">${p.problems.map((s) => `<button class="list-item sp-row" data-open-signal="${esc(s.key)}"><span class="dot lvl-dot-${s.level}"></span><span class="grow"><b>${esc(s.what)}</b>${s.impact?.text ? `<span class="small">${esc(s.impact.text)}</span>` : ''}</span>${icon('chevron_right')}</button>`).join('') || '<div class="empty">Проблем не видно 👍</div>'}</div></div>
      <div><h3 style="margin-bottom:8px">Возможности · ${p.chances.length}</h3><div class="list">${p.chances.map((s) => `<button class="list-item sp-row" data-open-signal="${esc(s.key)}"><span class="dot lvl-dot-${s.level}"></span><span class="grow"><b>${esc(s.what)}</b></span>${icon('chevron_right')}</button>`).join('') || '<div class="empty">Пока нечего усилить.</div>'}</div></div></div>`,
    goals: () => goalsCard(DATA.goals, true),
    memory: () => memoryCard(DATA.memory),
  }
  el.innerHTML = `
    ${header('План', 'Что мы должны сделать и как выполняем')}
    ${weekPlanCard(p.weekPlan)}
    <section class="card plan-head">
      <div class="grow">
        <div class="sp-label">План на неделю</div>
        ${g ? `<div class="plan-goal">Цель: <b>${g.sales} ${plural(g.sales, 'продажа', 'продажи', 'продаж')} · ${g.bookings} ${plural(g.bookings, 'бронь', 'брони', 'броней')}</b>${p.goal ? '' : ' <span class="chip amber">предложено Нурланом</span>'}</div>
          <div class="plan-goal">Прогресс: <b>${f.sales || 0} ${plural(f.sales || 0, 'продажа', 'продажи', 'продаж')} · ${f.bookings || 0} ${plural(f.bookings || 0, 'бронь', 'брони', 'броней')}</b> <span class="small muted">с ${day(f.from)}</span></div>
          <div class="chips" style="margin-top:8px">${p.goalProposal && owner ? `<button class="btn btn-sm btn-primary" data-act="yes" data-id="${p.goalProposal.id}">Утвердить цель</button>` : ''}${g.why ? `<button class="btn btn-sm btn-ghost" data-why-plan>Почему такой план?</button>` : ''}</div>`
          : `<div class="plan-goal muted">Цели на неделю ещё нет.</div>${owner ? '<button class="btn btn-sm" data-act="goal-ask" style="margin-top:8px">Попросить Нурлана</button>' : ''}`}
      </div>
      <div class="counters">${[['proposed', 'Предложено'], ['in_work', 'В работе'], ['done', 'Выполнено'], ['measured', 'Результат измерен']].map(([k, l]) => `<div class="counter"><b>${count(k) + (k === 'in_work' ? count('approved') : 0)}</b><span>${l}</span></div>`).join('')}</div>
    </section>
    <section style="margin-top:16px"><div class="card-head"><h2>Приоритетные задачи</h2></div>
      ${prio.length ? `<div class="events">${prio.map((x, i) => `<div class="event event-task"><div class="event-num">${i + 1}</div>${avatar(x.responsible)}<div class="grow"><b class="event-title">${esc(x.title)}</b>
        <div class="small muted">${esc(NAMES[x.responsible] || x.responsible)}${x.due ? ` · срок ${day(x.due)}` : ''}</div></div>
        <span class="chip ${STATUS[x.status][1]}">${STATUS[x.status][0]}</span>
        <div class="chips"><button class="btn btn-sm" data-open-item="${x.id}">Открыть</button>${owner && x.status === 'proposed' ? `<button class="btn btn-sm btn-primary" data-act="yes" data-id="${x.id}">Делать</button>` : ''}</div></div>`).join('')}</div>` : '<div class="card empty">Открытых задач нет — всё выполнено или ждёт плана недели.</div>'}
    </section>
    <section class="card" style="margin-top:16px">
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" class="tab ${planTab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="tab-body">${tabBody[planTab]()}</div>
    </section>`
  el.querySelectorAll('[data-area]').forEach((x) => (x.onclick = () => { planArea = x.dataset.area; planPage(el) }))
  el.querySelectorAll('[data-tab]').forEach((x) => (x.onclick = () => { planTab = x.dataset.tab; planPage(el) }))
  const why = el.querySelector('[data-why-plan]')
  if (why) why.onclick = () => openPanel('Почему такой план?', `<p>${esc(g.why)}</p><p class="muted small">Считал Нурлан по темпу продаж, броням в работе и рекламе.</p>`)
}

// ---------- marketing, sales, revenue: a short first screen, the full analytics by a button ----------

const more = { marketing: false, sales: false, revenue: false }

function moreBlock(page, label, render) {
  return { html: `<div class="more-btn"><button class="btn" data-more-page="${page}">${more[page] ? icon('expand_less') + ' Скрыть подробности' : `${label} ${icon('arrow_forward')}`}</button></div><div class="detail-wrap" id="more-${page}"></div>`, render }
}

function wireMore(el, page, render, rerender) {
  const box = el.querySelector(`#more-${page}`)
  if (more[page] && box) { CHARTS.length = 0; render(box); paintCharts() }
  el.querySelector(`[data-more-page="${page}"]`)?.addEventListener('click', () => { more[page] = !more[page]; rerender(el); if (more[page]) el.querySelector(`#more-${page}`)?.scrollIntoView({ behavior: 'smooth' }) })
}

function marketing(el) {
  const a = DATA.ads
  if (!a) { marketingDetail(el); return }
  // judged by the price of a live conversation (3+ messages): a cheap empty chat is not a client
  const d = a.prev.cpq && a.cur.cpq ? Math.round(((a.cur.cpq - a.prev.cpq) / a.prev.cpq) * 100) : null
  const l = a.prev.deep ? Math.round(((a.cur.deep - a.prev.deep) / a.prev.deep) * 100) : null
  // with a CRM every ad is judged by what it really brought: sales and money back
  const linked = a.rows.some((r) => r.sales != null)
  const back = (r) => (r.spend ? (r.revenue || 0) / r.spend : 0)
  const rows = linked ? a.rows.filter((r) => r.spend) : a.rows.filter((r) => r.cpq)
  const best = linked ? [...rows].sort((x, y) => back(y) - back(x))[0] : [...rows].sort((x, y) => x.cpq - y.cpq)[0]
  const worst = linked ? [...rows].sort((x, y) => back(x) - back(y))[0] : a.rows.find((r) => r.verdict === 'off' && r.kind === 'chat') || [...rows].sort((x, y) => y.cpq - x.cpq)[0]
  const sold = a.rows.reduce((t, r) => t + (r.sales || 0), 0), got = a.rows.reduce((t, r) => t + (r.revenue || 0), 0)
  const text = linked
    ? `Реклама за 7 дней: ${money(a.cur.spend, a.currency)} → ${sold} ${plural(sold, 'продажа', 'продажи', 'продаж')} на ${money(got)}. Лучше всех окупается «${best.name}» (×${fmt(back(best), 1)})${back(worst) < 1 ? `, а «${worst.name}» не принесла ни одной продажи` : ''}.`
    : d == null ? 'Мало данных для сравнения недель.' : `Живой разговор (клиент написал 3+ сообщения) ${d > 0 ? 'подорожал' : 'подешевел'} на ${Math.abs(d)}%${l != null ? `, а живых разговоров стало ${l >= 0 ? 'больше' : 'меньше'} на ${Math.abs(l)}%` : ''}.${a.cur.leads ? ` Заявок из формы — ${a.cur.leads} по ${money(a.cur.cpl, a.currency)}.` : ''}${DATA.crm?.ads?.length ? ' Какая реклама привела покупателей — в «Продажах».' : ' Кто из них купил, станет видно с WhatsApp API или CRM.'}`
  const reach = a.cur.spendReach ? ` На охват и посещения профиля — ${money(a.cur.spendReach, a.currency)}: эта реклама на подписчиков, в цену переписки не входит.` : ''
  // why ads stand still, in Meta's words: a stopped account, a spend cap, a rejected ad
  const acc = a.account, bad = a.problems || []
  const stop = acc?.grace ? 'Рекламный кабинет Meta: оплата не прошла — реклама ещё идёт, но Meta остановит её, если не оплатить.' : acc && !acc.active ? `Рекламный кабинет Meta: ${acc.reason} — реклама не показывается.` : acc?.capReached ? 'Исчерпан лимит расходов кабинета Meta — реклама остановлена.' : bad.length ? `${bad[0].what}: «${bad[0].name}»${bad[0].why ? ` — ${bad[0].why}` : ''}${bad.length > 1 ? ` (и ещё ${bad.length - 1})` : ''}.` : ''
  const got1 = (r) => (r.kind === 'form' ? `${r.leads} ${plural(r.leads, 'заявка', 'заявки', 'заявок')}` : `${r.chats} ${plural(r.chats, 'переписка', 'переписки', 'переписок')}, живых ${r.deep}`)
  const adCard = (title, r, tone, tip) => (r ? `<div class="card ad-pick ${tone}"><div class="sp-label">${title}</div><div class="ad-name">${r.thumb ? `<img class="thumb" src="${esc(r.thumb)}" alt="" loading="lazy">` : ''}<div><b>${esc(r.name.replace(/^Публикация в Instagram:\s*/i, ''))}</b><small>${got1(r)}${linked ? ` · ${r.sales} ${plural(r.sales, 'продажа', 'продажи', 'продаж')}` : ''} · ${money(r.spend, a.currency)}</small></div></div>${linked ? `<div class="big-num">×${fmt(back(r), 1)} <span class="small muted">окупаемость</span></div>` : `<div class="big-num">${money(r.cpq, a.currency)} <span class="small muted">за живой разговор</span></div>`}${tip ? `<div class="small">${tip}</div>` : ''}</div>` : '')
  const m = moreBlock('marketing', 'Подробная аналитика рекламы', marketingDetail)
  el.innerHTML = `
    ${header('Маркетинг', 'Эффективность рекламы за 7 дней · ведёт Алия')}
    <section class="kpis kpis-4">
      ${bigKpi({ label: 'Расход', value: a.cur.spend, prev: a.prev.spend, unit: a.currency, neutral: true })}
      ${bigKpi({ label: 'Живые разговоры', value: a.cur.deep, prev: a.prev.deep })}
      <div class="card kpi big"><div class="kpi-top"><div class="label">Цена живого разговора</div>${d == null ? '' : `<span class="delta ${d > 0 ? 'bad' : 'good'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`}</div><div class="value">${money(a.cur.cpq, a.currency)}</div></div>
      ${a.cur.leads || a.prev.leads ? `<div class="card kpi big"><div class="kpi-top"><div class="label">Заявки из формы</div></div><div class="value">${fmt(a.cur.leads)}</div><span class="small muted">по ${money(a.cur.cpl, a.currency)} за заявку</span></div>` : `<div class="card kpi big"><div class="kpi-top"><div class="label">Доля живых</div></div><div class="value">${a.cur.live == null ? '—' : `${a.cur.live}%`}</div><span class="small muted">из ${fmt(a.cur.chats)} переписок</span></div>`}
    </section>
    ${stop ? `<div class="card headline"><span class="hl-icon" style="color:var(--red)">${icon('error')}</span><p><b>${esc(stop)}</b> Исправить в Ads Manager.</p></div>` : ''}
    <div class="card headline"><span class="hl-icon">${icon('insights')}</span><p>${esc(text + reach)}</p></div>
    <section class="grid g2" style="margin-top:16px">
      ${adCard('Лучшее объявление', best, 'good', '')}
      ${worst && worst !== best ? adCard('Проблемное объявление', worst, 'bad', linked && back(worst) < 1 ? 'Деньги уходят без продаж — перевести бюджет в то, что окупается.' : 'Рекомендация: проверить перед дальнейшим расходом бюджета.') : ''}
    </section>
    ${m.html}`
  wireMore(el, 'marketing', marketingDetail, marketing)
}

function sales(el) {
  const b = DATA.board
  if (!b && DATA.crm?.cur.lead_quality) { salesCrm(el); return }
  if (!b) { salesDetail(el); return }
  const w0 = b.weeks.at(-1)
  const st = b.status
  const problem = DATA.signals.find((s) => s.section === 'sales' && (s.level === 'critical' || s.level === 'attention'))
  const fresh = (b.changes || []).find((c) => ['Продана', 'Рассрочка'].includes(c.to))
  const m = moreBlock('sales', 'Воронка, шахматка и клиенты', salesDetail)
  el.innerHTML = `
    ${header('Продажи', `Результаты за 7 дней · ${esc(b.complex)} · ведёт Ерлан`)}
    <section class="kpis kpis-4">
      ${bigKpi({ label: 'Продажи', value: w0.sales, prev: b.weeks.at(-2).sales })}
      ${bigKpi({ label: 'Брони', value: w0.bookings, prev: b.weeks.at(-2).bookings })}
      <div class="card kpi big"><div class="label">Свободные квартиры</div><div class="value">${fmt(st['Свободна'] || 0)}</div><span class="small muted">из ${b.total}</span></div>
      <div class="card kpi big"><div class="label">Проблемные сделки</div><div class="value">${b.stale.length}</div><span class="small muted">бронь дольше недели</span></div>
    </section>
    <section class="grid g2" style="margin-top:16px">
      <div class="card"><div class="sp-label">Главная проблема</div>${problem ? `<b>${esc(problem.what)}</b><p class="small" style="margin:6px 0">${esc(problem.impact?.text || problem.why || '')}</p><button class="btn btn-sm" data-open-signal="${esc(problem.key)}">Подробнее</button>` : '<p class="muted">Проблем не видно 👍</p>'}</div>
      <div class="card"><div class="sp-label">Главная хорошая новость</div>${fresh ? `<b>Кв. ${fresh.n}: ${esc(fresh.from || '—')} → ${esc(fresh.to)}</b><p class="small muted" style="margin:6px 0">${esc(fresh.at)}</p>` : '<p class="muted">За последнее время новых продаж нет.</p>'}</div>
    </section>
    <div class="chips" style="margin-top:16px"><button class="btn" data-jump="Воронка продаж">${icon('filter_alt')} Воронка продаж</button><button class="btn" data-jump="Шахматка">${icon('grid_view')} Шахматка</button><button class="btn" data-jump="Клиенты под угрозой">${icon('warning')} Клиенты под угрозой</button></div>
    ${m.html}`
  wireMore(el, 'sales', salesDetail, sales)
  el.querySelectorAll('[data-jump]').forEach((x) => (x.onclick = () => {
    if (!more.sales) { more.sales = true; sales(el) }
    const h = [...el.querySelectorAll('#more-sales h2')].find((n) => n.textContent.includes(x.dataset.jump))
    h?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }))
}


const CASH_PARTS = { booking: 'Брони', first: 'Первые взносы', installment: 'Рассрочка', full: 'Полные оплаты' }
const cashSplit = (s) => (s && s.revenue ? `<div class="rev-split">${Object.entries(CASH_PARTS).filter(([k]) => s[k]).map(([k, l]) => `<span class="small"><span class="muted">${l}:</span> <b>${money(s[k])}</b></span>`).join('')}</div>` : '')
const extraNote = (b) => (b.cash?.extra?.length ? `<div class="small muted" style="margin-top:6px">Отдельно, вне шахматки (в выручку и сравнения не входит): ${b.cash.extra.map((x) => `${money(x.amount)} — ${esc(x.label || 'поступление')} (${day(x.date)})`).join('; ')}</div>` : '')
const unfilledNote = (b) => (!b.cash?.linked ? '<div class="small muted" style="margin-top:6px">Шахматка не ответила (оплаты) — суммы посчитаны по ценам проданных квартир на день продажи, это не полученные деньги (могут быть завышены).</div>' : b.cash.unfilled.length ? `<div class="small muted" style="margin-top:6px">Не внесены оплаты: кв. ${b.cash.unfilled.map((x) => x.n).join(', ')} — их деньги не вошли. Внесите бронь, взнос и платежи в шахматке.</div>` : '')

function revenue(el) {
  const b = DATA.board
  if (!b && DATA.money) { revenueMoney(el); return }
  if (!b) { revenueDetail(el); return }
  const P = b.periods.month
  const c = P.cur, p = P.prev
  const d = !p.partial && p.revenue ? Math.round(((c.revenue - p.revenue) / p.revenue) * 100) : null
  const avg = c.sales - c.noPrice ? c.contract / (c.sales - c.noPrice) : null
  const risk = (DATA.losses || []).filter((x) => x.amount && ['Долгие брони'].includes(x.title)).reduce((t, x) => t + x.amount, 0)
  const forecast = b.revenue.forecastWeeks ? (b.revenue.forecastWeeks > 52 ? `${fmt(b.revenue.forecastWeeks / 52, 1)} г.` : `${fmt(b.revenue.forecastWeeks / 4.3, 1)} мес.`) : '—'
  const ch = DATA.change
  const risks = (DATA.losses || []).filter((x) => x.amount && x.level !== 'empty' && !/заморож|не продаются/i.test(`${x.title} ${x.note || ''}`)).slice(0, 3)
  const m = moreBlock('revenue', 'Подробный анализ выручки', revenueDetail)
  el.innerHTML = `
    ${header('Выручка', 'Деньги, реально полученные за 4 недели, к предыдущим 4 · ведёт Нурлан')}
    <section class="card rev-hero"><div class="small muted">Получено денег</div><div class="value">${money(c.revenue)}</div>${d != null ? `<span class="delta ${d >= 0 ? 'good' : 'bad'}">${d >= 0 ? 'рост' : 'снижение'} на ${Math.abs(d)}% к предыдущим четырём неделям</span>` : ''}${cashSplit(c.cash)}${extraNote(b)}${unfilledNote(b)}</section>
    <section class="kpis kpis-4" style="margin-top:12px">
      <div class="card kpi big"><div class="label">Продано по договорам</div><div class="value">${money(c.contract)}</div><span class="small muted">${c.sales} ${plural(c.sales, 'сделка', 'сделки', 'сделок')} — полная цена квартир</span></div>
      <div class="card kpi big"><div class="label">Придёт за 30 дней</div><div class="value">${money(b.cash.next30)}</div><span class="small muted">по графикам рассрочек${b.cash.overdue ? ` · просрочено ${money(b.cash.overdue)}` : ''}</span></div>
      <div class="card kpi big"><div class="label">Средний чек</div><div class="value">${avg ? money(avg) : '—'}</div></div>
      <div class="card kpi big"><div class="label">Под риском</div><div class="value">${risk ? money(risk) : '—'}</div><span class="small muted">сделки в долгих бронях</span></div>
    </section>
    <section class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Почему изменилась выручка?</h2></div>
        ${ch?.factors.length ? ch.factors.map((f) => `<div class="factor ${f.amount > 0 ? 'up' : f.amount < 0 ? 'down' : ''}"><span>${f.amount > 0 ? '+' : f.amount < 0 ? '−' : '·'}</span><div class="grow"><b>${esc(f.label)}</b></div><b>${f.amount > 0 ? '+' : f.amount < 0 ? '−' : ''}${fmt(Math.abs(f.amount) / 1e6, 1)} млн ₸</b></div>`).join('') : '<p class="muted">Оплат не было.</p>'}
        <p class="small muted" style="margin:8px 0 0">Разложение по видам платежей: сколько добавила или убавила каждая часть. Оно не доказывает, какие действия вызвали рост.</p></div>
      <div class="card"><div class="card-head"><h2>Где финансовые риски?</h2></div>
        ${risks.length ? `<div class="list">${risks.map((x) => `<div class="list-item"><span class="dot lvl-dot-${x.level}"></span><div class="grow"><b>${esc(x.title)}</b><div class="small muted">${esc(x.text)}</div></div><b class="loss-sum">${x.currency ? money(x.amount, x.currency) : money(x.amount)}</b></div>`).join('')}</div>` : '<p class="muted">Рисков не видно.</p>'}
        <p class="small muted" style="margin:8px 0 0">Сумма зависшей брони — это сделка под риском, а не гарантированная потеря. Непроданные квартиры не считаются потерянной выручкой.</p></div>
    </section>
    ${m.html}`
  wireMore(el, 'revenue', revenueDetail, revenue)
}

// ---------- sales: the CRM level above the chessboard ----------

function stageBar(steps) {
  const max = Math.max(1, ...steps.filter((s) => s.count != null).map((s) => s.count))
  return `<div class="stages" style="--n:${steps.length}">${steps.map((s, i) => `<div class="stage ${s.count == null ? 'na' : ''}">
    <div class="stage-top"><span>${esc(s.label)}</span>${s.conv != null ? `<span class="small muted">${s.conv}% от пред.</span>` : ''}</div>
    <div class="stage-bar"><i style="width:${s.count == null ? 0 : Math.max(2, (s.count / max) * 100)}%"></i><b>${s.count == null ? 'CRM' : fmt(s.count)}</b></div>
    ${s.note ? `<div class="small muted">${esc(s.note)}</div>` : ''}
  </div>${i < steps.length - 1 ? '' : ''}`).join('')}</div>`
}

function miniBlock(title, body, empty) {
  return `<div class="card mini ${empty ? 'empty-card' : ''}"><div class="card-head"><h3>${title}</h3>${empty ? '<span class="chip">CRM</span>' : ''}</div>${body}</div>`
}

// whom to call: CRM lead numbers only, never names or phones
function leadIds(ids, total, note = '') {
  if (!ids?.length) return '<div class="small muted">из лидов за 28 дней</div>'
  return `<div class="small muted">из лидов за 28 дней${note ? ` · ${note}` : ''}</div><div class="small" style="margin-top:4px">в CRM: ${ids.slice(0, 12).map((x) => `№${esc(x)}`).join(', ')}${total > Math.min(12, ids.length) ? ` и ещё ${total - Math.min(12, ids.length)}` : ''}</div>`
}

function crmSection(b) {
  const c = DATA.crm
  const w0 = b.weeks.at(-1)
  let steps, blocks
  if (c) {
    steps = c.cur.funnel.map((s, i) => ({ ...s, note: c.prev.funnel[i].count ? `было ${c.prev.funnel[i].count}` : '' }))
    blocks = [
      miniBlock('Причины отказов', c.cur.refusals.length ? `<div class="list">${c.cur.refusals.slice(0, 5).map(([k, v]) => `<div class="list-item"><span class="grow">${esc(k)}</span><b>${v}</b></div>`).join('')}</div>` : '<div class="empty">Отказов нет.</div>'),
      miniBlock('Лиды без следующего действия', `<div class="big-num">${c.cur.noNext}</div>${leadIds(c.cur.noNextIds, c.cur.noNext)}`),
      miniBlock('Просроченные действия', `<div class="big-num">${c.cur.overdue}</div>${leadIds(c.cur.overdueIds, c.cur.overdue, 'сначала самые давние')}`),
      miniBlock('Скорость первого ответа', `<div class="big-num">${c.cur.replyMedianMin == null ? '—' : c.cur.replyMedianMin < 1 ? 'меньше минуты' : `${c.cur.replyMedianMin} мин`}</div><div class="small muted">обычно (медиана)${c.cur.slowReplies ? ` · ждали дольше 2 часов: <b>${c.cur.slowReplies}</b>` : ''}</div>`),
      miniBlock('Клиенты для реактивации', `<div class="big-num">${c.cur.reactivate}</div><div class="small muted">отказались после показа</div>`),
      miniBlock('Эффективность менеджеров', `<div class="list">${c.cur.managers.map((m) => `<div class="list-item"><span class="grow">${esc(m.name)}<span class="small muted" style="display:block">${m.replyMin == null ? '' : `первый ответ ${m.replyMin} мин`}</span></span><span class="small">${m.leads} лидов → ${m.bookings} купили${m.conv == null ? '' : ` · ${m.conv}%`}</span></div>`).join('')}</div>`),
      miniBlock('Где теряем клиентов', c.cur.lostAfter.length ? `<div class="list">${c.cur.lostAfter.slice(0, 5).map(([k, v]) => `<div class="list-item"><span class="grow">после этапа «${esc(k)}»</span><b>${v}</b></div>`).join('')}</div>` : '<div class="empty">Отказов нет.</div>'),
      c.who ? miniBlock('Откуда приходят покупатели', `<div class="list">${c.who.sources.slice(0, 6).map((x) => `<div class="list-item"><span class="grow">${esc(x.key)}<span class="small muted" style="display:block">${x.leads} лидов</span></span><b>${x.bought}</b><span class="small muted">&nbsp;${x.conv == null ? '' : `${x.conv}%`}</span></div>`).join('')}</div><div class="small muted">купили (бронь или продажа), за всё время</div>`) : '',
      c.who && (c.who.gender.length || c.who.age.length) ? miniBlock('Кто покупает', `<div class="list">${[...c.who.gender, ...c.who.age].filter((x) => x.leads >= 3).map((x) => `<div class="list-item"><span class="grow">${esc(x.key)}<span class="small muted" style="display:block">${x.leads} лидов → ${x.bought} купили</span></span><b>${x.conv == null ? '—' : `${x.conv}%`}</b></div>`).join('')}</div><div class="small muted">доля купивших в группе, за всё время</div>`) : '',
    ].filter(Boolean)
  } else {
    const a = DATA.ads
    steps = [
      { label: 'Лиды', count: a ? a.cur.results : null, note: a ? 'переписки из рекламы Meta за 7 дней — не все лиды' : '' },
      { label: 'Связались', count: null }, { label: 'Квалифицированы', count: null }, { label: 'Показ назначен', count: null }, { label: 'Показ проведён', count: null },
      { label: 'Бронь', count: w0.bookings, note: 'шахматка, 7 дней' }, { label: 'Продажа', count: w0.sales, note: 'шахматка, 7 дней' },
    ]
    const back = b.unbooked30 || []
    blocks = [
      miniBlock('Причины отказов', '<p class="small muted">Менеджер отмечает причину в CRM — здесь появится топ причин.</p>', true),
      miniBlock('Лиды без следующего действия', '<p class="small muted">Нужна дата следующего шага у каждого клиента.</p>', true),
      miniBlock('Просроченные действия', '<p class="small muted">Звонки и встречи, которые не сделали вовремя.</p>', true),
      miniBlock('Скорость первого ответа', '<p class="small muted">Время от заявки до ответа менеджера.</p>', true),
      miniBlock('Клиенты для реактивации', back.length ? `<div class="list">${back.map((x) => `<div class="list-item"><b>Кв. ${x.n}</b><span class="grow small muted">${x.r ? `${x.r}-комн., ` : ''}бронь снята ${day(x.at)}</span></div>`).join('')}</div><p class="small muted">По шахматке: брони, снятые за 30 дней. Причины — с CRM.</p>` : '<div class="empty">Сорванных броней за 30 дней нет.</div>'),
      miniBlock('Эффективность менеджеров', '<p class="small muted">Лиды → показы → продажи по каждому менеджеру.</p>', true),
    ]
  }
  const old = c?.fresh?.stale ? `<span class="chip amber" title="${esc(c.fresh.error || '')}">CRM не обновлялась ${c.fresh.ageH == null ? 'давно' : c.fresh.ageH < 1 ? 'с последней попытки' : `${fmt(c.fresh.ageH, 0)} ч`} — цифры могут быть старыми</span>` : ''
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('filter_alt')} Воронка продаж</h2>${c ? `${old}<span class="small muted">28 дней к предыдущим 28</span>` : '<span class="chip amber">CRM не подключена — серые этапы появятся с ней</span>'}</div>${stageBar(steps)}</section>
    <section class="mini-grid" style="margin-top:16px">${blocks.join('')}</section>
    ${c?.ads?.length ? adsToBuyers(c.ads) : ''}`
}

// which ads brought the buyers: from the CRM (ad of each lead) and Алия's archive (spend of each ad)
function adsToBuyers(list) {
  const cur = list.find((a) => a.currency)?.currency || ''
  const unit = cur === 'USD' ? '$' : cur
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('campaign')} Какая реклама привела покупателей</h2><span class="small muted">за всё время, по CRM</span></div>
    <div class="table-wrap"><table><thead><tr><th>Объявление</th><th class="num">Лиды</th><th class="num">Брони</th><th class="num">Продажи</th><th class="num">Сумма продаж</th><th class="num">Расход</th><th class="num">Расход на продажу</th></tr></thead>
    <tbody>${list.map((a) => `<tr><td>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)}${a.ads > 1 ? `<span class="small muted" style="display:block">в ${a.ads} объявлениях</span>` : ''}</td><td class="num">${fmt(a.leads)}</td><td class="num">${fmt(a.bookings)}</td><td class="num"><b>${fmt(a.sales)}</b></td><td class="num">${a.revenue ? money(a.revenue) : '—'}</td><td class="num">${a.spend == null ? '—' : `${fmt(a.spend)} ${esc(unit)}`}</td><td class="num">${a.spend && a.sales ? `${fmt(Math.round(a.spend / a.sales))} ${esc(unit)}` : '—'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin:8px 0 0">Расход — за всё время объявления, из рекламного кабинета; сумма продаж — по сделкам в CRM.</p></section>`
}

// ---------- a business with a CRM and no chessboard ----------

function salesCrm(el) {
  const c = DATA.crm.cur, p = DATA.crm.prev
  const deals = c.funnel.at(-1).count, dealsPrev = p.funnel.at(-1).count
  const conv = (f) => (f[0].count ? Math.round((f.at(-1).count / f[0].count) * 100) : null)
  const q = c.lead_quality
  const refTotal = c.refusals.reduce((t, [, n]) => t + n, 0) || 1
  const row = (label, share, color) => `<div class="stat-row"><span class="grow">${esc(label)}</span><div class="meter" style="width:120px"><i style="width:${share}%;background:${color}"></i></div><b>${share}%</b></div>`
  el.innerHTML = `
    ${header('Продажи', 'Воронка из CRM за 4 недели к предыдущим 4 · ведёт Ерлан')}
    <section class="kpis kpis-4">
      ${bigKpi({ label: 'Обращения', value: c.leads, prev: p.leads })}
      ${bigKpi({ label: 'Сделки', value: deals, prev: dealsPrev })}
      <div class="card kpi big"><div class="label">Конверсия в сделку</div><div class="value">${conv(c.funnel) ?? '—'}%</div><span class="small muted">было ${conv(p.funnel) ?? '—'}%</span></div>
      <div class="card kpi big"><div class="label">Первый ответ</div><div class="value">${c.replyMedianMin ?? '—'} мин</div><span class="small muted">обычно, от заявки до ответа</span></div>
    </section>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('filter_alt')} Воронка продаж</h2><span class="small muted">где теряются клиенты</span></div>${stageBar(c.funnel.map((s, i) => ({ ...s, note: p.funnel[i] ? `было ${p.funnel[i].count}` : '' })))}</section>
    <section class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>${icon('verified')} Качество лидов</h2></div>
        ${row('Качественные — готовы обсуждать покупку', q.good, 'var(--primary)')}${row('Пустые — не отвечают или не целевые', 100 - q.good, 'var(--red)')}
        <p class="small muted" style="margin:8px 0 0">${esc(q.note || '')}</p></div>
      <div class="card"><div class="card-head"><h2>${icon('block')} Причины отказов</h2></div>
        ${c.refusals.map(([k, n]) => row(k, Math.round((n / refTotal) * 100), 'var(--amber)')).join('')}</div>
      <div class="card"><div class="card-head"><h2>${icon('star')} Кто покупает лучше</h2></div>
        <div class="list">${(c.best || []).map((x) => `<div class="list-item"><span class="dot lvl-dot-opportunity"></span><div class="grow"><b>${esc(x.title)}</b><div class="small muted">${esc(x.note || '')}</div></div></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h2>${icon('groups')} Менеджеры</h2></div>
        <div class="list">${c.managers.map((m) => `<div class="list-item"><span class="grow"><b>${esc(m.name)}</b><div class="small muted">${m.leads} обращений → ${m.sales} сделок · ${m.leads ? Math.round((m.sales / m.leads) * 100) : 0}%${m.replyMin != null ? ` · ответ за ${m.replyMin} мин` : ''}</div></span></div>`).join('')}</div></div>
    </section>`
}

function revenueMoney(el) {
  const m = DATA.money
  const d = m.prev ? Math.round(((m.received - m.prev) / m.prev) * 100) : null
  const back = m.spend ? m.fromAds / m.spend : null
  el.innerHTML = `
    ${header('Выручка', 'Сколько потратили — и сколько получили · 4 недели к предыдущим 4 · ведёт Нурлан')}
    <section class="card rev-hero"><div class="small muted">Получено денег</div><div class="value">${money(m.received)}</div>${d != null ? `<span class="delta ${d >= 0 ? 'good' : 'bad'}">${d >= 0 ? 'рост' : 'снижение'} на ${Math.abs(d)}% к предыдущим четырём неделям</span>` : ''}</section>
    <section class="card" style="margin-top:12px"><div class="chain">${[['Потратили на рекламу', money(m.spend)], ['Получили от клиентов из рекламы', money(m.fromAds)], ['Каждый тенге рекламы вернул', back ? `${fmt(back, 1)} ₸` : '—']].map(([l, v]) => `<div class="chain-step fact"><div class="small muted">${l}</div><b>${v}</b></div>`).join(`<span class="chain-arrow">${icon('arrow_forward')}</span>`)}</div></section>
    <section class="kpis kpis-4" style="margin-top:12px">
      <div class="card kpi big"><div class="label">Сделки</div><div class="value">${fmt(m.sales)}</div></div>
      <div class="card kpi big"><div class="label">Средний чек</div><div class="value">${money(m.sales ? m.received / m.sales : 0)}</div></div>
      <div class="card kpi big"><div class="label">Стоимость клиента</div><div class="value">${money(m.salesFromAds ? m.spend / m.salesFromAds : 0)}</div><span class="small muted">расход на рекламу / продажи из рекламы</span></div>
      <div class="card kpi big"><div class="label">Ожидается оплат</div><div class="value">${money(m.expected30)}</div><span class="small muted">в ближайшие 30 дней</span></div>
    </section>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('payments')} Потратили → получили, по каждому каналу</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Канал</th><th class="num">Потратили</th><th class="num">Продажи</th><th class="num">Получили</th><th class="num">Окупаемость</th></tr></thead><tbody>
      ${m.channels.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td class="num">${money(c.spend)}</td><td class="num">${fmt(c.sales)}</td><td class="num">${money(c.revenue)}</td><td class="num"><b style="color:${c.revenue > c.spend ? 'var(--primary)' : 'var(--red)'}">×${fmt(c.spend ? c.revenue / c.spend : 0, 1)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Окупаемость — сколько тенге выручки принёс каждый тенге рекламы. Меньше ×1 — реклама не окупилась.</p></section>`
}

function moneyChain(a) {
  const c = DATA.crm.cur, m = DATA.money
  const steps = [['Расход', money(m.spend, a.currency)], ['Обращения', fmt(c.leads)], ['Качественные', fmt(Math.round((c.leads * c.lead_quality.good) / 100))], ['Сделки', fmt(c.funnel.at(-1).count)], ['Выручка', money(m.fromAds)]]
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('conversion_path')} От расхода до выручки · 4 недели</h2></div>
    <div class="chain">${steps.map(([l, v]) => `<div class="chain-step fact"><div class="small muted">${l}</div><b>${v}</b></div>`).join(`<span class="chain-arrow">${icon('arrow_forward')}</span>`)}</div></section>`
}

// ---------- marketing: the chain from spend to revenue ----------

function chainCard(a, b) {
  const w0 = b?.weeks.at(-1)
  const cost = (v) => (v ? money(a.cur.spend / v, a.currency) : '—')
  const steps = [
    ['Расход', money(a.cur.spend, a.currency), '', 'fact'],
    ['Лид (переписка)', fmt(a.cur.results), `${a.cur.cpr != null ? money(a.cur.cpr, a.currency) : cost(a.cur.results)} за лид${a.cur.spendReach ? ' (без рекламы на охват)' : ''}`, 'fact'],
    ...(DATA.crm ? [['Живой разговор', fmt(a.cur.deep), `${a.cur.cpq != null ? money(a.cur.cpq, a.currency) : cost(a.cur.deep)} за разговор${a.cur.cpq != null && a.cur.spendReach ? ' (только реклама на переписки)' : ''}`, 'fact']] : [['Квал. лид', 'CRM', 'стоимость квал. лида', 'empty'], ['Показ', 'CRM', 'стоимость показа', 'empty']]),
    ['Бронь', w0 ? fmt(w0.bookings) : '—', w0?.bookings ? `≈${cost(w0.bookings)} за бронь` : '', 'link'],
    ['Продажа', w0 ? fmt(w0.sales) : '—', w0?.sales ? `≈${cost(w0.sales)} за продажу` : '', 'link'],
    ['Выручка', w0 ? money(w0.revenue) : '—', DATA.crm ? 'по шахматке' : 'ROMI — с CRM', 'link'],
  ]
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('conversion_path')} От расхода до выручки · 7 дней</h2></div>
    <div class="chain">${steps.map(([l, v, sub, kind]) => `<div class="chain-step ${kind}"><div class="small muted">${l}</div><b>${v}</b>${sub ? `<div class="small">${sub}</div>` : ''}</div>`).join(`<span class="chain-arrow">${icon('arrow_forward')}</span>`)}</div>
    <p class="small muted" style="margin:10px 0 0"><span class="ck ck-fact">Факт</span> расход и переписки из Meta. <span class="ck ck-link">Наблюдаемая связь</span> брони и продажи — все по шахматке, не только из рекламы, поэтому цена брони и продажи — грубая верхняя оценка. ${DATA.crm?.ads?.length ? 'Продажи по каждому объявлению — в «Продажах», по CRM.' : 'С CRM вердикт по объявлению будет учитывать продажи, а не только дешёвые переписки.'}</p></section>`
}

// ---------- SMM: what content works ----------

function statsCard(s) {
  if (!s) return ''
  const table = (title, rows, note) => `<div><h3 style="margin-bottom:8px">${title}</h3>${rows.length ? rows.map((r) => `<div class="stat-row"><span class="grow">${esc(r.name)} <span class="small muted">· ${r.posts} публ.</span></span><div class="meter" style="width:90px"><i style="width:${Math.min(100, Math.round((r.reach / Math.max(...rows.map((x) => x.reach), 1)) * 100))}%;background:${r.reach >= s.base ? 'var(--primary)' : 'var(--amber)'}"></i></div><b>${fmt(r.reach)}</b></div>`).join('') : '<div class="small muted">мало публикаций</div>'}${note ? `<div class="small muted" style="margin-top:6px">${note}</div>` : ''}</div>`
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('insights')} Что работает в контенте</h2><span class="small muted">средний охват по ${s.posts} последним публикациям: ${fmt(s.base)}</span></div>
    <div class="grid g3">${table('Форматы', s.formats)}${table('Темы', s.topics, 'Темы определены по словам в подписи — ориентир. Алия размечает темы в контент-плане точнее.')}${table('Объекты', s.objects)}</div>
    <div class="chain" style="margin-top:16px">${['Публикация', 'Рекламный креатив', 'Лид', 'Продажа', 'Выручка'].map((x, i) => `<div class="chain-step ${i ? 'empty' : 'fact'}"><b>${x}</b>${i ? `<div class="small muted">${DATA.crm ? 'ждём ссылку на рекламу в CRM' : 'с CRM'}</div>` : ''}</div>`).join(`<span class="chain-arrow">${icon('arrow_forward')}</span>`)}</div>
    <p class="small muted" style="margin:8px 0 0">Сейчас контент оценивается по охвату. ${DATA.crm ? 'CRM подключена, но пока не передаёт, с какого поста или объявления пришёл клиент (попросили разработчиков CRM). Когда начнёт' : 'Когда CRM будет знать, с какого поста или креатива пришёл клиент'}, здесь появится «какой контент приводит качественные обращения и продажи».</p></section>`
}

function salesDetail(el) {
  const b = DATA.board
  if (!b) { el.innerHTML = header('Продажи') + '<div class="card empty">Шахматка не подключена — в офисе ⚙ → «Шахматка: портал».</div>'; return }
  const [w1, w0] = b.weeks.slice(-2)
  const st = b.status
  const sold = (st['Продана'] || 0) + (st['Рассрочка'] || 0)
  const stale = new Set(b.stale.map((x) => x.n))
  const cls = (s) => (s === 'Свободна' ? 's-free' : s === 'Бронь' ? 's-book' : ['Продана', 'Рассрочка'].includes(s) ? 's-sold' : 's-other')
  const entrances = [...new Set(b.flats.map((f) => f.e))].sort((p, q) => p - q)
  const boardHtml = entrances.map((e) => {
    const flats = b.flats.filter((f) => f.e === e)
    const floors = [...new Set(flats.map((f) => f.f))].sort((p, q) => p - q)
    return `<div class="entrance"><h3>Подъезд ${esc(e ?? '—')}</h3><div class="floors">${floors.map((fl) => `<div class="floor"><span class="fl">${fl}</span>${flats.filter((f) => f.f === fl).sort((p, q) => p.n - q.n).map((f) => `<button class="flat ${cls(f.st)}${stale.has(f.n) ? ' stale' : ''}" data-flat="${f.n}" aria-label="Квартира ${f.n}, ${esc(f.st)}">${f.n}</button>`).join('')}</div>`).join('')}</div></div>`
  }).join('')
  el.innerHTML = `
    ${header('Продажи', `${esc(b.complex)} · ведёт Ерлан`)}
    <div class="kpis">
      ${kpi('Свободно', fmt(st['Свободна'] || 0), `<span class="small muted">из ${b.total}</span>`)}
      ${kpi('Бронь', fmt(st['Бронь'] || 0), b.stale.length ? `<span class="delta bad">${b.stale.length} дольше недели</span>` : '')}
      ${kpi('Продано', fmt(sold), `<span class="small muted">${Math.round((sold / b.total) * 100)}% дома</span>`)}
      ${kpi('Броней за неделю', fmt(w0.bookings), delta(w0.bookings, w1.bookings), spark(b.weeks.map((x) => x.bookings)))}
      ${kpi('Продаж за неделю', fmt(w0.sales), delta(w0.sales, w1.sales), spark(b.weeks.map((x) => x.sales)))}
    </div>
    ${crmSection(b)}
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Шахматка</h2><div class="legend"><span><i style="background:#1e956b"></i>свободна</span><span><i style="background:var(--amber)"></i>бронь</span><span><i style="background:#9aa6b5"></i>продана</span><span><i style="background:var(--blue)"></i>не в продаже</span><span><i style="background:var(--red);border-radius:50%"></i>бронь &gt; 7 дней</span></div></div>
      <div class="board">${boardHtml}</div><div class="flat-info muted" id="flatInfo">Нажмите на квартиру, чтобы увидеть детали.</div></section>
    <section class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>${icon('warning')} Клиенты под угрозой</h2><span class="chip red">${b.stale.length}</span></div>
        <div class="list">${b.stale.map((x) => `<div class="list-item"><span class="chip amber">${x.days} дн.</span><div class="grow"><b>Кв. ${x.n}</b> · ${x.r}-комн., ${fmt(x.m2, 1)} м², этаж ${x.f}<div class="small muted">в брони с ${day(x.since)} — нужен звонок менеджера</div></div></div>`).join('') || '<div class="empty">Все брони свежие 👍</div>'}</div></div>
      <div class="card"><div class="card-head"><h2>Последние изменения</h2></div>
        <div class="list">${b.changes.slice(0, 8).map((c) => `<div class="list-item"><b style="min-width:58px">Кв. ${c.n}</b><div class="grow small">${esc(c.from || '—')} → <b>${esc(c.to)}</b><div class="muted">${esc(c.at)}</div></div></div>`).join('')}</div></div>
    </section>
    <section style="margin-top:16px">${reportCard('sales', 'Отчёт Ерлана: вопросы, возражения, ответы менеджеру')}</section>`
  el.querySelector('.board').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-flat]')
    if (!btn) return
    const f = b.flats.find((x) => String(x.n) === btn.dataset.flat)
    $('#flatInfo').innerHTML = `<b>Кв. ${f.n}</b> · ${f.r}-комн. · ${fmt(f.m2, 1)} м² · этаж ${f.f} · <b>${esc(f.st)}</b>${f.since ? ` с ${day(f.since)}` : ''}${f.price ? ` · ${money(f.price)} (${fmt(f.ppm)} ₸/м²)` : ' · цена не внесена'}`
  })
}

const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many }

const PERIOD_RU = { week: 'Неделя', month: 'Месяц (4 нед.)', quarter: 'Квартал (13 нед.)' }
let revPeriod = 'month'

// with the CRM connected: where the money came from, which ads and which managers brought it
function crmRevenueBlocks() {
  const c = DATA.crm
  if (!c?.who && !c?.ads?.length && !c?.cur?.managers?.length) return ''
  const row = (name, right, sub = '') => `<div class="list-item"><span class="grow">${esc(name)}${sub ? `<span class="small muted" style="display:block">${sub}</span>` : ''}</span><b>${right}</b></div>`
  const cur = c.ads?.find((a) => a.currency)?.currency || ''
  const unit = cur === 'USD' ? '$' : cur
  const sources = (c.who?.sources || []).filter((x) => x.bought)
  const ads = (c.ads || []).filter((x) => x.sales)
  const people = (c.cur?.managers || []).filter((x) => x.name !== 'не указан')
  return `<div class="card"><div class="card-head"><h2>Источники выручки</h2><span class="small muted">по CRM</span></div><div class="list">${sources.map((x) => row(x.key, x.revenue ? money(x.revenue) : `${x.bought}`, `${x.bought} ${plural(x.bought, 'покупка', 'покупки', 'покупок')} из ${x.leads} лидов`)).join('') || '<div class="empty">Покупок с источником пока нет.</div>'}</div></div>
    <div class="card"><div class="card-head"><h2>Выручка по рекламе</h2><span class="small muted">по CRM</span></div><div class="list">${ads.map((x) => row(x.name, x.revenue ? money(x.revenue) : `${x.sales}`, `${x.sales} ${plural(x.sales, 'продажа', 'продажи', 'продаж')}${x.spend ? ` · расход ${fmt(x.spend)} ${esc(unit)}` : ''}`)).join('') || '<div class="empty">Продаж с рекламой пока нет — CRM начнёт привязывать их по ссылке из первого сообщения.</div>'}</div></div>
    <div class="card"><div class="card-head"><h2>Выручка по менеджерам</h2><span class="small muted">28 дней</span></div><div class="list">${people.map((x) => row(x.name, `${x.bookings} ${plural(x.bookings, 'покупка', 'покупки', 'покупок')}`, `${x.leads} лидов · конверсия ${x.conv ?? 0}%`)).join('')}</div></div>`
}

function emptyBlock(title, need, items = []) {
  return `<div class="card empty-card"><div class="card-head"><h2>${title}</h2><span class="chip">нет данных</span></div>
    <p class="small muted" style="margin:0 0 10px">${esc(need)}</p>
    ${items.length ? `<div class="chips">${items.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}</div>`
}

function lossesList(list) {
  if (!list?.length) return '<div class="empty">Потерь не видно.</div>'
  return `<div class="list">${list.map((x) => `<div class="list-item loss lvl-${x.level}">
    <span class="dot lvl-dot-${x.level === 'empty' ? 'none' : x.level}"></span>
    <div class="grow"><b>${esc(x.title)}</b> ${x.kind && x.kind !== 'empty' ? `<span class="ck ck-${x.kind}">${CAUSE[x.kind]}</span>` : ''}<div class="small muted">${esc(x.text)}${x.note ? ` · ${esc(x.note)}` : ''}</div></div>
    <b class="loss-sum">${x.amount ? (x.currency ? money(x.amount, x.currency) : money(x.amount)) : x.level === 'empty' ? '<span class="muted small">CRM</span>' : '<span class="muted small">не посчитать</span>'}</b>
    ${x.section && x.section !== 'revenue' && canSee(x.section) ? `<a class="btn btn-sm btn-ghost" href="#/${x.section}" aria-label="Подробнее">${icon('arrow_forward')}</a>` : ''}
  </div>`).join('')}</div>`
}

function revenueDetail(el) {
  const b = DATA.board
  if (!b) { el.innerHTML = header('Выручка') + '<div class="card empty">Шахматка не подключена.</div>'; return }
  const r = b.revenue
  const kr = DATA.krisha || []
  const P = b.periods[revPeriod]
  const c = P.cur, p = P.prev
  const avg = (x) => (x.sales - x.noPrice ? x.contract / (x.sales - x.noPrice) : null)
  const goal = DATA.weekGoal && revPeriod === 'week' ? DATA.weekGoal : null
  const groupTable = (g) => `<table><thead><tr><th></th><th class="num">Всего</th><th class="num">Свободно</th><th class="num">Продано</th><th style="width:34%">Доля свободных</th></tr></thead><tbody>
    ${Object.entries(g).sort((x, y) => y[1].free / y[1].total - x[1].free / x[1].total).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td class="num">${v.total}</td><td class="num">${v.free}</td><td class="num">${v.sold}</td><td><div class="meter"><i style="width:${Math.round((v.free / v.total) * 100)}%"></i></div><span class="small muted">${Math.round((v.free / v.total) * 100)}%</span></td></tr>`).join('')}</tbody></table>`
  const forecast = r.forecastWeeks ? (r.forecastWeeks > 52 ? `${fmt(r.forecastWeeks / 52, 1)} г.` : `${fmt(r.forecastWeeks / 4.3, 1)} мес.`) : '—'
  const k = (label, cur, prev, show, extra = '') => kpi(label, show(cur), (prev != null ? delta(cur, prev) : '') + extra)
  const totalRooms = b.revenueByRooms.reduce((t, x) => t + x.revenue, 0) || 1
  el.innerHTML = `
    ${header('Выручка', 'Сердце системы: сколько денег, откуда, почему изменилось и где теряем · ведёт Нурлан')}
    <div class="chips" style="margin-bottom:14px">${Object.keys(PERIOD_RU).map((x) => `<button class="chip ${x === revPeriod ? 'on' : ''}" data-period="${x}">${PERIOD_RU[x]}</button>`).join('')}
      <span class="small muted" style="align-self:center">${day(c.from)} – ${day(c.to)} к ${day(p.from)} – ${day(p.to)}${p.partial ? ' · журнал статусов ведётся с ' + day(b.since) + ', прошлый период неполный' : ''}</span></div>
    <div class="kpis kpis-top">
      ${k('Выручка (получено)', c.revenue, p.partial ? null : p.revenue, (v) => money(v), goal?.revenue ? `<span class="small muted">план ${money(goal.revenue)}</span>` : '')}
      ${k('Продано по договорам', c.contract, p.partial ? null : p.contract, (v) => money(v), '<span class="small muted">полная цена проданных квартир</span>')}
      ${kpi('Придёт по рассрочкам', money(b.cash.planned), `<span class="small muted">за 30 дней — ${money(b.cash.next30)}</span>`)}
      ${k('Продажи', c.sales, p.partial ? null : p.sales, (v) => fmt(v), goal ? `<span class="small muted">план ${goal.sales}</span>` : '')}
      ${k('Средний чек', avg(c), p.partial ? null : avg(p), (v) => (v ? money(v) : '—'))}
      ${k('Сорвано броней', c.unbooked, null, (v) => fmt(v), '<span class="small muted">бронь → свободна</span>')}
      ${kpi('Темп продаж', `${fmt(r.pace, 1)} <span class="small muted">в неделю</span>`, '<span class="small muted">среднее за 4 недели</span>')}
      ${kpi('Прогноз распродажи', forecast, `<span class="small muted">${fmt(b.status['Свободна'] || 0)} кв., ${fmt(r.freeM2)} м²</span>`)}
      ${kpi('Остаток дома', b.potential ? money(b.potential) : '—', '<span class="small muted">оценка по ценам свободных квартир</span>')}
    </div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Из чего выручка</h2><span class="small muted">${PERIOD_RU[revPeriod]}</span></div>${cashSplit(c.cash) || '<p class="muted">Оплат в этом периоде нет.</p>'}${unfilledNote(b)}</section>
    ${b.priced < b.total ? `<div class="signal lvl-attention" style="margin-top:16px"><span class="tag">Точность</span><b>Цены внесены у ${b.priced} из ${b.total} квартир</b><p>Сумма договоров и средний чек считаются только по квартирам с ценой${c.noPrice ? ` — в этом периоде без цены ${c.noPrice} ${plural(c.noPrice, 'продажа', 'продажи', 'продаж')}` : ''}. Внесите цены в шахматку — расчёты станут точнее.</p></div>` : ''}
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Динамика по неделям</h2><div class="legend"><span><i style="background:var(--primary)"></i>выручка (получено денег)</span><span><i style="background:var(--amber);border-radius:99px"></i>продано квартир</span></div></div>
      ${bars(b.history.map((x) => ({ ...x, l: day(x.to) })), { value: 'revenue', label: 'l', show: (v) => (v >= 1e6 ? `${fmt(v / 1e6, 1)} млн` : v ? `${fmt(v / 1e3)} тыс.` : '0'), pill: 'sales', pillShow: (v) => `${v} кв`, avgLabel: 'среднее', zero: 'нет оплат' })}
      <p class="small muted" style="margin:6px 0 0">Рамкой выделена лучшая неделя, пунктир — средняя выручка. История — с начала журнала статусов (${day(b.since)}).</p></section>
    <section class="grid split" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>${icon('money_off')} Где мы теряем деньги</h2></div>${lossesList(DATA.losses)}</div>
      <div class="card"><div class="card-head"><h2>${icon('query_stats')} Почему изменилась выручка</h2></div>${changeCard(DATA.change)}</div>
    </section>
    <section class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Разложение: тип квартиры</h2><span class="small muted">все продажи с ценой</span></div>
        ${b.revenueByRooms.length ? b.revenueByRooms.map((x) => `<div class="goal-row" style="margin-bottom:10px"><div class="goal-top"><b>${esc(x.key)}</b><span>${money(x.revenue)} <span class="muted small">· ${x.count} кв · ${fmt(x.revenue / x.m2)} ₸/м²</span></span></div><div class="meter"><i style="width:${Math.round((x.revenue / totalRooms) * 100)}%;background:var(--primary)"></i></div></div>`).join('') : '<div class="empty">Продаж с ценой нет.</div>'}
        <p class="small muted">Объект: ${esc(b.complex)}.</p></div>
      <div class="card"><div class="card-head"><h2>Сделки периода</h2><span class="chip">${c.deals.length}</span></div>
        ${c.deals.length ? `<div class="table-wrap"><table><thead><tr><th>Кв.</th><th>Тип</th><th class="num">м²</th><th class="num">Сумма</th><th class="num">₸/м²</th><th>Дата</th></tr></thead><tbody>${c.deals.map((x) => `<tr><td><b>${x.n}</b></td><td>${x.r}-комн.${x.st === 'Рассрочка' ? ' <span class="chip">рассрочка</span>' : ''}</td><td class="num">${fmt(x.m2, 1)}</td><td class="num">${x.price ? money(x.price) : '<span class="muted">нет цены</span>'}</td><td class="num">${x.ppm ? fmt(x.ppm) : '—'}</td><td>${day(x.at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">В этом периоде продаж не было.</div>'}
        <p class="small muted">${DATA.crm ? 'Источники, реклама и менеджеры по сделкам — ниже, по CRM.' : 'Источник, кампания, креатив и менеджер сделки появятся с CRM.'}</p></div>
    </section>
    <section class="grid g3" style="margin-top:16px">
      ${crmRevenueBlocks() || `${emptyBlock('Источники выручки', 'Нужна CRM: у каждой сделки — откуда пришёл клиент.', ['Meta Ads', 'Органика Instagram', 'Крыша', 'Риэлторы', 'Рекомендации', 'Старая база'])}
      ${emptyBlock('Выручка по рекламе', 'Нужна связь «переписка → клиент → сделка» в CRM, тогда — выручка и ROMI по кампании и креативу.', ['Кампания', 'Креатив', 'ROMI'])}
      ${emptyBlock('Выручка по менеджерам', 'Нужна CRM: кто вёл сделку.', ['Менеджер', 'Конверсия', 'Средний чек'])}`}
    </section>
    <section class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Что продаётся плохо: комнаты</h2></div><div class="table-wrap">${groupTable(b.byRooms)}</div></div>
      <div class="card"><div class="card-head"><h2>Что продаётся плохо: этажи</h2></div><div class="table-wrap">${groupTable(b.byFloors)}</div></div>
    </section>
    <section class="grid split" style="margin-top:16px">
      ${reportCard('revenue', 'Отчёт Нурлана')}
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-head"><h2>Продажи со скидкой</h2></div>${r.lowSales.length ? `<div class="list">${r.lowSales.map((x) => `<div class="list-item"><b>Кв. ${x.n}</b><span class="grow"></span><span class="chip">${fmt(x.ppm)} ₸/м²</span></div>`).join('')}</div><div class="empty">Дешевле ${fmt(r.basePpm || 400000)} ₸/м² — для сведения, без тревоги.</div>` : `<div class="empty">Нет — все продажи от ${fmt(r.basePpm || 400000)} ₸/м².</div>`}</div>
        <div class="card"><div class="card-head"><h2>Расход на Крышу</h2></div>${kr.length ? `<div class="list">${kr.slice(-6).reverse().map((x) => `<div class="list-item"><span class="grow">${day(x.at)}</span><b>${money(x.amount)}</b></div>`).join('')}</div>` : '<div class="empty">Записей нет. В Telegram: /krisha 150000</div>'}</div>
      </div>
    </section>`
  el.querySelectorAll('[data-period]').forEach((x) => (x.onclick = () => { revPeriod = x.dataset.period; CHARTS.length = 0; revenueDetail(el); paintCharts() }))
}

const FORMAT_ICON = { 'Пост': 'image', 'Карусель': 'view_carousel', 'Сторис': 'amp_stories', 'Рилс (маркетологи)': 'movie' }

function goalCard(g) {
  if (!g || g.now == null) return ''
  const pct = Math.min(100, Math.round((g.now / g.goal) * 100))
  const ok = g.pace != null && g.pace >= g.need
  const eta = g.pace > 0 ? Math.ceil((g.goal - g.now) / g.pace) : null
  return `<section class="card goal" style="margin-top:16px">
    <div class="card-head"><h2>${icon('flag')} Цель: ${fmt(g.goal)} подписчиков к ${esc(g.until)}</h2><span class="chip ${ok ? 'green' : 'amber'}">${ok ? 'идём по плану' : 'отстаём от плана'}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><span style="font-size:26px;font-weight:800">${fmt(g.now)} <span class="small muted">из ${fmt(g.goal)}</span></span><b style="color:var(--primary)">${pct}%</b></div><div class="goal-bar"><i style="width:${pct}%"></i></div>
    <div class="kpis" style="margin-top:14px">
      ${kpi('Нужно в неделю', `+${fmt(g.need)}`, `<span class="small muted">осталось недель: ${g.weeks}</span>`)}
      ${kpi('Сейчас в неделю', `+${fmt(g.pace)}`, g.pace != null ? `<span class="delta ${ok ? 'good' : 'bad'}">${ok ? 'хватает' : `не хватает ${fmt(g.need - g.pace)}`}</span>` : '')}
      ${kpi('При текущем темпе', eta ? (eta > 52 ? `${fmt(eta / 52, 1)} г.` : `${eta} нед.`) : '—', '<span class="small muted">до цели</span>')}
      ${kpi('Норма недели', `${g.postsPerWeek} поста`, `<span class="small muted">+ сторис каждый день, ${esc(g.reelsPerWeek)} рилсов</span>`)}
    </div></section>`
}

function planCard(g) {
  const p = g?.plan
  const owner = ME.user.role === 'owner'
  if (!p) return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('calendar_month')} Контент-план недели</h2></div><div class="empty">Алия составит план в понедельник после своего отчёта. Сейчас — в Telegram командой /content.</div></section>`
  const days = {}
  for (const x of p.items) (days[x.date || x.day] ??= []).push(x)
  const status = { new: ['amber', 'ждёт утверждения'], accepted: ['green', 'утверждён — Мадина готовит'], declined: ['red', 'отклонён'] }[p.status] || ['', '']
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('calendar_month')} Контент-план${p.week ? ` · ${esc(p.week)}` : ''}</h2>
    <div class="chips"><span class="chip ${status[0]}">${status[1]}</span>${p.proposal && owner ? `<button class="btn btn-sm btn-primary" data-act="yes" data-id="${p.proposal}">Утвердить</button><button class="btn btn-sm" data-act="no" data-id="${p.proposal}">Не надо</button>` : ''}</div></div>
    ${p.items.length ? `<div class="week">${Object.entries(days).map(([d, list]) => `<div class="day"><div class="day-head">${esc(list[0].day || '')} <span class="muted">${esc(day(list[0].date) || '')}</span></div>${list.map((x) => `<div class="slot ${/рилс/i.test(x.format) ? 'reel' : /сторис/i.test(x.format) ? 'story' : ''}"><div class="slot-top">${icon(FORMAT_ICON[x.format] || 'image')}<b>${esc(x.format)}</b><span class="muted">${esc(x.time || '')}</span></div><div class="clamp">${esc(x.topic || '')}</div>${x.by ? `<div class="small muted">${esc(x.by)}</div>` : ''}</div>`).join('')}</div>`).join('')}</div>` : '<div class="empty">План в файле контент-план.md — откройте его в «Отчётах».</div>'}
  </section>`
}

const PACK_ST = { waiting: ['ждёт утверждения', ''], scheduled: ['запланировано', 'blue'], published: ['вышло', 'green'], reminded: ['напомнил вам', 'amber'], failed: ['ошибка', 'red'], late: ['время прошло', ''], missed: ['пропущено', 'red'], declined: ['отклонено', ''], fixing: ['Мадина исправляет', 'amber'], 'day-review': ['ждёт утверждения дня', 'amber'], superseded: ['заменено', ''] }
const PACK_KIND = { post: 'Пост', carousel: 'Карусель', story: 'Сторис', reel: 'Рилс' }
// «на каких цифрах это основано»: what the item sells (or which objection it answers), to whom, and why
function packArg(a) {
  if (!a) return ''
  const who = a.audience ? ` · для: ${esc(a.audience)}` : ''
  const head = a.kind === 'доверие'
    ? `🛡 Снимаем возражение: <b>${esc(a.objection || a.usp || '—')}</b>${a.objection && a.usp ? ` · ${esc(a.usp)}` : ''}${who}`
    : `🎯 Продаём: <b>${esc(a.product || '—')}</b>${a.usp ? ` · УТП: ${esc(a.usp)}` : ''}${who}`
  const why = a.check === 'none' ? '📊 Без обоснования — Алия не сослалась на цифры' : `📊 ${a.check === 'replaced' ? 'Цифры офиса' : 'Почему'}: ${esc(a.why)}`
  return `<div class="pack-arg${a.kind === 'доверие' ? ' trust' : ''}${a.check !== 'ok' ? ' warn' : ''}"><div>${head}</div><div class="muted">${why}</div></div>`
}
function packCard(pk) {
  if (!pk) return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('event_upcoming')} Пакет недели</h2></div><div class="empty">Появится, когда Мадина подготовит посты и сторис по утверждённому контент-плану.</div></section>`
  const owner = ME.user.role === 'owner'
  const day = (d) => new Date(`${d}T12:00:00+05:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' })
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('event_upcoming')} Пакет недели${pk.week ? ` ${esc(pk.week)}` : ''}</h2>
    ${pk.proposal && owner ? `<div class="chips"><button class="btn btn-sm btn-primary" data-act="yes" data-id="${pk.proposal}">Утвердить неделю</button><button class="btn btn-sm" data-act="no" data-id="${pk.proposal}">Не публиковать</button></div>` : `<span class="chip ${pk.status === 'approved' ? 'green' : ''}">${pk.status === 'approved' ? 'утверждён — выходит сам' : pk.status === 'declined' ? 'отклонён' : pk.status === 'superseded' ? 'заменён новым' : 'на утверждении'}</span>`}</div>
    ${pk.strategy?.length ? `<div class="pack-strategy"><b>🎯 Стратегия недели</b><ol>${pk.strategy.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${pk.check ? `<div class="small" style="color:var(--amber-ink)">${esc(pk.check)}</div>` : ''}</div>` : pk.check ? `<div class="small" style="color:var(--amber-ink)">${esc(pk.check)}</div>` : ''}
    <div class="list">${pk.items.map((x) => { const st = PACK_ST[x.status] || [x.status, '']; return `<div class="list-item pack-row"><div class="pack-date"><b>${day(x.date)}</b><div class="small muted">${esc(x.time)}</div></div><div class="grow"><b>${PACK_KIND[x.type] || esc(x.type)}</b>${x.manual ? `<span class="small muted"> · ${x.type === 'reel' ? 'снимают маркетологи' : `вручную, наклейка: ${esc(x.sticker || '')}`}</span>` : ''}<div class="small muted">${esc(x.caption)}</div>${x.video ? `<div class="small muted">🎬 видео с музыкой «${esc(x.video)}»</div>` : ''}${x.videoError ? `<div class="small" style="color:var(--amber-ink)">видео: ${esc(x.videoError)}</div>` : ''}${x.error ? `<div class="small" style="color:var(--red)">${esc(x.error)}</div>` : ''}${x.result ? `<div class="small muted">📊 ${esc(x.result)}</div>` : ''}</div><span class="chip ${st[1]}">${x.permalink ? `<a href="${esc(x.permalink)}" target="_blank" rel="noopener">${st[0]}</a>` : st[0]}</span>${packArg(x.arg)}</div>` }).join('')}</div>
    <p class="small muted">Посты и сторис без наклеек офис публикует сам в своё время через официальный Instagram API — только после вашего «Утвердить». После утверждения сторис и посты из одной картинки офис превращает в 15-секундные видео с музыкой (если видео не собралось — выходит картинка), карусели остаются картинками. Сторис — около 12:00, посты — около 19:00. Сторис с наклейками и рилсы — напоминанием. Каждое утро офис проверяет, всё ли вышло.</p></section>`
}

function smm(el) {
  const i = DATA.insta
  const works = DATA.reports.filter((r) => ['smm', 'montazh'].includes(r.employee)).slice(0, 6)
  el.innerHTML = `
    ${header('SMM', `Instagram${i?.username ? ` @${esc(i.username)}` : ''} · ведут Мадина и Тимур`)}
    ${goalCard(DATA.smm)}
    ${planCard(DATA.smm)}
    ${packCard(DATA.smm?.pack)}
    ${statsCard(DATA.smm?.stats)}
    ${i ? `<div class="kpis" style="margin-top:16px">
      ${kpi('Публикаций за неделю', fmt(i.cur.posts), delta(i.cur.posts, i.prev.posts))}
      ${kpi('Охват', fmt(i.cur.reach), delta(i.cur.reach, i.prev.reach))}
      ${kpi('Взаимодействия', fmt(i.cur.interactions), delta(i.cur.interactions, i.prev.interactions))}
      ${kpi('Новые подписчики', `+${fmt(i.cur.follows)}`, delta(i.cur.follows, i.prev.follows), spark(i.follows.map((f) => f.value)))}
    </div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Последние публикации</h2></div>${postsGrid(i.posts)}</section>` : '<div class="card empty">Instagram не подключён — в офисе ⚙ → Meta.</div>'}
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('draw')} Черновики команды</h2><span class="small muted">пакет недели публикуется после вашего «Утвердить»</span></div>
      <div class="list">${works.map((r) => {
        const pics = r.files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).slice(0, 4)
        const vids = r.files.filter((f) => /\.mp4$/i.test(f)).slice(0, 1)
        return `<div class="list-item">${avatar(r.employee)}<div class="grow"><b>${esc(r.title)}</b><div class="small muted">${esc(r.name)} · ${when(r.at)}</div>
          ${pics.length ? `<div class="shots">${pics.map((f) => `<a href="${fileUrl(r, f)}" target="_blank" rel="noopener"><img src="${fileUrl(r, f)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
          ${vids.map((f) => `<video src="${fileUrl(r, f)}" controls preload="none" style="max-width:240px;border-radius:10px;margin-top:10px"></video>`).join('')}
          <div class="small" style="margin-top:8px;white-space:pre-wrap">${esc(r.result.slice(0, 600))}${r.result.length > 600 ? '…' : ''}</div></div></div>`
      }).join('') || '<div class="empty">Черновиков пока нет.</div>'}</div></section>`
}

let openReport = null
document.addEventListener('click', (ev) => { const a = ev.target.closest('[data-report]'); if (a) openReport = a.dataset.report })

const RTYPE = { director: 'Отчёт недели', month: 'Отчёт месяца', weekly: 'Недельный отчёт', decision: 'По решению', plan: 'План', draft: 'Черновик', request: 'По запросу' }
const rf = { who: '', type: '', days: '30', area: '' }

// weeks and months kept for good (server/months.js, reports.js): charts over every month, the numbers, the PDF and Excel
const ARCH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const mShort = (key, i) => `${ARCH_SHORT[+key.slice(5, 7) - 1]}${key.slice(5) === '01' || i === 0 ? ` ${key.slice(2, 4)}` : ''}`
const curSign = (c) => (/USD/i.test(c || '') ? '$' : c || '')
function archiveBlock() {
  const a = DATA.archive
  if (!a || (!a.months.length && !a.weeks.length)) return ''
  const series = (key, fmtV) => {
    const from = a.months.findIndex((m) => m[key] != null)
    const list = from < 0 ? [] : a.months.slice(from)
    return list.map((m, i) => ({ l: `${mShort(m.key, i)}${m.partial ? '*' : ''}`, v: m[key] == null ? 0 : fmtV ? fmtV(m[key]) : m[key] }))
  }
  const chart = (title, key, opt = {}, fmtV) => {
    const items = series(key, fmtV)
    return `<div class="arch-chart"><div class="small muted">${title}</div>${items.length ? bars(items, { value: 'v', label: 'l', zero: '—', avgLabel: 'в среднем', ...opt }) : '<div class="empty">Пока нет данных</div>'}</div>`
  }
  const cur = curSign(a.months.find((m) => m.currency)?.currency)
  const link = (r, f) => {
    const inner = `${icon(/\.xlsx$/.test(f) ? 'table_view' : 'picture_as_pdf')} ${/\.xlsx$/.test(f) ? 'Excel' : 'PDF'}`
    // the demo has no files: the button only explains
    return ME.demo ? `<button class="chip" data-act="file">${inner}</button>` : `<a class="chip" href="${fileUrl({ id: r.taskId }, f)}" target="_blank" rel="noopener">${inner}</a>`
  }
  const files = (r) => (r?.files || []).filter((f) => /\.(pdf|xlsx)$/.test(f)).map((f) => link(r, f)).join(' ')
  const nd = '<span class="muted small">нет данных</span>'
  const rows = [...a.months].reverse().map((m) => `<tr>
    <td><b>${esc(m.label)}</b>${m.partial ? ' <span class="chip">идёт</span>' : ''}${m.complete.length ? ` <span class="chip amber" title="${esc(m.complete.join('; '))}">неполные данные</span>` : ''}${m.revisions ? ` <span class="chip" title="Закрытый месяц не переписывается: изменения записаны в Excel">исправлений: ${m.revisions}</span>` : ''}</td>
    <td class="num" data-l="Продажи">${m.sales == null ? nd : fmt(m.sales)}</td><td class="num" data-l="Деньги">${m.money == null ? nd : money(m.money)}${m.extra ? `<div class="small muted">+ ${money(m.extra)} вне шахматки</div>` : ''}</td>
    <td class="num" data-l="Клиенты">${m.leads == null ? nd : fmt(m.leads)}</td><td class="num" data-l="Цена переписки">${m.cpr == null ? nd : `${fmt(m.cpr, 2)} ${esc(curSign(m.currency))}`}</td>
    <td class="num" data-l="Подписчики">${m.followers == null ? nd : fmt(m.followers)}</td><td class="num arch-files">${files(m.report) || ''}</td></tr>`).join('')
  const weeks = a.weeks.map((w) => `<div class="arch-week">
    <div class="arch-week-head"><b>${esc(day(w.from))} – ${esc(day(w.to))}</b><span class="arch-files">${files(w)}</span></div>
    ${w.phrase ? `<div class="small">${esc(w.phrase)}</div>` : ''}
    <div class="arch-nums small muted"><span>💰 ${w.money == null ? 'нет данных' : money(w.money)}</span><span>🏠 продаж ${w.sales ?? '—'}</span><span>👥 клиентов ${w.leads ?? '—'}</span><span>💬 ${w.cpr == null ? '—' : `${fmt(w.cpr, 2)} ${esc(curSign(w.currency))}`}</span></div></div>`).join('')
  return `<section class="card arch">
      <div class="card-head"><h2>${icon('calendar_month')} Месяцы</h2><span class="small muted">все месяцы, которые знает офис · * месяц ещё идёт · «—» нет данных</span></div>
      <div class="grid g2">${chart('Продажи', 'sales', { show: (v) => fmt(v) })}${chart('Деньги получены, млн ₸', 'money', { show: (v) => fmt(v, 1), color: 'var(--primary)' }, (v) => v / 1e6)}${chart('Новые клиенты', 'leads', { color: 'var(--navy-2)' })}${chart(`Цена переписки, ${esc(cur)} · ниже — лучше`, 'cpr', { show: (v) => fmt(v, 2), color: 'var(--amber)', lowBest: true })}</div>
      <div class="table-wrap" style="margin-top:14px"><table class="arch-t"><thead><tr><th>Месяц</th><th class="num">Продажи</th><th class="num">Деньги</th><th class="num">Клиенты</th><th class="num">Цена переписки</th><th class="num">Подписчики</th><th class="num">Отчёт</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    ${a.weeks.length ? `<section class="card arch"><div class="card-head"><h2>${icon('date_range')} Недели</h2><span class="small muted">отчёт недели приходит в Telegram по понедельникам</span></div><div class="arch-weeks">${weeks}</div></section>` : ''}`
}

function reports(el) {
  const list = DATA.reports
  const people = [...new Set(list.map((r) => r.employee))]
  const areas = [...new Set(list.map((r) => r.area))]
  const draw = () => {
    const since = rf.days ? Date.now() - Number(rf.days) * 864e5 : 0
    const shown = list.filter((r) => (!rf.who || r.employee === rf.who) && (!rf.type || r.type === rf.type) && (!rf.area || r.area === rf.area) && Date.parse(r.at) >= since)
    const cur = shown.find((r) => r.id === openReport) || shown[0]
    const sel = (key, opts, label) => `<label class="small muted">${label} <select data-rf="${key}">${opts.map(([v, t]) => `<option value="${v}" ${rf[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
    const d = cur?.decision
    el.innerHTML = `
      ${header('Отчёты', DATA.archive ? 'Недели и месяцы: цифры, графики, PDF и Excel · ниже — журнал работ и решений' : 'Отчёты сотрудников → рекомендации → задачи → результат')}
      ${archiveBlock()}
      <h2 style="margin:22px 0 12px">Журнал аналитики и решений</h2>
      <div class="chips" style="margin-bottom:10px"><button class="chip ${!rf.who ? 'on' : ''}" data-who="">Все</button>${people.map((p) => `<button class="chip ${rf.who === p ? 'on' : ''}" data-who="${p}">${esc(NAMES[p] || p)} · ${esc(ROLES_OF[p] || '')}</button>`).join('')}</div>
      <div class="filters">${sel('type', [['', 'все'], ...Object.entries(RTYPE)], 'Тип')}${sel('days', [['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней'], ['', 'всё время']], 'Период')}${sel('area', [['', 'все'], ...areas.map((a) => [a, a])], 'Направление')}<span class="small muted">найдено: ${shown.length}</span></div>
      <div class="reports">
        <div class="card" style="padding:8px">${shown.map((r) => `<button class="report-item ${cur && r.id === cur.id ? 'on' : ''}" data-open="${r.id}">${avatar(r.employee)}<span class="grow" style="min-width:0"><b class="clamp">${esc(r.title)}</b><span class="small muted">${esc(r.name)} · ${when(r.at)} · ${esc(RTYPE[r.type] || '')}</span>${r.decision?.result ? `<span class="chip ${VERDICT_RU[r.decision.result.verdict][1]}" style="margin-top:4px">${VERDICT_RU[r.decision.result.verdict][0]}</span>` : ''}</span></button>`).join('') || '<div class="empty">Под эти фильтры ничего нет.</div>'}</div>
        <div class="card" id="reportView">${cur ? `<div class="card-head"><div class="who-line">${avatar(cur.employee, true)}<div><h2>${esc(cur.title)}</h2><div class="small muted">${esc(cur.name)} · ${when(cur.at)} · ${esc(RTYPE[cur.type] || '')} · ${esc(cur.area)}</div></div></div>${ME.user.role === 'owner' ? `<button class="btn btn-sm" data-act="praise" data-id="${cur.employee}">👏 Похвалить</button>` : ''}</div>
          ${d ? `<div class="decision-link"><div class="small muted">Цепочка решения</div>
            <div class="chain small">${[[d.source, 'источник'], [d.title, 'рекомендация'], [{ new: 'ждёт решения', accepted: 'утверждено', declined: 'отклонено' }[d.status], 'решение'], ['эта работа', 'действие'], [d.result ? `${VERDICT_RU[d.result.verdict][0]}${d.result.delta != null ? ` (${d.result.delta > 0 ? '+' : ''}${d.result.delta}%)` : ''}` : d.metric ? `замер «${d.metric}» через 7 дней` : 'без замера', 'результат']].map(([v, l]) => `<div class="chain-step"><div class="muted">${l}</div><b>${esc(v || '—')}</b></div>`).join(`<span class="chain-arrow">${icon('arrow_forward')}</span>`)}</div>
            ${d.why ? `<div class="small muted" style="margin-top:6px">Почему: ${esc(d.why)}</div>` : ''}</div>` : ''}
          <div id="reportBody">${md(cur.result)}</div>
          ${cur.files.length ? `<div class="files">${cur.files.map((f) => `<a class="chip" href="${fileUrl(cur, f)}" target="_blank" rel="noopener">${icon('attach_file')} ${esc(f)}</a>`).join('')}</div>` : ''}` : '<div class="empty">Выберите запись слева.</div>'}</div>
      </div>`
    el.querySelectorAll('[data-who]').forEach((b) => (b.onclick = () => { rf.who = b.dataset.who; openReport = null; draw() }))
    el.querySelectorAll('[data-rf]').forEach((s) => (s.onchange = () => { rf[s.dataset.rf] = s.value; openReport = null; draw() }))
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { openReport = b.dataset.open; draw(); if (innerWidth < 900) $('#reportView').scrollIntoView({ behavior: 'smooth' }) }))
    // the full report file reads better than the short Telegram card
    const full = cur?.files.find((f) => /(отч[её]т|контент-план).*\.md$/i.test(f))
    if (full) fetch(fileUrl(cur, full)).then((r) => (r.ok ? r.text() : null)).then((t) => { if (t && $('#reportBody')) $('#reportBody').innerHTML = md(t) }).catch(() => {})
  }
  draw()
}

function officePage(el) {
  const view = ME.user.role !== 'owner'
  const team = DATA?.team || []
  el.innerHTML = `${header('Живой офис', view ? 'Только просмотр: команда за работой в реальном времени' : 'Аналитика → рекомендация → утверждение → задача → результат → замер')}
    <iframe class="office-frame" src="/office/${view ? '?view=1' : ''}" title="Живой офис"></iframe>
    ${team.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('badge')} Кто что делает и зачем</h2><span class="small muted">быстрые задачи и утверждения — в Telegram</span></div>
      <div class="team-grid">${team.map((t) => `<div class="team-card ${t.busy ? 'busy' : ''}">
        <div class="who-line">${avatar(t.id)}<div><b>${esc(t.name)}</b><div class="small muted">${esc(t.title)}</div></div><span class="chip ${t.busy ? 'green' : ''}" style="margin-left:auto">${t.busy ? 'работает' : 'свободен(на)'}</span></div>
        ${t.busy ? `<div class="small" style="margin-top:8px"><b>${esc(t.doing)}</b></div>${t.reason ? `<div class="small muted">Откуда: ${esc(t.reason.source)}${t.reason.goal ? ` · цель: ${esc(t.reason.goal)}` : ''}</div>${t.reason.why ? `<div class="small muted clamp">Почему: ${esc(t.reason.why)}</div>` : ''}` : ''}` : ''}
        ${t.queue.length ? `<div class="small" style="margin-top:8px">В очереди: ${t.queue.map(esc).join('; ')}</div>` : ''}
        ${t.last ? `<div class="small muted" style="margin-top:8px">Последнее готовое: ${esc(t.last.title)} · ${when(t.last.at)}</div>` : ''}
      </div>`).join('')}</div></section>` : ''}`
}

async function accessPage(el) {
  el.innerHTML = header('Доступ', 'Кто может открывать портал') + '<div class="empty"><span class="spin"></span></div>'
  let d
  try { d = await api('/p/users') } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  const roleOpts = (cur) => Object.entries(d.roles).filter(([k]) => k !== 'owner').map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')
  el.innerHTML = `${header('Доступ', 'Кто может открывать портал. Вход — только через Telegram, паролей нет.')}
    <section class="grid split">
      <div class="card"><div class="card-head"><h2>Люди</h2></div><div class="table-wrap"><table><thead><tr><th>Имя</th><th>Роль</th><th class="num">Устройств</th><th></th></tr></thead><tbody>
        ${d.users.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.tg ? `<div class="small muted">@${esc(u.tg)}</div>` : ''}</td>
          <td>${u.role === 'owner' ? `<span class="chip green">${esc(u.roleName)}</span>` : `<select data-role="${u.id}" aria-label="Роль">${roleOpts(u.role)}</select>`}</td>
          <td class="num">${u.sessions}</td>
          <td class="num">${u.role === 'owner' ? `<button class="btn btn-sm" id="logoutAll">Выйти везде</button>` : `<button class="btn btn-sm" data-remove="${u.id}">Убрать доступ</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted">«Руководство» видит всё, но ничего не меняет. «Менеджер продаж» видит только продажи, шахматку и отчёты Ерлана.</p></div>
      <form class="card" id="invite"><div class="card-head"><h2>${icon('person_add')} Пригласить</h2></div>
        <label class="small muted" for="invName">Имя</label><input id="invName" name="name" required maxlength="40" placeholder="Например: Асель" style="width:100%;margin:4px 0 12px">
        <label class="small muted" for="invRole">Роль</label><select id="invRole" name="role" style="width:100%;margin:4px 0 16px">${roleOpts('sales')}</select>
        <button class="btn btn-primary" style="width:100%">Создать приглашение</button>
        <div id="invOut"></div></form>
    </section>`
  $('#invite').onsubmit = async (ev) => {
    ev.preventDefault()
    const f = ev.target
    try {
      const r = await api('/p/users/invite', { name: f.name.value, role: f.role.value })
      $('#invOut').innerHTML = `<p class="small" style="margin-top:14px">Отправьте эту ссылку <b>${esc(r.name)}</b> в Telegram. Она одноразовая и действует ${r.days} дня:</p>
        <input readonly value="${esc(r.link)}" style="width:100%" id="invLink"><button type="button" class="btn btn-sm" style="margin-top:8px" id="copyInv">${icon('content_copy')} Скопировать</button>`
      $('#copyInv').onclick = () => { navigator.clipboard?.writeText(r.link).then(() => toast('Скопировано'), () => $('#invLink').select()) }
    } catch (e) { toast(e.message) }
  }
  el.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => { try { await api(`/p/users/${s.dataset.role}/role`, { role: s.value }); toast('Роль изменена') } catch (e) { toast(e.message) } }))
  el.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Убрать доступ к порталу? Человек сразу выйдет на всех устройствах.')) return
    try { await api(`/p/users/${b.dataset.remove}/remove`, {}); toast('Доступ убран'); accessPage(el) } catch (e) { toast(e.message) }
  }))
  const la = $('#logoutAll')
  if (la) la.onclick = async () => { if (confirm('Выйти на всех устройствах, включая это?')) { await api('/p/logout-all', {}); showLogin() } }
}


boot()
