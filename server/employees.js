import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'

const ROSTER = [
  {
    id: 'manager',
    name: 'Диас',
    title: 'Руководитель',
    about: 'Принимает поручения, составляет план, после вашего «да» раздаёт задачи',
    look: { shirt: '#34466b', hair: '#2a1c14', skin: '#e8b98f', accessory: 'tie' },
    active: true,
    model: 'sonnet',
    effort: 'low',
    maxTurns: 3,
    maxBudgetUsd: 0.3,
    tools: '',
  },
  {
    id: 'smm',
    name: 'Мадина',
    title: 'SMM',
    about: 'Посты, сторис, контент-план, УТП и готовые картинки в стиле Altyn Qala',
    look: { shirt: '#c2566b', hair: '#6b3f22', skin: '#f0c7a0', accessory: 'phone' },
    active: true,
    model: 'sonnet',
    effort: 'medium',
    maxTurns: 30,
    maxBudgetUsd: 2,
    tools: 'Read,Write,Edit,Glob,Grep',
    render: true,
  },
  {
    id: 'montazh',
    name: 'Тимур',
    title: 'Монтажёр',
    about: 'Reels «Ход строительства» из ваших видео со стройки',
    look: { shirt: '#3f7d58', hair: '#17120f', skin: '#d9a57c', accessory: 'headphones' },
    active: true,
    model: 'sonnet',
    effort: 'low',
    maxTurns: 12,
    maxBudgetUsd: 0.8,
    // Picks moments from storyboards and writes монтаж.json; the office cuts the video itself.
    tools: 'Read,Write,Glob',
    montage: true,
  },
  {
    id: 'marketing',
    name: 'Алия',
    title: 'Маркетолог-аналитик',
    about: 'Разбор Instagram и рекламы Meta за неделю: лучшие креативы, рост, советы',
    look: { shirt: '#7a5aa8', hair: '#3a2a1e', skin: '#eec39c', accessory: 'chart' },
    active: true,
    model: 'sonnet',
    effort: 'medium',
    maxTurns: 20,
    maxBudgetUsd: 1.5,
    // The office pulls the numbers into _данные before the run; no web access or token here.
    tools: 'Read,Write,Glob',
    meta: true,
  },
  {
    id: 'sales',
    name: 'Ерлан',
    title: 'Аналитик продаж',
    about: 'Воронка по шахматке, брони и продажи, вопросы и возражения клиентов, ответы для менеджера',
    look: { shirt: '#c98a2e', hair: '#0f0c0a', skin: '#e2ae85', accessory: 'keys' },
    active: true,
    model: 'sonnet',
    effort: 'medium',
    maxTurns: 20,
    maxBudgetUsd: 1.5,
    // the office pulls the portal, ads and cleaned exports into _данные before the run
    tools: 'Read,Write,Glob',
    sales: true,
  },
  {
    id: 'revenue',
    name: 'Нурлан',
    title: 'Аналитик выручки',
    about: 'Реклама → деньги, темп продаж и прогноз, что продаётся плохо',
    look: { shirt: '#3a3f47', hair: '#0f0c0a', skin: '#e2ae85', accessory: 'chart' },
    active: true,
    model: 'sonnet',
    effort: 'medium',
    maxTurns: 15,
    maxBudgetUsd: 1,
    tools: 'Read,Write,Glob',
    sales: true,
  },
]

export function loadEmployees(cfg) {
  return ROSTER.map((base) => {
    const e = { ...base, ...(cfg.employees?.[base.id] || {}) }
    const promptFile = path.join(P.employees, `${e.id}.md`)
    e.systemPrompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8').trim() : ''
    return e
  })
}

export function publicEmployee(e) {
  const { systemPrompt, ...rest } = e
  return rest
}
