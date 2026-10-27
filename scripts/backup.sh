#!/bin/sh
# Daily Postgres dump into /backups, keeping the last 14 days. Runs inside the `backup` compose service.
set -u
KEEP_DAYS=14
while true; do
  FILE="/backups/remnant-$(date -u +%Y-%m-%d_%H%M).dump"
  if pg_dump -h postgres -U remnant -d remnant -Fc -f "$FILE.tmp"; then
    mv "$FILE.tmp" "$FILE"
    echo "backup ok: $FILE"
    find /backups -name 'remnant-*.dump' -mtime +$KEEP_DAYS -delete
  else
    rm -f "$FILE.tmp"
    echo "backup FAILED" >&2
  fi
  sleep 86400
done
