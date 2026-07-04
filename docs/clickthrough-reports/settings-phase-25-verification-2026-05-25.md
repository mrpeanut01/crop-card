# Clickthrough report — Settings Phase 25 verification — 2026-05-25

**Tester:** playwright-clickthrough subagent  
**Build:** ca8cb96 (Phase 25 — Almanac UI overhaul)  
**Seed:** apps/web/scripts/seed-test-data.mjs  
**Viewport:** 390×844 (iPhone 14 Pro — CSS px)  
**Auth:** owner@cropcard.local (demo session, role=owner)  
**Spec:** docs/design/almanac/direction-almanac-settings.jsx (843 lines)

---

## Summary

- Subpages walked: 12 (10 in index grid + /settings/system legacy + /settings/api-tokens orphan)
- Spec-defined subpages: 10 (Account, Farm, Helpers, Sprayers, Plugins, Records, AI, Integrations, Billing, Advanced)
- Pass: 9 | Partial: 1 (season) | Visual-only divergence: 2 (api-tokens, system)
- New findings: P0=0, P1=2, P2=3

---

## Findings

### CT-SET-001 — /settings/season uses pre-Almanac shell [P1]

- **Route:** apps/web/src/routes/settings/season/+page.svelte
- **Expected (direction-almanac-settings.jsx ASettingsShell pattern):** Breadcrumb text "Settings · Season setup" as a kicker div (uppercase 11px), serif H1 with `class="serif"`, back ChevronRight icon-button linking to /settings, sticky Save/Cancel footer, cream background main body.
- **Observed:** Renders its own `<main class="season-page">` outside the shared `ASettingsShell`. Breadcrumb is plain text `← Settings` as an anchor with no icon. H1 is unstyled. No kicker. No sticky footer. Single call-to-action is "Save & continue" inside the form body. CSS uses bespoke `.season-page` layout, not Almanac Card/SSection primitives.
- **Console:** No errors beyond Google Fonts 404s (network isolation, not app code).
- **Network:** 200 on page load.
- **Screenshot:** ./screenshots/2026-05-25-settings-season.png
- **Recommendation:** Wrap SeasonSetupStep inside the existing `SettingsShell.svelte` (or replicate the ASettingsShell pattern from account/farm/helpers) so the breadcrumb, header, and footer are consistent with all other subpages. The underlying form logic can remain unchanged.
- **Cross-ref:** This page predates Phase 25 (#88). Phase 21a shipped it with its own ad-hoc shell; Phase 25c did not backport the Almanac shell to it.

---

### CT-SET-002 — /settings/api-tokens uses pre-Almanac shell and is not in the /settings index grid [P1]

- **Route:** apps/web/src/routes/settings/api-tokens/+page.svelte
- **Expected (direction-almanac-settings.jsx):** API tokens are not a standalone subpage in the mockup. The mockup places them as a section ("External agents") inside /settings/integrations with a link to /settings/api-tokens. The /settings index has 10 cards — API tokens is not one of them.
- **Observed:** /settings/api-tokens renders a custom `<main class="api-tokens">` with plain H1, no breadcrumb/back-button, no Almanac Card primitives, no kicker, no sticky footer. It is reachable via the "External agents" link in /settings/integrations, but the index grid does not list it. Title bar reads "API tokens — CropCard" (em-dash, inconsistent with other subpages that use "·").
- **Console:** No app errors.
- **Network:** 200 on load.
- **Screenshot:** n/a (covered by integrations flow)
- **Recommendation:** Apply the ASettingsShell wrapper (back link, kicker "Settings · Bearer tokens", serif H1, Save/Cancel footer). Alternatively, embed the mint/list UI directly into /settings/integrations per the mockup's "External agents" section, removing the orphan route. Also standardise title separator to "·".
- **Cross-ref:** Phase 24a shipped this page (#Phase 24A) before Phase 25c Almanac treatment pass.

---

### CT-SET-003 — /settings/system is a legacy orphan, not removed [P2]

- **Route:** apps/web/src/routes/settings/system/+page.svelte
- **Expected:** No /settings/system route in the Almanac mockup or /settings index. Phase 25c (#88) shipped 11 new subpages as replacements.
- **Observed:** /settings/system still exists and renders a pre-Phase-25 sidebar with emoji buttons (📊 Overview / 🖥 Display / 🤖 AI / 🌍 Location & Climate / 🏷 Types / 📦 Inventory / ⚠️ Danger Zone) plus links to /plugins and /calibrate. Not linked from the /settings index but directly addressable.
- **Console:** 8 errors (all Google Fonts 404s).
- **Network:** 200 on load.
- **Screenshot:** n/a
- **Recommendation:** Delete or redirect /settings/system to /settings. Its content is superseded by the individual Phase 25c subpages (account, ai, farm, advanced, etc.). The AI section in particular conflicts with /settings/ai.
- **Cross-ref:** Pre-Phase-25 legacy route. Not a regression — never linked from the new index.

---

### CT-SET-004 — AI spend displayed as exceeding cap with "Active" pill shown [P2]

- **Route:** apps/web/src/routes/settings/+page.svelte (index, AI feature card)
- **Expected (direction-almanac-settings.jsx ASettingsAccountScreen / index):** When monthly spend ≥ cap, the cap-fill bar correctly turns rust-red (`.over` class). The `Active` pill is expected to reflect actual API key presence, not spend level.
- **Observed:** Seed data has `spendThisMonth = $15.40` vs `monthlyCapUSD = $5`. The bar correctly shows `.over` + 100% fill in rust. However, the "Active" pill (forest green) persists alongside the "over-cap" bar with no additional warning. The AI subpage (/settings/ai) shows the same: "$15.40 spent · 0 calls" (spend from index, zero calls from AI subpage — these disagree: the index says 145 calls, AI subpage says 0 calls for the period). This is a data consistency gap in how `callsThisMonth` is scoped.
- **Console:** No errors.
- **Network:** 200.
- **Screenshot:** ./screenshots/2026-05-25-settings-index.png
- **Recommendation:** (a) When `pctUsed >= 1`, consider showing a "Cap exceeded" pill alongside or replacing "Active" to surface the over-spend clearly. (b) Reconcile `callsThisMonth` source — the index and /settings/ai subpage should read from the same counter row; likely a different time-window grouping.

---

### CT-SET-005 — Settings icon in top nav has no aria-current when on /settings [P2]

- **Route:** apps/web/src/routes/settings/+page.svelte + top-nav component
- **Expected (direction-almanac-settings.jsx ASettingsShell):** `<A_TopBar active="settings" />` — the settings icon/button should carry an active/selected visual state when the user is on any /settings route.
- **Observed:** The Settings icon link (`<a href="/settings" aria-label="Settings">`) has `aria-current=null` on /settings. The 7-item primary nav (Today/Plan/Spray/Scout/Harvest/Stock/Records) also has no `aria-current` on any of its links when on /settings, which is expected (Settings is not in that nav). But the icon button for Settings in the right-side action bar has no active state either visually or semantically.
- **Console:** No errors.
- **Network:** n/a
- **Screenshot:** ./screenshots/2026-05-25-settings-index.png
- **Recommendation:** Set `aria-current="page"` on the Settings icon link when `$page.url.pathname.startsWith('/settings')`. This is an a11y gap (P2) — screen reader users on /settings cannot confirm which nav item is active.

---

## Subpage enumeration

| Subpage | In index grid | Almanac shell | Spec-defined | Notes |
|---------|--------------|---------------|--------------|-------|
| /settings/account | Yes | Yes | Yes (#1 Account & sign-in) | Passes |
| /settings/season | Yes | **No** | n/a (added Phase 21a) | P1 — bespoke shell |
| /settings/farm | Yes | Yes | Yes (#2 Farm & blocks) | Passes |
| /settings/helpers | Yes | Yes | Yes (#3 Helpers & invites) | Passes |
| /settings/sprayers | Yes | Yes | Yes (#4 Sprayers & calibration) | Passes |
| /settings/plugins | Yes | Yes | Yes (#5 Plugins & crop library) | Passes |
| /settings/records | Yes | Yes | Yes (#6 Records & retention) | Passes |
| /settings/ai | Yes* | Yes | Yes (#7 AI assistant) | *Not in index grid as a standalone card; AI content is embedded in the index page's featured card + separate /settings/ai subpage |
| /settings/integrations | Yes | Yes | Yes (#8 Integrations) | Passes; includes "External agents" section linking to api-tokens |
| /settings/billing | Yes | Yes | Yes (#9 Plan & billing) | Passes |
| /settings/advanced | Yes | Yes | Yes (#10 Advanced & danger) | Passes |
| /settings/api-tokens | **No** | **No** | Not standalone in mockup | P1 — orphan, pre-Almanac shell |
| /settings/system | **No** | **No** | Not in mockup at all | P2 — legacy orphan, should be deleted |

**/settings index grid:** Shows 10 section cards. The mockup defines 10. Count matches. Season setup IS in the index (as a card linking to /settings/season) — it is in the grid but not in the original direction-almanac-settings.jsx because it was added in Phase 21a after the mockup was authored.

**Spec note:** direction-almanac-settings.jsx is the canonical mockup for subpage shells. direction-almanac-pages.jsx (line ~280) contains ARecordsScreen (the /records route), not a settings index screen — the settings index design source-of-truth is the index +page.svelte itself per Phase 25c commit.

## Setup guide link check (CT-OB-002 follow-up)

No "Setup guide" link exists in /settings. Correct — not yet implemented per the audit note.

## Passing subpages (structural spot-check)

All 9 passing subpages share the ASettingsShell pattern: uppercase kicker "Settings · {kicker}", serif H1, ChevronRight back-button to /settings, sticky footer with Cancel (link to /settings) and Save changes (button, disabled until dirty). No 4xx/5xx on any subpage load. No app-code console errors. All form fields use accessible labels (SField label→input association observed via a11y tree).

## Mobile / glove-operability

At 390px viewport, the /settings index section grid collapses from 2-column to 1-column (computed `grid-template-columns: 374px`). Identity hero collapses from 3-column to 2-column with identity-meta spanning full width. AI body collapses from side-by-side to stacked. All section card links are full-width, estimated tap targets >48dp. No horizontal overflow observed.
