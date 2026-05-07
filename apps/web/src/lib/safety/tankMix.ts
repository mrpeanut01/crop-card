import type { HerbicideProduct, SafetyViolation } from './types';

/**
 * Tank-mix prohibitions encoded by plugin id. Distinct from chemistry-class
 * incompatibility because some product pairs interact for reasons not
 * captured by class alone (formulation antagonism, label restrictions).
 *
 * Each entry: products that must never share a tank, plus the days of
 * separation required between sequential applications on the same block.
 */
interface TankMixRule {
  products: readonly [string, string];
  separationDays: number;
}

const TANK_MIX_RULES: readonly TankMixRule[] = [
  { products: ['stadia', 'clethodim'], separationDays: 7 }
];

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const RULE_INDEX = new Map<string, TankMixRule>(
  TANK_MIX_RULES.map((r) => [pairKey(r.products[0], r.products[1]), r])
);

export interface PriorApplication {
  pluginId: string;
  occurredAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function checkTankMix(
  products: HerbicideProduct[],
  occurredAt: number,
  priorApplications: PriorApplication[] = []
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const ids = products.map((p) => p.pluginId);

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const rule = RULE_INDEX.get(pairKey(ids[i], ids[j]));
      if (!rule) continue;
      violations.push({
        code: 'TANK_MIX_PROHIBITED',
        message: `${rule.products[0]} and ${rule.products[1]} cannot be tank-mixed`,
        detail: { products: rule.products }
      });
    }
  }

  for (const product of products) {
    for (const rule of TANK_MIX_RULES) {
      const otherId =
        rule.products[0] === product.pluginId
          ? rule.products[1]
          : rule.products[1] === product.pluginId
            ? rule.products[0]
            : null;
      if (!otherId) continue;

      const conflicting = priorApplications
        .filter((p) => p.pluginId === otherId)
        .filter((p) => occurredAt - p.occurredAt < rule.separationDays * DAY_MS);
      for (const c of conflicting) {
        violations.push({
          code: 'TANK_MIX_SEPARATION',
          message: `${product.pluginId} requires ${rule.separationDays}-day separation after ${otherId}`,
          detail: {
            currentProduct: product.pluginId,
            priorProduct: otherId,
            priorOccurredAt: c.occurredAt,
            separationDays: rule.separationDays
          }
        });
      }
    }
  }

  return violations;
}
