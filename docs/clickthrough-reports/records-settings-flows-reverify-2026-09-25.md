# Re-verify — Records + Settings end-to-end flows (epic #202) — 2026-09-25

**Source audit:** `records-settings-flows-phase-25-verification-2026-05-25.md`
**Setup:** production build on port 5318, seeded DB, Playwright signed in as `owner@cropcard.local`.
A second Owner assignment was added temporarily to test the farm switcher.

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-RS-001 Save permanently disabled on /settings/account and /settings/farm | #203 (closed) | **Fixed** | After an edit, Save is enabled on both pages. Clicking it POSTs `?/save`, which returns 200. `SettingsShell` wraps the body in the form when `saveAction` is set. |
| CT-RS-002 USDA CSV: raw user IDs, empty EPA reg #, empty target_pest | #204 (closed) | **Fixed (code); data gap remains** | `export.usda.csv` resolves the applicator email, takes EPA reg # from the plugin and emits `MISSING_EPA_REG` when it is absent, and derives target_pest for insecticides and fungicides. Plugins still missing `epaRegistrationNumber`: 48/77 herbicides, 34/70 insecticides and 27/64 fungicides. Those rows export with the warning flag. Backfilling them needs label research; nobody should type these numbers from memory. |
| CT-RS-004 "Download account data" linked to the spray CSV | #205 (closed) | **Fixed** | Link goes to `/api/account/export.json`, which returns 200 JSON with keys `operator, activeOwner, blocks, sprayers, events, hayCuttings, apiTokens, gdprNote, …`. |
| CT-RS-005 helper invite form not focused | #206 (closed) | **Fixed** | After "Invite helper", `document.activeElement` is the `input[name=email]`. |
| CT-RS-003 AI counter mismatch | #167 (closed) | **Fixed** | Covered by #167 (both loaders use `withTenant(aiCallLog)`). |
| CT-RS-006 /settings/api-tokens orphan | #165 (closed) | **Fixed** | Linked from `/settings/integrations` ("Manage API tokens"). |
| Flow 2 raw UUIDs in /records | #160 (closed) | **Fixed** | Covered by #160. |
| Flow 7 inspector role skipped (no seed) | #191 / seed | **Fixed** | `inspector@cropcard.local` is seeded with an `inspector` assignment and lands on `/today`. |
| Flow 5 note: owner chip did not open the switcher | — | **Fixed** | With two assignments, `details.owner-chip` opens a `role=menu` with both farms. Picking "Second Farm" switches the session and reloads `/today`. |
| Flow 15 note: `/settings/records` Save disabled | — | **Fixed in this pass** (`ba1181c`) | Read-only subpages (`records`, `helpers`, `billing`, `integrations`) have no `saveAction`, so they showed Cancel plus a Save button that was always disabled. `SettingsShell` now renders no footer without a `saveAction`. Re-driven: those four pages have 0 Save buttons, and account/farm have 1 enabled. `SettingsShell.svelte.test.ts` has 3 tests. |
| Flow 17 note: no "restart setup tour" | #109 | **Fixed** | `/settings` header has "Re-walk setup tour →" linking to `/onboarding`. |

**Verdict:** ready to close. The only item left is the EPA-reg-# plugin data backfill, which is a data task outside this epic. The export already flags each missing number.
