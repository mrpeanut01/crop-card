/** #869 (Phase 37 follow-up): problem marks, the marked photo print sheet and
 *  the offline copy of marked journal entries. Keys start `herbsh.`; only
 *  this follow-up edits this file. */
export const enHerbsh = {
  'herbsh.marks.kind.problem': 'Problem',
  'herbsh.marks.key.label': 'Shapes on the photo',
  'herbsh.marks.key.step': 'Circles and solid boxes: a step to take.',
  'herbsh.marks.key.problem':
    'Diamonds and dashed boxes: something that looks wrong. They do not say what it is.',
  'herbsh.marks.extension': 'Not sure what this is? Your county extension office can help.',

  'herbsh.print.open': 'Print',
  'herbsh.print.openFor': 'Print the marked photo from {date}',
  'herbsh.print.title': 'Print the marked photo',
  'herbsh.print.letter': 'Letter, portrait',
  'herbsh.print.letterHint': 'The photo, every mark and every step on one page.',
  'herbsh.print.index': '4×6 index card',
  'herbsh.print.indexHint': 'The photo and its numbered marks. The steps are left off.',
  'herbsh.print.go': 'Print',
  'herbsh.print.kicker': 'Marked photo',
  'herbsh.print.photoFrom': 'Photo from {date}',
  'herbsh.print.photoAlt': 'The photo with numbered marks',
  'herbsh.print.line': '{kind}: {label}',

  'herbsh.copy.heading': 'Saved on this phone',
  'herbsh.copy.savedFrom': 'Saved copy from {date}.'
} as const;
