import { isDesignable, type AreaKind } from './areaKinds';

const designerPages = import.meta.glob('/src/routes/plan/areas/*/design/+page.svelte');

/** True once the garden designer route has shipped; until then the Area Card
 *  shows its button as "Coming soon" rather than linking to a 404. */
export const DESIGNER_AVAILABLE = Object.keys(designerPages).length > 0;

export function designerHref(areaId: string): string {
  return `/plan/areas/${encodeURIComponent(areaId)}/design`;
}

export function designerState(
  kind: AreaKind,
  available = DESIGNER_AVAILABLE
): 'none' | 'available' | 'coming-soon' {
  if (!isDesignable(kind)) return 'none';
  return available ? 'available' : 'coming-soon';
}
