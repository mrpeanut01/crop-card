# Re-verify — /crops + archetype plan/harvest screens (epic #176) — 2026-09-25

**Source audit:** `crops-and-archetypes-phase-25-verification-2026-05-25.md`
**Setup:** production build on port 5318, seeded DB, owner session.

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CA-003 AWheatPlanScreen plan-side panels | #177 (open) | **In flight** | Another agent owns this item, so it was not re-verified. |
| CA-001 /crops has no nav entry and no Almanac mockup | #178 (closed "via /inventory") | **Still broken (residual)** | The crop *catalog* moved to `/inventory?type=crop&mode=catalog`. However, `/crops` (the planting list with block/year filters, status tabs and drag-reorder) still returns 200 and has **zero inbound links** in the app. |
| CA-002 /crops/[id] uses pre-Phase-25 layout | #179 (closed "via /inventory") | **Still broken (residual)** | `/crops/<id>` is the per-planting activity page, not a catalog entry, so `/inventory` does not replace it. It still has the old layout and **no `<title>`** (`document.title` is empty for both `/crops` and `/crops/<id>`). Its only inbound link is in the legacy `/plan` tabbed editor inside the `<details>`. |
| CA-004 Grape Brix/pH/TA panel | #180 (closed) | **Fixed** | `PerennialVineQuality` captures Brix, pH and TA (packed into the lot tag until the schema lift). |
| CA-005 Tree-fruit multi-pick timeline | #181 (closed) | **Partially fixed, accepted** | "Pick N of ~M" plus the pass list. The grade table is deferred by the issue's own closure note. |
| CA-006 /hay unreachable from nav or /harvest | #182 (closed) | **Fixed** | `ForageCuttingCycle` links `/hay?block=…&planting=…`, and /harvest shows a forage banner linking to `/hay`. `/hay` returns 200. |

**Still-broken sketch (CA-001/CA-002, about 40 LOC, not changed here because it needs a product decision):**
Plan v2 (`PlanV2Shell` planting grid) now covers the planting list, and Invariant 8 routes catalog
browsing to `/inventory`. The suggested change: 308-redirect `/crops` → `/plan` in a
`+page.server.ts` loader, following the `/stock` and `/settings/plugins` precedent. Keep
`/crops/[id]` as the per-planting activity page, link it from the Plan v2 `PlantingCard`, and
give it a `<svelte:head><title>{variety} — CropCard</title>` and the Almanac Kicker/serif H1.
Alternatively, reopen #178/#179 with this scope.

**Verdict:** blocked by #177 (in flight). The /crops residual should be tracked by reopening
#178/#179 or filing a new issue.
