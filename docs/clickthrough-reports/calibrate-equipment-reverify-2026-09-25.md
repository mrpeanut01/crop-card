# Re-verify — /calibrate + /equipment (epic #215) — 2026-09-25

**Source audit:** `calibrate-equipment-flows-2026-05-25.md`
**Setup:** production build on port 5318, seeded DB (two sprayers at 20 GPA). An uncalibrated
sprayer was added with `POST /api/equipment` (201).

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-CAL-001 dropdown shows "15 GPA" for uncalibrated sprayers | #216 (closed) | **Fixed** | `/calibrate` options: `Sprayer-Clean (current: 20 GPA)`, `Sprayer-Contaminated (current: 20 GPA)`, `Uncal Boom (Uncalibrated)`. |
| CT-CAL-002 Save not blocked out of band; no server upper bound | #217 (closed) | **Fixed** | The Save and Send buttons are disabled on `gpaResult.outsideSanityBand`. Server schema is `z.number().min(0.5).max(200)`, covered by `calibration/schema.test.ts`. |
| CT-CAL-003 /spray previews hardcoded "@ 15 GPA" | #218 (**open**; fix on branch in `75b5560`) | **Fixed** | `/spray` herbicide cards read "… @ 20 GPA" for the selected sprayer. No "@ 15 GPA" appears anywhere, and the uncalibrated sprayer shows an uncalibrated hint. `herbicideRatePreview()` is covered by `dilution/ratePreview.test.ts`. The issue can be closed once `75b5560` merges. |
| CT-CAL-004 type filter split "sprayer" vs "Sprayer" | #219 (closed) | **Fixed** | `/equipment` chips: `All (3)`, `Sprayer (3)`. The loader lowercases `typeName`. |

**Verdict:** ready to close once `75b5560` (#218) merges. No open defects.
