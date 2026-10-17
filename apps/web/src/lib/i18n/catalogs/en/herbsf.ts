/** Phase 37F (photo marks). Keys start `herbsf.`; only cluster 37F
 *  edits this file (C-1). `herbsf.care.<pluginId>.<key>.<part>` holds the
 *  shipped English of each crop care task, word for word as the plugin. */
export const enHerbsf = {
  'herbsf.title': 'Where to cut',
  'herbsf.marks.refused': 'Claude could not place marks on this photo.',
  'herbsf.marks.legend': 'What the marks mean',
  'herbsf.marks.steps': 'Steps',
  'herbsf.marks.photoAlt': 'Your photo with the marks drawn on it',
  'herbsf.marks.mark': 'Mark {n}: {kind}, {label}',
  'herbsf.marks.kind.cut': 'Cut',
  'herbsf.marks.kind.pinch': 'Pinch',
  'herbsf.marks.kind.harvest': 'Harvest',
  'herbsf.marks.kind.leave': 'Leave',
  'herbsf.marks.askOnline': 'Ask again when online to get marks on the photo.',
  'herbsf.drawing.title': 'How this kind of plant grows',
  'herbsf.drawing.lede':
    'A drawing to compare with your plant. Your photo is shown as you took it.',
  'herbsf.drawing.photoAlt': 'Your photo',
  'herbsf.drawing.noSteps': 'No pruning steps sourced yet for this crop',
  'herbsf.drawing.alt.cut-and-come-again-leafy': 'Line drawing of a leafy, many-stemmed plant',
  'herbsf.drawing.alt.woody-perennial-herb':
    'Line drawing of a small shrubby plant with woody stems',
  'herbsf.drawing.alt.clumping-herb': 'Line drawing of a clump of leaves growing from the base',
  'herbsf.drawing.alt.vining': 'Line drawing of a vine growing along a wire',
  'herbsf.drawing.alt.tree': 'Line drawing of a small tree with a trunk and branches',
  'herbsf.care.basil-genovese.pinch-stems.title':
    'Pinch stems as they lengthen to promote bushy, compact growth.'
} as const;
