// Draws SCREENS / WINDOWS / SPOTS from office.js onto room.png (3× zoom) for calibration.
const fs = require('fs')
const { execFileSync } = require('child_process')
const FF = 'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
const ROOT = 'C:/Users/owner/Documents/Проекты/Виртуальный офис/web'
const src = fs.readFileSync(ROOT + '/office.js', 'utf8')
const grab = (name) => eval('(' + src.match(new RegExp(`const ${name} = ([\\s\\S]*?\\n[}\\]])`))[1] + ')')
const SCREENS = {}, WINDOWS = grab('WINDOWS')
const W = 688, H = 384, Z = 3
const buf = execFileSync(FF, ['-v', 'error', '-i', ROOT + '/img/office/room.png', '-vf', `scale=${W * Z}:${H * Z}:flags=neighbor`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
const set = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W * Z || y >= H * Z) return; const i = (y * W * Z + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2] }
const line = (a, b, c) => { const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * Z; for (let i = 0; i <= n; i++) set((a[0] + (b[0] - a[0]) * i / n) * Z, (a[1] + (b[1] - a[1]) * i / n) * Z, c) }
for (const q of [...Object.values(SCREENS)]) q.forEach((p, i) => line(p, q[(i + 1) % q.length], [255, 0, 255]))
for (const q of WINDOWS) q.forEach((p, i) => line(p, q[(i + 1) % q.length], [0, 200, 255]))
// grid every 10 px
for (let x = 0; x < W; x += 10) for (let y = 0; y < H * Z; y += 2) set(x * Z, y, x % 50 ? [230, 120, 120] : [255, 0, 0])
for (let y = 0; y < H; y += 10) for (let x = 0; x < W * Z; x += 2) set(x, y * Z, y % 50 ? [230, 120, 120] : [255, 0, 0])
const out = process.argv[2]
const [cx, cy, cw, ch] = (process.argv[3] || `0,0,${W},${H}`).split(',').map(Number)
execFileSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W * Z}x${H * Z}`, '-i', '-', '-vf', `crop=${cw * Z}:${ch * Z}:${cx * Z}:${cy * Z}`, out], { input: buf })
