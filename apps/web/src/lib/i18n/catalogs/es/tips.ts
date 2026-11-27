import type { MessageKey } from '../en';

/** Spanish for the beginner tips (`en/tips.ts`). Not yet read by the
 *  proofreader. */
export const esTips: Partial<Record<MessageKey, string>> = {
  'tips.kicker': '¿Primera vez aquí?',
  'tips.howToStart': 'Cómo empezar',

  'tips.today.title': 'Tus tareas de hoy',
  'tips.today.body':
    'Hoy muestra las tareas pendientes, una tarjeta por cada tarea. Toca Listo en una tarjeta cuando la termines. Si la lista está vacía, empieza por planear lo que vas a cultivar.',
  'tips.today.bodyOther':
    'Hoy muestra las tareas pendientes de esta granja, una tarjeta por cada tarea. Toca Listo en una tarjeta cuando la termines.',
  'tips.today.action': 'Planear qué cultivar',

  'tips.plan.title': 'Planea lo que vas a cultivar',
  'tips.plan.body':
    'En Plan indicas qué vas a cultivar y dónde. Primero agrega un lugar para cultivar, como una cama de cultivo. Después agrega una siembra, que es un cultivo en un lugar.',
  'tips.plan.bodyOther':
    'Plan muestra lo que crece en esta granja y dónde. Una siembra es un cultivo en un lugar. El propietario las agrega y las cambia.',

  'tips.farm_map.title': 'Dibuja tu granja',
  'tips.farm_map.body':
    'Este mapa muestra los lugares de tu granja. Cada lugar se llama Área, como un huerto, un campo o un granero. Toca Agregar para dibujar la primera, y no te preocupes por que quede exacta.',

  'tips.designer.title': 'Organiza tus camas de cultivo',
  'tips.designer.body':
    'Aquí organizas las camas de este huerto y eliges qué crece en cada una. Una cama es un tramo de tierra donde siembras. Primero agrega una cama y después agrégale plantas.',
  'tips.designer.bodyOther':
    'Aquí se ven las camas de este huerto y lo que crece en cada una. Una cama es un tramo de tierra donde se siembra.',

  'tips.spray.title': 'Lleva un registro de lo que aplicas',
  'tips.spray.body':
    'Esta página registra cada vez que aplicas un producto contra malezas, insectos o enfermedades de las plantas. Guarda qué usaste, dónde y cuándo. Lee y sigue siempre la etiqueta del producto.',

  'tips.scout.title': 'Revisa tus plantas',
  'tips.scout.body':
    'Monitorear es recorrer tus plantas y buscar malezas, insectos o enfermedades. Anota aquí lo que veas, para detectar un problema a tiempo. Empieza por elegir el lugar que recorriste.',

  'tips.harvest.title': 'Registra lo que cosechas',
  'tips.harvest.body':
    'Cada vez que recojas o cortes un cultivo, regístralo aquí. Al final de la temporada podrás ver cuánto dio cada siembra. Empieza por elegir una siembra.',

  'tips.inventory.title': 'Lleva la cuenta de tus insumos',
  'tips.inventory.body':
    'Inventario muestra la semilla, el fertilizante y los demás productos que tienes. Agrega lo que ya tienes, y la app podrá avisarte cuando algo se esté acabando.',
  'tips.inventory.bodyOther':
    'Inventario muestra la semilla, el fertilizante y los demás productos de esta granja. Toca uno para ver cuánto queda.',

  'tips.equipment.title': 'Anota tus herramientas',
  'tips.equipment.body':
    'Equipo muestra las herramientas con las que trabajas, como una aspersora, un motocultor o una segadora. Agrega las que tienes, para que tus tareas y los recordatorios de limpieza puedan nombrarlas.',
  'tips.equipment.bodyOther':
    'Equipo muestra las herramientas de esta granja, como una aspersora, un motocultor o una segadora. Toca una para ver sus detalles.',

  'tips.calibrate.title': 'Mide tu aspersora',
  'tips.calibrate.body':
    'Calibrar es medir cuánto líquido echa tu aspersora. Aplicas solo agua sobre un tramo de terreno marcado y la app hace las cuentas. Hazlo antes de tu primera aplicación, para que las cantidades que muestra la app correspondan a tu aspersora.',
  'tips.calibrate.bodyOther':
    'Calibrar es medir cuánto líquido echa una aspersora. Aplicas solo agua sobre un tramo de terreno marcado y la app hace las cuentas. Tu resultado pasa al propietario, que lo revisa y lo guarda.',

  'tips.records.title': 'El diario de tu granja',
  'tips.records.body':
    'Registros guarda todo lo que se ha anotado: aplicaciones, cosechas, notas de monitoreo y más. Toca una fila para ver los detalles o imprimirla.',

  'tips.cards.title': 'Tarjetas para el campo',
  'tips.cards.body':
    'Una Tarjeta es un resumen corto de una sola cosa, como una siembra, un Área o una tarea. Guarda tus Tarjetas en este teléfono y funcionarán sin señal. Fija las que más usas, o imprímelas.',

  'tips.fertility.title': 'Alimenta tu suelo',
  'tips.fertility.body':
    'Esta página lleva la cuenta de lo que agregas a tu suelo, como composta o fertilizante. También guarda los resultados de tus análisis de suelo. Un análisis de suelo es un informe de laboratorio que dice qué tiene tu suelo y qué le falta.',
  'tips.fertility.bodyOther':
    'Esta página muestra lo que se ha agregado al suelo de esta granja, como composta o fertilizante. También guarda los resultados de los análisis de suelo. Un análisis de suelo es un informe de laboratorio que dice qué tiene el suelo y qué le falta.',

  'tips.animals.title': 'Tus animales y mascotas',
  'tips.animals.body':
    'Anota los animales que tienes, desde un grupo de gallinas hasta el perro de la familia. Cada uno tiene una página con el lugar donde vive, sus tratamientos y sus recordatorios de cuidado. Empieza por agregar uno.',
  'tips.animals.bodyOther':
    'Aquí están los animales de esta granja. Toca uno para ver dónde vive y los cuidados que ha recibido.',
  'tips.animals.action': 'Agregar un animal',

  'tips.calendar.title': 'Cuándo sembrar y trasplantar',
  'tips.calendar.body':
    'Este calendario muestra cuándo empezar las semillas bajo techo, cuándo sacar las plantas y cuándo sembrar afuera. Se basa en tus fechas de helada: la última noche de helada habitual de la primavera y la primera del otoño. Agrega una siembra en Plan y aparecerá aquí.',
  'tips.calendar.bodyOther':
    'Este calendario muestra cuándo empezar las semillas bajo techo, cuándo sacar las plantas y cuándo sembrar afuera. Se basa en las fechas de helada de esta granja: la última noche de helada habitual de la primavera y la primera del otoño.',
  'tips.calendar.action': 'Abrir Plan',

  'tips.site_finder.title': 'Elige un lugar antes de cavar',
  'tips.site_finder.body':
    'Casi todas las plantas de comer quieren bastante sol, un terreno que drene después de la lluvia y agua cerca. Di qué quieres sembrar, mueve el recuadro sobre el terreno donde buscar y CropCard te sugiere lugares para probar. Es una guía aproximada, así que también camina el terreno.',
  'tips.site_finder.bodyOther':
    'Esta página sugiere lugares de la granja para un huerto o un campo nuevo, según el sol, la sombra, el agua y el estudio de suelos. El propietario la usa y agrega el Área.',

  'tips.onboard.question': '¿Es la primera vez que cultivas?',
  'tips.onboard.yes': 'Sí, muéstrame consejos sobre la marcha',
  'tips.onboard.no': 'No, ya lo he hecho antes',
  'tips.onboard.note': 'Puedes cambiarlo cuando quieras en Configuración, en Cuenta.',

  'tips.settings.title': 'Consejos para quienes empiezan',
  'tips.settings.sub':
    'Un consejo corto en la parte de arriba de cada pantalla principal, la primera vez que la abres.',
  'tips.settings.switch': 'Mostrar consejos para quienes empiezan',
  'tips.settings.on': 'Los consejos están activados.',
  'tips.settings.off': 'Los consejos están desactivados.',
  'tips.settings.reset': 'Mostrar todos los consejos otra vez',
  'tips.settings.resetDone': 'Cada consejo se mostrará una vez más.',
  'tips.settings.error': 'No se guardó. Revisa tu conexión e inténtalo de nuevo.',
  'tips.settings.askOwner': 'Una cuenta de inspector no puede cambiar esto.'
};
