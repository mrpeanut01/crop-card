# Clickthrough report — Plugin ecosystem (/plugins, /plugins/[id], /plugins/new, /plugins/community, /settings/plugins) — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs (dev server on :5173)
**Viewport:** 390x844 (iPhone 14 Pro)
**Auth:** owner@cropcard.local (demo sign-in, role=owner)

## Summary

- Routes walked: 5 (/plugins, /plugins/corn-bloody-butcher, /plugins/new, /plugins/community, /settings/plugins)
- Pass: 4 | Fail: 0 | Blocked: 0 | Skipped: 0
- New findings: P0=0, P1=0, P2=2
- Prior findings verified resolved: CT-001 (upload no-error) from 2026-05-24-UC-08.md — RESOLVED; CT-002 (Save button overlap) from 2026-05-24-UC-08.md — RESOLVED

## Kernel-correctness audit (invariant #2)

Three upload scenarios tested against `POST /api/plugins/upload`:

| Test | Payload | HTTP status | Code | Result |
|------|---------|-------------|------|--------|
| Schema-invalid crop | `{pluginId, type:"crop"}` (missing cropFamily, harvestStyle, bloomWindow, displayName, version) | 400 | schema | PASS — field-level issues returned |
| Bypass attempt | Herbicide with `chemistryClass:"glyphosate"` claiming `safeForCropPluginIds:["corn-bloody-butcher"]` | 400 | bypass | PASS — kill-matrix message returned |
| Extra `script` field on valid payload | Valid crop + `script:"alert(\"XSS\")"` | 201 | — | PASS — Zod strips unknown fields; `script` absent from exported JSON |

Safety-rules invariant #2 holds: no executable JS stored; bypass check fires at registration; unknown fields are stripped by Zod (not stored or executed).

## Findings

### CT-PLG-001 — `[object Object]` rendering for postHarvestCuring range fields [P2]

- **UC:** UC-08 (plugin detail page)
- **Route:** `/plugins/corn-bloody-butcher` (`apps/web/src/routes/plugins/[pluginId]/+page.svelte` line 414–416)
- **Expected (per use-cases.md UC-08 / plugin detail):** Post-harvest curing metadata should display human-readable ranges for `durationWeeks` and `targetMoisturePercent`.
- **Observed:** The detail page renders "Rack cure in dry, ventilated space · [object Object] weeks · target [object Object]% moisture · store at Cool dry barn; rodent-protected bins". Both `durationWeeks` and `targetMoisturePercent` are `{min, max}` objects per `postHarvestCuringSchema`, but the template interpolates them directly as `{curing.durationWeeks} weeks` and `{curing.targetMoisturePercent}%`, producing `[object Object]`.
- **Root cause:** `postHarvestCuringSchema` (in `packages/plugin-validation/src/schemas.ts`) defines `durationWeeks: z.object({min, max})` and `targetMoisturePercent: z.object({min, max}).optional()`. The template at line 414 does `{curing.durationWeeks} weeks` instead of `{curing.durationWeeks.min}–{curing.durationWeeks.max} weeks`.
- **Console:** No JS errors (this is a template interpolation bug).
- **Network:** No errors.
- **Screenshot:** `./screenshots/plugins-detail-2026-05-25.png`
- **Recommendation:** In `+page.svelte` around line 414, change to:
  ```svelte
  {#if curing.durationWeeks != null}
    · {(curing.durationWeeks as {min:number,max:number}).min}–{(curing.durationWeeks as {min:number,max:number}).max} weeks
  {/if}
  {#if curing.targetMoisturePercent != null}
    · target {(curing.targetMoisturePercent as {min:number,max:number}).min}–{(curing.targetMoisturePercent as {min:number,max:number}).max}% moisture
  {/if}
  ```
- **Cross-ref:** No prior finding — new discovery.

### CT-PLG-002 — Search box does not filter the registered-plugin list [P2]

- **UC:** UC-08 (plugin list)
- **Route:** `/plugins`
- **Expected (per use-cases.md UC-08 / Browse spec):** Typing in the search input should let operators find plugins by name across the 691-item list.
- **Observed:** The search input (placeholder "e.g. Roundup PowerMax, Concord grape, Bordeaux mix") triggers an async API call to `POST /api/plugins/search-by-name` which finds products to import — it does NOT filter the existing registered-plugin list below it. After typing "glyphosate", all 691 plugin rows remain visible. Local matches ("Glyphosate 4 Plus" 50%, "Glyphosate 41%" 33%) appear in a separate candidate section above the list, but the list itself is not narrowed.
- **Clarification:** The category filter tabs (All/Crop/Herbicide/…) correctly filter the list client-side. Only the text search box does not filter the list.
- **Severity rationale:** P2 (not P1) — the category filter tabs provide workable navigation through the 691 items; the search being "add a product" rather than "find in list" is a discoverability issue rather than a flow-breaker. A plain-text filter on the registered-plugin list would reduce scroll time.
- **Console:** No app errors.
- **Network:** `POST /api/plugins/search-by-name` returns 200 with 2 candidates.
- **Screenshot:** `./screenshots/plugins-list-2026-05-25.png`
- **Recommendation:** Add a client-side `searchFilter` `$derived` that narrows `filtered` by `displayName.toLowerCase().includes(searchQuery.toLowerCase())` when `searchCandidates.length === 0` (i.e., when no API results are showing). This avoids the API-call path for operator browsing while preserving the AI-lookup path for new-product discovery.
- **Cross-ref:** No prior finding.

## Resolved findings from 2026-05-24-UC-08.md

### CT-001 (2026-05-24) — Upload UI shows no error feedback — RESOLVED

Previous finding: submitting an invalid plugin via the textarea+Upload button showed no UI feedback despite the server returning HTTP 400.

Current state: A `role="dialog"` modal with `role="alert"` now appears immediately after a rejected upload, showing: title ("Plugin rejected — schema validation failed" or "Plugin rejected — would override a hard-locked safety rule"), explanation prose, and a per-field issue list. The inline `<p class="error" role="alert">` also renders the first 3 issues. Both error surfaces are correct and actionable.

### CT-002 (2026-05-24) — Save button on /plugins/new covered by bottom nav — RESOLVED

Previous finding: the "Save plugin" CTA was partially obscured by the bottom navigation bar at 390px width.

Current state: At 390x844, the Save plugin button renders at y=664–712 (48px height, meets ≥48dp target). No bottom navigation bar is present. `document.elementFromPoint` at the button center returns the button itself. The P1 finding is closed.

## Walk summary per route

| Route | Verdict | Notes |
|-------|---------|-------|
| `/plugins` | PASS | 691 plugins loaded, 0 failures. Category filters correct (376/77/70/64/57/47). Search = product-add flow (not list filter — see CT-PLG-002). |
| `/plugins/corn-bloody-butcher` | PASS with P2 | Heading, version, type badge, spray windows, Raw JSON, version history all render. `[object Object]` on curing range fields (CT-PLG-001). |
| `/plugins/new` | PASS | Form-driven wizard renders after type selection. All 6 types present. Save button accessible at 48px height, not covered. JSON preview updates reactively. |
| `/plugins/community` | PASS | Static "Not yet open" stub. Confirms #234 status. |
| `/settings/plugins` | PASS | Counts match: 376 crops / 77 herbicides / 70 insecticides / 64 fungicides / 57 fertilizers / 47 companions. |

## Upload kernel-correctness verdict

**PASS.** The plugins-are-data-only invariant holds end-to-end:
1. Schema-invalid plugins are rejected at the server with structured error + per-field issues (HTTP 400).
2. Bypass attempts (herbicide claiming corn-safe with a corn-lethal chemistry class) are rejected at the registration probe with the kill-matrix message.
3. Unknown fields (including string-valued `script` fields) are stripped by Zod before persistence — confirmed by fetching the exported JSON and observing the field absent.
4. The UI surfaces rejection via a `role="dialog"` modal with `role="alert"`, matching the UC-08 "rejection with structured error" success criterion.

## Performance

`GET /plugins` (server-side render, 691 plugins): 252ms, 963KB HTML. No pagination required; all 691 plugins render in a single pass. Acceptable for dev mode; production build will be smaller.

## Phase 25c.0 discriminator coverage

All 376 crop plugin files carry `harvestStyle` and `bloomWindow` (100% coverage). Registry loads all 376 without failures.
