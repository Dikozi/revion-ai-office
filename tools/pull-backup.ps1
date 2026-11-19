# Weekly copy of the office data from the server to this PC: the server keeps its own copies only on itself.
# Runs from Task Scheduler («Копия данных офиса»); keeps the last 4 copies.
$dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Резервные копии офиса'
New-Item -ItemType Directory -Force $dest | Out-Null
$key = Join-Path $env:USERPROFILE '.ssh\office_ed25519'
$log = Join-Path $dest 'журнал.txt'
$name = (ssh -i $key -o BatchMode=yes -o ConnectTimeout=30 root@203.0.113.10 'ls -t /var/backups/ai-office/office-*.tgz | head -1') | Select-Object -First 1
if (-not $name) { Add-Content -Encoding UTF8 $log "$(Get-Date -Format 'dd.MM.yyyy HH:mm') сервер недоступен, копия не сделана"; exit 1 }
$file = Join-Path $dest (Split-Path $name -Leaf)
if (-not (Test-Path $file)) {
  scp -i $key -o BatchMode=yes -q "root@203.0.113.10:$name" $dest
  if (-not (Test-Path $file)) { Add-Content -Encoding UTF8 $log "$(Get-Date -Format 'dd.MM.yyyy HH:mm') не удалось скачать $name"; exit 1 }
}
Get-ChildItem $dest -Filter 'office-*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 4 | Remove-Item -Force
Add-Content -Encoding UTF8 $log "$(Get-Date -Format 'dd.MM.yyyy HH:mm') готово: $(Split-Path $name -Leaf), $([math]::Round((Get-Item $file).Length / 1MB)) МБ"
