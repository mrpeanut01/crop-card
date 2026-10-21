import type { MessageKey } from '../en';

/** Close-out CO-4 Spanish (`en/herbinfuse.ts`), for the proofreader with the
 *  rest of the Phase 37 Spanish (#868). */
export const esHerbinfuse: Partial<Record<MessageKey, string>> = {
  'herbinfuse.method.oil': 'En infusión en aceite',
  'herbinfuse.method.vinegar': 'En infusión en vinagre',
  'herbinfuse.safety.oil':
    'El aceite de hierbas puede causar botulismo. Guárdalo en el refrigerador y tíralo {days} días después de prepararlo.',
  'herbinfuse.safety.vinegar':
    'Usa solo vinagre comprado en la tienda. Guarda el vinagre de hierbas en el refrigerador o en un lugar fresco, y tíralo sin probarlo si le sale moho, hace burbujas o se pone turbio o viscoso.'
};
