import type { MessageKey } from '../en';

/** Phase 38 passkey sign-in, in Spanish (`en/passkey.ts`). "Llave de
 *  acceso" follows the term Apple and Google use in Spanish. */
export const esPasskey: Partial<Record<MessageKey, string>> = {
  'passkey.signin.button': 'Usar una llave de acceso',
  'passkey.signin.working': 'Esperando su llave de acceso…',
  'passkey.signin.help':
    '¿Su llave de acceso está en su teléfono? Elija "Usar un teléfono o tableta" y escanee el código con el teléfono. Los dos necesitan el Bluetooth encendido.',
  'passkey.offer.title': 'Entre más rápido la próxima vez',
  'passkey.offer.body':
    'Agregue una llave de acceso y entre con Face ID, su huella o el PIN del dispositivo. Sin esperar un correo.',
  'passkey.offer.shared': 'Agréguela solo en su propio teléfono o computadora.',
  'passkey.offer.add': 'Agregar una llave de acceso',
  'passkey.offer.notNow': 'Ahora no',
  'passkey.offer.never': 'No preguntar en este dispositivo',
  'passkey.offer.done': 'Llave de acceso agregada. La próxima vez, elíjala al entrar.',
  'passkey.settings.title': 'Llaves de acceso',
  'passkey.settings.lede':
    'Entre con Face ID, su huella o el PIN del dispositivo, sin esperar un correo.',
  'passkey.settings.empty': 'Todavía no hay llaves de acceso.',
  'passkey.settings.add': 'Agregar una llave de acceso en este dispositivo',
  'passkey.settings.defaultName': 'Llave de acceso',
  'passkey.settings.synced': 'Sincronizada con sus otros dispositivos',
  'passkey.settings.added': 'Agregada el {date}',
  'passkey.settings.lastUsed': 'Último uso el {date}',
  'passkey.settings.neverUsed': 'Sin usar todavía',
  'passkey.settings.rename': 'Cambiar nombre',
  'passkey.settings.renameLabel': 'Cambiar el nombre de {name}',
  'passkey.settings.nameLabel': 'Nombre de la llave de acceso',
  'passkey.settings.save': 'Guardar',
  'passkey.settings.cancel': 'Cancelar',
  'passkey.settings.remove': 'Quitar',
  'passkey.settings.removeLabel': 'Quitar {name}',
  'passkey.settings.confirmRemove':
    '¿Quitar esta llave de acceso? Todavía puede entrar con un enlace por correo o un código.',
  'passkey.settings.stolen':
    '¿Perdió un teléfono o una computadora? Quite su llave de acceso aquí y luego use Cerrar sesión en todos los dispositivos para terminar sus sesiones.',
  'passkey.err.unavailable':
    'Las llaves de acceso no están disponibles ahora. Use el enlace por correo.',
  'passkey.err.unsupported':
    'Este navegador no puede usar llaves de acceso. Use el enlace por correo.',
  'passkey.err.signinFailed':
    'Esa llave de acceso no funcionó. Inténtelo de nuevo o use el enlace por correo.',
  'passkey.err.busy': 'Demasiados intentos. Espere unos minutos e inténtelo de nuevo.',
  'passkey.err.reauth': 'Por su seguridad, vuelva a entrar para agregar una llave de acceso.',
  'passkey.err.demo': 'Las granjas de demostración no pueden agregar llaves de acceso.',
  'passkey.err.addFailed': 'No se pudo agregar la llave de acceso. Inténtelo de nuevo.',
  'passkey.err.duplicate': 'Esta llave de acceso ya está en su cuenta.',
  'passkey.err.notFound': 'No se encontró esa llave de acceso.',
  'passkey.err.badRequest': 'No se pudo leer esa solicitud.'
};
