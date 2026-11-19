// Small inline-SVG charts and tiles for the PDF reports (weekly, monthly). Print-friendly, REVION palette,
// no libraries and no fonts beyond the system ones. One scale per chart: two measures are two charts.
// A value nobody knows (null) is drawn as «нет данных», never as 0.

export const C = { ink: '#0B1728', navy: '#173F68', blue: '#3185E8', green: '#1E956B', bg: '#F5F7FA', line: '#D5DCE6', muted: '#5B6B7F', soft: '#A9BBD0', red: '#C2410C', amber: '#B7791F' }

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const nb = (s) => String(s).replace(/ /g, ' ')
export const n0 = (v) => (v == null ? '—' : nb(Math.round(v).toLocaleString('ru-RU')))
export const n1 = (v) => (v == null ? '—' : nb((Math.round(v * 10) / 10).toLocaleString('ru-RU')))
export const n2 = (v) => (v == null ? '—' : nb((Math.round(v * 100) / 100).toLocaleString('ru-RU')))
export const mln = (v) => (v == null ? '—' : Math.abs(v) >= 1e6 ? `${n1(v / 1e6)} млн ₸` : `${n0(v)} ₸`)
export const mlnShort = (v) => (v == null ? '—' : Math.abs(v) >= 1e6 ? n1(v / 1e6) : n1(v / 1e6))
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 10, b = Math.abs(n) % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many }

// the change of a number and whether it is good: { text: '+45%', dir: 1|-1|0, good: true|false|null }
export function change(now, prev, good = 'up') {
  if (now == null || prev == null) return { text: '', dir: 0, good: null }
  if (prev === 0) return now === 0 ? { text: 'без изменений', dir: 0, good: null } : { text: 'с нуля', dir: now > 0 ? 1 : -1, good: (now > 0) === (good === 'up') }
  const p = ((now - prev) / Math.abs(prev)) * 100
  if (Math.abs(p) < 0.5) return { text: 'без изменений', dir: 0, good: null }
  const dir = p > 0 ? 1 : -1
  // a big jump reads better as «×N» than as «+7 620%»
  const text = prev > 0 && now / prev >= 3 ? `×${n1(now / prev)}` : `${p > 0 ? '+' : '−'}${n0(Math.abs(p))}%`
  return { text, dir, good: good === 'neutral' ? null : (dir > 0) === (good === 'up') }
}

// a KPI tile: the big number, an arrow (green good / red bad, with a word, never colour alone), «было → стало» and the average
export function kpiTile({ label, value, sub = '', now, prev, avg, good = 'up', fmt = n0, unit = '' }) {
  const ch = change(now, prev, good)
  const color = ch.good == null ? C.muted : ch.good ? C.green : C.red
  const arrow = ch.dir > 0 ? '↑' : ch.dir < 0 ? '↓' : '→'
  const word = ch.good == null ? '' : ch.good ? 'лучше' : 'хуже'
  const known = now != null
  return `<div class="kpi"><div class="kl">${esc(label)}</div>
    <div class="kv">${known ? esc(value ?? fmt(now)) : '<span class="nd">нет данных</span>'}${known && unit ? ` <span class="ku">${esc(unit)}</span>` : ''}</div>
    ${known && ch.text ? `<div class="kc" style="color:${color}"><b>${arrow} ${esc(ch.text)}</b>${word ? ` · ${word}` : ''}</div>` : '<div class="kc">&nbsp;</div>'}
    <div class="ks">${prev != null ? `было ${esc(fmt(prev))}` : 'было: нет данных'}${avg != null ? ` · среднее ${esc(fmt(avg))}` : ''}${sub ? ` · ${esc(sub)}` : ''}</div></div>`
}

// vertical bars; values: number | null. `hot` marks the bars to stress (the period of the report), `partial` — not finished yet
export function vbars(values, labels, { w = 320, h = 110, fmt = n0, color = C.blue, hot = [], partial = [], avg = null, avgLabel = '', unit = '' } = {}) {
  const n = values.length
  if (!n || values.every((v) => v == null)) return `<div class="nodata">нет данных</div>`
  const top = 16, bottom = 18
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v || 0)), avg || 0)
  const neg = values.some((v) => v < 0)
  const base = neg ? top + (h - top - bottom) / 2 : h - bottom
  const span = neg ? (h - top - bottom) / 2 : h - top - bottom
  const step = w / n, bw = Math.max(3, Math.min(34, step * 0.62))
  const every = Math.max(1, Math.ceil(n / Math.floor(w / 34)))
  const showVal = (i) => n <= 14 || hot[i] || i === n - 1 || values[i] === Math.max(...values.filter((v) => v != null))
  let s = `<line x1="0" y1="${base}" x2="${w}" y2="${base}" stroke="${C.line}"/>`
  values.forEach((v, i) => {
    const cx = step * i + step / 2
    if (v == null) {
      s += `<text x="${cx}" y="${base - 4}" text-anchor="middle" font-size="7.5" fill="${C.soft}">н/д</text>`
    } else {
      const bh = Math.max(v ? 2 : 0, (Math.abs(v) / max) * span)
      const y = v >= 0 ? base - bh : base
      const fill = hot.length ? (hot[i] ? color : C.soft) : color
      s += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${bh}" rx="${Math.min(4, bw / 3)}" fill="${fill}"${partial[i] ? ' fill-opacity=".55"' : ''}/>`
      if (showVal(i)) s += `<text x="${cx}" y="${v >= 0 ? y - 4 : y + bh + 10}" text-anchor="middle" font-size="${n > 14 ? 7.5 : 9}" font-weight="700" fill="${C.ink}">${esc(fmt(v))}</text>`
    }
    if (i % every === (n - 1) % every) s += `<text x="${cx}" y="${h - 5}" text-anchor="middle" font-size="${n > 14 ? 7.5 : 8.5}" fill="${C.muted}">${esc(labels[i])}${partial[i] ? '*' : ''}</text>`
  })
  if (avg != null && avg > 0) {
    const y = base - (avg / max) * span
    s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${C.amber}" stroke-dasharray="4 3"/><text x="${w - 2}" y="${y - 3}" text-anchor="end" font-size="8" fill="${C.amber}">${esc(avgLabel || `среднее ${fmt(avg)}`)}</text>`
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">${s}</svg>${unit ? `<div class="unit">${esc(unit)}</div>` : ''}`
}

// horizontal bars with the label on the left and the value on the right: sources, reasons
export function hbars(items, { fmt = n0, color = C.blue, max: maxRows = 6, empty = 'нет данных', note } = {}) {
  const list = (items || []).filter((x) => x && x.value > 0).slice(0, maxRows)
  if (!list.length) return `<div class="nodata">${esc(empty)}</div>`
  const max = Math.max(...list.map((x) => x.value))
  return `<div class="hb">${list.map((x) => `<div class="hr"><span class="hl">${esc(x.label)}</span><span class="ht"><i style="width:${Math.max(3, (x.value / max) * 100)}%;background:${x.color || color}"></i></span><span class="hv">${esc(fmt(x.value))}${x.sub ? ` <small>${esc(x.sub)}</small>` : ''}</span></div>`).join('')}</div>${note ? `<div class="unit">${esc(note)}</div>` : ''}`
}

// a funnel of steps, each with its share of the step before
export function funnel(steps) {
  const known = steps.filter((x) => x.value != null)
  if (!known.length) return `<div class="nodata">нет данных</div>`
  const max = Math.max(1, ...known.map((x) => x.value))
  return `<div class="fn">${steps.map((x, i) => {
    const prev = steps[i - 1]?.value
    const conv = i && x.value != null && prev ? `${n0((x.value / prev) * 100)}%` : ''
    return `<div class="fr"><span class="fl">${esc(x.label)}${x.src ? ` <small>${esc(x.src)}</small>` : ''}</span><span class="ft"><i style="width:${x.value == null ? 0 : Math.max(4, (x.value / max) * 100)}%"></i><b>${x.value == null ? 'нет данных' : esc(n0(x.value))}</b></span><span class="fc">${conv ? `→ ${conv}` : ''}</span></div>`
  }).join('')}</div>`
}

// the CSS the tiles and charts above need, the same in both PDFs
export const CHART_CSS = `
.kpi { background: #fff; border: 1px solid ${C.line}; border-radius: 10px; padding: 8px 10px; }
.kl { font-size: 8.5pt; color: ${C.muted}; font-weight: 600; }
.kv { font-size: 19pt; font-weight: 800; color: ${C.ink}; line-height: 1.15; margin-top: 2px; white-space: nowrap; }
.ku { font-size: 9pt; font-weight: 600; color: ${C.muted}; }
.kc { font-size: 8.5pt; margin-top: 1px; }
.ks { font-size: 7.8pt; color: ${C.muted}; margin-top: 2px; }
.nd, .nodata { color: ${C.soft}; font-weight: 600; }
.nodata { font-size: 9pt; padding: 10px 0; }
.unit { font-size: 7.5pt; color: ${C.muted}; margin-top: 2px; }
.hb { display: flex; flex-direction: column; gap: 4px; }
.hr { display: grid; grid-template-columns: 46% 1fr auto; align-items: center; gap: 6px; font-size: 8.5pt; }
.hl { line-height: 1.15; overflow-wrap: anywhere; }
.ht { background: ${C.bg}; border-radius: 4px; height: 9px; overflow: hidden; }
.ht i { display: block; height: 100%; border-radius: 4px; }
.hv { font-weight: 700; min-width: 22px; text-align: right; white-space: nowrap; }
.hv small { color: ${C.muted}; font-weight: 500; }
.fn { display: flex; flex-direction: column; gap: 5px; }
.fr { display: grid; grid-template-columns: 42% 1fr 42px; align-items: center; gap: 6px; font-size: 8.5pt; }
.fl { line-height: 1.15; } .fl small { color: ${C.muted}; font-size: 7pt; display: block; }
.ft { position: relative; height: 16px; background: ${C.bg}; border-radius: 5px; overflow: hidden; }
.ft i { position: absolute; inset: 0 auto 0 0; background: #BFD8F7; border-left: 3px solid ${C.blue}; border-radius: 5px; }
.ft b { position: absolute; left: 8px; top: 1px; color: ${C.ink}; font-size: 8.5pt; }
.fc { color: ${C.muted}; font-size: 8pt; text-align: right; white-space: nowrap; }
`
