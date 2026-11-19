// Finds monitor screens in room.png by flood-filling dark pixels from a seed point.
// Writes web/img/office/screens.json: { id: [[x, y, len], ...] } (horizontal pixel runs).
const fs = require('fs')
const { execFileSync } = require('child_process')
const FF = 'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
const ROOM = 'C:/Users/owner/Documents/Проекты/Виртуальный офис/web/img/office/room.png'
const W = 688, H = 384
const px = execFileSync(FF, ['-v', 'error', '-i', ROOM, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 })
const lum = (x, y) => { const i = (y * W + x) * 3; return 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2] }
const seeds = JSON.parse(process.argv[2])
const LIMIT = Number(process.argv[3] || 75)
const out = {}
for (const [id, [sx, sy]] of Object.entries(seeds)) {
  // start from the darkest pixel near the seed
  const base = lum(sx, sy)
  let best = [sx, sy], bl = 999
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const l = Math.abs(lum(sx + dx, sy + dy) - base); if (l < bl) { bl = l; best = [sx + dx, sy + dy] } }
  const seen = new Set([best.join()]), stack = [best], pts = []
  while (stack.length && pts.length < 3000) {
    const [x, y] = stack.pop()
    pts.push([x, y])
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = nx + ',' + ny
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(k)) continue
      seen.add(k)
      if (Math.abs(lum(nx, ny) - base) <= LIMIT) stack.push([nx, ny])
    }
  }
  // keep only pixels whose 4 neighbours are also in the region: drops the outline
  const inside = new Set(pts.map((p) => p.join()))
  const core = pts.filter(([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].every((q) => inside.has(q.join())))
  const rows = new Map()
  for (const [x, y] of core) { if (!rows.has(y)) rows.set(y, []); rows.get(y).push(x) }
  const runs = []
  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b)
    let s = xs[0], prev = xs[0]
    for (const x of xs.slice(1).concat([Infinity])) { if (x !== prev + 1) { runs.push([s, y, prev - s + 1]); s = x } prev = x }
  }
  const xs = core.map((p) => p[0]), ys = core.map((p) => p[1])
  console.log(id, 'pixels', pts.length, 'core', core.length, 'bbox', Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
  out[id] = runs
}
fs.writeFileSync('C:/Users/owner/Documents/Проекты/Виртуальный офис/web/img/office/screens.json', JSON.stringify(out))
