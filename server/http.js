import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { P, isInside } from './paths.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
}
const MAX_UPLOAD = 1024 * 1024 * 1024 // construction videos from a phone easily pass 100 MB

export function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

export function sendFile(res, file, { download = false, trusted = false, req = null } = {}) {
  const ext = path.extname(file).toLowerCase()
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' }
  // Files written by employees or uploaded by the owner are never rendered as pages here.
  if (download || !TYPES[ext] || (!trusted && (ext === '.html' || ext === '.svg'))) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`
  }
  let size
  try { size = fs.statSync(file).size } catch { return send(res, 404, { error: 'not found' }) }
  // video fetchers (Instagram, phones) ask for parts of the file
  const r = String(req?.headers?.range || '').match(/^bytes=(\d*)-(\d*)$/)
  let start = 0, end = size - 1, code = 200
  if (r && (r[1] || r[2])) {
    start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]))
    end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end() }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    code = 206
  }
  headers['Content-Length'] = size ? end - start + 1 : 0
  res.writeHead(code, headers)
  if (req?.method === 'HEAD' || !size) return res.end()
  // a locked or vanished file must not take the server down
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
}

export function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('Слишком большой запрос')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(new Error('Неверный формат запроса')) }
    })
    req.on('error', reject)
  })
}

export function dayFolder() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function safeName(name) {
  let base = path.basename(String(name || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 120)
  // Windows device names (NUL.jpg would vanish into the null device)
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = '_' + base
  return base || 'file'
}

export function uniqueInboxPath(name) {
  const dir = path.join(P.inbox, dayFolder())
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  let candidate = path.join(dir, name)
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem}-${i}${ext}`)
  return candidate
}

export function startHttp({ cfg, store, office, telegram, meta, portal, crm, initiative, claudeInfo }) {
  const clients = new Set()
  const allowedHosts = new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`])

  const broadcast = (type, data) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(msg)
  }
  office.on('employees', (list) => broadcast('employees', list))
  store.on('task', (t) => broadcast('task', t))
  store.on('plan', (p) => broadcast('plan', p))
  store.on('usage', (u) => broadcast('usage', u))
  store.on('event', (ev) => broadcast('event', ev))
  telegram.on('status', () => broadcast('telegram', telegram.status()))
  meta.on('status', () => broadcast('meta', meta.status()))
  portal.on('status', () => broadcast('portal', portal.status()))
  crm.on('status', () => broadcast('crm', crm.status()))
  initiative.on('changed', () => broadcast('proposals', initiative.list()))
  initiative.on('banter', (b) => broadcast('banter', b))
  initiative.on('characters', (c) => broadcast('characters', c))
  initiative.on('praise', (id) => broadcast('praise', { id }))
  setInterval(() => { for (const c of clients) c.write(': ping\n\n') }, 25000).unref()

  const snapshot = () => ({
    employees: office.employeeStates(),
    tasks: store.tasks.slice(-150),
    plans: store.plans.slice(-40),
    usage: store.usage,
    telegram: telegram.status(),
    meta: meta.status(),
    portal: portal.status(),
    crm: crm.status(),
    proposals: initiative.list(),
    banter: initiative.banterNow(),
    characters: initiative.characters(),
    claude: claudeInfo,
    maxParallel: cfg.maxParallel,
  })

  const routes = [
    ['GET', /^\/api\/state$/, () => snapshot()],
    ['GET', /^\/api\/events\/([a-z]-\d{6}-[0-9a-f]{6})$/, (m) => store.events(m[1])],
    ['POST', /^\/api\/request$/, async (m, req) => {
      const b = await readJson(req)
      return office.requestPlan(b.text, { source: 'web', attachments: cleanAttachments(b.attachments), answerTo: b.answerTo || null })
    }],
    ['POST', /^\/api\/tasks$/, async (m, req) => {
      const b = await readJson(req)
      return office.addTask(b.employee, b.text, { source: 'web', attachments: cleanAttachments(b.attachments), dependsOn: (Array.isArray(b.dependsOn) ? b.dependsOn : []).map(String).filter((id) => store.task(id)) })
    }],
    ['POST', /^\/api\/tasks\/([a-z]-\d{6}-[0-9a-f]{6})\/cancel$/, (m) => office.cancelTask(m[1])],
    ['POST', /^\/api\/tasks\/([a-z]-\d{6}-[0-9a-f]{6})\/retry$/, (m) => office.retryTask(m[1])],
    ['POST', /^\/api\/plans\/([a-z]-\d{6}-[0-9a-f]{6})\/approve$/, (m) => office.approvePlan(m[1])],
    ['POST', /^\/api\/plans\/([a-z]-\d{6}-[0-9a-f]{6})\/reject$/, (m) => office.rejectPlan(m[1])],
    ['POST', /^\/api\/settings\/telegram$/, async (m, req) => {
      const b = await readJson(req)
      await telegram.configure(String(b.token || '').trim())
      return telegram.status()
    }],
    ['POST', /^\/api\/telegram\/unlink$/, () => { telegram.unlink(); return telegram.status() }],
    ['POST', /^\/api\/settings\/meta$/, async (m, req) => {
      const b = await readJson(req)
      return meta.configure(String(b.token || '').trim(), String(b.adAccountId || ''))
    }],
    ['POST', /^\/api\/meta\/unlink$/, () => meta.unlink()],
    ['POST', /^\/api\/settings\/portal$/, async (m, req) => {
      const b = await readJson(req)
      return portal.configure(String(b.url || '').trim(), String(b.key || '').trim())
    }],
    ['POST', /^\/api\/portal\/unlink$/, () => portal.unlink()],
    ['POST', /^\/api\/settings\/crm$/, async (m, req) => {
      const b = await readJson(req)
      return crm.configure(String(b.url || '').trim(), String(b.key || '').trim())
    }],
    ['POST', /^\/api\/crm\/unlink$/, () => crm.unlink()],
    ['POST', /^\/api\/crm\/sync$/, async () => { await crm.sync(false); return crm.status() }],
    ['POST', /^\/api\/proposals\/([0-9a-f]{8})\/(yes|no)$/, (m) => initiative.decide(m[1], m[2] === 'yes')],
    ['POST', /^\/api\/praise\/([a-z]+)$/, (m) => initiative.praise(m[1])],
    ['POST', /^\/api\/director\/run$/, () => { initiative.weekReport({ force: true }).catch((e) => console.error('Отчёт недели:', e.message)); return { started: true } }],
  ]

  // The office itself; the portal server reuses it behind its own login.
  const handle = async (req, res, url, pathname) => {
    try {
      if (req.method === 'GET' && pathname === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
      }

      if (req.method === 'POST' && pathname === '/api/upload') {
        const name = safeName(url.searchParams.get('name'))
        const dest = uniqueInboxPath(name)
        let size = 0
        const out = fs.createWriteStream(dest)
        try {
          await new Promise((resolve, reject) => {
            out.on('error', reject)
            req.on('data', (c) => {
              size += c.length
              if (size > MAX_UPLOAD) { reject(new Error('Файл больше 1 ГБ')); req.destroy() } else if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()) }
            })
            req.on('end', resolve)
            req.on('error', reject)
          })
        } catch (err) {
          out.destroy()
          fs.rmSync(dest, { force: true }) // no half-written files left in inbox
          throw err
        }
        await new Promise((resolve) => out.end(resolve))
        return send(res, 200, { path: path.relative(P.inbox, dest).split(path.sep).join('/'), name: path.basename(dest), size })
      }

      for (const [method, re, handler] of routes) {
        const m = pathname.match(re)
        if (m && req.method === method) return send(res, 200, await handler(m, req))
      }

      if (req.method === 'GET' && pathname.startsWith('/files/')) {
        const [, , id, ...rest] = pathname.split('/')
        if (!/^[a-z]-\d{6}-[0-9a-f]{6}$/.test(id)) return send(res, 404, { error: 'not found' })
        const file = path.resolve(P.work, id, ...rest)
        if (!isInside(path.join(P.work, id), file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' })
        return sendFile(res, file, { download: url.searchParams.has('download') })
      }

      if (req.method === 'GET' && pathname.startsWith('/inbox/')) {
        const file = path.resolve(P.inbox, pathname.slice('/inbox/'.length))
        if (!isInside(P.inbox, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' })
        return sendFile(res, file)
      }

      if (req.method === 'GET') {
        const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
        const file = path.resolve(P.web, rel)
        if (isInside(P.web, file) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file, { trusted: true })
      }
      send(res, 404, { error: 'not found' })
    } catch (err) {
      send(res, 400, { error: err.message })
    }
  }

  const server = http.createServer(async (req, res) => {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'forbidden' })
    let url, pathname
    try {
      url = new URL(req.url, `http://${req.headers.host}`)
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return send(res, 400, { error: 'bad url' })
    }
    // A custom header forces a CORS preflight that this server never approves,
    // so other websites open in the browser can't trigger actions here.
    if (req.method === 'POST' && req.headers['x-office'] !== '1') return send(res, 403, { error: 'forbidden' })
    return handle(req, res, url, pathname)
  })
  server.officeHandle = handle

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(cfg.port, '127.0.0.1', () => resolve(server))
  })
}

function cleanAttachments(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((a) => String(a || ''))
    .filter((a) => a && isInside(P.inbox, path.resolve(P.inbox, a)))
    .slice(0, 20)
}
