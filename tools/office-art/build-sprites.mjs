// Turns the generated 1024px character images into small sprites on the room's pixel grid.
// Usage: node build.mjs  (reads ./<prefix>_<pose>.png, writes into the office web/img/office)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const FF = 'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
const OUT = 'C:/Users/owner/Documents/Проекты/Виртуальный офис/web/img/office'
const STAND_H = Number(process.env.STAND_H || 64)

const PEOPLE = {
  manager: { prefix: 'd', poses: ['stand', 'walkA', 'walkB', 'standback', 'front', 'phone'] },
  smm: { prefix: 'm', poses: ['stand', 'walkA', 'walkB', 'standback', 'back', 'idle'] },
  montazh: { prefix: 't', poses: ['stand', 'walkA', 'walkB', 'standback', 'back', 'relax'] },
  marketing: { prefix: 'a', poses: ['stand', 'walkA', 'walkB', 'standback', 'back', 'idle'] },
  sales: { prefix: 'e', poses: ['stand', 'walkA', 'walkB', 'standback', 'back', 'idle'] },
}

function rgba(file) {
  const buf = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 * 1024 * 1024 })
  return buf
}

function bbox(buf, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (buf[(y * w + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  return { x0, y0, x1, y1 }
}

// The lowest opaque row's centre: where the feet (or chair wheels) touch the floor.
function footX(buf, w, b) {
  let sx = 0, n = 0
  for (let y = b.y1; y > b.y1 - 12; y--) for (let x = b.x0; x <= b.x1; x++) if (buf[(y * w + x) * 4 + 3] > 128) { sx += x; n++ }
  return n ? sx / n : (b.x0 + b.x1) / 2
}

const manifest = {}
for (const [id, cfg] of Object.entries(PEOPLE)) {
  const standFile = `${cfg.prefix}_stand.png`
  const sb = bbox(rgba(standFile), 1024, 1024)
  const f = STAND_H / (sb.y1 - sb.y0 + 1)
  manifest[id] = { scale: +f.toFixed(4) }
  fs.mkdirSync(path.join(OUT, id), { recursive: true })
  for (const pose of cfg.poses) {
    const file = `${cfg.prefix}_${pose}.png`
    if (!fs.existsSync(file)) { console.log('skip', id, pose); continue }
    const buf = rgba(file)
    const b = bbox(buf, 1024, 1024)
    const pad = 4
    const cx = Math.max(0, b.x0 - pad), cy = Math.max(0, b.y0 - pad)
    const cw = Math.min(1024, b.x1 + pad + 1) - cx, ch = Math.min(1024, b.y1 + 1) - cy
    const w = Math.max(1, Math.round(cw * f)), h = Math.max(1, Math.round(ch * f))
    const out = path.join(OUT, id, `${pose}.png`)
    execFileSync(FF, ['-v', 'error', '-y', '-i', file, '-vf',
      `crop=${cw}:${ch}:${cx}:${cy},scale=${w}:${h}:flags=area,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(alpha(X,Y),120),255,0)'`, out])
    // anchor: feet point inside the small sprite
    const ax = Math.round((footX(buf, 1024, b) - cx) * f)
    manifest[id][pose] = { w, h, ax, ay: h }
  }
}
fs.writeFileSync(path.join(OUT, 'sprites.json'), JSON.stringify(manifest, null, 1))
console.log(JSON.stringify(manifest))
