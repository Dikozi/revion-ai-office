// Chessboard portal (шахматка): read-only HTTPS API with a key in the Authorization header.
// The key stays in data/config.json and is never passed to employees.
import { EventEmitter } from 'node:events'
import { saveConfig } from './config.js'
import { markOk, markFail } from './sources.js'

export class Portal extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.cfg.portal ??= { url: '', key: '' }
    this.p = this.cfg.portal
    this.error = ''
    this.checkedAt = 0
  }

  status() {
    return { configured: !!(this.p.url && this.p.key), url: this.p.url, ok: !!this.p.ok, error: this.error, checkedAt: this.checkedAt }
  }

  // every answer of the portal is recorded for the «Данные: …» line (sources.js); the payments list is its own part
  async get(pathOrUrl = '') {
    const part = /payments/.test(String(pathOrUrl)) ? 'chess:pay' : 'chess'
    try {
      const j = await this.fetch(pathOrUrl)
      markOk(part)
      return j
    } catch (e) {
      markFail(part, e.name === 'TimeoutError' ? 'портал не ответил за 15 секунд' : e)
      throw e
    }
  }

  async fetch(pathOrUrl) {
    const url = new URL(pathOrUrl, this.p.url.endsWith('/') ? this.p.url : this.p.url + '/')
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.p.key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    if (r.status === 401 || r.status === 403) throw new Error('Портал не принял ключ (ошибка доступа). Проверьте, что ключ скопирован целиком.')
    if (r.status === 503) throw new Error('На портале не включён доступ для офиса: в Vercel нет переменной ANALYST_API_KEY.')
    if (r.status === 404) throw new Error('По этому адресу нет API портала. Проверьте адрес сайта портала.')
    if (!r.ok) throw new Error(`Портал ответил ошибкой ${r.status}. Проверьте адрес.`)
    const text = await r.text()
    try { return JSON.parse(text) } catch { throw new Error('Портал ответил не в формате JSON — похоже, это адрес сайта, а не API.') }
  }

  async configure(url, key) {
    if (url) {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url
      // any page of the portal will do: only the site address is kept
      try { this.p.url = new URL(url).origin } catch { throw new Error('Не похоже на адрес сайта. Скопируйте его из адресной строки, когда открыт портал.') }
    }
    if (key) this.p.key = key
    this.p.ok = false
    saveConfig(this.cfg)
    try {
      await this.get('/api/analytics/status-history?updated_since=' + new Date().toISOString().slice(0, 10))
      this.p.ok = true
      this.error = ''
    } catch (e) {
      this.error = e.name === 'TimeoutError' ? 'Портал не ответил за 15 секунд. Проверьте адрес и интернет.' : e.message
    }
    this.checkedAt = Date.now()
    saveConfig(this.cfg)
    this.emit('status')
    return this.status()
  }

  unlink() {
    this.cfg.portal = this.p = { url: '', key: '' }
    this.error = ''
    saveConfig(this.cfg)
    this.emit('status')
    return this.status()
  }
}
