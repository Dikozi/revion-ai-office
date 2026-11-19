// CRM Altyn Qala Group (https://crm.example.kz) for the analytics: a read-only API that answers only the server's IP.
// The office keeps a normalized copy in data/crm/leads.json — no names, phones, IIN or notes (the CRM masks
// its notes, the office does not take them at all). The CRM sends its own stage and source names; they are
// mapped to the office codes by words (STAGE_WORDS / SOURCE_WORDS), cfg.crm.map overrides a label exactly.
// Sync: the whole list once a night, the changes (updated_since) every hour; the key never reaches employees.
//
// Lead: { id, created_at, updated_at, source, source_label, campaign_id, ad_id, ad_name, manager,
//   stage, stage_label, stage_known, stage_at, history: [[stage, at]], first_reply_at, next_action_at,
//   lost_after, refusal_reason, gender ('f'|'m'), age, apartment: { complex, rooms, area, number }, deal_amount, deal_at, payment_type,
//   junk (a test or a bot's probe: left out of every count) }
// refusal_reason is free text typed by a manager: it is put into a closed list (REASONS) or anonymised, never kept as typed.
// The manager's note of a REFUSED lead (comment / notes / …) is read only during a pull: anonymised at once, kept in memory
// until Ерлан retells it in a few own words (reports.js), then only those words are stored (data/crm/refusals.json).
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { saveConfig } from './config.js'
import { P } from './paths.js'
import { postOf } from './ads-archive.js'
import crypto from 'node:crypto'
import { scrub, nameMatcher } from './sales.js'
import { markOk, markFail, seedOk } from './sources.js'

export const STAGES = [
  ['lead', 'Лиды'], ['contacted', 'Связались'], ['qualified', 'Квалифицированы'], ['show_set', 'Показ назначен'],
  ['show_done', 'Показ проведён'], ['booking', 'Бронь'], ['sale', 'Продажа'],
]
const ORDER = Object.fromEntries(STAGES.map(([k], i) => [k, i]))
const STAGE_RU = Object.fromEntries(STAGES)
export const SOURCE_RU = { meta: 'Реклама Meta', instagram: 'Instagram', whatsapp: 'WhatsApp', krisha: 'Krisha', realtor: 'Риелторы', referral: 'Рекомендации', base: 'База / повторные', walk_in: 'Пришли сами', site: 'Сайт', gis: '2ГИС', call: 'Звонок', banner: 'Баннер на стройке', other: 'Другое' }
// first match wins: «Отказ после показа» is a loss, «Показ назначен» is not a finished show
const STAGE_WORDS = [
  ['lost', /отказ|потерян|неуспеш|не ?реализ|не ?целев|закрыт[оа]? (без|не)|слив|lost/i],
  ['sale', /продаж|продан|сделка|договор|оплат|успешн|sale/i],
  ['booking', /брон|задат|аванс/i],
  ['show_done', /(показ|просмотр|встреч)\S* (провед|состоял|был)|(провед|был)\S* (показ|просмотр|встреч)/i],
  ['show_set', /показ|просмотр|встреч|запис/i],
  ['qualified', /квалиф|подбор|интерес|расч[её]т|презент|консульт|предлож|думает/i],
  // not reached yet is still a lead, not «связались»
  ['lead', /необработ|неразобр|не ?дозвон|не ?ответ|без ответа/i],
  ['contacted', /связ|контакт|дозвон|звон|в работ|переговор|обработ/i],
  ['lead', /нов|входящ|заявк|лид|первичн|необработ|неразобр/i],
]
const SOURCE_WORDS = [
  ['whatsapp', /whats|ват[сц]|вотс/i],
  ['instagram', /insta|инст/i],
  ['meta', /таргет|реклам|facebook|фейсбук|\bfb\b|meta/i],
  ['krisha', /krisha|крыш/i],
  ['realtor', /ри[еэ]лт|агент/i],
  ['referral', /рекоменд|знаком|сарафан|друз|совет/i],
  ['base', /баз[аы]|повтор|старый клиент|обзвон/i],
  ['gis', /2\s?гис|2gis/i],
  ['banner', /баннер|вывеск|стройк/i],
  ['call', /звон|звонок|телефон/i],
  ['walk_in', /офис|приш[её]л|отдел продаж|самостоят/i],
  ['site', /сайт|site|лендинг|landing|google|гугл|яндекс/i],
  ['other', /вручн|друг|не указан|без источника/i],
]
const AGES = [[0, 24, 'до 25'], [25, 34, '25–34'], [35, 44, '35–44'], [45, 54, '45–54'], [55, 64, '55–64'], [65, 200, '65+']]
const ageGroup = (a) => (a ? AGES.find(([lo, hi]) => a >= lo && a <= hi)?.[2] : null)

// raise when normalize() changes: the stored copy is then pulled again in full
// 5 (19.11.2026): junk, refusal_reason anonymised, apartment kept with the number alone
// 6 (19.11.2026): «Перестал выходить на связь» is «Не отвечает»
// 7 (19.11.2026): channel and ad_code from the label in the client's first message; 8: project «park» from the label
const VERSION = 8
const DIR = path.join(P.data, 'crm')
const FILE = path.join(DIR, 'leads.json')
const REFUSALS = path.join(DIR, 'refusals.json')
const read = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return empty } }
const write = (f, v) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f) }
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(d))
const hourNow = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
// the CRM speaks Astana time: 2026-11-16T00:00:00+05:00
const astanaIso = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 19) + '+05:00'
const date = (v) => (v && !Number.isNaN(Date.parse(v)) ? String(v) : null)
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const str = (v) => (v == null || v === '' ? null : String(v).trim().slice(0, 160))

function stageOf(code, label, map = {}) {
  if (code && (ORDER[code] != null || code === 'lost')) return code
  if (label && map[label]) return map[label]
  return (label && STAGE_WORDS.find(([, re]) => re.test(label))?.[0]) || null
}
function sourceOf(code, label, map = {}) {
  // «other» from the CRM only means it has no code: the name may still say where the client came from
  if (code && code !== 'other' && (SOURCE_RU[code] || code === 'meta_ads')) return [code === 'meta_ads' ? 'meta' : code, true]
  label ||= code === 'other' ? null : code
  if (label && map[label]) return [map[label], true]
  const hit = label && SOURCE_WORDS.find(([, re]) => re.test(label))?.[0]
  return [hit || 'other', !!hit]
}

// «Не целевой» however the CRM or the manager spells it: «нецелевой», «Не-целевой клиент»
export const NON_TARGET = /не[\s-]*целев/i
export const isNonTarget = (l) => NON_TARGET.test(l?.refusal_reason || '') || NON_TARGET.test(l?.stage_label || '')

// A test lead or a bot probing the site form (19.11.2026 00:39): «test», +7 700 000 00 00, script and SQL payloads.
// Only the verdict is kept — the name and the phone themselves never get into the office.
const PROBE = /pentest|sqlmap|acunetix|nessus|nikto|burp ?suite|<\s*\/?\s*(script|img|svg|iframe|body)\b|javascript:|\bon(error|load|mouseover)\s*=|\$\{jndi|\bunion\s+(all\s+)?select\b|['"]\s*or\s*['"]?\d+['"]?\s*=\s*['"]?\d|\bor\s+1\s*=\s*1|\bsleep\s*\(\s*\d|waitfor\s+delay|\.\.\/\.\.\/|\/etc\/passwd|%3cscript|<\?php|\bxss\b/i
const TEST_NAME = /^\s*(test\w*|тест\w*|qwerty|asdf\w*|йцукен\w*|x{3,}|a{3,}|а{3,}|проверка|пробн\w*|спам|spam)\s*\d*\s*$/i
function junkPhone(v) {
  const t = String(v ?? '')
  // a masked phone (+7 777 *** ** 44) is the CRM hiding it, not a fake
  if (!t || /[*•#]|[xх]{2}/i.test(t)) return false
  const d = t.replace(/\D/g, '')
  if (d.length < 6) return false
  const local = d.slice(-10)
  return new Set(local.slice(1)).size <= 1 || /0123456789|1234567890|9876543210/.test(d)
}
export function isJunk(r) {
  if (!r) return false
  if (r.is_test === true || r.test === true || r.spam === true) return true
  const c = r.client || r.contact || {}
  const names = [r.name, r.client_name, r.full_name, r.fio, r.contact_name, c.name, c.full_name]
  const phones = [r.phone, r.client_phone, r.contact_phone, c.phone, ...(Array.isArray(r.phones) ? r.phones : [])]
  if (names.some((n) => typeof n === 'string' && TEST_NAME.test(n))) return true
  if (phones.some(junkPhone)) return true
  const text = [...names, ...phones, r.source_label, r.ad_name, r.refusal_reason, r.lost_reason, r.comment, r.message, r.utm_source, r.utm_campaign, r.utm_content, r.stage_label].filter((x) => typeof x === 'string').join(' \n ')
  return PROBE.test(text) || /^\s*(спам|spam|тест\w*|test\w*)\s*$/i.test(String(r.stage_label || r.refusal_reason || ''))
}

// the managers' free-text reasons, put into a short closed list; whatever does not fit is anonymised
const REASONS = [
  ['Не целевой', NON_TARGET],
  ['Не отвечает', /не\s?отвеча|нет ответа|без ответа|не\s?дозвон|недозвон|не\s?бер[её]т|игнор|пропал|не\s?выходит на связь|перестал\S*\s+(выходить|отвечать|брать)|на связь не/i],
  ['Ипотека / банк не одобрил', /ипотек|банк|одобр|кредит|отбасы/i],
  ['Рассрочка / условия оплаты', /рассроч|первоначал|взнос|услови\S* оплат/i],
  ['Дорого', /дорог|цен[аеуы](?![а-яё])|не по карман|бюджет|нет денег|денег нет|финанс|дешевл/i],
  ['Срок сдачи', /срок|сдач|долго ждать|готов\S* жиль|вторичк/i],
  ['Планировка / этаж / площадь', /планиров|этаж|метраж|площад|комнат|вид из/i],
  ['Район / расположение', /район|располож|далеко|локац|инфраструкт/i],
  ['Купил в другом месте', /купил|конкурент|друг\S* (жк|застройщ|объект|проект|комплекс)/i],
  ['Передумал / отложил', /передумал|отлож|подожд|не\s?актуал|позже|подума|не\s?готов/i],
]
// words that may start a reason and are not names
const COMMON = /^(клиент\S*|муж\S*|жена|жене|сын\S*|дочь|доч\S+|родител\S*|семья|нет|не|да|уже|пока|хочет|хотел\S*|ищ\S+|нужн\S*|нужен|просто|сказал\S*|решил\S*|выбрал\S*|интересует|интересовал\S*|только|без|для|по|в|на|с|из|у|за|жк|астана|altyn|altyn|instagram|whatsapp|kaspi|halyk|krisha|крыша)$/i
export const REASON_LIST = REASONS.map(([k]) => k)
// phones, mail, IIN — then every capitalised word that is not a known one is taken for a name
const maskNames = (t) => scrub(t).replace(/(?<![\p{L}\[])(\p{Lu}[\p{Ll}]{1,})(?!\p{L})/gu, (w) => (COMMON.test(w) || /[а-яё](ть|ют|ят|ый|ое|ые|ого|ему)$/i.test(w) ? w : '[имя]'))
export function cleanReason(v) {
  const t = str(v)
  if (!t) return null
  const hit = REASONS.find(([, re]) => re.test(t))
  if (hit) return hit[0]
  if (/^(друго[ей]|прочее|иное)\.?$/i.test(t)) return 'Другое'
  return `Другое: ${maskNames(t)}`.slice(0, 120)
}

// The manager's note, from whichever field this CRM sends (the API does not say which); null when there is none.
const NOTE_FIELDS = ['lost_comment', 'refusal_comment', 'comment', 'comments', 'note', 'notes', 'description']
export function noteOf(r) {
  for (const field of NOTE_FIELDS) {
    const v = r?.[field]
    const one = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.text ?? x.body ?? x.comment ?? x.note ?? '' : '')
    const text = String((Array.isArray(v) ? v.map(one).filter(Boolean).join(' · ') : one(v)) || '').replace(/\s+/g, ' ').trim()
    if (text.length >= 3) return { field, text: text.slice(0, 600) }
  }
  return null
}

// A note without people: phones, mail, IIN, links and nicknames, the client's and the manager's names in any form,
// then every capitalised word that is not a known one. Better a word too many hidden than a name left.
export function anonNote(text, r = {}) {
  const c = r.client || r.contact || {}
  const names = [r.name, r.client_name, r.full_name, r.fio, r.contact_name, c.name, c.full_name, r.manager, r.manager_name, r.responsible].filter((x) => typeof x === 'string' && x.trim())
  let t = scrub(String(text || '')).replace(/https?:\/\/\S+/g, '[ссылка]').replace(/@[\w.]{3,}/g, '[ник]')
  const re = names.length ? nameMatcher(names) : null
  if (re) t = t.replace(re, '[имя]')
  return maskNames(t).replace(/\s+/g, ' ').trim().slice(0, 400)
}
const noteHash = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)

// only the listed fields are kept: whatever else the CRM sends never gets into the office
export function normalize(r, map = {}) {
  if (!r || r.id == null) return null
  const stageLabel = str(r.stage_label) || str(r.stage) || ''
  const stage = stageOf(r.stage, stageLabel, map.stages)
  const g = String(r.gender || '').toLowerCase()
  const age = num(r.age)
  const ap = r.apartment || {}
  const [source, sourceKnown] = sourceOf(str(r.source), str(r.source_label), map.sources)
  return {
    id: String(r.id),
    created_at: date(r.created_at), updated_at: date(r.updated_at),
    source, source_known: sourceKnown, source_label: str(r.source_label) || str(r.source), archived: !!r.archived,
    ...channelOf(r),
    campaign_id: str(r.campaign_id), ad_id: str(r.ad_id), ad_name: str(r.ad_name),
    // the link inside the «from an ad» card of the first WhatsApp message: the promoted Instagram post
    ad_post: postOf(r.ad_url || r.ad_source_url || r.source_url),
    manager: str(r.manager),
    stage: stage || 'lead', stage_label: stageLabel, stage_known: !!stage, stage_at: date(r.stage_at),
    history: (Array.isArray(r.stage_history) ? r.stage_history : []).map((h) => [stageOf(h.stage, str(h.stage_label) || str(h.label) || str(h.stage), map.stages), date(h.at || h.changed_at)]).filter(([s, at]) => s && at),
    first_reply_at: date(r.first_reply_at), next_action_at: date(r.next_action_at),
    lost_after: stageOf(r.lost_after, str(r.lost_after_label), map.stages),
    refusal_reason: cleanReason(r.refusal_reason) || cleanReason(r.lost_reason) || (NON_TARGET.test(stageLabel) ? 'Не целевой' : null),
    gender: /^(f|female|ж|жен)/.test(g) ? 'f' : /^(m|male|м|муж)/.test(g) ? 'm' : null,
    age: age >= 14 && age <= 100 ? Math.round(age) : null,
    // any one of them is enough: a flat number alone links the lead to the chessboard
    apartment: ap.complex || ap.rooms || ap.area || ap.number ? { complex: str(ap.complex), rooms: num(ap.rooms), area: num(ap.area), number: str(ap.number) } : null,
    deal_amount: num(r.deal_amount), deal_at: date(r.deal_at), payment_type: str(r.payment_type),
    ...(isJunk(r) ? { junk: true } : {}),
  }
}

// Where a client came from, for every report: one place, so a later step (first message, UTM, ad codes) refines it here.
// A source the CRM does not know (none, «Вручную», «Не указан») is said honestly: «Источник неизвестен».
// The label in the client's first message (owner, 19.11.2026): every place that leads to WhatsApp has its own ready text,
// ads have a code «Т2-07» (also at the start of the ad name). Only the derived channel and code are kept, never the message.
const CHANNELS = [
  ['ad', /(?<![\p{L}\d])[тt]\s?2\s?[-–—]\s?\d{1,3}(?!\d)/iu],
  ['ig_comments', /из\s+комментари/i],
  ['ig_profile', /из\s+профил/i],
  ['site', /с\s+сайта|\bsite\b/i],
  ['krisha', /с\s+крыш|krisha/i],
  // 2ГИС fills its own text for every card: «Здравствуйте! Пишу из приложения 2ГИС.»
  ['gis', /2\s?гис|2gis/i],
  ['ig_direct', /instagram|инстаграм/i],
]
export const CHANNEL_RU = { ad: 'Реклама Meta (код)', ig_comments: 'Instagram: комментарии', ig_profile: 'Instagram: профиль', ig_direct: 'Instagram: директ', site: 'Сайт', krisha: 'Krisha', gis: '2ГИС' }
const FIRST = ['first_message', 'first_message_text', 'first_msg', 'firstMessage', 'initial_message', 'message', 'text']
export function channelOf(r) {
  const first = FIRST.map((k) => r?.[k]).find((v) => typeof v === 'string' && v.trim()) || ''
  const text = first.slice(0, 300)
  const hit = text && CHANNELS.find(([, re]) => re.test(text))
  if (hit) {
    const code = hit[0] === 'ad' ? text.match(CHANNELS[0][1])[0].toUpperCase().replace(/\s/g, '').replace(/[–—]/, '-').replace('T', 'Т').replace(/-(\d)$/, '-0$1') : null
    return { channel: hit[0], ad_code: code, ...(/park|парк/i.test(text) ? { project: 'park' } : {}) }
  }
  // a site form sends its own marks instead of a message
  const utm = [r?.utm_source, r?.utm_medium, r?.utm_campaign].filter((v) => typeof v === 'string' && v.trim()).join(' ')
  if (utm) return { channel: /insta|facebook|meta|fb/i.test(utm) ? 'ig_direct' : /2gis/i.test(utm) ? 'gis' : /krisha/i.test(utm) ? 'krisha' : 'site', ad_code: null }
  return { channel: null, ad_code: null }
}

export function leadChannel(l) {
  if (l?.channel && CHANNEL_RU[l.channel]) return l.project === 'park' ? { key: `${l.channel}_park`, label: `${CHANNEL_RU[l.channel]} · Qala Park`, code: l.ad_code || null } : { key: l.channel, label: CHANNEL_RU[l.channel], code: l.ad_code || null }
  if (!l) return { key: 'unknown', label: 'Источник неизвестен' }
  if (l.source === 'other' && (!l.source_known || !l.source_label || /вручн|не указан|без источника/i.test(l.source_label))) return { key: 'unknown', label: 'Источник неизвестен' }
  return { key: l.source, label: SOURCE_RU[l.source] || l.source }
}

// the furthest stage a lead ever got to: a loss after a show still counts as «показ проведён»
export const topStage = (l) => top(l)
export const STAGE_ORDER = ORDER
const top = (l) => Math.max(l.stage === 'lost' ? -1 : ORDER[l.stage] ?? 0, l.lost_after ? ORDER[l.lost_after] ?? 0 : 0, ...(l.history || []).map(([s]) => ORDER[s] ?? 0))
const bought = (l) => l.stage === 'sale' || l.stage === 'booking'
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const median = (arr) => { const v = arr.filter((x) => x != null && x >= 0).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null }
const replyMin = (l) => (l.first_reply_at && l.created_at ? (Date.parse(l.first_reply_at) - Date.parse(l.created_at)) / 60000 : null)
// tests and bot probes are never clients
export const realLeads = (leads) => (leads || []).filter((l) => !l.junk)

export function crmSummary(leads, { from, to }) {
  leads = realLeads(leads)
  const inRange = (d) => d && ymd(d) >= from && ymd(d) <= to
  const list = leads.filter((l) => inRange(l.created_at))
  const reached = (k) => list.filter((l) => top(l) >= ORDER[k]).length
  // only the stages this CRM really has: no empty «Показ» or «Бронь» where the CRM goes straight to «Продажа»
  const used = new Set(leads.flatMap((l) => [l.stage, l.lost_after, ...(l.history || []).map(([s]) => s)]))
  const funnel = STAGES.filter(([k]) => k === 'lead' || k === 'sale' || used.has(k)).map(([k, label]) => ({ key: k, label, count: reached(k) }))
  funnel.forEach((s, i) => { s.conv = i && funnel[i - 1].count ? Math.round((s.count / funnel[i - 1].count) * 100) : null })
  const now = Date.now()
  // the manager's to-do list: open leads of this window only, by CRM number (no names or phones)
  const open = list.filter((l) => !['sale', 'lost'].includes(l.stage) && !l.archived)
  const noNextList = open.filter((l) => !l.next_action_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const overdueList = open.filter((l) => l.next_action_at && Date.parse(l.next_action_at) < now).sort((a, b) => Date.parse(a.next_action_at) - Date.parse(b.next_action_at))
  const count = (arr, key) => Object.entries(arr.reduce((o, x) => ((o[x[key] || 'не указано'] = (o[x[key] || 'не указано'] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1])
  const lost = list.filter((l) => l.stage === 'lost')
  return {
    leads: list.length, funnel,
    refusals: count(lost, 'refusal_reason'),
    // where clients are lost: the last stage they reached before the refusal
    lostAfter: count(lost.map((l) => ({ at: STAGE_RU[l.lost_after] || 'не указано' })), 'at'),
    noNext: noNextList.length, noNextIds: noNextList.slice(0, 20).map((l) => l.id),
    overdue: overdueList.length, overdueIds: overdueList.slice(0, 20).map((l) => l.id),
    replyMedianMin: median(list.map(replyMin)),
    // clients who waited for the first answer longer than 2 hours
    slowReplies: list.filter((l) => replyMin(l) > 120).length,
    reactivate: leads.filter((l) => l.stage === 'lost' && (ORDER[l.lost_after] ?? -1) >= ORDER.show_done).length,
    managers: Object.entries(list.reduce((o, l) => { const m = l.manager || 'не указан'; o[m] ??= { leads: 0, bookings: 0, sales: 0, replies: [] }; o[m].leads++; if (top(l) >= ORDER.booking) o[m].bookings++; if (l.stage === 'sale') o[m].sales++; o[m].replies.push(replyMin(l)); return o }, {}))
      .map(([name, v]) => ({ name, leads: v.leads, bookings: v.bookings, sales: v.sales, conv: pct(v.bookings, v.leads), replyMin: median(v.replies) })).sort((a, b) => b.leads - a.leads),
    sources: count(list.map((l) => ({ s: leadChannel(l).label })), 's'),
    // ads with a code in the first message: «Т2-07» → clients and how many reached a booking or a sale
    adCodes: Object.entries(list.filter((l) => l.ad_code).reduce((o, l) => { o[l.ad_code] ??= { leads: 0, bought: 0 }; o[l.ad_code].leads++; if (top(l) >= ORDER.booking) o[l.ad_code].bought++; return o }, {})).sort((a, b) => b[1].leads - a[1].leads).map(([code, v]) => ({ code, ...v })),
  }
}

// Minutes of the manager's working time between two moments; hours = { weekday: [from, to] }, Astana time.
export function workMinutes(fromMs, toMs, hours = {}) {
  if (!(toMs > fromMs)) return 0
  let total = 0
  const H = 3600e3, DAY = 864e5, TZ = 5 * H
  for (let day = Math.floor((fromMs + TZ) / DAY) * DAY - TZ; day < toMs; day += DAY) {
    const span = hours[new Date(day + TZ).getUTCDay()]
    if (!span) continue
    const a = Math.max(fromMs, day + span[0] * H), b = Math.min(toMs, day + span[1] * H)
    if (b > a) total += (b - a) / 60000
  }
  return Math.round(total)
}

// The home page pulse: new leads per 7-day window (window 0 = the last 7 days), clients still waiting
// for the first answer, where this week's leads came from, how many turn out «Не целевой».
export function crmPulse(leads, { syncedAt, hours } = {}) {
  const now = Date.now(), DAY = 864e5
  const junk = (leads || []).filter((l) => l.junk).length
  leads = realLeads(leads)
  // every real lead counts: «Не целевой» is marked days later, so leaving it out would make older weeks look
  // smaller than the current one; the non-target share is shown apart (nonTarget, leads 3+ days old)
  const clients = leads
  const firstAt = leads.reduce((m, l) => (l.created_at && (!m || l.created_at < m) ? l.created_at : m), null)
  const first = firstAt ? Date.parse(firstAt) : now
  const weeks = [...Array(6)].map((_, w) => {
    const to = now - w * 7 * DAY, from = to - 7 * DAY
    return { count: clients.filter((l) => { const t = Date.parse(l.created_at); return t > from && t <= to }).length, full: first <= from }
  })
  const until = syncedAt ? Date.parse(syncedAt) : now
  // only chats that came by themselves: a lead typed in by hand or archived is not «waiting»
  const waiting = leads
    .filter((l) => l.stage === 'lead' && !l.archived && !l.first_reply_at && ['whatsapp', 'instagram', 'meta', 'site'].includes(l.source) && Date.parse(l.created_at) > now - 10 * DAY)
    .map((l) => ({ id: l.id, source: SOURCE_RU[l.source] || l.source, minutes: workMinutes(Date.parse(l.created_at), until, hours) }))
    // over 2 working hours; after 3 working days a silent lead is most likely abandoned in the CRM
    .filter((x) => x.minutes > 120 && x.minutes <= 3 * 9 * 60)
    .sort((a, b) => b.minutes - a.minutes)
  const week = clients.filter((l) => Date.parse(l.created_at) > now - 7 * DAY)
  // the manager marks «Не целевой» later: judge leads that are at least 3 days old
  const settled = leads.filter((l) => { const t = Date.parse(l.created_at); return t <= now - 3 * DAY && t > now - 30 * DAY })
  const nonTarget = settled.filter(isNonTarget).length
  return {
    firstAt, weeks, waiting, junk,
    sources: Object.entries(week.reduce((o, l) => { const k = SOURCE_RU[l.source] || l.source; o[k] = (o[k] || 0) + 1; return o }, {})).sort((a, b) => b[1] - a[1]),
    nonTarget: { n: nonTarget, of: settled.length, pct: pct(nonTarget, settled.length) },
    withApartment: leads.some((l) => l.apartment?.number), withAd: leads.some((l) => l.ad_post || l.ad_id),
  }
}

// all time: who buys (booked or bought) among everyone who came, by gender, age and source
export function whoBuys(leads) {
  leads = realLeads(leads)
  const group = (key) => {
    const o = {}
    for (const l of leads) { const k = key(l); if (!k) continue; o[k] ??= { leads: 0, bought: 0, revenue: 0 }; o[k].leads++; if (bought(l)) { o[k].bought++; o[k].revenue += l.deal_amount || 0 } }
    return Object.entries(o).map(([k, v]) => ({ key: k, ...v, conv: pct(v.bought, v.leads) }))
  }
  const all = leads.filter(bought).length
  return {
    leads: leads.length, bought: all,
    gender: group((l) => ({ f: 'Женщины', m: 'Мужчины' })[l.gender]),
    age: group((l) => ageGroup(l.age)).sort((a, b) => AGES.findIndex((x) => x[2] === a.key) - AGES.findIndex((x) => x[2] === b.key)),
    sources: group((l) => SOURCE_RU[l.source] || l.source).sort((a, b) => b.bought - a.bought || b.leads - a.leads),
    rooms: group((l) => (bought(l) && l.apartment?.rooms ? `${l.apartment.rooms}-комн.` : null)).sort((a, b) => a.key.localeCompare(b.key)),
    payment: group((l) => (bought(l) ? l.payment_type : null)).sort((a, b) => b.leads - a.leads),
  }
}

// which ads brought the buyers (all time); names and spend come from Алия's ad archive.
// A lead knows its ad by number (ad_id) or by the promoted post (ad_post): one post may run in several ads — their spend is summed.
export function byAd(leads) {
  leads = realLeads(leads)
  const archive = read(path.join(P.data, 'ads', 'archive.json'), null)
  const byPost = {}
  for (const [id, a] of Object.entries(archive?.ads || {})) if (a.set?.post) (byPost[a.set.post] ||= []).push([id, a])
  const o = {}
  for (const l of leads) {
    const key = l.ad_id || (l.ad_post ? `post:${l.ad_post}` : null) || (l.ad_name ? `name:${l.ad_name}` : null)
    if (!key) continue
    o[key] ??= { ad_id: l.ad_id, post: l.ad_post, name: l.ad_name, leads: 0, bookings: 0, sales: 0, revenue: 0 }
    const x = o[key]
    x.leads++
    if (top(l) >= ORDER.booking) x.bookings++
    if (l.stage === 'sale') { x.sales++; x.revenue += l.deal_amount || 0 }
  }
  const clean = (n) => String(n || '').replace(/^Публикация в Instagram:\s*/i, '')
  return Object.values(o).map((x) => {
    const ads = x.ad_id ? (archive?.ads?.[x.ad_id] ? [[x.ad_id, archive.ads[x.ad_id]]] : []) : x.post ? byPost[x.post] || [] : []
    const url = x.post ? `https://www.instagram.com/p/${x.post}/` : null
    return {
      ...x, url, ads: ads.length,
      name: ads.length ? clean(ads[0][1].name) : x.name || (x.post ? `публикация ${x.post}` : `объявление ${x.ad_id}`),
      spend: ads.length ? Math.round(ads.reduce((t, [, a]) => t + (a.total.spend || 0), 0)) : null,
      currency: archive?.currency || '',
    }
  }).sort((a, b) => b.sales - a.sales || b.bookings - a.bookings || b.leads - a.leads)
}

export class Crm extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.cfg.crm ??= { type: '', url: '', key: '' }
    this.c = this.cfg.crm
    this.error = ''
    this.checkedAt = 0
    this.data = read(FILE, null)
    this.syncing = null
    // a full pull that failed is retried once an hour; a suspiciously short full list is remembered here
    this.fullFailAt = 0
    this.shrink = null
    if (this.data?.syncedAt) seedOk('crm', Date.parse(this.data.syncedAt))
    // own words for refused leads ({ id: { h, reason, words, at } }) and whether notes come at all; never the notes themselves
    this.refusals = read(REFUSALS, { field: null, lost: 0, withNote: 0, at: null, leads: {} })
    this.refusals.leads ||= {}
    // anonymised notes waiting for Ерлан, by lead id: memory only, refilled by the nightly full pull
    this.noteQueue = new Map()
  }

  status() {
    const d = this.data
    const all = d ? Object.values(d.leads) : []
    const r = this.refusals
    return { configured: !!(this.c.url && this.c.key), url: this.c.url, ok: !!this.c.ok, error: this.error, checkedAt: this.checkedAt, count: all.length, junk: all.filter((l) => l.junk).length, syncedAt: d?.syncedAt || null, unknown: this.unknown(),
      notes: { field: r.field, lost: r.lost, withNote: r.withNote, at: r.at, explained: Object.keys(r.leads).length, queued: this.noteQueue.size } }
  }

  // a refused lead's note: anonymised right here, queued unless the same text was already retold
  collectNote(raw, l, seen) {
    if (!l || l.junk || l.stage !== 'lost') return
    seen.lost++
    const n = noteOf(raw)
    if (!n) return
    seen.withNote++
    seen.field ||= n.field
    const text = anonNote(n.text, raw)
    if (text.length < 3) return
    const h = noteHash(text)
    if (this.refusals.leads[l.id]?.h === h) return this.noteQueue.delete(l.id)
    this.noteQueue.set(l.id, { id: l.id, h, text, reason: l.refusal_reason || 'не указана' })
  }

  // up to n queued notes for one run of Ерлан, oldest leads first
  pendingNotes(n = 40) {
    return [...this.noteQueue.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), 'ru', { numeric: true })).slice(0, n)
  }

  // [{ id, h, reason, words }]: the words are anonymised once more (a model may still repeat a name) and clipped
  saveRefusalWords(items) {
    const at = new Date().toISOString()
    for (const x of items || []) {
      const q = this.noteQueue.get(String(x.id))
      if (!q) continue
      const words = anonNote(String(x.words || ''), {}).slice(0, 90)
      const reason = String(x.reason || q.reason || '').replace(/[«»"]/g, '').trim().slice(0, 40) || q.reason
      this.refusals.leads[q.id] = { h: q.h, reason, words, at }
      this.noteQueue.delete(q.id)
    }
    this.saveRefusals()
  }

  // { id: { reason, words } } for the reports
  refusalWords() { return this.refusals.leads }

  saveRefusals() {
    // only leads that still exist: a lead deleted in the CRM takes its words with it
    const known = this.data?.leads
    if (known) for (const id of Object.keys(this.refusals.leads)) if (!known[id]) delete this.refusals.leads[id]
    write(REFUSALS, this.refusals)
  }

  // how old the copy is: an error or more than 3 hours without a pull (it runs every hour) is «stale»
  freshness() {
    const at = this.data?.syncedAt ? Date.parse(this.data.syncedAt) : 0
    const ageH = at ? Math.round(((Date.now() - at) / 36e5) * 10) / 10 : null
    return { syncedAt: this.data?.syncedAt || null, ageH, stale: !!this.error || ageH == null || ageH > 3, error: this.error || '' }
  }

  // CRM names the office could not place: shown in ⚙ so the mapping can be fixed
  unknown() {
    const leads = Object.values(this.data?.leads || {})
    return {
      stages: [...new Set(leads.filter((l) => !l.stage_known && l.stage_label).map((l) => l.stage_label))].slice(0, 20),
      sources: [...new Set(leads.filter((l) => !l.source_known && l.source_label).map((l) => l.source_label))].slice(0, 20),
    }
  }

  async page(params) {
    const url = new URL(this.c.url)
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.c.key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (r.status === 401) throw new Error('CRM не приняла ключ. Проверьте, что он скопирован целиком.')
    if (r.status === 403) throw new Error('CRM отказала в доступе: у ключа нет прав или запрос пришёл не с адреса сервера офиса.')
    if (r.status === 404) throw new Error('По этому адресу нет API CRM. Нужен адрес вида https://crm.example.kz/api/analytics/leads')
    if (r.status === 429) throw new Error('CRM просит обращаться реже — попробую позже.')
    if (!r.ok) throw new Error(`CRM ответила ошибкой ${r.status}.`)
    const text = await r.text()
    let j
    try { j = JSON.parse(text) } catch { throw new Error('CRM ответила не в формате JSON — похоже, это адрес сайта, а не API.') }
    if (!Array.isArray(j.leads)) throw new Error('В ответе CRM нет списка leads.')
    return j
  }

  async configure(url, key) {
    if (url) {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url
      let u
      try { u = new URL(url) } catch { throw new Error('Не похоже на адрес. Нужен адрес вида https://crm.example.kz/api/analytics/leads') }
      if (u.pathname === '/' || !u.pathname) u.pathname = '/api/analytics/leads'
      u.search = ''
      this.c.url = u.toString()
    }
    if (key) this.c.key = key
    this.c.type = 'crm-example'
    this.c.ok = false
    saveConfig(this.cfg)
    try {
      await this.page({ limit: 1 })
      this.c.ok = true
      this.error = ''
    } catch (e) {
      this.error = e.name === 'TimeoutError' ? 'CRM не ответила за 30 секунд. Проверьте адрес.' : e.message
    }
    this.checkedAt = Date.now()
    saveConfig(this.cfg)
    this.emit('status')
    if (this.c.ok) this.sync(true).catch(() => {})
    return this.status()
  }

  unlink() {
    this.cfg.crm = this.c = { type: '', url: '', key: '' }
    this.error = ''
    this.data = null
    try { fs.rmSync(FILE, { force: true }) } catch {}
    saveConfig(this.cfg)
    this.emit('status')
    return this.status()
  }

  // full = the whole list again (once a night: also drops leads deleted in the CRM); otherwise only the changes
  sync(full = false) {
    if (!this.status().configured) return Promise.resolve(0)
    if (this.syncing) return this.syncing
    full ||= !this.data?.from || this.data.v !== VERSION
    this.syncing = (async () => {
      const startedAt = Date.now()
      const before = this.data ? Object.keys(this.data.leads).length : 0
      const d = full ? { leads: {} } : this.data
      let cursor = null, n = 0, pages = 0
      const seen = { lost: 0, withNote: 0, field: null }
      do {
        const j = await this.page({ limit: 500, cursor, updated_since: full ? null : this.data.from })
        for (const raw of j.leads) { const l = normalize(raw, this.c.map); if (l) { d.leads[l.id] = l; n++; try { this.collectNote(raw, l, seen) } catch (e) { console.error('CRM, заметка:', e.message) } } }
        cursor = j.next_cursor || null
        if (++pages > 400) throw new Error('CRM отдаёт слишком много страниц — остановился, чтобы не зациклиться.')
      } while (cursor)
      // a full list far shorter than the copy is more likely a CRM failure than deleted clients: the copy stays.
      // The same short list for a whole day is believed.
      const got = Object.keys(d.leads).length
      if (full && before >= 20 && got < before * 0.5) {
        if (this.shrink?.n !== got) this.shrink = { n: got, since: Date.now() }
        if (Date.now() - this.shrink.since < 24 * 3600e3) throw new Error(`CRM отдала только ${got} лидов вместо ${before} — похоже на сбой CRM. Оставил прежнюю копию; если клиентов правда удалили, офис примет новый список через сутки.`)
      }
      this.shrink = null
      d.syncedAt = new Date().toISOString()
      // a small overlap: a change made during the pull comes again next time instead of being lost
      d.from = astanaIso(startedAt - 10 * 60e3)
      if (full) d.fullAt = d.syncedAt
      d.v = VERSION
      this.data = d
      write(FILE, d)
      // whether the notes of refusals come at all: judged by a full pull (all refused leads at once)
      if (full || seen.withNote) {
        const r = this.refusals
        if (full) Object.assign(r, { lost: seen.lost, withNote: seen.withNote, at: d.syncedAt, field: seen.field || (seen.lost ? null : r.field) })
        else r.field ||= seen.field
        this.saveRefusals()
      }
      this.c.ok = true
      this.error = ''
      if (full) this.fullFailAt = 0
      markOk('crm')
      this.emit('status')
      return n
    })().catch((e) => {
      this.error = e.name === 'TimeoutError' ? 'CRM не ответила за 30 секунд.' : e.message
      if (full) this.fullFailAt = Date.now()
      console.error('CRM:', this.error)
      markFail('crm', this.error)
      this.emit('status')
      throw e
    }).finally(() => { this.syncing = null })
    return this.syncing
  }

  start() {
    const tick = () => {
      if (!this.status().configured || this.syncing) return
      const d = this.data
      let full = !d?.fullAt || d.v !== VERSION || (ymd(d.fullAt) !== ymd(Date.now()) && hourNow() >= 3)
      // a failed full pull waits an hour; meanwhile the changes keep coming if the copy allows it
      if (full && this.fullFailAt && Date.now() - this.fullFailAt < 3600e3) {
        if (!d?.from || d.v !== VERSION) return
        full = false
      }
      if (full || !d?.syncedAt || Date.now() - Date.parse(d.syncedAt) > 55 * 60e3) this.sync(full).catch(() => {})
    }
    setTimeout(tick, 60 * 1000).unref?.()
    setInterval(tick, 10 * 60 * 1000).unref?.()
  }

  // the stored copy; when the CRM does not answer it is still given, but marked: list.stale, list.ageH, list.error
  async leads() {
    if (!this.status().configured) return null
    if (!this.data) await this.sync(true)
    return Object.assign(Object.values(this.data.leads), this.freshness())
  }

  // for Ерлан, Нурлан and Алия: one plain summary, no personal data
  async writeFor(dir) {
    const all = await this.leads()
    const leads = realLeads(all)
    if (!leads.length) return false
    const today = ymd(Date.now())
    const back = (n) => ymd(Date.now() - n * 864e5)
    const cur = crmSummary(leads, { from: back(27), to: today }), prev = crmSummary(leads, { from: back(55), to: back(28) })
    const who = whoBuys(leads), ads = byAd(leads)
    const money = (v) => (v ? `${Math.round(v).toLocaleString('ru-RU')} ₸` : '—')
    const rows = (head, list) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...list.map((r) => `| ${r.join(' | ')} |`)]
    const t = [
      `# CRM Altyn Qala Group — сводка для аналитики, обновлено ${new Date(this.data.syncedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`,
      ...(all.stale ? [`⚠ CRM не обновлялась ${all.ageH == null ? 'давно' : `${all.ageH} ч`}${all.error ? ` (${all.error})` : ''} — цифры на время выше, свежих изменений в них нет. Так и скажи в выводах.`] : []),
      'Без личных данных: ни имён, ни телефонов, ни переписки. «Купили» = бронь или продажа. Причины отказа сведены в короткий список.',
      ...(all.length > leads.length ? [`Тестовые и спам-лиды (проверки формы сайта, «test», номера из одних нулей) не считаются: ${all.length - leads.length}.`] : []),
      `Всего лидов в CRM: ${leads.length}, из них купили ${who.bought} (${pct(who.bought, leads.length) ?? 0}%).`,
      '', '## Воронка: лиды за последние 28 дней к предыдущим 28',
      ...rows(['этап', 'сейчас', 'было', 'переход с прошлого этапа'], cur.funnel.map((s, i) => [s.label, s.count, prev.funnel[i].count, s.conv == null ? '—' : `${s.conv}%`])),
      '', '## Где теряем (на каком этапе был клиент перед отказом) и почему — 28 дней',
      ...rows(['этап', 'отказов'], cur.lostAfter.map(([k, v]) => [k, v])),
      '', ...rows(['причина отказа', 'сколько'], cur.refusals.slice(0, 12).map(([k, v]) => [k, v])),
      '', ...rows(['откуда пришли (по метке первого сообщения или CRM)', 'лидов'], cur.sources.slice(0, 12)),
      ...(cur.adCodes.length ? ['', ...rows(['код объявления в первом сообщении', 'лидов', 'дошли до брони/продажи'], cur.adCodes.slice(0, 15).map((x) => [x.code, x.leads, x.bought]))] : []),
      '', `Скорость первого ответа (медиана): ${cur.replyMedianMin == null ? '—' : cur.replyMedianMin < 1 ? 'меньше минуты' : `${cur.replyMedianMin} мин`} (было ${prev.replyMedianMin ?? '—'}); ждали ответа дольше 2 часов: ${cur.slowReplies} (было ${prev.slowReplies}).`,
      ` Открытых лидов за 28 дней без следующего шага: ${cur.noNext}${cur.noNextIds.length ? ` (в CRM: ${cur.noNextIds.slice(0, 10).map((x) => `№${x}`).join(', ')})` : ''}, просрочено: ${cur.overdue}${cur.overdueIds.length ? ` (${cur.overdueIds.slice(0, 10).map((x) => `№${x}`).join(', ')})` : ''}. Отказались после показа (можно вернуть): ${cur.reactivate}.`,
      '', '## Менеджеры — 28 дней',
      ...rows(['менеджер', 'лидов', 'бронь/продажа', 'конверсия', 'продаж', 'первый ответ, мин'], cur.managers.map((m) => [m.name, m.leads, m.bookings, m.conv == null ? '—' : `${m.conv}%`, m.sales, m.replyMin ?? '—'])),
      '', '## Откуда приходят покупатели — за всё время',
      ...rows(['источник', 'лидов', 'купили', 'конверсия', 'сумма сделок'], who.sources.map((s) => [s.key, s.leads, s.bought, s.conv == null ? '—' : `${s.conv}%`, money(s.revenue)])),
      '', '## Какая реклама привела покупателей — за всё время',
      ...(ads.length
        ? rows(['объявление', 'лидов', 'брони', 'продажи', 'сумма продаж', `расход за всё время${ads[0].currency ? `, ${ads[0].currency}` : ''}`, 'расход на продажу'], ads.slice(0, 30).map((a) => [a.name.replace(/\|/g, '/').slice(0, 70), a.leads, a.bookings, a.sales, money(a.revenue), a.spend ?? '—', a.spend && a.sales ? Math.round(a.spend / a.sales) : '—']))
        : ['В CRM у лидов нет номера или названия объявления — видно только источник (таблица выше).']),
      '', '## Кто покупает — за всё время (пол и возраст считает CRM)',
      ...rows(['пол', 'лидов', 'купили', 'конверсия'], who.gender.map((g) => [g.key, g.leads, g.bought, g.conv == null ? '—' : `${g.conv}%`])),
      '', ...rows(['возраст', 'лидов', 'купили', 'конверсия'], who.age.map((g) => [g.key, g.leads, g.bought, g.conv == null ? '—' : `${g.conv}%`])),
      '', '## Что покупают',
      ...rows(['комнатность', 'покупок', 'сумма'], who.rooms.map((g) => [g.key, g.leads, money(g.revenue)])),
      '', ...rows(['способ оплаты', 'покупок'], who.payment.map((g) => [g.key, g.leads])),
    ]
    const u = this.unknown()
    if (u.stages.length || u.sources.length) t.push('', `Названия CRM, которые офис пока не сопоставил (этапы: ${u.stages.join(', ') || '—'}; источники: ${u.sources.join(', ') || '—'}) — считаются как «Лиды» и «Другое».`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'crm-сводка.md'), `${t.join('\n')}\n`, 'utf8')
    return true
  }
}
