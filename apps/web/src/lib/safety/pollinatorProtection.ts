/**
 * #130 — pollinator-protection gate (RULES_VERSION 0.5.6).
 *
 * Label language is law: a product whose label prohibits application during
 * bloom is blocked whenever the block is in bloom OR bloom status has not
 * been attested, and a "do not apply while bees are foraging" product is
 * blocked between sunrise and sunset while flowers are present. Neither
 * block is overridable. Bee-toxic products without a label bloom
 * restriction only warn.
 *
 * Inputs are plugin data (`pollinator` on the insecticide plugin), the
 * operator's bloom attestation, the application time, and the local
 * sunrise/sunset (`sunTimes.ts`). Pure — no DB, env, or clock reads.
 */

import type { SafetyViolation } from './types';
import type { SunTimes } from './sunTimes';

export type BeeToxicity = 'highly-toxic' | 'toxic' | 'relatively-nontoxic' | 'unknown';
export type BloomRestriction = 'prohibited-during-bloom' | 'dusk-to-dawn-only' | 'none';
export type BloomStatus = 'in-bloom' | 'not-in-bloom' | 'unknown';
export type PollinatorCheckStatus = 'pass' | 'warn' | 'block';
export type PollinatorCheckId = 'bee-toxicity' | 'bloom' | 'time-of-day' | 'residual';

export interface PollinatorData {
  beeToxicity: BeeToxicity;
  bloomRestriction: BloomRestriction;
  residualToxicityHours?: number;
}

export interface PollinatorProduct {
  pluginId: string;
  displayName?: string;
  /** Absent → derived conservatively from `pollinatorRisk` (see `pollinatorDataFor`). */
  pollinator?: PollinatorData;
  /** Legacy coarse hint; only consulted when `pollinator` is absent. */
  pollinatorRisk?: 'none' | 'low' | 'moderate' | 'high' | 'unknown';
}

export interface PollinatorProtectionInput {
  products: PollinatorProduct[];
  bloomStatus: BloomStatus;
  applicationTime: Date;
  sunTimes: SunTimes | null;
  /** Operator confirms no bees are foraging — only consulted when the
   *  sun times are unavailable for a dusk-to-dawn product. */
  attestedNoForagers?: boolean;
}

export interface PollinatorCheck {
  id: PollinatorCheckId;
  status: PollinatorCheckStatus;
  label: string;
  reason: string;
}

export interface PollinatorProtectionResult {
  overall: PollinatorCheckStatus;
  checks: PollinatorCheck[];
  effective: PollinatorData;
}

const TOX_RANK: Record<BeeToxicity, number> = {
  'relatively-nontoxic': 0,
  toxic: 1,
  unknown: 2,
  'highly-toxic': 3
};
const RESTRICTION_RANK: Record<BloomRestriction, number> = {
  none: 0,
  'dusk-to-dawn-only': 1,
  'prohibited-during-bloom': 2
};
const STATUS_RANK: Record<PollinatorCheckStatus, number> = { pass: 0, warn: 1, block: 2 };

const UNKNOWN_DATA: PollinatorData = { beeToxicity: 'unknown', bloomRestriction: 'none' };
const UNKNOWN_RISKY: PollinatorData = {
  beeToxicity: 'unknown',
  bloomRestriction: 'prohibited-during-bloom'
};

/**
 * Label data for one product. Without declared `pollinator` data the label's
 * bloom language is unknown, so a product whose legacy `pollinatorRisk` is
 * moderate/high/missing is treated as bloom-prohibited (never guess a lower
 * hazard); only an explicit `none`/`low` hint relaxes that to a warning.
 */
export function pollinatorDataFor(p: PollinatorProduct): PollinatorData {
  if (p.pollinator) return p.pollinator;
  return p.pollinatorRisk === 'none' || p.pollinatorRisk === 'low' ? UNKNOWN_DATA : UNKNOWN_RISKY;
}
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const TOX_LABEL: Record<BeeToxicity, string> = {
  'highly-toxic': 'Highly toxic to bees',
  toxic: 'Toxic to bees',
  'relatively-nontoxic': 'Relatively nontoxic to bees',
  unknown: 'Bee toxicity not declared'
};

/** Worst toxicity, strictest restriction, longest residual across a tank mix. */
export function aggregatePollinatorData(products: PollinatorProduct[]): PollinatorData {
  if (products.length === 0) return { ...UNKNOWN_DATA };
  let tox: BeeToxicity = 'relatively-nontoxic';
  let restriction: BloomRestriction = 'none';
  let residual: number | undefined;
  for (const p of products) {
    const d = pollinatorDataFor(p);
    if (TOX_RANK[d.beeToxicity] > TOX_RANK[tox]) tox = d.beeToxicity;
    if (RESTRICTION_RANK[d.bloomRestriction] > RESTRICTION_RANK[restriction]) {
      restriction = d.bloomRestriction;
    }
    const h = d.residualToxicityHours;
    if (h !== undefined && Number.isFinite(h) && h > 0) residual = Math.max(residual ?? 0, h);
  }
  const out: PollinatorData = { beeToxicity: tox, bloomRestriction: restriction };
  if (residual !== undefined) out.residualToxicityHours = residual;
  return out;
}

export function isDaylight(at: Date, sun: SunTimes): boolean {
  const t = at.getTime();
  return t >= sun.sunrise.getTime() && t < sun.sunset.getTime();
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function hoursUntilSunrise(at: Date, sun: SunTimes): number {
  const t = at.getTime();
  const sunrise = sun.sunrise.getTime();
  const next = t < sunrise ? sunrise : sunrise + DAY_MS;
  return (next - t) / HOUR_MS;
}

export function checkPollinatorProtection(
  input: PollinatorProtectionInput
): PollinatorProtectionResult {
  const data = aggregatePollinatorData(input.products);
  const { beeToxicity, bloomRestriction, residualToxicityHours } = data;
  const bloom = input.bloomStatus;
  const hazardous = beeToxicity !== 'relatively-nontoxic';
  const flowersPossible = bloom !== 'not-in-bloom';
  const checks: PollinatorCheck[] = [];

  // ── bee toxicity ─────────────────────────────────────────────────────
  if (!hazardous) {
    checks.push({
      id: 'bee-toxicity',
      status: 'pass',
      label: TOX_LABEL[beeToxicity],
      reason: 'Label class is relatively nontoxic to honey bees.'
    });
  } else if (!flowersPossible) {
    checks.push({
      id: 'bee-toxicity',
      status: 'pass',
      label: TOX_LABEL[beeToxicity],
      reason: 'No bloom in the block — keep drift off flowering field borders.'
    });
  } else {
    checks.push({
      id: 'bee-toxicity',
      status: 'warn',
      label: TOX_LABEL[beeToxicity],
      reason:
        bloom === 'in-bloom'
          ? 'Bee-toxic product on a blooming block — spray after foragers leave and mow flowering weeds first.'
          : 'Bee-toxic product and bloom status is not attested — check the crop and weeds for open flowers.'
    });
  }

  // ── bloom ────────────────────────────────────────────────────────────
  if (bloomRestriction === 'prohibited-during-bloom') {
    checks.push(
      bloom === 'not-in-bloom'
        ? {
            id: 'bloom',
            status: 'pass',
            label: 'Bloom — label prohibits',
            reason: 'Operator attests no crop or weed bloom in the block.'
          }
        : {
            id: 'bloom',
            status: 'block',
            label: 'Bloom — label prohibits',
            reason:
              bloom === 'in-bloom'
                ? 'Label prohibits application while the crop or flowering weeds are in bloom. Wait until petal fall.'
                : 'Label prohibits application during bloom — attest bloom status before recording.'
          }
    );
  } else if (bloom === 'unknown' && (hazardous || bloomRestriction !== 'none')) {
    checks.push({
      id: 'bloom',
      status: 'warn',
      label: 'Bloom status',
      reason: 'Bloom status not attested — confirm whether crop or weeds are flowering.'
    });
  } else {
    checks.push({
      id: 'bloom',
      status: 'pass',
      label: 'Bloom status',
      reason:
        bloom === 'in-bloom'
          ? 'Label does not prohibit application during bloom.'
          : bloom === 'not-in-bloom'
            ? 'Operator attests no crop or weed bloom in the block.'
            : 'Product is relatively nontoxic; bloom status does not gate it.'
    });
  }

  // ── time of day ──────────────────────────────────────────────────────
  const at = input.applicationTime;
  if (!flowersPossible || (!hazardous && bloomRestriction === 'none')) {
    checks.push({
      id: 'time-of-day',
      status: 'pass',
      label: 'Time of day',
      reason: flowersPossible
        ? 'No label time-of-day restriction.'
        : 'No bloom — time-of-day restriction does not apply.'
    });
  } else if (bloomRestriction === 'dusk-to-dawn-only') {
    if (!input.sunTimes) {
      checks.push(
        input.attestedNoForagers
          ? {
              id: 'time-of-day',
              status: 'warn',
              label: 'Dusk-to-dawn only',
              reason:
                'Sunrise/sunset unavailable for this block — operator attests no bees are foraging.'
            }
          : {
              id: 'time-of-day',
              status: 'block',
              label: 'Dusk-to-dawn only',
              reason:
                'Label allows application only while bees are not foraging and sunrise/sunset is unavailable — confirm no bees are foraging.'
            }
      );
    } else if (isDaylight(at, input.sunTimes)) {
      checks.push({
        id: 'time-of-day',
        status: 'block',
        label: 'Dusk-to-dawn only',
        reason: `Label prohibits application while bees are foraging. Apply after sunset (${fmtTime(input.sunTimes.sunset)}) and before sunrise.`
      });
    } else {
      checks.push({
        id: 'time-of-day',
        status: 'pass',
        label: 'Dusk-to-dawn only',
        reason: 'Application is between sunset and sunrise.'
      });
    }
  } else if (!input.sunTimes || isDaylight(at, input.sunTimes)) {
    checks.push({
      id: 'time-of-day',
      status: 'warn',
      label: 'Time of day',
      reason: input.sunTimes
        ? `Daylight application of a bee-toxic product — best practice is after sunset (${fmtTime(input.sunTimes.sunset)}).`
        : 'Sunrise/sunset unavailable — best practice is to spray after sunset.'
    });
  } else {
    checks.push({
      id: 'time-of-day',
      status: 'pass',
      label: 'Time of day',
      reason: 'Application is between sunset and sunrise.'
    });
  }

  // ── residual ─────────────────────────────────────────────────────────
  if (residualToxicityHours === undefined) {
    checks.push({
      id: 'residual',
      status: 'pass',
      label: 'Residual toxicity',
      reason: 'No residual-toxicity window declared on the label data.'
    });
  } else if (!flowersPossible) {
    checks.push({
      id: 'residual',
      status: 'pass',
      label: `Residual ~${residualToxicityHours} h`,
      reason: 'No bloom — foragers are not expected on treated foliage.'
    });
  } else if (!input.sunTimes) {
    checks.push({
      id: 'residual',
      status: 'warn',
      label: `Residual ~${residualToxicityHours} h`,
      reason: `Residue stays toxic ~${residualToxicityHours} h; sunrise unavailable — confirm it dries before foragers return.`
    });
  } else {
    const hours = hoursUntilSunrise(at, input.sunTimes);
    checks.push(
      residualToxicityHours > hours
        ? {
            id: 'residual',
            status: 'warn',
            label: `Residual ~${residualToxicityHours} h`,
            reason: `Residue stays toxic ~${residualToxicityHours} h but sunrise is ${hours.toFixed(1)} h away — foragers may contact wet residue.`
          }
        : {
            id: 'residual',
            status: 'pass',
            label: `Residual ~${residualToxicityHours} h`,
            reason: `Residue dries before sunrise (${hours.toFixed(1)} h away).`
          }
    );
  }

  const overall = checks.reduce<PollinatorCheckStatus>(
    (acc, c) => (STATUS_RANK[c.status] > STATUS_RANK[acc] ? c.status : acc),
    'pass'
  );
  return { overall, checks, effective: data };
}

/** Kernel violation for the record endpoints — empty unless the gate blocks. */
export function pollinatorViolations(result: PollinatorProtectionResult): SafetyViolation[] {
  if (result.overall !== 'block') return [];
  const blocking = result.checks.filter((c) => c.status === 'block');
  return [
    {
      code: 'POLLINATOR_BLOCK',
      message: blocking.map((c) => c.reason).join(' '),
      detail: { checks: result.checks, effective: result.effective }
    }
  ];
}
