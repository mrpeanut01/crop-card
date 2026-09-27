/**
 * Custom ESLint rule (C-35): every write that can affect a hold goes
 * through the hold guard (`guardedHoldWrite` / `tryGuardedHoldWrite` /
 * `voidRecord` in `apps/web/src/lib/server/`).
 *
 * Two checks, both in endpoint and server code (repos in `lib/db` are the
 * only place hold-fact tables are written directly):
 *
 * 1. A raw `db.insert(X)`, `db.update(X)` or `db.delete(X)` on a hold-fact
 *    table is refused outright: go through the repo, inside the guard.
 * 2. A call to a repo or server function that writes hold facts must sit
 *    inside a function passed to one of the guard calls.
 *
 * The hold-fact table list is generated from the `// @hold-fact` markers in
 * `schema.ts` into `hold-fact-tables.json` (`gen:tables`); a drift test
 * fails when the two disagree.
 */

import { readFileSync } from 'node:fs';

const HOLD_FACT_TABLES = new Set(
  JSON.parse(readFileSync(new URL('../hold-fact-tables.json', import.meta.url), 'utf8'))
);

/** Repo and server functions that write hold facts. */
export const HOLD_WRITERS = new Set([
  'abortCutting',
  'advanceCutting',
  'applyMove',
  'createAnimalWithHousing',
  'createCutting',
  'createGroupWithMembers',
  'deleteAnimalIfEmpty',
  'deleteBlockCascade',
  'deleteCropCascade',
  'deleteFieldCascade',
  'deleteGroupIfEmpty',
  'deleteHarvestEvent',
  'deleteHayCutting',
  'deleteHealthEvent',
  'deleteInsecticideEvent',
  'deleteLatestStay',
  'deleteProductionLog',
  'deleteSprayEvent',
  'endStayAt',
  'insertFungicideEvent',
  'insertGrazingAttestation',
  'insertHarvestEvent',
  'insertHealthEvent',
  'insertInsecticideEvent',
  'insertProductionLog',
  'insertSprayEvent',
  'insertStay',
  'recordStatus',
  'saveWithdrawalEntries',
  'setProductionUse',
  'undoStatus',
  'updateAnimal',
  'updateBlock',
  'voidStay'
]);

const GUARDS = new Set(['guardedHoldWrite', 'tryGuardedHoldWrite', 'voidRecord']);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression'
]);

function calleeName(node) {
  const c = node.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
    return c.property.name;
  }
  return null;
}

/** Whether `node` sits inside a function passed to a guard call. A named
 *  helper passed by reference (`guardedHoldWrite(event, user, write)`)
 *  counts when it is declared in the same file. */
function guarded(node, guardedNames) {
  for (let p = node.parent; p; p = p.parent) {
    if (!FUNCTION_TYPES.has(p.type)) continue;
    const call = p.parent;
    if (call?.type === 'CallExpression' && GUARDS.has(calleeName(call) ?? '')) {
      if (call.arguments.includes(p)) return true;
    }
    const name =
      p.type === 'FunctionDeclaration'
        ? p.id?.name
        : p.parent?.type === 'VariableDeclarator' && p.parent.id.type === 'Identifier'
          ? p.parent.id.name
          : null;
    if (name && guardedNames.has(name)) return true;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every write that can affect a hold to run inside the C-35 hold guard (guardedHoldWrite).',
      recommended: true
    },
    messages: {
      rawWrite:
        'Raw `{{op}}({{name}})` on a hold-fact table. Write through its repo, inside `guardedHoldWrite` (C-35).',
      unguarded:
        '`{{name}}` writes hold facts. Call it inside `guardedHoldWrite` / `tryGuardedHoldWrite` so the hold guard checks the write (C-35).'
    },
    schema: []
  },

  create(context) {
    const calls = [];
    const guardedNames = new Set();
    return {
      CallExpression(node) {
        const name = calleeName(node);
        if (!name) return;
        if (GUARDS.has(name)) {
          for (const arg of node.arguments) if (arg.type === 'Identifier') guardedNames.add(arg.name);
          return;
        }
        if (
          (name === 'insert' || name === 'update' || name === 'delete') &&
          node.callee.type === 'MemberExpression' &&
          node.arguments[0]?.type === 'Identifier' &&
          HOLD_FACT_TABLES.has(node.arguments[0].name)
        ) {
          context.report({
            node,
            messageId: 'rawWrite',
            data: { op: `db.${name}`, name: node.arguments[0].name }
          });
          return;
        }
        if (node.callee.type === 'Identifier' && HOLD_WRITERS.has(name)) calls.push(node);
      },
      'Program:exit'() {
        for (const node of calls) {
          if (!guarded(node, guardedNames)) {
            context.report({ node, messageId: 'unguarded', data: { name: calleeName(node) } });
          }
        }
      }
    };
  }
};
