// The owner's fresh photos and renders go straight into the picture base: /фото <описание> in Telegram.
// Мадина does not open pictures to save tokens, so each one gets a line with its description and size
// in knowledge/ассеты-новые.md (that file reaches her _база; the pictures stay behind {{ASSETS}}).
import fs from 'node:fs'
import path from 'node:path'
import { P, isInside } from './paths.js'

const LIST = path.join(P.knowledge, 'ассеты-новые.md')
const IMAGE = /\.(jpe?g|png|webp)$/i

// width and height from the file header: PNG IHDR or the JPEG frame marker
function size(buf) {
  if (buf.slice(1, 4).toString() === 'PNG') return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

const folderOf = (text) => (/altyn qala/i.test(text) ? 'altyn-qala-2' : /qala/i.test(text) ? 'qala-4' : 'общее')
const slug = (text) => text.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-') || 'фото'

// files: paths relative to inbox. Returns what was added and what was skipped.
export function addAssets(files, description) {
  const day = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })
  const folder = folderOf(description)
  const added = [], skipped = []
  for (const rel of files) {
    const src = path.resolve(P.inbox, rel)
    if (!isInside(P.inbox, src) || !fs.existsSync(src)) continue
    if (!IMAGE.test(src)) { skipped.push(path.basename(src)); continue }
    const buf = fs.readFileSync(src)
    const [w, h] = size(buf) || []
    const dir = path.join(P.knowledge, 'ассеты', folder)
    fs.mkdirSync(dir, { recursive: true })
    let name = `${slug(description)}${path.extname(src).toLowerCase()}`
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${slug(description)}-${n}${path.extname(src).toLowerCase()}`
    fs.writeFileSync(path.join(dir, name), buf)
    const shape = w && h ? `${w}×${h}, ${h > w * 1.1 ? 'вертикальное' : w > h * 1.1 ? 'горизонтальное' : 'квадратное'}` : 'размер неизвестен'
    added.push({ file: `${folder}/${name}`, shape })
  }
  if (added.length) {
    const head = fs.existsSync(LIST) ? '' : '# Новые фото и рендеры от владельца\nДобавлены командой /фото в Telegram. Подключать так же: <img src="{{ASSETS}}/папка/файл">. Открывать глазами не нужно — описание ниже.\n\n'
    fs.appendFileSync(LIST, head + added.map((x) => `- {{ASSETS}}/${x.file} (${x.shape}; ${day}) — ${description}`).join('\n') + '\n', 'utf8')
  }
  return { added, skipped }
}
