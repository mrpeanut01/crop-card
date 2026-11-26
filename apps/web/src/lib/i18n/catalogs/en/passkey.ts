/** Phase 38 passkey sign-in. Keys start `passkey.`. */
export const enPasskey = {
  'passkey.signin.button': 'Use a passkey',
  'passkey.signin.working': 'Waiting for your passkey…',
  'passkey.signin.help':
    'Is your passkey on your phone? Choose "Use a phone or tablet" and scan the code with your phone. Bluetooth needs to be on for both.',
  'passkey.offer.title': 'Sign in faster next time',
  'passkey.offer.body':
    'Add a passkey and sign in with Face ID, your fingerprint or your device PIN. No email to wait for.',
  'passkey.offer.shared': 'Only add this on your own phone or computer.',
  'passkey.offer.add': 'Add a passkey',
  'passkey.offer.notNow': 'Not now',
  'passkey.offer.never': "Don't ask on this device",
  'passkey.offer.done': 'Passkey added. Next time, choose it when you sign in.',
  'passkey.settings.title': 'Passkeys',
  'passkey.settings.lede':
    'Sign in with Face ID, your fingerprint or your device PIN, without waiting for an email.',
  'passkey.settings.empty': 'No passkeys yet.',
  'passkey.settings.add': 'Add a passkey on this device',
  'passkey.settings.defaultName': 'Passkey',
  'passkey.settings.synced': 'Synced to your other devices',
  'passkey.settings.added': 'Added {date}',
  'passkey.settings.lastUsed': 'Last used {date}',
  'passkey.settings.neverUsed': 'Not used yet',
  'passkey.settings.rename': 'Rename',
  'passkey.settings.renameLabel': 'Rename {name}',
  'passkey.settings.nameLabel': 'Passkey name',
  'passkey.settings.save': 'Save',
  'passkey.settings.cancel': 'Cancel',
  'passkey.settings.remove': 'Remove',
  'passkey.settings.removeLabel': 'Remove {name}',
  'passkey.settings.confirmRemove':
    'Remove this passkey? You can still sign in with an email link or a code.',
  'passkey.settings.stolen':
    'Lost a phone or computer? Remove its passkey here, then use Sign out everywhere to end its sessions.',
  'passkey.err.unavailable': 'Passkeys are not available right now. Use the email link instead.',
  'passkey.err.unsupported': 'This browser cannot use passkeys. Use the email link instead.',
  'passkey.err.signinFailed': 'That passkey did not work. Try again, or use the email link.',
  'passkey.err.busy': 'Too many tries. Wait a few minutes and try again.',
  'passkey.err.reauth': 'For your security, sign in again to add a passkey.',
  'passkey.err.demo': 'Demo farms cannot add passkeys.',
  'passkey.err.addFailed': 'The passkey could not be added. Try again.',
  'passkey.err.duplicate': 'This passkey is already on your account.',
  'passkey.err.notFound': 'That passkey was not found.',
  'passkey.err.badRequest': 'That request could not be read.'
} as const;
