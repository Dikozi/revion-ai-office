// Isometric pixel office. The room is one pre-drawn picture (img/office/room.png, 688×384);
// people are sprites (img/office/<id>/<pose>.png) that sit, walk and idle on top of it.
// Everything is drawn at 1× and enlarged by the browser without smoothing.

export const W = 688
export const H = 384

const INK = '#2a2420'
const WALK_SPEED = 30 // px per second
const STRIDE = 5 // px walked per animation frame (4 drawn frames = one left and one right step)
// Which way the drawn walk sheets face: F — walking towards the viewer, B — away from the viewer.
const WALK_FACE = { smm: { F: 'right', B: 'left' }, manager: { B: 'right' }, montazh: { B: 'right' }, marketing: { B: 'right' }, sales: { B: 'right' }, revenue: { B: 'right' } }
const DAY = { start: 9, end: 18 } // Astana working hours, Mon–Fri

// Where each employee sits (feet/chair-wheel anchor), which seated pose fits the chair,
// and a floor point next to the chair used to stand up and sit down.
const SEATS = {
  manager: { x: 388, y: 148, pose: 'front', exit: { x: 420, y: 202 }, idle: ['phone'] },
  smm: { x: 174, y: 256, pose: 'back', exit: { x: 194, y: 266 }, idle: ['idle'] },
  montazh: { x: 220, y: 232, pose: 'back', exit: { x: 240, y: 242 }, idle: ['relax', 'game'] },
  marketing: { x: 266, y: 206, pose: 'back', exit: { x: 286, y: 216 }, idle: ['idle'] },
  sales: { x: 513, y: 241, pose: 'back', exit: { x: 533, y: 251 }, idle: ['idle'] },
  // Нурлан sits in the room's own brown chair facing his monitors, so his sprites have no chair
  revenue: { x: 442, y: 199, pose: 'front', flip: true, exit: { x: 426, y: 207 }, idle: ['front'] },
}

// Monitor screens are found in the room picture (img/office/screens.json, pixel runs per desk):
// lit when someone works, Тимур plays games on his.

const SPOTS = {
  hub: { x: 360, y: 258 },
  cooler: { x: 412, y: 298, face: 'stand' },
  window: { x: 300, y: 250, face: 'standback' },
  sofa: { x: 366, y: 300, face: 'stand' },
  door: { x: 572, y: 242, face: 'standback', via: [{ x: 415, y: 236 }, { x: 540, y: 266 }] },
}

// Characters: what each one likes to do when free, how chatty they are, what they say.
// 'seat' = idle pose at the desk; the rest are places to go. Weights, not percentages.
const PERSONA = {
  manager: {
    chat: 0.25,
    idle: { seat: 3, window: 2, visit: 4, cooler: 1 },
    lines: ['Как продвигается?', 'Отличная работа!', 'Клиенты пишут?', 'Что по рекламе?', 'Давайте ускоримся', 'Хорошая идея, оформи'],
  },
  smm: {
    chat: 0.55,
    idle: { seat: 4, cooler: 2, sofa: 2, chat: 3, door: 1 },
    lines: ['Видели охваты?', 'Новый тренд нашла!', 'Сделаю сторис', 'Кофе будешь?', 'Как вам картинка?', 'Подписчики растут'],
  },
  montazh: {
    chat: 0.12,
    idle: { seat: 6, cooler: 1, window: 1, chat: 1 },
    lines: ['М?', 'Рендер идёт', 'Ок', 'Нужны свежие видео', 'Кран снять бы'],
  },
  marketing: {
    chat: 0.3,
    idle: { seat: 3, cooler: 3, window: 1, chat: 2 },
    lines: ['CTR подрос', 'Цифры не врут', 'Ещё кофе', 'Цена заявки ниже', 'Проверю отчёт', 'Креатив устал'],
  },
  sales: {
    chat: 0.6,
    idle: { seat: 2, cooler: 2, chat: 3, sofa: 1 },
    lines: ['Когда меня подключат?', 'Скоро шахматка!', 'Клиенты любят однушки', 'Асель звонила?', 'Жду свой этап'],
  },
  revenue: {
    chat: 0.2,
    idle: { seat: 5, cooler: 2, window: 1, chat: 1 },
    lines: ['Таблица сошлась', 'Где деньги, Алия?', 'Прогноз готов', 'Сколько стоит продажа?', 'Цифры любят тишину'],
  },
}
const MOOD_ICON = { 2: '😄', 1: '🙂', '-1': '😕', '-2': '😤', tired: '😴' }

// Furniture redrawn over people who are behind it (feet higher on screen than its base 'y').
// Glass panes only tint whoever is behind them.
const OCCLUDERS = [
  { name: 'boss desk', y: 172, poly: [[330, 116], [390, 139], [392, 162], [372, 172], [338, 158], [330, 150]] },
  { name: 'glass post', y: 197, poly: [[364, 50], [372, 50], [372, 197], [364, 197]] },
  { name: 'glass post right', y: 183, poly: [[400, 45], [406, 45], [406, 183], [400, 183]] },
  { name: 'glass pane', y: 196, alpha: 0.22, poly: [[372, 70], [400, 56], [400, 182], [372, 196]] },
  { name: 'glass pane left', y: 196, alpha: 0.22, poly: [[300, 62], [364, 92], [364, 197], [300, 166]] },
  { name: 'cooler', y: 326, poly: [[419, 265], [424, 255], [440, 255], [447, 265], [447, 322], [434, 327], [419, 320]] },
  { name: 'counter', y: 319, poly: [[445, 262], [475, 249], [502, 264], [502, 292], [447, 319]] },
  { name: 'coffee table', y: 312, poly: [[298, 290], [316, 278], [353, 295], [353, 305], [338, 312], [298, 296]] },
  { name: 'sofa', y: 350, poly: [[246, 297], [258, 283], [330, 318], [330, 330], [312, 350], [246, 322]] },
  { name: 'plant left', y: 312, poly: [[227, 250], [262, 250], [262, 312], [227, 312]] },
  { name: 'plant right', y: 362, poly: [[327, 312], [360, 312], [360, 362], [327, 362]] },
]

// Walkable floor and the things a walking person must go around (furniture, desk rows).
const FLOOR = [[96, 248], [344, 124], [596, 248], [345, 372]]
const BLOCKS = [
  // furniture outlines are what you see on screen; on the floor only the base counts
  ...OCCLUDERS.filter((o) => !o.alpha && o.y > 250).map((o) => {
    const xs = o.poly.map((p) => p[0])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, cy = o.y - hw / 2
    return [[cx - hw, cy], [cx, cy - hw / 2], [cx + hw, cy], [cx, cy + hw / 2]]
  }),
  [[100, 284], [300, 180], [300, 110], [100, 214]], // desks along the left window
  [[452, 172], [505, 148], [545, 168], [545, 214], [488, 244], [452, 226]], // desks on the right
  [[318, 120], [400, 150], [400, 186], [372, 198], [318, 170]], // Диас's office
]
const inPoly = (x, y, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Glass areas of the two windows, for the real-time sky.
const WINDOWS = [
  [[98, 138], [199, 92], [199, 166], [98, 201]],
  [[452, 74], [532, 110], [532, 182], [452, 146]],
]

// Test switches in the address bar: ?hour=22 fakes the Astana hour, ?lively speeds idling up.
const QS = new URLSearchParams(location.search)
const PACE = QS.has('lively') ? 0.08 : 1
// Outline of the room in the picture: only this part gets darker at night.
const ROOM_SHAPE = [[344, 1], [613, 131], [613, 247], [345, 383], [78, 248], [74, 131]]

// The scene is saved in the browser every few seconds, so a page reload keeps everyone where they were.
const SAVE_KEY = 'office-scene-v1'
const SAVE_MAX_AGE = 20 * 60 * 1000
const SAVE_FIELDS = ['x', 'y', 'state', 'pose', 'flip', 'path', 'dest', 'fast', 'dist', 'dir', 'mode', 'energy', 'social', 'mood', 'toilet', 'chatWith', 'chatTurns', 'script', 'doneToday', 'tired', 'speech']
const SAVE_TIMES = ['idleUntil', 'nextIdle', 'arriveAt', 'leaveAt', 'returnAt', 'speechUntil', 'moodAt', 'waveUntil', 'nextLine']

const rand = (a, b) => (a + Math.random() * (b - a)) * PACE
const pick = (list) => list[Math.floor(Math.random() * list.length)]

function astanaNow() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Almaty' }))
  if (QS.has('hour')) d.setHours(Number(QS.get('hour')), 0, 0, 0)
  return d
}

export class OfficeScene {
  constructor(canvas, overlay, onSelect) {
    this.canvas = canvas
    this.overlay = overlay
    this.onSelect = onSelect
    this.ctx = canvas.getContext('2d')
    this.scale = 1
    this.employees = new Map()
    this.selected = null
    this.flash = new Map()
    this.flyers = []
    this.plates = new Map()
    this.board = null
    this.boardInfo = { running: 0, queued: 0, doneToday: 0 }
    this.people = new Map()
    this.sprites = new Map()
    this.meta = null
    this.room = new Image()
    this.room.src = 'img/office/room.png'
    this.stars = []
    this.lit = []
    this.room.onload = () => { this.analyseWindows(); this.plantMasks() }

    for (const id of Object.keys(SEATS)) {
      this.people.set(id, { id, x: SEATS[id].x, y: SEATS[id].y, state: 'away', pose: 'stand', flip: false, path: [], idleUntil: 0, nextIdle: performance.now() / 1000 + rand(20, 60), mode: null, energy: 0.8 + Math.random() * 0.2, social: 0.5 + Math.random() * 0.4, mood: 0 })
    }
    this.placed = this.restoreScene()
    addEventListener('pagehide', () => this.saveScene())
    this.screens = {}
    fetch('img/office/screens.json').then((r) => r.json()).then((s) => {
      for (const [id, runs] of Object.entries(s)) {
        if (!runs.length) continue
        const xs = runs.map((r) => r[0]), ys = runs.map((r) => r[1])
        const x0 = Math.min(...xs), x1 = Math.max(...runs.map((r) => r[0] + r[2]))
        // top edge of the screen at its left and right side gives the tilt
        const topAt = (x) => Math.min(...runs.filter((r) => r[0] <= x && x < r[0] + r[2]).map((r) => r[1]))
        const botAt = (x) => Math.max(...runs.filter((r) => r[0] <= x && x < r[0] + r[2]).map((r) => r[1]))
        const yl = topAt(x0 + 1), yr = topAt(x1 - 2)
        const slope = (yr - yl) / Math.max(1, x1 - 3 - x0)
        const h = Math.round((botAt(x0 + 1) - yl + botAt(x1 - 2) - yr) / 2) + 1
        this.screens[id] = { runs, x0, x1, yl, slope, w: x1 - x0, h }
      }
    }).catch(() => {})
    fetch('img/office/sprites.json').then((r) => r.json()).then((meta) => {
      this.meta = meta
      for (const [id, poses] of Object.entries(meta)) {
        for (const pose of Object.keys(poses)) {
          if (pose === 'scale') continue
          const img = new Image()
          img.src = `img/office/${id}/${pose}.png`
          this.sprites.set(`${id}/${pose}`, img)
        }
      }
    }).catch(() => {})

    this.canvas.width = W
    this.canvas.height = H
    if (QS.has('debug')) window.officeScene = this
    this.buildOverlay()
    canvas.addEventListener('click', (ev) => this.onCanvasClick(ev))
    new ResizeObserver(() => this.layout()).observe(canvas.parentElement)
    this.layout()

    this.last = 0
    this.prevT = performance.now() / 1000
    const frame = (t) => {
      if (!document.hidden && t - this.last > 33) {
        this.last = t
        const now = t / 1000
        this.update(now, Math.min(0.25, now - this.prevT))
        this.prevT = now
        this.draw(now)
        if (now - (this.savedAt || 0) > 3) { this.savedAt = now; this.saveScene() }
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  // ---------- save / restore ----------

  saveScene() {
    try {
      const now = performance.now() / 1000
      const people = [...this.people.values()].map((p) => {
        const o = { id: p.id }
        for (const k of SAVE_FIELDS) if (p[k] !== undefined && p[k] !== null) o[k] = p[k]
        for (const k of SAVE_TIMES) if (p[k]) o[k] = p[k] - now
        return o
      })
      localStorage.setItem(SAVE_KEY, JSON.stringify({ at: Date.now(), people }))
    } catch {}
  }

  restoreScene() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')
      if (!saved || Date.now() - saved.at > SAVE_MAX_AGE) return false
      const now = performance.now() / 1000
      for (const o of saved.people) {
        const p = this.people.get(o.id)
        if (!p) continue
        for (const k of SAVE_FIELDS) if (k in o) p[k] = o[k]
        for (const k of SAVE_TIMES) if (k in o) p[k] = o[k] + now
      }
      return true
    } catch { return false }
  }

  // ---------- data ----------

  setEmployees(list) {
    for (const e of list) {
      const prev = this.employees.get(e.id)
      if (prev?.status === 'working' && e.status !== 'working' && e.last && e.last.at) {
        this.flash.set(e.id, { kind: e.last.status === 'done' ? 'done' : 'error', until: performance.now() / 1000 + 15 })
        this.onResult(e.id, e.last.status === 'done')
      }
      this.employees.set(e.id, e)
    }
    this.updatePlates()
  }

  setBoard(info) {
    this.boardInfo = info
    if (this.board) {
      this.board.innerHTML = `
        <div class="board-title">Сегодня</div>
        <div>В работе: <b>${info.running}</b> · В очереди: <b>${info.queued}</b> · Готово: <b>${info.doneToday}</b></div>`
    }
  }

  select(id) {
    this.selected = id
    for (const [pid, el] of this.plates) el.classList.toggle('is-selected', pid === id)
  }

  fly(fromId, toId) {
    const a = this.people.get(fromId)
    const b = toId === 'owner' ? { x: W / 2, y: -40 } : this.people.get(toId)
    if (!a || !b) return
    this.flyers.push({ x0: a.x, y0: a.y - 50, x1: b.x, y1: b.y - 30, t0: performance.now() / 1000, dur: 1.2, doc: true })
  }

  // Evolving character from the server: shifts how chatty and cheerful each person is.
  setCharacters(c) {
    this.characters = c || {}
  }

  praised(id) {
    const p = this.people.get(id)
    if (!p) return
    p.mood = 2
    p.moodAt = performance.now() / 1000
    p.waveUntil = p.moodAt + 3
    p.joyAt = p.moodAt
    this.say(p, pick(['Спасибо! 😊', 'Ура, приятно! 🙌', 'Стараюсь! 💪', 'Благодарю 🙏']), 3.5)
  }

  // AI-written chatter from the server: real dialogues and thoughts with a mood attached.
  setBanter(b) {
    if (!b || b.at === this.banterAt) return
    this.banterAt = b.at
    this.dialogues = (b.dialogues || []).map((d) => ({ ...d }))
    this.thoughts = (b.thoughts || []).map((x) => ({ ...x }))
  }

  // ---------- layout & overlay ----------

  buildOverlay() {
    this.overlay.innerHTML = ''
    for (const id of Object.keys(SEATS)) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'plate'
      b.innerHTML = '<b></b><span></span>'
      b.addEventListener('click', () => this.onSelect(id))
      this.overlay.appendChild(b)
      this.plates.set(id, b)
    }
    // speech bubbles are HTML so the text stays crisp at any zoom
    this.speechEls = new Map()
    for (const id of Object.keys(SEATS)) {
      const el = document.createElement('div')
      el.className = 'speech'
      el.hidden = true
      this.overlay.appendChild(el)
      this.speechEls.set(id, el)
    }
    this.board = document.createElement('div')
    this.board.className = 'board board-card'
    this.board.setAttribute('aria-hidden', 'true')
    this.overlay.appendChild(this.board)
    this.setBoard(this.boardInfo)
  }

  layout() {
    const box = this.canvas.parentElement
    const fit = Math.min((box.clientWidth - 8) / W, (box.clientHeight - 8) / H)
    const s = fit >= 1 ? Math.min(Math.floor(fit * 4) / 4, 4) : Math.max(fit, 0.4)
    this.scale = s
    const pw = Math.round(W * s)
    const ph = Math.round(H * s)
    this.canvas.style.width = `${pw}px`
    this.canvas.style.height = `${ph}px`
    // draw at screen resolution so people can breathe and sway by less than one room pixel
    this.K = Math.max(2, Math.round(s * (window.devicePixelRatio || 1) * 4) / 4)
    this.canvas.width = Math.round(W * this.K)
    this.canvas.height = Math.round(H * this.K)
    this.ctx.imageSmoothingEnabled = false
    this.overlay.style.width = `${pw}px`
    this.overlay.style.height = `${ph}px`
    this.overlay.style.setProperty('--s', Math.max(1.2, s * 1.1))
    this.overlay.dataset.small = 'false'
    for (const [id, st] of Object.entries(SEATS)) {
      const el = this.plates.get(id)
      el.style.left = `${st.x * s}px`
      el.style.top = `${(st.y + 4) * s}px`
    }
    Object.assign(this.board.style, { left: `${10 * s}px`, top: `${8 * s}px` })
    this.draw(performance.now() / 1000)
  }

  updatePlates() {
    for (const id of Object.keys(SEATS)) {
      const e = this.employees.get(id)
      const el = this.plates.get(id)
      if (!e || !el) continue
      el.querySelector('b').textContent = e.name || e.title
      let line
      if (e.status === 'soon') line = e.soon || 'скоро'
      else if (e.status === 'working') line = e.activity?.text || 'работает'
      else if (e.status === 'waiting') line = e.activity?.text || 'ждёт вас'
      else line = e.queued ? `свободен · в очереди ${e.queued}` : 'свободен'
      el.querySelector('span').textContent = line
      el.dataset.status = e.status
      el.title = `${e.name ? e.name + ', ' : ''}${e.title}: ${e.about || ''}`
    }
  }

  onCanvasClick(ev) {
    const r = this.canvas.getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * W
    const y = ((ev.clientY - r.top) / r.height) * H
    let best = null
    let bestD = 34
    for (const p of this.people.values()) {
      if (p.state === 'away') continue
      const d = Math.hypot(p.x - x, p.y - 26 - y)
      if (d < bestD) { best = p; bestD = d }
    }
    if (best) {
      best.waveUntil = performance.now() / 1000 + 2
      this.onSelect(best.id)
    }
  }

  // ---------- behaviour ----------

  busy(e) {
    return e && (e.status === 'working' || e.status === 'waiting' || e.queued > 0)
  }

  onDuty() {
    const now = astanaNow()
    const day = now.getDay()
    const h = now.getHours() + now.getMinutes() / 60
    return day >= 1 && day <= 5 && h >= DAY.start && h < DAY.end
  }

  // Route on the open floor: via the person's own chair exit and the room hub.
  route(p, target) {
    const pts = []
    if (p.state === 'seated' || p.state === 'seatedIdle') pts.push(SEATS[p.id].exit)
    if (p.state === 'away') pts.push(...SPOTS.door.via.slice().reverse())
    pts.push(SPOTS.hub)
    if (target.via) pts.push(...target.via)
    if (target.exit) pts.push(target.exit)
    pts.push({ x: target.x, y: target.y })
    // only the floor diagonals have walk sprites, so every leg is split into two diagonal ones;
    // standing up (seat → exit) and sitting down (exit → seat) stay straight
    const seated = p.state === 'seated' || p.state === 'seatedIdle'
    const out = []
    let a = { x: p.x, y: p.y }
    pts.forEach((b, i) => {
      const straight = (i === 0 && seated) || (i === pts.length - 1 && target.exit)
      const c = straight ? null : this.isoCorner(a, b)
      if (c) out.push(c)
      out.push(b)
      a = b
    })
    return out
  }

  isoCorner(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y
    const u = dx / 4 + dy / 2 // along (2, 1): down-right
    const v = dx / 4 - dy / 2 // along (2, -1): up-right
    if (Math.abs(u) < 2 || Math.abs(v) < 2) return null
    const cands = [{ x: a.x + 2 * u, y: a.y + u }, { x: a.x + 2 * v, y: a.y - v }].sort((p, q) => q.y - p.y)
    return cands.find((c) => this.clearLine(a, c) && this.clearLine(c, b)) || null
  }

  // walkable: on the floor, not through furniture or desks
  clearLine(a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3))
    for (let i = 1; i < n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n
      if (!inPoly(x, y, FLOOR)) return false
      if (BLOCKS.some((q) => inPoly(x, y, q))) return false
    }
    return true
  }

  // dest says what happens on arrival: { kind: seat | leave | toilet | chat | stand, spot, min, max }
  goTo(p, target, dest, fast) {
    if (p.state === 'away') { p.x = SPOTS.door.x; p.y = SPOTS.door.y }
    p.path = this.route(p, target)
    p.dest = dest
    p.fast = !!fast
    p.state = 'walking'
  }

  arrive(p) {
    const d = p.dest || { kind: 'stand', spot: { x: p.x, y: p.y } }
    const now = performance.now() / 1000
    p.dest = null
    if (d.kind === 'seat') { p.state = 'seated'; p.mode = null }
    else if (d.kind === 'leave') p.state = 'away'
    else if (d.kind === 'toilet') { p.state = 'away'; p.returnAt = now + rand(20, 45) }
    else if (d.kind === 'chat') { this.stand(p, d.spot, now + 11); p.chatTurns = 4; p.nextLine = now }
    else this.stand(p, d.spot, now + rand(d.min || 6, d.max || 14))
  }

  goSeat(p, fast) {
    const st = SEATS[p.id]
    this.goTo(p, { x: st.x, y: st.y, exit: st.exit }, { kind: 'seat' }, fast)
  }

  update(t, dt) {
    const duty = this.onDuty()
    this.tickChats(t)
    this.tickMood(t)
    // First data: whoever should be in the office is already at the desk, nobody parades in.
    if (!this.placed && this.employees.size) {
      this.placed = true
      for (const p of this.people.values()) {
        const e = this.employees.get(p.id)
        if (this.busy(e) || duty) { p.state = 'seated'; p.x = SEATS[p.id].x; p.y = SEATS[p.id].y }
      }
    }
    for (const p of this.people.values()) {
      const e = this.employees.get(p.id)
      const working = this.busy(e)
      const present = working || (duty && e?.status !== undefined)

      if (p.state === 'walking') {
        this.walk(p, dt * (p.fast ? 2 : 1))
        continue
      }
      if (p.state === 'away') {
        if (p.toilet && !working) continue
        if (present) {
          p.toilet = false
          // arrivals are spread out a little so people don't enter in a line
          if (!p.arriveAt) p.arriveAt = t + (working ? 0 : rand(0, 20))
          if (t >= p.arriveAt) { p.arriveAt = 0; this.goSeat(p, working) }
        }
        continue
      }
      if (working && p.chatWith) this.endChat(p)
      if (working && p.state !== 'seated') {
        // work always wins: drop everything and run back to the desk
        if (p.state === 'seatedIdle') { p.state = 'seated'; p.mode = null } else this.goSeat(p, true)
        continue
      }
      if (!present && !working) {
        if (p.state !== 'leaving') {
          if (!p.leaveAt) p.leaveAt = t + rand(5, 40)
          if (t >= p.leaveAt) {
            p.leaveAt = 0
            this.goTo(p, SPOTS.door, { kind: 'leave' })
          }
        }
        continue
      }
      if (working) { p.nextIdle = t + rand(30, 90); continue }

      if (p.state === 'seatedIdle' || p.state === 'standing') {
        if (t >= p.idleUntil) {
          if (p.state === 'seatedIdle') { p.state = 'seated'; p.mode = null } else this.goSeat(p)
          p.nextIdle = t + rand(60, 180)
        }
        continue
      }
      // someone came over to talk: stay put until the chat is over
      if (p.chatWith && !p.chatTurns) { p.nextIdle = Math.max(p.nextIdle, t + 5); continue }
      if (p.state === 'seated' && t >= p.nextIdle) this.startIdle(p, e, t)
    }
  }

  // Weighted pick of what to do next, shaped by character and mood:
  // tired people go for coffee, upset ones keep to themselves, happy ones chat.
  chooseIdle(p, e) {
    const w = { ...PERSONA[p.id].idle }
    // needs drive choices: sleepy people want coffee, lonely ones want to talk
    if (p.energy < 0.4) w.cooler = (w.cooler || 0) + 6 * (1 - p.energy)
    if (p.social < 0.35 && w.chat) w.chat += 5
    const ch = this.characters?.[p.id]
    if (ch && w.chat) w.chat *= 0.4 + ch.sociability * 1.4
    if (ch && ch.mood < -0.3) w.seat = (w.seat || 0) + 3
    if (e?.status === 'soon') { w.seat = (w.seat || 0) + 6 }
    if (p.tired) w.cooler = (w.cooler || 0) + 3
    if ((p.mood || 0) < 0) { w.chat = 0; w.seat = (w.seat || 0) + 2 }
    if ((p.mood || 0) > 0 && w.chat) w.chat += 2
    const total = Object.values(w).reduce((a, b) => a + b, 0)
    let r = Math.random() * total
    for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k }
    return 'seat'
  }

  partnerFor(p) {
    const free = [...this.people.values()].filter((q) => q !== p && !q.chatWith &&
      (q.state === 'seated' || q.state === 'seatedIdle') && !this.busy(this.employees.get(q.id)))
    return free.length ? pick(free) : null
  }

  say(p, text, secs = 3) {
    p.speech = text
    p.speechUntil = performance.now() / 1000 + secs
  }

  startIdle(p, e, t) {
    const st = SEATS[p.id]
    const sleepy = e?.status === 'soon'
    let where = this.chooseIdle(p, e)
    if (where === 'chat') {
      const q = this.partnerFor(p)
      if (!q) where = 'seat'
      else {
        const qs = SEATS[q.id]
        const spot = { x: qs.exit.x + 12, y: qs.exit.y + 6, face: 'standback' }
        p.chatWith = q.id
        q.chatWith = p.id
        this.goTo(p, spot, { kind: 'chat', spot })
        return
      }
    }
    if (where === 'seat') {
      p.state = 'seatedIdle'
      p.mode = sleepy ? 'idle' : pick(st.idle)
      p.idleUntil = t + rand(25, 70)
      return
    }
    if (where === 'door') {
      this.goTo(p, SPOTS.door, { kind: 'toilet' })
      p.toilet = true
      return
    }
    if (where === 'visit') {
      const others = Object.keys(SEATS).filter((id) => id !== 'manager')
      const st2 = SEATS[pick(others)]
      const spot = { x: st2.exit.x + 10, y: st2.exit.y + 4, face: 'standback' }
      this.goTo(p, spot, { kind: 'stand', spot, min: 6, max: 12 })
      return
    }
    const spot = SPOTS[where] || SPOTS.cooler
    this.goTo(p, spot, { kind: 'stand', spot })
  }

  // Two people chatting take turns with lines from their own characters.
  tickChats(t) {
    for (const p of this.people.values()) {
      if (!p.chatWith || p.state !== 'standing' || !p.chatTurns) continue
      const q = this.people.get(p.chatWith)
      if (!q || this.busy(this.employees.get(q.id))) { this.endChat(p); continue }
      if (t < p.nextLine) continue
      // prefer a real AI-written dialogue for this pair, fall back to the character's own lines
      if (!p.script) {
        const i = (this.dialogues || []).findIndex((d) => (d.a === p.id && d.b === q.id) || (d.a === q.id && d.b === p.id))
        p.script = i >= 0 ? this.dialogues.splice(i, 1)[0].lines.slice() : []
        if (p.script.length) p.chatTurns = p.script.length
      }
      const line = p.script.shift()
      const speaker = line ? this.people.get(line.who) || p : (p.chatTurns % 2 === 0 ? p : q)
      this.say(speaker, line ? line.text : pick(PERSONA[speaker.id].lines), 2.6)
      p.chatTurns--
      p.nextLine = t + 2.9
      if (!p.chatTurns) this.endChat(p)
    }
  }

  endChat(p) {
    const q = this.people.get(p.chatWith)
    // talking feeds the social need of both
    for (const x of [p, q]) if (x) { x.social = Math.min(1, (x.social || 0) + 0.5); if ((x.mood || 0) < 1 && Math.random() < 0.5) x.mood = (x.mood || 0) + 1 }
    p.script = null
    if (q) q.chatWith = null
    p.chatWith = null
    p.chatTurns = 0
    p.idleUntil = Math.min(p.idleUntil || 0, performance.now() / 1000 + 1.5)
  }

  // Mood follows real results: done tasks cheer people up, errors upset them, it fades with time.
  onResult(id, ok) {
    const p = this.people.get(id)
    if (!p) return
    p.mood = Math.max(-2, Math.min(2, (p.mood || 0) + (ok ? 1 : -1)))
    p.doneToday = (p.doneToday || 0) + 1
    p.tired = p.doneToday >= 4
    p.moodAt = performance.now() / 1000
    if (ok) { p.joyAt = p.moodAt; p.lookUntil = p.moodAt + 2.5 }
    this.say(p, ok ? pick(['Готово!', 'Сделано 💪', 'Есть!']) : pick(['Не вышло…', 'Ошибка, разберусь']), 3)
  }

  tickMood(t) {
    const dt = Math.min(5, t - (this.lastNeeds || t))
    this.lastNeeds = t
    for (const p of this.people.values()) {
      // needs drift like in Sims: work and the day wear energy down, being alone lowers social
      const e = this.employees.get(p.id)
      if (p.state !== 'away') {
        const working = e?.status === 'working'
        p.energy = Math.max(0, p.energy - dt * (working ? 1 / 2400 : 1 / 7200) / PACE)
        p.social = Math.max(0, p.social - dt / 5400 / PACE)
        if (p.state === 'standing' && p.pose === 'stand' && Math.hypot(p.x - SPOTS.cooler.x, p.y - SPOTS.cooler.y) < 4) p.energy = Math.min(1, p.energy + dt / 20)
        if (p.state === 'seatedIdle') p.energy = Math.min(1, p.energy + dt / 600)
      } else {
        p.energy = Math.min(1, p.energy + dt / 3600) // rest at home
      }
      p.tired = p.energy < 0.3
      // AI thoughts: shown now and then, and they move the mood like a real thought would
      const th = (this.thoughts || []).findIndex((x) => x.who === p.id)
      if (th >= 0 && p.state !== 'away' && !p.speech && !this.busy(e) && Math.random() < 0.002 / PACE) {
        const x = this.thoughts.splice(th, 1)[0]
        this.say(p, `💭 ${x.text}`, 4)
        p.mood = Math.max(-2, Math.min(2, Math.round(((p.mood || 0) + x.mood) / 2 + (x.mood > 0 ? 0.4 : x.mood < 0 ? -0.4 : 0))))
        p.moodAt = t
        continue
      }
      // mood relaxes towards the person's background mood, which itself grows from experience
      const base = Math.round((this.characters?.[p.id]?.mood || 0) * 2)
      if (p.mood !== base && t - (p.moodAt || 0) > 600) { p.mood += p.mood > base ? -1 : 1; p.moodAt = t }
      // now and then a free person shows how they feel
      if (p.state !== 'away' && !p.speech && !this.busy(this.employees.get(p.id)) && Math.random() < 0.0015 * (1 / PACE)) {
        const icon = p.tired ? MOOD_ICON.tired : MOOD_ICON[p.mood || 0]
        if (icon) this.say(p, icon, 2.5)
      }
    }
  }

  stand(p, spot, until) {
    p.state = 'standing'
    p.pose = spot.face || 'stand'
    p.flip = false
    p.idleUntil = until
  }

  walk(p, dt) {
    const target = p.path[0]
    if (!target) {
      this.arrive(p)
      return
    }
    const dx = target.x - p.x
    const dy = target.y - p.y
    const d = Math.hypot(dx, dy)
    const step = WALK_SPEED * dt
    p.dist = (p.dist || 0) + Math.min(step, d)
    if (d <= step) {
      p.x = target.x
      p.y = target.y
      p.path.shift()
    } else {
      p.x += (dx / d) * step
      p.y += (dy / d) * step
    }
    p.dir = { dx, dy }
  }

  // Toilet trips come back by themselves.
  tickReturns(t) {
    for (const p of this.people.values()) {
      if (p.state === 'away' && p.toilet && p.returnAt && t >= p.returnAt) {
        p.toilet = false
        p.returnAt = 0
        this.goSeat(p)
      }
    }
  }

  // ---------- drawing ----------

  sprite(id, pose) {
    const img = this.sprites.get(`${id}/${pose}`)
    const m = this.meta?.[id]?.[pose]
    return img?.complete && img.naturalWidth && m ? { img, m } : null
  }

  // Small life on top of the pose: breathing, swaying, typing jitter and joy bounces.
  life(p, t) {
    const ph = ((p.id.charCodeAt(0) * 37 + p.id.length * 11) % 628) / 100
    const e = this.employees.get(p.id)
    const seated = p.state === 'seated' || p.state === 'seatedIdle'
    let sx = 1, sy = 1, skew = 0, dy = 0
    const br = Math.sin(t * 2.2 + ph)
    if (seated) {
      sy = 1 + 0.012 * br
      sx = 1 - 0.006 * br
      skew = 0.03 * Math.sin(t * 1.1 + ph)
      if (e?.status === 'working' && p.state === 'seated') skew += 0.012 * Math.sin(t * 12 + ph)
    } else if (p.state === 'standing') {
      sy = 1 + 0.008 * br
    }
    for (const at of [p.joyAt, p.joyAt && p.joyAt + 0.55]) {
      const u = (t - (at || -9)) / 0.45
      if (u < 0 || u > 1.33) continue
      if (u < 1) {
        if (seated) { sy *= 1 + 0.1 * Math.sin(Math.PI * u); sx *= 1 - 0.04 * Math.sin(Math.PI * u) } else dy -= 6 * Math.sin(Math.PI * u)
      } else sy *= 1 - 0.06 * Math.sin(Math.PI * (u - 1) / 0.33)
    }
    return { sx, sy, skew, dy }
  }

  drawSprite(g, id, pose, x, y, flip, bob = 0, life) {
    // a pose that is not drawn yet falls back to any seated one, so nobody disappears
    const s = this.sprite(id, pose) || this.sprite(id, 'back') || this.sprite(id, 'front')
    if (!s) return 0
    const { img, m } = s
    if (life) {
      g.save()
      g.translate(x, y + life.dy)
      g.transform(1, 0, -life.skew, 1, 0, 0)
      g.scale(flip ? -life.sx : life.sx, life.sy)
      g.drawImage(img, -m.ax, -m.ay + bob)
      g.restore()
      return m.h
    }
    const ax = flip ? m.w - m.ax : m.ax
    const left = Math.round(x - ax)
    const top = Math.round(y - m.ay + bob)
    if (flip) {
      g.save()
      g.translate(left + m.w, top)
      g.scale(-1, 1)
      g.drawImage(img, 0, 0)
      g.restore()
    } else {
      g.drawImage(img, left, top)
    }
    return m.h
  }

  personFrame(p, t) {
    const st = SEATS[p.id]
    if (p.state === 'seated') {
      // looks back over the shoulder: now and then, when someone comes to talk, and after a done task
      if ((t < (p.lookUntil || 0) || p.chatWith) && this.sprite(p.id, 'look')) return { pose: 'look', flip: !!st.flip }
      if (t > (p.nextLook || 0)) {
        if (p.nextLook) p.lookUntil = t + 1.6 + Math.random() * 1.6
        p.nextLook = t + 25 + Math.random() * 50
      }
      // typing loop while working
      if (this.employees.get(p.id)?.status === 'working' && this.sprite(p.id, 'type0')) {
        const ph = ((p.id.charCodeAt(0) * 37) % 100) / 10
        return { pose: `type${[0, 1, 2, 3, 2, 1][Math.floor(t * 7 + ph) % 6]}`, flip: !!st.flip }
      }
      return { pose: st.pose, flip: !!st.flip }
    }
    if (p.state === 'seatedIdle') return { pose: p.mode === 'game' ? st.pose : p.mode, flip: p.mode === 'relax' || (!!st.flip && p.mode === st.pose) }
    if (p.state === 'walking') {
      // 8-frame cycles tied to the distance walked, so feet don't slide:
      // walkF faces down-right, walkB faces up-left; the other two diagonals are mirrored.
      const { dx = 0, dy = 1 } = p.dir || {}
      const frame = Math.floor((p.dist || 0) / STRIDE) % 8
      // which way each drawn sheet faces differs per person (WALK_FACE); mirror to match the move
      const face = WALK_FACE[p.id] || {}
      if (dy < 0) return { pose: `walkB${frame}`, flip: (face.B || 'left') === 'left' ? dx > 0 : dx < 0 }
      return { pose: `walkF${frame}`, flip: (face.F || 'right') === 'right' ? dx < 0 : dx > 0 }
    }
    return { pose: p.pose || 'stand', flip: p.flip }
  }

  draw(t) {
    const g = this.ctx
    const K = this.K || 1
    g.setTransform(K, 0, 0, K, 0, 0)
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, W, H)
    if (this.room.complete && this.room.naturalWidth) g.drawImage(this.room, 0, 0)
    this.tickReturns(t)
    const light = this.daylight()
    this.drawSky(g, t, light)
    this.drawScreens(g, t)

    const order = [...this.people.values()].filter((p) => p.state !== 'away').sort((a, b) => a.y - b.y)
    const layers = [...order.map((p) => ({ y: p.y, p })), ...OCCLUDERS.map((o) => ({ y: o.y, o }))].sort((a, b) => a.y - b.y)
    for (const item of layers) {
      if (item.p) {
        const p = item.p
        const f = this.personFrame(p, t)
        const life = this.life(p, t)
        if (p.state === 'walking') { g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.ellipse(p.x, p.y, 7, 2.5, 0, 0, 7); g.fill() }
        const h = this.drawSprite(g, p.id, f.pose, p.x, p.y, f.flip, f.bob || 0, life)
        p.head = p.y + life.dy - (h || 50) * life.sy
      } else if (item.o.mask) {
        // plants: only leaves and pot cover a passer-by, not the floor around them
        g.drawImage(item.o.mask, item.o.mx, item.o.my)
      } else if (this.room.complete && this.room.naturalWidth) {
        g.save()
        this.poly(g, item.o.poly)
        g.clip()
        g.globalAlpha = item.o.alpha ?? 1
        g.drawImage(this.room, 0, 0)
        g.restore()
      }
    }
    this.drawLight(g, light)
    for (const p of order) this.drawBubbleFor(g, p, t)
    for (const [id, el] of this.plates) el.classList.toggle('is-away', this.people.get(id)?.state === 'away')
    this.drawSpeech(t)
    this.drawFlyers(g)
    if (QS.has('debug') && location.hash === '#marks') this.drawDebug(g)
  }

  drawSpeech(t) {
    const s = this.scale
    for (const [id, el] of this.speechEls) {
      const p = this.people.get(id)
      const show = p && p.speech && t < p.speechUntil && p.state !== 'away'
      if (!show) { if (!el.hidden) el.hidden = true; if (p && p.speech && t >= p.speechUntil) p.speech = null; continue }
      if (el.textContent !== p.speech) el.textContent = p.speech
      el.hidden = false
      el.style.left = `${p.x * s}px`
      el.style.top = `${((p.head || p.y - 50) - 2) * s}px`
    }
  }

  drawDebug(g) {
    g.save()
    g.lineWidth = 1
    g.strokeStyle = '#ff00ff'
    for (const q of WINDOWS) { this.poly(g, q); g.stroke() }
    g.fillStyle = '#ff00ff'
    for (const sp of [...Object.values(SPOTS), ...Object.values(SEATS), ...Object.values(SEATS).map((x) => x.exit)]) g.fillRect(sp.x - 1, sp.y - 1, 3, 3)
    g.restore()
  }

  px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h) }

  poly(g, pts) {
    g.beginPath()
    g.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y)
    g.closePath()
  }

  // 1 at midday, 0 at night, with dawn/dusk in between (Astana local time).
  daylight() {
    const now = astanaNow()
    const h = now.getHours() + now.getMinutes() / 60
    const month = now.getMonth()
    // rough sunrise/sunset for Astana by season
    const rise = [8.6, 8.0, 7.0, 6.0, 5.0, 4.4, 4.7, 5.4, 6.3, 7.2, 8.0, 8.7][month]
    const set = [17.2, 18.0, 18.9, 19.8, 20.6, 21.3, 21.2, 20.4, 19.2, 18.0, 17.1, 16.8][month]
    if (h < rise - 0.7 || h > set + 0.7) return 0
    if (h < rise + 0.7) return (h - (rise - 0.7)) / 1.4
    if (h > set - 0.7) return ((set + 0.7) - h) / 1.4
    return 1
  }

  // Splits the window glass into sky and city by colour, once: night and sunset then
  // paint only the sky, and evening lights appear only on buildings.
  // Cut-outs of the plants from the room picture with the wooden floor made transparent.
  plantMasks() {
    for (const o of OCCLUDERS) {
      if (!o.name?.startsWith('plant')) continue
      const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1])
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const cx = c.getContext('2d')
      cx.drawImage(this.room, -x0, -y0)
      const img = cx.getImageData(0, 0, w, h)
      const d = img.data
      // the floor is warm wood (red well above blue); leaves are green, the pot white-blue
      for (let i = 0; i < d.length; i += 4) if (d[i] - d[i + 2] > 45 && d[i] >= d[i + 1]) d[i + 3] = 0
      cx.putImageData(img, 0, 0)
      Object.assign(o, { mask: c, mx: x0, my: y0 })
    }
  }

  analyseWindows() {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const cx = c.getContext('2d')
    cx.drawImage(this.room, 0, 0)
    const data = cx.getImageData(0, 0, W, H).data
    const inside = (x, y, poly) => {
      let hit = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    }
    const night = cx.createImageData(W, H)
    const dusk = cx.createImageData(W, H)
    const sky = [], city = []
    for (const win of WINDOWS) {
      const xs = win.map((p) => p[0]), ys = win.map((p) => p[1])
      const top = Math.min(...ys), bottom = Math.max(...ys)
      for (let y = top; y <= bottom; y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        if (!inside(x + 0.5, y + 0.5, win)) continue
        const i = (y * W + x) * 4
        const r = data[i], gg = data[i + 1], b = data[i + 2]
        const isSky = b > 225 && gg > 185 && b > r + 35
        if (isSky) {
          sky.push([x, y])
          night.data.set([16, 24, 58, 235], i)
          const k = (y - top) / (bottom - top)
          dusk.data.set([240, 140 - 40 * k, 80, Math.round(200 * k)], i)
        } else if (b < 200 && r < 200) city.push([x, y])
      }
    }
    const toCanvas = (img) => { const cc = document.createElement('canvas'); cc.width = W; cc.height = H; cc.getContext('2d').putImageData(img, 0, 0); return cc }
    this.nightSky = toCanvas(night)
    this.duskSky = toCanvas(dusk)
    const pickSome = (list, n) => Array.from({ length: Math.min(n, list.length) }, () => list[Math.floor(Math.random() * list.length)])
    this.stars = pickSome(sky.filter(([, y]) => true), 45).map(([x, y]) => [x, y, Math.random()])
    this.lit = pickSome(city, 70).map(([x, y]) => [x, y, Math.random() < 0.65])
  }

  drawSky(g, t, light) {
    if (light >= 1 || !this.nightSky) return
    const dusk = light > 0 ? 1 - Math.abs(light - 0.5) * 2 : 0
    g.save()
    g.globalAlpha = 1 - light
    g.drawImage(this.nightSky, 0, 0)
    if (dusk > 0) { g.globalAlpha = dusk; g.drawImage(this.duskSky, 0, 0) }
    g.globalAlpha = 1 - light
    for (const [x, y, tw] of this.stars) if (Math.sin(t * 2 + tw * 10) < 0.6) this.px(g, x, y, 1, 1, '#f5f2d0')
    for (const [x, y, on] of this.lit) if (on) this.px(g, x, y, 1, 1, '#ffd36b')
    g.restore()
    // red warning light on top of the crane at night
    if (light < 0.5 && Math.floor(t * 1.5) % 2) this.px(g, 179, 106, 2, 2, "#ff3b30")
  }

  // Indoors gets darker in the evening, with warm lamp light around desks still in use.
  drawLight(g, light) {
    if (light >= 1) return
    g.save()
    this.poly(g, ROOM_SHAPE)
    g.clip()
    g.globalAlpha = 0.45 * (1 - light)
    g.fillStyle = '#1b2240'
    g.globalCompositeOperation = 'multiply'
    g.fillRect(0, 0, W, H)
    g.globalCompositeOperation = 'lighter'
    for (const p of this.people.values()) {
      if (p.state !== 'seated' && p.state !== 'seatedIdle') continue
      const grd = g.createRadialGradient(p.x, p.y - 30, 2, p.x, p.y - 30, 46)
      grd.addColorStop(0, 'rgba(255,200,120,0.35)')
      grd.addColorStop(1, 'rgba(255,200,120,0)')
      g.globalAlpha = 1 - light
      g.fillStyle = grd
      g.fillRect(p.x - 46, p.y - 76, 92, 92)
    }
    g.restore()
  }

  drawScreens(g, t) {
    for (const [id, scr] of Object.entries(this.screens)) {
      const p = this.people.get(id)
      const e = this.employees.get(id)
      const seated = p && (p.state === 'seated' || p.state === 'seatedIdle')
      if (!seated) continue
      const gaming = p.state === 'seatedIdle' && p.mode === 'game'
      const working = e?.status === 'working'
      if (!gaming && !working) continue
      g.save()
      g.beginPath()
      for (const [rx, ry, len] of scr.runs) g.rect(rx, ry, len, 1)
      g.clip()
      // draw in the screen's own plane: x along the screen, y straight down
      g.transform(1, scr.slope, 0, 1, scr.x0, scr.yl)
      const x0 = 0, y0 = 0, w = scr.w, h = scr.h
      if (gaming) {
        // a tiny platformer: sky, ground and a jumping hero
        this.px(g, x0, y0, w, h, '#5c94fc')
        this.px(g, x0, y0 + h - 8, w, 8, '#c84c0c')
        const hx = x0 + ((t * 8) % w)
        const hy = y0 + h - 12 - Math.abs(Math.sin(t * 4)) * 6
        this.px(g, hx, hy, 3, 4, '#e44e2c')
        this.px(g, x0 + ((t * 5 + 9) % w), y0 + h - 11, 3, 3, '#7a3d0c')
      } else {
        this.screenWork(g, id, w, h, t)
      }
      g.restore()
    }
  }

  // What each person has on the monitor while working, in the screen's own plane.
  screenWork(g, id, w, h, t) {
    const R = (x, y, ww, hh, c) => this.px(g, x, y, ww, hh, c)
    const T = Math.floor(t * 6)
    if (id === 'smm') {
      // a grid of posts that keeps changing, a blinking like
      R(0, 0, w, h, '#f4ece0')
      const cols = ['#47724F', '#e2a31b', '#7fc7a8', '#d9734e', '#5c7cfa', '#b4dcc0']
      for (let i = 0; i < 9; i++) R(2 + (i % 3) * 5, 2 + Math.floor(i / 3) * 5, 4, 4, cols[(i + Math.floor(t * 1.5)) % 6])
      if (T % 4 < 2) R(w - 4, h - 4, 2, 2, '#e5484d')
    } else if (id === 'montazh') {
      // video preview and a scrolling timeline with a red playhead
      R(0, 0, w, h, '#1b1d2a')
      R(2, 2, w - 4, 8, ['#3d6fb6', '#4f8f5f', '#b6703d'][Math.floor(t * 1.5) % 3])
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) R((((i * 7 - t * 9 * (r + 1)) % (w + 6)) + w + 6) % (w + 6) - 4, 12 + r * 2, 5, 1, ['#e2a31b', '#7fc7a8', '#d96a8a'][r])
      R(Math.floor(w / 2), 11, 1, 7, '#ff5555')
    } else if (id === 'marketing') {
      // ad results: bars going up and down
      R(0, 0, w, h, '#10263a')
      for (let i = 0; i < 5; i++) { const v = 3 + Math.round((Math.sin(t * 2 + i) * 0.5 + 0.5) * 3 + i * 1.6); R(2 + i * 3, h - 2 - v, 2, v, i === 4 ? '#7fe0a0' : '#5aa9e6') }
    } else if (id === 'sales') {
      // a list of leads, statuses lighting up
      R(0, 0, w, h, '#14324a')
      for (let i = 0; i < 6; i++) { R(2, 2 + i * 3, 9, 1, '#bfe3f7'); if ((i + T) % 6 < 5) R(w - 5, 2 + i * 3, 2, 1, ['#7fe0a0', '#f2c94c', '#5aa9e6'][(i + T) % 3]) }
    } else if (id === 'revenue') {
      // revenue line drawing itself
      R(0, 0, w, h, '#102a1c')
      const n = Math.min(w - 2, Math.floor((t * 10) % (w + 8)))
      let lx = 1, ly = h - 3
      for (let x = 1; x < n; x++) { const y = Math.round(h - 3 - x * 0.55 - Math.sin(x * 1.3) * 1.2); R(x, y, 1, 1, '#7fe0a0'); lx = x; ly = y }
      R(lx, ly - 1, 2, 2, '#ffffff')
    } else {
      R(0, 0, w, h, '#14324a')
      const off = Math.floor(t * 4)
      for (let i = 0; i < 7; i++) R(2, 4 + i * 3, 3 + ((off + i * 5) % 12), 1, i % 2 ? '#7fc7a8' : '#bfe3f7')
    }
  }

  drawBubbleFor(g, p, t) {
    const e = this.employees.get(p.id)
    const fl = this.flash.get(p.id)
    const now = performance.now() / 1000
    let kind = null
    if (e?.status === 'waiting') kind = 'wait'
    else if (e?.status === 'working') kind = e.activity?.kind || 'think'
    else if (fl && fl.until > now) kind = fl.kind
    else if (p.state === 'seatedIdle' && p.mode === 'idle' && e?.status === 'soon') kind = 'sleep'
    else if (p.waveUntil > now) kind = 'wave'
    else if (p.state === 'seatedIdle' && p.mode === 'relax' && p.id === 'montazh') kind = 'music'
    if (kind) this.drawBubble(g, Math.round(p.x), Math.round((p.head || p.y - 50) - 4), kind, t)
    if (this.selected === p.id) {
      const y = Math.round(p.y + 2)
      this.px(g, p.x - 7, y, 15, 2, '#e2a31b')
      this.px(g, p.x - 3, y + 2, 7, 2, '#e2a31b')
    }
  }

  drawBubble(g, cx, bottom, kind, t) {
    const bounce = kind === 'wait' || kind === 'error' ? (Math.floor(t * 3) % 2) : 0
    if (kind === 'sleep' || kind === 'music') {
      const k = (t * 0.6) % 1
      g.save()
      g.globalAlpha = 1 - k
      g.fillStyle = kind === 'sleep' ? '#ffffff' : '#ffe08a'
      g.font = 'bold 9px monospace'
      g.fillText(kind === 'sleep' ? 'z' : '♪', cx + 4 + k * 6, bottom - k * 12)
      g.font = 'bold 7px monospace'
      g.fillText(kind === 'sleep' ? 'z' : '♫', cx + 10 + k * 4, bottom - 8 - k * 10)
      g.restore()
      return
    }
    const x = cx - 7
    const y = bottom - 13 - bounce
    const fill = kind === 'wait' ? '#f2c94c' : kind === 'done' ? '#7fcf8f' : kind === 'error' ? '#ef7f6a' : '#ffffff'
    this.px(g, x + 1, y, 13, 11, INK)
    this.px(g, x, y + 1, 15, 9, INK)
    this.px(g, x + 1, y + 1, 13, 9, fill)
    this.px(g, cx - 1, y + 11, 3, 1, INK); this.px(g, cx, y + 12, 1, 1, INK)
    const ix = x + 4, iy = y + 2
    const p = (dx, dy, w = 1, h = 1, col = INK) => this.px(g, ix + dx, iy + dy, w, h, col)
    switch (kind) {
      case 'wait':
      case 'error':
        p(3, 0, 1, 4); p(3, 5)
        break
      case 'done':
        p(0, 3); p(1, 4); p(2, 5); p(3, 4); p(4, 3); p(5, 2); p(6, 1)
        break
      case 'wave':
        p(1, 1, 1, 4, '#c98a5c'); p(2, 0, 1, 5, '#c98a5c'); p(3, 0, 1, 5, '#c98a5c'); p(4, 1, 1, 4, '#c98a5c'); p(0, 3, 1, 2, '#c98a5c')
        break
      case 'read':
      case 'say':
        p(0, 0, 7, 6, '#e9e4d8'); p(1, 1, 5, 1, '#8a8378'); p(1, 3, 4, 1, '#8a8378'); p(1, 5, 3, 1, '#8a8378')
        break
      case 'write':
        p(1, 5); p(2, 4); p(3, 3); p(4, 2); p(5, 1); p(6, 0, 1, 1, '#c8452f'); p(0, 5, 1, 1, '#555')
        break
      case 'search':
      case 'web':
        p(1, 0, 3, 1); p(0, 1, 1, 2); p(4, 1, 1, 2); p(1, 3, 3, 1); p(4, 4); p(5, 5)
        break
      case 'run':
      case 'tool':
        p(2, 0, 3, 1); p(1, 1, 5, 3); p(2, 4, 3, 1); p(3, 2, 1, 1, '#ffffff')
        break
      default: {
        const n = Math.floor(t * 3) % 4
        for (let i = 0; i < 3; i++) if (i < n) p(i * 2 + 1, 3, 1, 1)
      }
    }
  }

  // While people work, small data packets run between their desks and to the manager.
  ambientData(t) {
    if (t < (this.nextData || 0)) return
    this.nextData = t + 2.5 + Math.random() * 3
    const busy = [...this.people.values()].filter((p) => p.state === 'seated' && this.employees.get(p.id)?.status === 'working')
    if (!busy.length) return
    const a = pick(busy)
    const others = [...this.people.values()].filter((q) => q !== a && q.state !== 'away' && q.state !== 'walking')
    const b = others.find((q) => q.id === 'manager' && Math.random() < 0.5) || (others.length ? pick(others) : null)
    if (b) this.flyers.push({ x0: a.x, y0: a.y - 34, x1: b.x, y1: b.y - 34, t0: t, dur: 1.1 + Math.random() * 0.5 })
  }

  // Tasks fly as a sheet with a glowing trail; plain data as a glowing dot.
  drawFlyers(g) {
    const now = performance.now() / 1000
    this.ambientData(now)
    this.flyers = this.flyers.filter((f) => now - f.t0 < f.dur + 0.5)
    const at = (f, k) => [f.x0 + (f.x1 - f.x0) * k, f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * (f.doc ? 40 : 26)]
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const f of this.flyers) {
      const k = (now - f.t0) / f.dur
      const col = f.doc ? '255,214,120' : '127,224,160'
      if (k <= 1) {
        for (let i = 10; i >= 0; i--) {
          const v = Math.max(0, k - i * 0.025)
          const [x, y] = at(f, v)
          g.fillStyle = `rgba(${col},${i === 0 ? 0.9 : 0.45 - i * 0.04})`
          g.beginPath(); g.arc(x, y, i === 0 ? 2.2 : 1.8 - i * 0.12, 0, 7); g.fill()
        }
        const [x, y] = at(f, k)
        const gr = g.createRadialGradient(x, y, 0, x, y, 9)
        gr.addColorStop(0, `rgba(${col},.5)`); gr.addColorStop(1, `rgba(${col},0)`)
        g.fillStyle = gr; g.fillRect(x - 9, y - 9, 18, 18)
      } else {
        // arrival ring
        const v = (k - 1) / (0.5 / f.dur)
        g.strokeStyle = `rgba(${col},${0.8 * (1 - v)})`; g.lineWidth = 1.2
        g.beginPath(); g.arc(f.x1, f.y1, 3 + v * 12, 0, 7); g.stroke()
      }
    }
    g.restore()
    for (const f of this.flyers) {
      const k = (now - f.t0) / f.dur
      if (!f.doc || k > 1) continue
      const [x, y] = at(f, k)
      this.px(g, x - 4, y - 5, 8, 10, INK)
      this.px(g, x - 3, y - 4, 6, 8, '#fbfaf5')
      this.px(g, x - 2, y - 2, 4, 1, '#8a8378'); this.px(g, x - 2, y, 4, 1, '#8a8378')
    }
  }
}
