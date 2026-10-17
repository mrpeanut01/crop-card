import type { MessageKey } from '../en';

/** Phase 37E. New Spanish, for the proofreader. */
export const esHerbse: Partial<Record<MessageKey, string>> = {
  'herbse.title': 'Riego',

  'herbse.api.scheduleIrrigationOnly': 'Solo un regador (equipo de riego) lleva un horario.',
  'herbse.api.bedNoArea': 'Ese bancal no está en un Área.',
  'herbse.api.skipTooFar': 'Elige un riego de la semana pasada o de la próxima.',

  'herbse.df.container': 'Cultivado en macetas o recipientes',
  'herbse.df.indoors': 'Dentro de casa, como en una ventana',

  'herbse.water.indoors': 'La lluvia no llega a las macetas de dentro. Revisa la tierra.',
  'herbse.water.bedIndoors': '{names}: la lluvia no les llega dentro. Revisa la tierra.',
  'herbse.water.timerNoAmount':
    '{timer} regó el {day}, pero no tiene anotadas las pulgadas por riego.',
  'herbse.water.bedTimerNoAmount':
    '{names}: {timer} regó el {day}, pero no tiene anotadas las pulgadas por riego.',
  'herbse.water.potHeat': 'Viene un día caluroso y una noche cálida: revisa las macetas hoy.',
  'herbse.water.checkSoil.one': 'Revisa la tierra primero: a {crops} le gusta seca.',
  'herbse.water.checkSoil.many': 'Revisa la tierra primero: a {crops} les gusta seca.',
  'herbse.water.checkSoilBed.one': '{bed}: revisa la tierra primero, a {crops} le gusta seca.',
  'herbse.water.checkSoilBed.many': '{bed}: revisa la tierra primero, a {crops} les gusta seca.',
  'herbse.water.mixed':
    '{bed} tiene plantas con distintas necesidades de agua; esto sigue a la que más necesita.',
  'herbse.water.needLine': '{bed} prefiere {level} ({crops}).',
  'herbse.need.low': 'la tierra seca',
  'herbse.need.medium': 'una humedad moderada',
  'herbse.need.high': 'la tierra húmeda',

  'herbse.when.today': 'hoy a las {time}',
  'herbse.when.tomorrow': 'mañana a las {time}',
  'herbse.when.day': 'el {day} a las {time}',

  'herbse.timer.next': '{timer} da {inches} {when}.',
  'herbse.timer.nextNoAmount': '{timer} riega {when} durante {minutes} min.',
  'herbse.timer.skipIt': '{timer} da {inches} {when}; la semana ya lleva {week}, sáltalo.',
  'herbse.timer.skipItNoAmount': '{timer} riega {when}; la semana ya lleva {week}, sáltalo.',
  'herbse.timer.skipAction': 'Saltar {timer} {when}',
  'herbse.timer.didNotRun': '{timer} no regó el {day}',
  'herbse.timer.setAmount': 'Anotar pulgadas por riego de {timer}',
  'herbse.timer.skipped': 'Saltado. Ese riego no contará como agua.',
  'herbse.timer.queued': 'Guardado en este teléfono. Se enviará cuando vuelvas a tener señal.',
  'herbse.timer.skipError': 'No se guardó. Inténtalo de nuevo.',

  'herbse.schedule.everyDay': 'Todos los días',
  'herbse.schedule.summary': '{days} a las {start} durante {minutes} min',
  'herbse.schedule.line': '{label}: {summary}',
  'herbse.schedule.lineInches': '{label}: {summary}, {inches} por riego',
  'herbse.schedule.factLabel': 'Temporizadores',
  'herbse.schedule.prov': 'El horario de tu temporizador',

  'herbse.method.drip': 'Goteo',
  'herbse.method.soaker': 'Manguera exudante',
  'herbse.method.sprinkler': 'Aspersor',

  'herbse.editor.title': 'Horario de riego',
  'herbse.editor.lede':
    'Anota lo que tiene programado el temporizador. Cada riego cuenta como agua en los bancales de abajo. La app nunca se conecta con el temporizador.',
  'herbse.editor.none': 'Aún no hay horario.',
  'herbse.editor.days': 'Días que riega',
  'herbse.editor.start': 'Hora de inicio',
  'herbse.editor.minutes': 'Minutos por riego',
  'herbse.editor.method': 'Tipo',
  'herbse.editor.inches': 'Pulgadas de agua por riego',
  'herbse.editor.inchesHint':
    'Escribe las pulgadas que da cada riego. Sin ese dato, los riegos cuentan como agua sin cantidad conocida y el consejo no puede decir si los bancales tuvieron suficiente.',
  'herbse.editor.gpm': 'Galones por minuto (opcional)',
  'herbse.editor.gpmHint':
    'Los galones solo cuentan cuando el temporizador riega un Área o un bancal, y ese Área o bancal tiene tamaño.',
  'herbse.editor.inchesSet': '{inches} in por riego',
  'herbse.editor.noInches': 'Pulgadas por riego sin anotar',
  'herbse.editor.save': 'Guardar horario',
  'herbse.editor.edit': 'Editar horario',
  'herbse.editor.set': 'Poner un horario',
  'herbse.editor.clear': 'Quitar horario',
  'herbse.editor.cancel': 'Cancelar',
  'herbse.editor.saving': 'Guardando…',
  'herbse.editor.saved': 'Guardado.',
  'herbse.editor.manual': 'Lo anotaste tú',
  'herbse.editor.askOwner': 'Pide al dueño que cambie el horario.',
  'herbse.editor.err.days': 'Elige al menos un día.',
  'herbse.editor.err.minutes': 'Los minutos deben ser un número entero de 1 a 720.',

  'herbse.targets.title': 'Qué riega',
  'herbse.targets.none':
    'Aún no está unido a un Área ni a un bancal, así que sus riegos no cuentan.',
  'herbse.targets.wholeArea': 'Todo {area}',
  'herbse.targets.save': 'Guardar qué riega',
  'herbse.targets.noAreas': 'Primero dibuja un Área de huerto o de campo en el mapa de la finca.',

  'equip.tpl.irrigation-drip-timer.category': 'Temporizador de goteo',
  'equip.tpl.irrigation-drip-timer.label': 'Línea de goteo con temporizador de manguera',
  'equip.tpl.irrigation-drip-timer.description':
    'Línea de goteo o emisores con un temporizador en la manguera. Anota sus días, hora de inicio y minutos, y las pulgadas que da cada riego, para que cada riego cuente como agua.',
  'equip.tpl.irrigation-soaker-timer.category': 'Temporizador de manguera exudante',
  'equip.tpl.irrigation-soaker-timer.label': 'Manguera exudante con temporizador',
  'equip.tpl.irrigation-soaker-timer.description':
    'Manguera exudante con un temporizador en la manguera. Anota sus días, hora de inicio y minutos, y las pulgadas que da cada riego, para que cada riego cuente como agua.',
  'equip.tpl.irrigation-sprinkler-timer.category': 'Temporizador de aspersor',
  'equip.tpl.irrigation-sprinkler-timer.label': 'Aspersor con temporizador de manguera',
  'equip.tpl.irrigation-sprinkler-timer.description':
    'Aspersor con un temporizador en la manguera. Anota sus días, hora de inicio y minutos, y las pulgadas que da cada riego, para que cada riego cuente como agua.'
};
