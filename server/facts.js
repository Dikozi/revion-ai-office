// Numbers Мадина shows to buyers — prices, areas, terms, floors, years — must come from what she was given:
// the knowledge base, the owner's files, colleagues' work or the task itself. Plain code, no Claude.
import fs from 'node:fs'
import path from 'node:path'

const NUM = String.raw`(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d+))?`
const UNIT = String.raw`млн|тыс|₸|тг|тенге|м²|м2|кв\.?\s?м|%|этаж\w*|комнатн\w*|квартир\w*|лифт\w*|лет|год\w*|минут\w*|мин|км|м`
const CLAIM = new RegExp(`(?<![\\d.,:])${NUM}\\s*-?\\s*(${UNIT})(?![а-яёa-z0-9])`, 'giu')
// a year in prose, not a part of a date like 14.10.2026
const YEAR = /(?<![\d.\/-])20[2-3]\d(?!\d|[.,:\/-]\d)/g
const ANY = new RegExp(`${NUM}\\s*(млн|тыс)?`, 'giu')
const TEXT = /\.(md|txt|json|csv|html?)$/i

const value = (int, frac) => Number(`${int.replace(/[ \u00a0]/g, '')}${frac ? `.${frac}` : ''}`)
const scale = (unit) => (/^млн/i.test(unit || '') ? 1e6 : /^тыс/i.test(unit || '') ? 1e3 : 1)
const key = (v) => Math.round(v * 100) / 100
// small counts (floors, minutes, percent…) appear everywhere: they must match together with their unit
const STEM = [[/^этаж/i, 'этаж'], [/^квартир/i, 'квартир'], [/^лифт/i, 'лифт'], [/^(лет|год)/i, 'год'], [/^мин/i, 'мин'], [/^км$/i, 'км'], [/^м$/i, 'м'], [/^%$/, '%']]
const stem = (unit) => STEM.find(([re]) => re.test(unit))?.[1] || null

// what the employee shows: visible text of a mockup, the captions of a pack, a text file as is
function visible(file) {
  const raw = fs.readFileSync(file, 'utf8')
  if (/\.html?$/i.test(file)) return raw.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  if (/пакет\.json$/i.test(file)) {
    try { return (JSON.parse(raw).items || []).map((x) => `${x.caption || ''}\n${typeof x.sticker === 'object' ? JSON.stringify(x.sticker) : x.sticker || ''}`).join('\n') } catch { return '' }
  }
  if (/\.json$/i.test(file)) return ''
  return raw
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (TEXT.test(e.name) && fs.statSync(f).size < 3e6) out.push(f)
  }
  return out
}

// every number the employee was allowed to use, as is and multiplied out (20,5 млн = 20 500 000)
function known(ws, extra) {
  const set = new Set()
  const add = (text) => {
    for (const m of text.matchAll(ANY)) {
      const v = value(m[1], m[2])
      set.add(key(v))
      if (m[3]) set.add(key(v * scale(m[3])))
    }
    for (const m of text.matchAll(CLAIM)) if (stem(m[3])) set.add(`${key(value(m[1], m[2]))}|${stem(m[3])}`)
  }
  add(extra || '')
  for (const dir of ['_база', '_материалы', '_от_коллег']) for (const f of walk(path.join(ws, dir))) { try { add(fs.readFileSync(f, 'utf8')) } catch {} }
  return set
}

// files: the employee's own outputs (paths relative to ws). Returns [{ file, issues }]
export function checkFacts(ws, files, extra = '') {
  const base = known(ws, extra)
  const out = []
  for (const rel of files.filter((f) => TEXT.test(f))) {
    let text
    try { text = visible(path.join(ws, rel)) } catch { continue }
    const issues = new Set()
    for (const m of text.matchAll(CLAIM)) {
      const v = value(m[1], m[2]), st = stem(m[3])
      const ok = st ? base.has(`${key(v)}|${st}`) : base.has(key(v)) || base.has(key(v * scale(m[3])))
      if (!ok) issues.add(`«${m[0].trim()}» — такой цифры нет в базе и в материалах`)
    }
    for (const m of text.matchAll(YEAR)) if (!base.has(Number(m[0]))) issues.add(`«${m[0]}» — такого года нет в базе и в материалах`)
    if (issues.size) out.push({ file: rel, issues: [...issues].slice(0, 8) })
  }
  return out
}
