/**
 * Browser-side loading of the forage advisory (Phase 33C, M-53): fetched
 * when a card or sheet opens, never in a page loader. A failed fetch is
 * remembered as failed so the card says so instead of going quiet.
 */

import type { CardModel } from '$lib/cards/model';
import type { ForageAdvisory } from '$lib/forage/advisory';
import { withForageAdvisory } from '$lib/farm/forageAdvisory';

export interface ForageAdvisoryEntry {
  advisory: ForageAdvisory | null;
  failed: boolean;
}

export type ForageQuery = { fieldId: string } | { hayCuttingId: string };

function queryKey(q: ForageQuery): string {
  return 'fieldId' in q ? `field:${q.fieldId}` : `cut:${q.hayCuttingId}`;
}

export async function fetchForageAdvisory(
  q: ForageQuery,
  fetcher: typeof fetch = fetch
): Promise<ForageAdvisoryEntry> {
  const params = new URLSearchParams(
    'fieldId' in q ? { fieldId: q.fieldId } : { hayCuttingId: q.hayCuttingId }
  );
  try {
    const res = await fetcher(`/api/forage/advisory?${params}`);
    if (!res.ok) return { advisory: null, failed: true };
    const out = (await res.json()) as { advisory?: ForageAdvisory };
    if (!out.advisory || !Array.isArray(out.advisory.items))
      return { advisory: null, failed: true };
    return { advisory: out.advisory, failed: false };
  } catch {
    return { advisory: null, failed: true };
  }
}

/** A small per-component cache keyed by Area or cutting. */
export class ForageAdvisoryCache {
  #entries = $state<Record<string, ForageAdvisoryEntry>>({});
  #inFlight = new Set<string>();

  get(q: ForageQuery): ForageAdvisoryEntry | undefined {
    return this.#entries[queryKey(q)];
  }

  /** Loads once; `force` refetches (after a new test is saved). */
  async load(q: ForageQuery, force = false): Promise<void> {
    const key = queryKey(q);
    if (this.#inFlight.has(key) || (!force && this.#entries[key])) return;
    this.#inFlight.add(key);
    try {
      this.#entries[key] = await fetchForageAdvisory(q);
    } finally {
      this.#inFlight.delete(key);
    }
  }

  /** The Area Card with whatever is loaded so far. */
  decorate(card: CardModel, fieldId: string, locale?: string | null): CardModel {
    const e = this.get({ fieldId });
    return e ? withForageAdvisory(card, e.advisory, e.failed, locale) : card;
  }
}
