#!/bin/bash
# Runs every 3 minutes (ai-office-watchdog.timer). If the office is down two checks in a row,
# restarts it and tells the owner in Telegram; tells again when it is back.
STATE=/var/lib/ai-office-watchdog
CFG=/opt/office/app/data/config.json

alive() {
  systemctl is-active --quiet ai-office && [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:3777/)" != "000" ]
}

say() {
  /usr/bin/node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).telegram || {}
    if (c.token && c.ownerChatId) fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c.ownerChatId, text: process.argv[2] }) }).catch(() => {})
  ' "$CFG" "$1"
}

n=$(cat "$STATE" 2>/dev/null || echo 0)
if alive; then
  [ "$n" -ge 2 ] && say "✅ Офис снова работает."
  echo 0 > "$STATE"
else
  n=$((n + 1))
  echo "$n" > "$STATE"
  if [ "$n" -eq 2 ]; then
    systemctl restart ai-office
    say "⚠️ Офис не отвечает уже несколько минут — перезапускаю. Если в течение 10 минут не придёт «Офис снова работает», напишите Claude Code."
  fi
fi
