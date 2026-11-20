// run: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLog, salesIn, soldDays, kzDay } from '../server/sales-rules.js'

const at = (day, hm = '10:00', s = '00') => `${day}T${hm}:${s}+05:00`

test('days are counted in the Astana timezone, not UTC', () => {
  // 23:30 in Astana is still 18:30 UTC of the same day, 00:30 Astana is the previous day in UTC
  assert.equal(kzDay('2026-11-10T00:30:00+05:00'), '2026-11-10')
  assert.equal(kzDay('2026-11-09T19:30:00Z'), '2026-11-10')
})

test('a sale cancelled in the same period is not a sale', () => {
  const log = readLog([
    { number: 5, from: 'Свободна', to: 'Бронь', changed_at: at('2026-11-02') },
    { number: 5, from: 'Бронь', to: 'Продана', changed_at: at('2026-11-05') },
    { number: 5, from: 'Продана', to: 'Свободна', changed_at: at('2026-11-08') },
    { number: 7, from: 'Бронь', to: 'Рассрочка', changed_at: at('2026-11-06') },
  ])
  const s = salesIn(log, '2026-11-01', '2026-11-30')
  assert.deepEqual(s.deals.map((c) => c.number), [7])
  assert.equal(s.cancels.length, 0)
})

test('a client moving to another flat within a minute is not a new sale', () => {
  const log = readLog([
    { number: 12, from: 'Бронь', to: 'Продана', changed_at: at('2026-10-20') },
    { number: 12, from: 'Продана', to: 'Свободна', changed_at: at('2026-11-12', '15:00') },
    { number: 30, from: 'Свободна', to: 'Продана', changed_at: at('2026-11-12', '15:00', '30') },
  ])
  const nov = salesIn(log, '2026-10-31', '2026-11-30')
  assert.equal(nov.deals.length, 0, 'the move is not a sale in November')
  assert.equal(nov.cancels.length, 0, 'and not a cancellation either')
  assert.equal(soldDays(log).get(30), '2026-10-20', 'the new flat keeps the original sale day')
})
