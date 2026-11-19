// Cuts 6-frame walk-cycle sheets into frames on the room's pixel grid and adds them to sprites.json.
// Frames are aligned by the torso centre and a common floor line, so the walk does not jitter.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const FF = 'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
const OUT = 'C:/Users/owner/Documents/Проекты/Виртуальный офис/web/img/office'
const STAND_H = 64
// sheets are <prefix>_w8_SE.png / _NW.png in the current folder; `node cut-walk-sheets.mjs revenue=n` cuts only one person
const ARGS = process.argv.slice(2).map((a) => a.split('='))
const SHEETS = ARGS.length ? Object.fromEntries(ARGS) : { manager: 'd', smm: 'm', montazh: 't', marketing: 'a', sales: 'e', revenue: 'n' }

function decode(file) {
  const [w, h] = execFileSync(FF.replace('ffmpeg.exe', 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)
  const buf = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  return { w, h, buf, a: (x, y) => buf[(y * w + x) * 4 + 3] > 128 }
}

function bands(counts, minGap, minLen) {
  const out = []
  let s = -1, gap = 0
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > 0
    if (on) { if (s < 0) s = i; gap = 0 } else if (s >= 0) { gap++; if (gap > minGap || i === counts.length) { out.push([s, i - gap]); s = -1; gap = 0 } }
  }
  return out.filter(([a, b]) => b - a > minLen)
}

function frames(img) {
  const rowCounts = []
  for (let y = 0; y < img.h; y++) { let n = 0; for (let x = 0; x < img.w; x++) if (img.a(x, y)) n++; rowCounts.push(n) }
  const all = []
  for (const [r0, r1] of bands(rowCounts, 8, 40)) all.push(...framesIn(img, r0, r1))
  return all
}

function framesIn(img, r0, r1) {
  const cols = []
  for (let x = 0; x < img.w; x++) { let n = 0; for (let y = r0; y <= r1; y++) if (img.a(x, y)) n++; cols.push(n) }
  const segs = []
  let s = -1, gap = 0
  for (let x = 0; x <= img.w; x++) {
    const on = x < img.w && cols[x] > 0
    if (on) { if (s < 0) s = x; gap = 0 } else if (s >= 0) { gap++; if (gap > 6 || x === img.w) { segs.push([s, x - gap]); s = -1; gap = 0 } }
  }
  return segs.filter(([a, b]) => b - a > 20).map(([x0, x1]) => {
    let y0 = img.h, y1 = 0
    for (let x = x0; x <= x1; x++) for (let y = r0; y <= r1; y++) if (img.a(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y }
    // torso centre: middle band of the figure, ignores swinging legs and arms
    let sx = 0, n = 0
    const t0 = Math.round(y0 + (y1 - y0) * 0.22), t1 = Math.round(y0 + (y1 - y0) * 0.45)
    for (let y = t0; y <= t1; y++) for (let x = x0; x <= x1; x++) if (img.a(x, y)) { sx += x; n++ }
    return { x0, x1, y0, y1, cx: sx / n }
  })
}

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'sprites.json'), 'utf8'))
for (const [id, prefix] of Object.entries(SHEETS)) {
  for (const dir of ['SE', 'NW']) {
    const kind = dir === 'SE' ? 'walkF' : 'walkB', file = `${prefix}_w8_${dir}.png`
    if (!fs.existsSync(file)) { console.log('missing', file); continue }
    const img = decode(file)
    const fr = frames(img)
    if (fr.length !== 8 && fr.length !== 4) console.log(`WARN ${file}: ${fr.length} frames`)
    // 4-frame sheets (contact, passing, contact, passing) are played twice to fill the 8 slots
    if (fr.length === 4) fr.push(...fr.map((q) => ({ ...q })))
    const heights = fr.map((f) => f.y1 - f.y0 + 1).sort((a, b) => a - b)
    const f = STAND_H / heights[Math.floor(heights.length / 2)]
    const tall = Math.max(...fr.map((q) => q.y1 - q.y0)) + 1
    const half = Math.max(...fr.map((q) => Math.max(q.cx - q.x0, q.x1 - q.cx))) + 2
    fr.forEach((q, i) => {
      const cx = Math.round(q.cx - half), cw = Math.round(half * 2), ch = tall, cy = q.y1 - tall + 1
      const w = Math.round(cw * f), h = Math.round(ch * f)
      const out = path.join(OUT, id, `${kind}${i}.png`)
      // only this frame's own columns, so a neighbouring frame never leaks in
      const fw = q.x1 - q.x0 + 1, left = q.x0 - cx
      execFileSync(FF, ['-v', 'error', '-y', '-i', file, '-vf',
        `format=rgba,pad=iw:ih+${ch}:0:${ch}:color=0x00000000,crop=${fw}:${ch}:${q.x0}:${cy + ch},pad=${cw}:${ch}:${left}:0:color=0x00000000,scale=${w}:${h}:flags=area,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(alpha(X,Y),120),255,0)'`, out])
      manifest[id][`${kind}${i}`] = { w, h, ax: Math.round(w / 2), ay: h }
    })
    console.log(id, kind, fr.length, 'frames, scale', f.toFixed(4))
  }
}
fs.writeFileSync(path.join(OUT, 'sprites.json'), JSON.stringify(manifest, null, 1))
