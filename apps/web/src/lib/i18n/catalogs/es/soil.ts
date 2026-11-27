import type { MessageKey } from '../en';

export const esSoil: Partial<Record<MessageKey, string>> = {
  'soil.panel.title': 'Estudio de suelos',
  'soil.panel.titleHere': 'Lo que dice el estudio de suelos aquí',
  'soil.panel.loading': 'Consultando el estudio de suelos...',
  'soil.panel.noData': 'El estudio de suelos no tiene datos para este lugar.',
  'soil.panel.unavailable':
    'No se pudo conectar con el estudio de suelos. Inténtalo de nuevo más tarde.',
  'soil.panel.retry': 'Intentar de nuevo',
  'soil.panel.offline':
    'El estudio de suelos necesita conexión. No se guarda en este dispositivo, así que solo se muestra cuando tienes conexión.',
  'soil.panel.notLocated':
    'Dibuja esta Área en el mapa, o guarda la ubicación de tu granja, para consultar el estudio de suelos.',
  'soil.panel.needLocation':
    'Guarda la ubicación de tu granja para consultar el estudio de suelos.',
  'soil.panel.source': 'Fuente: Estudio de suelos del USDA NRCS.',
  'soil.panel.sourceLink': 'Abrir Web Soil Survey',
  'soil.panel.scaleNote':
    'El estudio se hizo a gran escala. Tu terreno puede ser distinto de lo que dice.',
  'soil.panel.labNote': 'Un análisis de suelo de laboratorio te dice qué hay en tu suelo hoy.',
  'soil.panel.labLink': 'Agregar un análisis de suelo',
  'soil.panel.labWins':
    'Esto describe el tipo de suelo que figura en el mapa para este lugar. Cuando tengas un análisis de suelo de laboratorio, guíate por el análisis.',
  'soil.panel.approximate':
    'Esto es para la ubicación de tu granja. Dibuja esta Área en el mapa para una respuesta más precisa.',
  'soil.panel.farmLocation': 'Esto es para la ubicación guardada de tu granja.',
  'soil.panel.flagsTitle': 'Vale la pena saber sobre este lugar',
  'soil.panel.provLabel': 'Estudio de suelos',
  'soil.panel.provLong':
    'Del estudio de suelos del USDA NRCS para este lugar, no de tus propios registros.',

  'soil.line.name': 'Cómo llama el estudio a este suelo',
  'soil.line.name.note': 'Suelos principales en el mapa aquí: {list}.',
  'soil.line.texture': 'Capa superior',
  'soil.line.drainage': 'Drenaje',
  'soil.line.slope': 'Pendiente',
  'soil.line.waterTable': 'Profundidad hasta el agua en la época más húmeda del año',
  'soil.line.bedrock': 'Profundidad hasta la roca',
  'soil.line.flooding': 'Inundaciones',
  'soil.line.ph': 'pH típico de la capa superior',
  'soil.line.ph.note':
    'Este es el rango habitual del estudio para este tipo de suelo, no un análisis de tu terreno.',
  'soil.line.om': 'Materia orgánica en la capa superior',
  'soil.line.om.note': 'El valor típico del estudio para este tipo de suelo.',
  'soil.line.farmland': 'Clase de tierra agrícola',

  'soil.value.component': '{name} ({percent}%)',
  'soil.value.depthAbout': 'A unos {depth} de profundidad',
  'soil.value.noneNoted': 'El estudio no indica ninguna',
  'soil.value.percent': '{n}%',
  'soil.value.phRange': '{low} a {high}',
  'soil.value.phRangeTypical': '{low} a {high}, por lo general cerca de {typical}',
  'soil.value.phTypical': 'Cerca de {typical}',
  'soil.value.slope': '{words} ({pct}%)',

  'soil.texture.sand': 'Arenoso',
  'soil.texture.sand.note': 'Un suelo suelto y áspero que es casi pura arena.',
  'soil.texture.loamySand': 'Arenoso franco',
  'soil.texture.loamySand.note': 'Un suelo suelto y áspero que es sobre todo arena.',
  'soil.texture.sandyLoam': 'Franco arenoso',
  'soil.texture.sandyLoam.note': 'Un suelo liviano con mucha arena.',
  'soil.texture.loam': 'Franco',
  'soil.texture.loam.note': 'Una mezcla pareja de arena, limo y arcilla.',
  'soil.texture.siltLoam': 'Franco limoso',
  'soil.texture.siltLoam.note': 'Un suelo suave con mucho limo.',
  'soil.texture.silt': 'Limoso',
  'soil.texture.silt.note': 'Un suelo suave, como harina, que es sobre todo limo.',
  'soil.texture.sandyClayLoam': 'Franco arcillo arenoso',
  'soil.texture.sandyClayLoam.note': 'Un suelo algo pesado con arena y arcilla.',
  'soil.texture.clayLoam': 'Franco arcilloso',
  'soil.texture.clayLoam.note': 'Un suelo pesado con una buena parte de arcilla.',
  'soil.texture.siltyClayLoam': 'Franco arcillo limoso',
  'soil.texture.siltyClayLoam.note': 'Un suelo pesado con mucha arcilla.',
  'soil.texture.sandyClay': 'Arcillo arenoso',
  'soil.texture.sandyClay.note': 'Un suelo pesado que es sobre todo arcilla, con arena.',
  'soil.texture.siltyClay': 'Arcillo limoso',
  'soil.texture.siltyClay.note': 'Un suelo pesado y pegajoso que es sobre todo arcilla y limo.',
  'soil.texture.clay': 'Arcilloso',
  'soil.texture.clay.note': 'Un suelo muy pesado y pegajoso que es sobre todo arcilla.',
  'soil.texture.organic': 'Suelo orgánico o turba',
  'soil.texture.organic.note': 'Un suelo oscuro formado sobre todo por plantas descompuestas.',

  'soil.drainage.excessively': 'Excesivamente drenado',
  'soil.drainage.excessively.note':
    'El agua lo atraviesa muy rápido, así que el suelo se seca pronto.',
  'soil.drainage.somewhatExcessively': 'Algo excesivamente drenado',
  'soil.drainage.somewhatExcessively.note':
    'El agua lo atraviesa rápido, así que el suelo tiende a secarse.',
  'soil.drainage.well': 'Bien drenado',
  'soil.drainage.well.note':
    'El agua escurre con facilidad. El suelo no queda encharcado por mucho tiempo.',
  'soil.drainage.moderatelyWell': 'Moderadamente bien drenado',
  'soil.drainage.moderatelyWell.note':
    'El agua escurre un poco lento. El suelo puede quedar mojado por poco tiempo en épocas húmedas.',
  'soil.drainage.somewhatPoorly': 'Algo mal drenado',
  'soil.drainage.somewhatPoorly.note':
    'El agua escurre lento. El suelo queda mojado buena parte del año.',
  'soil.drainage.poorly': 'Mal drenado',
  'soil.drainage.poorly.note':
    'El agua escurre muy lento. El suelo está mojado cerca de la superficie gran parte del año.',
  'soil.drainage.veryPoorly': 'Muy mal drenado',
  'soil.drainage.veryPoorly.note':
    'El agua queda en la superficie o cerca de ella la mayor parte del año.',

  'soil.slope.flat': 'Casi plano',
  'soil.slope.gentle': 'Pendiente suave',
  'soil.slope.moderate': 'Pendiente moderada',
  'soil.slope.steep': 'Empinado',
  'soil.slope.verySteep': 'Muy empinado',

  'soil.flood.none': 'Ninguna',
  'soil.flood.veryRare': 'Muy raras',
  'soil.flood.rare': 'Raras',
  'soil.flood.occasional': 'Ocasionales',
  'soil.flood.frequent': 'Frecuentes',
  'soil.flood.veryFrequent': 'Muy frecuentes',

  'soil.farmland.notPrime': 'No es tierra agrícola de primera',
  'soil.farmland.allPrime': 'Toda el área es tierra agrícola de primera',
  'soil.farmland.statewide': 'Tierra agrícola de importancia estatal',
  'soil.farmland.local': 'Tierra agrícola de importancia local',
  'soil.farmland.unique': 'Tierra agrícola de importancia única',

  'soil.flag.wet.caution':
    'El estudio clasifica este suelo como mal drenado. Espera que quede mojado gran parte del año.',
  'soil.flag.wet.note':
    'El estudio clasifica este suelo como algo mal drenado. Espera temporadas en que quede mojado.',
  'soil.flag.droughty.note':
    'El estudio dice que el agua atraviesa este suelo rápido. Espera que se seque pronto.',
  'soil.flag.floods.caution': 'El estudio dice que este terreno se inunda con frecuencia.',
  'soil.flag.floods.note': 'El estudio dice que este terreno se inunda de vez en cuando.',
  'soil.flag.hydric.note': 'El estudio indica aquí un suelo de tipo humedal (hídrico).',
  'soil.flag.highWaterTable.caution':
    'El estudio muestra agua cerca de la superficie en la época más húmeda del año.',
  'soil.flag.highWaterTable.note':
    'El estudio muestra agua bastante cerca de la superficie en la época más húmeda del año.',
  'soil.flag.shallowBedrock.caution': 'El estudio muestra roca cerca de la superficie.',
  'soil.flag.shallowBedrock.note': 'El estudio muestra roca bastante cerca de la superficie.',
  'soil.flag.steep.caution': 'Este terreno es empinado. El agua y la tierra pueden escurrirse.',
  'soil.flag.steep.note': 'Este terreno tiene una pendiente que se nota.',
  'soil.flag.notSoil.note':
    'El estudio marca este lugar como terreno construido o removido, así que aquí no tiene datos del suelo.'
};
