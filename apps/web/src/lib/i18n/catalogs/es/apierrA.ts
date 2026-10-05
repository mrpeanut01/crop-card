import type { MessageKey } from '../en';

export const esApierrA: Partial<Record<MessageKey, string>> = {
  'api.err.authRequired': 'se requiere iniciar sesión',
  'api.err.signInRequired': 'se requiere iniciar sesión',
  'api.err.ownerRequired': 'se requiere el rol de propietario',
  'api.err.noActiveOwner': 'no hay una granja activa',
  'api.err.superadminRequired': 'se requiere superadministrador',
  'api.err.superadminInteractive':
    'las acciones de superadministrador requieren una sesión interactiva',
  'api.err.identityBrowserOnly':
    'las identidades de inicio de sesión solo se pueden cambiar desde un navegador con la sesión iniciada',
  'api.err.notWhileImpersonating': 'no disponible mientras se suplanta a otra cuenta',
  'api.err.blockNotFound': 'no se encontró el bloque',
  'api.err.cropNotFound': 'no se encontró el cultivo',
  'api.err.fieldNotFound': 'no se encontró el área',
  'api.err.cuttingNotFound': 'no se encontró el corte',
  'api.err.coverNotFound': 'no se encontró la cubierta',
  'api.err.bindingNotFound': 'no se encontró el vínculo',
  'api.err.tokenNotFound': 'no se encontró el token',
  'api.err.harvestNotFound': 'no se encontró el registro de cosecha',
  'api.err.recordNotFound': 'No se encontró el registro.',
  'api.err.soilTestNotFound': 'No se encontró el análisis de suelo.',
  'api.err.noSuchEntry': 'No existe ese asiento.',
  'api.err.unknownStatus': 'estado desconocido',
  'api.err.unknownSpecies': 'speciesId desconocido',
  'api.err.unknownKind': 'tipo desconocido',
  'api.err.unknownBlock': 'bloque desconocido',
  'api.err.unknownCropPlugin': 'cultivo de la biblioteca desconocido',
  'api.err.unknownFieldId': 'fieldId desconocido',
  'api.err.unknownInputId': 'inputId desconocido',
  'api.err.unknownFertilityApplication': 'fertilityApplicationId desconocido',
  'api.err.unknownRef': '{field} desconocido',
  'api.err.unknownPendingCalibration': 'calibración pendiente desconocida',
  'api.err.blockIdRequired': 'falta blockId',
  'api.err.blockIdParamRequired': 'falta el id del bloque',
  'api.err.fieldIdParamRequired': 'falta el id del área',
  'api.err.tokenIdRequired': 'falta tokenId',
  'api.err.invalidBody': 'cuerpo no válido',
  'api.err.tooManyLookups': 'demasiadas búsquedas; inténtalo de nuevo en un minuto',
  'api.err.latLonInvalid': 'lat y lon deben ser coordenadas válidas',
  'api.err.queryLength': 'q debe tener entre 3 y 200 caracteres',
  'api.err.yearFourDigits': 'year debe ser un año de cuatro dígitos',
  'api.err.stateLiveDeleted': 'state debe ser live o deleted',
  'api.err.expectedGeoJson':
    'se esperaba GeoJSON Polygon / MultiPolygon / Feature / FeatureCollection',
  'api.err.invalidDetailsForKind': 'detalles no válidos para este tipo',
  'api.err.forceDeleteOwner':
    'borrar a la fuerza registros bloqueados requiere el rol de propietario',
  'api.err.identityKind': "kind debe ser 'email' o 'phone'",
  'api.err.wipeOwnerRequired': 'se requiere el rol de propietario para borrar todo',
  'api.err.wipeInteractiveOwner':
    'Solo el propietario, con la sesión iniciada en su propia cuenta, puede borrar la granja.',
  'api.err.wipeConfirm': 'envía {"confirm":"WIPE-EVERYTHING"} para continuar',
  'api.err.exportInteractiveOwner':
    'Solo el propietario, con la sesión iniciada en su propia cuenta, puede descargar la exportación completa.',
  'api.err.groupHasMembers': 'Este grupo todavía tiene animales con nombre.',
  'api.err.groupHasRecords': 'Este grupo tiene registros. Archívalo en su lugar.',
  'api.err.animalHasRecords': 'Este animal tiene registros. Archívalo en su lugar.',
  'api.err.animalOwnerOnly':
    'Solo el propietario puede cambiar esto. Los ayudantes pueden agregar una foto.',
  'api.err.animalGone': 'Este animal ya no está aquí. Solo se pueden cambiar las notas y la foto.',
  'api.err.photoTooLarge': 'La foto es demasiado grande. Debe ser un JPEG de menos de 300 KB.',
  'api.err.photoJpeg': 'La foto debe ser un JPEG.',
  'api.err.latestMoveOnly': 'Solo se puede quitar el último traslado.',
  'api.err.latestMoveVoidOnly': 'Solo se puede anular el último traslado.',
  'api.err.moveChangedGroup': 'Este traslado cambió un grupo. Mejor traslada al animal otra vez.',
  'api.err.voidMoveFailed': 'No se pudo anular este traslado.',
  'api.err.logLocked':
    'Este registro está bloqueado (pasaron 48 horas). Solo se puede cambiar a desechado.',
  'api.err.lockedLogOwner':
    'Solo el propietario puede quitar un registro bloqueado. Pregúntale al propietario.',
  'api.err.treatmentLocked':
    'Este registro está bloqueado (pasaron 48 horas). El propietario todavía puede quitarlo indicando un motivo.',
  'api.err.logInFuture': 'Un registro no puede tener fecha futura.',
  'api.err.attestUnknownApplication':
    'Esa aplicación no está en esta área o es demasiado antigua para afectar el pastoreo.',
  'api.err.attestProductRequired':
    'Esa aplicación usó más de un producto. Indica a qué producto corresponde la etiqueta.',
  'api.err.noApiKey': 'no hay una clave de API configurada',
  'api.err.saveKeyFirst': 'Primero guarda una clave en /settings/ai.',
  'api.err.notFallbackRow': 'no se encontró la fila o no es una fila de respaldo',
  'api.err.perEndpointRerun': 'volver a ejecutar por endpoint aún no está disponible',
  'api.err.bulkRerun': 'volver a ejecutar en lote aún no está disponible',
  'api.err.mintCookieOnly': 'crear tokens nuevos requiere una sesión con cookie',
  'api.err.tokenLabel': 'falta la etiqueta (máx. 64 caracteres)',
  'api.err.seedOrPurchase':
    'envía stockItemId (semilla en existencia) o purchase (recién comprada), no ambos',
  'api.err.ownerPlacesCrops': 'El propietario de la granja coloca los cultivos en los bancales.',
  'api.err.askOwner': 'Pregúntale al propietario.',
  'api.err.groupAnchorSwap':
    'No se puede cambiar el cultivo de la siembra ancla de un grupo. Deshaz el grupo primero para que los desfases entre compañeros sigan siendo coherentes.',
  'api.err.changePluginTodo': 'change-plugin aún no está disponible',
  'api.err.docDeleted': 'Este archivo se borró, así que no se puede adjuntar.',
  'api.err.photoStays': 'Las fotos se quedan con su entrada del diario o su animal.',
  'api.err.docDeleteOwner':
    'Solo el propietario, con la sesión iniciada en su propia cuenta, puede borrar un archivo.',
  'api.err.removePhotoFirst': 'Quita esta foto de su entrada del diario o de su animal.',
  'api.err.uploadOwnerOnly': 'Solo el propietario de la granja puede subir documentos.',
  'api.err.alertsInspector': 'las cuentas de inspector no pueden recibir alertas',
  'api.err.categoryEnabled': 'se requieren category y enabled',
  'api.err.addEmailFirst': 'Primero agrega un correo electrónico en la configuración de la cuenta.',
  'api.err.turnOnAlert': 'Primero activa al menos una alerta por correo.',
  'api.err.emailSuppressed':
    'Tu proveedor de correo informó que esta dirección se dio de baja o rebota.',
  'api.err.emailNotConfigured': 'Los enlaces por correo no están configurados en este servidor',
  'api.err.testEmailLimit':
    'Ya son suficientes correos de prueba por ahora. Inténtalo de nuevo en una hora.',
  'api.err.emailSendFailed': 'No pudimos enviar el correo en este momento.',
  'api.err.feedbackBrowser': 'los comentarios se envían desde un navegador con la sesión iniciada',
  'api.err.animalsOnAreaKind':
    'En esta área viven animales, y no pueden vivir en un área natural, agua o un lindero. Trasládalos primero.',
  'api.err.animalsOnAreaDelete':
    'En esta área viven animales. Trasládalos a otro lugar antes de borrarla.',
  'api.err.areaHasLineage':
    'Aquí se dividió un grupo o un animal cambió de grupo. Ese registro muestra qué animales comparten los tratamientos y el pastoreo del grupo, así que este lugar tiene que quedarse. Cámbiale el nombre en su lugar.',
  'api.err.forageAskOne': 'Pregunta por un área (fieldId) o por un corte de heno (hayCuttingId).',
  'api.err.forageNotOnFarm': 'Ese lugar o corte no está en esta granja.',
  'api.err.forageNameSubject': 'Indica un blockId, hayCuttingId o stockLotId.',
  'api.err.unknownFungicides': 'pluginIds de fungicida desconocidos',
  'api.err.removeDispositionsFirst': 'Primero quita a dónde fue.',
  'api.err.signInHarvestSee': 'Inicia sesión para ver a dónde fue esta cosecha.',
  'api.err.signInHarvestRecord': 'Inicia sesión para registrar a dónde fue una cosecha.',
  'api.err.bodyNotJson': 'El cuerpo de la solicitud no es JSON.',
  'api.err.signInChangeRecord': 'Inicia sesión para cambiar este registro.',
  'api.err.cropMismatchCrop': 'Esa siembra es de otro cultivo. Elige el cultivo que se cosechó.',
  'api.err.cropMismatchBlock': 'Esa siembra está en otro bloque.',
  'api.err.nwsFailed': 'falló el servicio del NWS',
  'api.err.noForecastLocation':
    'no hay un bloque en el mapa ni una ubicación de la granja; define una en /settings/farm o pasa &lat=&lon=',
  'api.err.hayStepFuture': 'Un paso del heno no puede tener fecha futura.',
  'api.err.mowFuture': 'Un corte no puede tener fecha futura.',
  'api.err.noHayOperations': 'falta el cultivo de la biblioteca o no declara hayOperations',
  'api.err.noFurtherSteps': 'no hay más pasos en steps[] del cultivo',
  'api.err.hayPluginRequired':
    'cropPluginId debe hacer referencia a un cultivo de la biblioteca que declare hayOperations',
  'api.err.recordSavingElsewhere':
    'Este registro ya se está guardando. Se volverá a intentar en breve.',
  'api.err.voidOwnerOnly':
    'Solo el propietario, con la sesión iniciada en su propia cuenta, puede anular una entrada.',
  'api.err.blockHasRecords':
    '{name} tiene registros, así que se queda. Bórralo desde la página Plan si de verdad quieres hacerlo.',
  'api.err.unknownSprayer': 'pulverizador desconocido: {id}',
  'api.err.cuttingAlready': 'el corte ya está en {status}',
  'api.err.cannotAdvance': 'no se puede avanzar de {from} a {to}',
  'api.err.tagInUse': 'El arete {tag} ya lo usa {name}.'
};
