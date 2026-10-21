import type { MessageKey } from '../en';

/** #869 Spanish, for the proofreader. */
export const esHerbsh: Partial<Record<MessageKey, string>> = {
  'herbsh.marks.kind.problem': 'Problema',
  'herbsh.marks.key.label': 'Figuras en la foto',
  'herbsh.marks.key.step': 'Círculos y recuadros de línea continua: un paso a seguir.',
  'herbsh.marks.key.problem':
    'Rombos y recuadros punteados: algo que no se ve bien. No dicen qué es.',
  'herbsh.marks.extension':
    '¿No sabes qué es? La oficina de extensión de tu condado puede ayudarte.',

  'herbsh.print.open': 'Imprimir',
  'herbsh.print.openFor': 'Imprimir la foto marcada del {date}',
  'herbsh.print.title': 'Imprimir la foto marcada',
  'herbsh.print.letter': 'Carta, vertical',
  'herbsh.print.letterHint': 'La foto, todas las marcas y todos los pasos en una página.',
  'herbsh.print.index': 'Ficha de 4×6',
  'herbsh.print.indexHint': 'La foto y sus marcas numeradas. Sin los pasos.',
  'herbsh.print.go': 'Imprimir',
  'herbsh.print.kicker': 'Foto marcada',
  'herbsh.print.photoFrom': 'Foto del {date}',
  'herbsh.print.photoAlt': 'La foto con marcas numeradas',
  'herbsh.print.line': '{kind}: {label}',

  'herbsh.copy.heading': 'Guardado en este teléfono',
  'herbsh.copy.savedFrom': 'Copia guardada el {date}.'
};
