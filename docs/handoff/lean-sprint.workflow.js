export const meta = {
  name: "lean-sprint",
  description:
    "Lean sprint: one decider, cluster builds, integrate + gates, review round(s) + fix",
  phases: [
    { title: "Decide" },
    { title: "Build" },
    { title: "Integrate" },
    { title: "Review" },
    { title: "Fix" },
  ],
};
// args: { sprint, plan, claudeBullet, dir, branch, base, portBase, coAuthor,
//         clusters: [{ k, own }], lenses: [string] }
// See docs/handoff/SWARM_HANDOFF.md for how to set up `dir`/`branch` first.
const PLAN = args.plan;
const S = args.sprint,
  INT = args.dir,
  BR = args.branch,
  CL = args.clusters,
  P = args.portBase;
const CO = args.coAuthor;
const RULES = `Never push. Never touch other worktrees under /home/user except the ones named here. End commit messages with:\n${CO}\nWatch the .gitignore trap (git add -f new files under build/ or data/ paths). Follow CLAUDE.md invariants: tenant helpers + cross-tenant test for new tenant data; aiTry for AI; 48dp targets; no 375px overflow; provenance tags; hold-fact writes through the hold guard; i18n catalog keys (en + es) for user-facing strings on surfaces that are already translated; no unsourced agronomy, animal or regulatory numbers (a value needs an entry in the matching apps/web/scripts/*-sources.json quoting a primary or extension source; leave it empty with an honest "not known" UI rather than guess). Plain natural English copy, no em dashes. Keep disk free: delete test-results/ and playwright-report/ after e2e runs and check df -h /.
Spec: ${PLAN} section "${S}". Rulings: docs/design/phase${S.toLowerCase()}-rulings.md (binding).
e2e: CI=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome E2E_PORT=<port> E2E_MAGIC_PORT=<port+1> pnpm --filter @cropcard/web exec playwright test [spec]; wait for networkidle after navigation. Long commands (pnpm test:unit takes ~10 min) go through nohup to a log file that you poll, because a single tool call times out at 10 min.`;
phase("Decide");
await agent(
  `${RULES}\n\nIn ${INT} (branch ${BR}) read the "${S}" section of ${PLAN} and the code it touches. List every open design question a builder would otherwise guess, and rule on each yourself as a careful, safety-minded, farmer-usability-minded engineer (smallest correct design that fits existing patterns; never mislead a farmer; sourced data only). Write docs/design/phase${S.toLowerCase()}-rulings.md as a table (id, question, ruling, reason) plus a section assigning cross-cluster contracts (shared types/signatures and which cluster owns them) for clusters: ${CL.map((c) => c.k + ": " + c.own).join("; ")}. Commit.`,
  { label: "decide", phase: "Decide" },
);
const builds = await parallel(
  CL.map(
    (c, i) => () =>
      agent(
        `${RULES}\n\nBuild cluster ${c.k}: ${c.own}.\nSetup: cd ${INT} && git worktree add -b ${BR}-${c.k} /home/user/cc-${S.toLowerCase()}-${c.k} ${BR} && cd /home/user/cc-${S.toLowerCase()}-${c.k} && pnpm install --frozen-lockfile. Work only there. Implement fully with unit tests and at least one e2e spec per user-visible flow (port ${P + i * 100}). Migrations: number after the highest in apps/web/drizzle and say so. Run web unit tests, check (0/0), lint, your e2e specs plus existing specs in your area. Commit on ${BR}-${c.k}. Return: what was built, rulings deviated from, shared files touched, migrations, test results, anything left undone.`,
        { label: `build:${c.k}`, phase: "Build" },
      ),
  ),
);
phase("Integrate");
const integ = await agent(
  `${RULES}\n\nIn ${INT} (branch ${BR}) merge ${CL.map((c) => BR + "-" + c.k).join(", ")} (git merge --no-ff each; a cluster that reported BLOCKED may still have commits, so check its branch log before skipping it). Resolve conflicts keeping both behaviours; renumber migrations and fix journal/snapshots; regenerate gen:tables, OpenAPI, gen:schemas. Add a "${S} rulings" table to ${PLAN} from docs/design/phase${S.toLowerCase()}-rulings.md (then delete that file). Update CLAUDE.md's ${args.claudeBullet} with a concise ${S} paragraph and mark ${S} ✓. Run every gate: root pnpm test:unit, check 0/0, lint, full e2e (ports ${P + 900}/${P + 901}). Fix red at the root. Commit. Cluster reports:\n${JSON.stringify(builds.map((b, i) => ({ k: CL[i].k, r: String(b).slice(0, 2500) })))}\nReturn gate counts and merge notes.`,
  { label: "integrate", phase: "Integrate" },
);
const F = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          scenario: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["title", "severity", "scenario", "evidence"],
      },
    },
  },
  required: ["findings"],
};
const seen = [];
for (let round = 1; round <= 2; round++) {
  phase("Review");
  const found = (
    await parallel(
      args.lenses.map(
        (l, i) => () =>
          agent(
            `${RULES}\nREAD-ONLY (no edits or commits in ${INT}; scratch in /tmp ok). Review branch ${BR} (diff vs ${args.base}) round ${round}. Lens: ${l}. Only confirmed problems. Skip: ${JSON.stringify(seen)}`,
            { label: `r${round}:${i}`, phase: "Review", schema: F },
          ),
      ),
    )
  )
    .filter(Boolean)
    .flatMap((r) => r.findings);
  seen.push(...found.map((f) => f.title));
  log(
    `round ${round}: ${found.length} (${found.filter((f) => f.severity !== "minor").length} blocker/major)`,
  );
  if (!found.length) break;
  phase("Fix");
  await agent(
    `${RULES}\nIn ${INT} on ${BR} fix these findings (all blockers/majors; minors if cheap), each with a regression test; rerun every gate (root unit, check 0/0, lint, full e2e ports ${P + 900}/${P + 901}); commit.\n${JSON.stringify(found, null, 1)}`,
    { label: `fix r${round}`, phase: "Fix" },
  );
  if (!found.some((f) => f.severity === "blocker")) break;
}
return { integ: String(integ).slice(0, 1500), reported: seen };
