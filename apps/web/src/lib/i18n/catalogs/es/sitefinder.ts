import type { MessageKey } from '../en';

export const esSitefinder: Partial<Record<MessageKey, string>> = {
  'sitefinder.docTitle': 'Buscar un lugar',
  'sitefinder.kicker': 'Plan · Buscar un lugar',
  'sitefinder.title': 'Busca un buen lugar para sembrar',
  'sitefinder.lede':
    'Dile a CropCard qué quieres cultivar y dónde buscar. Revisa el sol, los árboles y edificios de tu mapa, tu llave de agua y el estudio de suelos del USDA, y luego te sugiere lugares para probar.',
  'sitefinder.backToPlan': 'Volver al Plan',
  'sitefinder.readonly.body':
    'Buscar un lugar sugiere sitios de la granja para un huerto, una cama, una huerta de frutales o un campo nuevo. Toma en cuenta el sol, la sombra, el agua y el estudio de suelos.',
  'sitefinder.readonly.ask':
    'Solo el propietario de la granja puede usarlo y agregar Áreas. Pregúntale al propietario.',

  'sitefinder.step.goal': '¿Qué quieres sembrar?',
  'sitefinder.step.where': '¿Dónde busco?',
  'sitefinder.step.options': 'Antes de buscar',
  'sitefinder.step.results': 'Lugares para probar',

  'sitefinder.goal.vegetable-garden.title': 'Huerto de verduras',
  'sitefinder.goal.vegetable-garden.hint': 'Tomates, frijoles, hojas verdes y cosas así.',
  'sitefinder.goal.vegetable-garden.areaName': 'Huerto de verduras',
  'sitefinder.goal.herb-garden.title': 'Jardín de hierbas',
  'sitefinder.goal.herb-garden.hint': 'Una cama pequeña de hierbas de cocina cerca de la puerta.',
  'sitefinder.goal.herb-garden.areaName': 'Jardín de hierbas',
  'sitefinder.goal.flower-garden.title': 'Jardín de flores',
  'sitefinder.goal.flower-garden.hint': 'Una cama para flores de corte o para dar color.',
  'sitefinder.goal.flower-garden.areaName': 'Jardín de flores',
  'sitefinder.goal.raised-beds.title': 'Camas elevadas',
  'sitefinder.goal.raised-beds.hint': 'Cajones que se llenan con tierra traída de fuera.',
  'sitefinder.goal.raised-beds.areaName': 'Camas elevadas',
  'sitefinder.goal.fruit-trees.title': 'Árboles frutales',
  'sitefinder.goal.fruit-trees.hint': 'Unos cuantos árboles o una huerta de frutales pequeña.',
  'sitefinder.goal.fruit-trees.areaName': 'Huerta de frutales',
  'sitefinder.goal.berry-patch.title': 'Parcela de bayas',
  'sitefinder.goal.berry-patch.hint': 'Fresas, frambuesas o arándanos.',
  'sitefinder.goal.berry-patch.areaName': 'Parcela de bayas',
  'sitefinder.goal.row-crop-field.title': 'Campo para cultivos en hileras',
  'sitefinder.goal.row-crop-field.hint': 'Maíz, calabazas, granos o una parcela para vender.',
  'sitefinder.goal.row-crop-field.areaName': 'Campo nuevo',

  'sitefinder.size.lede':
    '¿Qué tan grande debe ser? Estos son tamaños iniciales de CropCard. Cámbialos según tu plan.',
  'sitefinder.size.width': 'Ancho, de este a oeste ({unit})',
  'sitefinder.size.length': 'Largo, de norte a sur ({unit})',
  'sitefinder.size.invalid': 'Escribe un ancho y un largo para la parcela.',

  'sitefinder.where.needLocation':
    'CropCard necesita saber dónde está tu granja antes de buscar un lugar.',
  'sitefinder.where.lede':
    'Toca el mapa, o arrastra el círculo, para mover el recuadro punteado sobre el terreno donde quieres buscar.',
  'sitefinder.where.smaller': 'Recuadro más chico',
  'sitefinder.where.larger': 'Recuadro más grande',
  'sitefinder.where.boxSize': 'El recuadro mide {size} por lado.',
  'sitefinder.where.tilesNote':
    'La imagen del mapa es solo para que tú la veas. Nunca se envía a ningún lado.',
  'sitefinder.map.aria': 'Mapa de tu granja con el recuadro de búsqueda',
  'sitefinder.map.handle': 'Arrastra para mover el recuadro de búsqueda',

  'sitefinder.options.overlapLegend': 'Espacio de cultivo que ya tienes',
  'sitefinder.options.overlap': 'Un lugar puede quedar encima de {name}',
  'sitefinder.options.aerial': 'Que Claude también revise una foto aérea del USDA de este recuadro',
  'sitefinder.options.aerialNote':
    'La foto es del programa NAIP del USDA y puede tener algunos años. Claude señala los árboles, edificios y terreno abierto que alcanza a ver. Tú decides qué va en tu mapa.',
  'sitefinder.options.aerialOff': 'La lectura de la foto no está disponible: {reason}',
  'sitefinder.options.worksWithout':
    'Buscar un lugar sigue funcionando con el sol, tu mapa y el estudio de suelos.',
  'sitefinder.ai.noKey': 'Claude no está configurado para esta granja.',
  'sitefinder.run.go': 'Buscar lugares',
  'sitefinder.run.busy': 'Buscando...',

  'sitefinder.err.failed': 'No se pudo buscar un lugar. Inténtalo de nuevo.',
  'sitefinder.err.offline': 'Sin conexión. Buscar un lugar necesita conexión.',
  'sitefinder.err.createFailed': 'No se pudo guardar. Inténtalo de nuevo.',
  'sitefinder.err.tooMany':
    'Demasiadas búsquedas en poco tiempo. Espera un minuto e inténtalo de nuevo.',

  'sitefinder.results.fromAi':
    'Con el sol, tu mapa, el estudio de suelos y lo que Claude vio en la foto aérea.',
  'sitefinder.results.fromEngine': 'Con el sol, tu mapa y el estudio de suelos.',
  'sitefinder.results.roughGuide':
    'El orden es una guía aproximada de CropCard. Camina el terreno antes de cavar.',
  'sitefinder.results.tooBig':
    'La parcela es más grande que el recuadro de búsqueda. Agranda el recuadro o achica la parcela.',
  'sitefinder.results.none':
    'No se encontró un lugar libre para esta parcela dentro del recuadro. Mueve el recuadro, agrándalo o permite que un lugar quede encima de un espacio de cultivo que ya tienes.',
  'sitefinder.results.allDismissed':
    'Descartaste todos los lugares. Mueve el recuadro y busca de nuevo.',
  'sitefinder.results.photoSource':
    'Foto aérea: USDA NAIP a través de USGS The National Map. Dominio público.',

  'sitefinder.spot.title': 'Lugar {n}',
  'sitefinder.spot.soilTitle': 'Lo que dice el estudio de suelos aquí',
  'sitefinder.spot.soilSource': 'Estudio de suelos del USDA',
  'sitefinder.spot.created': '{name} ya está en tu mapa.',
  'sitefinder.spot.openDesigner': 'Abrir el diseñador de jardín',
  'sitefinder.spot.planPlanting': 'Planear una siembra',
  'sitefinder.spot.seeOnMap': 'Verlo en el mapa de la granja',
  'sitefinder.spot.nameLabel': 'Nombre para la nueva Área',
  'sitefinder.spot.save': 'Guardar el Área',
  'sitefinder.spot.cancel': 'Cancelar',
  'sitefinder.spot.create': 'Crear esta Área aquí',
  'sitefinder.spot.notHere': 'Aquí no',

  'sitefinder.prov.survey': 'Estudio de suelos',
  'sitefinder.prov.map': 'Tu mapa',
  'sitefinder.prov.estimate': 'Cálculo aproximado',
  'sitefinder.label.best': 'La mejor opción',
  'sitefinder.label.good': 'Buena',
  'sitefinder.label.look': 'Vale la pena verla',
  'sitefinder.confidence.high': 'Se revisó casi todo.',
  'sitefinder.confidence.medium': 'Algunas cosas no se pudieron revisar.',
  'sitefinder.confidence.low': 'Mucho no se pudo revisar.',

  'sitefinder.f.sun.full':
    'Recibe sol casi todo el día en verano: unas {hours} horas, según un cálculo aproximado.',
  'sitefinder.f.sun.part':
    'Recibe sol parte del día en verano: unas {hours} horas, según un cálculo aproximado.',
  'sitefinder.f.sun.shade':
    'Tiene sombra buena parte del día en verano: unas {hours} horas de sol, según un cálculo aproximado.',
  'sitefinder.f.shade.morning': '{thing} al {dir} da sombra a este lugar por la mañana.',
  'sitefinder.f.shade.afternoon': '{thing} al {dir} da sombra a este lugar por la tarde.',
  'sitefinder.f.shade.all-day': '{thing} al {dir} da sombra a este lugar parte del día.',
  'sitefinder.f.shade.guessed': 'Su altura es una suposición.',
  'sitefinder.thing.tree': 'Un árbol',
  'sitefinder.thing.tree-line': 'Una hilera de árboles',
  'sitefinder.thing.building': 'Un edificio',
  'sitefinder.thing.water': 'Agua',
  'sitefinder.thing.pavement': 'Pavimento',
  'sitefinder.thing.other': 'Algo alto',
  'sitefinder.dir.n': 'norte',
  'sitefinder.dir.ne': 'noreste',
  'sitefinder.dir.e': 'este',
  'sitefinder.dir.se': 'sureste',
  'sitefinder.dir.s': 'sur',
  'sitefinder.dir.sw': 'suroeste',
  'sitefinder.dir.w': 'oeste',
  'sitefinder.dir.nw': 'noroeste',
  'sitefinder.f.soil.unavailable':
    'No se pudo conectar con el estudio de suelos, así que el suelo de aquí no se revisó.',
  'sitefinder.f.soil.noData': 'El estudio de suelos no tiene datos para este terreno.',
  'sitefinder.f.soil.notSoil':
    'El estudio de suelos no tiene detalles del suelo aquí, algo común cerca de edificios. Las camas elevadas con tierra traída de fuera son una opción.',
  'sitefinder.f.drainage.unknown': 'El estudio de suelos no dice cómo drena este terreno.',
  'sitefinder.f.drainage.cls.well': 'El estudio de suelos dice que este terreno drena bien.',
  'sitefinder.f.drainage.cls.moderately-well':
    'El estudio de suelos dice que este terreno drena moderadamente bien.',
  'sitefinder.f.depth.good': 'El estudio de suelos no registra roca poco profunda aquí.',
  'sitefinder.f.slope.flat': 'El estudio de suelos marca este terreno como casi plano.',
  'sitefinder.f.slope.gentle': 'El estudio de suelos marca una pendiente suave aquí.',
  'sitefinder.f.slope.moderate': 'El estudio de suelos marca una pendiente moderada aquí.',
  'sitefinder.f.slope.steep': 'El estudio de suelos marca una pendiente fuerte aquí.',
  'sitefinder.f.slope.very-steep': 'El estudio de suelos marca una pendiente muy fuerte aquí.',
  'sitefinder.f.water.dist': 'A unos {dist} de tu agua ({name}).',
  'sitefinder.f.water.unknown': 'Marca tu llave de agua en el mapa para tomarla en cuenta.',
  'sitefinder.f.house.dist': 'A unos {dist} de tu casa.',
  'sitefinder.f.house.unknown':
    'Dibuja tu casa en el mapa para tomar en cuenta la caminata desde la puerta.',
  'sitefinder.f.roots.close':
    'Hay un árbol a unos {dist}. Sus raíces y su sombra pueden llegar a este lugar.',
  'sitefinder.f.roots.near': 'Hay un árbol a unos {dist}.',
  'sitefinder.f.overlap.inside': 'Dentro de {name}, donde dijiste que un lugar puede quedar.',
  'sitefinder.f.ai.note': 'Claude vio: {text}',

  'sitefinder.also.lead': 'A Claude también le gustó un lugar aquí:',
  'sitefinder.also.outside-box': 'Pero la parcela no cabría dentro del recuadro de búsqueda ahí.',
  'sitefinder.also.outside-boundary': 'Pero queda fuera del lindero de tu mapa.',
  'sitefinder.also.area': 'Pero queda sobre un Área que ya está en tu mapa.',
  'sitefinder.also.obstacle': 'Pero queda sobre un edificio, agua o pavimento.',
  'sitefinder.also.lower-score': 'Pero otros lugares salieron mejor en sol, suelo o agua.',

  'sitefinder.seen.title': 'Cosas que Claude vio en la foto',
  'sitefinder.seen.lede':
    'Son sugerencias. Nada se agrega a tu mapa a menos que tú lo agregues. Compara cada una con lo que sabes que hay ahí.',
  'sitefinder.seen.kind.tree': 'Árbol',
  'sitefinder.seen.kind.tree-line': 'Hilera de árboles',
  'sitefinder.seen.kind.building': 'Edificio',
  'sitefinder.seen.kind.water': 'Agua',
  'sitefinder.seen.kind.pavement': 'Pavimento o entrada de autos',
  'sitefinder.seen.kind.shadow': 'Sombra',
  'sitefinder.seen.kind.bare-ground': 'Suelo desnudo',
  'sitefinder.seen.kind.wet-area': 'Terreno que se ve mojado',
  'sitefinder.seen.kind.open-lawn': 'Césped abierto',
  'sitefinder.seen.kind.other': 'Otra cosa',
  'sitefinder.seen.onMap': 'Ya está en tu mapa.',
  'sitefinder.seen.added': 'Agregado a tu mapa.',
  'sitefinder.seen.add': 'Agregar a mi mapa',
  'sitefinder.seen.height': '¿Qué tan alto es? ({unit})',
  'sitefinder.seen.heightHint':
    'Con tu mejor cálculo basta. La altura define hasta dónde llega su sombra.',
  'sitefinder.seen.heightNeeded': 'Escribe qué tan alto es.',
  'sitefinder.seen.save': 'Agregarlo',

  'sitefinder.unchecked.title': 'Lo que no pude revisar',
  'sitefinder.unchecked.shade':
    'La sombra. No hay árboles ni edificios dibujados en tu mapa y no se leyó ninguna foto, así que el cálculo del sol supone cielo abierto.',
  'sitefinder.unchecked.water': 'El agua. No hay ninguna llave de agua marcada en tu mapa.',
  'sitefinder.unchecked.soilUnavailable':
    'El suelo. No se pudo conectar con el estudio de suelos del USDA. Inténtalo de nuevo más tarde.',
  'sitefinder.unchecked.soilNoData':
    'El suelo. El estudio de suelos del USDA no tiene detalles del suelo aquí.',
  'sitefinder.unchecked.photoAge':
    'Los cambios desde que se tomó la foto aérea. Puede tener algunos años.',
  'sitefinder.unchecked.underground':
    'Cables y tuberías enterrados, una fosa séptica o un campo de drenaje. Llama al 811 antes de cavar.',
  'sitefinder.unchecked.rules':
    'Las reglas locales. Revisa la zonificación y cualquier asociación de vecinos.',
  'sitefinder.unchecked.walk':
    'El terreno mismo. Camínalo después de una lluvia y a distintas horas del día antes de decidir.',

  'sitefinder.why.noKey':
    'Claude no está configurado para esta granja, así que no se leyó la foto aérea.',
  'sitefinder.why.overCap':
    'La ayuda de IA de este mes ya se usó, así que no se leyó la foto aérea.',
  'sitefinder.why.quota': 'Las lecturas de fotos aéreas de hoy ya se usaron.',
  'sitefinder.why.rateLimit': 'Claude no pudo leer la foto aérea en este momento.',
  'sitefinder.why.offline': 'No se pudo leer la foto aérea en este momento.',
  'sitefinder.why.timeout': 'Leer la foto aérea tardó demasiado.',
  'sitefinder.why.invalid': 'La lectura que hizo Claude de la foto no se pudo usar.',
  'sitefinder.why.noPhoto': 'No se pudo cargar una foto aérea del USDA para este terreno.',
  'sitefinder.why.limit': 'No se leyó la foto aérea: {reason}',
  'sitefinder.why.still': 'Estos lugares salen del sol, tu mapa y el estudio de suelos.',

  'sitefinder.entry.title': 'Ayúdame a elegir un lugar',
  'sitefinder.entry.hint': 'Deja que CropCard revise el sol, la sombra, el agua y el suelo.',
  'sitefinder.entry.farmLink': '¿No sabes dónde ponerlo? Busca un buen lugar',
  'sitefinder.entry.briefLink': '¿No sabes dónde da el sol? Busca un lugar'
};
