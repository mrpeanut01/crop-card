import type { MessageKey } from '../en';

// Phase 37D Spanish ships unreviewed and goes to the proofreader (C-11).
export const esHerbsd: Partial<Record<MessageKey, string>> = {
  'herbsd.title': 'Calendario de hierbas',
  'herbsd.event.bringIndoors.title': 'Lleva {name} adentro o saca esquejes',
  'herbsd.event.bringIndoors.body':
    'Se acerca la primera helada de otoño. Mete la maceta en casa o saca esquejes para cultivarlos adentro durante el invierno.',
  'herbsd.event.restart.title': 'Siembra {name} otra vez',
  'herbsd.event.restart.body':
    'Siembra unas cuantas más ahora para tener hojas frescas todo el tiempo.',
  'herbsd.kind.bringIndoors': 'Antes de la helada',
  'herbsd.kind.restart': 'Sembrar otra vez',
  'herbsd.bar.bringIndoors': 'Llevar adentro',
  'herbsd.bar.restart': 'Sembrar otra vez',
  'herbsd.legend.bringIndoors': 'Llevar adentro antes de la helada',
  'herbsd.legend.restart': 'Sembrar otra vez',
  'herbsd.source.bringIndoors':
    'Llévala adentro de {from} a {to} semanas antes de la primera helada de otoño ({source}).',
  'herbsd.source.bringIndoorsLong':
    'La Extensión de UW-Madison indica sacar de la tierra y poner en maceta las hierbas sensibles al frío antes de la primera helada de otoño prevista.',
  'herbsd.push.bringIn': '{names}: lleva las plantas adentro o cúbrelas.',
  'herbsd.observed.title': 'Últimos 7 días',
  'herbsd.observed.loading': 'Cargando las temperaturas pasadas…',
  'herbsd.observed.unavailable': 'Las temperaturas pasadas no están disponibles para esta granja.',
  'herbsd.observed.noDay': 'Sin lectura',
  'herbsd.observed.someMissing': 'Faltan algunas horas',
  'herbsd.observed.high': 'Máx. {temp}',
  'herbsd.observed.low': 'Mín. {temp}',
  'herbsd.observed.source': 'Medido en {station}.',
  'herbsd.observed.sourceLabel': 'NOAA',
  'herbsd.observed.sourceLong':
    'Lecturas por hora de la estación meteorológica de NOAA más cercana.'
};
