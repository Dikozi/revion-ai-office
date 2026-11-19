import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { P } from './paths.js'

const FILE = path.join(P.data, 'config.json')

const DEFAULTS = {
  port: 3777,
  maxParallel: 2,
  taskTimeoutMin: 20,
  claudePath: '',
  browserPath: '',
  ffmpegPath: '',
  keepApiKey: false,
  openBrowser: true,
  telegram: { token: '', ownerChatId: null, linkCode: '' },
  // exclude: campaigns of other projects in the same ad account (a part of the name, any case) — left out of every ad number
  meta: { token: '', apiVersion: '', igUserId: '', igUsername: '', adAccountId: '', adAccounts: [], exclude: ['парк', 'park'] },
  portal: { url: '', key: '' },
  // the company portal (login through Telegram); publicUrl is the HTTPS address on the server
  // CRM Altyn Qala Group (server/crm.js): API address and key, entered by the owner in ⚙; map overrides stage/source names
  crm: { type: '', url: '', key: '' },
  portalWeb: { port: 3780, host: '127.0.0.1', publicUrl: '' },
  // the Instagram plan every Monday: Алия plans, Мадина prepares, reels come from the company's marketers
  smm: { followersGoal: 2000, goalDate: '2026-12-31', postsPerWeek: 3, storiesDaily: true, reelsPerWeek: '5–6' },
  // the home page's main number: how fast we must sell to reach `share` of the flats sold by the handover date
  handover: { date: '2027-09-30', label: '3 квартал 2027', share: 1 },
  // the base price per m², ₸ (set by the owner in config). Cheaper sales are discounts entered by managers on purpose:
  // they are listed on the revenue page for information only, never raised as an alarm
  basePpm: 350000,
  // the sales manager's working hours by weekday (0 = Sunday): «client waits for an answer» counts only these
  managerHours: { 1: [9, 18], 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [10, 14] },
  // the morning line in Telegram: every day at this hour, built by code
  morning: { hour: 9, on: true },
  employees: {},
}

function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v)
      : v
  }
  return out
}

export function loadConfig() {
  fs.mkdirSync(P.data, { recursive: true })
  let saved = {}
  if (fs.existsSync(FILE)) {
    try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e) {
      console.error('Не удалось прочитать data/config.json, беру настройки по умолчанию:', e.message)
    }
  }
  // 380 000 was written automatically by the previous default; the owner sets their own
  if (saved.basePpm === 380000) delete saved.basePpm
  const cfg = merge(DEFAULTS, saved)
  // a weekday missing from the saved hours is a day off, not a default to bring back
  if (saved.managerHours && typeof saved.managerHours === 'object') cfg.managerHours = saved.managerHours
  if (!cfg.telegram.ownerChatId && !cfg.telegram.linkCode) {
    cfg.telegram.linkCode = String(crypto.randomInt(100000, 999999))
  }
  saveConfig(cfg)
  return cfg
}

export function saveConfig(cfg) {
  fs.mkdirSync(P.data, { recursive: true })
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  fs.renameSync(tmp, FILE)
}
