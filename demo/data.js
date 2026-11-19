// Made-up data of an ordinary business for the REVION demo. Nothing here comes from any real company or client.
// The numbers tell one story, the same as in the promo video: «Лид-форма» brings cheap leads and no sales,
// Reels pays back ×23, every fourth client was never reached.

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(d)
const ago = (n) => ymd(new Date(Date.now() - n * 864e5))

const SIGNALS = [
  {
    key: 'demo-lead-form', level: 'critical', section: 'marketing', from: 'marketing',
    what: 'Реклама «Лид-форма»: 38 заявок и 0 продаж',
    why: 'За 4 недели на неё ушло 120 000 ₸. Заявки дешёвые — по 3 158 ₸, но ни одна не стала покупкой.',
    impact: { amount: 120000, text: '120 000 ₸ рекламы без единой продажи' },
    cause: { kind: 'link', text: '6 из 10 клиентов из формы не берут трубку: форма собирает случайных людей, которые нажали «отправить», не читая.' },
    action: { employee: 'marketing', title: 'Перевести бюджет лид-формы в Reels', expected: '+2–3 продажи в месяц при том же бюджете', days: 2 },
  },
  {
    key: 'demo-no-answer', level: 'attention', section: 'sales', from: 'sales',
    what: '27% клиентов так и не дозвонились',
    why: 'До 32 из 120 обратившихся менеджеры не дозвонились с первой попытки — и больше не перезванивали.',
    impact: { text: '≈32 клиента ушли без разговора' },
    cause: { kind: 'fact', text: 'Когда менеджер отвечает в первые 15 минут, продаж вдвое больше. Сейчас первый ответ обычно приходит через 47 минут.' },
    action: { employee: 'sales', title: 'Перезванивать в первые 15 минут, делать 3 попытки', expected: 'вернуть часть из 32 клиентов', days: 7 },
  },
  {
    key: 'demo-manager', level: 'attention', section: 'sales', from: 'sales',
    what: 'У менеджера Ольги продаж в 2,5 раза меньше',
    why: '40 обращений → 3 сделки (8%). У Айгерим — 45 → 9 (20%).',
    impact: { text: 'при конверсии Айгерим было бы ещё ≈5 сделок' },
    cause: { kind: 'probable', text: 'Вероятная причина: Ольга отвечает клиентам в среднем через 2 часа, а на «дорого» не предлагает рассрочку.' },
    action: { employee: 'sales', title: 'Разобрать 5 последних отказов Ольги и дать скрипт на «дорого»', expected: 'конверсия Ольги до 15%', days: 3 },
  },
  {
    key: 'demo-reels', level: 'opportunity', section: 'revenue', from: 'revenue',
    what: 'Reels окупается в 23 раза — можно усилить',
    why: '90 000 ₸ → 14 заявок → 3 продажи → 2,1 млн ₸.',
    impact: { text: 'каждый тенге в Reels вернул 23 ₸' },
    cause: { kind: 'fact', text: 'Клиенты из Reels покупают в 3 раза чаще остальных: 21% против 7%.' },
    action: { employee: 'marketing', title: 'Поднять бюджет Reels на 30% на 2 недели и сравнить', expected: '+1–2 продажи', days: 14 },
  },
  {
    key: 'demo-expensive', level: 'opportunity', section: 'sales', from: 'sales',
    what: '14 клиентов ушли из-за цены — предложить рассрочку',
    why: 'Каждый третий отказ — «дорого». Эти клиенты уже выбрали мебель и были на замере.',
    impact: { text: 'до 14 возможных сделок' },
    cause: { kind: 'fact', text: 'Причина отказа отмечена в CRM у каждого клиента.' },
    action: { employee: 'sales', title: 'Позвонить 14 клиентам с предложением рассрочки', expected: '2–3 сделки', days: 5 },
  },
]

const ROWS = [
  { id: 'd1', name: 'Лид-форма «Скидка на кухни»', campaign: 'Лиды · Facebook и Instagram', kind: 'form', spend: 30000, results: 11, chats: 0, deep: 0, leads: 11, cpq: null, cpl: 2727, ctr: 1.9, freq: 1.6, verdict: 'off', sales: 0, revenue: 0 },
  { id: 'd2', name: 'Reels «Кухня за 30 секунд»', campaign: 'Сообщения · Instagram', kind: 'chat', spend: 22500, results: 4, chats: 4, deep: 3, leads: 0, cpq: 7500, cpl: null, ctr: 2.4, freq: 1.3, verdict: 'scale', sales: 1, revenue: 530000 },
  { id: 'd3', name: 'Сторис «Диван недели»', campaign: 'Сообщения · Instagram', kind: 'chat', spend: 25000, results: 8, chats: 8, deep: 3, leads: 0, cpq: 8333, cpl: null, ctr: 1.5, freq: 2.1, verdict: 'keep', sales: 2, revenue: 560000 },
  { id: 'd4', name: 'Пост «Распродажа шкафов»', campaign: 'Сообщения · Facebook', kind: 'chat', spend: 22500, results: 7, chats: 7, deep: 3, leads: 0, cpq: 7500, cpl: null, ctr: 1.1, freq: 2.8, verdict: 'keep', sales: 2, revenue: 480000 },
]

const REPORT = `# Отчёт недели ${ago(10).slice(8, 10)}.${ago(10).slice(5, 7)}–${ago(4).slice(8, 10)}.${ago(4).slice(5, 7)}

**Потратили 100 000 ₸ на рекламу → получили 1,6 млн ₸.** Каждый тенге рекламы вернул 16 ₸.

## ✅ Что работает
- Reels «Кухня за 30 секунд»: 4 заявки → 1 продажа на 530 000 ₸.
- Айгерим отвечает клиентам за 18 минут — у неё лучшая конверсия: 20%.

## ⚠️ Где пробелы
- «Лид-форма»: 11 заявок и 0 продаж — 30 000 ₸ ушли впустую.
- 27% клиентов не дозвонились: менеджеры сделали одну попытку и забыли.
- Ольга отвечает через 2 часа — у неё 8% продаж против 20% у Айгерим.

## 🔧 Что улучшить
- Перевести бюджет «Лид-формы» в Reels.
- Перезванивать в первые 15 минут, до 3 попыток.
- Дать Ольге скрипт на возражение «дорого» с рассрочкой.

## 🎯 Главное на неделю
Перевести 30 000 ₸ из «Лид-формы» в Reels и перезвонить 14 клиентам, которые ушли из-за цены. Ожидаем +2–3 продажи.`

const SHORT = {
  marketing: '📣 **Реклама за неделю:** 100 000 ₸ → 30 обращений.\n\n- ✅ Reels: самая окупаемая реклама — ×23.\n- ⚠️ «Лид-форма»: 11 заявок, ни одной продажи.\n- 🔧 Совет: бюджет формы — в Reels.',
  sales: '🤝 **Продажи за неделю:** 30 обращений → 5 сделок.\n\n- ⚠️ 27% клиентов не дозвонились.\n- ⚠️ Ольга: конверсия 8%, ответ через 2 часа.\n- 🔧 Совет: ответ в первые 15 минут, скрипт на «дорого».',
  revenue: '💰 **Выручка за неделю:** 1,6 млн ₸, ожидается ещё 1,9 млн ₸ за 30 дней.\n\n- ✅ Каждый тенге рекламы вернул 16 ₸.\n- 🔧 14 клиентов ушли из-за цены — предложить рассрочку.',
}

export function demoData() {
  const now = new Date().toISOString()
  const days = []
  for (let i = 13; i >= 0; i--) {
    const k = [0.8, 1.1, 0.9, 1.2, 1, 0.7, 1.3][i % 7]
    const chats = Math.round(2.7 * k), deep = Math.round(1.3 * k), leads = Math.round(1.6 * k)
    days.push({ date: ago(i), spend: Math.round(14300 * k), results: chats + leads, chats, deep, leads, clicks: Math.round(60 * k), impressions: Math.round(5000 * k), spendChat: Math.round(10000 * k), spendForm: Math.round(4300 * k) })
  }
  const week = (cur) => ({ spend: cur ? 100000 : 95000, results: cur ? 30 : 33, chats: cur ? 19 : 20, deep: cur ? 9 : 8, leads: cur ? 11 : 13, cpr: cur ? 3333 : 2879, ctr: cur ? 1.6 : 1.5, cpq: cur ? 7778 : 8125, cpl: cur ? 2727 : 2308, live: cur ? 47 : 40, impressions: 35000, clicks: 560 })
  const reports = [
    { id: 'demo-r1', employee: 'manager', name: 'Диас', title: 'Отчёт недели: что работает, где пробелы, что улучшить', at: new Date(Date.now() - 2 * 864e5).toISOString(), type: 'director', area: 'Управление', result: REPORT, files: [], decision: null },
    ...Object.entries(SHORT).map(([employee, result], i) => ({ id: `demo-r${i + 2}`, employee, name: { marketing: 'Алия', sales: 'Ерлан', revenue: 'Нурлан' }[employee], title: { marketing: 'Реклама и Instagram за неделю', sales: 'Продажи за неделю', revenue: 'Выручка за неделю' }[employee], at: new Date(Date.now() - (2 * 864e5 + (i + 1) * 3600e3)).toISOString(), type: 'weekly', area: { marketing: 'Маркетинг', sales: 'Продажи', revenue: 'Выручка' }[employee], result, files: [], decision: null })),
  ]
  return {
    at: now,
    top: {
      period: 'за 4 недели к предыдущим 4',
      kpis: [
        { key: 'revenue', label: 'Выручка', value: 6200000, prev: 5540000, money: true, trend: [1300000, 1450000, 1250000, 1540000, 1380000, 1600000, 1520000, 1700000] },
        { key: 'sales', label: 'Продажи', value: 18, prev: 15, trend: [3, 4, 4, 4, 4, 5, 4, 5] },
        { key: 'leads', label: 'Обращения', value: 120, prev: 130, trend: [31, 34, 33, 32, 30, 31, 28, 31] },
        { key: 'spend', label: 'Расход', value: 400000, prev: 380000, unit: '₸', neutral: true, trend: [90000, 95000, 97000, 98000, 96000, 102000, 100000, 102000] },
      ],
      text: 'Выручка выросла на 12%, хотя обращений стало на 8% меньше: реклама приводит меньше людей, но они чаще покупают.',
    },
    signals: SIGNALS,
    plan: { weekPlan: null, items: [], problems: [], chances: [] },
    ads: {
      currency: '₸', days, cur: week(true), prev: week(false),
      month: { cur: { spend: 400000, results: 120 }, prev: { spend: 380000, results: 130 } },
      rows: ROWS, median: { chat: 7778, form: 2727 },
    },
    insta: {
      followers: 3420, cur: { reach: 18400, follows: 64, posts: 5, interactions: 910 }, prev: { reach: 16100, follows: 51, posts: 4, interactions: 780 }, follows: [],
      posts: [
        { date: ago(3), link: '#', caption: 'Кухня за 30 секунд: от замера до установки', type: 'Reels', image: null, likes: 212, comments: 18, reach: 6400, saved: 140, shares: 37 },
        { date: ago(5), link: '#', caption: 'Диван недели — со скидкой 15%', type: 'Фото', image: null, likes: 96, comments: 7, reach: 3100, saved: 41, shares: 9 },
        { date: ago(8), link: '#', caption: '5 ошибок при выборе шкафа-купе', type: 'Карусель', image: null, likes: 133, comments: 11, reach: 4200, saved: 88, shares: 21 },
        { date: ago(11), link: '#', caption: 'Как мы собираем мебель на заказ', type: 'Reels', image: null, likes: 175, comments: 14, reach: 5200, saved: 63, shares: 25 },
      ],
    },
    crm: {
      cur: {
        leads: 120,
        funnel: [
          { key: 'lead', label: 'Обращения', count: 120, conv: null },
          { key: 'contacted', label: 'Связались', count: 88, conv: 73 },
          { key: 'qualified', label: 'Качественные', count: 49, conv: 56 },
          { key: 'show_done', label: 'Замер / встреча', count: 30, conv: 61 },
          { key: 'sale', label: 'Сделка', count: 18, conv: 60 },
        ],
        refusals: [['Дорого', 14], ['Не дозвонились', 11], ['Выбрали конкурента', 7], ['Другое', 9]],
        replyMedianMin: 47,
        managers: [{ name: 'Айгерим', leads: 45, sales: 9, replyMin: 18 }, { name: 'Данияр', leads: 35, sales: 6, replyMin: 35 }, { name: 'Ольга', leads: 40, sales: 3, replyMin: 120 }],
        lead_quality: { good: 41, note: 'Качественный лид — клиент ответил и обсуждал покупку. Пустые чаще всего приходят из «Лид-формы».' },
        best: [
          { title: 'Клиенты из Reels покупают в 3 раза чаще', note: '21% против 7% по остальной рекламе' },
          { title: 'Ответили за 15 минут — продаж вдвое больше', note: 'конверсия 22% против 11%' },
          { title: 'Лучше всего покупают семьи 30–45 лет', note: '62% сделок за 4 недели' },
        ],
      },
      prev: { leads: 130, funnel: [{ count: 130 }, { count: 90 }, { count: 46 }, { count: 28 }, { count: 15 }] },
    },
    money: {
      received: 6200000, prev: 5540000, fromAds: 6200000, spend: 400000, sales: 18, salesFromAds: 18, expected30: 1900000,
      channels: [
        { name: 'Reels', spend: 90000, sales: 3, revenue: 2100000 },
        { name: 'Сторис', spend: 100000, sales: 8, revenue: 2200000 },
        { name: 'Посты', spend: 90000, sales: 7, revenue: 1900000 },
        { name: 'Лид-форма', spend: 120000, sales: 0, revenue: 0 },
      ],
    },
    reports,
    archive: demoArchive(),
  }
}

// the page «Отчёты»: 14 made-up months of a furniture salon (the current one still running) and 4 weekly reports
function demoArchive() {
  const now = new Date(Date.now() + 5 * 3600e3)
  const NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
  const sales = [9, 11, 10, 13, 12, 15, 14, 16, 15, 18, 17, 19, 21, 8]
  const months = sales.map((s, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13 + i, 1))
    const key = d.toISOString().slice(0, 7), last = i === 13
    return {
      key, label: `${NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`, partial: last, backfilled: i < 10, sales: s, money: s * 345000 + (i % 3) * 120000, extra: 0,
      leads: i < 4 ? null : Math.round(s * 6.5 + (i % 4) * 7), cpr: 3900 - i * 120 + (i % 3) * 90, currency: '₸', spendKzt: 300000 + i * 9000, followers: 2100 + i * 95, bookings: s + 4,
      complete: i < 4 ? ['CRM подключена позже — клиентов за этот месяц нет'] : last ? [`${NAMES[d.getUTCMonth()]} ещё идёт`] : [], revisions: i === 9 ? 1 : 0,
      report: last ? null : { taskId: `demo-m${i}`, files: ['отчёт-месяца.pdf', 'отчёт-месяца.xlsx'], phrase: '' },
    }
  })
  const weeks = [0, 1, 2, 3].map((k) => {
    const to = new Date(Date.now() - ((now.getUTCDay() + 6) % 7 + 1 + k * 7) * 864e5), from = new Date(to.getTime() - 6 * 864e5)
    return {
      monday: from.toISOString().slice(0, 10), from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), taskId: `demo-w${k}`, files: ['отчёт-недели.pdf'],
      phrase: ['Продаж больше, чем неделей раньше: Reels приводит покупателей, а лид-форма — нет.', 'Клиентов меньше, но они чаще покупают: сработала рассрочка.', 'Спокойная неделя: продажи на среднем уровне, реклама подешевела.', 'Слабая неделя: двое клиентов ушли к конкурентам из-за срока доставки.'][k],
      sales: [5, 4, 4, 3][k], money: [1750000, 1380000, 1420000, 1050000][k], leads: [31, 28, 30, 34][k], cpr: [3333, 3510, 3620, 3870][k], currency: '₸',
    }
  })
  return { months, weeks }
}

// Plan and SMM samples: not part of the public demo (its pages stay «главное»), only for checking
// the design of every page on the computer: node demo/server.js --all
export function previewExtra() {
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
  const task = (id, area, title, responsible, status, due, extra = {}) => ({ id, area, title, responsible, status, due: d(due), why: 'Из рекомендации на главной', source: 'сигнал «Критично»', expected: '', ...extra })
  return {
    plan: {
      weekPlan: { id: 'demo-wp', title: 'План недели', summary: 'Главное на неделю: перевести бюджет «Лид-формы» в Reels и вернуть клиентов, которые так и не дозвонились.', items: [
        { employee: 'marketing', title: 'Перевести бюджет «Лид-формы» в Reels', days: 2, why: '120 000 ₸ без единой продажи', expected: '+2–3 продажи в месяц' },
        { employee: 'sales', title: 'Перезвонить 32 клиентам без разговора', days: 3, why: '27% обращений потеряны на первом звонке', expected: '4–5 встреч' },
        { employee: 'smm', title: 'Три Reels про кухни под заказ', days: 4, why: 'Reels окупается в 23 раза', expected: 'больше живых разговоров' },
        { employee: 'revenue', title: 'Предложить рассрочку 14 клиентам', days: 5, why: 'ушли из-за цены', expected: 'до 14 сделок' },
      ] },
      goal: { sales: 5, bookings: 7, why: 'Темп последних 4 недель — 4,5 продажи в неделю, в работе 6 броней.' },
      fact: { sales: 2, bookings: 3, from: d(-3) },
      items: [
        task('p1', 'Маркетинг', 'Перевести бюджет «Лид-формы» в Reels', 'marketing', 'proposed', 2),
        task('p2', 'Продажи', 'Скрипт звонка для «не дозвонились»', 'sales', 'approved', 3),
        task('p3', 'SMM', 'Три Reels про кухни под заказ', 'smm', 'in_work', 4),
        task('p4', 'Продажи', 'Разбор звонков Ольги', 'sales', 'in_work', 2),
        task('p5', 'Выручка', 'Рассрочка для ушедших из-за цены', 'revenue', 'done', -1),
        task('p6', 'Маркетинг', 'Новая аудитория для сторис', 'marketing', 'measured', -9, { result: { verdict: 'worked', base: 9100, value: 7300, note: 'Живой разговор подешевел на 20%.' }, metric: 'цена живого разговора' }),
      ],
      problems: SIGNALS.filter((s) => s.level === 'critical' || s.level === 'attention'),
      chances: SIGNALS.filter((s) => s.level === 'opportunity'),
    },
    memory: [
      { at: d(-20), decidedAt: d(-20), area: 'Маркетинг', problem: 'Сторис дорожали третью неделю', hypothesis: 'Аудитория устала', decision: 'Новая аудитория 25–45, интересы «ремонт»', verdict: 'worked', result: 'живой разговор −20%' },
      { at: d(-34), decidedAt: d(-34), area: 'Продажи', problem: 'Клиенты не отвечали после замера', hypothesis: 'Долгий расчёт сметы', decision: 'Смета в день замера', verdict: 'flat' },
    ],
    smm: {
      goal: 2000, until: '31 декабря', now: 1240, pace: 38, need: 70, weeks: 11, postsPerWeek: 3, reelsPerWeek: '2',
      plan: { week: '20–26 окт.', status: 'accepted', items: [
        { date: d(4), day: 'пн', format: 'Пост', time: '10:00', topic: 'Кухня недели: до и после', by: 'Мадина' },
        { date: d(4), day: 'пн', format: 'Сторис', time: '18:00', topic: 'Опрос: какой фасад выбрали бы вы' },
        { date: d(5), day: 'вт', format: 'Рилс (маркетологи)', time: '19:00', topic: 'Сборка шкафа за 60 секунд' },
        { date: d(6), day: 'ср', format: 'Карусель', time: '11:00', topic: '5 ошибок при выборе дивана', by: 'Мадина' },
        { date: d(7), day: 'чт', format: 'Сторис', time: '13:00', topic: 'Отзыв клиента' },
        { date: d(8), day: 'пт', format: 'Пост', time: '10:00', topic: 'Скидка недели', by: 'Мадина' },
        { date: d(9), day: 'сб', format: 'Сторис', time: '12:00', topic: 'Шоурум в выходные' },
      ] },
      pack: { week: '20–26 окт.', status: 'waiting', proposal: 'demo-pack', items: [
        { date: d(0), time: '12:07', type: 'story', status: 'published', caption: 'Шоурум открыт в выходные', video: 'Close Up', result: 'охват 420, ответов 3, в профиль 5, вышли 18' },
        { date: d(4), time: '10:00', type: 'post', status: 'waiting', caption: 'Кухня недели' },
        { date: d(6), time: '11:00', type: 'carousel', status: 'waiting', caption: '5 ошибок при выборе дивана' },
        { date: d(5), time: '19:00', type: 'reel', manual: true, status: 'waiting', caption: 'Сборка шкафа' },
      ] },
      stats: { posts: 24, base: 3900, formats: [{ name: 'Reels', posts: 8, reach: 5600 }, { name: 'Карусели', posts: 6, reach: 4100 }, { name: 'Фото', posts: 10, reach: 2700 }], topics: [{ name: 'До и после', posts: 5, reach: 5200 }, { name: 'Скидки', posts: 7, reach: 3100 }], objects: [{ name: 'Кухни', posts: 9, reach: 4800 }, { name: 'Диваны', posts: 8, reach: 3400 }] },
    },
  }
}
