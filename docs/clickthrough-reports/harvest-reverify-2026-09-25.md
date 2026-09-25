# Re-verify — /harvest layout + archetype renderers (epic #142) — 2026-09-25

**Source audit:** the epic links `docs/clickthrough-reports/harvest-phase-25-verification-2026-05-25.md`,
but **that file is not in the repo**, so the link is dead. This pass works from the epic body.
**Setup:** production build on port 5318, seeded DB plus extra arugula and potato plantings, owner session.

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-H-001 /harvest layout doesn't match `AHarvestScreen` | #143 (closed) | **Fixed** | Kicker "Harvest · 2026 season", H1 "Harvest." (matches the mockup's copy), and the stat line "1 ready today · 2 upcoming windows · 0 events logged YTD". The page also has the Upcoming windows panel and Export YTD. |
| CT-H-002 all 10 renderers shell-delegate | #144 (closed) | **Fixed** | Each renderer has archetype-specific fields above the fallback block. Row-grain has 4 inputs, winter-squash 4, cut-and-come-again 3, dry-seed legume 3, cover-crop 3, perennial-vine 3 (Brix/pH/TA), continuous-fruit 2 and small-grain 1 (moisture + Zadoks stage highlight). Tree-fruit shows a pick timeline, and forage links to `/hay`. The tree-fruit grade table stays deferred under #181 (closed). |
| CT-H-003 harvest events not in /records | #145 (closed) | **Fixed** | `/records` includes the `harvest` kind. Harvests recorded in this pass appear there. |
| CT-H-004 top-nav icon buttons < 48dp | #146 (closed) | **Fixed** | Measured Search 48×48, Alerts 48×48, Settings 48×48. |
| Chore: empty `renderers 2/` Finder artifact | — | **Fixed / obsolete** | The directory no longer exists. |
| (related, from #196) repeat-pick gate used legacy `harvestStyle` | #197 follow-up | **Fixed in this pass** (`0940320`) | See `harvest-stock-flows-reverify-2026-09-25.md`. |

**Observation outside this epic:** the top-nav **Search** and **Alerts** `IconButton`s have no
`href` or `onclick`, so they do nothing when tapped on any screen. Fix sketch: hide them until
search and alerts exist, or point Alerts at `/today#alerts`. About 10 LOC in `TopBar.svelte`, but
it needs a product decision, so it was not changed here.

**Verdict:** ready to close.
