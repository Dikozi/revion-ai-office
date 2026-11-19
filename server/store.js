import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { P } from './paths.js'

const STATE_FILE = path.join(P.data, 'state.json')
const KEEP_TASKS = 500
const KEEP_PLANS = 200
const MEM_EVENTS = 300

export class Store extends EventEmitter {
  constructor() {
    super()
    fs.mkdirSync(P.events, { recursive: true })
    this.tasks = []
    this.plans = []
    this.usage = {}
    this.memEvents = new Map()
    this.saveTimer = null
    this.load()
  }

  load() {
    if (!fs.existsSync(STATE_FILE) && !fs.existsSync(STATE_FILE + '.bak')) return
    const read = (f) => {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'))
      this.tasks = s.tasks || []
      this.plans = s.plans || []
      this.usage = s.usage || {}
    }
    try {
      read(STATE_FILE)
    } catch (e) {
      // a damaged file is kept aside and the last backup is used instead of starting empty
      console.error('Не удалось прочитать data/state.json:', e.message)
      try { if (fs.existsSync(STATE_FILE)) fs.renameSync(STATE_FILE, STATE_FILE.replace(/\.json$/, `.broken-${Date.now()}.json`)) } catch {}
      try { read(STATE_FILE + '.bak'); console.error('Взята резервная копия data/state.json.bak') } catch {}
    }
    for (const t of this.tasks) {
      if (t.status === 'running') {
        t.status = 'failed'
        t.error = 'Офис был выключен во время работы. Нажмите «Повторить».'
        t.finishedAt = new Date().toISOString()
      }
    }
    for (const p of this.plans) {
      if (p.status === 'thinking' || p.status === 'queued') {
        p.status = 'failed'
        p.error = 'Офис был выключен, пока руководитель думал. Нажмите «Попробовать снова».'
      }
    }
  }

  save() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  flush() {
    clearTimeout(this.saveTimer)
    this.tasks = this.tasks.slice(-KEEP_TASKS)
    this.plans = this.plans.slice(-KEEP_PLANS)
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ tasks: this.tasks, plans: this.plans, usage: this.usage }, null, 1), 'utf8')
    // a backup of the last good state, refreshed at most every 10 minutes
    if (fs.existsSync(STATE_FILE) && Date.now() - (this.backedUp || 0) > 10 * 60 * 1000) {
      try { fs.copyFileSync(STATE_FILE, STATE_FILE + '.bak'); this.backedUp = Date.now() } catch {}
    }
    fs.renameSync(tmp, STATE_FILE)
  }

  id(prefix) {
    const d = new Date()
    const stamp = `${d.getFullYear() % 100}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    return `${prefix}-${stamp}-${crypto.randomBytes(3).toString('hex')}`
  }

  task(id) { return this.tasks.find((t) => t.id === id) }
  plan(id) { return this.plans.find((p) => p.id === id) }

  addTask(t) {
    const task = {
      id: this.id('t'),
      status: 'queued',
      dependsOn: [],
      attachments: [],
      createdAt: new Date().toISOString(),
      ...t,
    }
    this.tasks.push(task)
    this.save()
    this.emit('task', task)
    return task
  }

  updateTask(id, patch) {
    const t = this.task(id)
    if (!t) return null
    Object.assign(t, patch)
    this.save()
    this.emit('task', t)
    return t
  }

  addPlan(p) {
    const plan = { id: this.id('p'), createdAt: new Date().toISOString(), steps: [], taskIds: [], ...p }
    this.plans.push(plan)
    this.save()
    this.emit('plan', plan)
    return plan
  }

  updatePlan(id, patch) {
    const p = this.plan(id)
    if (!p) return null
    Object.assign(p, patch)
    this.save()
    this.emit('plan', p)
    return p
  }

  setUsage(u) {
    this.usage = { ...this.usage, ...u, updatedAt: new Date().toISOString() }
    this.save()
    this.emit('usage', this.usage)
  }

  appendEvent(key, ev) {
    const entry = { at: new Date().toISOString(), ...ev }
    const list = this.memEvents.get(key) || []
    list.push(entry)
    if (list.length > MEM_EVENTS) list.splice(0, list.length - MEM_EVENTS)
    this.memEvents.set(key, list)
    fs.appendFile(path.join(P.events, `${key}.jsonl`), JSON.stringify(entry) + '\n', () => {})
    this.emit('event', { key, entry })
    return entry
  }

  events(key) {
    if (this.memEvents.has(key)) return this.memEvents.get(key)
    const f = path.join(P.events, `${key}.jsonl`)
    if (!/^[a-z]-[0-9]{6}-[0-9a-f]{6}$/.test(key) || !fs.existsSync(f)) return []
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-MEM_EVENTS).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  }
}
