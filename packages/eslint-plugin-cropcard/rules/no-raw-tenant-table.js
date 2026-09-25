/**
 * Custom ESLint rule: flag raw Drizzle queries against tenant-scoped tables.
 *
 * Tenant-scoped tables in `apps/web/src/lib/db/schema.ts` carry the
 * TenantScoped brand. Reads/writes against them MUST go through the
 * `tenantWhere`, `withTenant`, or `tenantValues` helpers from
 * `apps/web/src/lib/db/tenant.ts` so the active Owner's filter / stamp
 * is always applied. This rule catches the common forgetting pattern:
 *
 *   db.select().from(blocks).where(eq(blocks.id, id))    // ❌ flagged
 *   db.insert(sprayEvents).values({...})                  // ❌ flagged
 *
 * Recommended:
 *
 *   db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id)))
 *   db.insert(sprayEvents).values(tenantValues({...}))
 *
 * If you genuinely need an unscoped query (e.g. cross-tenant superadmin
 * lookup or a global table like users), call `unscopedQueryNote('reason')`
 * in the same function.
 *
 * Heuristic: the rule operates at FUNCTION granularity, not call-chain
 * granularity — chasing `.from(X).where(tenantWhere(X))` through the
 * Drizzle fluent API is fragile. A raw query is allowed when a call to
 * `tenantWhere`, `withTenant`, `tenantValues`, or `unscopedQueryNote`
 * appears anywhere inside the query's innermost enclosing function, or
 * directly in the body of a function (or module scope) enclosing it. A
 * helper in a sibling function — even one nested in the same outer
 * function, e.g. two `it()` callbacks in one `describe()` — does not count.
 *
 * The table list is generated from every `tenantScoped(...)` export in
 * `schema.ts` into `tenant-scoped-tables.json` (`pnpm --filter
 * eslint-plugin-cropcard gen:tables`); a drift test fails when the two
 * disagree. The compile-time `TenantScoped` brand in `schema.ts` is the
 * canonical gate; this rule is a secondary safety net.
 */

import { readFileSync } from 'node:fs';

const TENANT_SCOPED_TABLE_NAMES = new Set(
  JSON.parse(readFileSync(new URL('../tenant-scoped-tables.json', import.meta.url), 'utf8'))
);

const SCHEMA_SOURCE = /(^|\/)schema(\.[jt]s)?$/;

function fromSchema(spec) {
  return SCHEMA_SOURCE.test(String(spec.parent.source.value));
}

const HELPERS = new Set(['tenantWhere', 'withTenant', 'tenantValues', 'unscopedQueryNote']);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression'
]);

function importedName(spec) {
  return spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw Drizzle reads/writes against tenant-scoped tables — funnel through tenantWhere/withTenant/tenantValues.',
      recommended: true
    },
    messages: {
      rawFrom:
        "Raw `.from({{name}})` on a tenant-scoped table. Add `.where(tenantWhere({{name}}))` (or `withTenant({{name}}, ...)` to combine with other conditions). If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file.",
      rawInsert:
        "Raw `db.insert({{name}})` on a tenant-scoped table. Wrap the values payload in `tenantValues({...})`. If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file.",
      rawUpdate:
        "Raw `db.update({{name}})` on a tenant-scoped table. Combine your WHERE with `withTenant({{name}}, ...)`. If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file.",
      rawDelete:
        "Raw `db.delete({{name}})` on a tenant-scoped table. Combine your WHERE with `withTenant({{name}}, ...)`. If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file."
    },
    schema: []
  },

  create(context) {
    // Functions whose body contains a helper call at any depth.
    const containsHelper = new Set();
    // Innermost function (or `null` for module scope) of each helper call.
    const directHelperScopes = new Set();
    const rawQueries = [];
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    // `import { crops as cropsTable }` and `import * as schema` must not
    // slip past the name check.
    const aliases = new Set();
    const namespaces = new Set();

    function tenantTableName(node) {
      if (!node) return null;
      if (node.type === 'Identifier') {
        return TENANT_SCOPED_TABLE_NAMES.has(node.name) || aliases.has(node.name)
          ? node.name
          : null;
      }
      if (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.object.type === 'Identifier' &&
        namespaces.has(node.object.name) &&
        node.property.type === 'Identifier' &&
        TENANT_SCOPED_TABLE_NAMES.has(node.property.name)
      ) {
        return sourceCode.getText(node);
      }
      return null;
    }

    function enclosingFunctions(node) {
      const fns = [];
      for (let p = node.parent; p; p = p.parent) {
        if (FUNCTION_TYPES.has(p.type)) fns.push(p);
      }
      return fns;
    }

    function check(node, messageId) {
      const name = tenantTableName(node.arguments[0]);
      if (name) rawQueries.push({ node, messageId, name });
    }

    function isHelperCall(node) {
      const c = node.callee;
      if (c.type === 'Identifier') return HELPERS.has(c.name);
      return (
        c.type === 'MemberExpression' &&
        !c.computed &&
        c.property.type === 'Identifier' &&
        HELPERS.has(c.property.name)
      );
    }

    return {
      CallExpression(node) {
        if (!isHelperCall(node)) return;
        const fns = enclosingFunctions(node);
        directHelperScopes.add(fns[0] ?? null);
        for (const fn of fns) containsHelper.add(fn);
      },

      'Program:exit'() {
        for (const { node, messageId, name } of rawQueries) {
          const [inner, ...outer] = enclosingFunctions(node);
          const covered =
            directHelperScopes.has(null) ||
            (inner !== undefined && containsHelper.has(inner)) ||
            outer.some((fn) => directHelperScopes.has(fn));
          if (!covered) context.report({ node, messageId, data: { name } });
        }
      },

      ImportSpecifier(node) {
        if (
          fromSchema(node) &&
          node.local.name !== importedName(node) &&
          TENANT_SCOPED_TABLE_NAMES.has(importedName(node))
        ) {
          aliases.add(node.local.name);
        }
      },

      ImportNamespaceSpecifier(node) {
        if (fromSchema(node)) namespaces.add(node.local.name);
      },

      // db.select(...).from(blocks)
      'CallExpression[callee.property.name="from"]'(node) {
        check(node, 'rawFrom');
      },

      // db.insert(blocks).values({...})
      'CallExpression[callee.property.name="insert"]'(node) {
        check(node, 'rawInsert');
      },

      // db.update(blocks).set({...}).where(...)
      'CallExpression[callee.property.name="update"]'(node) {
        check(node, 'rawUpdate');
      },

      // db.delete(blocks).where(...)
      'CallExpression[callee.property.name="delete"]'(node) {
        check(node, 'rawDelete');
      }
    };
  }
};
