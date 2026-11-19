// Employees learn from the owner's corrections and from their own results.
// - A reply to a result in Telegram is saved as feedback; a cheap run then folds it into a short
//   list of rules for that employee (data/memory/<id>-уроки.md), used in every next task.
// - Analysts end their report with "## Что я понял" — those insights are kept too
//   (data/memory/<id>-выводы.md), and they get their previous report to check their own advice.
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.js'
import { buildArgs, childEnv, runClaude } from './claude.js'

const MAX_RULES = 15
const MAX_INSIGHTS = 12
const file = (id, kind) => path.join(P.data, 'memory', `${id}-${kind}`)
const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const list = (text) => text.split('\n').map((l) => l.replace(/^\s*[-•\d.)]+\s*/, '').trim()).filter(Boolean)

const SCHEMA = {
  type: 'object',
  properties: { rules: { type: 'array', items: { type: 'string' } } },
  required: ['rules'],
}

const SYSTEM = 'Ты ведёшь «уроки» сотрудника виртуального офиса отдела маркетинга застройщика Altyn Qala в Астане. ' +
  'Из правок владельца ты делаешь короткие правила на будущее: что владельцу нравится и что нет, как писать, оформлять, монтировать, анализировать. ' +
  'Правило — одна строка, по-русски, конкретно и в повелительном наклонении («Не используй слово „Успей“ в заголовках»). ' +
  'Сохраняй старые правила, если новая правка им не противоречит; противоречащие — замени новой версией; похожие — объедини. ' +
  `Не больше ${MAX_RULES} правил, самые важные — первыми. Если правка — просто вопрос или похвала без указаний, правил не добавляй. Ничего не выдумывай сверх правок.`

export class Learning {
  constructor({ bin, cfg, store, emp }) {
    Object.assign(this, { bin, cfg, store, emp })
    this.timers = new Map()
    this.chain = Promise.resolve()
  }

  rules(id) { return list(read(file(id, 'уроки.md'))) }
  insights(id) { return list(read(file(id, 'выводы.md'))) }

  // The owner answered a result with a comment: keep it and fold it into rules soon after.
  noteFeedback(task, text) {
    const id = task.employee
    fs.mkdirSync(path.join(P.data, 'memory'), { recursive: true })
    const rec = { at: new Date().toISOString(), task: task.title, result: String(task.result || '').slice(0, 600), feedback: String(text).slice(0, 1000) }
    fs.appendFileSync(file(id, 'правки.jsonl'), JSON.stringify(rec) + '\n', 'utf8')
    clearTimeout(this.timers.get(id))
    // a burst of corrections becomes one run
    const t = setTimeout(() => { this.chain = this.chain.then(() => this.consolidate(id)).catch((e) => console.error('Уроки:', e.message)) }, 60 * 1000)
    t.unref?.()
    this.timers.set(id, t)
  }

  async consolidate(id) {
    const e = this.emp(id)
    if (!e) return
    const raw = read(file(id, 'правки.jsonl')).trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const fresh = raw.filter((r) => !r.used)
    if (!fresh.length) return
    const input = [
      `Сотрудник: ${e.name || ''} — ${e.title}: ${e.about || ''}`,
      '', 'Текущие правила:', ...(this.rules(id).map((r) => `- ${r}`)), this.rules(id).length ? '' : '(пока нет)',
      '', 'Новые правки владельца:',
      ...fresh.map((r) => `- К работе «${r.task}» (итог сотрудника: ${r.result.replace(/\s+/g, ' ').slice(0, 300)}) владелец написал: «${r.feedback}»`),
      '', 'Верни обновлённый список правил.',
    ].join('\n')
    const ws = path.join(P.work, '_learning')
    fs.mkdirSync(ws, { recursive: true })
    const { promise } = runClaude({
      bin: this.bin,
      args: buildArgs({ model: 'haiku', effort: 'low', systemPrompt: SYSTEM, tools: '', maxTurns: 2, maxBudgetUsd: 0.1 }, { schema: SCHEMA }),
      cwd: ws, input, timeoutMs: 2 * 60 * 1000, env: childEnv(this.cfg.keepApiKey),
    })
    const res = await promise
    const rules = res.result?.structured_output?.rules
    if (!res.ok || !Array.isArray(rules)) return
    fs.writeFileSync(file(id, 'уроки.md'), rules.slice(0, MAX_RULES).map((r) => `- ${String(r).trim()}`).join('\n') + '\n', 'utf8')
    fs.writeFileSync(file(id, 'правки.jsonl'), raw.map((r) => JSON.stringify({ ...r, used: true })).join('\n') + '\n', 'utf8')
  }

  // "## Что я понял" from a finished report: durable insights about the company and what works.
  noteReport(id, ws) {
    const report = read(path.join(ws, 'отчёт.md'))
    const m = /##\s*Что я понял[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(report)
    if (!m) return
    const fresh = list(m[1]).slice(0, 5)
    if (!fresh.length) return
    const day = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })
    const kept = [...this.insights(id).filter((x) => !fresh.some((f) => x.endsWith(f))), ...fresh.map((f) => `${day}: ${f}`)].slice(-MAX_INSIGHTS)
    fs.mkdirSync(path.join(P.data, 'memory'), { recursive: true })
    fs.writeFileSync(file(id, 'выводы.md'), kept.map((x) => `- ${x}`).join('\n') + '\n', 'utf8')
  }

  // The employee's last report, to check whether past advice worked.
  previousReport(id, exceptTaskId) {
    const t = this.store.tasks.filter((x) => x.employee === id && x.status === 'done' && x.id !== exceptTaskId && fs.existsSync(path.join(P.work, x.id, 'отчёт.md'))).at(-1)
    return t ? { task: t, text: read(path.join(P.work, t.id, 'отчёт.md')) } : null
  }
}
