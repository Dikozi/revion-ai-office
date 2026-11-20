// Shared rules for Meta ad numbers, the same on every screen (portal, watchdog, Алия's files):
// which campaigns are ours, what an ad is for (by its settings, never by what it gave that day),
// and which days are complete (a window always ends with yesterday in the ad account's time zone).
// Plain code, no imports.

export const DEFAULT_TZ = 'Asia/Almaty'
// another project in the same ad account; the owner can change the list in data/config.json → meta.exclude
export const DEFAULT_EXCLUDE = ['парк', 'park']

// (name) => true when the campaign belongs to an excluded project
export function excluded(cfg) {
  const words = (Array.isArray(cfg?.meta?.exclude) ? cfg.meta.exclude : DEFAULT_EXCLUDE).map((w) => String(w).trim().toLowerCase()).filter(Boolean)
  return (name) => { const n = String(name || '').toLowerCase(); return words.some((w) => n.includes(w)) }
}

// a filter for insights rows and ads: keeps our own campaigns
export function ours(cfg) {
  const ex = excluded(cfg)
  return (r) => !ex(r?.campaign_name ?? r?.campaign?.name ?? r?.campaign ?? '')
}

const fmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz })
// the calendar day in the time zone; an unknown zone falls back to Astana
export function ymdIn(tz, d = new Date()) {
  try { return fmt(tz || DEFAULT_TZ).format(d) } catch { return fmt(DEFAULT_TZ).format(d) }
}
// plain calendar arithmetic on «YYYY-MM-DD»
export const shift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
// the day n days before today in the zone: dayAgo(tz, 1) = yesterday
export const dayAgo = (tz, n) => shift(ymdIn(tz), -n)
// `n` complete days ending `endAgo` days ago (1 = yesterday)
export const lastDays = (tz, n, endAgo = 1) => ({ since: dayAgo(tz, endAgo + n - 1), until: dayAgo(tz, endAgo) })

// What an ad is for, by Meta's codes: 'chat' (WhatsApp / Direct / Messenger), 'form' (instant form «Лиды»),
// 'other' (reach, engagement, profile visits, traffic) or null when nothing is known.
export function kindByGoal({ objective, optimization, destination } = {}) {
  const c = String(objective || '').toUpperCase(), o = String(optimization || '').toUpperCase(), d = String(destination || '').toUpperCase()
  if (/LEAD_GENERATION|QUALITY_LEAD/.test(o) || /^ON_AD$|LEAD_FORM/.test(d)) return 'form'
  if (/CONVERSATIONS|REPLIES/.test(o) || /WHATSAPP|MESSENGER|INSTAGRAM_DIRECT|MESSAGING/.test(d)) return 'chat'
  if (/^MESSAGES$/.test(c)) return 'chat'
  if (/^(OUTCOME_LEADS|LEAD_GENERATION)$/.test(c) && !o) return 'form'
  if (c || o) return 'other'
  return null
}

// the last resort for an ad Meta no longer describes: by what it brought
export const kindByResult = (n = {}) => (n.leads > n.chats ? 'form' : n.chats ? 'chat' : 'other')

// paid-for results: conversations of chat ads, forms of form ads; reach / profile ads have none
export const isPaid = (kind) => kind === 'chat' || kind === 'form'
export const KIND_RU = { chat: 'переписки', form: 'форма-заявка', other: 'охват / профиль' }

// Ad account state (account_status / disable_reason of the Graph API) in plain words.
const ACCOUNT_STATUS = { 1: 'активен', 2: 'отключён Meta', 3: 'есть неоплаченный долг', 7: 'на проверке у Meta', 8: 'ждёт оплаты долга', 9: 'льготный период: долг не оплачен', 100: 'закрывается', 101: 'закрыт', 201: 'активен', 202: 'закрыт' }
const DISABLE_REASON = { 1: 'нарушение правил рекламы', 2: 'проверка прав на товарный знак', 3: 'проблема с оплатой', 4: 'кабинет закрыт Meta', 5: 'проверка Meta', 6: 'проверка компании', 7: 'закрыт навсегда', 8: 'кабинет давно не использовался', 9: 'кабинет давно не использовался', 10: 'кабинет-«зонтик»', 11: 'нарушение правил Business Manager', 12: 'Meta сочла данные кабинета недостоверными', 13: 'юрлицо отвязано от кабинета', 14: 'проверка Meta', 15: 'кабинет взломан' }
// 9 = grace period: the payment failed but the ads still run for a while — active, with a warning
export const accountActive = (status) => status === 1 || status === 201 || status === 9
export const accountGrace = (status) => status === 9
export function accountReason(status, disable) {
  const s = ACCOUNT_STATUS[status] || `статус ${status}`
  const r = disable ? DISABLE_REASON[disable] || `причина ${disable}` : ''
  return r ? `${s} (${r})` : s
}

export const AD_PROBLEM = { DISAPPROVED: 'Meta отклонила объявление', WITH_ISSUES: 'у объявления ошибка', PENDING_BILLING_INFO: 'не хватает данных оплаты' }

// Meta's answer «this field is not known here» (not a rate limit, not a timeout)
export const refusedField = (e, field) => ![1, 2, 4, 17, 32, 613, 80002, 80004].includes(e?.graphCode) && (e?.graphCode === 100 || new RegExp(`${field}|nonexist|not valid|invalid|unknown`, 'i').test(String(e?.message || '')))
// action types that look like Instagram follows from an ad; null when Meta gave none of them
export function followsOf(actions) {
  const list = (actions || []).filter((a) => /follow/i.test(a.action_type || '') && !/unfollow/i.test(a.action_type || ''))
  return list.length ? list.reduce((t, a) => t + (Number(a.value) || 0), 0) : null
}
// instagram_profile_visits comes as a number (or, in some answers, as a list of {value})
export const visitsOf = (r) => { const v = r?.instagram_profile_visits; const n = Array.isArray(v) ? v.reduce((t, x) => t + (Number(x?.value) || 0), 0) : Number(v); return Number.isFinite(n) ? n : 0 }
