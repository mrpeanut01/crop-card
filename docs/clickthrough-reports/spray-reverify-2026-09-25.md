# Re-verify — /spray flows (epic #124) — 2026-09-25

**Source audit:** `spray-phase-25-verification-2026-05-25.md`
**Setup:** production build on port 5318, seeded DB (two sprayers at 20 GPA plus one uncalibrated
sprayer added through the API), owner session, desktop 1280 px and mobile 390 px viewports.

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-S-001 sprayer section empty with no CTA | #125 (closed) | **Fixed** | `spray/+page.svelte` renders the empty state with "+ Add sprayer" → `/inventory/sprayer/add` when `data.sprayers.length === 0`. |
| CT-S-002 stepper hides labels ≤700 px | #126 (closed) | **Fixed** | At 390 px all 5 labels render: Block & crop · Sprayer & tank · Mix · Safety check · Confirm & record. |
| CT-S-003 insecticide missing stepper | #127 (closed) | **Fixed** | `SprayStepper` renders on `/spray/insecticide`. |
| CT-S-004 insecticide missing context strip | #128 (closed) | **Fixed** | `.cs-grid` context strip renders. |
| CT-S-005 insecticide Record enabled with IPM threshold unmet | #129 (closed) | **Fixed** | "Record application" is `disabled` on load (IPM gate). The kernel still returns 422 `IPM_THRESHOLD_NOT_MET` server-side. |
| CT-S-006 pollinator gate is a text stub | #130 (open) | **In flight** | Another agent owns this item, so it was not re-verified. |
| CT-S-007 fungicide missing stepper | #131 (closed) | **Fixed** | `SprayStepper` renders on `/spray/fungicide`. |
| CT-S-008 FRAC / rain / dew gates are text stubs | #132 (**open**; fix on branch in `53a3573`) | **Fixed** | `/spray/fungicide` renders the leaf-wet dial, rain sparkline, dry-window gate and FRAC rotation tile (`LeafWetDial`, `RainSparkline`, `DryWindowGate`, `FracRotationTile`, covered by `weatherGates.svelte.test.ts`). `canSubmit` also requires `!fracBlocked && (!rainRisk \|\| weatherAck)`. The issue can be closed once `53a3573` merges. |
| CT-S-009 fungicide missing context strip | #133 (closed) | **Fixed** | `.cs-grid` renders. |
| CT-S-010 fungicide Record enabled with no selection | #134 (closed) | **Fixed** | `canSubmit` requires a block, ≥1 product, no tank-mix block, no FRAC block and weather acknowledged. On load the page preselects the first block and product, so Record starts enabled with a valid selection. |
| (related) herbicide previews "@ 15 GPA" | #218 | **Fixed** | See `calibrate-equipment-reverify-2026-09-25.md`. |

**Verdict:** blocked by #130 (in flight). Everything else is fixed, and #132 can close once
`53a3573` merges.
