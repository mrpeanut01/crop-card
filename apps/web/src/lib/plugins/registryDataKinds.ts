/**
 * Registry passes for the Phase 32 data-only kinds (species, animal-health
 * products and pest models) and orchard calendars (ruling OC-8). Like bed
 * recipes, each lives in its own folder
 * under plugins/, is parsed with its own strict schema and never joins the
 * library `pluginSchema`. Animal-health label uses must name a registered
 * species plugin; orchard calendar host crops must name registered crop
 * plugins in a host family, and the edition must be this year's or last
 * year's.
 *
 * Server-only (node:fs).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { collectJsonFiles } from './loader';
import { PluginRegistrationError } from './registry';
import {
  animalHealthPluginSchema,
  orchardCalendarPluginSchema,
  pestModelPluginSchema,
  speciesPluginSchema,
  type AnimalHealthPlugin,
  type OrchardCalendarPlugin,
  type PestModelPlugin,
  type SpeciesPlugin
} from './schemas';

export const SPECIES_DIR = 'species';
export const ANIMAL_HEALTH_DIR = 'animal-health';
export const PEST_MODELS_DIR = 'pest-models';
export const ORCHARD_CALENDARS_DIR = 'orchard-calendars';

type Issue = { path: string; message: string };

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginRegistrationError(
      `${label} failed schema validation`,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return parsed.data;
}

export interface SpeciesLookup {
  isSpecies(pluginId: string): boolean;
}

export function validateSpecies(raw: unknown): SpeciesPlugin {
  return parseOrThrow(speciesPluginSchema, raw, 'species plugin');
}

export function validateAnimalHealth(raw: unknown, species: SpeciesLookup): AnimalHealthPlugin {
  const plugin = parseOrThrow(animalHealthPluginSchema, raw, 'animal-health plugin');
  const issues: Issue[] = plugin.labelUses
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => !species.isSpecies(u.speciesId))
    .map(({ u, i }) => ({
      path: `labelUses.${i}.speciesId`,
      message: `${u.speciesId} is not a registered species plugin`
    }));
  if (issues.length > 0) {
    throw new PluginRegistrationError('animal-health plugin names an unknown species', issues);
  }
  return plugin;
}

export function validatePestModel(raw: unknown): PestModelPlugin {
  return parseOrThrow(pestModelPluginSchema, raw, 'pest model');
}

export interface CropLookup {
  /** The crop family of a registered crop plugin, or undefined when the id
   *  is not a crop plugin. */
  cropFamilyOf(pluginId: string): string | undefined;
}

export interface OrchardCalendarContext extends CropLookup {
  currentYear: number;
}

export function validateOrchardCalendar(
  raw: unknown,
  ctx: OrchardCalendarContext
): OrchardCalendarPlugin {
  const plugin = parseOrThrow(orchardCalendarPluginSchema, raw, 'orchard calendar');
  const issues: Issue[] = [];
  const edition = Number(plugin.edition);
  if (edition !== ctx.currentYear && edition !== ctx.currentYear - 1) {
    issues.push({
      path: 'edition',
      message: `edition ${plugin.edition} is not ${ctx.currentYear} or ${ctx.currentYear - 1}: replace the file with the current edition`
    });
  }
  const families: readonly string[] = plugin.hostCropFamilies;
  plugin.hostCropPluginIds.forEach((id, i) => {
    const family = ctx.cropFamilyOf(id);
    if (family === undefined) {
      issues.push({
        path: `hostCropPluginIds.${i}`,
        message: `${id} is not a registered crop plugin`
      });
    } else if (!families.includes(family)) {
      issues.push({
        path: `hostCropPluginIds.${i}`,
        message: `${id} is in family ${family}, which is not in hostCropFamilies`
      });
    }
  });
  if (issues.length > 0) {
    throw new PluginRegistrationError('orchard calendar failed registry checks', issues);
  }
  return plugin;
}

export class DataKindRegistry<T extends { pluginId: string }> {
  private readonly byId = new Map<string, T>();

  constructor(
    readonly kind: string,
    private readonly validate: (raw: unknown) => T
  ) {}

  register(raw: unknown): T {
    const plugin = this.validate(raw);
    if (this.byId.has(plugin.pluginId)) {
      throw new PluginRegistrationError(`duplicate ${this.kind}`, [
        { path: 'pluginId', message: `${plugin.pluginId} is already registered` }
      ]);
    }
    this.byId.set(plugin.pluginId, plugin);
    return plugin;
  }

  get(pluginId: string): T | undefined {
    return this.byId.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.byId.has(pluginId);
  }

  delete(pluginId: string): boolean {
    return this.byId.delete(pluginId);
  }

  all(): T[] {
    return [...this.byId.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }
}

export interface DataKindFailure {
  file: string;
  error: Error;
}

async function loadInto<T extends { pluginId: string }>(
  registry: DataKindRegistry<T>,
  dir: string,
  failed: DataKindFailure[]
): Promise<void> {
  for (const file of await collectJsonFiles(dir)) {
    try {
      registry.register(JSON.parse(await readFile(file, 'utf-8')));
    } catch (error) {
      failed.push({ file, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
}

export interface Phase32DataKinds {
  species: DataKindRegistry<SpeciesPlugin>;
  animalHealth: DataKindRegistry<AnimalHealthPlugin>;
  pestModels: DataKindRegistry<PestModelPlugin>;
  orchardCalendars: DataKindRegistry<OrchardCalendarPlugin>;
  failed: DataKindFailure[];
  /** Calendars dropped because a newer edition hosts the same crop for the
   *  same audience, or refused because another of the same edition does
   *  (ruling OP-3). */
  supersededCalendars: { pluginId: string; reason: string }[];
  /** Calendars the loader dropped (an expired edition, a refused file, or
   *  two of one edition), by the raw crops and audience they named, so a
   *  crop can read "This crop's seasonal calendar is out of date" (OP-28).
   *  Nothing else of a dropped file is kept. */
  droppedCalendars: DroppedCalendar[];
}

export interface DroppedCalendar {
  file: string | null;
  pluginId: string | null;
  audience: 'commercial' | 'home' | null;
  hostCropPluginIds: string[];
}

/** The crops and audience a dropped calendar file named, read only when
 *  they have the right shape; anything else names no crop. */
export function droppedCalendarHosts(raw: unknown, file: string | null): DroppedCalendar {
  const r =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(r.hostCropPluginIds)
    ? r.hostCropPluginIds.filter(
        (x): x is string => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(x)
      )
    : [];
  const audience = r.audience === 'commercial' || r.audience === 'home' ? r.audience : null;
  const pluginId = typeof r.pluginId === 'string' ? r.pluginId : null;
  return {
    file,
    pluginId,
    audience,
    hostCropPluginIds:
      Array.isArray(r.hostCropPluginIds) && ids.length === r.hostCropPluginIds.length ? ids : []
  };
}

export interface DataKindLoadOptions {
  /** Orchard calendar host crops resolve against it (ruling OP-15). */
  crops: CropLookup;
  now?: Date;
}

/** Ruling OP-3: at most one calendar per (host crop, audience). The newest
 *  edition wins; two of the same edition are both refused. */
export function resolveCalendarConflicts(
  calendars: DataKindRegistry<OrchardCalendarPlugin>
): { pluginId: string; reason: string }[] {
  const byKey = new Map<string, OrchardCalendarPlugin[]>();
  for (const c of calendars.all()) {
    for (const crop of c.hostCropPluginIds) {
      const key = `${crop}|${c.audience}`;
      byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
  }
  const dropped = new Map<string, string>();
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const [crop, audience] = key.split('|');
    const newest = Math.max(...group.map((c) => Number(c.edition)));
    const top = group.filter((c) => Number(c.edition) === newest);
    for (const c of group) {
      if (Number(c.edition) < newest) {
        dropped.set(c.pluginId, `superseded for ${crop} (${audience}) by edition ${newest}`);
      } else if (top.length > 1) {
        dropped.set(
          c.pluginId,
          `refused: ${top.map((t) => t.pluginId).join(', ')} both host ${crop} (${audience}) in edition ${newest}`
        );
      }
    }
  }
  for (const id of dropped.keys()) calendars.delete(id);
  return [...dropped].map(([pluginId, reason]) => ({ pluginId, reason }));
}

/** Loads species first, so animal-health label uses can be checked against
 *  them. Missing folders yield empty registries. */
export async function loadPhase32DataKinds(
  pluginsRoot: string,
  opts: DataKindLoadOptions
): Promise<Phase32DataKinds> {
  const failed: DataKindFailure[] = [];
  const species = new DataKindRegistry('species plugin', validateSpecies);
  await loadInto(species, path.join(pluginsRoot, SPECIES_DIR), failed);
  const animalHealth = new DataKindRegistry('animal-health plugin', (raw) =>
    validateAnimalHealth(raw, { isSpecies: (id) => species.has(id) })
  );
  await loadInto(animalHealth, path.join(pluginsRoot, ANIMAL_HEALTH_DIR), failed);
  const pestModels = new DataKindRegistry('pest model', validatePestModel);
  await loadInto(pestModels, path.join(pluginsRoot, PEST_MODELS_DIR), failed);
  const calendarContext: OrchardCalendarContext = {
    cropFamilyOf: (id) => opts.crops.cropFamilyOf(id),
    currentYear: (opts.now ?? new Date()).getUTCFullYear()
  };
  const orchardCalendars = new DataKindRegistry('orchard calendar', (raw) =>
    validateOrchardCalendar(raw, calendarContext)
  );
  const calendarFailed: DataKindFailure[] = [];
  const calendarDir = path.join(pluginsRoot, ORCHARD_CALENDARS_DIR);
  await loadInto(orchardCalendars, calendarDir, calendarFailed);
  failed.push(...calendarFailed);
  const droppedCalendars: DroppedCalendar[] = [];
  for (const f of calendarFailed) {
    try {
      droppedCalendars.push(
        droppedCalendarHosts(JSON.parse(await readFile(f.file, 'utf-8')), f.file)
      );
    } catch {
      continue;
    }
  }
  const before = new Map(orchardCalendars.all().map((c) => [c.pluginId, c]));
  const supersededCalendars = resolveCalendarConflicts(orchardCalendars);
  for (const s of supersededCalendars) {
    const c = before.get(s.pluginId);
    if (c && s.reason.startsWith('refused')) droppedCalendars.push(droppedCalendarHosts(c, null));
  }
  return {
    species,
    animalHealth,
    pestModels,
    orchardCalendars,
    failed,
    supersededCalendars,
    droppedCalendars
  };
}
