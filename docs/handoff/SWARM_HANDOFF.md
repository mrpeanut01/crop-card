# CropCard handoff: keep the lean swarm going

Paste everything below the line into a new Claude Code session on `mrpeanut01/crop-card`. It was written on 2026-10-02 by the session that shipped Phase 32 and Phase 33. The state section is a snapshot; check GitHub before acting on any of it.

---

You are taking over CropCard (`mrpeanut01/crop-card`) from a previous Claude session. Your job is to finish the tracked follow-ups, close the open issues and close the open pull requests, using the same lean multi-agent pattern that shipped Phases 32 and 33. The owner has opted into multi-agent orchestration for this work, so you may run the Workflow tool and spawn agents.

## Read first

1. `CLAUDE.md` at the repo root. Its invariants are binding: safety rules only in `apps/web/src/lib/safety/` with a `RULES_VERSION` bump, tenant isolation through the tenant helpers and the cross-tenant test, AI only through `aiTry()`, data-only plugins, hold-fact writes through the hold guard, 48dp tap targets and no overflow at 375px, and no agronomy, animal or regulatory number without a quoted source in `apps/web/scripts/*-sources.json`.
2. `docs/design/PHASE_33_PLAN.md`, the latest plan, including its rulings tables.
3. `docs/handoff/lean-sprint.workflow.js`, the workflow script described below.
4. `docs/ci.md` for the CI shape.

## How the owner works

- Keep going without asking when the next step is clear. Ask only for decisions that are genuinely the owner's (regulatory switches, pricing, anything that changes what a farmer is told is safe).
- Times in US Eastern.
- Written output (docs, PR bodies, comments) in natural editorial prose: no em or en dashes inside sentences, no "not X, it's Y" constructions, varied sentence length.
- Secrets live only in Azure Key Vault through `./scripts/set-azure-secret.sh`. Never put a key in the repo, a commit, a log or a PR.
- Email stays opt-in except sign-in codes, invites and billing.
- Never ship an unverified safety, label or regulatory number. Stinger's grazing interval stays at 40 days (owner ruling, 2026-10-01).
- Spanish copy: the owner has a native proofreader and will send fixes. Do not track or chase Spanish proofreading yourself; just add en and es catalog keys for new strings on translated surfaces.

## The lean swarm pattern

Use one workflow run per sprint-sized chunk of work. `docs/handoff/lean-sprint.workflow.js` runs five phases:

1. **Decide.** One agent reads the plan section and the code, rules on every open design question and writes `docs/design/phase<sprint>-rulings.md` with cross-cluster contracts.
2. **Build.** One agent per cluster, in parallel, each in its own worktree `/home/user/cc-<sprint>-<k>` on branch `<branch>-<k>`.
3. **Integrate.** One agent merges the cluster branches, moves the rulings into the plan, updates the `CLAUDE.md` bullet and runs every gate.
4. **Review.** Read-only reviewers, one per lens, report confirmed findings only.
5. **Fix.** One agent fixes the findings with regression tests. A second review round runs only if a blocker was found.

Copy the script to your scratchpad and call Workflow with `scriptPath` and `args` like this:

```json
{
  "sprint": "34A",
  "plan": "docs/design/PHASE_34_PLAN.md",
  "claudeBullet": "Phase 34 bullet",
  "dir": "/home/user/cc-34a",
  "branch": "p34a",
  "base": "<commit the branch starts from>",
  "portBase": 60400,
  "coAuthor": "Co-Authored-By: <your attribution line>\nClaude-Session: <your session URL>",
  "clusters": [{ "k": "short-key", "own": "exactly what this cluster owns" }],
  "lenses": ["safety and correctness lens", "usability and regressions lens"]
}
```

Create the integration worktree yourself before the run: `git worktree add -b p34a /home/user/cc-34a origin/main`. Give each sprint its own `portBase` (steps of 100) so parallel sprints do not collide on e2e ports. Small single-purpose jobs (a CI fix, a data change, one rule switch) do not need the workflow; one Agent call in its own worktree is cheaper.

### Shipping

- Develop on the branch the session gives you. The previous session used `claude/determined-johnson-4ndty4`; yours will differ.
- `main` is protected: changes go through a pull request with the required checks, and force pushes are refused. After a squash merge the head branch is deleted, so the next push recreates it with a plain push.
- A workflow branch built on an older base can be moved onto the current `main` with a "transplant": `git checkout --detach origin/main`, `git read-tree -u --reset <sprint-branch>`, then `git diff <sprint-base> origin/main | git apply --3way` to bring back anything `main` gained since. Resolve conflicts, run the gates, commit, push and open the PR. If `main` moved a lot (for example a translation pass), hand the conflict resolution to an agent with both sides spelled out.
- Open the PR as ready for review, enable squash auto-merge, subscribe to its activity and keep a `send_later` check-in about 50 minutes out. Merging to `main` deploys automatically; the deploy succeeds only when production's `/api/health` reports the merged SHA.

### Things that bit the previous session

- **Container restarts** stop running workflows. Before resuming, commit dirty worktrees as `wip(<sprint>-<k>): checkpoint before container restart (unfinished)`, then call Workflow again with `resumeFromRunId` so finished agents replay from cache.
- **Disk.** The session has a fixed allowance. Parallel worktrees, `node_modules` and Playwright output fill it fast, and a full disk makes agents fail with "No space left on device". Remove finished worktrees (`git worktree remove --force`), delete `test-results/` and `playwright-report/`, and keep the scratchpad clean.
- **Permissions you do not have:** re-running GitHub Actions jobs and dispatching workflows both return 403. Ask the owner to click them, and say exactly which run, which branch and which inputs.
- **Load-sensitive tests.** On a busy machine a few tests time out or miss a budget and pass alone: `holdLedger.perf.test.ts` (25 ms budget, median sits near 23 ms locally), `holdGuard.test.ts` backfill, `cardSnapshot.etag.test.ts`, `i18n.spec.ts`'s route sweep (30 s for 21 routes) and `sign-out.spec.ts`. Never skip or weaken them. Prove a failure is load-only by running it alone, and fix the real cause when it shows up on CI.
- **e2e timing races.** A Playwright test that moves the page clock must first wait for the UI to show the state it depends on (see the fix in `task-timer.spec.ts`).

## State at handoff (verify on GitHub first)

Phases 32 (32A to 32G) and 33 (33A to 33D) are merged and live in production. #521 turned on the four USDA organic rules (7 CFR 205.202(b), 205.238(c)(1), 205.238(c)(7), 205.204(a)) and merged on 2026-10-02; confirm its deploy. `RULES_VERSION` is 0.7.1. `sign-out.spec.ts` timed out twice in full local e2e runs and passed alone; if it fails on CI, find the cause (the account menu click seems to land before the page is interactive) rather than re-running.

### Pull requests

| PR         | What                                         | What to do                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #498       | Dependabot: typescript 5.9 to 6.0            | Try it in a worktree. svelte-check and typescript-eslint must support it; typecheck, lint and unit tests must pass. Merge if green, otherwise close it with the reason and add a dependabot `ignore` with the same reason (the pattern already used for TypeScript 7 and jsdom 30). |
| #497       | Dependabot: @types/node 22 to 26             | Production runs Node 22. Types newer than the runtime can hide real breakage, so close it and add an `ignore` for `@types/node` versions `>=23.0.0` with that reason, unless the owner has moved the runtime.                                                                       |
| #496       | Dependabot: @testing-library/jest-dom 6 to 7 | Try it; it must work with the current vitest. Merge if green, else close with an ignore and reason.                                                                                                                                                                                 |
| #495       | Dependabot: github/codeql-action 3 to 4      | Usually safe. Check the CodeQL workflow still runs, then merge.                                                                                                                                                                                                                     |
| #494, #493 | Dependabot: eslint and @eslint/js 9 to 10    | Move them together. eslint-plugin-svelte, typescript-eslint and the repo's own `eslint-plugin-cropcard` must support ESLint 10 and lint must stay at 0 errors. Merge both if green, else close both with an ignore and reason.                                                      |

Dependabot PRs need a rebase or a fresh run after other merges; ask Dependabot with a `@dependabot rebase` comment if the branch is stale. Record any new ignore with its reason in `CLAUDE.md`'s known follow-ups, as was done for TypeScript 7 and jsdom 30.

### Issues

| Issue | What                                                                                                     | What to do                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| #509  | Spanish: make lib helpers return codes so the rest of the UI can be translated                           | Development work. Check what Spanish round 2 (#518) already did, then run it as one sprint.                           |
| #510  | Spanish: translate Phase 33 organic records, document vault and seed sourcing UI                         | Development work. #521 already translated the new organic rule lines; translate the rest of the 33A and 33B surfaces. |
| #511  | Spanish: native-speaker agricultural review, then flip `reviewed`                                        | Owned by the owner's proofreader. Leave it open and do not chase it. Apply fixes when the owner sends them.           |
| #502  | Label research follow-up: remaining animal-health products, generic pasture labels, housing-space quotes | Needs primary label sources the cloud container cannot open. Leave it for a local agent; do not invent numbers.       |

Close each issue only when its work is merged, with a short comment naming the PR.

### Tracked follow-ups (no issue yet)

1. **Visual baselines.** The 18 Linux screenshots in `apps/web/tests/e2e/visual/**` are stale. `visual.yml` with `update` ticked captures them correctly, but its push to `main` is refused because `main` requires a PR. The owner must run it with the branch input set to your working branch (not `main`). Then open the PR with the new `-linux.png` files. In the same PR, make `visual.yml` fail early with a clear message when `update` is true and the branch is `main`, and update `docs/ci.md`.
2. **Organic plugin data.** None of the 16 shipped animal-health plugins carries `organicUse`, so the automatic organic status loss from #521 only fires for farm-uploaded plugins. The eCFR research in `apps/web/scripts/nop-sources.json` has a per-plugin status under `livestock.<pluginId>` (allowed, allowed-with-annotation, not-listed, prohibited, unknown) with the quoted 205.603 or 205.604 paragraph. Wire those into each plugin's `organicUse` with the source recorded, following the 33B rulings (B-23), and keep "unknown" as needs review.
3. **i18n route sweep timeout.** `i18n.spec.ts` "main pages render in Spanish" checks 21 routes inside a 30 s test timeout and fails under full-suite load. Give it a per-test timeout that fits the route count, or split it, without dropping routes.
4. **Hold-ledger projection budget.** The perf test passes on CI but sits close to its 25 ms budget. If it starts failing, make the projection faster; do not raise the budget.
5. **Code follow-ups in `CLAUDE.md`'s known follow-ups.** Phase 33D shipped two of the Phase 30 open items (dragging a bed preset and offline record cards), so strike those. Still open there: task assignees (the columns exist since migration 0067), Start closing a task outside the spray flows, scheduled calendar suggestions offline, and the merge of the two overlapping "Where will this grow?" empty states. Write a short `docs/design/PHASE_34_PLAN.md` for these and run it through the same decide, build, integrate and review loop.

### Not doable from the cloud container

- Research tasks needing primary label PDFs (#502, and the label-research tasks in `docs/research/label-research-prompt.md`).
- Real-device testing: `docs/research/phase-33-device-results.md` lists what is untested (HEIC uploads, Safari, iPhone, Android, Firefox), plus gloved touch-and-hold drag in the garden designer.
- Anything in the owner's launch checklist in `CLAUDE.md` (Stripe, Pingram, Key Vault secrets).

## Definition of done for this handoff

- The organic-rules deploy from #521 confirmed live (`/api/health` reports its SHA).
- Every Dependabot PR either merged green or closed with a recorded ignore and reason.
- #509 and #510 shipped and closed. #511 and #502 left open with their owners noted.
- Visual baselines refreshed and `visual.yml` guarded.
- Organic plugin data wired, i18n sweep fixed.
- A short report to the owner listing what merged, what was closed and why, and what still needs a person.
