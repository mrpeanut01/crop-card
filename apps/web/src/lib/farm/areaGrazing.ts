/**
 * Grazing and hay holds on an Area, for the live Area Card and the map's
 * Area sheet (Phase 32C). Pure and client-safe: the server evaluates the
 * grazing kernel over the Area's recorded applications
 * (`lib/server/areaGrazing.ts`) and this module turns the verdicts into
 * plain lines. Advisory display only; the kernel's callers enforce.
 */

import { formatCalendarDate, ymdInZone } from '$lib/prefs';
import type { GrazingFinding, GrazingVerdict } from '$lib/safety/grazingInterval';
import {
  mergeProvenance,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '$lib/cards/model';

export type GrazingHoldState = 'dated' | 'unknown' | 'prohibited';

export interface GrazingHold {
  state: GrazingHoldState;
  /** Start of the first clear farm-local day, when known. */
  clearsAtMs: number | null;
  /** Products behind an unknown or prohibited hold. */
  products: string[];
}

export interface AreaGrazing {
  graze: GrazingHold | null;
  /** Only when milking animals wait longer than the rest. */
  milking: GrazingHold | null;
  hay: GrazingHold | null;
  manureCarryover: boolean;
  attested: boolean;
}

export type GrazingByArea = Record<string, AreaGrazing>;

function productsOf(findings: GrazingFinding[], reason: GrazingFinding['reason']): string[] {
  return [
    ...new Set(findings.filter((f) => f.active && f.reason === reason).map((f) => f.productName))
  ];
}

export function holdFrom(v: GrazingVerdict): GrazingHold | null {
  if (v.status === 'clear') return null;
  if (v.reason === 'GRAZING_PROHIBITED') {
    return {
      state: 'prohibited',
      clearsAtMs: null,
      products: productsOf(v.findings, 'GRAZING_PROHIBITED')
    };
  }
  if (v.reason === 'GRAZING_UNKNOWN') {
    return {
      state: 'unknown',
      clearsAtMs: null,
      products: productsOf(v.findings, 'GRAZING_UNKNOWN')
    };
  }
  return { state: 'dated', clearsAtMs: v.clearsAtMs, products: [] };
}

function later(a: GrazingHold | null, b: GrazingHold | null): boolean {
  if (!b) return false;
  if (!a) return true;
  if (a.state !== 'dated' || b.state !== 'dated') return a.state !== b.state;
  return (b.clearsAtMs ?? 0) > (a.clearsAtMs ?? 0);
}

/** One Area's holds from the general, lactating and hay verdicts. Null when all are clear. */
export function summarizeAreaGrazing(v: {
  graze: GrazingVerdict;
  milking: GrazingVerdict;
  hay: GrazingVerdict;
}): AreaGrazing | null {
  const graze = holdFrom(v.graze);
  const milkingHold = holdFrom(v.milking);
  const hay = holdFrom(v.hay);
  if (!graze && !milkingHold && !hay) return null;
  const attested = [v.graze, v.milking, v.hay].some((x) =>
    x.findings.some((f) => f.active && f.basis === 'attestation')
  );
  return {
    graze,
    milking: later(graze, milkingHold) ? milkingHold : null,
    hay,
    manureCarryover: v.graze.manureCarryover,
    attested
  };
}

export function holdDate(ms: number, timeZone: string): string {
  return formatCalendarDate(ymdInZone(ms, timeZone), 'date', { weekday: 'short' });
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'a product';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function line(what: string, h: GrazingHold, timeZone: string): string {
  if (h.state === 'dated' && h.clearsAtMs !== null) {
    return `${what} clear on ${holdDate(h.clearsAtMs, timeZone)}`;
  }
  if (h.state === 'prohibited') {
    return `${what} not allowed: the label for ${list(h.products)} forbids it on pasture`;
  }
  return `${what} on hold for food animals: the label interval for ${list(h.products)} is not on file yet. The owner can add it from the label.`;
}

export function grazingLines(g: AreaGrazing, timeZone: string): string[] {
  const out: string[] = [];
  if (g.graze) out.push(line('Grazing', g.graze, timeZone));
  if (g.milking) out.push(line('Milking animals', g.milking, timeZone));
  if (g.hay) out.push(line('Hay cutting', g.hay, timeZone).replace(' for food animals', ''));
  if (g.manureCarryover) {
    out.push(
      'Manure from animals that graze here can carry weed killer that harms gardens. Keep it off crops and compost.'
    );
  }
  return out;
}

export function grazingSection(
  g: AreaGrazing | null | undefined,
  timeZone: string
): CardSection | null {
  if (!g) return null;
  const items = grazingLines(g, timeZone);
  if (!items.length) return null;
  return { title: 'Grazing', items, safety: true, provenance: g.attested ? 'manual' : 'plugin' };
}

/** The Area Card with its grazing holds added. Unchanged when nothing is held. */
export function withGrazing(
  card: CardModel,
  g: AreaGrazing | null | undefined,
  timeZone: string
): CardModel {
  const section = grazingSection(g, timeZone);
  if (!section) return card;
  const added: CardProvenance[] = [{ source: 'plugin', detail: 'label intervals' }];
  if (g?.attested) added.push({ source: 'manual', detail: 'label interval entered by you' });
  return {
    ...card,
    sections: [section, ...card.sections],
    provenance: mergeProvenance([...card.provenance, ...added])
  };
}

/** Whether a label time is missing, which only the owner can add (C-27). */
export function needsLabelTime(g: AreaGrazing | null | undefined): boolean {
  if (!g) return false;
  return [g.graze, g.milking, g.hay].some((h) => h?.state === 'unknown');
}

/** The owner's link to add the missing time, as a Card link. */
export function withGrazingTimeLink(
  card: CardModel,
  g: AreaGrazing | null | undefined,
  areaId: string,
  canEdit: boolean
): CardModel {
  if (!canEdit || !needsLabelTime(g)) return card;
  return {
    ...card,
    links: [
      ...(card.links ?? []),
      {
        label: 'Add grazing times from the label',
        href: `/plan/areas/${encodeURIComponent(areaId)}/grazing`
      }
    ]
  };
}
