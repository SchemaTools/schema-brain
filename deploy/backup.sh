#!/usr/bin/env bash
# Резервная копия базы Schema Brain с чисткой старых копий.
# Запуск из любой папки: deploy/backup.sh — вручную или ночью по cron (deploy/README.md).
#
# Настройки — в deploy/.env:
#   BACKUP_DIR   папка копий вне репозитория (по умолчанию ~/schema-brain-backups)
#   BACKUP_KEEP  сколько последних копий хранить (по умолчанию 14)
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$repo/deploy/.env"
[ -f "$env_file" ] || { echo "Нет $env_file — сначала установка (deploy/README.md)" >&2; exit 1; }

setting() { grep -E "^$1=" "$env_file" | tail -1 | cut -d= -f2- || true; }
dir="$(setting BACKUP_DIR)"
dir="${dir:-$HOME/schema-brain-backups}"
keep="$(setting BACKUP_KEEP)"
keep="${keep:-14}"
case "$keep" in '' | *[!0-9]* | 0) echo "BACKUP_KEEP — целое число больше нуля" >&2; exit 1 ;; esac

compose() { docker compose -f "$repo/deploy/docker-compose.yml" --env-file "$env_file" "$@"; }

mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/schema-brain-$(date +%F-%H%M).dump"
tmp="$file.part"
trap 'rm -f "$tmp"' EXIT

compose exec -T db pg_dump -U schema_brain -Fc schema_brain > "$tmp"
# копия читается — значит, из неё можно восстановить базу
compose exec -T db pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$file"
chmod 600 "$file"
echo "$(date '+%F %T') копия: $file ($(du -h "$file" | cut -f1))"

# чистка: остаются только последние $keep копий
ls -1t "$dir"/schema-brain-*.dump | tail -n +"$((keep + 1))" | while read -r old; do
  rm -f "$old"
  echo "$(date '+%F %T') удалена старая копия: $old"
done
