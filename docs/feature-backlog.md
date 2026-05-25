# Feature backlog — CropCard

> **Status (2026-05-25):** GitHub issue queue is empty. Phases 1–25 shipped to `main`. The prior Sprint E / D' / Phase 21 / Phase 23 / Phase 24 / UI-overhaul backlog items all closed via their referenced issues (#13, #18, #37, #38, #41–#47, #55–#59, #79–#89, #96, #97). For per-phase summaries see [CLAUDE.md](../CLAUDE.md) "Phase status"; for pre-launch operational notes see CLAUDE.md "Known follow-ups (not blocking)".
>
> This file is the working backlog. Add a row only when scoping a new sub-task; delete the row in the same PR that lands it.

## Conventions

- **Open** — work has not started.
- **In progress** — partial implementation exists on disk.
- **Ready to merge** — code is on a feature branch and only needs review.
- **Done** — shipped to `main`; close out by deleting the row.

- **P0** — blocks a normative use case or a persona's core journey; ship next.
- **P1** — documented gap with clear user impact; ship this season.
- **P2** — polish, micro-improvement, or speculative; ship when convenient.

---

## Active backlog

_None._ The GitHub issue queue is the source of truth — file an issue first, then add a row here only if it needs P0/P1/P2 prioritization against other inflight work.

---

## How to use this file

1. Pick the highest-priority **Open** item; spawn a Plan agent against the UC body in [use-cases.md](./use-cases.md) for the full spec.
2. Branch name format: `feature/B-NN-short-slug` (e.g., `feature/B-26-deterministic-inputs-planner`).
3. On merge: delete the row from this file in the same PR — keep the backlog short.
4. When scoping a feature that adds or changes a UC, edit [use-cases.md](./use-cases.md) **in the same PR** (per memory `feedback_update_ucs.md`).
5. File a GitHub issue the moment scope is deferred or debt is created (per memory `feedback_log_debt_to_gh.md`).
