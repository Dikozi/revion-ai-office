// run: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFacts } from '../server/facts.js'

function workspace(base, post) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-'))
  fs.mkdirSync(path.join(ws, '_база'))
  fs.writeFileSync(path.join(ws, '_база', 'жк.md'), base)
  fs.writeFileSync(path.join(ws, 'пост.md'), post)
  return ws
}

test('numbers from the knowledge base pass, including 20,5 млн written out in full', () => {
  const ws = workspace('2-комнатная 61,9 м², цена 20,5 млн ₸, сдача в 2027 году, 12 этажей.', 'Квартира 61,9 м² за 20 500 000 ₸ — сдача в 2027 году, всего 12 этажей.')
  assert.deepEqual(checkFacts(ws, ['пост.md']), [])
})

test('an invented price, area and year are caught', () => {
  const ws = workspace('2-комнатная 61,9 м², цена 20,5 млн ₸, сдача в 2027 году.', 'Квартира 65 м² всего за 18 млн ₸, ключи уже в 2026!')
  const [r] = checkFacts(ws, ['пост.md'])
  assert.equal(r.file, 'пост.md')
  const text = r.issues.join('\n')
  assert.match(text, /65 м²/)
  assert.match(text, /18 млн/)
  assert.match(text, /2026/)
})

test('small counts must match together with their unit', () => {
  // «12» exists in the base, but as floors — «12 минут» is still a claim nobody gave
  const ws = workspace('Дом на 12 этажей.', 'До центра 12 минут, в доме 12 этажей.')
  const [r] = checkFacts(ws, ['пост.md'])
  assert.equal(r.issues.length, 1)
  assert.match(r.issues[0], /12 минут/)
})

test('only visible text of an HTML mockup is checked', () => {
  const ws = workspace('Цена 20,5 млн ₸.', '')
  fs.writeFileSync(path.join(ws, 'макет.html'), '<style>.a{width:340px}</style><!-- 99 млн ₸ draft --><div class="a">Цена 20,5 млн ₸</div>')
  assert.deepEqual(checkFacts(ws, ['макет.html']), [])
})
