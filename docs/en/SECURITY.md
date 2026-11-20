# Reliability and security

English summary of [`docs/надёжность-и-безопасность.md`](../надёжность-и-безопасность.md).

## Client data never reaches the model

- Every export (WhatsApp chats, CSV/XLSX lead tables, archives) is anonymised for **every** agent in `prepareWorkspace()` → `cleanExports()` ([`server/sales.js`](../../server/sales.js)). Output files get neutral names; the manager only sees "client export #N (names hidden)".
- Supported: Android, iPhone (with invisible direction marks) and ISO chat formats, declined forms of names, Kazakhstan mobile and landline numbers, international numbers. In tables the header is detected, personal columns are dropped and their values are also cut from every other column.
- **Fails closed:** an unrecognised chat format is not passed on at all. PDFs and images are not given to analysts.
- CRM refusal notes are scrubbed (phones, emails, IDs, links, any capitalised name) before the model sees them and are never written to disk — only the model's short paraphrase is stored.
- Retention (`server/cleanup.js`): client exports in the inbox are deleted after 7 days, task working copies after 30, event logs after 180.
- Tests: [`test/anonymize.test.js`](../../test/anonymize.test.js).

## Agents are sandboxed

- `--restricted` confines Read/Glob/Write to the task folder (verified: reading `../../data/…` is refused). Everything an agent needs is copied into its folder by the office.
- Tool whitelist per agent, no MCP servers (`--strict-mcp-config`), no session persistence, turn limit and budget cap per run.
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are removed from the agent's environment so runs go through the subscription.
- Rendered layouts get a CSP (`default-src 'none'`, images only `file:`/`data:`): a generated page cannot call out to the internet or run scripts. The layout checker runs only its own script via a one-time nonce.

## The office keeps running

- **Self-update** (`tools/auto-update.sh`, every 3 minutes): the new version is installed only if every server file passes a syntax check and no agent is working; if the office does not answer within 20 seconds after restart, it rolls back and never tries that version again.
- **Watchdog** (`tools/watchdog.sh`) and systemd `Restart=always`.
- **Shared concurrency limit** for every kind of model run; extra runs wait. Every run's pid is recorded; after a crash, orphaned runs are stopped (only processes with this office's flags — an unrelated process that reused the pid is never touched). A hung Chrome renderer is killed with its whole tree.
- **Subscription limit reached** → the task goes back to the queue, the queue waits until the 5-hour window resets, one ⏸ message in Telegram.
- **Telegram without network** → messages and files wait in an outbox and are sent after the next successful poll; the update offset is persisted so nothing is processed twice; `retry_after` is respected on 429.
- **State files** are written via tmp + rename with backups; a broken file is set aside and the backup is used. Weekly reports catch up on the first working day if Monday was missed.
- HTTP: malformed URLs return 400 instead of crashing, half-uploaded files are removed, reserved Windows file names are escaped.

## Infrastructure

- Ubuntu 24.04 on a 2 vCPU / 4 GB VPS; Caddy with Let's Encrypt in front of the portal only (the office port is not exposed).
- SSH by key only, passwords disabled, ufw (22/80/443), fail2ban, unattended security updates, daily backups kept for 14 days.
- The public demo is a separate process with no access to the office, its data or the bot; it serves only the portal files and made-up data.
