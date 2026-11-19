// The company portal: dashboard, analytics, reports and the living office behind a Telegram login.
// Listens on 127.0.0.1 only; on a server it is published through Caddy (HTTPS).
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { ROOT, isInside } from './paths.js'
import { send, sendFile, readJson } from './http.js'
import { ROLES } from './auth.js'
import { publicFile } from './smm-pack.js'
import { GOALS_TASK } from './initiative.js'

// /wa/<place> → WhatsApp with a ready first message; the office reads it to know the lead's source
const WA_PHONE = '77001234567'
const WA = {
  '/wa/ig': 'Здравствуйте! Пишу из профиля Instagram',
  '/wa/site': 'Здравствуйте! Пишу с сайта',
  '/wa/krisha': 'Здравствуйте! Пишу с Крыши',
  '/wa/2gis': 'Здравствуйте! Пишу из 2ГИС',
  '/wa/2gis-t2': 'Здравствуйте! Пишу из 2ГИС, ЖК Altyn Qala 2',
  '/wa/2gis-park': 'Здравствуйте! Пишу из 2ГИС, ЖК Qala Park',
}

const DIR = path.join(ROOT, 'portal')
const COOKIE = 'office_session'
const TASK_ID = /^[a-z]-\d{6}-[0-9a-f]{6}$/

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self' https://web.telegram.org",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]))
}

export function startPortalWeb({ cfg, auth, dashboard, office, initiative, telegram, officeHandle }) {
  cfg.portalWeb ??= {}
  const pw = cfg.portalWeb
  const port = pw.port || 3780
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`])
  try { if (pw.publicUrl) hosts.add(new URL(pw.publicUrl).host) } catch {}

  const https = (req) => req.headers['x-forwarded-proto'] === 'https'
  const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()

  const setSession = (req, res, token) => {
    // SameSite=None only over HTTPS: the Telegram web client opens Mini Apps in an iframe
    const flags = https(req) ? 'Secure; SameSite=None' : 'SameSite=Lax'
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; ${flags}; Max-Age=${30 * 86400}`)
  }
  const clearSession = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`)

  const me = (u) => ({ id: u.id, name: u.name, role: u.role, roleName: ROLES[u.role] })
  const need = (who, ...roles) => { if (!roles.includes(who.user.role)) { const e = new Error('Нет доступа'); e.code = 403; throw e } }

  const routes = [
    ['GET', /^\/p\/me$/, (m, req, who) => ({ user: me(who.user), bot: telegram.bot, publicUrl: pw.publicUrl || '' })],
    ['GET', /^\/p\/data$/, async (m, req, who, url) => {
      const fresh = url.searchParams.has('fresh') && who.user.role === 'owner'
      return dashboard.forRole(await dashboard.get(fresh), who.user.role)
    }],
    ['POST', /^\/p\/proposals\/([0-9a-f]{8})\/(yes|no)$/, async (m, req, who) => {
      need(who, 'owner')
      const b = await readJson(req).catch(() => ({}))
      return initiative.decide(m[1], m[2] === 'yes', Array.isArray(b.only) ? b.only.map(Number) : null)
    }],
    ['POST', /^\/p\/memory\/([0-9a-f]{8})\/again$/, (m, req, who) => { need(who, 'owner'); return initiative.reapprove(m[1]) }],
    ['POST', /^\/p\/goals$/, async (m, req, who) => { need(who, 'owner'); return initiative.setGoals(await readJson(req)) }],
    ['POST', /^\/p\/goals\/ask$/, (m, req, who) => {
      need(who, 'owner')
      return office.addTask('revenue', GOALS_TASK, { source: 'week-goal' })
    }],
    ['POST', /^\/p\/week-plan\/([0-9a-f]{8})\/revise$/, async (m, req, who) => {
      need(who, 'owner')
      const b = await readJson(req)
      const comment = String(b.comment || '').trim().slice(0, 1000)
      if (!comment) throw new Error('Напишите, что поменять')
      initiative.revisePlan(m[1], comment).catch((e) => console.error('План недели:', e.message))
      return { started: true }
    }],
    ['POST', /^\/p\/week-plan\/ask$/, async (m, req, who) => {
      need(who, 'owner')
      initiative.weekly().catch((e) => console.error('План недели:', e.message))
      return { started: true }
    }],
    ['POST', /^\/p\/ask$/, async (m, req, who) => {
      need(who, 'owner')
      const b = await readJson(req)
      const text = String(b.text || '').trim().slice(0, 4000)
      if (!text) throw new Error('Напишите поручение')
      return office.requestPlan(text, { source: 'web' })
    }],
    // a signal from the command center becomes an approved decision with a task
    ['POST', /^\/p\/signals\/act$/, async (m, req, who) => {
      need(who, 'owner')
      const b = await readJson(req)
      const sig = (await dashboard.get()).signals.find((x) => x.key === b.key)
      if (!sig?.action) throw new Error('Этот сигнал уже неактуален — обновите страницу')
      const x = sig.action
      const p = initiative.add({ from: x.employee, kind: 'signal', urgent: false, title: x.title, text: `${sig.what}. ${sig.why}`, task: { employee: x.employee, text: x.text }, metric: x.metric, expected: x.expected, dueDays: x.days, signal: sig.key })
      initiative.dismiss(sig.key, 'task')
      return initiative.decide(p.id, true)
    }],
    // a task of the home page: «Сделано» hides it for a day (until the data catches up), «Не актуально» for two weeks
    ['POST', /^\/p\/home\/hide$/, async (m, req, who) => {
      need(who, 'owner')
      const b = await readJson(req)
      const keys = String(b.key || '').split('|').filter(Boolean).slice(0, 50)
      for (const k of keys) initiative.dismiss(k, b.done ? 'done' : 'dismissed', b.done ? 0 : 14)
      return { ok: true }
    }],
    ['POST', /^\/p\/signals\/dismiss$/, async (m, req, who) => { need(who, 'owner'); const b = await readJson(req); initiative.dismiss(String(b.key || ''), 'dismissed'); return { ok: true } }],
    ['POST', /^\/p\/week-goal\/ask$/, (m, req, who) => {
      need(who, 'owner')
      return office.addTask('revenue', 'Предложи план на текущую неделю для страницы «План»: сколько продаж, броней и выручки реально ждать (от темпа за 4 недели, броней в работе, рекламы). Сохрани только план-недели.json по образцу из твоих правил, отчёт не пиши. Ответ — 3–4 строки с цифрами и почему.', { source: 'week-goal' })
    }],
    ['POST', /^\/p\/praise\/([a-z]+)$/, (m, req, who) => { need(who, 'owner'); return initiative.praise(m[1]) }],
    ['GET', /^\/p\/users$/, (m, req, who) => { need(who, 'owner'); return { users: auth.users(), roles: ROLES, bot: telegram.bot } }],
    ['POST', /^\/p\/users\/invite$/, async (m, req, who) => {
      need(who, 'owner')
      if (!telegram.bot) throw new Error('Бот Telegram не подключён')
      const b = await readJson(req)
      const i = auth.invite(b.name, b.role)
      return { ...i, token: undefined, link: `https://t.me/${telegram.bot}?start=inv_${i.token}` }
    }],
    ['POST', /^\/p\/users\/(\d+)\/role$/, async (m, req, who) => { need(who, 'owner'); const b = await readJson(req); return auth.setRole(m[1], b.role) }],
    ['POST', /^\/p\/users\/(\d+)\/remove$/, (m, req, who) => { need(who, 'owner'); return auth.remove(m[1]) }],
    ['POST', /^\/p\/logout-all$/, (m, req, who, url, res) => { auth.logoutAll(who.user.id); clearSession(res); return { ok: true } }],
    ['POST', /^\/p\/logout$/, (m, req, who, url, res) => { auth.logout(cookies(req)[COOKIE]); clearSession(res); return { ok: true } }],
  ]

  // what the office app (/office/, /api/*, /files/*, /inbox/*) may do for each role
  const officeAllowed = (who, req, pathname) => {
    const role = who.user.role
    if (role === 'owner') return true
    // pictures of the team are used all over the portal
    if (req.method === 'GET' && pathname.startsWith('/office/img/')) return true
    if (pathname.startsWith('/files/')) {
      const id = pathname.split('/')[2]
      const t = TASK_ID.test(id) && office.store.task(id)
      return !!t && (role === 'boss' || t.employee === 'sales')
    }
    if (role !== 'boss' || req.method !== 'GET') return false
    return pathname.startsWith('/office/') || pathname === '/office' || pathname === '/api/state' || pathname === '/api/stream' || /^\/api\/events\//.test(pathname)
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP)
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (https(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    if (!hosts.has(req.headers.host)) return send(res, 403, { error: 'forbidden' })
    let url, pathname
    try {
      url = new URL(req.url, `http://${req.headers.host}`)
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return send(res, 400, { error: 'bad url' })
    }
    // short WhatsApp links with a source label (owner, 19.11.2026): the first message tells the office where the client came from
    const wa = WA[pathname.replace(/\/+$/, '').toLowerCase()]
    if ((req.method === 'GET' || req.method === 'HEAD') && wa) {
      res.writeHead(302, { Location: `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(wa)}`, 'Cache-Control': 'no-store' })
      return res.end()
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/pub/')) {
      const file = publicFile(pathname)
      return file ? sendFile(res, file, { req }) : send(res, 404, { error: 'not found' })
    }
    try {
      if (req.method === 'POST') {
        // other sites can't send this header without a CORS preflight, which is never approved
        if (req.headers['x-office'] !== '1') return send(res, 403, { error: 'forbidden' })
        const origin = req.headers.origin
        if (origin && !hosts.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'forbidden' })
      }

      // ---------- login (no session yet) ----------
      if (req.method === 'POST' && pathname === '/p/login/start') {
        if (!telegram.bot || !auth.ownerId) return send(res, 503, { error: 'Сначала подключите Telegram-бота в офисе (⚙).' })
        const l = auth.startLogin(ip(req))
        return send(res, 200, { id: l.id, code: l.code, word: l.word, bot: telegram.bot, link: `https://t.me/${telegram.bot}?start=login_${l.id}` })
      }
      if (req.method === 'POST' && pathname === '/p/login/poll') {
        const b = await readJson(req, 4096)
        const r = auth.pollLogin(String(b.id || ''), { ua: req.headers['user-agent'], ip: ip(req) })
        if (r.session) { setSession(req, res, r.session); return send(res, 200, { ok: true }) }
        return send(res, 200, r)
      }
      if (req.method === 'POST' && pathname === '/p/login/telegram') {
        if (auth.limited(ip(req), 30)) return send(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' })
        const b = await readJson(req, 16384)
        const token = auth.fromInitData(b.initData, { ua: req.headers['user-agent'], ip: ip(req) })
        setSession(req, res, token)
        return send(res, 200, { ok: true })
      }

      const who = auth.session(cookies(req)[COOKIE])

      if (pathname.startsWith('/p/')) {
        if (!who) return send(res, 401, { error: 'Нужно войти' })
        for (const [method, re, handler] of routes) {
          const m = pathname.match(re)
          if (m && req.method === method) return send(res, 200, await handler(m, req, who, url, res))
        }
        return send(res, 404, { error: 'not found' })
      }

      // ---------- the living office ----------
      const officePath = pathname === '/office' || pathname.startsWith('/office/') || pathname.startsWith('/api/') || pathname.startsWith('/files/') || pathname.startsWith('/inbox/')
      if (officePath) {
        if (!who) return send(res, 401, { error: 'Нужно войти' })
        if (!officeAllowed(who, req, pathname)) return send(res, 403, { error: 'Нет доступа' })
        if (pathname === '/office') { res.writeHead(302, { Location: '/office/' }); return res.end() }
        const inner = pathname.startsWith('/office/') ? pathname.slice('/office'.length) : pathname
        return officeHandle(req, res, url, inner)
      }

      // ---------- portal pages ----------
      if (req.method === 'GET') {
        const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
        const file = path.resolve(DIR, rel)
        if (isInside(DIR, file) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file, { trusted: true })
        // the single page app handles its own routes
        if (!path.extname(rel)) return sendFile(res, path.join(DIR, 'index.html'), { trusted: true })
      }
      send(res, 404, { error: 'not found' })
    } catch (err) {
      send(res, err.code === 403 ? 403 : 400, { error: err.message })
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, pw.host || '127.0.0.1', () => resolve(server))
  })
}
