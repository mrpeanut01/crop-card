import { getContext, setContext } from 'svelte';
import type { CoopSpeciesOption } from './coopCapacity';

/** What the coop or pen form needs to suggest a capacity: the species it
 *  can pick from, the farm's default and who already lives on each Area.
 *  Set by pages that load species (the farm map); without it the form
 *  falls back to a plain typed number. */
export interface CoopContext {
  options: CoopSpeciesOption[];
  farmDefault: string | null;
  housedByArea: Readonly<Record<string, readonly string[]>>;
}

export const COOP_CONTEXT_KEY = Symbol('coop-species');
const KEY = COOP_CONTEXT_KEY;

export function setCoopContext(get: () => CoopContext): void {
  setContext(KEY, get);
}

export function getCoopContext(): (() => CoopContext) | undefined {
  return getContext<(() => CoopContext) | undefined>(KEY);
}
