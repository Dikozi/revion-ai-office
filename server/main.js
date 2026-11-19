import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { P } from './paths.js'
import { loadConfig } from './config.js'
import { loadEmployees } from './employees.js'
import { Store } from './store.js'
import { Office } from './office.js'
import { Telegram } from './telegram.js'
import { resolveClaude, setClaudeLimit, reapOrphans } from './claude.js'
import { findBrowser } from './render.js'
import { findFfmpeg } from './montage.js'
import { Meta } from './meta.js'
import { Portal } from './portal.js'
import { startCleanup } from './cleanup.js'
import { Initiative } from './initiative.js'
import { startHttp } from './http.js'
import { Auth } from './auth.js'
import { Dashboard } from './dashboard.js'
import { Crm } from './crm.js'
import { startFx } from './fx.js'
import { Followers } from './followers.js'
import { startPortalWeb } from './portal-web.js'
import { SmmPack } from './smm-pack.js'
import { PostResults } from './post-results.js'
import { InstaArchive } from './insta-archive.js'

const [major] = process.versions.node.split('.').map(Number)
if (major < 20) {
  console.error(`Нужен Node.js 20 или новее, сейчас ${process.versions.node}. Скачайте LTS с nodejs.org.`)
  process.exit(1)
}

for (const dir of [P.data, P.work, P.inbox, P.knowledge]) fs.mkdirSync(dir, { recursive: true })

const cfg = loadConfig()
const store = new Store()
const employees = loadEmployees(cfg)
const bin = resolveClaude(cfg.claudePath)
// one more than the task slots, so the manager can plan while employees work
setClaudeLimit((cfg.maxParallel || 2) + 1)
const reaped = reapOrphans()
if (reaped) console.log(`Остановлено зависших запусков Claude после сбоя: ${reaped}`)
const claudeInfo = bin ? { found: true, path: bin.label } : { found: false }

if (!bin) {
  console.error('Claude Code не найден. Установите его: https://code.claude.com/docs/en/setup')
}

const browser = findBrowser(cfg.browserPath)
const ffmpeg = findFfmpeg(cfg.ffmpegPath)

const meta = new Meta(cfg)
const portal = new Portal(cfg)

const crm = new Crm(cfg)
const office = new Office({ store, cfg, employees, bin, browser, ffmpeg, meta, portal, crm })
const telegram = new Telegram({ cfg, office, store })
const initiative = new Initiative({ cfg, office, store, meta, bin, employees })
telegram.useInitiative(initiative)
const followers = new Followers({ meta, cfg })
initiative.followers = followers
const auth = new Auth(cfg)
telegram.useAuth(auth)
const smmPack = new SmmPack({ cfg, store, office, initiative, meta, ffmpeg, browser })
followers.archive = new InstaArchive({ meta, smmPack })
telegram.useSmmPack(smmPack)
const dashboard = new Dashboard({ store, meta, portal, initiative, employees, crm, smmPack })
// decisions are measured with the same numbers the portal shows
initiative.metricsNow = () => dashboard.metricsNow()
initiative.dashboardData = (fresh) => dashboard.get(fresh)
initiative.browser = browser

let server
try {
  server = await startHttp({ cfg, store, office, telegram, meta, portal, crm, initiative, claudeInfo })
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    console.error(`Порт ${cfg.port} занят — похоже, офис уже запущен. Откройте http://localhost:${cfg.port}`)
    process.exit(1)
  }
  throw e
}

let portalServer = null
try {
  portalServer = await startPortalWeb({ cfg, auth, dashboard, office, initiative, telegram, officeHandle: server.officeHandle })
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Портал: порт ${cfg.portalWeb.port} занят` : `Портал не запустился: ${e.message}`)
}

const url = `http://localhost:${cfg.port}`
console.log('')
console.log('  Офис работает:', url)
console.log('  Портал компании:', portalServer ? (cfg.portalWeb.publicUrl || `http://localhost:${cfg.portalWeb.port}`) : 'не запущен')
console.log('  Claude Code:', claudeInfo.found ? claudeInfo.path : 'НЕ НАЙДЕН')
console.log('  Браузер для картинок:', browser || 'НЕ НАЙДЕН (картинки останутся в HTML)')
console.log('  ffmpeg для монтажа:', ffmpeg ? ffmpeg.ffmpeg : 'НЕ НАЙДЕН (Монтажёр не сможет собрать ролик)')
console.log('  Чтобы остановить офис — закройте это окно или нажмите Ctrl+C.')
console.log('')

telegram.start()
initiative.start()
smmPack.start()
new PostResults({ meta, smmPack }).start()
office.ads.start()
office.salesArchive.start()
crm.start()
startFx()
followers.start()
startCleanup()
office.tick()

if (cfg.openBrowser && !process.argv.includes('--no-browser')) {
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref() } catch {}
}

const shutdown = () => {
  telegram.stop()
  store.flush()
  server.close()
  portalServer?.close()
  process.exit(0)
}
// An error somewhere must not stop the whole office; real crashes are logged and start.bat restarts it.
const crashLog = (kind, e) => { try { fs.appendFileSync(path.join(P.data, 'crash.log'), `${new Date().toISOString()} ${kind}: ${e?.stack || e}\n`) } catch {} }
process.on('unhandledRejection', (e) => { console.error('Ошибка:', e?.message || e); crashLog('unhandledRejection', e) })
process.on('uncaughtException', (e) => { console.error('Сбой:', e); crashLog('uncaughtException', e); try { store.flush() } catch {} process.exit(1) })
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
