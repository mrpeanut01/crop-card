#!/bin/sh
# CropCard container entrypoint. Runbook: docs/ops/restore-runbook.md
#
# With a Litestream replica configured (AZURE_BLOB_CONTAINER set):
#   1. Handoff fence (HANDOFF_FENCE=1): ask the running writer, if any, to
#      stop taking writes and ship its last WAL frame, and wait (bounded) for
#      it to say so. Only then is the replica complete enough to restore.
#   2. Restore the latest replica. Fails closed: a storage or auth error
#      exits non-zero, so Container Apps retries this container while the
#      previous revision keeps serving, instead of booting an empty DB.
#   3. Refuse to serve a restore that does not add up (replica has data but
#      nothing came back, zero owners, failed quick_check).
#   4. Apply migrations, then run the app as Litestream's child, so Litestream
#      does a final sync after the app exits.
set -eu

DB_PATH="${DB_PATH:-/data/cropcard.db}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"
HANDOFF=./scripts/handoff.mjs

if [ -n "${AZURE_BLOB_CONTAINER:-}" ]; then
  HANDOFF_NONCE="$(cat /proc/sys/kernel/random/uuid)"
  export HANDOFF_NONCE

  if [ "${HANDOFF_FENCE:-}" = "1" ] && [ -f "$HANDOFF" ]; then
    node "$HANDOFF" acquire || {
      echo "[entrypoint] FATAL: could not reach the replica store to request the handoff; refusing to start"
      exit 1
    }
  fi

  # Never restore over a leftover local copy: it could be older than the
  # replica. Keep it aside for forensics.
  for f in "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; do
    if [ -e "$f" ]; then
      echo "[entrypoint] moving leftover $f aside"
      mv "$f" "$f.stale-$(date +%s)"
    fi
  done
  rm -rf "$(dirname "$DB_PATH")/.$(basename "$DB_PATH")-litestream"

  echo "[entrypoint] litestream restore (if replica exists)"
  if ! litestream restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DB_PATH"; then
    echo "[entrypoint] FATAL: litestream restore failed; refusing to start on an empty database"
    exit 1
  fi

  if [ -f "$HANDOFF" ]; then
    node "$HANDOFF" verify-restore || {
      echo "[entrypoint] FATAL: restore verification failed; refusing to start"
      exit 1
    }
  fi
else
  echo "[entrypoint] AZURE_BLOB_CONTAINER unset — skipping restore (dev mode)"
fi

echo "[entrypoint] running drizzle migrations"
node ./scripts/migrate.mjs || {
  echo "[entrypoint] migration failed; refusing to start"
  exit 1
}

if [ -n "${AZURE_BLOB_CONTAINER:-}" ]; then
  echo "[entrypoint] starting litestream replicate -> node build/index.js"
  exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "node build/index.js"
else
  echo "[entrypoint] starting node build/index.js (no replication)"
  exec node build/index.js
fi
