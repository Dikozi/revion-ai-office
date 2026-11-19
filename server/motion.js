// Motion stories: Мадина's approved mockup (HTML) becomes a 15 s video with music.
// Chrome is driven over the DevTools pipe (no npm packages, no open port): the page gets
// entrance animations from a generic analyser, every frame is seeked exactly and captured,
// ffmpeg encodes the frames with a track from the approved list. The last frame must equal
// the approved PNG (SSIM check), otherwise the caller publishes the picture instead.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { P } from './paths.js'
import { pageSize } from './render.js'

const FPS = 30
const MUSIC_DIR = path.join(P.data, 'music')
const USED = path.join(P.data, 'smm', 'music-used.json')

// Mixkit Stock Music Free License: commercial use and social media, no attribution (approved by the owner 17.11.2026).
// start — the best 15 s of the track, picked by loudness.
export const TRACKS = [
  { id: 1167, title: 'Close Up', start: 12 },
  { id: 834, title: "It's Love", start: 36.5 },
  { id: 470, title: 'Golden Storm', start: 12.25 },
  { id: 501, title: 'Urban Grooves', start: 0 },
  { id: 480, title: 'Curiosity', start: 11.75 },
  { id: 963, title: 'Just Keep Walking', start: 8.5 },
]

function run(cmd, args, { input, timeout = 10 * 60e3 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout)
    // ffmpeg exiting early must not turn a write into an uncaught EPIPE that stops the office
    p.stdin?.on('error', () => {})
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000) })
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(err) : reject(new Error(err.slice(-300) || `${path.basename(cmd)} ${code}`)) })
    if (input) input(p.stdin)
  })
}

// ---------- music ----------

// least recently used track, never one of the last three; downloaded once into data/music
export async function pickTrack(list = TRACKS) {
  let used = []
  try { used = JSON.parse(fs.readFileSync(USED, 'utf8')) } catch {}
  const order = [...list].sort((a, b) => used.lastIndexOf(a.id) - used.lastIndexOf(b.id))
  for (const t of order) {
    const file = await trackFile(t).catch(() => null)
    if (!file) continue
    fs.mkdirSync(path.dirname(USED), { recursive: true })
    fs.writeFileSync(USED, JSON.stringify([...used, t.id].slice(-30)))
    return { ...t, file }
  }
  return null
}

async function trackFile(t) {
  const file = path.join(MUSIC_DIR, `${t.id}.mp3`)
  if (fs.existsSync(file) && fs.statSync(file).size > 100e3) return file
  const res = await fetch(t.url || `https://assets.mixkit.co/music/${t.id}/${t.id}.mp3`, { signal: AbortSignal.timeout(60e3) })
  const buf = Buffer.from(await res.arrayBuffer())
  if (!res.ok || buf.length < 100e3) throw new Error(`трек ${t.title} не скачался (${res.status})`)
  fs.mkdirSync(MUSIC_DIR, { recursive: true })
  fs.writeFileSync(file + '.tmp', buf)
  fs.renameSync(file + '.tmp', file)
  return file
}

// ---------- Chrome over the DevTools pipe ----------

class Cdp {
  constructor(browser, { w, h, profile }) {
    this.id = 0
    this.wait = new Map()
    this.events = []
    this.proc = spawn(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio',
      '--remote-debugging-pipe', `--user-data-dir=${profile}`, `--window-size=${w},${h}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true })
    // 'close' also comes when Chrome could not start at all (then there is no 'exit')
    this.dead = new Promise((resolve) => { this.proc.once('close', resolve); this.proc.once('error', resolve) })
    this.proc.on('error', () => {})
    this.proc.stdio[3]?.on('error', () => {})
    this.proc.stdio[4]?.on('error', () => {})
    this.dead.then(() => { for (const { reject } of this.wait.values()) reject(new Error('браузер закрылся')); this.wait.clear() })
    let buf = Buffer.alloc(0)
    this.proc.stdio[4].on('data', (d) => {
      buf = Buffer.concat([buf, d])
      for (let i = buf.indexOf(0); i >= 0; i = buf.indexOf(0)) {
        const msg = JSON.parse(buf.subarray(0, i).toString('utf8'))
        buf = buf.subarray(i + 1)
        if (msg.id && this.wait.has(msg.id)) {
          const { resolve, reject } = this.wait.get(msg.id)
          this.wait.delete(msg.id)
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
        } else if (msg.method) this.events.push(msg)
      }
    })
  }

  send(method, params = {}, sessionId, timeout = 60e3) {
    const id = ++this.id
    if (!this.proc.pid || this.proc.exitCode !== null || this.proc.signalCode) return Promise.reject(new Error('браузер не запущен'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wait.delete(id); reject(new Error(`браузер не ответил (${method})`)) }, timeout)
      this.wait.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      this.proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }

  async event(method, timeout = 30e3) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const i = this.events.findIndex((e) => e.method === method)
      if (i >= 0) return this.events.splice(i, 1)[0]
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`браузер не дождался ${method}`)
  }

  async close() {
    try { await this.send('Browser.close', {}, undefined, 5000) } catch {}
    const t = setTimeout(() => { try { this.proc.kill('SIGKILL') } catch {} }, 5000)
    await Promise.race([this.dead, new Promise((r) => setTimeout(r, 10000))])
    clearTimeout(t)
  }
}

// ---------- the page side: find the blocks of the mockup and give each an entrance ----------
// Runs through DevTools, so the page's own CSP (no scripts) stays in force for Мадина's HTML.
// Only opacity, translate, scale, clip-path and object-view-box are animated: her own transforms stay intact.
// Everything settles by 13.5 s, so the last frame is exactly the approved picture.
const ANALYSE = `(() => {
  const W = innerWidth, H = innerHeight, AREA = W * H, END = 13.5
  const css = (el) => getComputedStyle(el)
  const box = (el) => el.getBoundingClientRect()
  const shown = (el) => { const s = css(el), r = box(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.left < W && r.top < H }
  const huge = (el) => { const r = box(el); return r.width * r.height > 0.6 * AREA }
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
  const filled = (el) => { const s = css(el); return (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') }
  const photoBg = (el) => { const s = css(el); return s.backgroundImage !== 'none' && !/^(linear|radial|conic|repeating)-gradient/.test(s.backgroundImage) }
  const picked = new Set()
  for (const el of document.body.querySelectorAll('*')) {
    if (!shown(el) || el.closest('[data-motion-skip]')) continue
    const tag = el.tagName.toLowerCase()
    if (['img', 'svg', 'video', 'canvas', 'picture'].includes(tag) || el.hasAttribute('data-cover-ok')) { if (!huge(el)) picked.add(el.closest('picture') || el); continue }
    if (el.closest('svg')) continue
    if (photoBg(el) && !huge(el)) { picked.add(el); continue }
    if (ownText(el)) {
      // a label inside a chip or a plate moves together with it
      let unit = el
      for (let p = el.parentElement, k = 0; p && p !== document.body && k < 3; p = p.parentElement, k++) {
        if (filled(p) && !huge(p) && box(p).height < H * 0.3) { unit = p; break }
      }
      picked.add(unit)
    }
  }
  const units = [...picked].filter((el) => ![...picked].some((o) => o !== el && o.contains(el)))
  if (!units.length) return { units: 0 }
  const kindOf = (el) => {
    const r = box(el), s = css(el), tag = el.tagName.toLowerCase(), a = r.width * r.height
    const media = ['img', 'svg', 'video', 'canvas', 'picture'].includes(tag) || photoBg(el) || el.hasAttribute('data-cover-ok')
    if (media) return a > 0.12 * AREA ? 'photo' : 'icon'
    const radius = parseFloat(s.borderTopLeftRadius) || 0
    if (filled(el) && r.height < 160 && r.width < W * 0.85 && radius >= r.height / 3) return 'chip'
    if (filled(el)) return 'plate'
    return 'text'
  }
  // rows from top to bottom; blocks of one row come in left to right
  const list = units.map((el) => ({ el, r: box(el), kind: kindOf(el) })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
  const rows = []
  for (const u of list) {
    const row = rows.find((x) => Math.abs(x.top - u.r.top) < 24 && u.kind !== 'photo' && x.kind !== 'photo')
    if (row) row.items.push(u); else rows.push({ top: u.r.top, kind: u.kind, items: [u] })
  }
  const step = Math.min(0.16, 2.0 / Math.max(1, rows.length))
  const ease = 'cubic-bezier(.22,1,.36,1)', pop = 'cubic-bezier(.34,1.56,.64,1)'
  const anim = (el, frames, delay, duration, easing = ease, fill = 'both') => el.animate(frames, { delay: delay * 1000, duration: duration * 1000, easing, fill })
  const counters = []
  let photoAt = null
  rows.forEach((row, ri) => {
    row.items.sort((a, b) => a.r.left - b.r.left).forEach((u, i) => {
      const t = 0.15 + ri * step + i * 0.09, el = u.el, s = css(el)
      if (u.kind === 'photo') {
        const rad = s.borderTopLeftRadius && s.borderTopLeftRadius !== '0px' ? ' round ' + s.borderTopLeftRadius : ''
        anim(el, [{ clipPath: 'inset(100% 0 0 0' + rad + ')' }, { clipPath: 'inset(0 0 0 0' + rad + ')' }], t, 0.9)
        // slow zoom inside the frame until the end; a picture tag zooms its img
        const img = el.tagName === 'IMG' ? el : el.querySelector('img')
        if (img) anim(img, [{ objectViewBox: 'inset(5% 5% 5% 5%)' }, { objectViewBox: 'inset(0% 0% 0% 0%)' }], t, END - t, 'cubic-bezier(.3,.5,.4,1)')
        photoAt ??= t
      } else if (u.kind === 'chip') {
        anim(el, [{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }], t, 0.55, pop)
        for (const at of [6, 11.5]) anim(el, [{ scale: 1 }, { scale: 1.07, offset: 0.45 }, { scale: 1 }], at + i * 0.15, 0.6, 'ease-in-out', 'none')
      } else if (u.kind === 'plate') {
        anim(el, [{ opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }], t, 0.6)
      } else if (u.kind === 'icon') {
        anim(el, [{ opacity: 0, translate: '0 -18px' }, { opacity: 1, translate: '0 0' }], t, 0.6)
      } else {
        anim(el, [{ opacity: 0, translate: '0 36px' }, { opacity: 1, translate: '0 0' }], t, 0.65)
      }
      // big numbers (prices, areas) count up; years are left alone — a rolling «2026» would be a wrong date
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (walk.nextNode()) {
        const n = walk.currentNode, m = n.textContent.match(/\\d[\\d\\s\\u00a0]*(?:[.,]\\d+)?/)
        if (!m || parseFloat(css(n.parentElement).fontSize) < 44) continue
        const raw = m[0].trim(), digits = raw.replace(/[\\s\\u00a0]/g, ''), value = parseFloat(digits.replace(',', '.'))
        if (!(value >= 10) || /^(19|20)\\d\\d$/.test(digits)) continue
        const dec = (digits.split(/[.,]/)[1] || '').length, sep = (raw.match(/[\\s\\u00a0]/) || [''])[0], mark = digits.includes(',') ? ',' : '.'
        const fmt = (v) => { let [a, b] = v.toFixed(dec).split('.'); if (sep) a = a.replace(/\\B(?=(\\d{3})+(?!\\d))/g, sep); return b ? a + mark + b : a }
        const holder = n.parentElement, w = holder.getBoundingClientRect().width
        counters.push({ n, text: n.textContent, start: m.index, len: m[0].length, lead: m[0].match(/^\\s*/)[0], tail: m[0].match(/\\s*$/)[0], fmt, value, t0: t + 0.1, t1: t + 1.1, holder, w, style: holder.getAttribute('style') })
      }
    })
  })
  const easeOut = (x) => 1 - Math.pow(1 - x, 3)
  window.__seek = (sec) => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = sec * 1000 }
    for (const c of counters) {
      if (sec >= c.t1 || sec < c.t0) {
        if (c.n.textContent !== c.text) { c.n.textContent = c.text; c.style == null ? c.holder.removeAttribute('style') : c.holder.setAttribute('style', c.style) }
        continue
      }
      const v = c.value * easeOut((sec - c.t0) / (c.t1 - c.t0))
      c.n.textContent = c.text.slice(0, c.start) + c.lead + c.fmt(v) + c.tail + c.text.slice(c.start + c.len)
      // the block keeps its width while digits change, so nothing around it jumps
      c.holder.style.minWidth = c.w + 'px'; c.holder.style.whiteSpace = 'nowrap'; c.holder.style.fontVariantNumeric = 'tabular-nums'
    }
    return true
  }
  window.__seek(0)
  return { units: list.length, rows: rows.length, kinds: list.map((u) => u.kind), counters: counters.length, photo: photoAt != null }
})()`

// html: Мадина's mockup; png: the approved picture made from it; out: the mp4.
export async function makeVideo({ browser, ffmpeg, html, png, out, seconds = 15, track }) {
  if (!browser) throw new Error('нет Chrome')
  if (!ffmpeg?.ffmpeg) throw new Error('нет ffmpeg')
  const src = fs.readFileSync(html, 'utf8')
  const [w, h] = pageSize(src, path.basename(html))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-motion-'))
  // next to the original, so relative paths like _материалы/photo.jpg still resolve
  const page = path.join(path.dirname(html), `.motion-${process.pid}-${Date.now()}.html`)
  const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src file: data:; style-src 'unsafe-inline' file: https://fonts.googleapis.com; font-src file: data: https://fonts.gstatic.com">`
  let text = src.split('{{ASSETS}}').join(pathToFileURL(P.assets).href)
  text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (m) => m + CSP) : CSP + text
  fs.writeFileSync(page, text, 'utf8')
  const last = path.join(tmp, 'last.png')
  const cdp = new Cdp(browser, { w, h, profile: path.join(tmp, 'profile') })
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, s)
    await cdp.send('Page.enable', {}, s)
    await cdp.send('Page.navigate', { url: pathToFileURL(page).href }, s)
    await cdp.event('Page.loadEventFired')
    await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))', awaitPromise: true }, s)
    const info = (await cdp.send('Runtime.evaluate', { expression: ANALYSE, returnByValue: true }, s)).result.value
    if (!info?.units || info.units < 2) throw new Error('не нашёл в макете блоков для анимации')

    const frames = Math.round(seconds * FPS)
    const args = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-']
    if (track) args.push('-ss', String(track.start || 0), '-t', String(seconds), '-i', track.file)
    else args.push('-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=48000:cl=stereo')
    args.push('-map', '0:v', '-map', '1:a', '-af', `afade=t=in:d=0.3,afade=t=out:st=${seconds - 1.8}:d=1.8,loudnorm=I=-16:TP=-1.5,aresample=48000`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '128k', '-t', String(seconds), '-movflags', '+faststart', out)
    let lastFrame = null
    await run(ffmpeg.ffmpeg, args, {
      input: async (stdin) => {
        try {
          for (let i = 0; i < frames && !stdin.destroyed; i++) {
            await cdp.send('Runtime.evaluate', { expression: `__seek(${(i / FPS).toFixed(4)})` }, s)
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }, s)
            lastFrame = Buffer.from(data, 'base64')
            if (!stdin.write(lastFrame)) await new Promise((r) => { const go = () => { stdin.off('drain', go); stdin.off('close', go); r() }; stdin.on('drain', go); stdin.on('close', go) })
          }
          stdin.end()
        } catch {
          // ffmpeg gets a cut stream, exits non-zero and run() rejects
          lastFrame = null
          stdin.destroy()
        }
      },
    })
    if (!lastFrame) throw new Error('кадры не снялись')
    // the settled frame as a lossless PNG for the comparison
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, s)
    fs.writeFileSync(last, Buffer.from(data, 'base64'))
    const ssim = await similarity(ffmpeg, last, png, w, h)
    if (ssim < 0.97) throw new Error(`конец видео не совпал с утверждённой картинкой (сходство ${ssim.toFixed(3)})`)
    return { seconds, ssim, units: info.units, track: track?.title || null }
  } catch (e) {
    fs.rmSync(out, { force: true })
    throw e
  } finally {
    await cdp.close()
    fs.rmSync(page, { force: true })
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function similarity(ffmpeg, a, b, w, h) {
  const err = await run(ffmpeg.ffmpeg, ['-v', 'info', '-i', a, '-i', b, '-lavfi', `[0:v]scale=${w}:${h},format=yuv420p[x];[1:v]scale=${w}:${h},format=yuv420p[y];[x][y]ssim`, '-f', 'null', '-'])
  const m = err.match(/All:([\d.]+)/)
  return m ? Number(m[1]) : 0
}
