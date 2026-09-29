import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import plugin from "../index.js";
import { extractHoldFactTables } from "../lib/extractHoldFactTables.js";
import { extractHoldWriters } from "../lib/extractHoldWriters.js";
import { holdWriterSources } from "../lib/holdWriterSources.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const rule = plugin.rules["no-unguarded-hold-write"];

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-unguarded-hold-write", rule, {
  valid: [
    `await guardedHoldWrite(event, user, () => applyMove(plan, ctx));`,
    `const g = await tryGuardedHoldWrite(event, user, () => { const r = insertHealthEvent(x); return r; });`,
    `const write = () => insertHarvestEvent(x); await tryGuardedHoldWrite(event, auth, write);`,
    `function write() { return deleteBlockCascade(id); } await guardedHoldWrite(event, u, write);`,
    `return voidRecord(event, target, (input, by) => deleteHealthEvent(r, { deletedBy: by }));`,
    `db.select().from(animalLocations).where(withTenant(animalLocations));`,
    `db.insert(owners).values({ id });`,
    `const t = owners; db.delete(t).run();`,
    `const tables = { o: owners, h: animalHealthEvents }; db.update(tables.o).set({});`,
    "db.run(sql`DELETE FROM owners WHERE id = ${id}`);",
    "const msg = 'Update the spray records later';",
    "db.all(sql`SELECT * FROM spray_events`);",
    `listLocationsForSubject('animal', id);`,
    `/** @holdWriter (callers guard it) */ export function applyIt(p) { return insertStay(p); }`,
    `/**\n * Moves the flock.\n * @holdWriter\n */\nexport const moveIt = (p) => endStayAt(p.subject, p.at);`,
    `import { deleteBlockCascade as dbc } from '$lib/db/admin'; await guardedHoldWrite(e, u, () => dbc(id));`,
    `import { deleteBlockCascade } from '$lib/db/admin'; export { deleteBlockCascade };`,
    `await guardedHoldWrite(e, u, () => [id].forEach(deleteBlockCascade));`,
    `const { deleteHayCutting } = await import('$lib/db/admin'); await tryGuardedHoldWrite(e, u, () => deleteHayCutting(id));`,
    `function a() { const write = () => insertHarvestEvent(x); return tryGuardedHoldWrite(e, u, write); } function b() { const write = () => 1; return writeRecord(r, write); }`,
  ],
  invalid: [
    {
      code: `const t = sprayEvents; db.delete(t).run();`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `const tables = { h: animalHealthEvents }; db.update(tables.h).set({}).run();`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `let t = owners; t = sprayEvents; db.insert(t).values({});`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `db.delete(cond ? owners : sprayEvents).run();`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `extendDoseHoldParams(id, '{}');`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `db.insert(sprayEvents).values(tenantValues({}));`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `db.delete(sprayEvents as typeof sprayEvents).where(eq(sprayEvents.id, id)).run();`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `db.update(schema.animalLocations!).set({ toMs: null });`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: "db.run(sql`DELETE FROM animal_locations WHERE id = ${id}`);",
      errors: [{ messageId: "rawSql" }],
    },
    {
      code: `db.prepare('update spray_events set hold_params_json = null').run();`,
      errors: [{ messageId: "rawSql" }],
    },
    {
      code: "await guardedHoldWrite(e, u, () => db.run(sql`INSERT OR REPLACE INTO record_deletions (id) VALUES (${id})`));",
      errors: [{ messageId: "rawSql" }],
    },
    {
      code: `db.update(animalLocations).set({ toMs: null }).where(withTenant(animalLocations));`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `db.delete(blocks).where(withTenant(blocks, eq(blocks.id, id)));`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `export const POST = async () => { const move = applyMove(plan, ctx); return move; };`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `writeRecord(event, () => insertHealthEvent(x));`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `await guardedHoldWrite(event, user, () => 1); deleteHealthEvent(r, opts);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `repo.insertStay(x);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `/** A helper with no tag. */ export function helper(p) { return insertStay(p); }`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `/** @holdWriter */ function outer() {} function inner(p) { return insertStay(p); }`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `export const POST = () => { const fn = () => insertOverridePayload(a, b, c); return fn(); };`,
      errors: [{ messageId: "unguarded" }],
    },
    // Review round 1: each of these got past the rule.
    {
      code: `const write = () => insertHarvestEvent(x); await tryGuardedHoldWrite(e, a, write); writeRecord({ request }, write);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `function a() { const write = () => deleteBlockCascade(id); return writeRecord(r, write); } function b() { const write = () => 1; return guardedHoldWrite(e, u, write); }`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `import { deleteBlockCascade as dbc } from '$lib/db/admin'; dbc(id);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `db.delete(schema.sprayEvents).where(x);`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `db.update(schema['animalLocations']).set({});`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `admin['deleteBlockCascade'](id);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `[id].forEach(deleteBlockCascade);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `writeRecord(r, deleteBlockCascade.bind(null, id));`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `const { deleteHayCutting: drop } = await import('$lib/db/admin'); drop(id);`,
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: `const f = admin.deleteBlockCascade; f(id);`,
      errors: [{ messageId: "unguarded" }],
    },
  ],
});

describe("hold-fact-tables.json", () => {
  const schemaSource = readFileSync(
    new URL("../../../apps/web/src/lib/db/schema.ts", import.meta.url),
    "utf8",
  );
  const checkedIn = JSON.parse(
    readFileSync(new URL("../hold-fact-tables.json", import.meta.url), "utf8"),
  );

  it("matches every // @hold-fact table in apps/web/src/lib/db/schema.ts", () => {
    assert.deepEqual(
      checkedIn,
      extractHoldFactTables(schemaSource),
      "Hold-fact table list drifted from schema.ts — run `pnpm --filter eslint-plugin-cropcard gen:tables` and commit the result.",
    );
  });

  it("names the tables the hold ledger reads", () => {
    for (const t of [
      "animalLocations",
      "animalHealthEvents",
      "animalProductionLogs",
      "animalStatusEvents",
      "grazingAttestations",
      "sprayEvents",
      "insecticideEvents",
      "fungicideEvents",
      "hayCuttings",
      "harvestEvents",
      "blocks",
      "fields",
      "pluginOverrides",
      "recordDeletions",
    ]) {
      assert.ok(checkedIn.includes(t), t);
    }
  });

  it("extracts only marked tenant-scoped tables", () => {
    const src = `
// @hold-fact (C-35)
export const a = tenantScoped(sqliteTable('a', {}));
// @hold-fact (C-35)
/** doc */
export const b = tenantScoped(
  sqliteTable('b', {})
);
export const c = tenantScoped(sqliteTable('c', {}));
`;
    assert.deepEqual(extractHoldFactTables(src), ["a", "b"]);
  });
});

describe("hold-writers.json", () => {
  const tables = JSON.parse(
    readFileSync(new URL("../hold-fact-tables.json", import.meta.url), "utf8"),
  );
  const checkedIn = JSON.parse(
    readFileSync(new URL("../hold-writers.json", import.meta.url), "utf8"),
  );

  it("matches every writer of a hold-fact table in apps/web/src/lib/db", () => {
    assert.deepEqual(
      checkedIn,
      extractHoldWriters(holdWriterSources(), tables).writers,
      "Hold writer list drifted from lib/db — run `pnpm --filter eslint-plugin-cropcard gen:tables` and commit the result.",
    );
  });

  it("names the writers the guard must see", () => {
    for (const name of [
      "insertSprayEvent",
      "insertInsecticideEvent",
      "insertFungicideEvent",
      "deleteSprayEvent",
      "deleteInsecticideEvent",
      "deleteHarvestEvent",
      "deleteHayCutting",
      "createCutting",
      "advanceCutting",
      "insertHarvestEvent",
      "insertHealthEvent",
      "deleteHealthEvent",
      "saveWithdrawalEntries",
      "insertProductionLog",
      "setProductionUse",
      "deleteProductionLog",
      "insertStatusEvent",
      "deleteStatusEvent",
      "insertStay",
      "endStayAt",
      "deleteLatestStay",
      "voidStay",
      "insertGrazingAttestation",
      "updateBlock",
      "deleteBlockCascade",
      "deleteFieldCascade",
      "deleteCropCascade",
      "insertOverridePayload",
      "hideForOwner",
      "unhideForOwner",
      "applyMove",
      "recordStatus",
      "undoStatus",
      "extendDoseHoldParams",
    ]) {
      assert.ok(checkedIn.includes(name), name);
    }
  });

  it("finds direct, raw-SQL, cascade and transitive writers, per file, and honours @hold-exempt", () => {
    const files = [
      {
        path: "lib/db/a.ts",
        repo: true,
        text: `
import { db } from './client';
export function addA() { return db.insert(aTable).values({}).run(); }
export function wipe() { del(aTable, x); }
export function raw() { db.run(sql\`DELETE FROM a_table WHERE id = 1\`); }
function local() { db.update(schema.aTable).set({}).run(); }
export function viaLocal() { local(); }
export function viaOther() { return addB(); }
/** @hold-exempt: stamps a lock only */
export function lockIt() { db.update(aTable).set({ lockedAt: 1 }).run(); }
export function readOnly() { return db.select().from(aTable).all(); }
export function insertRow() { return db.insert(otherTable).values({}).run(); }
export function aliased() { const t = aTable; db.update(t).set({}).run(); }
export function viaObject() { const ts = { a: aTable }; db.delete(ts.a).run(); }
export function aliasedOther() { const o = otherTable; db.update(o).set({}).run(); }
`,
      },
      {
        path: "lib/db/b.ts",
        repo: true,
        text: `
export function addB() { return db.insert(aTable).values({}).run(); }
export function usesLock() { lockIt(); }
function insertRow() { return db.insert(aTable).values({}).run(); }
export function viaRow() { insertRow(); }
`,
      },
      {
        path: "lib/server/c.ts",
        repo: false,
        text: `
/** @holdWriter */
export function serverWriter() { addA(); }
export function notTagged() { addA(); }
`,
      },
    ];
    const { writers, exempt } = extractHoldWriters(files, ["aTable"]);
    assert.deepEqual(writers, [
      "addA",
      "addB",
      "aliased",
      "raw",
      "serverWriter",
      "viaLocal",
      "viaObject",
      "viaOther",
      "viaRow",
      "wipe",
    ]);
    assert.deepEqual(exempt, ["lockIt"]);
  });
});
