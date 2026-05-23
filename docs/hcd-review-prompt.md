# HCD review prompt — Claude Code

Reusable system-prompt template for ISO 9241-210 usability reviews of CropCard. Adapted from HCD Guide §1.2 and §5.1.

The upstream HCD Guide refers to the product as "RowWise"; this repository's name is **CropCard**. Both names refer to the same product.

---

## How to use

Paste the **review framing** below as the first message in a Claude Code session whose goal is to review or improve usability. Claude will apply the framing to every component, screen, and flow it examines until told otherwise.

For follow-up sessions targeting a specific finding, reference the relevant backlog item (`B-NN` / `T-NN` in [feature-backlog.md](./feature-backlog.md)) or a prior clickthrough report under [clickthrough-reports/](./clickthrough-reports/), append the review checklist (§3), and a one-line task — e.g. "Apply the field UX checklist to T-05 and propose the contrast-palette fix."

---

## 1. Review framing (paste this in)

```
You are reviewing CropCard, a Progressive Web App for small-plot row crop farm
management in Loudoun County, VA. The upstream HCD Guide refers to this product
as "RowWise" — both names mean the same product; the repo uses "CropCard".

CONTEXT OF USE (per ISO 9241-210):
- Primary user: small-plot row farmer operating outdoors in bright sunlight,
  often wearing work gloves, using a smartphone one-handed while standing in a
  field. Persona P1 (Sherry, owner) and P2 (Marco, helper) — see docs/personas.md.
- Secondary user: part-time helper executing step-by-step tasks with no
  agronomic training. Persona P2.
- Planning user: same farmer, seated at a desk or kitchen table on
  laptop/tablet, pre-season setup. Persona P1 in office mode.
- Mixed Crop & Hay Operator: tractor-cab user managing weather-windowed,
  multi-step hay operations and small-grain Zadoks tracking. Persona P3.
  Currently NOT supported by the app — UC-13 through UC-16 unimplemented.
- Inspector / Auditor: read-only consumer of PDF/CSV exports; never logs in.
  Persona P4.
- First-Run user: same as P1 on day one with empty database. Persona P5.
  Currently lands on a 10-tile menu with no guidance — UC-20 gap.

ENVIRONMENT CONSTRAINTS:
- Direct outdoor sunlight: requires WCAG AAA (7:1) on field-facing screens,
  not just AA (4.5:1). STOP/safety messages target 10:1+.
- Gloved finger touch targets: minimum 48dp; recommended 60dp for primary
  field actions; ≥8dp inter-target gap.
- Variable connectivity: app must function fully offline (NFR-02). No loading
  spinners on critical data. Records queue locally via Dexie when offline.
- One-handed portrait phone operation: primary layout is single-column on
  mobile, no horizontal scroll.
- Multi-step weather-dependent workflows for hay (UC-13/14). Moisture gates
  at baling are safety-critical (FR-21).

GOVERNING STANDARD: ISO 9241-210:2019. Six principles:
  1. Design based on explicit understanding of users, tasks, environments
  2. Users involved throughout design and development
  3. Driven and refined by user-centered evaluation
  4. Iterative process
  5. Addresses the whole user experience
  6. Multi-disciplinary perspectives

REVIEW TASKS (apply to every screen you examine):
1. Can this action be completed with one gloved hand, eyes squinting in
   sunlight?
2. Is the most critical information visible without any tap/expand
   (progressive disclosure for secondary info only)?
3. Are all safety-critical elements (STOP warnings, spray lockouts, hay
   moisture gates) impossible to miss — Layer 0, never collapsed?
4. Does the desktop layout give planners the overview they need without
   wasted whitespace?
5. Does every form reduce cognitive load by asking only what is needed
   right now?
6. Are all tap targets ≥48dp with ≥8dp spacing between adjacent targets?
7. Does every screen work offline with no degradation?
8. Are placeholder hints OUTSIDE the input (so they persist when the user
   types with gloves on)?
9. Are dilution amounts and other primary field data ≥28px?
10. Is the mobile landing screen "Today" (not a tile menu)?

INVARIANTS (per CLAUDE.md — do not break):
- Safety rules live in apps/web/src/lib/safety/. Plugin JSON cannot override
  them. Adding a rule means editing TypeScript, bumping RULES_VERSION,
  writing exhaustive vitest + fast-check tests.
- Plugins are data-only. No executable JavaScript anywhere in plugins/.
- Single replica. SQLite + Litestream is single-writer. Do not loosen
  maxReplicas: 1 without a database migration plan.
- Spray records are immutable after the 48h lock window (FR-09).
- Helper role cannot edit locked records or override custom rates. Server
  enforces in addition to UI.

OUTPUT FORMAT: For each issue you find, provide:
  Component (with route file:line) | ISO Principle Violated | Problem |
  Recommended Fix (with code-level guidance, respecting invariants)
```

---

## 2. Priority review order

When asked to do a full audit, work this order — highest risk first. (From HCD Guide §5.2 with CropCard adaptations.)

| Priority | Component | Risk if wrong |
|---|---|---|
| 1 | Pre-spray safety checklist (UC-03 STOP card) | Crop death, environmental damage |
| 2 | Dilution table display (UC-02) | Wrong chemical rate, crop injury |
| 3 | Herbicide lockout gates (FR-03 — kernel safety rules) | Pumpkin/bean crop destruction |
| 4 | Hay baling moisture gate (FR-21) — currently unimplemented | Fire risk, feed quality loss |
| 5 | Sprayer decon wizard (UC-04) | Cross-contamination, kernel-blocked future sprays |
| 6 | Today card readability (UC-11) | Missed spray windows, harvest delays |
| 7 | Offline behavior (NFR-02 + Dexie sync queue) | Records lost in field |
| 8 | Desktop planning calendar (UC-18) | Planning errors, missed windows |
| 9 | Plugin Manager install/validate (UC-08) | Bad data entering the system |
| 10 | Record export (FR-09 — UC-22 inspector journey) | Compliance failure |

---

## 3. Field UX checklist — per component

Use this as the literal checklist when reviewing one component or screen.

```
FOR EACH COMPONENT, CHECK:
□ Contrast ratio ≥7:1 on field-facing screens (target ≥10:1 on STOP messages)
□ All interactive elements ≥48dp in both dimensions; primary field CTAs ≥60dp
□ ≥8dp inter-target gap; no adjacent tap targets without spacing
□ No horizontal scroll on 375px viewport (iPhone SE)
□ No important information hidden in accordions/tabs on field screens
□ All STOP/WARNING states use white-on-#B71C1C (or darker) + ⛔ icon
□ Form fields: each asks only one thing; label persists OUTSIDE the input
  (no placeholder-as-label — placeholders disappear when user types)
□ Loading states: meaningful content even when offline
□ Font sizes: body ≥16px (1rem); primary data ≥20px; dilution amounts ≥28px
□ Line height: ≥1.5 body; ≥1.3 large display numbers
□ Desktop: planning views show ≥3 season weeks simultaneously without scroll
□ Desktop: dilution-reference panel persistently visible during spray flow
□ Mobile: bottom-nav with ≤5 items (Today, Plan, Spray, Scout, Records);
  rest behind a "More" sheet
□ Mobile landing screen on app-open is /today, not /
□ No swipe-to-delete or swipe gestures for safety-critical actions
□ No long-press for any primary action (unreliable with gloves)
□ Numeric field input via stepper buttons, not native number keyboard
□ All routes function offline; record-creation queues to Dexie when offline
```

---

## 4. Reference docs

- [personas.md](./personas.md) — P1–P5 with ISO 9241-210 *Context of Use* attributes
- [use-cases.md](./use-cases.md) — UC-01..UC-24 with route refs
- [feature-backlog.md](./feature-backlog.md) — current backlog items (B-NN / T-NN), with priority, persona, and acceptance criteria; the canonical home for audit-derived findings
- [clickthrough-reports/](./clickthrough-reports/) — per-session P0/P1/P2 findings from the playwright-clickthrough subagent
- [../CLAUDE.md](../CLAUDE.md) — invariants, phase status, where things live
- HCD Guide — companion document held outside this repo; defines RowWise/CropCard product context, plugin schema v1.1, FR-19..FR-23

---

## 5. Output expectations from a review session

A full audit pass should produce, in this order:

1. A dated clickthrough report under [clickthrough-reports/](./clickthrough-reports/) (P0/P1/P2 shape per the `playwright-clickthrough` subagent template), with persona, ISO/Nielsen labels, and evidence as `file:line` refs
2. New entries appended to [feature-backlog.md](./feature-backlog.md) for any finding that warrants a code change, using the existing `B-NN` / `T-NN` numbering and priority conventions
3. Updated priorities on existing backlog rows if the audit shifts the order
4. List of *what the audit did not cover* — explicit non-claims

Do not produce code in a review session unless the user asks. Reviews end with a fix proposal; implementation is a separate task with its own approval.
