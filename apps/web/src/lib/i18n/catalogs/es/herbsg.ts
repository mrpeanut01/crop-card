import type { MessageKey } from '../en';

/** #870. New Spanish, for the proofreader. */
export const esHerbsg: Partial<Record<MessageKey, string>> = {
  'herbsg.api.skipNotFound': 'No se encontró ese riego saltado.',
  'herbsg.api.skipUndoAskOwner':
    'Solo el dueño, o quien lo anotó en las últimas 48 horas, puede deshacer este salto. Pregúntale al dueño.',
  'herbsg.api.skipUndoReadOnly':
    'Los inspectores pueden ver los registros de riego, pero no cambiarlos. Pregúntale al dueño.',
  'herbsg.api.sharesIncomplete': 'Da una parte para cada Área y bancal que riega, o para ninguno.',
  'herbsg.api.sharesTotal': 'Las partes deben sumar 100%.',
  'herbsg.api.runningSinceFuture': '"Riega desde" no puede ser después de hoy.',

  'herbsg.skip.title': 'Riegos saltados',
  'herbsg.skip.lede':
    'Riegos que alguien marcó como que no regaron, de la última semana y de la próxima. Si deshaces uno, vuelve a contar como agua.',
  'herbsg.skip.none': 'No hay riegos saltados en la última semana ni en la próxima.',
  'herbsg.skip.line': '{timer}: riego saltado {when} ({reason}).',
  'herbsg.skip.pageLine': 'Saltado {when} ({reason})',
  'herbsg.skip.reason.did-not-run': 'no regó',
  'herbsg.skip.reason.turned-off-for-rain': 'apagado por la lluvia',
  'herbsg.skip.reason.other': 'otro motivo',
  'herbsg.skip.undo': 'Deshacer',
  'herbsg.skip.undoLabel': 'Deshacer el salto de {timer} {when}',
  'herbsg.skip.undone': 'Salto deshecho. Ese riego vuelve a contar como agua.',
  'herbsg.skip.undoOffline':
    'Para deshacer hace falta conexión. Inténtalo cuando vuelvas a tener señal.',
  'herbsg.skip.undoError': 'No se deshizo. Inténtalo de nuevo.',

  'herbsg.editor.runningSince': 'Riega desde (opcional)',
  'herbsg.editor.runningSinceHint':
    'Si el temporizador ya regaba con este horario antes de que lo anotaras aquí, escribe el día en que empezó. Sus riegos desde ese día cuentan como agua.',
  'herbsg.editor.runningSinceSet': 'Riega desde el {date}',
  'herbsg.editor.err.runningSince': 'Elige un día que no sea después de hoy.',
  'herbsg.editor.gpmHint':
    'Si riega más de un Área o bancal, los galones se reparten según el tamaño, a menos que escribas la parte de cada uno. Los galones solo cuentan donde el Área o el bancal tiene tamaño.',

  'herbsg.split.title': 'Cómo se reparten los galones',
  'herbsg.split.inchesWin':
    'Las pulgadas por riego están anotadas, así que cada riego cuenta esas pulgadas en todo lo que riega.',
  'herbsg.split.size': '{name}: {pct}% de los galones, según el tamaño',
  'herbsg.split.typed': '{name}: {pct}% de los galones',
  'herbsg.split.prov.size': 'Repartido según el tamaño de cada Área y bancal',
  'herbsg.split.unknown.no-size':
    'No se sabe cómo se reparten: un Área o bancal de aquí no tiene tamaño. Anota su tamaño en el mapa de la finca, o escribe la parte de cada uno.',
  'herbsg.split.unknown.overlap':
    'No se sabe cómo se reparten: un bancal está dentro de un Área que este temporizador también riega. Escribe la parte de cada uno.',
  'herbsg.split.unknown.shares':
    'No se sabe cómo se reparten: las partes que escribiste ya no suman 100%. Escríbelas de nuevo.',
  'herbsg.split.typeShares': 'Escribir la parte de los galones de cada uno',
  'herbsg.split.shareLabel': 'Parte de {name} (%)',
  'herbsg.split.total': 'Total: {pct}%',
  'herbsg.split.err.total': 'Las partes deben sumar 100%.',

  'herbsg.brief.earlierTitle': 'Tu conversación anterior',
  'herbsg.brief.readOnlyNote':
    'Claude no está activado para esta finca, así que puedes leer tu conversación anterior, pero no seguirla.'
};
