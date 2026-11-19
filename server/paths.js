import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const P = {
  data: path.join(ROOT, 'data'),
  events: path.join(ROOT, 'data', 'events'),
  work: path.join(ROOT, 'work'),
  inbox: path.join(ROOT, 'inbox'),
  knowledge: path.join(ROOT, 'knowledge'),
  assets: path.join(ROOT, 'knowledge', 'ассеты'),
  employees: path.join(ROOT, 'employees'),
  web: path.join(ROOT, 'web'),
}

export function isInside(parent, child) {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
