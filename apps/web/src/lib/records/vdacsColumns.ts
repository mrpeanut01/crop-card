/** Column text for the VDACS audit PDF. */

export type ProductRate = { amount: number; unit: string } | undefined;

export function perAcre(rate: ProductRate): string {
  if (!rate) return '';
  return `${rate.amount} ${rate.unit}${rate.unit.includes('/') ? '' : '/A'}`;
}

function trimAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function areaTreatedLine(acres: number | null | undefined): string {
  return typeof acres === 'number' && acres > 0 ? `${trimAmount(acres)} ac` : 'Not on file';
}

export function totalAppliedLine(
  products: ReadonlyArray<{ name: string; rate: ProductRate }>,
  acres: number | null | undefined
): string {
  if (!(typeof acres === 'number' && acres > 0)) return '—';
  return products
    .map((p) =>
      p.rate
        ? `${p.name}: ${trimAmount(p.rate.amount * acres)} ${p.rate.unit.split('/')[0]}`
        : `${p.name}: see rate`
    )
    .join('\n');
}

export function conditionsText(parts: string, provenance: string | undefined): string {
  return provenance === 'default' ? `${parts} (defaults, not measured)` : parts;
}
