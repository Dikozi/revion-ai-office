// The portal's numbers as short lines for Диас's prompts (the week plan).
// The weekly and the monthly report moved to reports.js (19.11.2026): numbers by code, words by one run of Диас.
const money = (v) => (v == null ? '—' : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} млн ₸` : `${Math.round(v).toLocaleString('ru-RU')} ₸`)

// the numbers the portal shows, as short lines for the prompt
export function numbersBrief(d) {
  const out = []
  for (const k of d.kpi || []) if (k.value != null) out.push(`- ${k.label}: ${k.unit && k.unit !== '₸' ? `${k.value} ${k.unit}` : k.key === 'revenue' ? money(k.value) : k.value}${k.prev != null ? ` (было ${k.key === 'revenue' ? money(k.prev) : k.prev})` : ''}${k.note ? ` — ${k.note}` : ''}`)
  if (d.change) out.push(`- Выручка ${d.change.period}: ${money(d.change.prev)} → ${money(d.change.revenue)}; разложение: ${d.change.factors.map((f) => `${f.label} ${f.amount >= 0 ? '+' : ''}${money(f.amount)}`).join(', ')}`)
  // money outside the chessboard (another phase) is never part of revenue: only named apart
  const b = d.board
  if (b?.cash?.unavailable) out.push(`- Внимание: ${b.cash.unavailable} — выручка выше посчитана по ценам проданных квартир, а не по полученным деньгам (может быть завышена), не делай по ней выводов`)
  const extra = (b?.cash?.extra || []).filter((x) => !b.weeks?.[0] || x.date > b.weeks[0].from)
  if (extra.length) out.push(`- Вне шахматки (другая очередь; в выручку, сравнения и цели НЕ входит): ${extra.map((x) => `${money(x.amount)}${x.label ? ` — ${x.label}` : ''} (${x.date.split('-').reverse().join('.')})`).join('; ')}`)
  if (d.smm?.now != null) out.push(`- Подписчики: ${d.smm.now}, цель ${d.smm.goal} к ${d.smm.until}, нужно +${d.smm.need} в неделю, сейчас +${d.smm.pace}`)
  if (d.weekGoal) out.push(`- План прошлой/текущей недели: продаж ${d.weekGoal.sales}, броней ${d.weekGoal.bookings}${d.weekGoal.revenue ? `, выручка ${money(d.weekGoal.revenue)}` : ''}`)
  const losses = (d.losses || []).filter((x) => x.amount)
  if (losses.length) out.push('Где теряем деньги:', ...losses.map((x) => `- ${x.title}: ${x.currency ? `${Math.round(x.amount)} ${x.currency}` : money(x.amount)} — ${x.text}`))
  const sig = (d.signals || []).filter((s) => s.level !== 'positive').slice(0, 6)
  if (sig.length) out.push('Сигналы:', ...sig.map((s) => `- [${s.level}] ${s.what}${s.impact?.text ? ` (${s.impact.text})` : ''}`))
  const items = d.plan?.items || []
  const done = items.filter((x) => x.result)
  if (done.length) out.push('Результаты прошлых решений:', ...done.slice(0, 6).map((x) => `- «${x.title}»: ${x.metric} ${x.result.base ?? '—'} → ${x.result.value ?? '—'} — ${x.result.verdict}`))
  const open = items.filter((x) => ['proposed', 'approved', 'in_work'].includes(x.status))
  if (open.length) out.push('Задачи в работе и на решении:', ...open.slice(0, 8).map((x) => `- ${x.title} — ${x.status}, ${x.responsible}`))
  return out.join('\n')
}
