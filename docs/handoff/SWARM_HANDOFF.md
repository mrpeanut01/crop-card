# CropCard handoff: keep the lean swarm going

Paste everything below the line into a new Claude Code session on `mrpeanut01/crop-card`. It was first written on 2026-10-02 by the session that shipped Phases 32 and 33, and refreshed the same evening by the session that shipped Phase 34. The state section is a snapshot; check GitHub before acting on any of it.

---

You are taking over CropCard (`mrpeanut01/crop-card`) from a previous Claude session. Your job is to finish the tracked follow-ups, close the open issues and close the open pull requests, using the same lean multi-agent pattern that shipped Phases 32 and 33. The owner has opted into multi-agent orchestration for this work, so you may run the Workflow tool and spawn agents.

## Read first

1. `CLAUDE.md` at the repo root. Its invariants are binding: safety rules only in `apps/web/src/lib/safety/` with a `RULES_VERSION` bump, tenant isolation through the tenant helpers and the cross-tenant test, AI only through `aiTry()`, data-only plugins, hold-fact writes through the hold guard, 48dp tap targets and no overflow at 375px, and no agronomy, animal or regulatory number without a quoted source in `apps/web/scripts/*-sources.json`.
2. `docs/design/PHASE_34_PLAN.md`, the latest plan, including its rulings tables (the Phase 32 and 33 plans hold older rulings that still bind).
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
  "sprint": "35A",
  "plan": "docs/design/PHASE_35_PLAN.md",
  "claudeBullet": "Phase 35 bullet",
  "dir": "/home/user/cc-35a",
  "branch": "p35a",
  "base": "<commit the branch starts from>",
  "portBase": 60400,
  "coAuthor": "Co-Authored-By: <your attribution line>\nClaude-Session: <your session URL>",
  "clusters": [{ "k": "short-key", "own": "exactly what this cluster owns" }],
  "lenses": ["safety and correctness lens", "usability and regressions lens"]
}
```

Create the integration worktree yourself before the run: `git worktree add -b p35a /home/user/cc-35a origin/main`, then `pnpm install --frozen-lockfile` in it. Give each sprint its own `portBase` (steps of 100) so parallel sprints do not collide on e2e ports. Small single-purpose jobs (a CI fix, a data change, one rule switch) do not need the workflow; one Agent call in its own worktree is cheaper.

### Shipping

- Develop on the branch the session gives you. The previous session used `claude/determined-johnson-4ndty4`; yours will differ.
- `main` is protected: changes go through a pull request with the required checks, and force pushes are refused. After a squash merge the head branch is deleted, so the next push recreates it with a plain push.
- A workflow branch built on an older base has to be moved onto the current `main` before its PR. `git diff | git apply` fails on binary files such as the visual baselines, so move it file by file instead: `git checkout --detach origin/main`, `git read-tree -u --reset <sprint-branch>`, then for every file only `main` changed since the sprint base take `main`'s copy (`git checkout origin/main -- <file>`, or `git rm` if `main` deleted it), and for every file both sides changed run `git merge-file <file> <base copy> <main copy>`. Resolve what conflicts, watch for the same catalog key added twice (`catalogs.parts.test.ts` catches it), run every gate on the new base, then commit with `origin/main` as the parent. Two sprints built side by side go in one at a time: the second moves onto `main` after the first merges.
- The session can push only to its own branch, so PRs go out one at a time from it. After a squash merge the remote branch is deleted and the local tracking ref goes stale; `git fetch --prune` before the next plain push.
- Open the PR as ready for review, enable squash auto-merge, subscribe to its activity and keep a `send_later` check-in about 50 minutes out. Merging to `main` deploys automatically; the deploy succeeds only when production's `/api/health` reports the merged SHA.

### Things that bit the previous session

- **Container restarts** stop running workflows. Before resuming, commit dirty worktrees as `wip(<sprint>-<k>): checkpoint before container restart (unfinished)`, then call Workflow again with `resumeFromRunId` so finished agents replay from cache.
- **Disk.** The session has a fixed allowance. Parallel worktrees, `node_modules` and Playwright output fill it fast, and a full disk makes agents fail with "No space left on device". Remove finished worktrees (`git worktree remove --force`), delete `test-results/` and `playwright-report/`, and keep the scratchpad clean.
- **Permissions you do not have:** re-running GitHub Actions jobs and dispatching workflows both return 403. Ask the owner to click them, and say exactly which run, which branch and which inputs.
- **Bot pushes start no CI.** A commit pushed by a workflow with `GITHUB_TOKEN` (the `visual.yml` baseline commit) runs no checks, so its PR sits with no required checks. Push one ordinary commit on top; merging `main` into the branch is enough.
- **Outbound network.** Policy blocks DailyMed, EPA PPLS, eCFR and the FDA sites from the container, so label and regulatory research stays with a local agent.
- **Background waits.** A shell loop that waits with `pgrep -f "<pattern>"` matches its own command line and never exits. Chain the steps in one command instead.
- **Load-sensitive tests.** On a busy machine a few tests time out or miss a budget and pass alone: `holdLedger.perf.test.ts` (25 ms budget, median sits near 23 ms locally), `cardSnapshot.etag.test.ts` and `animal-health.spec.ts`. Since #585 every test file runs on its own clone of the migrated test database (`tests/globalSetup.ts`, `tests/vitestSetup.ts`, `tests/testDb.ts`), so files no longer see each other's rows or wait on each other's write locks; a test that needs the shared plugin library loads it in a `beforeAll` rather than paying for it inside whichever test touches it first. The `i18n.spec.ts` sweep timeout and the `sign-out.spec.ts` hydration race were fixed on 2026-10-02. Never skip or weaken them. Prove a failure is load-only by running it alone, and fix the real cause when it shows up on CI.
- **e2e timing races.** A Playwright test that moves the page clock must first wait for the UI to show the state it depends on (see the fix in `task-timer.spec.ts`).

## State at handoff (verify on GitHub first)

Phases 32 (32A to 32G), 33 (33A to 33D) and 34 (34A and 34B) are merged and live in production. `RULES_VERSION` is 0.7.1. The four USDA organic rules are on (#521), and six animal-health plugins carry `organicUse` from the eCFR research (34A). Dependabot is clear: TypeScript 6, jest-dom 7, CodeQL v4 and ESLint 10 are in, and `@types/node` 23 and later is ignored while production runs Node 22. The Linux visual baselines were re-captured on 2026-10-02, and `visual.yml` refuses `update` against `main`.

### Open issues

| Issue | What                                                                                                     | What to do                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| #511  | Spanish: native-speaker agricultural review, then flip `reviewed`                                        | Owned by the owner's proofreader. Leave it open and apply fixes when the owner sends them.                 |
| #502  | Label research follow-up: remaining animal-health products, generic pasture labels, housing-space quotes | Needs primary label sources the container cannot reach. Leave it for a local agent; do not invent numbers. |

### Candidate next work (the owner picks)

None of these has an issue yet. Each comes from `CLAUDE.md`'s known follow-ups, and each needs a short plan run through the loop above.

1. **Multi-block seed split.** The layout engine still places one seed lot inside a single block; seed bigger than every picked block places what fits and reports the rest (`planFieldLayout`).
2. **PDF and export rendering off the event loop.** The capacity review names this as the next lever after watching the `[perf]` log.
3. **Same-record races across devices.** The offline queue is last-write-wins on the server, with no detection when two devices edit the same spray.
4. **AllocationWizard AI paths in e2e.** The AI chat send, "Apply anyway" and partial-failure commit paths have component tests only.

### Not doable from the cloud container

- Research tasks needing primary label PDFs (#502, and the label-research tasks in `docs/research/label-research-prompt.md`).
- Real-device testing: `docs/research/phase-33-device-results.md` lists what is untested (HEIC uploads, Safari, iPhone, Android, Firefox), plus gloved touch-and-hold drag in the garden designer.
- Anything in the owner's launch checklist in `CLAUDE.md` (Stripe, Pingram, Key Vault secrets).

## Definition of done

Whatever the owner asks for, merged and live (`/api/health` reports the merged SHA), with a short report saying what merged, what was closed and why, and what still needs a person.
