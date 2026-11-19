const RESERVED = { '_база': 'базу знаний', '_материалы': 'материалы', '_от_коллег': 'работу коллег' }

function shortPath(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]/).filter(Boolean)
  const i = parts.findIndex((x) => x in RESERVED)
  if (i >= 0) return parts.slice(i).join('/')
  return parts.slice(-1)[0] || ''
}

const MCP_NAMES = [
  [/generate_image|image/i, 'Рисует картинку'],
  [/generate_video|video/i, 'Готовит видео'],
  [/upscale/i, 'Улучшает качество'],
  [/remove_background/i, 'Убирает фон'],
  [/sheet|spreadsheet/i, 'Смотрит таблицу'],
  [/instagram|insights/i, 'Смотрит статистику Instagram'],
]

export function describeTool(name, input = {}) {
  switch (name) {
    case 'Read': return { kind: 'read', text: `Читает ${shortPath(input.file_path)}` }
    case 'Write': return { kind: 'write', text: `Пишет ${shortPath(input.file_path)}` }
    case 'Edit':
    case 'MultiEdit': return { kind: 'write', text: `Правит ${shortPath(input.file_path)}` }
    case 'Glob': return { kind: 'search', text: 'Смотрит, какие есть файлы' }
    case 'Grep': return { kind: 'search', text: `Ищет «${String(input.pattern || '').slice(0, 40)}»` }
    case 'Bash': return { kind: 'run', text: String(input.description || 'Запускает программу').slice(0, 90) }
    case 'WebSearch': return { kind: 'web', text: `Ищет в интернете: ${String(input.query || '').slice(0, 60)}` }
    case 'WebFetch': return { kind: 'web', text: 'Открывает страницу в интернете' }
    case 'TodoWrite': return { kind: 'think', text: 'Составляет список дел' }
    case 'StructuredOutput': return { kind: 'write', text: 'Записывает план' }
    default: {
      if (name.startsWith('mcp__')) {
        const hit = MCP_NAMES.find(([re]) => re.test(name))
        if (hit) return { kind: 'tool', text: hit[1] }
      }
      return { kind: 'tool', text: `Инструмент: ${name.replace(/^mcp__/, '')}` }
    }
  }
}

export function summarizeText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > 140 ? t.slice(0, 137) + '…' : t
}
