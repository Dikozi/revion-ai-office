// Cuts seated sheets (4 typing frames + 1 "looking back") into sprites: type0..type3 and look.
// Each frame is fitted onto the person's existing seated pose: scale and shift are searched so that
// the chair (lower half) overlaps the old one pixel for pixel — otherwise the room's chair peeks out.
// A sheet with 6–7 frames (7th: on the phone) and a pose name builds a new pose from scratch: frame 1 becomes <pose>, the rest
// are fitted onto it (used for Нурлан, who sits in the room's own chair, so his frames have no chair).
// Usage (in the folder with the sheets):
//   node cut-seat-sheets.mjs smm=smm_sheet.png manager=manager_sheet.png
//   node cut-seat-sheets.mjs revenue=revenue_front.png:front:56
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const FF = 'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
const OUT = 'C:/Users/owner/Documents/Проекты/Виртуальный офис/web/img/office'
const SEATED = { manager: 'front', smm: 'back', montazh: 'back', marketing: 'back', sales: 'back', revenue: 'back' }
const NAMES = ['type0', 'type1', 'type2', 'type3', 'look', 'phone']

function decode(file) {
  const [w, h] = execFileSync(FF.replace('ffmpeg.exe', 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)
  const data = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  return { w, h, data, a: (x, y) => data[(y * w + x) * 4 + 3] > 128 }
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function png(w, h, rgba) {
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb)); return Buffer.concat([len, tb, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// area-average downscale of a box of the sheet, alpha cut at 120 like the other sprites
function scaled(img, box, f) {
  const w = Math.max(1, Math.round(box.w * f)), h = Math.max(1, Math.round(box.h * f))
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx0 = box.x + x / f, sx1 = box.x + (x + 1) / f, sy0 = box.y + y / f, sy1 = box.y + (y + 1) / f
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      if (sx < box.x || sx >= box.x + box.w || sy < 0 || sy >= img.h) { n++; continue }
      const i = (sy * img.w + sx) * 4, al = img.data[i + 3]
      r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++
    }
    const o = (y * w + x) * 4
    if (a / n > 120) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = 255 }
  }
  return { w, h, data: out, a: (x, y) => out[(y * w + x) * 4 + 3] > 0 }
}

function frames(img) {
  const cols = []
  for (let x = 0; x < img.w; x++) { let n = 0; for (let y = 0; y < img.h; y++) if (img.a(x, y)) n++; cols.push(n) }
  const segs = []
  let s = -1, gap = 0
  for (let x = 0; x <= img.w; x++) {
    const on = x < img.w && cols[x] > 0
    if (on) { if (s < 0) s = x; gap = 0 } else if (s >= 0) { gap++; if (gap > 6 || x === img.w) { segs.push([s, x - gap]); s = -1; gap = 0 } }
  }
  return segs.filter(([a, b]) => b - a > 20).map(([x0, x1]) => {
    let y0 = img.h, y1 = 0
    for (let x = x0; x <= x1; x++) for (let y = 0; y < img.h; y++) if (img.a(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  })
}

// best scale and shift of a frame onto the target (overlap of the lower part, where the chair is)
function fit(img, box, target, f0, from = 0.5) {
  let best = null
  const r0 = Math.floor(target.h * from)
  for (let k = -4; k <= 4; k++) {
    const f = f0 * (1 + k * 0.02)
    const fr = scaled(img, box, f)
    const oy0 = target.h - fr.h, ox0 = Math.round((target.w - fr.w) / 2)
    for (let oy = oy0 - 4; oy <= oy0 + 4; oy++) for (let ox = ox0 - 6; ox <= ox0 + 6; ox++) {
      let both = 0, any = 0
      for (let y = r0; y < target.h; y++) for (let x = 0; x < target.w; x++) {
        const t = target.a(x, y), fx = x - ox, fy = y - oy
        const q = fx >= 0 && fy >= 0 && fx < fr.w && fy < fr.h && fr.a(fx, fy)
        if (t && q) both++
        if (t || q) any++
      }
      const iou = any ? both / any : 0
      if (!best || iou > best.iou) best = { iou, ox, oy, fr }
    }
  }
  return best
}

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'sprites.json'), 'utf8'))
const save = (id, name, fr, ax, ay) => {
  fs.writeFileSync(path.join(OUT, id, `${name}.png`), png(fr.w, fr.h, fr.data))
  manifest[id][name] = { w: fr.w, h: fr.h, ax, ay }
}

for (const arg of process.argv.slice(2)) {
  const [id, spec] = arg.split('=')
  const [file, newPose, height] = spec.split(':')
  const img = decode(file)
  const fr = frames(img)
  if (newPose?.startsWith('+')) {
    // one replacement frame (e.g. "+look"), fitted onto the person's seated pose
    const pose = SEATED[id], m = manifest[id][pose]
    const old = decode(path.join(OUT, id, `${pose}.png`))
    const box = fr.sort((a, b) => b.w * b.h - a.w * a.h)[0]
    const b = fit(img, box, old, m.h / box.h)
    save(id, newPose.slice(1), b.fr, m.ax - b.ox, m.ay - b.oy)
    console.log(id, newPose.slice(1), 'fit', b.iou.toFixed(2))
    continue
  }
  if (newPose) {
    // fresh pose: frame 1 is the pose itself, scaled to the given height, anchored at the feet centre
    if (fr.length !== 6 && fr.length !== 7) { console.log(`WARN ${file}: ${fr.length} frames, skipped`); continue }
    const base = scaled(img, fr[0], Number(height) / fr[0].h)
    save(id, newPose, base, Math.round(base.w / 2), base.h)
    const f0 = Number(height) / fr[0].h
    fr.slice(1).forEach((box, i) => {
      const b = fit(img, box, base, f0, 0.45)
      save(id, NAMES[i], b.fr, Math.round(base.w / 2) - b.ox, base.h - b.oy)
      console.log(id, NAMES[i], 'fit', b.iou.toFixed(2))
    })
    continue
  }
  if (fr.length !== 5) { console.log(`WARN ${file}: ${fr.length} frames, skipped`); continue }
  const pose = SEATED[id]
  const m = manifest[id][pose]
  const old = decode(path.join(OUT, id, `${pose}.png`))
  const hs = fr.slice(0, 4).map((q) => q.h).sort((a, b) => a - b)
  const f0 = m.h / hs[1]
  fr.forEach((box, i) => {
    const b = fit(img, box, old, f0)
    // the old pose's anchor, moved into this frame's coordinates
    save(id, NAMES[i], b.fr, m.ax - b.ox, m.ay - b.oy)
    console.log(id, NAMES[i], 'fit', b.iou.toFixed(2))
  })
}
fs.writeFileSync(path.join(OUT, 'sprites.json'), JSON.stringify(manifest, null, 1))
