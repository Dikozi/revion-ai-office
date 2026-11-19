import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { P } from './paths.js'

const IS_WIN = process.platform === 'win32'
const SIZES = { '9x16': [1080, 1920], '4x5': [1080, 1350], '3x4': [1080, 1440], '1x1': [1080, 1080] }

export function findBrowser(configured) {
  if (configured) return fs.existsSync(configured) ? configured : null
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA || ''
  const list = IS_WIN
    ? [
        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  return list.find((p) => p && fs.existsSync(p)) || null
}

// <meta name="size" content="1080x1350">, else a 9x16/4x5/3x4/1x1 hint in the file name, else 4:5.
export function pageSize(html, name) {
  const meta = html.match(/<meta\s+name=["']size["']\s+content=["']\s*(\d{3,5})\s*[x×х]\s*(\d{3,5})\s*["']/i)
  if (meta) return [Number(meta[1]), Number(meta[2])]
  const hit = Object.keys(SIZES).find((k) => name.toLowerCase().includes(k))
  return SIZES[hit || '4x5']
}

let chain = Promise.resolve()

// Renders an HTML mockup into a PNG with the same name next to it.
// Runs one at a time: Chrome locks its profile folder.
export function renderHtml(browser, file, { transparent = false } = {}) {
  const run = () => new Promise((resolve, reject) => {
    const html = fs.readFileSync(file, 'utf8')
    const [w, h] = pageSize(html, path.basename(file))
    const out = file.replace(/\.html?$/i, '.png')
    // Next to the original, so relative paths like _материалы/photo.jpg still resolve.
    const tmp = path.join(path.dirname(file), `.render-${process.pid}.html`)
    fs.rmSync(out, { force: true })
    // An employee's HTML must not be able to send anything out (e.g. after a prompt injection):
    // no scripts, and nothing from the network except Google Fonts.
    const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src file: data:; style-src 'unsafe-inline' file: https://fonts.googleapis.com; font-src file: data: https://fonts.gstatic.com">`
    let page = html.split('{{ASSETS}}').join(pathToFileURL(P.assets).href)
    page = /<head[^>]*>/i.test(page) ? page.replace(/<head[^>]*>/i, (m) => m + CSP) : CSP + page
    fs.writeFileSync(tmp, page, 'utf8')
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(P.data, 'chrome')}`,
      `--window-size=${w},${h}`,
      // lets web fonts finish loading before the shot
      '--virtual-time-budget=15000',
      ...(transparent ? ['--default-background-color=00000000'] : []),
      `--screenshot=${out}`,
      pathToFileURL(tmp).href,
    ]
    let hung = false
    const child = execFile(browser, args, { windowsHide: true }, () => {
      clearTimeout(timer)
      fs.rmSync(tmp, { force: true })
      if (fs.existsSync(out)) resolve(out)
      else reject(new Error(hung ? 'браузер не ответил за 90 секунд' : 'браузер не сохранил картинку'))
    })
    // a hung Chrome is stopped with all its renderer processes, otherwise they lock the profile for later renders
    const timer = setTimeout(() => {
      hung = true
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {})
      else child.kill('SIGKILL')
    }, 90000)
  })
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

// What a designer would notice at a glance, measured in the real layout:
// text running off the canvas, text covered by another block, clipped or overlapping text,
// text too small for a phone, text in the bottom zone of a story that Instagram's UI hides.
// Blocks marked data-cover-ok (e.g. a house cut-out over a headline) may cover text on purpose.
const CHECK = `document.fonts.ready.then(() => setTimeout(() => {
  const W = __W__, H = __H__, out = []
  const shown = (el) => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05 }
  const texts = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walk.nextNode()) {
    const n = walk.currentNode, t = n.textContent.replace(/\\s+/g, ' ').trim(), el = n.parentElement
    if (!t || !el || !shown(el)) continue
    const r = document.createRange(); r.selectNodeContents(n)
    const rects = [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1).map((x) => ({ left: x.left, right: x.right, width: x.width, top: x.top + x.height * 0.2, bottom: x.bottom - x.height * 0.2, height: x.height * 0.6 }))
    if (rects.length) texts.push({ el, t: t.slice(0, 40), rects, fs: parseFloat(getComputedStyle(el).fontSize) })
  }
  const q = (x) => '«' + x.t + '»'
  for (const x of texts) {
    if (x.rects.some((r) => r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2)) out.push(q(x) + ' выходит за край картинки')
    if (x.fs < 16) out.push(q(x) + ' слишком мелкий (' + Math.round(x.fs) + ' px) — на телефоне не прочитать')
    const r = x.rects[0]
    for (const [px, py] of [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 6, r.top + r.height / 2], [r.right - 6, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height * 0.3], [r.left + r.width / 2, r.bottom - r.height * 0.3]]) {
      if (px < 0 || py < 0 || px > W || py > H) continue
      const hit = document.elementFromPoint(px, py)
      if (hit && hit !== x.el && !x.el.contains(hit) && !hit.contains(x.el) && !hit.closest('[data-cover-ok]')) {
        const ht = hit.textContent.replace(/\\s+/g, ' ').trim().slice(0, 30)
        out.push(q(x) + ' закрыт другим блоком' + (ht ? ' («' + ht + '»)' : ''))
        break
      }
    }
    for (let p = x.el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (!/hidden|clip/.test(s.overflow + s.overflowX + s.overflowY)) continue
      const b = p.getBoundingClientRect()
      if (x.rects.some((rr) => rr.left < b.left - 2 || rr.right > b.right + 2 || rr.top < b.top - 2 || rr.bottom > b.bottom + 2)) { out.push(q(x) + ' обрезан — не помещается в свой блок'); break }
    }
    if (H / W > 1.7 && x.fs >= 24 && x.rects.some((rr) => rr.bottom > H - 220)) out.push(q(x) + ' в нижних 220 px сторис — их закрывает интерфейс Instagram')
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    if (a.rects.some((ra) => b.rects.some((rb) => { const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top); return w > 4 && h > 4 && w * h > 0.2 * Math.min(ra.width * ra.height, rb.width * rb.height) }))) out.push(q(a) + ' наезжает на ' + q(b))
  }
  const pre = document.createElement('pre'); pre.id = '__check'; pre.textContent = JSON.stringify([...new Set(out)].slice(0, 12))
  document.documentElement.appendChild(pre)
}, 300))`

// Returns the list of problems in a mockup (empty = looks clean). Same Chrome, one at a time.
export function checkHtml(browser, file) {
  const run = () => new Promise((resolve) => {
    const html = fs.readFileSync(file, 'utf8')
    const [w, h] = pageSize(html, path.basename(file))
    const tmp = path.join(path.dirname(file), `.check-${process.pid}.html`)
    const nonce = Math.random().toString(36).slice(2)
    // only the office's own checker may run: the employee's scripts stay blocked
    const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; img-src file: data:; media-src file: data:; style-src 'unsafe-inline' file: https://fonts.googleapis.com; font-src file: data: https://fonts.gstatic.com">`
    let page = html.split('{{ASSETS}}').join(pathToFileURL(P.assets).href)
    page = /<head[^>]*>/i.test(page) ? page.replace(/<head[^>]*>/i, (m) => m + CSP) : CSP + page
    page += `<script nonce="${nonce}">${CHECK.replace('__W__', w).replace('__H__', h)}</script>`
    fs.writeFileSync(tmp, page, 'utf8')
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(P.data, 'chrome')}`, `--window-size=${w},${h + 300}`, '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(tmp).href]
    const child = execFile(browser, args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      clearTimeout(timer)
      fs.rmSync(tmp, { force: true })
      const m = String(stdout || '').match(/<pre id="__check">([\s\S]*?)<\/pre>/)
      if (!m) return resolve([])
      try { resolve(JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))) } catch { resolve([]) }
    })
    const timer = setTimeout(() => {
      if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {})
      else child.kill('SIGKILL')
    }, 90000)
  })
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

// A document page into a PDF next to it (A4, no browser header and footer).
export function htmlToPdf(browser, file) {
  const run = () => new Promise((resolve, reject) => {
    const out = file.replace(/\.html?$/i, '.pdf')
    fs.rmSync(out, { force: true })
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(P.data, 'chrome')}`,
      '--no-pdf-header-footer', '--print-to-pdf-no-header', '--virtual-time-budget=5000',
      `--print-to-pdf=${out}`,
      pathToFileURL(file).href,
    ]
    const child = execFile(browser, args, { windowsHide: true }, () => {
      clearTimeout(timer)
      if (fs.existsSync(out)) resolve(out)
      else reject(new Error('браузер не сохранил PDF'))
    })
    const timer = setTimeout(() => {
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {})
      else child.kill('SIGKILL')
    }, 90000)
  })
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}
