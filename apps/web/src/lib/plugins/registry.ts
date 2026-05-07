import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import { detectBypass, type BypassError } from './bypassCheck';
import { pluginSchema, type CropPlugin, type HerbicidePlugin, type Plugin } from './schemas';

export interface PluginRecord {
  plugin: Plugin;
  /** SHA-256 of the canonical JSON, persisted on every spray for traceability. */
  hash: string;
}

export class PluginRegistrationError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[]
  ) {
    super(message);
    this.name = 'PluginRegistrationError';
  }
}

function hashPlugin(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class PluginRegistry {
  private readonly byId = new Map<string, PluginRecord>();

  register(rawJson: unknown): PluginRecord {
    const parsed = pluginSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new PluginRegistrationError(
        'plugin failed schema validation',
        issuesFromZod(parsed.error)
      );
    }

    const bypass = detectBypass(parsed.data, (id) => this.cropFamilyOf(id));
    if (bypass.length > 0) {
      throw new PluginRegistrationError(
        'plugin attempts to bypass safety kernel',
        issuesFromBypass(bypass)
      );
    }

    const record: PluginRecord = { plugin: parsed.data, hash: hashPlugin(rawJson) };
    this.byId.set(parsed.data.pluginId, record);
    return record;
  }

  get(pluginId: string): PluginRecord | undefined {
    return this.byId.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.byId.has(pluginId);
  }

  all(): PluginRecord[] {
    return Array.from(this.byId.values());
  }

  size(): number {
    return this.byId.size;
  }

  /** Lookup helper used by the bypass check (and future safety queries). */
  cropFamilyOf(cropPluginId: string): CropFamily | undefined {
    const rec = this.byId.get(cropPluginId);
    if (!rec || rec.plugin.type !== 'crop') return undefined;
    return (rec.plugin as CropPlugin).cropFamily;
  }

  crops(): CropPlugin[] {
    return this.all()
      .map((r) => r.plugin)
      .filter((p): p is CropPlugin => p.type === 'crop');
  }

  herbicides(): HerbicidePlugin[] {
    return this.all()
      .map((r) => r.plugin)
      .filter((p): p is HerbicidePlugin => p.type === 'herbicide');
  }
}

function issuesFromZod(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function issuesFromBypass(errors: BypassError[]): { path: string; message: string }[] {
  return errors.map((e) => ({
    path: `labelClaims.safeForCropPluginIds.${e.cropPluginId}`,
    message: `${e.pluginId} declares ${e.chemistryClass} but claims safety on ${e.cropPluginId}: ${e.reason}`
  }));
}
