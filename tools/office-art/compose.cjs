// node compose.cjs out.png id,pose,x,y ...  -> room with sprites placed by their feet anchor, shown at 2x
const { execFileSync } = require('child_process')
const path = require('path')
const FF = 'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
const O = 'C:/Users/owner/Documents/Проекты/Виртуальный офис/web/img/office'
const m = require(path.join(O, 'sprites.json'))
const [out, ...items] = process.argv.slice(2)
const args = ['-v', 'error', '-y', '-i', path.join(O, 'room.png')]
const f = []
let last = '[0]'
items.forEach((it, i) => {
  const [id, pose, x, y, flip] = it.split(',')
  const s = m[id][pose]
  args.push('-i', path.join(O, id, pose + '.png'))
  const src = flip ? `[${i + 1}]hflip[f${i}];` : ''
  const ax = flip ? s.w - s.ax : s.ax
  f.push(`${src}${last}${flip ? `[f${i}]` : `[${i + 1}]`}overlay=${x - ax}:${y - s.ay}[v${i}]`)
  last = `[v${i}]`
})
f.push(`${last}scale=1376:768:flags=neighbor[out]`)
args.push('-filter_complex', f.join(';'), '-map', '[out]', out)
execFileSync(FF, args, { stdio: 'inherit' })
