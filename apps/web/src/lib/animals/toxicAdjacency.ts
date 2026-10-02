/**
 * Toxic-plant advisory (Phase 32D, D5; Q14, D2-17). Pure and client-safe.
 * The server lists the crops in the ground on each Area that carry sourced
 * `animalToxicity` data, and this module matches them to the species that
 * live there. Advisory only: nothing here blocks a move or feeds the
 * safety kernel, and the callout can never be dismissed.
 */

import type { AnimalToxicity } from '$lib/plugins/schemas';
import type { CardModel, CardProvenance, CardSection } from '$lib/cards/model';
import { mergeProvenance } from '$lib/cards/model';
import { t } from '$lib/i18n';

export type ToxicityEntry = AnimalToxicity[number];
export type PlantPart = ToxicityEntry['parts'][number];
export type ToxicSeverity = ToxicityEntry['severity'];

/** One crop in the ground on an Area whose plugin lists animals it harms. */
export interface ToxicCrop {
  pluginId: string;
  name: string;
  toxicity: AnimalToxicity;
}

export type ToxicPlantsByArea = Record<string, ToxicCrop[]>;

export interface ToxicFinding {
  pluginId: string;
  name: string;
  speciesId: string;
  parts: PlantPart[];
  severity: ToxicSeverity;
  note?: string;
}

/** A planting on an Area, as the loaders see it. */
export interface AreaPlanting {
  areaId: string;
  cropPluginId: string;
}

export interface ToxicPluginView {
  name: string;
  toxicity: AnimalToxicity | undefined;
}

/** Group the plantings by Area, one entry per crop plugin, keeping only
 *  plugins with toxicity data. Areas with none are left out. */
export function toxicCropsByArea(
  plantings: readonly AreaPlanting[],
  pluginOf: (pluginId: string) => ToxicPluginView | null | undefined
): ToxicPlantsByArea {
  const out: ToxicPlantsByArea = {};
  const seen = new Set<string>();
  for (const p of plantings) {
    const key = `${p.areaId}\u0000${p.cropPluginId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const plugin = pluginOf(p.cropPluginId);
    if (!plugin?.toxicity?.length) continue;
    (out[p.areaId] ??= []).push({
      pluginId: p.cropPluginId,
      name: plugin.name,
      toxicity: plugin.toxicity
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Every crop and species pair where the crop can harm a species living
 *  there. Order follows the crops, then the species as given. */
export function toxicFindings(
  crops: readonly ToxicCrop[] | null | undefined,
  speciesIds: readonly string[]
): ToxicFinding[] {
  if (!crops?.length || speciesIds.length === 0) return [];
  const wanted = [...new Set(speciesIds)];
  const out: ToxicFinding[] = [];
  for (const crop of crops) {
    for (const speciesId of wanted) {
      const entry = crop.toxicity.find((t) => t.speciesIds.includes(speciesId));
      if (!entry) continue;
      out.push({
        pluginId: crop.pluginId,
        name: crop.name,
        speciesId,
        parts: [...entry.parts],
        severity: entry.severity,
        ...(entry.note ? { note: entry.note } : {})
      });
    }
  }
  return out;
}

export type SpeciesPlural = (speciesId: string) => string;

/** Plural lower-case species words from a species id → tile label map. */
export function pluralFrom(labels: Readonly<Record<string, string>>): SpeciesPlural {
  return (id) => (labels[id] ?? 'animals').toLowerCase();
}

export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const PART_WORD: Record<PlantPart, string> = {
  'whole-plant': 'all parts',
  leaves: 'leaves',
  stems: 'stems',
  roots: 'roots',
  tubers: 'tubers',
  flowers: 'flowers',
  fruit: 'fruit',
  'unripe-fruit': 'unripe fruit',
  seeds: 'seeds',
  pits: 'pits'
};

const SEVERITY_WORD: Record<ToxicSeverity, string> = {
  caution: 'Can harm',
  toxic: 'Poisonous to',
  'highly-toxic': 'Very poisonous to'
};

const SEVERITY_RANK: Record<ToxicSeverity, number> = { caution: 0, toxic: 1, 'highly-toxic': 2 };

function speciesInOrder(findings: readonly ToxicFinding[]): string[] {
  return [...new Set(findings.map((f) => f.speciesId))];
}

/** The one collapsed line: "2 plants here can harm goats". Null when
 *  nothing here harms the species living here. */
export function toxicSummary(
  findings: readonly ToxicFinding[],
  plural: SpeciesPlural
): string | null {
  if (findings.length === 0) return null;
  const plants = new Set(findings.map((f) => f.pluginId)).size;
  const who = joinWords(speciesInOrder(findings).map(plural));
  return `${plants} ${plants === 1 ? 'plant' : 'plants'} here can harm ${who}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** One line per crop: which parts, which animals and the plugin's note. */
export function toxicLines(findings: readonly ToxicFinding[], plural: SpeciesPlural): string[] {
  const byCrop = new Map<string, ToxicFinding[]>();
  for (const f of findings) byCrop.set(f.pluginId, [...(byCrop.get(f.pluginId) ?? []), f]);
  const lines: string[] = [];
  for (const list of byCrop.values()) {
    const bySeverity = new Map<ToxicSeverity, string[]>();
    for (const f of list)
      bySeverity.set(f.severity, [...(bySeverity.get(f.severity) ?? []), f.speciesId]);
    const harms = [...bySeverity.entries()]
      .sort((a, b) => SEVERITY_RANK[b[0]] - SEVERITY_RANK[a[0]])
      .map(([sev, ids]) => `${SEVERITY_WORD[sev]} ${joinWords(ids.map(plural))}.`);
    const all = [...new Set(list.flatMap((f) => f.parts))];
    const parts = (all.includes('whole-plant') ? (['whole-plant'] as PlantPart[]) : all).map(
      (p) => PART_WORD[p]
    );
    const notes = [...new Set(list.map((f) => f.note).filter((n): n is string => !!n))];
    lines.push([`${list[0].name}: ${capitalize(joinWords(parts))}.`, ...harms, ...notes].join(' '));
  }
  return lines;
}

export const TOXIC_ADVICE =
  'Keep animals from grazing or chewing these. If one has eaten some, call your vet.';

/** The Card section: its title is the collapsed line, its items the list. */
export function toxicSection(
  findings: readonly ToxicFinding[],
  plural: SpeciesPlural
): CardSection | null {
  const title = toxicSummary(findings, plural);
  if (!title) return null;
  return {
    title,
    items: [...toxicLines(findings, plural), TOXIC_ADVICE],
    provenance: 'plugin',
    safety: true,
    collapsible: true
  };
}

export const TOXIC_PROVENANCE: CardProvenance = {
  source: 'plugin',
  detail: 'toxic plant lists from the crop library'
};

/** The Card with the callout added, right after "Lives here" when the
 *  Card has it, else first. Unchanged when nothing here harms them. */
export function withToxicPlants(
  card: CardModel,
  crops: readonly ToxicCrop[] | null | undefined,
  speciesIds: readonly string[],
  plural: SpeciesPlural,
  locale?: string | null
): CardModel {
  const section = toxicSection(toxicFindings(crops, speciesIds), plural);
  if (!section) return card;
  const livesHere = t(locale, 'area.housing.livesHere');
  const at = card.sections.findIndex((s) => s.title === 'Lives here' || s.title === livesHere);
  const sections = [...card.sections];
  sections.splice(at + 1, 0, section);
  return {
    ...card,
    sections,
    provenance: mergeProvenance([...card.provenance, TOXIC_PROVENANCE])
  };
}
