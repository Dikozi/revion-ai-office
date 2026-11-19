// run: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scrub, cleanExports } from '../server/anonymize.js'

test('scrub removes phones, emails and national IDs', () => {
  const out = scrub('Звоните +7 (701) 123-45-67 или 8 777 555 44 33, почта a.b@mail.kz, ИИН 900101300123')
  assert.doesNotMatch(out, /\d{3}.?\d{2}.?\d{2}\b/)
  assert.match(out, /\[телефон\].*\[телефон\].*\[почта\].*\[ИИН\]/)
})

test('WhatsApp export: senders become roles, names vanish everywhere, raw file is deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-'))
  const src = path.join(dir, 'in'), out = path.join(dir, 'out')
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'Чат с Ержаном.txt'), [
    '06.10.2026, 14:20 - Айгерим Менеджер: Здравствуйте! Ержан, вот планировки',
    '06.10.2026, 14:21 - Ержан Сапаров: Спасибо. Мой номер +7 701 123 45 67',
    '06.10.2026, 14:22 - Айгерим Менеджер: Ержану перезвоню завтра',
    '06.10.2026, 14:23 - Айгерим Менеджер: Цена 25 млн',
  ].join('\n'))
  const [r] = cleanExports(src, out)
  const text = fs.readFileSync(path.join(out, r.file), 'utf8')
  assert.equal(r.kind, 'переписка WhatsApp')
  assert.doesNotMatch(text, /Ержан|Айгерим|Сапаров|701/)
  assert.match(text, /Менеджер: .*\[имя\]/)
  assert.match(text, /Клиент: .*\[телефон\]/)
  assert.equal(fs.existsSync(path.join(src, 'Чат с Ержаном.txt')), false)
})

test('CSV export: personal columns dropped, names cut from other columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-'))
  const src = path.join(dir, 'in'), out = path.join(dir, 'out')
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'leads.csv'), 'ФИО;Телефон;Источник;Комментарий\nДанияр Ахметов;87015554433;Instagram;Данияр просил 2-комнатную\n')
  const [r] = cleanExports(src, out)
  const text = fs.readFileSync(path.join(out, r.file), 'utf8')
  assert.deepEqual(r.columnsRemoved, ['ФИО', 'Телефон'])
  assert.doesNotMatch(text, /Данияр|Ахметов|8701/)
  assert.match(text, /Instagram;\[имя\] просил/)
})
