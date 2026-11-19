// REVION demo: the real portal pages on made-up data of an ordinary business (demo/data.js).
// No login, no office, no Telegram, no real data: the buttons only explain what would happen.
// Run: node demo/server.js [--all]  (PORT, default 3790; listens on 127.0.0.1 — on the server Caddy serves it outside)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoData, previewExtra } from './data.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// --all: every page with sample data on port 3791, for checking the design on the computer (the public demo shows only «главное»)
const ALL = process.argv.includes('--all')
const PORT = Number(process.env.PORT || (ALL ? 3791 : 3790))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' }
const ME = {
  user: { id: 0, name: 'Гость', role: 'owner', roleName: 'Демо-доступ' },
  bot: null,
  publicUrl: '',
  demo: { company: 'Салон мебели «Уют» · демо', pages: ALL ? ['overview', 'plan', 'marketing', 'sales', 'revenue', 'smm', 'reports'] : ['overview', 'marketing', 'sales', 'revenue', 'reports'] },
}

// only the portal page and the team pictures are served; nothing else in the project is reachable
function file(rel) {
  const base = path.join(ROOT, rel.startsWith('web/') ? 'web' : 'portal')
  const f = path.resolve(ROOT, rel)
  return f.startsWith(base + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://demo')
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' })
    res.end(body)
  }
  if (url.pathname === '/p/me') return send(200, JSON.stringify(ME))
  if (url.pathname === '/p/data') return send(200, JSON.stringify(ALL ? { ...demoData(), ...previewExtra() } : demoData()))
  if (url.pathname.startsWith('/p/')) return send(200, JSON.stringify({ ok: true }))
  const rel = url.pathname === '/' ? 'portal/index.html' : url.pathname.startsWith('/office/img/team/') ? `web${url.pathname.slice('/office'.length)}` : `portal${url.pathname}`
  const f = file(decodeURIComponent(rel))
  if (!f) return send(404, 'Не найдено', 'text/plain; charset=utf-8')
  send(200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream')
}).listen(PORT, '127.0.0.1', () => console.log(`Демо REVION: http://127.0.0.1:${PORT}`))
