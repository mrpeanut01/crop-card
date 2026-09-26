import { isDesignable, type AreaKind } from './areaKinds';

export { designerHref } from '$lib/garden/design';

/** Gardens and greenhouses open in the 30E garden designer; other kinds have none. */
export function designerState(kind: AreaKind): 'none' | 'available' {
  return isDesignable(kind) ? 'available' : 'none';
}
