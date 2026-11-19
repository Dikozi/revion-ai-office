import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, execFileSync } from 'node:child_process'
import { P } from './paths.js'

const IS_WIN = process.platform === 'win32'

function npmEntry(dir) {
  const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code')
  for (const f of ['cli.js', 'cli.mjs']) {
    const p = path.join(pkg, f)
    if (fs.existsSync(p)) return { cmd: process.execPath, prefix: [p], label: p }
  }
  const exe = path.join(pkg, 'bin', 'claude.exe')
  if (fs.existsSync(exe)) return { cmd: exe, prefix: [], label: exe }
  return null
}

// On Windows a .cmd shim can't be spawned without a shell, and a shell would
// mangle the multi-line system prompt, so resolve to a real .exe or to node + cli.js.
export function resolveClaude(configured) {
  if (configured) {
    if (/\.cmd$/i.test(configured)) {
      const hit = npmEntry(path.dirname(configured))
      if (hit) return hit
    }
    return { cmd: configured, prefix: [], label: configured }
  }
  if (!IS_WIN) return { cmd: 'claude', prefix: [], label: 'claude' }

  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
  ]
  try {
    const out = execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    candidates.push(...out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  } catch {}
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'))

  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue
    if (/\.exe$/i.test(c)) return { cmd: c, prefix: [], label: c }
    if (/\.cmd$/i.test(c)) {
      const hit = npmEntry(path.dirname(c))
      if (hit) return hit
    }
  }
  return null
}

export function buildArgs(emp, { schema } = {}) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', emp.model,
    '--effort', emp.effort,
    '--system-prompt', emp.systemPrompt,
    '--tools', emp.tools || '',
    '--strict-mcp-config',
    '--restricted',
    '--no-session-persistence',
    '--max-turns', String(emp.maxTurns),
    '--max-budget-usd', String(emp.maxBudgetUsd),
  ]
  if (emp.tools) args.push('--permission-mode', 'acceptEdits')
  if (schema) args.push('--json-schema', JSON.stringify(schema))
  return args
}

export function childEnv(keepApiKey) {
  const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
  // Otherwise a stray API key would silently bill employees to the API instead of the Max plan.
  if (!keepApiKey) {
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
  }
  return env
}

// All Claude runs (tasks, manager, initiative, learning) share one limit, so the PC and the
// subscription are never hit by more parallel runs than set. Runs over the limit wait their turn.
let LIMIT = 3
let active = 0
const waiting = []
export function setClaudeLimit(n) { LIMIT = Math.max(1, n | 0) }
const nextSlot = () => { while (active < LIMIT && waiting.length) { active++; waiting.shift()() } }

// pids of running Claude processes, so the ones left behind by a crash can be stopped at the next start
const PIDS = path.join(P.data, 'pids.json')
const pids = new Set()
const savePids = () => { try { fs.mkdirSync(P.data, { recursive: true }); fs.writeFileSync(PIDS, JSON.stringify([...pids])) } catch {} }

export function reapOrphans() {
  if (!IS_WIN) return 0
  let list = []
  try { list = JSON.parse(fs.readFileSync(PIDS, 'utf8')) } catch { return 0 }
  let n = 0
  for (const pid of list) {
    // a pid may be reused by an unrelated program: only our own runs carry this flag
    let cmd = ''
    try { cmd = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`], { windowsHide: true, timeout: 15000 }).toString() } catch {}
    if (cmd.includes('--no-session-persistence')) {
      try { execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); n++ } catch {}
    }
  }
  try { fs.rmSync(PIDS, { force: true }) } catch {}
  return n
}

export function runClaude({ bin, args, cwd, input, timeoutMs, env, onEvent }) {
  if (!bin) {
    return { promise: Promise.resolve({ ok: false, error: 'Claude Code не найден. Установите его по инструкции из README, войдите в аккаунт командой claude и перезапустите офис.' }), kill() {} }
  }
  let child = null
  let stopped = false
  let release = () => {}
  const started = new Promise((resolve) => { waiting.push(resolve); nextSlot() })

  const kill = () => {
    stopped = true
    if (!child) return
    try {
      if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).on('error', () => {})
      else child.kill('SIGTERM')
    } catch {}
  }

  const promise = started.then(() => new Promise((resolve) => {
    let freed = false
    release = () => { if (freed) return; freed = true; active--; if (child?.pid) { pids.delete(child.pid); savePids() } nextSlot() }
    if (stopped) { release(); return resolve({ ok: false, stopped: true, error: 'Задача отменена.' }) }
    let result = null
    let stderr = ''
    let timedOut = false
    try {
      child = spawn(bin.cmd, [...bin.prefix, ...args], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      release()
      return resolve({ ok: false, error: `Не удалось запустить Claude Code: ${err.message}` })
    }
    if (child.pid) { pids.add(child.pid); savePids() }
    const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      line = line.trim()
      if (!line.startsWith('{')) return
      let e
      try { e = JSON.parse(line) } catch { return }
      if (e.type === 'result') result = e
      try { onEvent?.(e) } catch (err) { console.error('Ошибка разбора события:', err) }
    })
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000) })
    child.stdin.on('error', () => {})
    child.stdin.end(input, 'utf8')

    child.on('error', (err) => {
      clearTimeout(timer)
      release()
      resolve({ ok: false, error: `Не удалось запустить Claude Code: ${err.message}`, result, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      release()
      const ok = code === 0 && !!result && !result.is_error
      resolve({ ok, code, result, stderr, timedOut, stopped, error: ok ? null : explainFailure({ code, result, stderr, timedOut, stopped }) })
    })
  }))

  return { promise, kill }
}

function explainFailure({ code, result, stderr, timedOut, stopped }) {
  if (timedOut) return 'Задача заняла слишком много времени и была остановлена.'
  if (stopped) return 'Задача отменена.'
  const sub = result?.subtype || ''
  if (sub === 'error_max_turns') return 'Сотрудник упёрся в лимит шагов. Задачу стоит упростить или разбить.'
  if (/budget/i.test(sub)) return 'Сотрудник упёрся в лимит бюджета на задачу.'
  if (/rate.?limit|usage limit|limit reached/i.test(stderr + (result?.result || ''))) {
    return 'Закончился лимит подписки Claude. Задача подождёт — повторите позже.'
  }
  if (/log ?in|auth|credential|unauthorized/i.test(stderr)) {
    return 'Claude Code не авторизован. Откройте терминал, выполните claude и войдите в аккаунт.'
  }
  const tail = (result?.result || stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 300)
  return `Claude Code завершился с ошибкой (код ${code}). ${tail}`.trim()
}
