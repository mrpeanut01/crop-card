# Test infrastructure audit — 2026-05-23

**Scope:** Pre-clickthrough check requested by user: "double check that the
testing code and database are up to speed with the current main branch and
that the testing scripts are correct and up to date for the latest
functionality." Followed by smoke verification through `/?/demo` → `/today`
and the major UC entry points.

**Result:** Bring-up was completely broken (seed crashed before writing any
fixtures; subagent posted to a route that returns 405). Three test-script
bugs fixed. Two host-environment issues found but left as user follow-ups
because they're outside the test-script surface.

**Build at audit:** `9d15bed` (main)
**Test stack:** `infra/docker-compose.test.yml` on :5273

---

## Findings (fixed in this audit)

### TIA-001 — Seed script crashes on dropped `users.role` column [P0]

- **File:** `apps/web/scripts/seed-test-data.mjs:133-137`
- **Symptom:**
  ```
  SqliteError: table users has no column named role
      at file:///app/apps/web/scripts/seed-test-data.mjs:133:27
  ```
- **Root cause:** Phase 18a moved per-tenant role to
  `helper_assignments.role_within_owner`. The legacy `users.role` column was
  dropped (see [apps/web/src/lib/db/schema.ts:79](apps/web/src/lib/db/schema.ts#L79):
  *"Per-tenant role. Replaces `users.role` once the legacy column drops."*).
  The seed was never updated.
- **Blast radius:** Seed exits with code 1 → no users, no owners, no fields,
  no blocks, no sprayers land in the test DB. **Every UC walk would block at
  step 0 (no fixtures)**.
- **Fix:** Rewrote `seed-test-data.mjs` to current schema. Specifically:
  - Drop `role` column from `users` insert.
  - Create `owners` row (`CropCard Test Farm`, slug `cropcard-test-farm`,
    `billing_status='active'`).
  - Mint `helper_assignments(owner_id, user_id, role_within_owner='owner',
    status='active')` for `owner@cropcard.local` and `'helper'` for
    `helper@cropcard.local`.
  - Add `owner_id` to `fields`, `blocks`, `crops`, `equipment`,
    `equipment_state` inserts (all Phase 18a tenant-scoped tables).
  - Extend truncate list to include the Phase 18 tables
    (`helper_assignments`, `helper_invites`, `api_tokens`,
    `owner_usage_counters`, `owner_subscriptions`, `plugin_overrides`,
    `owners`) and the Phase 21b `fungicide_events`.

### TIA-002 — Subagent POSTs sign-in form to a 405 URL [P0]

- **File:** `.claude/agents/playwright-clickthrough.md` (Auth section)
- **Symptom:** `POST /signin?/demo` → 405 Method Not Allowed.
- **Root cause:** Phase 18 promoted the landing page (`/+page.server.ts`) to
  host the demo form action. `/signin/+page.server.ts` is a load-only
  redirect now ([apps/web/src/routes/signin/+page.server.ts:5-13](apps/web/src/routes/signin/+page.server.ts#L5-L13)).
  The subagent doc still tells walkers to POST to `/signin?/demo`.
- **Blast radius:** Even with a working seed, no walker could sign in. Every
  UC would fail at "Auth (once per run)".
- **Fix:** Updated subagent doc to POST `/?/demo` (verified: returns 200
  with `{"type":"redirect","status":303,"location":"/today"}`). Re-worded
  the "what to abort on" hint so a walker landing on `/onboarding` knows
  the seeded helper_assignment is missing.

### TIA-003 — 381 plugin JSON files unreadable inside container (mode 0600) [P1]

- **Files:** `plugins/{crops,fertilizers,…}/*.json` created at `15:01` on
  2026-05-23.
- **Symptom:** Migration backfill logs ~250+ warnings:
  ```
  [migrate] skipping unparseable /app/plugins/crops/amaranth-burgundy.json:
  Unknown system error -35: Unknown system error -35, read
  ```
- **Root cause:** Files were written with mode `0600` (owner-only). The
  container's process UID can't read them through the bind mount.
- **Blast radius:** Plugin catalog seeded only 1 of ~310 plugin_versions
  rows. Any UC that selects a plugin (UC-02 spray, UC-37c schedule,
  UC-37d inputs plan, plugin authoring) would see an empty catalog.
- **Fix:** `find plugins -type f -name "*.json" -perm 600 -exec chmod 644
  {} +` (381 files touched). After fix + a fresh `down -v` / `up -d`,
  the migration seeded **309** plugin_versions rows. The remaining ~70
  unreadable files are a separate environmental issue (see HOST-001
  below).

---

## Smoke verification (post-fix)

| Path | Status | Note |
|------|--------|------|
| `POST /?/demo` (role=owner) | 200 → 303 /today | Cookie sticks |
| `GET /today`                | 200 | Renders `CropCard Test Farm`, `Sprayer-Clean`, `Sprayer-Contaminated` |
| `GET /api/sprayers`         | 200 | Returns both fixtures; `Sprayer-Contaminated.lastChemistryClass='sulfonylurea'` (UC-04 ready) |
| `GET /crops`                | 200 |
| `GET /spray`                | 200 |
| `GET /spray/decon`          | 200 |
| `GET /spray/fungicide`      | 200 |
| `GET /scout`                | 200 |
| `GET /records`              | 200 |
| `GET /plan`                 | 200 |
| `GET /harvest`              | 200 |
| `GET /equipment`            | 200 |
| `GET /settings`             | 200 |
| `GET /plugins`              | 200 |
| `GET /calibrate`            | 200 |
| `GET /onboarding`           | 200 |
| `GET /admin/owners`         | 403 | Correct — seed user is not superadmin |

Test stack is ready for the actual UC clickthrough run.

---

## Remaining issues (host-environment, NOT test-script bugs)

### HOST-001 — `com.apple.provenance` xattr blocks ~70 plugin reads in container

- **Symptom:** After chmod 644, several `plugins/fertilizers/*.json` and
  scattered other plugins still error with
  `Resource deadlock would occur` (errno -35) when the container reads
  them via the bind mount.
- **Diagnosis:** `xattr -l` shows `com.apple.provenance:` (empty value) on
  these files. Docker Desktop's macOS file-sharing layer (gRPC FUSE /
  VirtioFS) intermittently deadlocks on certain provenance-tagged files
  during overlapping reads.
- **Suggested fix (host, outside test-script scope):**
  ```bash
  find plugins -type f -name "*.json" -exec xattr -d com.apple.provenance {} \;
  # If that doesn't clear it, copy through a buffer to strip xattrs cleanly:
  find plugins -type f -name "*.json" -exec sh -c 'cp -X "$1" "$1.tmp" && mv "$1.tmp" "$1"' _ {} \;
  ```
  Or in Docker Desktop: Settings → General → Virtualization framework
  swap (VirtioFS ↔ gRPC FUSE) often clears the deadlock.
- **Impact:** 309 of ~380 plugins load. UCs that need a specific missing
  plugin (e.g. a particular fertilizer in UC-37d) may fail; the test
  scripts themselves are correct.

### HOST-002 — Compose conditional install can copy a stale host `node_modules` state

- **File:** `infra/docker-compose.test.yml:22`
  ```
  if [ ! -e /app/apps/web/node_modules/.modules.yaml ] &&
     [ ! -e /app/node_modules/.modules.yaml ];
  then pnpm install --frozen-lockfile; fi
  ```
- **Symptom (observed once):** First bring-up rendered `/today` as a 500
  with `Cannot find module 'zod' imported from
  '/app/packages/plugin-validation/src/schemas.ts'`.
- **Diagnosis:** Docker's "copy-on-first-mount" behavior populated the
  empty `web-node-modules` volume from the host's `node_modules` bind
  mount — which had `.modules.yaml` but was missing
  `packages/plugin-validation/node_modules/zod`. The conditional saw
  `.modules.yaml` and skipped install. After running `pnpm install
  --frozen-lockfile` on the **host** and re-bringing-up cleanly, the
  smoke passes (zod symlink present in
  `packages/plugin-validation/node_modules/`).
- **Suggested fix:** Either (a) make the conditional check a sentinel
  symlink that the install creates (e.g.
  `apps/web/node_modules/.cropcard-installed`), or (b) drop the
  conditional and always run `pnpm install --frozen-lockfile` (cheap
  when up-to-date). Option (b) is what the dev-stack compose already
  does and is the safest for an isolated test stack.
- **Impact:** If the user's host install is incomplete, every test run
  silently boots a broken container. Hard to diagnose because the seed
  succeeds but `/today` 500s.

---

## What changed in the repo

```
modified:   .claude/agents/playwright-clickthrough.md   (TIA-002 fix)
modified:   apps/web/scripts/seed-test-data.mjs         (TIA-001 fix)
modified:   plugins/**/*.json                            (TIA-003 fix — chmod 644)
new:        docs/clickthrough-reports/2026-05-23-test-infra-audit.md
```

No production code, no migrations, no schema changes. Safety kernel
untouched (CLAUDE.md invariant 1 honored).

---

## Next step

The original ask was to walk all `Implemented` UCs via the
playwright-clickthrough subagent. That run was **not** executed — the
audit stopped at "bring-up works". Re-invoke `/clickthrough-test all` to
dispatch the per-UC walks now that the seed and auth path are working.
The walks will exercise the real safety kernel + UI surface and surface
the actual feature-level bugs the user asked about.
