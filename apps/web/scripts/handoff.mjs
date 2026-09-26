// Container-boot half of the deploy handoff fence and the restore guard.
// Called by infra/entrypoint.sh:
//
//   node scripts/handoff.mjs acquire         before `litestream restore`
//   node scripts/handoff.mjs verify-restore  after it, before migrations
//
// Exit 0 = go on. Any non-zero exit stops the container before it serves, so
// Container Apps retries it while the previous revision keeps serving.

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { configFromEnv, getJson, listNames, putJson } from './lib/azureBlob.mjs';
import {
  ACQUIRE_TIMEOUT_MS,
  HOLDER_BLOB,
  INITIALIZED_BLOB,
  REQUEST_BLOB,
  acquireDecision,
  restoreVerdict
} from './lib/handoffProtocol.mjs';

const env = process.env;
const cfg = configFromEnv(env);
const nonce = env.HANDOFF_NONCE ?? '';
const revision = env.CONTAINER_APP_REVISION ?? env.HOSTNAME ?? 'unknown';
const dbPath = env.DB_PATH ?? (env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, '');
const replicaPath = env.LITESTREAM_REPLICA_PATH ?? dbPath.split('/').pop();

/** @param {string} msg */
const log = (msg) => console.log(`[handoff] ${msg}`);
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  if (!cfg)
    throw new Error('AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY / AZURE_BLOB_CONTAINER not set');
  if (!nonce) throw new Error('HANDOFF_NONCE not set');
  await putJson(cfg, REQUEST_BLOB, { nonce, revision, requestedAt: Date.now() });
  log(`requested handoff for ${revision} (nonce ${nonce.slice(0, 8)})`);

  const deadline = Date.now() + Number(env.HANDOFF_TIMEOUT_MS ?? ACQUIRE_TIMEOUT_MS);
  let announced = false;
  for (;;) {
    const got = await getJson(cfg, HOLDER_BLOB);
    const holder = got?.value ?? null;
    const d = acquireDecision(holder, Date.now());
    if (d.action === 'proceed') {
      if (d.reason === 'no-holder') log('no previous writer on record; proceeding');
      else if (d.reason === 'released') {
        log(
          `previous writer ${holder.revision ?? '?'} released ` +
            `(position ${JSON.stringify(holder.position ?? null)}, verified=${holder.verified === true}); proceeding`
        );
      } else {
        const age = Math.round((Date.now() - Number(holder.heartbeatAt ?? 0)) / 1000);
        log(
          `previous writer ${holder.revision ?? '?'} is stale (last heartbeat ${age}s ago); proceeding`
        );
      }
      return;
    }
    if (!announced) {
      log(`waiting for ${holder.revision ?? 'previous writer'} to fence writes and release`);
      announced = true;
    }
    if (Date.now() > deadline) {
      console.error(
        `[handoff] HANDOFF_TIMEOUT: ${holder.revision ?? 'previous writer'} did not release within ` +
          `${Math.round(Number(env.HANDOFF_TIMEOUT_MS ?? ACQUIRE_TIMEOUT_MS) / 1000)}s; ` +
          'proceeding anyway — writes it accepts from now on may be orphaned'
      );
      return;
    }
    await sleep(1000);
  }
}

/** @param {string} p */
function inspectDb(p) {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = String(db.pragma('quick_check', { simple: true }));
    const has = (/** @type {string} */ t) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    const count = (/** @type {string} */ t) =>
      has(t)
        ? Number(
            /** @type {{ n: number }} */ (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get()).n
          )
        : 0;
    return { quickCheck, migrations: count('__drizzle_migrations'), owners: count('owners') };
  } finally {
    db.close();
  }
}

async function verifyRestore() {
  if (!cfg)
    throw new Error('AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY / AZURE_BLOB_CONTAINER not set');
  const generations = await listNames(cfg, `${replicaPath}/generations/`, 1);
  const initialized = (await getJson(cfg, INITIALIZED_BLOB)) !== null;
  const dbExists = existsSync(dbPath);
  const stats = dbExists ? inspectDb(dbPath) : { quickCheck: null, migrations: null, owners: null };
  const verdict = restoreVerdict({
    dbExists,
    replicaHasGenerations: generations.length > 0,
    initialized,
    ...stats,
    allowEmpty: env.CROPCARD_ALLOW_EMPTY_RESTORE === '1'
  });
  const facts =
    `db=${dbExists ? 'restored' : 'absent'} generations=${generations.length > 0} ` +
    `initialized=${initialized} owners=${stats.owners ?? '-'} migrations=${stats.migrations ?? '-'}`;
  if (!verdict.ok) {
    console.error(
      `[handoff] RESTORE_REFUSED: ${verdict.reason} (${facts}). Not serving; see docs/ops/restore-runbook.md`
    );
    process.exit(3);
  }
  log(`restore check ok: ${verdict.reason} (${facts})`);
  if (dbExists && !initialized) {
    await putJson(cfg, INITIALIZED_BLOB, { at: Date.now(), revision }, { ifNoneMatch: '*' });
    log('marked replica initialized');
  }
}

const cmd = process.argv[2];
const run = cmd === 'acquire' ? acquire : cmd === 'verify-restore' ? verifyRestore : null;
if (!run) {
  console.error('usage: handoff.mjs acquire | verify-restore');
  process.exit(2);
}
run().then(
  () => process.exit(0),
  (err) => {
    console.error(`[handoff] ${cmd} failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
);
