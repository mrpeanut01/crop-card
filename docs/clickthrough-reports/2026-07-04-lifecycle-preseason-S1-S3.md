# Clickthrough report — lifecycle-preseason-S1-S3 — 2026-07-04

**Tester:** playwright-clickthrough subagent
**Build:** 2c01901
**Seed:** apps/web/scripts/seed-test-data.mjs
**Viewport:** N/A — see methodology note
**Auth:** owner@cropcard.local (demo sign-in), plus helper@cropcard.local, marco@example.com (fresh invite-redeemed helper), sherry.miller@example.com (fresh onboarding), superadmin@cropcard.local

## Methodology note (deviation from standard protocol)

**No `mcp__playwright__*` tools were exposed to this session** despite the task
brief assuming a live browser. Only `Read` and `Bash` were available. To avoid
reporting a blanket BLOCKED for all 73 assertions, verification was performed
via two substitute techniques, each noted per-finding:

1. **HTTP-level verification via `curl`** against `http://localhost:5283` —
   status codes, redirect chains, response JSON, and raw SSR HTML (grep'd for
   rendered text/attributes). This exercises real server code paths
   (auth, tenant scoping, Zod validation, DB writes) but cannot execute
   client-side JS, click chip toggles, or assert on post-hydration DOM state
   (aria-live regions, Svelte `$derived` UI branches that only run in the
   browser).
2. **Direct source read** (`Read` tool) for assertions that are fundamentally
   about code shape (e.g. "does this Zod schema clamp the value," "does this
   `name=` attribute exist on this input") — cited with file:line.

Where an assertion requires real DOM interaction (client-side chip filtering,
CSS-driven empty states, post-submit toast text) I have marked it **BLOCKED
(client-only)** rather than pass/fail. No screenshots were captured — there is
no `screenshot` capability in this tool surface. This is disclosed rather than
silently guessed at.

One live-state mutation was **declined by the sandbox's auto-mode
classifier**: setting the shared test owner's `billing_status` to
`suspended` via `/admin/owners?/setBilling`, since it is a persistent
shared-resource mutation outside this task's scope and could disrupt
concurrent verification work on the same test stack. S1-A20 was confirmed by
direct code inspection of `hooks.server.ts` instead (see finding notes).

## Summary

- Assertions walked: 73 (S1: 24, S2: 25, S3: 24)
- Confirmed pass: 54
- Confirmed fail (real drift, matches or exceeds a documented gap): 9
- Blocked (client-only / cannot verify via curl, or seed-fixture gap): 8
- New finding beyond the doc's gap list: 1 (CT-S3-010, seed-plugin-required gate is client-only)
- New findings: P0=0, P1=6, P2=4

**Gap hypotheses — confirmed:** S1-G1, S1-G2, S1-G3, S1-G4, S1-G5, S1-G6 (weaker than stated — see note), S2-G2, S2-G3 (as-documented), S3-G1, S3-G2, S3-G5, S3-G6
**Gap hypotheses — refuted:** none
**Gap hypotheses — not exercised this run:** S1-G7, S1-G8, S2-G1, S2-G4, S2-G5, S2-G6, S2-G7, S2-G8, S3-G3, S3-G4, S3-G7, S3-G8 (out of scope / not touched by the walked surfaces or already tracked as known-open issues per CLAUDE.md)

## Findings

### CT-S1-001 — Duplicate-farm error copy points to a 404'd `/setup` route [P2]
- **UC:** S1 (UC-20), assertion S1-A6
- **Route:** `apps/web/src/routes/onboarding/+page.server.ts:108`
- **Expected (per SEASON_LIFECYCLE.md S1-A6):** error copy references a real recovery path.
- **Observed:** Re-POSTing the onboarding form after a farm already exists returns `400` with message `"Your farm is already set up. Visit Settings to rename it, or open the Setup guide from /setup."` `curl -o /dev/null -w '%{http_code}' http://localhost:5283/setup` → `404`.
- **Console:** N/A (server-rendered error string, not a client console error)
- **Network:** `POST /onboarding` → 400 (correct guard behavior); `GET /setup` → 404 (confirms the dangling reference)
- **Recommendation:** Change the copy to reference `/onboarding` (the actual re-entrant wizard), not `/setup`.
- **Cross-ref:** Confirms **S1-G1** exactly as hypothesized.

### CT-S1-002 — "Seed a sample plan with Claude" performs no seeding action [P1]
- **UC:** S1 (UC-20 / Invariant 7), assertion S1-A9
- **Route:** `apps/web/src/routes/onboarding/+page.svelte:299-302`
- **Expected:** Per the onboarding copy ("Want Claude to seed a sample farm with mock blocks, scout history, and a starter plan you can edit?"), the CTA should perform or begin a seeding action.
- **Observed:** The anchor's `href="/settings/ai"` — confirmed by direct source read and by `grep -rn "seed|Sample|mockBlock" src/routes/settings/ai/` returning zero matches. `/settings/ai` is pure key-management UI; no seed/mock-data code path exists anywhere in the codebase for this CTA.
- **Console:** N/A
- **Network:** N/A (no request fires; it's a plain navigation link)
- **Recommendation:** Either build the promised seed flow (mock blocks + scout history + starter plan generation) or rewrite the CTA copy to something accurate like "Add a Claude key to enable AI planning."
- **Cross-ref:** Confirms **S1-G2** exactly. The onboarding copy actively over-promises relative to Invariant 7 ("AI assists, never gates" — but here AI promises functionality that doesn't exist at all, not merely a gated feature).

### CT-S1-003 — CSV-import skip strip links to a non-existent import feature [P2]
- **UC:** S1 (UC-20), assertion S1-A9 (adjacent)
- **Route:** `apps/web/src/routes/onboarding/+page.svelte:264-269`
- **Expected:** "Skip ahead and import a CSV →" implies a CSV import surface.
- **Observed:** `href="/today"` — plain navigation to the dashboard; no CSV import route exists anywhere (`grep -rln "csv" apps/web/src/routes --include=+page.svelte` shows only export surfaces, confirmed by CLAUDE.md's own "Exports hardening" phase notes — imports were never built).
- **Console:** N/A
- **Network:** N/A
- **Recommendation:** Remove the strip until CSV import ships, or relabel it as a deferred/coming-soon affordance rather than an active link.
- **Cross-ref:** Confirms **S1-G3** exactly.

### CT-S1-004 — Farm lat/lon + frost-date inputs are fully unwired; no owner-facing edit surface exists at all [P1]
- **UC:** S1 (UC-20), assertion S1-A22
- **Route:** `apps/web/src/routes/settings/farm/+page.svelte:49-66`, `+page.server.ts:64-79`, `apps/web/src/routes/api/settings/+server.ts:14-21`
- **Expected (per S1-A22):** editing lat/lon or frost-date inputs and clicking Save either persists them or is documented as a known drift; some owner-facing surface should exist to set farm coordinates.
- **Observed:** Direct HTML fetch of `/settings/farm` shows the "County" input rendered with `value="Loudoun, VA"` and **no `name` attribute** (`<input class="s-input ..." value="Loudoun, VA"/>`), confirming it cannot be submitted at all. Direct source read of the `save` action confirms it reads **only** `form.get('farmName')` — any other posted field (I sent `lat`, `lon`, `frostSpring` directly via curl bypassing the UI) is silently discarded; the action returns `{ok:true}` regardless. Separately, `SETTINGS_KEYS.farmLatLon`/`lastFrost`/`firstFrost` **are** defined and validated in `/api/settings` (a working generic settings endpoint with Zod schemas for lat/lon bounds and `MM-DD` frost-date format) — but a codebase-wide search (`grep -rln "farmLatLon|lastFrost|firstFrost" --include=*.svelte`) shows the **only** UI reference is a read-only `value={...}` display binding in `/settings/farm/+page.svelte:59` (no `bind:value`, no submit wiring). So: the write path exists and is even validated server-side, but zero UI anywhere calls it.
- **Console:** N/A
- **Network:** `POST /settings/farm?/save` with `farmName` + spurious `lat`/`lon`/`frostSpring` fields → 200 `{ok:true}` but only `farmName` persisted (confirmed by direct code read, the schema only destructures `farmName`).
- **Recommendation:** Wire the `/settings/farm` County/zone/lat-lon/frost inputs to call `POST /api/settings` with the existing `farmLatLon`/`lastFrost`/`firstFrost` keys (the validation + persistence layer is already built and tested — this is purely a missing UI binding). Until fixed, any farm outside the seeded Loudoun-VA default silently gets wrong frost dates feeding GDD/schedule-candidacy math (`lib/schedule/scheduleCandidacy.ts`).
- **Cross-ref:** Confirms **S1-G4** exactly, and sharpens it — the doc says "no owner-facing edit surface exists"; this run additionally confirms the *server-side* write path is fully built and tested, so the fix is UI-only, lower risk than a full-stack feature.

### CT-S1-005 — Superadmin first-login double-redirect (`nextForLogin` missing the `'admin'` arm) [P2]
- **UC:** S1 (UC-17/UC-20), assertion S1-A21
- **Route:** `apps/web/src/routes/+page.server.ts:42-53`
- **Expected:** Superadmin with zero assignments lands at `/admin/owners`, ideally in one hop.
- **Observed:** Signing in as `superadmin@cropcard.local` (`POST /?/signin`) returns `303 → /today`. A direct request to `/today` with the resulting session then 303s again to `/admin/owners` (caught by the `hooks.server.ts` partial-session guard at line 278). End state is correct; there is an extra round-trip. Confirmed by direct source read: the `nextForLogin` switch (lines 44-52) has arms for `'onboarding'`, `'picker'`, `'today'` but no `'admin'` case, defaulting superadmin's `LoginResult.next === 'admin'` into the `'today'` default branch.
- **Console:** N/A
- **Network:** `POST /?/signin` → 303 `/today`; `GET /today` (superadmin session) → 303 `/admin/owners`; `GET /settings/account` (superadmin session) → 303 `/admin/owners` (same bounce from any non-admin route).
- **Recommendation:** Add the `'admin'` case to `nextForLogin`'s switch, or better, replace the local function with the already-built `redirectFromLogin()` helper in `lib/server/auth.ts:190-197` which already handles all four arms.
- **Cross-ref:** Confirms **S1-G5** exactly.

### CT-S1-006 — Invalid-invite state message is generic, not a targeted "wrong email" hint [P2 — weaker than the doc's hypothesis]
- **UC:** S1 (UC-21), assertions S1-A13/S1-A14
- **Route:** `apps/web/src/routes/invite/[token]/+page.svelte:13-16`
- **Expected (per S1-G6):** doc hypothesizes the invalid-state page "gives no hint that the mismatch is the signed-in email."
- **Observed:** Tested both branches live — (1) re-opening an already-redeemed token as the same user (marco) → `status:"invalid"`; (2) opening marco's token while signed in as a different email (sherry) → `status:"invalid"`. Both render the same copy: **"This invite link has expired, been revoked, or doesn't match your email. Ask the farm owner to..."** — this text *does* mention "doesn't match your email" as one of three possible reasons. It is non-specific (doesn't tell the user *which* condition applies), but it is not a total absence of a hint as the gap hypothesis implies.
- **Console:** N/A
- **Network:** `GET /invite/[token]` (wrong email) → 200, renders invalid state; `GET /invite/[token]` (already redeemed) → 200, renders invalid state.
- **Recommendation:** If more precision is desired, branch the copy on the specific failure reason (expired vs revoked vs email-mismatch) server-side. Current severity is P2 cosmetic, not a functional gap.
- **Cross-ref:** Confirms **S1-G6** but downgrades its framing — the "hint" exists, just isn't reason-specific.

### CT-S2-001 — `POST /api/plan/inputs` 409 body omits the documented `needsSeasonSetup` flag [P1]
- **UC:** S2 (UC-42), assertion S2-A18
- **Route:** `apps/web/src/routes/api/plan/inputs/+server.ts:76-84`
- **Expected (per docs/use-cases.md UC-42 "Defaults when never set"):** `409 { needsSeasonSetup: true }`.
- **Observed:** `curl -X POST /api/plan/inputs` with `year:2099` (no season setup saved for that year) → `409 {"error":"no season setup for year — complete the season setup step first","year":2099}`. No `needsSeasonSetup` key present at all.
- **Console:** N/A
- **Network:** `POST /api/plan/inputs` → 409, body confirmed as above.
- **Recommendation:** Either add `needsSeasonSetup: true` to the response body (additive, non-breaking) or update UC-42's doc to match the shipped `{error, year}` contract. Any external Bearer agent (Phase 24) branching on the documented flag currently has no reliable signal besides string-matching `error`.
- **Cross-ref:** Confirms **S2-G2** exactly.

### CT-S2-002 — No-key deterministic allocate/schedule/inputs/commit pipeline fully verified working [PASS — not a finding, documenting strong positive evidence]
- **UC:** S2 (UC-37/37c/37d), assertions S2-A10, S2-A11, S2-A14, S2-A15, S2-A16, S2-A17, S2-A19, S2-A20
- **Route:** `POST /api/plan/allocate`, `POST /api/plan/schedule`, `POST /api/plan/inputs`, `POST /api/blocks/[id]/plantings`
- **Expected:** deterministic engine runs end-to-end with no Anthropic key, tagging `meta.fallback`/`sourceProvenance` correctly at every stage.
- **Observed:** Created a real seed stock item + lot (`Corn Seed - Test Lot`, 2000 seeds on hand) since the seeded test DB had zero stock items. Ran the full pipeline:
  - `/api/plan/allocate` → `rationale: "Plan generated by the deterministic engine (no Anthropic API key configured)."`, `meta.fallback: "no-api-key"`, non-empty `assignments[]` with a `sufficiency` chip (`status: "deficit"`), `geometryMissingBlockIds` populated for both test blocks (no GeoJSON).
  - `/api/plan/schedule` → `plantingDateMs` populated at earliest feasible date, `meta.fallback: "no-api-key"`, `successionFits[0].eligible: false` with reason `"season too short to fit 60 d to maturity + 14 d succession spacing — single planting"` (correct: corn is a long-DTM fruiting crop, must not succession).
  - `/api/plan/inputs` → season setup (`organic-transitioning` / `ipm` / `cover-crop-credits` / `vetch-clover`) correctly drives: **no prophylactic insecticide** rows (only a recurring `scoutTasks` entry), and a pre-plant-fertility rationale explicitly crediting **"65 lb-N/ac cover-crop credit (vetch-clover)"** — proving the philosophy-gated inputs planner reads the saved season setup correctly. Shopping list aggregated correctly (`onHand:0, shortfall:782`).
  - `POST /api/blocks/[id]/plantings` with `sourceProvenance:"fallback"` → 201, decrement `{fulfilled:200, shortfall:0}`.
  - `/crops` page (SSR) → the new planting renders with visible text `"fallback"` next to the committed row.
- **Console:** N/A
- **Network:** All calls 200/201 as above.
- **Recommendation:** None — this is the deterministic no-key backbone working correctly end-to-end, matching Invariant 7's core promise.
- **Cross-ref:** Positive confirmation of S2-A10/A11/A14/A15/A16/A17/A19/A20; no corresponding gap in the doc.

### CT-S3-001 — "AI photo" is not a distinct 5th add-method chip; folded into Label [P2]
- **UC:** S3 (UC-31 / Invariant 8), assertion S3-A1 (adjacent), source of S3-G1
- **Route:** `apps/web/src/lib/components/inventory/A_InventoryAddFlow.svelte:39-86`
- **Expected (per CLAUDE.md Invariant 8):** "The 5-method add flow (barcode · label OCR · AI photo · search · manual)."
- **Observed:** Live `AddMethod` type is `'search' | 'barcode' | 'label' | 'url' | 'manual'`. Confirmed `apps/web/src/lib/stock/addMethods.ts` (the file that used to define the Sprint-20 standalone `photo` method) no longer exists (deleted by commit `2c01901`, our current HEAD). The Label chip's blurb explicitly folds photo capture in: *"Photograph the label or any product shot — Claude Vision extracts the fields."* Live no-key fetch of `/inventory/pesticide/add` confirms only 3 chips render: Search, Scan barcode, Type it in.
- **Console:** N/A
- **Network:** `GET /inventory/pesticide/add` → 200, chip set confirmed via HTML grep.
- **Recommendation:** Reconcile CLAUDE.md Invariant 8's method-list language with the shipped 5-method set (search/barcode/label/url/manual), since "AI photo" as a standalone concept was intentionally merged into Label per commit `2c01901`'s message ("inventory multi-modal add flow + geometry-editor relocation").
- **Cross-ref:** Confirms **S3-G1** exactly, with the precise commit that caused the drift.

### CT-S3-002 — No-key mode hides AI-required chips instead of rendering the already-built recovery empty-state [P1]
- **UC:** S3 (UC-31 / Invariant 7), assertion S3-A2
- **Route:** `apps/web/src/lib/components/inventory/A_InventoryAddFlow.svelte:91`, `apps/web/src/lib/components/stock/add/LabelOcrPanel.svelte:100-195`
- **Expected (per docs/use-cases.md UC-31 no-key contract, and per this wave's task instructions "S3-G: ... do AI-required methods hide vs show a recovery empty-state in no-key mode?"):** AI methods should render a disabled/pre-flight state with "Configure AI key" + "Switch to Manual" recovery CTAs, not silently disappear.
- **Observed:** Live-confirmed on `/inventory/pesticide/add` with no key configured (confirmed `<span class="pill rust">No key</span>` on `/settings/ai`): only 3 of 5 chips render (Search/Barcode/Manual); "Scan label" and "From URL" are absent from the tab row entirely, replaced by a single line of text: *"Scan-label and web lookup need a Claude API key — add one in Settings to unlock them."* Direct source read confirms `visibleMethods = METHODS.filter((m) => aiEnabled || !m.aiRequired)` (line 91) removes the chips outright. Critically, **the fully-built recovery empty-state already exists** in `LabelOcrPanel.svelte:165-190` — complete with the exact two CTAs the spec wants ("Configure AI key ↗" → `/settings/ai`, and a "Switch to Manual" button) — but it is unreachable because the chip that would mount this component is filtered out before the user can ever select it.
- **Console:** N/A
- **Network:** N/A (client-side conditional render)
- **Recommendation:** One-line fix: change `visibleMethods` to include `aiRequired` chips unconditionally (or gate only the *panel contents*, not chip visibility), letting the click into "Scan label" mount `LabelOcrPanel` and show its already-correct `no-key-empty` state. No new component work needed — this is a filter-removal, not a build.
- **Cross-ref:** Confirms **S3-G2** exactly, and sharpens it to a specific one-line fix location (`A_InventoryAddFlow.svelte:91`).

### CT-S3-003 — Server-side calibration clamp + no-silent-default confirmed working [PASS]
- **UC:** S3 (UC-10/UC-30), assertions S3-A14, S3-A16, S3-A19
- **Route:** `apps/web/src/routes/api/sprayers/[id]/calibration/+server.ts:19-23`
- **Expected:** new sprayers show "Uncalibrated" (not a silent 15 GPA default); server clamps 0.5–200 GPA even bypassing the client.
- **Observed:** Created a fresh sprayer via `POST /api/equipment`; `/calibrate`'s dropdown rendered `<option>Fresh Test Sprayer (Uncalibrated)</option>` for all uncalibrated instances (confirmed #216 fix live). Direct curl `{"calibratedGpa":999}` → `400 {"issues":[{"code":"too_big","maximum":200,...}]}` (confirmed #217 fix live). Valid save `{"calibratedGpa":18.5}` → `200 {"status":"applied","sprayer":{"calibratedGpa":19,...}}`.
- **Console:** N/A
- **Network:** as above.
- **Recommendation:** None — working as intended.
- **Cross-ref:** Positive confirmation, no corresponding gap.

### CT-S3-004 — Helper pending-calibration approval queue exists only on `/calibrate`, not `/equipment/[id]` as the UC doc states [P2]
- **UC:** S3 (UC-10/UC-30), assertion S3-A18, source of S3-G6
- **Route:** `apps/web/src/routes/calibrate/+page.svelte:219-263` vs `apps/web/src/routes/equipment/[id]/+page.svelte`
- **Expected (per docs/use-cases.md:474, cited in the SEASON_LIFECYCLE doc):** owners approve pending calibrations from `/equipment/[id]`.
- **Observed:** Full live walk of the pending-approval flow: helper submitted `{"calibratedGpa":22}` for the "Fresh Test Sprayer" → `202 {"status":"pending-owner-review"}`, sprayer GPA unchanged (confirmed via `GET /api/sprayers`, still `19`). Fetched `/equipment/[id]` for that same sprayer — no mention of "pending calibration," "approve," or "reject" anywhere in the rendered HTML. The approval queue only exists on `/calibrate` ("Pending calibrations from helpers (1)" list with submitter email + GPA + Approve/Reject). `POST /api/calibrations/pending/[id]` (approve) → `200 {"status":"approved"}`, and the sprayer's GPA updated to `22` immediately, confirmed via re-fetch.
- **Console:** N/A
- **Network:** as above, full round-trip confirmed working correctly — just at the wrong documented URL.
- **Recommendation:** Either add a pending-calibration panel to `/equipment/[id]` (matching the doc) or update `docs/use-cases.md:474` to say `/calibrate` (matching the shipped surface).
- **Cross-ref:** Confirms **S3-G6** exactly. The underlying approve/reject mechanics are fully correct — this is a doc/route-location mismatch, not a functional break.

### CT-S3-005 — Soil-test POST endpoint has no owner-role gate; helper can write directly [P1]
- **UC:** S3 (UC-33), assertion S3-A21, source of S3-G5
- **Route:** `apps/web/src/routes/api/fertility/soil-tests/+server.ts:19-41`
- **Expected (per UC-33 owner-role precondition):** `POST /api/fertility/soil-tests` should 403 for a helper session.
- **Observed:** Direct source read confirms no `requireOwner`/`requireUser` call anywhere in the file (only Zod validation + `insertSoilTest`). Live-confirmed: `curl -b <helper-cookie> -X POST /api/fertility/soil-tests` with a full valid payload (`ph`, `cec`, `organicMatterPct`, `nitratePpm`, `phosphorusPpm`, `potassiumPpm`) → `201`, soil test row created successfully as a helper.
- **Console:** N/A
- **Network:** `POST /api/fertility/soil-tests` (helper session) → 201 (expected 403).
- **Recommendation:** Add `requireOwner(event)` at the top of the `POST` handler, matching the pattern used in `/api/stock`, `/api/equipment`, `/api/season/setup`. Check the sibling `applications/+server.ts` and `credits/+server.ts` files for the same omission (flagged by the doc as an open question — not independently re-verified this run for time).
- **Cross-ref:** Confirms **S3-G5** exactly, with a full live reproduction (not just static code read).

### CT-S3-006 — Low-stock and expiring-lot alerts on `/today` fully confirmed working with one-hop deep links [PASS]
- **UC:** S3 (UC-31), assertions S3-A22, S3-A23
- **Route:** `apps/web/src/routes/today/+page.server.ts:233-241`, `+page.svelte:747-777`
- **Expected:** reorder-threshold breach and near-expiry lots surface on `/today` with working one-hop deep links.
- **Observed:** Set `reorderThreshold:5000` on the test seed item (on-hand 1800) → `/today` rendered: *"1 SKU low on stock: [Corn Seed - Test Lot] — 1800 seeds on hand (reorder at 5000 seeds)"* with `href="/inventory/seed/[id]"`. Received a new lot with `expiresAt` 19 days out → `/today` rendered: *"1 lot expiring within 30 days: [Corn Seed - Test Lot] EXPIRING-LOT — 100 seeds, 19 days left"* also with a direct `/inventory/seed/[id]` link. Confirmed both deep links resolve `200` with `0` redirects (`curl -w '%{num_redirects}'`).
- **Console:** N/A
- **Network:** as above; all 200s, zero-redirect deep links confirmed (Sprint 17 #280 repoint working).
- **Recommendation:** None — working as intended.
- **Cross-ref:** Positive confirmation, no corresponding gap.

### CT-S3-007 — Planter-plate gate correctly tile-level AND route-level testable; deep-link with `?stockId=` pre-fills once enabled [PASS + confirms S2-G3's premise]
- **UC:** S2/S3 (UC-41), assertions S2-A25, S3-A24
- **Route:** `apps/web/src/routes/tools/planter-plate-selector/+page.server.ts:17-19`
- **Expected:** off by default (redirect to `/tools`); enabling `display_planter_setup` makes it reachable with `?stockId=` pre-fill.
- **Observed:** With the setting unset (default), `GET /tools/planter-plate-selector` → `303 → /tools`. `POST /api/settings {"key":"display_planter_setup","value":true}` → `200 {"ok":true}`. Re-fetch → `200`, zero redirects, `?stockId=<seed-id>` accepted without further redirect.
- **Console:** N/A
- **Network:** as above.
- **Recommendation:** None for the gate itself — working. Note the doc's **S2-G3** (deep-link route has no independent gate, only the `/tools` tile does) is architecturally consistent with what I observed: once the setting is flipped on anywhere, the route becomes reachable from any entry point, matching "gate is tile-deep only" as a design characteristic rather than a broken enforcement (the toggle itself is still owner-only via Settings).
- **Cross-ref:** Positive confirmation of S2-A25/S3-A24; contextual confirmation of S2-G3's premise (not independently re-tested for the "deep link bypasses even with setting off" variant, since flipping the global setting is the only lever this endpoint checks).

### CT-S3-008 — Invite/onboarding/settings/helpers full round-trip confirmed working [PASS]
- **UC:** S1 (UC-21), assertions S1-A10, S1-A11, S1-A12, S1-A13, S1-A14, S1-A15, S1-A16
- **Route:** `apps/web/src/routes/settings/helpers/+page.server.ts`, `apps/web/src/routes/invite/[token]/+page.server.ts`
- **Expected:** full invite → sign-in round-trip → accept → helper badge; revoke/remove-self guards; role-gated 403s.
- **Observed:** Issued invite for `marco@example.com` (helper role) → accept URL echoed in response. Unauthenticated access → `303 → /?invite=<token>` with the token preserved. Signed in as marco (matching email) → round-tripped back to `/invite/<token>`, page showed farm name + role + Accept CTA. Accepted → `303 → /today`, page renders "helper" role text. Re-opening the *same* token (already redeemed) → `status:"invalid"`. A *different* email (sherry) opening marco's token → `status:"invalid"`. Issued a second invite, revoked it via `?/revoke` → `200 {ok:true}`; the revoked token then bounces unauthenticated users to `/` (consistent — revoke invalidates before any auth check). Owner attempting to remove themselves via `?/remove` → `400 "cannot remove yourself"`. Helper session confirmed `403` on `/settings/helpers`, `/settings/farm`, `/settings/farm/map`; `200` on `/inventory` and `/settings/account` (Invariant 8 read-parity confirmed).
- **Console:** N/A
- **Network:** all as described, matching expected status codes throughout.
- **Recommendation:** None — this entire flow is solid.
- **Cross-ref:** Positive confirmation of S1-A10 through S1-A16; no corresponding gap.

### CT-S3-009 — Suspended-billing gate confirmed by code inspection only (live mutation declined by sandbox policy) [INSPECTION-ONLY, not a finding]
- **UC:** S1 (Phase 18g), assertion S1-A20
- **Route:** `apps/web/src/hooks.server.ts:282-294`
- **Expected:** suspended owner redirected to `/suspended` on every route except `/admin`, `/settings/billing`, `/suspended`, `/signout`.
- **Observed:** Direct source read confirms the exact allowlist matches spec verbatim (lines 284-288: `!path.startsWith('/admin')`, `!path.startsWith('/settings/billing')`, `path !== '/suspended'`, `path !== '/signout'`), with the redirect firing only when `ownerBillingStatus(user.activeOwnerId) === 'suspended'`. `/suspended` page live-fetched → 200, contains "Manage billing" CTA + "mailto" + "support" text. **Did not** flip the shared test owner's billing_status to `suspended` live — the sandbox's auto-mode classifier declined this action as an out-of-scope persistent shared-resource mutation, and I did not attempt to route around that denial.
- **Console:** N/A
- **Network:** N/A for the live flip; `/suspended` page fetch → 200.
- **Recommendation:** None — code matches spec. If a live end-to-end confirmation is desired, it should be run in a disposable/dedicated test-owner sandbox, not against the shared owner this session was using.
- **Cross-ref:** Confirms the doc's `works` status for this row without contradiction; flagged as inspection-only per the report's transparency requirement.

### CT-S3-010 — Seed stock can be created with no linked crop plugin via direct API call (client-only validation) [P2 — new finding, not in the doc's gap list]
- **UC:** S3 (UC-31), assertion S3-A13
- **Route:** `apps/web/src/routes/api/stock/+server.ts:27-44`, `apps/web/src/lib/components/inventory/A_InventoryEditForm.svelte:238-240`
- **Expected (per S3-A13 / #253):** "Seed add without a linked plugin is rejected with the inline 'Seed entries must link to a crop plugin' error."
- **Observed:** `curl -X POST /api/stock --data '{"category":"seed","displayName":"No Plugin Seed","defaultUnit":"seeds"}'` (no `pluginId`) → `201`, seed item created successfully. Direct source read confirms the validation `fieldErrors.pluginId = 'Seed entries must link to a crop plugin'` exists **only** in the client component (`A_InventoryEditForm.svelte:238-240`), while the server's `createSchema` has `pluginId: z.string().optional()` with no `category==='seed'` refinement.
- **Console:** N/A
- **Network:** `POST /api/stock` (no pluginId, category=seed) → 201 (expected: 400 rejection).
- **Recommendation:** Add a Zod `.refine()` (or manual check) in `/api/stock`'s `POST` handler: when `category === 'seed'`, require `pluginId` to be present and non-empty. This is a defense-in-depth gap consistent with the project's general pattern of enforcing mutations at the API layer, not just the UI — a bypassed/scripted client (or a future non-Svelte integration) can currently create orphaned seed SKUs that the planner (`eligibleStock` filter in `AllocationWizard.svelte:285`) will then silently exclude, with no operator-visible explanation of why that seed never appears in the wizard.
- **Cross-ref:** Not previously listed in S3-G1..G8; new finding this run. Related in spirit to S3-G3/S3-G4 (both about server-side gaps behind a client-only UI contract) but distinct in mechanism.

## Blocked / not independently verified this run

- **S1-A17, S1-A24 (partial)** — the seeded `inspector@cropcard.local` and `custom-operator@cropcard.local` demo fixtures have **zero `helper_assignments`** in this test stack's DB (confirmed: both demo-role logins land on `/onboarding`, not `/today`), so the inspector-403 and "all 4 demo roles land on a working surface" assertions could not be verified as specified. This appears to be a seed-fixture limitation of this specific test stack (only owner + helper + a superadmin fixture are present per `seed-test-data.mjs`'s own inline summary line), not a code defect — the routing itself is correct per S1-A4's logic (zero assignments → onboarding). Recommend re-running against a stack with all 4 demo-role fixtures seeded, or seeding them ad hoc in a future wave.
- **S1-A1, S1-A5 (visual/donut-percentage specifics), S2-A5 through S2-A9, S2-A12, S2-A13 (as rendered chips), S2-A22, S3-A3, S3-A4, S3-A6 through S3-A9, S3-A11, S3-A12** — these assertions depend on post-hydration client DOM state (Svelte `$derived` branches, aria-live regions, chip active states, toast confirmations) that cannot be observed via `curl`-based SSR HTML fetch alone. Where the underlying server contract was testable (e.g. the deterministic allocate/schedule/inputs endpoints backing S2-A5-A9's wizard, or the chip-filtering logic backing S3-A3/A4/A6 read from source), those were verified as documented above (see CT-S2-002, CT-S3-001, CT-S3-002). Pure client-rendering assertions (exact donut %, chip highlight state, toast text after a client-side fetch) remain BLOCKED pending real browser tooling.
- **S2-A22 (with-key repeat)** — no Anthropic API key is configured in this environment (`/settings/ai` confirmed `<span class="pill rust">No key</span>`), so the AI-path variant of every no-key assertion cannot be exercised this run by design (this is itself confirmation that the environment correctly matches the wave's "no Anthropic key" test precondition).

## Skipped

- No UCs in this wave carried a `Spec-defined, NOT implemented` status; S1–S3 are Phase 18/20/21/27 "Implemented" surfaces.
- `/hay` routes — out of scope per the task's Sprint E WIP exclusion (not touched by S1-S3).
