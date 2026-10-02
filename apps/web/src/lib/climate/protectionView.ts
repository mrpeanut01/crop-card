/**
 * What `GET/POST /api/blocks/:id/protections` return, and the client calls
 * behind the cover chips and the SetupProtection sheet. Client-safe.
 */

import type { BlockProtection, ProtectionKind } from './protection';
import type { EffectiveFrost } from './effectiveFrost';
import { t } from '$lib/i18n';

export interface BlockProtectionView extends BlockProtection {
  notes: string | null;
  createdAt: number;
}

export interface BedFrostView {
  /** Local calendar days, yyyy-mm-dd. */
  lastSpring: string;
  firstFall: string;
  frostFree: boolean;
  /** The farm's own dates, for "3 weeks earlier than the farm". */
  farmLastSpring: string;
  farmFirstFall: string;
  summary: string | null;
}

export interface BlockCoversResponse {
  protections: BlockProtectionView[];
  seasonYear: number;
  effectiveFrost: EffectiveFrost;
  frost: BedFrostView;
}

export interface NewCoverInput {
  kind: ProtectionKind;
  springShiftDays?: number | null;
  fallShiftDays?: number | null;
  installedOn?: number | null;
  removedOn?: number | null;
  seasonYear?: number | null;
  notes?: string | null;
}

async function readError(res: Response, locale?: string | null): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (body?.error ?? body?.message) return (body?.error ?? body?.message) as string;
  if (!locale) return `Could not save (HTTP ${res.status}).`;
  return t(locale, 'climate.cover.err.http', { status: res.status });
}

export async function fetchBlockCovers(
  blockId: string,
  year?: number,
  fetcher: typeof fetch = fetch,
  locale?: string | null
): Promise<BlockCoversResponse> {
  const q = year ? `?year=${year}` : '';
  const res = await fetcher(`/api/blocks/${encodeURIComponent(blockId)}/protections${q}`);
  if (!res.ok) throw new Error(await readError(res, locale));
  return (await res.json()) as BlockCoversResponse;
}

export async function addBlockCover(
  blockId: string,
  input: NewCoverInput,
  year?: number,
  fetcher: typeof fetch = fetch,
  locale?: string | null
): Promise<BlockCoversResponse> {
  const q = year ? `?year=${year}` : '';
  const res = await fetcher(`/api/blocks/${encodeURIComponent(blockId)}/protections${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(await readError(res, locale));
  return (await res.json()) as BlockCoversResponse;
}

export async function removeBlockCover(
  blockId: string,
  protectionId: string,
  fetcher: typeof fetch = fetch,
  locale?: string | null
): Promise<void> {
  const res = await fetcher(
    `/api/blocks/${encodeURIComponent(blockId)}/protections/${encodeURIComponent(protectionId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(await readError(res, locale));
}

/** "Spring 21 days earlier" style line for one side of a cover. */
export function shiftText(
  side: 'spring' | 'fall',
  days: number | null,
  locale?: string | null
): string {
  const spring = side === 'spring';
  if (days === null)
    return t(locale, spring ? 'climate.shift.springUnknown' : 'climate.shift.fallUnknown');
  if (days === 0) return t(locale, spring ? 'climate.shift.springNone' : 'climate.shift.fallNone');
  return t(locale, spring ? 'climate.shift.springEarlier' : 'climate.shift.fallLater', {
    count: days
  });
}
