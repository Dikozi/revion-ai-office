// Builds the live demo for GitHub Pages: the real portal + demo/data.js, running entirely in the browser.
// The portal asks the server for /p/me and /p/data; here a tiny fetch shim answers from demo/data.js,
// so the made-up numbers are generated on the visitor's machine with today's dates. Nothing is sent anywhere.
// Run: node tools/build-pages.mjs [outDir]   (default: _site)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.resolve(ROOT, process.argv[2] || '_site')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'office/img'), { recursive: true })

// the portal itself; absolute /office/ paths become relative, because Pages serves the site under /<repo>/
const js = fs.readFileSync(path.join(ROOT, 'portal/portal.js'), 'utf8').replaceAll('"/office/img/team/', '"office/img/team/')
fs.writeFileSync(path.join(OUT, 'portal.js'), js)
fs.copyFileSync(path.join(ROOT, 'portal/portal.css'), path.join(OUT, 'portal.css'))
fs.copyFileSync(path.join(ROOT, 'demo/data.js'), path.join(OUT, 'data.js'))
fs.cpSync(path.join(ROOT, 'web/img/team'), path.join(OUT, 'office/img/team'), { recursive: true })

const shim = `<script type="module">
import { demoData, previewExtra } from './data.js'
const ME = { user: { id: 0, name: 'Гость', role: 'owner', roleName: 'Демо-доступ' }, bot: null, publicUrl: '',
  demo: { company: 'Altyn Qala Group · демо', pages: ['overview', 'plan', 'marketing', 'sales', 'revenue', 'smm', 'reports'] } }
const real = window.fetch.bind(window)
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } })
window.fetch = (input, opt) => {
  const p = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
  if (p.endsWith('/p/me')) return Promise.resolve(json(ME))
  if (p.endsWith('/p/data')) return Promise.resolve(json({ ...demoData(), ...previewExtra() }))
  if (p.includes('/p/')) return Promise.resolve(json({ ok: true }))
  return real(input, opt)
}
await import('./portal.js')
</script>`
const html = fs.readFileSync(path.join(ROOT, 'portal/index.html'), 'utf8')
  .replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>\n', '')
  .replace('<meta name="robots" content="noindex, nofollow">', '<meta name="description" content="REVION live demo: the production portal of an AI office of Claude Code agents, on made-up data of a fictional residential developer.">')
  .replace('<script type="module" src="portal.js"></script>', shim)
fs.writeFileSync(path.join(OUT, 'index.html'), html)
fs.writeFileSync(path.join(OUT, '.nojekyll'), '')
console.log('Demo site →', path.relative(ROOT, OUT))
