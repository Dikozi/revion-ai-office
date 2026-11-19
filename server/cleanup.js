// Daily housekeeping, so client data and working copies do not pile up for years.
// - inbox: chats and client tables after 7 days, any file after 180 days;
// - work/<task>: working copies (_материалы, _данные, _база, _от_коллег, _раскадровка) after 30 days,
//   results (posts, reports, reels) stay;
// - data/events/<id>.jsonl after 180 days.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { DATA_RE } from './sales.js'

const DAY = 864e5
const WORKING = ['_материалы', '_данные', '_база', '_от_коллег', '_раскадровка']
const age = (p) => { try { return Date.now() - fs.statSync(p).mtimeMs } catch { return 0 } }

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    let st
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) {
      walk(p, fn)
      try { if (!fs.readdirSync(p).length) fs.rmdirSync(p) } catch {}
    } else fn(p)
  }
}

export function cleanup() {
  const removed = { inbox: 0, work: 0, events: 0 }
  walk(P.inbox, (f) => {
    if (path.basename(f) === '.gitkeep') return
    const a = age(f)
    if ((DATA_RE.test(f) && a > 7 * DAY) || a > 180 * DAY) { fs.rmSync(f, { force: true }); removed.inbox++ }
  })
  if (fs.existsSync(P.work)) {
    for (const id of fs.readdirSync(P.work)) {
      const ws = path.join(P.work, id)
      if (id.startsWith('_') || age(ws) < 30 * DAY) continue
      for (const sub of WORKING) {
        const p = path.join(ws, sub)
        if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.work++ }
      }
    }
  }
  const ev = path.join(P.data, 'events')
  if (fs.existsSync(ev)) {
    for (const f of fs.readdirSync(ev)) {
      const p = path.join(ev, f)
      if (age(p) > 180 * DAY) { fs.rmSync(p, { force: true }); removed.events++ }
    }
  }
  return removed
}

export function startCleanup() {
  const run = () => { try { cleanup() } catch (e) { console.error('Уборка:', e.message) } }
  setTimeout(run, 5 * 60 * 1000).unref?.()
  setInterval(run, DAY).unref?.()
}
