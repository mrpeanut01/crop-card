/**
 * Custom ESLint rule (C-35): every write that can affect a hold goes
 * through the hold guard (`guardedHoldWrite` / `tryGuardedHoldWrite` /
 * `voidRecord` in `apps/web/src/lib/server/`).
 *
 * Two checks, everywhere outside the repos in `lib/db` (the only place
 * hold-fact tables are written directly):
 *
 * 1. A raw `db.insert(X)`, `db.update(X)` or `db.delete(X)` on a hold-fact
 *    table (also through a type cast such as `X as typeof X`), or a SQL
 *    string or template that inserts into, updates or deletes from one, is
 *    refused outright: go through the repo, inside the guard.
 * 2. A call to a function that writes hold facts must sit inside a function
 *    passed to one of the guard calls, or inside a function whose JSDoc
 *    carries `@holdWriter` (its own callers are then checked instead).
 *
 * The hold-fact table list is generated from the `// @hold-fact` markers in
 * `schema.ts` into `hold-fact-tables.json`, and the writer list from the
 * repos into `hold-writers.json` (`gen:tables`); drift tests fail when
 * either is stale.
 */

import { readFileSync } from "node:fs";

const HOLD_FACT_TABLES = new Set(
  JSON.parse(
    readFileSync(new URL("../hold-fact-tables.json", import.meta.url), "utf8"),
  ),
);

const SQL_WRITE =
  /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|REPLACE\s+INTO)\s+[`"'\[]?(\w+)/gi;

const HOLD_FACT_SQL_TABLES = new Map(
  [...HOLD_FACT_TABLES].map((t) => [
    t.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
    t,
  ]),
);

/** Functions that write hold facts, generated from `lib/db` (plus any
 *  `@holdWriter` function elsewhere) into `hold-writers.json` by
 *  `gen:tables`; a drift test fails when the list is stale. */
export const HOLD_WRITERS = new Set(
  JSON.parse(
    readFileSync(new URL("../hold-writers.json", import.meta.url), "utf8"),
  ),
);

const GUARDS = new Set([
  "guardedHoldWrite",
  "tryGuardedHoldWrite",
  "voidRecord",
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** The name a member or plain reference resolves to, including a
 *  string-literal bracket access (`admin['deleteBlockCascade']`). */
function memberName(m) {
  if (!m.computed && m.property.type === "Identifier") return m.property.name;
  if (
    m.computed &&
    m.property.type === "Literal" &&
    typeof m.property.value === "string"
  ) {
    return m.property.value;
  }
  if (
    m.computed &&
    m.property.type === "TemplateLiteral" &&
    m.property.expressions.length === 0
  ) {
    return m.property.quasis[0].value.cooked;
  }
  return null;
}

function calleeName(node) {
  const c = node.callee;
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression") return memberName(c);
  return null;
}

const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

/** Initializers and assigned values of a local binding. */
function valuesOf(variable) {
  const out = [];
  for (const def of variable?.defs ?? []) {
    if (def.node.type === "VariableDeclarator" && def.node.init)
      out.push(def.node.init);
  }
  for (const ref of variable?.references ?? []) {
    const p = ref.identifier.parent;
    if (
      ref.isWrite() &&
      p?.type === "AssignmentExpression" &&
      p.left === ref.identifier
    )
      out.push(p.right);
  }
  return out;
}

/**
 * The hold-fact table `arg` can name: directly, through a type cast, a
 * ternary or `??`/`||`, or through a local alias (`const t = table`,
 * `const tables = { h: table }; tables.h`) resolved through scope
 * (round 7). Null when it cannot name one.
 */
function holdTableOf(arg, scope, depth = 0) {
  if (!arg || depth > 8) return null;
  const again = (n) => holdTableOf(n, scope, depth + 1);
  if (TYPE_WRAPPERS.has(arg.type)) return again(arg.expression);
  if (arg.type === "ConditionalExpression")
    return again(arg.consequent) ?? again(arg.alternate);
  if (arg.type === "LogicalExpression")
    return again(arg.left) ?? again(arg.right);
  if (arg.type === "Identifier") {
    if (HOLD_FACT_TABLES.has(arg.name)) return arg.name;
    for (const v of valuesOf(findVariable(scope, arg.name))) {
      const hit = again(v);
      if (hit) return hit;
    }
    return null;
  }
  if (arg.type === "MemberExpression") {
    const prop = memberName(arg);
    if (prop && HOLD_FACT_TABLES.has(prop)) return prop;
    const objects =
      arg.object.type === "Identifier"
        ? valuesOf(findVariable(scope, arg.object.name))
        : [arg.object];
    for (const obj of objects) {
      if (obj?.type !== "ObjectExpression") continue;
      for (const p of obj.properties) {
        if (p.type !== "Property") continue;
        const key =
          p.key.type === "Identifier" && !p.computed
            ? p.key.name
            : p.key.type === "Literal"
              ? String(p.key.value)
              : null;
        if (prop !== null && key !== prop) continue;
        const hit = again(p.value);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** The function a binding names, when it is declared as one. */
function functionOf(variable) {
  const def = variable?.defs?.[0];
  if (!def) return null;
  if (def.node.type === "FunctionDeclaration") return def.node;
  if (
    def.node.type === "VariableDeclarator" &&
    def.node.init &&
    FUNCTION_TYPES.has(def.node.init.type)
  ) {
    return def.node.init;
  }
  return null;
}

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return null;
}

function isGuardArgument(id) {
  const call = id.parent;
  return (
    call?.type === "CallExpression" &&
    call.arguments.includes(id) &&
    GUARDS.has(calleeName(call) ?? "")
  );
}

/** Whether `node` sits inside a function passed to a guard call, or inside
 *  a `@holdWriter` function. A helper passed by reference
 *  (`guardedHoldWrite(event, user, write)`) counts only when every use of
 *  that binding is an argument to a guard call. */
function taggedWriter(fn, sourceCode) {
  let target = fn;
  if (fn.type !== "FunctionDeclaration") {
    if (fn.parent?.type !== "VariableDeclarator") return false;
    target = fn.parent.parent;
  }
  if (target.parent?.type === "ExportNamedDeclaration") target = target.parent;
  const comments = sourceCode.getCommentsBefore(target);
  const last = comments[comments.length - 1];
  return !!last && /@holdWriter\b/.test(last.value);
}

function guarded(node, guardedFns, sourceCode) {
  for (let p = node.parent; p; p = p.parent) {
    if (!FUNCTION_TYPES.has(p.type)) continue;
    if (taggedWriter(p, sourceCode)) return true;
    const call = p.parent;
    if (call?.type === "CallExpression" && GUARDS.has(calleeName(call) ?? "")) {
      if (call.arguments.includes(p)) return true;
    }
    if (guardedFns.has(p)) return true;
  }
  return false;
}

/** Positions where a writer's name appears without being a use of it. */
function isNonUse(id) {
  const p = id.parent;
  if (!p) return true;
  switch (p.type) {
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return true;
    case "FunctionDeclaration":
    case "FunctionExpression":
      return p.id === id;
    case "VariableDeclarator":
      return p.id === id;
    case "Property":
      if (p.parent?.type === "ObjectPattern") return true;
      return p.key === id && !p.computed && p.value !== id;
    case "MethodDefinition":
    case "PropertyDefinition":
      return p.key === id && !p.computed;
    case "MemberExpression":
      return p.property === id && !p.computed;
    case "CallExpression":
      return p.callee === id;
    default:
      return p.type.startsWith("TS");
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every write that can affect a hold to run inside the C-35 hold guard (guardedHoldWrite).",
      recommended: true,
    },
    messages: {
      rawWrite:
        "Raw `{{op}}({{name}})` on a hold-fact table. Write through its repo, inside `guardedHoldWrite` (C-35).",
      rawSql:
        "Raw SQL write to the hold-fact table `{{name}}`. Write through its repo, inside `guardedHoldWrite` (C-35).",
      unguarded:
        "`{{name}}` writes hold facts. Call it inside `guardedHoldWrite` / `tryGuardedHoldWrite` so the hold guard checks the write, or mark the enclosing function `@holdWriter` so its callers are checked (C-35).",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const calls = [];
    const refs = [];
    const guardArgs = [];
    const writers = new Set(HOLD_WRITERS);
    const reportSql = (node, text) => {
      for (const m of text.matchAll(SQL_WRITE)) {
        const name = HOLD_FACT_SQL_TABLES.get(m[1].toLowerCase());
        if (name) {
          context.report({ node, messageId: "rawSql", data: { name: m[1] } });
          return;
        }
      }
    };
    return {
      ImportSpecifier(node) {
        const imported =
          node.imported.type === "Identifier"
            ? node.imported.name
            : node.imported.value;
        if (HOLD_WRITERS.has(imported)) writers.add(node.local.name);
      },
      "ObjectPattern > Property"(node) {
        const key =
          node.key.type === "Identifier" && !node.computed
            ? node.key.name
            : node.key.type === "Literal"
              ? node.key.value
              : null;
        if (HOLD_WRITERS.has(key) && node.value.type === "Identifier") {
          writers.add(node.value.name);
        }
      },
      CallExpression(node) {
        const name = calleeName(node);
        if (!name) return;
        if (GUARDS.has(name)) {
          for (const arg of node.arguments)
            if (arg.type === "Identifier") guardArgs.push(arg);
          return;
        }
        const table =
          (name === "insert" || name === "update" || name === "delete") &&
          node.callee.type === "MemberExpression"
            ? holdTableOf(node.arguments[0], sourceCode.getScope(node))
            : null;
        if (table) {
          context.report({
            node,
            messageId: "rawWrite",
            data: { op: `db.${name}`, name: table },
          });
          return;
        }
        if (writers.has(name)) calls.push(node);
      },
      TemplateElement(node) {
        reportSql(node, node.value.raw);
      },
      Literal(node) {
        if (typeof node.value === "string") reportSql(node, node.value);
      },
      Identifier(node) {
        if (!writers.has(node.name) || isNonUse(node)) return;
        refs.push(node);
      },
      MemberExpression(node) {
        const name = memberName(node);
        if (!name || !HOLD_WRITERS.has(name)) return;
        if (
          node.parent?.type === "CallExpression" &&
          node.parent.callee === node
        )
          return;
        refs.push(node);
      },
      "Program:exit"() {
        const guardedFns = new Set();
        for (const arg of guardArgs) {
          const variable = findVariable(sourceCode.getScope(arg), arg.name);
          const fn = functionOf(variable);
          if (!fn) continue;
          const onlyGuarded = variable.references.every(
            (r) => r.init || isGuardArgument(r.identifier),
          );
          if (onlyGuarded) guardedFns.add(fn);
        }
        for (const node of calls) {
          if (!guarded(node, guardedFns, sourceCode)) {
            context.report({
              node,
              messageId: "unguarded",
              data: { name: calleeName(node) },
            });
          }
        }
        for (const node of refs) {
          if (!guarded(node, guardedFns, sourceCode)) {
            context.report({
              node,
              messageId: "unguarded",
              data: {
                name: node.type === "Identifier" ? node.name : memberName(node),
              },
            });
          }
        }
      },
    };
  },
};
