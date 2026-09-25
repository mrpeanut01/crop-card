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
 * in the same function — the rule's heuristic allows the file when that
 * call is present.
 *
 * Heuristic: the rule operates at FILE granularity, not call-chain
 * granularity — chasing `.from(X).where(tenantWhere(X))` through the
 * Drizzle fluent API across nodes is fragile. If the file references
 * ANY of `tenantWhere`, `withTenant`, `tenantValues`, or
 * `unscopedQueryNote`, it is treated as tenant-aware and the rule
 * suppresses. The real value of the rule is catching new files that
 * touch a tenant-scoped table without importing any of the helpers —
 * the "forgot to wire tenant scoping at all" case.
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
    let fileIsTenantAware = false;
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

    function check(node, messageId) {
      if (fileIsTenantAware) return;
      const name = tenantTableName(node.arguments[0]);
      if (name) context.report({ node, messageId, data: { name } });
    }

    return {
      Program() {
        // Scan once: if the file references any tenant helper (tenant
        // accessors or an explicit cross-tenant note), treat it as
        // tenant-aware and suppress this rule file-wide. See the file
        // header for the why.
        const src = sourceCode.getText();
        fileIsTenantAware = /\b(tenantWhere|withTenant|tenantValues|unscopedQueryNote)\s*\(/.test(
          src
        );
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
