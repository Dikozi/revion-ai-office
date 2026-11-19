#!/bin/bash
# Server auto-update: pull the branch from GitHub, check it, wait until the office is idle, restart.
# Wrapped in main() so bash reads it whole: the reset below rewrites this very file.
# Runs as root from ai-office-update.timer; git runs as the office user.
set -u
main() {
DIR=/opt/office/app
BRANCH=claude/project-overview-kibk75
SVC=ai-office
CG=/sys/fs/cgroup/system.slice/$SVC.service/cgroup.procs
G() { HOME=/opt/office setpriv --reuid=office --regid=office --init-groups git -C "$DIR" "$@"; }

exec 9>/run/ai-office-update.lock
flock -n 9 || exit 0

G fetch -q origin "$BRANCH" || { echo "fetch failed"; exit 1; }
OLD=$(G rev-parse HEAD)
NEW=$(G rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0
BAD=/var/lib/ai-office-update.bad
[ "$(cat "$BAD" 2>/dev/null)" = "$NEW" ] && exit 0

# Syntax check of the new version before touching the live folder.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
G archive "$NEW" server tools | tar -x -C "$TMP"
for f in "$TMP"/server/*.js "$TMP"/tools/*.mjs; do
  [ -f "$f" ] || continue
  node --check "$f" 2>"$TMP/err" || { echo "skip ${NEW:0:7}: syntax error in ${f#$TMP/}"; cat "$TMP/err"; echo "$NEW" > "$BAD"; exit 1; }
done

# Idle = only the main node process in the service (no claude, ffmpeg or chrome children).
busy() { [ "$(wc -l < "$CG")" -gt 1 ]; }
if busy; then echo "new version ${NEW:0:7} waits: employees are working"; exit 0; fi

echo "update ${OLD:0:7} -> ${NEW:0:7}: $(G log -1 --format=%s "$NEW")"
G reset -q --hard "$NEW"
systemctl restart "$SVC"
sleep 20
if systemctl is-active -q "$SVC" && curl -sf -o /dev/null http://127.0.0.1:3777/api/state; then
  echo "ok ${NEW:0:7}"
  # the public demo shows the same portal pages
  systemctl try-restart revion-demo 2>/dev/null || true
  exit 0
fi

echo "new version did not start, rolling back to ${OLD:0:7}"
echo "$NEW" > "$BAD"
G reset -q --hard "$OLD"
systemctl restart "$SVC"
exit 1
}
main "$@"
exit $?
