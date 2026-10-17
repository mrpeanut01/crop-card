import type { MessageKey } from '../en';

/** Phase 37F Spanish, waiting for the proofreader (C-11). */
export const esHerbsf: Partial<Record<MessageKey, string>> = {
  'herbsf.title': 'Dónde cortar',
  'herbsf.marks.refused': 'Claude no pudo poner marcas en esta foto.',
  'herbsf.marks.legend': 'Qué significan las marcas',
  'herbsf.marks.steps': 'Pasos',
  'herbsf.marks.photoAlt': 'Tu foto con las marcas dibujadas',
  'herbsf.marks.mark': 'Marca {n}: {kind}, {label}',
  'herbsf.marks.kind.cut': 'Cortar',
  'herbsf.marks.kind.pinch': 'Despuntar',
  'herbsf.marks.kind.harvest': 'Cosechar',
  'herbsf.marks.kind.leave': 'Dejar',
  'herbsf.marks.askOnline': 'Vuelve a preguntar cuando tengas señal para ver marcas en la foto.',
  'herbsf.drawing.title': 'Cómo crece este tipo de planta',
  'herbsf.drawing.lede':
    'Un dibujo para comparar con tu planta. Tu foto se muestra tal como la tomaste.',
  'herbsf.drawing.photoAlt': 'Tu foto',
  'herbsf.drawing.noSteps': 'Aún no hay pasos de poda con fuente para este cultivo',
  'herbsf.drawing.alt.cut-and-come-again-leafy': 'Dibujo de una planta frondosa con muchos tallos',
  'herbsf.drawing.alt.woody-perennial-herb':
    'Dibujo de una planta pequeña y arbustiva con tallos leñosos',
  'herbsf.drawing.alt.clumping-herb': 'Dibujo de una mata de hojas que crece desde la base',
  'herbsf.drawing.alt.vining': 'Dibujo de una enredadera que crece por un alambre',
  'herbsf.drawing.alt.tree': 'Dibujo de un árbol pequeño con tronco y ramas',
  'herbsf.care.basil-genovese.pinch-stems.title':
    'Despunta los tallos conforme se alargan para que el crecimiento sea tupido y compacto.'
};
