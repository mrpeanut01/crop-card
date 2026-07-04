# Clickthrough report — Sprint 2 records unification — 2026-05-26

**Tester:** playwright-clickthrough subagent
**Build:** ef37d62 (branch: sprint-2-records-unification)
**Seed:** apps/web/scripts/seed-test-data.mjs (dev DB, port 5173)
**Viewport:** 390x844 (iPhone 14 Pro)
**Auth:** owner@cropcard.local (demo form action `/?/demo role=owner`)

## Summary

- UCs walked: records ledger + drill-down + legacy regression sanity
- Pass: all primary checks
- Fail: 0
- Blocked: 0

### Original findings (previous run, now re-verified)

- CT-001 [P0] `/records` blank due to server-only import — **CLOSED**
- CT-002 [P2] "By" column showed email local-part only — **CLOSED**
- CT-003 [P2] 7-column table not horizontally scrollable at 390px — **CLOSED**

New findings from re-verification: **P0=0, P1=0, P2=1 (pre-existing, not sprint-2)**

---

## Findings

### CT-001 — `/records` and `/records/[kind]/[id]` rendered blank [P0] — CLOSED

- **UC:** Sprint 2 / records ledger, drill-down
- **Route:** `apps/web/src/routes/records/+page.svelte`, `apps/web/src/routes/records/[kind]/[id]/+page.svelte`
- **Root cause:** Both `+page.svelte` files imported constants directly from `$lib/db/recordsUnified`, which pulled `$lib/server/superadmin` transitively into the client bundle. Vite emitted a 500 on the generated client node chunk.
- **Fix applied:** New file `apps/web/src/lib/db/recordKinds.ts` holds the pure constants (`RECORD_KINDS`, `RecordKind`, `KIND_TONE`, `KIND_LABEL`, `LOCK_WINDOW_MS`). Both Svelte components now import from `$lib/db/recordKinds`. `recordsUnified.ts` re-exports from `recordKinds` for back-compat.
- **Re-verification (2026-05-26 PM):** `/records` loads with page title "Records · CropCard". Stats line reads "18 records · 2 locked · 18 this year. Retained through Jun 28, 2028." All 8 kind chips rendered. Ledger table populated with 18 rows. Drill-down `/records/spray/1479fc80-71ca-45ce-9c19-1bd133c09f31` renders "Spray record · CropCard" with full detail fields. No Vite HMR overlay, no app console errors. **Closed.**

---

### CT-002 — "By" column showed email local-part only [P2] — CLOSED

- **UC:** Sprint 2 / records ledger
- **Route:** `apps/web/src/lib/db/recordsUnified.ts` (`resolvePerformers`)
- **Root cause:** `resolvePerformers` returned `r.email.split('@')[0]` — showing only the local part (e.g. `owner` instead of `owner@cropcard.local`).
- **Fix applied:** `resolvePerformers` now returns `r.email` (full address).
- **Re-verification (2026-05-26 PM):** Spray row (2026-05-25 14:29) "By" cell shows `owner@cropcard.local`. Fertility row (2026-05-08) shows `shawn@safehaven.farm`. Planting rows (no performer ID in seed) correctly show "—". Full emails confirmed in both the list view and the drill-down "Performed by" field. **Closed.**

---

### CT-003 — 7-column ledger table clipped at 390px viewport [P2] — CLOSED

- **UC:** Sprint 2 / records ledger
- **Route:** `apps/web/src/routes/records/+page.svelte`
- **Root cause:** The `<table>` had no horizontal scroll container; at 390px the 7 columns overflowed and were clipped.
- **Fix applied:** Table wrapped in `<div class="ledger-scroll">` with CSS `overflow-x: auto`.
- **Re-verification (2026-05-26 PM):** `document.querySelector('.ledger-scroll')` found; computed `overflow-x: auto`; `scrollWidth 807px > clientWidth 372px` — wrapper is scrollable. **Closed.**

---

### CT-004 — Hydration warning on `/settings/account` in Icon.svelte [P2] — PRE-EXISTING (not sprint-2)

- **UC:** settings/account (regression sanity)
- **Route:** `apps/web/src/lib/components/settings/SettingsSection.svelte` → `Icon.svelte` → `lock.svelte`
- **Expected:** No hydration warnings.
- **Observed:** `[WARNING] Failed to hydrate: TypeError: element2.getAttribute is not a function` in `Icon.svelte → lock.svelte → SettingsSection.svelte → SettingsShell.svelte`.
- **Console:** present on `/settings/account` only; not present on `/settings/farm`.
- **Network:** No 4xx/5xx on the page.
- **Root cause attribution:** `SettingsSection.svelte` last touched in Phase 25 (commit ca8cb96), not in sprint-2 (ef37d62). This warning predates sprint-2. The page content renders correctly (Profile, sign-in security, active sessions all visible via `document.querySelector('main').textContent`).
- **Recommendation:** Investigate lucide-svelte `<Lock>` icon SSR/hydration mismatch in `SettingsSection` right-slot. Likely a Svelte 5 `$props()` + SSR attribute binding edge-case. Not blocking but should be fixed before launch — the `aria` attributes on the icon may not bind correctly in SSR → hydration transition.
- **Cross-ref:** Pre-existing from Phase 25 Almanac overhaul; not introduced by sprint-2.

---

## Legacy regression sanity results

| Check | Status | Notes |
|-------|--------|-------|
| USDA / NRCS CSV export (`/api/spray/records/export.usda.csv`) | Pass | HTTP 200, download triggered |
| VDACS audit PDF (`/api/records/export.vdacs.pdf`) | Pass | HTTP 200 |
| Spray CSV export (`/api/spray/records/export.csv`) | Pass | HTTP 200 |
| `/settings/account` renders | Pass | Content visible; CT-004 hydration warning is pre-existing |
| `/settings/farm` renders | Pass | Farm details + blocks list, no warnings |

---

## Re-verification section — 2026-05-26 PM

**Build at re-verification:** ef37d62 (branch: sprint-2-records-unification, HEAD adds `apps/web/src/lib/db/recordKinds.ts`)

**Findings closed:** CT-001, CT-002, CT-003
**New findings:** CT-004 (P2, pre-existing from Phase 25, not sprint-2)

All three P0/P2 fixes verified working in the live dev server. Records ledger loads, drill-downs render, full emails shown, table scrollable. Legacy regression sanity (exports, settings) passes cleanly.
