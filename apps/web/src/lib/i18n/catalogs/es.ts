import type { MessageKey } from './en';

/**
 * Spanish, unreviewed (F5-8). It never reaches production: only locales in
 * `CROPCARD_LOCALES` resolve, and the deploy never sets it (F5-1). Flip
 * `reviewed` only after a native-speaker agricultural reviewer signs off.
 */
export const reviewed = false;

export const es: Partial<Record<MessageKey, string>> = {
  'nav.primary': 'Principal',
  'nav.home': 'Inicio de CropCard',
  'nav.today': 'Hoy',
  'nav.plan': 'Plan',
  'nav.spray': 'Aplicar',
  'nav.scout': 'Monitorear',
  'nav.harvest': 'Cosecha',
  'nav.animals': 'Animales',
  'nav.petsAndAnimals': 'Mascotas y animales',
  'nav.inventory': 'Inventario',
  'nav.equipment': 'Equipo',
  'nav.records': 'Registros',
  'nav.cards': 'Tarjetas',
  'nav.more': 'Más',
  'nav.morePages': 'Más páginas',
  'nav.feedbackInbox': 'Buzón de comentarios',
  'nav.sendFeedback': 'Enviar comentarios',
  'nav.settings': 'Configuración',
  'nav.switchFarm': 'Cambiar de granja',
  'nav.alerts': 'Alertas',
  'nav.alertsNone': 'Alertas, ninguna activa',
  'nav.alertsActive.one': 'Alertas, {count} activa',
  'nav.alertsActive.other': 'Alertas, {count} activas',
  'nav.alertsEmpty': 'No hay alertas activas.',
  'nav.alertsOpenToday': 'Abrir Hoy →',
  'nav.pendingRecords.one': '{count} registro sin conexión esperando sincronizar',
  'nav.pendingRecords.other': '{count} registros sin conexión esperando sincronizar',

  'account.pageTitle': 'Cuenta e inicio de sesión · CropCard',
  'account.title': 'Cuenta e inicio de sesión',
  'account.kicker': 'Perfil',
  'account.profile.title': 'Perfil',
  'account.profile.sub': 'Visible para los ayudantes de tu granja.',
  'account.profile.displayName': 'Nombre visible',
  'account.profile.displayNameHint': 'Déjalo en blanco para usar tu nombre de inicio de sesión.',
  'account.profile.timeZone': 'Zona horaria',
  'account.profile.displayUnits': 'Unidades',
  'account.profile.saved': 'Perfil guardado.',
  'account.language.title': 'Idioma',
  'account.language.sub':
    'Los menús y la configuración usan este idioma. Los pasos de seguridad, las aplicaciones, el texto de las etiquetas y el correo siguen en inglés.',
  'account.language.label': 'Idioma de la aplicación',
  'account.language.save': 'Usar este idioma',
  'account.language.saved': 'Idioma guardado.',
  'account.language.unavailable': 'Ese idioma no está disponible.',
  'account.signIn.title': 'Formas de iniciar sesión',
  'account.signIn.sub':
    'Sin contraseñas. El correo es la forma principal: un mensaje trae un enlace de inicio de sesión y un código de respaldo de 6 dígitos. Un número de celular verificado también sirve.',
  'account.sessions.title': 'Sesiones',
  'account.sessions.sub': 'Dispositivos con sesión iniciada.',
  'account.sessions.lastSignIn': 'Último inicio de sesión',
  'account.sessions.lastSignInHint': 'Sesión con cookie',
  'account.sessions.lastSignInValue': 'hoy · {time}',
  'account.sessions.active': 'Sesiones activas · {count}',
  'account.sessions.thisBrowser': 'Esta sesión del navegador',
  'account.sessions.current': 'actual',
  'account.sessions.thisDevice': 'Este dispositivo',
  'account.sessions.signOut': 'Cerrar sesión',
  'account.sessions.signOutEverywhere': 'Cerrar sesión en todas partes',
  'account.export.title': 'Exportar datos',
  'account.export.sub': 'Descarga todo lo que guardamos sobre ti y los registros de tu granja.',
  'account.export.json': 'Descargar datos de la cuenta (JSON)',
  'account.export.vdacs': 'Descargar paquete de auditoría VDACS'
};
