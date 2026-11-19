// Portal access: people, roles, invites, Telegram login and sessions.
// No passwords: a person logs in by confirming in the office bot, or opens the portal as a Telegram Mini App.
// Only hashes of session tokens are stored, so a copy of data/ does not let anyone in.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { P } from './paths.js'

const FILE = path.join(P.data, 'portal-users.json')
const SESSION_DAYS = 30
const LOGIN_TTL = 5 * 60e3
const INVITE_DAYS = 3

export const ROLES = {
  owner: 'Владелец',
  boss: 'Руководство (только просмотр)',
  sales: 'Менеджер продаж',
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const token = (n = 32) => crypto.randomBytes(n).toString('base64url')

export class Auth extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.logins = new Map() // id -> { created, code, userId, ip }
    this.hits = new Map() // ip -> [times]
    this.state = { users: [], invites: [], sessions: [] }
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(FILE, 'utf8'))) } catch {}
    setInterval(() => this.sweep(), 10 * 60e3).unref()
  }

  save() {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(this.state, null, 1), 'utf8')
    fs.renameSync(FILE + '.tmp', FILE)
  }

  sweep() {
    const now = Date.now()
    for (const [id, l] of this.logins) if (now - l.created > LOGIN_TTL) this.logins.delete(id)
    const before = this.state.sessions.length + this.state.invites.length
    this.state.sessions = this.state.sessions.filter((s) => s.expires > now && this.user(s.userId))
    this.state.invites = this.state.invites.filter((i) => i.expires > now)
    if (before !== this.state.sessions.length + this.state.invites.length) this.save()
  }

  // ---------- people ----------

  get ownerId() { return this.cfg.telegram.ownerChatId }

  user(id) {
    if (!id) return null
    if (String(id) === String(this.ownerId)) return { id: this.ownerId, name: this.cfg.telegram.ownerName || 'Владелец', role: 'owner' }
    return this.state.users.find((u) => String(u.id) === String(id)) || null
  }

  users() {
    const list = this.ownerId ? [this.user(this.ownerId)] : []
    return [...list, ...this.state.users].map((u) => ({
      ...u,
      roleName: ROLES[u.role],
      sessions: this.state.sessions.filter((s) => String(s.userId) === String(u.id)).length,
    }))
  }

  invite(name, role) {
    if (!['boss', 'sales'].includes(role)) throw new Error('Неизвестная роль')
    name = String(name || '').trim().slice(0, 40)
    if (!name) throw new Error('Напишите имя человека')
    const t = token(18)
    this.state.invites.push({ hash: sha(t), name, role, expires: Date.now() + INVITE_DAYS * 864e5 })
    this.save()
    return { token: t, name, role, days: INVITE_DAYS }
  }

  // called by the bot when someone opens t.me/<bot>?start=inv_<token>
  acceptInvite(t, from) {
    const i = this.state.invites.find((x) => x.hash === sha(t) && x.expires > Date.now())
    if (!i) return { error: 'Приглашение не найдено или уже истекло. Попросите новое.' }
    this.state.invites = this.state.invites.filter((x) => x !== i)
    if (String(from.id) === String(this.ownerId)) { this.save(); return { error: 'Вы владелец — у вас уже есть полный доступ.' } }
    this.state.users = this.state.users.filter((u) => String(u.id) !== String(from.id))
    const u = { id: from.id, name: i.name, tg: from.username || '', role: i.role, addedAt: new Date().toISOString() }
    this.state.users.push(u)
    this.save()
    this.emit('users')
    return { user: u }
  }

  setRole(id, role) {
    const u = this.state.users.find((x) => String(x.id) === String(id))
    if (!u) throw new Error('Человек не найден')
    if (!['boss', 'sales'].includes(role)) throw new Error('Неизвестная роль')
    u.role = role
    this.save()
    this.emit('users')
    return this.users()
  }

  remove(id) {
    this.state.users = this.state.users.filter((u) => String(u.id) !== String(id))
    this.state.sessions = this.state.sessions.filter((s) => String(s.userId) !== String(id))
    this.save()
    this.emit('users')
    return this.users()
  }

  // ---------- login through the bot ----------

  limited(ip, max = 10) {
    const now = Date.now()
    const list = (this.hits.get(ip) || []).filter((t) => now - t < 10 * 60e3)
    list.push(now)
    this.hits.set(ip, list)
    return list.length > max
  }

  startLogin(ip) {
    if (this.limited(ip)) throw new Error('Слишком много попыток. Подождите 10 минут.')
    if (this.logins.size > 200) this.sweep()
    const id = token(12)
    // the same two digits are shown on the page and must be chosen in the bot,
    // so a login link sent by a stranger can't be confirmed by accident
    const code = String(crypto.randomInt(10, 100))
    // a short code to type into the bot when Telegram is on another device (phone)
    let word
    do word = String(crypto.randomInt(100000, 1000000)); while ([...this.logins.values()].some((l) => l.word === word))
    this.logins.set(id, { created: Date.now(), code, word, userId: null, ip })
    return { id, code, word }
  }

  // "/login 123456" sent to the bot by a person with access
  confirmTyped(word, userId) {
    if (!this.user(userId)) return 'У вас нет доступа к порталу. Попросите у владельца приглашение.'
    this.tries ??= new Map()
    const tries = this.tries.get(String(userId)) || 0
    if (tries >= 5) return 'Слишком много неверных кодов. Обновите страницу портала и попробуйте через 10 минут.'
    const entry = [...this.logins.entries()].find(([, l]) => l.word === word && Date.now() - l.created < LOGIN_TTL)
    if (!entry) { this.tries.set(String(userId), tries + 1); setTimeout(() => this.tries.delete(String(userId)), 10 * 60e3).unref(); return 'Код не подошёл или устарел. Обновите страницу портала и отправьте новый код.' }
    entry[1].userId = userId
    return null
  }

  loginRequest(id) {
    const l = this.logins.get(id)
    return l && Date.now() - l.created < LOGIN_TTL ? l : null
  }

  // the bot calls this when the person taps the right number
  confirmLogin(id, userId, code) {
    const l = this.loginRequest(id)
    if (!l) return 'Ссылка для входа устарела. Обновите страницу портала.'
    if (!this.user(userId)) return 'У вас нет доступа к порталу.'
    if (code !== l.code) { this.logins.delete(id); return 'Число не совпало — вход отменён. Если это были не вы, просто ничего не делайте.' }
    l.userId = userId
    return null
  }

  pollLogin(id, meta) {
    const l = this.loginRequest(id)
    if (!l) return { expired: true }
    if (!l.userId) return { waiting: true }
    this.logins.delete(id)
    return { session: this.createSession(l.userId, meta) }
  }

  // ---------- Telegram Mini App ----------

  // https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
  fromInitData(initData, meta) {
    const botToken = this.cfg.telegram.token
    if (!botToken || !initData) throw new Error('Нет данных Telegram')
    const params = new URLSearchParams(String(initData))
    const hash = params.get('hash') || ''
    params.delete('hash')
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const want = crypto.createHmac('sha256', secret).update(check).digest('hex')
    if (hash.length !== want.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(want))) throw new Error('Подпись Telegram не сошлась')
    if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 86400) throw new Error('Данные Telegram устарели — откройте портал из бота заново')
    let tgUser
    try { tgUser = JSON.parse(params.get('user') || '{}') } catch { throw new Error('Нет данных Telegram') }
    if (!this.user(tgUser.id)) throw new Error('У вас нет доступа. Попросите у владельца приглашение.')
    return this.createSession(tgUser.id, meta)
  }

  // ---------- sessions ----------

  createSession(userId, { ua = '', ip = '' } = {}) {
    const t = token()
    const now = Date.now()
    this.state.sessions.push({ hash: sha(t), userId, created: now, seen: now, expires: now + SESSION_DAYS * 864e5, ua: String(ua).slice(0, 120), ip })
    // no endless pile of sessions for one person
    const mine = this.state.sessions.filter((s) => String(s.userId) === String(userId))
    if (mine.length > 10) this.state.sessions = this.state.sessions.filter((s) => s !== mine[0])
    this.save()
    return t
  }

  session(t) {
    if (!t) return null
    const s = this.state.sessions.find((x) => x.hash === sha(t))
    if (!s || s.expires < Date.now()) return null
    const user = this.user(s.userId)
    if (!user) return null
    // sliding expiry, written at most once an hour
    if (Date.now() - s.seen > 3600e3) { s.seen = Date.now(); s.expires = s.seen + SESSION_DAYS * 864e5; this.save() }
    return { user, hash: s.hash }
  }

  logout(t) {
    this.state.sessions = this.state.sessions.filter((s) => s.hash !== sha(t))
    this.save()
  }

  logoutAll(userId) {
    this.state.sessions = this.state.sessions.filter((s) => String(s.userId) !== String(userId))
    this.save()
  }
}
