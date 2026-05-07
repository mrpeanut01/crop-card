#!/bin/sh
# CropCard container entrypoint.
#
# 1. Litestream restores the latest replica from Azure Blob (no-op if a local
#    DB already exists or no replica yet).
# 2. Drizzle migrations apply (idempotent).
# 3. Litestream replicates continuously while running the SvelteKit Node app
#    as its child — so when the app exits, Litestream stops too, after a
#    final flush of pending WAL frames.
set -eu

DB_PATH="${DB_PATH:-/data/cropcard.db}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

# In dev / first-boot Azure runs there's no replica yet; restore is a no-op.
if [ -n "${AZURE_BLOB_CONTAINER:-}" ]; then
  echo "[entrypoint] litestream restore (if replica exists)"
  litestream restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DB_PATH" || true
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
