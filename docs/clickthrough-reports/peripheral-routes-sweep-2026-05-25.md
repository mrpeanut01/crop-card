# Peripheral Routes Triage Sweep — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Server:** http://localhost:5173 (dev, owner demo session)
**Auth:** owner@cropcard.local (demo)
**Viewport:** default browser (1280-wide; not mobile — this is a triage pass)

---

## Route 1 — `/map`

**Status: DEPRECATED (redirect in place)**
**HTTP:** 307 → `/plan?tab=layout`
**Nav link:** None — not in primary nav or settings.
**Implementation:** `routes/map/+page.server.ts` — documented redirect added in Phase 13 when the polygon editor was absorbed into `/plan`. Comment says "Old bookmarks redirect."
**Verdict:** Redirect is clean; the source file can be deleted if no external bookmark traffic is expected. No functional gap.
**Screenshot:** `screenshots/2026-05-25-map.png`
**Recommendation: Delete** the `/map` route folder. No user-facing entry point remains; the redirect comment confirms the absorption is final.

---

## Route 2 — `/calendar`

**Status: DEPRECATED (redirect in place, intentional)**
**HTTP:** 302 → `/plan?tab=calendar` (passes through view/filter query params)
**Nav link:** None — not in primary nav.
**Implementation:** `routes/calendar/+page.server.ts` — deliberately designed as a "Phase 1" redirect pending a future focused `/calendar` route (references GH #54 for layout polish). Query params pass through correctly.
**Verdict:** Redirect is clean and well-commented. GH #54 is the outstanding issue for converting this to a standalone focused view.
**Screenshot:** `screenshots/2026-05-25-calendar.png`
**Recommendation: Keep** as a redirect for now; the GH #54 issue tracks the split. The route folder is intentional placeholder infrastructure, not dead code.

---

## Route 3 — `/fertility`

**Status: ALIVE (standalone, functional)**
**HTTP:** 200 — renders directly, no redirect.
**Nav link:** Not in primary nav. Linked from `/crops/[id]` via a deep-link `+ Record` anchor. Also consumed by `/api/plan/inputs` server endpoints.
**Visual treatment:** Pre-Phase-25 styling (plain HTML table, no Almanac card shell, no Provenance tags). Functional: block/year selector loads real data, history list shows a seeded entry (5/8/2026 — 10-10-10), three collapsible entry forms are present.
**Overlap with Phase 21b:** The Inputs Plan wizard (step 5) aggregates fertility data from the same DB layer. The `/fertility` page is the *data entry* surface; the wizard is *consumption*. These are complementary, not duplicative.
**Screenshot:** `screenshots/2026-05-25-fertility.png`
**Recommendation: Keep** — it is the only dedicated fertility ledger UI. Add a nav entry under Settings or a secondary link from /plan to make it discoverable. Phase-25 visual treatment is a follow-up P2.

---

## Route 4 — `/insecticides`

**Status: DEPRECATED (redirect in place)**
**HTTP:** 308 → `/spray/insecticide` (preserves query params for block=, crop=, task= deep links)
**Nav link:** None — removed in Phase 25b nav collapse.
**Implementation:** `routes/insecticides/+page.server.ts` — one-liner redirect, comment says "folded into /spray/insecticide as part of the 13→7 nav collapse."
**Verdict:** Redirect is correct and permanent (308). No duplicate content.
**Screenshot:** `screenshots/2026-05-25-insecticides.png`
**Recommendation: Delete** the `/insecticides` route folder. The 308 is a correct HTTP mechanism but keeping empty SvelteKit route folders adds confusion. If external deep-links must survive, a server-level rewrite in nginx/Caddy is more appropriate than a SvelteKit route.

---

## Route 5 — `/tools/planter-plate-selector`

**Status: ALIVE (functional)**
**HTTP:** 200 — renders, filters work, returns results.
**Nav link:** Not in primary nav. Linked from `/stock/[id]` seed-lot detail card ("Find plate" / "Change plate" buttons). `/tools/+page.svelte` is the parent index.
**Setting gate:** `display_planter_setup` in `/settings/system` controls visibility of the card on `/stock/[id]`; the tool route itself is always accessible by URL.
**Visual treatment:** Almanac-adjacent (uses shared header/footer, clean layout). Functional: selecting "Corn" and clicking "Find plates" returns 20 Lincoln Ag plates. "Print results" button enables correctly after results load.
**Note:** The `Find plates` button stays disabled until a seed type is selected — correct behavior. Accessing via direct URL without a stockId param works (no crash); the "Save to lot" affordance just has no target.
**Screenshot:** `screenshots/2026-05-25-planter-plate.png`
**Recommendation: Keep** — fully functional specialist tool with a clear entry point from stock detail. No changes needed.

---

## Summary

| Route | HTTP | Verdict | Action |
|---|---|---|---|
| `/map` | 307 redirect | Deprecated | Delete route folder |
| `/calendar` | 302 redirect | Intentional placeholder | Keep — GH #54 tracks split |
| `/fertility` | 200 | Alive, under-linked | Keep; add nav entry |
| `/insecticides` | 308 redirect | Deprecated | Delete route folder |
| `/tools/planter-plate-selector` | 200 | Alive, functional | Keep |

**No P0/P1 issues found.** The two route folders (`/map`, `/insecticides`) are safe to delete — their redirects have been stable since Phase 13 and Phase 25b respectively, and both destinations are the canonical live pages. `/fertility` is the only route that warrants a discoverability improvement.
