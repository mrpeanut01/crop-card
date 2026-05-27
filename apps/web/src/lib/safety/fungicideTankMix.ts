export interface FungicideTankMixInput {
  pluginId: string;
  displayName: string;
  fracCodes: string[];
}

export type FungicideTankMixSeverity = 'incompatible' | 'caution';

export interface FungicideTankMixIssue {
  severity: FungicideTankMixSeverity;
  code: 'COPPER_SULFUR_PHYTOTOXIC';
  message: string;
  productPluginIds: string[];
}

const COPPER_FRAC = 'M01';
const SULFUR_FRAC = 'M02';

export function checkFungicideTankMixCompat(
  products: ReadonlyArray<FungicideTankMixInput>
): FungicideTankMixIssue[] {
  const issues: FungicideTankMixIssue[] = [];

  const copperProducts = products.filter((p) => p.fracCodes.includes(COPPER_FRAC));
  const sulfurProducts = products.filter((p) => p.fracCodes.includes(SULFUR_FRAC));

  if (copperProducts.length > 0 && sulfurProducts.length > 0) {
    const involved = [...new Set([...copperProducts, ...sulfurProducts].map((p) => p.pluginId))];
    const labels =
      copperProducts.map((p) => p.displayName).join(', ') +
      ' + ' +
      sulfurProducts.map((p) => p.displayName).join(', ');
    issues.push({
      severity: 'incompatible',
      code: 'COPPER_SULFUR_PHYTOTOXIC',
      message: `Copper (FRAC M01) + sulfur (FRAC M02) tank-mix is phytotoxic — especially above 85°F. Apply separately at least 7 days apart. Products: ${labels}.`,
      productPluginIds: involved
    });
  }

  return issues;
}
