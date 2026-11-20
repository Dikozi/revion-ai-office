# What the office does

English summary of [`docs/возможности.md`](../возможности.md), the plain-language guide written for the business owner. Company names in this public copy are fictional (Altyn Qala Group).

## In two sentences

Six AI employees — short-lived Claude Code processes — run 24/7 on a small Ubuntu server, read the company's ads, sales chart, CRM and Instagram, and turn them into reports, decisions and finished content. The owner works with them through a Telegram bot and a web portal; nothing is published, sent or paid for without the owner's approval, except the weekly content package the owner explicitly approved.

The server updates itself from GitHub, waits until no agent is working, and rolls back if the new version does not start.

## The team

| Agent | What it does |
|---|---|
| **Manager** | Turns any request into a plan for approval. Monday: weekly report (code computes the numbers, the agent writes conclusions and 3 recommendations) and the weekly plan. 1st of the month: monthly report and 5 rules for the month that every agent gets with every task. Answers questions about past work. |
| **Marketing analyst** | Meta Ads and Instagram: what worked, what to switch off. Builds next week's content plan every Thursday from a sales brief. Every 3 hours checks ads itself (frequency, cost per conversation now vs. before, CTR) and writes a ready conclusion. Remembers every ad since 2023, measures lead quality by "live conversations" (3+ messages from the client), makes forecasts that the office later checks against reality. |
| **Sales analyst** | Sales chart, bookings, sales. Watches stuck and cancelled bookings, writes call scripts, reads anonymised chat exports. Once a day paraphrases CRM refusal notes in its own words — names are removed before the text reaches the model, the notes are never stored. |
| **Revenue analyst** | Money actually received, average deal, sales pace and sell-out forecast, sales below the base price. Proposes the weekly plan and monthly goals. |
| **SMM** | Posts, carousels and stories as finished images in the brand style, following the content plan. Learns from the results of its own posts (reach, saves, shares, follows measured 3 and 7 days after publishing) and from approved examples. |
| **Video editor** | Cuts vertical Reels from raw construction-site footage. |

Agents learn: a reply to a result in Telegram, or 👎 with a reason, becomes a rule that agent follows from then on.

## What happens on its own

| When | What |
|---|---|
| Every 3 hours, 8:00–22:00 | Watchdogs check ads and the sales chart (an ad spends without conversations, a conversation got more expensive, a booking was cancelled, no posts for too long) and send a "Do it / Skip" proposal. If Meta stops the ad account or rejects a running ad — one short message with the reason. |
| Every day, 9:00 | Morning line in Telegram: "✓ All calm" or up to three things to do today, plus the three key numbers. Computed by code, no model run. If a data source is down, it says so instead of "all calm". |
| Monday, 9:00 | Weekly report: a message with 4 numbers and arrows, the key sentence and 3 recommendations with buttons, plus a one-page PDF (charts for 8 weeks, funnel, where clients and buyers come from, top refusal reasons). Then the weekly plan: "Approve all / Edit / Reject". |
| 1st of the month | Monthly report: 4-page PDF + Excel — key numbers vs. last month and a typical month, goals plan/fact, pace to the building's handover date, charts across all months, who buys and from where, refusal reasons, next month's rules. |
| Every morning | Month history: a finished month is closed forever; later corrections are logged as "was → now", the month is never rewritten. |
| Thursday | Next week's content plan; SMM draws everything right away; the owner gets the "weekly package" to approve. |
| After approval | Posts and stories are rendered into 15-second motion videos with music and published through the official Instagram API at slightly different times each day. If a video fails, the approved image goes out instead. |
| 7 days after every task | The result is measured automatically: worked / didn't / not enough data — and written into the business memory. |
| Every hour | Instagram follower count (so a jump is visible the same day) and story statistics (Instagram deletes them after 24 hours). |
| Every night | Archive of ads, sales chart prices and stock, Instagram account history, CRM full sync, backup of all data. |
| When a source breaks | If the sales chart, Meta, Instagram or CRM does not answer for 3 hours — one message about what broke and what may be inaccurate, and one "✅ back" message. |

## Telegram bot

- Write any text — the manager returns a plan for approval.
- Photo or video with a caption — a task with materials; without a caption — saved and attached to the next task.
- Reply to a result — a correction for that piece of work, which the agent also remembers.
- 👍 / 👎 under a result — one-tap feedback; 👍 SMM images become style references.
- Commands for direct tasks to each agent, reports on demand, the "Then → Now" before/after report (PDF + Excel), photo library, status.

## Portal

Principle: **10 seconds** to see the state of the business, **1 minute** for what matters and what to do, **5 minutes** for full analytics. Every event opens one panel — **What happened → Why → What to do** — with a single **Approve** button that sends the task to the right agent. Where numbers do not prove a cause, the portal says so: "Fact", "Observed link" or "Probable cause".

| Page | On screen |
|---|---|
| Overview | One sentence about what matters, three coloured numbers (pace to handover, money this month, new clients), "Do today" — at most three tasks; a "Data:" line showing how fresh every source is |
| Plan | Weekly goal and progress, tasks by status, monthly goals with forecast, the decision history |
| Marketing | Spend, conversations, cost per conversation, the best and the problem ad, the chain "spend → lead → … → revenue", deep ad analytics (who actually talks, placements, video hook/hold) |
| Sales | Sales, bookings, the interactive sales chart of the building, CRM funnel, refusals, managers |
| Revenue | Money received (bookings, down payments, installments, full payments), what will come in 30 days, deals at risk, why revenue changed |
| SMM | Follower goal and pace, content plan, weekly package with the reasoning behind each post |
| Live office | The pixel-art office: agents walk to their desks and work in real time |
| Reports | All months and weeks with PDF/Excel, the journal of every report and the chain "recommendation → decision → result" |

Roles: owner (everything), leadership (sees everything, changes nothing), sales manager (sales only). Login through the Telegram bot, no passwords; invites are one-time links.

## How numbers are kept honest

- One rule for sales everywhere: net of cancellations; the sale date is the first day a flat became sold; a client moving to another flat is not a new sale; days are counted in the local timezone.
- Revenue is only money actually received. Money outside the sales chart is shown separately and never mixed into comparisons.
- Cost per conversation counts only ads that aim for conversations; reach/profile ads are shown separately. All ad numbers use complete days.
- "Unknown" instead of a fake 0 when a source is silent.
- Test and spam leads (including attack probes against the website form) are filtered out.

## Memory and learning

- **Business memory** — every decision forever: problem → hypothesis → decision → who approved → what was done → result.
- **Learning from corrections** — replies and 👎 become per-agent rules.
- **Fact check** — every number in SMM texts and images (price, area, dates, floors, percent) must exist in the knowledge base or the materials; an invented one is fixed in the same automatic correction pass as layout problems.
- **Layout check** — every SMM image is checked in Chrome for overlapping text, blocks covering each other, text off the edge or under Instagram's UI; one automatic fix if needed.
- **Archives** — all ads since 2023, the full sales-chart history, Instagram history Meta would otherwise delete.

## Security and client data

- Client names and phones are removed from exports before any agent sees them; an unknown format is not passed on at all.
- Agents cannot read keys, tokens or anything outside their own task folder.
- Portal only via Telegram login; server only via SSH key; daily backups, automatic security updates, brute-force protection.

More detail: [SECURITY.md](SECURITY.md).

## Not there yet

- Reading WhatsApp automatically — needs Meta business verification.
- Linking a CRM deal to a flat in the sales chart — waiting for the CRM to export the flat number.
- Call analytics.
