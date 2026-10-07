/** #735: the blocks a pass will actually spray and record. Once the kernel
 *  has judged the selection, only blocks it passed count; a stopped block,
 *  or one with no verdict, is skipped when recording, so it must not size
 *  the mix, the tank fills or the product totals either. */
export function splitSprayable<B extends { id: string }>(
  selected: readonly B[],
  verdicts: ReadonlyMap<string, { ok: boolean }>
): { sprayable: B[]; stopped: B[] } {
  if (verdicts.size === 0) return { sprayable: [...selected], stopped: [] };
  const sprayable: B[] = [];
  const stopped: B[] = [];
  for (const b of selected) {
    if (verdicts.get(b.id)?.ok === true) sprayable.push(b);
    else stopped.push(b);
  }
  return { sprayable, stopped };
}

/** Acres the pass covers: the sum over sprayable blocks with a size. */
export function sprayableAcres(blocks: readonly { acres: number | null }[]): number {
  return blocks.reduce((sum, b) => sum + (b.acres != null && b.acres > 0 ? b.acres : 0), 0);
}
