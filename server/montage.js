import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { renderHtml } from './render.js'

const IS_WIN = process.platform === 'win32'
export const VIDEO_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i

const W = 1080
const H = 1920
const FPS = 30
const BAND = 520 // title area at the top of the frame
const MAX_STEPS = 28 // sprite height = steps × BAND must stay under Chrome's 16384 px
const TYPE_RATE = 25 // characters per second, like Instagram's typewriter text

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'ffmpeg завершился с ошибкой'))
      else resolve(stdout)
    })
  })
}

export function findFfmpeg(configured) {
  const pair = (ffmpeg) => {
    const ffprobe = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/ffmpeg/i, 'ffprobe'))
    return fs.existsSync(ffmpeg) && fs.existsSync(ffprobe) ? { ffmpeg, ffprobe } : null
  }
  if (configured) return pair(configured)
  const candidates = []
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    candidates.push(...out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  } catch {}
  if (IS_WIN && process.env.LOCALAPPDATA) {
    const winget = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet')
    candidates.push(path.join(winget, 'Links', 'ffmpeg.exe'))
    try {
      for (const d of fs.readdirSync(path.join(winget, 'Packages'))) {
        if (!/ffmpeg/i.test(d)) continue
        for (const sub of fs.readdirSync(path.join(winget, 'Packages', d))) candidates.push(path.join(winget, 'Packages', d, sub, 'bin', 'ffmpeg.exe'))
      }
    } catch {}
  }
  for (const c of candidates) {
    const hit = pair(c)
    if (hit) return hit
  }
  return null
}

export async function probe(ff, file) {
  const out = await run(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=width,height:stream_side_data=rotation', '-of', 'json', file])
  const j = JSON.parse(out)
  const s = j.streams?.[0] || {}
  const rot = Math.abs(Number(s.side_data_list?.find((d) => d.rotation != null)?.rotation || 0))
  const [width, height] = rot === 90 || rot === 270 ? [s.height, s.width] : [s.width, s.height]
  return { duration: Number(j.format?.duration) || 0, width, height }
}

// One labelled contact sheet per video, so the editor can pick moments without watching it.
export async function storyboard(ff, video, outJpg) {
  const info = await probe(ff, video)
  if (!info.duration) throw new Error('не удалось прочитать видео')
  const step = Math.max(1, Math.ceil(info.duration / 36))
  const count = Math.max(1, Math.ceil(info.duration / step))
  const cols = 6
  const tileW = info.width >= info.height ? 300 : 180
  // Without an explicit font file drawtext crashes on Windows (no fontconfig). Running from the
  // fonts folder avoids escaping the drive colon inside the filter string.
  const fonts = IS_WIN ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts') : undefined
  const font = IS_WIN ? 'fontfile=arialbd.ttf:' : ''
  const label = `drawtext=${font}text='%{eif\\:t\\:d} с':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4`
  await run(ff.ffmpeg, ['-v', 'error', '-y', '-i', path.resolve(video), '-vf', `fps=1/${step},scale=${tileW}:-2,${label},tile=${cols}x${Math.ceil(count / cols)}`, '-frames:v', '1', '-q:v', '4', path.resolve(outJpg)], { cwd: fonts })
  return { ...info, step }
}

export function todayDate() {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date())
  return parts.replace(/\//g, '.')
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A tall transparent PNG: band i shows the title typed up to step i, the last band adds the date.
// ffmpeg then scrolls through the bands, which gives the typewriter effect with a single Chrome run.
function titleSprite(lines, date) {
  // Rows are typed one after another, the date last, as in the owner's sample.
  const rows = lines.map((text, i) => ({ text, cls: i ? 'sub' : 'main' }))
  if (date) rows.push({ text: date, cls: 'date' })
  const count = (s) => s.replace(/\s/g, '').length
  const total = rows.reduce((s, r) => s + count(r.text), 0)
  const per = Math.max(1, Math.ceil(total / MAX_STEPS))
  const steps = Math.ceil(total / per)

  // Untyped characters stay in the layout but invisible, so the block never shifts while typing.
  const rowHtml = (text, typed) => {
    let cut = 0
    for (let seen = 0; cut < text.length && seen < typed; cut++) if (!/\s/.test(text[cut])) seen++
    const shown = text.slice(0, cut)
    const done = cut >= text.length
    return `${shown ? `<span class="on${done ? ' end' : ''}">${esc(shown)}</span>` : ''}${done ? '' : `<span class="off${shown ? '' : ' start'}">${esc(text.slice(cut))}</span>`}`
  }

  const bands = []
  for (let i = 0; i < steps; i++) {
    let typed = Math.min(total, (i + 1) * per)
    const html = rows.map((r) => {
      const n = Math.min(typed, count(r.text))
      typed -= n
      return `<div class="row ${r.cls}">${rowHtml(r.text, n)}</div>`
    })
    bands.push(`<section style="top:${i * BAND}px"><div class="block">${html.join('')}</div></section>`)
  }

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="size" content="${W}x${steps * BAND}">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${steps * BAND}px; overflow:hidden; background:transparent; }
  body { font-family:'Unbounded',sans-serif; position:relative; }
  section { position:absolute; left:0; width:${W}px; height:${BAND}px; display:flex; justify-content:center; padding-top:200px; }
  .block { display:inline-flex; flex-direction:column; align-items:center; gap:10px; }
  .row { display:flex; white-space:pre; line-height:1; }
  .main, .sub { font-size:54px; letter-spacing:-.01em; }
  .sub { font-size:44px; }
  /* one solid thin plate per line, like Instagram's highlighted text */
  .main span, .sub span { padding:4px 0 8px; }
  .main .on, .sub .on { background:#E3242B; color:#fff; padding-left:10px; }
  .main .on.end, .sub .on.end, .main .off, .sub .off { padding-right:10px; }
  .off { visibility:hidden; }
  .off.start { padding-left:10px; }
  .date { align-self:flex-end; font-size:46px; color:#FFD60A; -webkit-text-stroke:3px #111; paint-order:stroke fill; letter-spacing:.02em; margin-top:6px; }
</style></head><body>${bands.join('')}</body></html>`
  return { html, steps, rate: TYPE_RATE / per }
}

export function readSpec(ws) {
  const file = path.join(ws, 'монтаж.json')
  if (!fs.existsSync(file)) throw new Error('Монтажёр не оставил файл монтаж.json — не из чего собрать ролик.')
  let spec
  try { spec = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { throw new Error(`Не удалось прочитать монтаж.json: ${e.message}`) }
  return spec
}

// Builds a vertical 1080×1920 reel without sound: clips back to back + typed title + date.
export async function assembleReel({ ff, browser, ws, spec, out }) {
  if (!browser) throw new Error('Не найден Chrome или Edge — не на чем нарисовать надписи.')
  const list = Array.isArray(spec.clips) ? spec.clips.slice(0, 6) : []
  if (!list.length) throw new Error('В монтаж.json нет ни одного куска видео.')

  const clips = []
  for (const c of list) {
    const file = path.resolve(ws, String(c.file || ''))
    const rel = path.relative(ws, file)
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file) || !VIDEO_RE.test(file)) {
      throw new Error(`Видео не найдено: ${c.file}`)
    }
    const { duration } = await probe(ff, file)
    const start = Math.max(0, Math.min(Number(c.start) || 0, Math.max(0, duration - 1)))
    const len = Math.max(1, Math.min(Number(c.duration) || 4, 15, duration - start))
    clips.push({ file, start, len })
  }
  const total = clips.reduce((s, c) => s + c.len, 0)

  const lines = (Array.isArray(spec.lines) && spec.lines.length ? spec.lines : ['Ход строительства']).map(String).filter(Boolean).slice(0, 3)
  const date = spec.date === '' ? '' : String(spec.date || todayDate())

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-reel-'))
  try {
    const sprite = titleSprite(lines, date)
    const spriteHtml = path.join(tmp, 'title.html')
    fs.writeFileSync(spriteHtml, sprite.html, 'utf8')
    const spritePng = await renderHtml(browser, spriteHtml, { transparent: true })

    const args = ['-v', 'error', '-y']
    for (const c of clips) args.push('-ss', c.start.toFixed(2), '-t', c.len.toFixed(2), '-i', c.file)
    args.push('-loop', '1', '-framerate', String(FPS), '-i', spritePng)
    // A silent sound track: without any audio Telegram and phones treat the mp4 as a GIF.
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
    const n = clips.length
    const filter = [
      ...clips.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[v${i}]`),
      `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[base]`,
      `[${n}:v]format=rgba,crop=${W}:${BAND}:0:'min(floor(t*${sprite.rate}),${sprite.steps - 1})*${BAND}'[txt]`,
      '[base][txt]overlay=0:0:shortest=1,format=yuv420p[out]',
    ].join(';')
    args.push('-filter_complex', filter, '-map', '[out]', '-map', `${n + 1}:a`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '64k', '-r', String(FPS), '-t', total.toFixed(2), '-movflags', '+faststart', out)
    await run(ff.ffmpeg, args, { timeout: 10 * 60 * 1000 })
    return { out, total, clips: clips.length }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
