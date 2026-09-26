# Database restore runbook

CropCard's database is one SQLite file on the container's ephemeral disk. The
only durable copy is the Litestream replica in Azure Blob Storage:

| What                  | Where                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| Storage account       | `cropcarddevstg` (resource group `cropcard-dev-rg`), Standard GRS, Hot tier |
| Container             | `cropcard`                                                                  |
| Replica               | `cropcard.db/generations/<generation>/{snapshots,wal}/…`                    |
| Handoff records       | `_ops/handoff/request.json`, `_ops/handoff/holder.json`                     |
| "Has had data" marker | `_ops/initialized.json`                                                     |

Protection: blob versioning, 14-day blob soft delete, 14-day container soft
delete, previous versions kept 30 days (lifecycle policy), and Litestream's
own 7-day retention with an hourly snapshot. Point-in-time restore therefore
reaches back 7 days through Litestream, and a deleted or overwritten blob is
recoverable for 14 to 30 days through Azure.

## How a container boots

`infra/entrypoint.sh`, in order:

1. **Handoff fence** (`node scripts/handoff.mjs acquire`). Writes
   `request.json` with a fresh nonce, then reads `holder.json`:
   - no holder, or `state: "released"`: go on;
   - holder heartbeat older than 60 s (the old container crashed): go on and
     log `previous writer … is stale`;
   - otherwise wait. The running app polls `request.json` every 2 s. When it
     sees another container's nonce it returns 503 + `Retry-After: 10` to every
     write (non-GET `/api/**`, form actions, plain POSTs), waits up to 10 s for
     admitted writes to finish, sets its connection to `query_only`, waits
     until Litestream's replica position (metrics on `127.0.0.1:9090`) equals
     the local shadow WAL position after two more syncs, and writes
     `holder.json` with `state: "released"`, the final position and
     `verified: true|false`.
   - After 75 s without a release it logs `HANDOFF_TIMEOUT` (alerted) and goes
     on anyway.
2. **Restore**, failing closed. Any `litestream restore` error exits 1, so
   Container Apps retries the container while the old revision keeps serving.
3. **Restore check** (`node scripts/handoff.mjs verify-restore`). Refuses to
   serve (exit 3, log `RESTORE_REFUSED`, alerted) when the replica lists
   generations or `_ops/initialized.json` exists but nothing was restored,
   or the restored database fails `quick_check`, has no applied migrations or
   has zero owners. An empty database is only allowed for a replica that has
   never held data. Writes `_ops/initialized.json` after the first good
   restore.
4. Migrations, then `litestream replicate -exec "node build/index.js"`. The
   app claims `holder.json` and heartbeats it every 20 s.

On scale-to-zero (SIGTERM) the app runs the same release before exiting, so
the next cold start finds `state: "released"` and does not wait. The
container has a 60 s termination grace period for this.

## Everyday checks

```sh
# Last boot / handoff lines
az containerapp logs show -g cropcard-dev-rg -n cropcard-dev-app --tail 200 --type console \
  | grep -E '\[handoff\]|\[entrypoint\]|generation'

# Readiness (runs SELECT 1; also reports the handoff phase)
curl -s https://<app-host>/api/health/ready

# Handoff records
az storage blob download --account-name cropcarddevstg -c cropcard \
  -n _ops/handoff/holder.json -f /dev/stdout --auth-mode key 2>/dev/null
```

A clean deploy shows, in the new revision:
`requested handoff` → `waiting for <old revision>` → `previous writer <old> released (position …, verified=true)` → `restore check ok` → `writer lease held by <new>`;
and in the old revision: `fencing writes: handoff requested by <new>` →
`released at {…} (replica verified)`.

## List generations and snapshots

Run inside the running container (it has `litestream` and the storage
settings):

```sh
az containerapp exec -g cropcard-dev-rg -n cropcard-dev-app --command sh
litestream generations -config /etc/litestream.yml /data/cropcard.db
litestream snapshots   -config /etc/litestream.yml /data/cropcard.db
litestream wal         -config /etc/litestream.yml /data/cropcard.db
```

Or from a workstation with the Litestream 0.3.13 binary:

```sh
export AZURE_STORAGE_ACCOUNT=cropcarddevstg AZURE_BLOB_CONTAINER=cropcard
export AZURE_STORAGE_KEY="$(az storage account keys list -g cropcard-dev-rg \
  --account-name cropcarddevstg --query '[0].value' -o tsv)"
litestream generations -config infra/litestream.yml /data/cropcard.db
```

`generations` lists every generation with its start and end time. Every boot
starts a new generation. `litestream restore` without `-generation` picks the
one updated most recently.

## Restore to a point in time

Restore a copy first and look at it. Production is only changed in step 4.

1. **Restore a copy.**

   ```sh
   litestream restore -config infra/litestream.yml \
     -timestamp 2026-09-26T14:00:00Z -o /tmp/pitr.db /data/cropcard.db
   ```

   Add `-generation <id>` to pin a generation. `-timestamp` must fall inside
   that generation's range.

2. **Verify it.**

   ```sh
   sqlite3 /tmp/pitr.db 'PRAGMA quick_check;'
   sqlite3 /tmp/pitr.db 'SELECT COUNT(*) FROM owners; SELECT COUNT(*) FROM users;'
   sqlite3 /tmp/pitr.db 'SELECT MAX(created_at) FROM spray_events;'
   ```

3. **Stop the writer.** Deactivating the active revision sends SIGTERM; the
   app releases (see above) and stops.

   ```sh
   REV=$(az containerapp revision list -g cropcard-dev-rg -n cropcard-dev-app \
     --query "[?properties.active].name" -o tsv)
   az containerapp revision deactivate -g cropcard-dev-rg -n cropcard-dev-app --revision "$REV"
   ```

4. **Publish the copy as the newest generation.** Replicate it once to the
   same replica path; the new generation becomes the most recently updated
   one, which is what the next boot restores.

   ```sh
   mkdir -p /tmp/pitr && cp /tmp/pitr.db /tmp/pitr/cropcard.db
   sed 's#/data/cropcard.db#/tmp/pitr/cropcard.db#' infra/litestream.yml \
     | grep -v '^addr:' > /tmp/pitr/litestream.yml
   litestream replicate -config /tmp/pitr/litestream.yml
   # wait for "snapshot written" for /tmp/pitr/cropcard.db, then Ctrl-C
   ```

5. **Start the app again** and check the boot log for `restore check ok` and
   the owner count.

   ```sh
   az containerapp revision activate -g cropcard-dev-rg -n cropcard-dev-app --revision "$REV"
   ```

Records created by the offline queue on devices after the restore point are
still queued on those devices and replay on their next sync.

## Recover deleted or overwritten blobs

Litestream deletes old snapshots and WAL segments itself after 7 days;
anything else that deletes or overwrites a blob leaves a recoverable copy.

```sh
# Soft-deleted blobs (and previous versions) under the replica
az storage blob list --account-name cropcarddevstg -c cropcard --auth-mode key \
  --prefix cropcard.db/ --include dv \
  --query "[].{name:name, deleted:deleted, version:versionId, current:isCurrentVersion}" -o table

# Undelete everything soft-deleted under a prefix
az storage blob undelete --account-name cropcarddevstg -c cropcard --auth-mode key -n <blob>

# Promote a previous version back to current
az storage blob copy start --account-name cropcarddevstg --auth-mode key \
  --destination-container cropcard --destination-blob <blob> \
  --source-uri "https://cropcarddevstg.blob.core.windows.net/cropcard/<blob>?versionid=<versionId>"

# A deleted container
az storage container list --account-name cropcarddevstg --auth-mode key --include-deleted -o table
az storage container restore --account-name cropcarddevstg --auth-mode key \
  -n cropcard --deleted-version <version>
```

After recovering blobs, run `litestream generations` to confirm the
generation is complete, then restart the app (deactivate/activate the
revision) and check `restore check ok`.

## When a container refuses to start

`RESTORE_REFUSED` or `[entrypoint] FATAL` in the logs, the restart alert
firing, and the previous revision still serving (or nothing serving after a
cold start).

- `litestream restore failed`: storage outage, rotated key, or firewall. Fix
  access; Container Apps keeps retrying on its own.
- `replica has generations but restore produced no database` or `replica was
initialized before but is now empty`: blobs were deleted or the app points
  at the wrong container. Recover the blobs (above). Do not bypass.
- `zero owners` / `no applied migrations` / `quick_check`: the newest
  generation is bad. Restore an earlier point in time (above).

Only when you have decided an empty database is correct (a deliberate reset),
set the override for one boot, then remove it:

```sh
az containerapp update -g cropcard-dev-rg -n cropcard-dev-app \
  --set-env-vars CROPCARD_ALLOW_EMPTY_RESTORE=1
# after the app is up:
az containerapp update -g cropcard-dev-rg -n cropcard-dev-app \
  --remove-env-vars CROPCARD_ALLOW_EMPTY_RESTORE
```

The next `./scripts/deploy-azure.sh --apply` also drops it, since the
template does not set it.

## When `HANDOFF_TIMEOUT` fires

The new container waited 75 s and started anyway, so the old one may have
accepted writes after the new one restored. Compare the old revision's last
write-log lines with the new revision's restore time; anything the old one
wrote in between is in its generation, not the new one. Restore that
generation to a copy (`-generation <old id>`) and re-enter the missing rows
through the app. Then find why the old one did not release (its log shows
`fencing writes` and either `released` or `RELEASE_UNVERIFIED`).
