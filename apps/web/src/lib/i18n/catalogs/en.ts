/**
 * The English catalog is the source of every message key (F5-2). Keys are
 * flat and dotted; a plural message is two keys, `<base>.one` and
 * `<base>.other`, and callers pass the base with a `count`.
 */
export const en = {
  'nav.primary': 'Primary',
  'nav.home': 'CropCard home',
  'nav.today': 'Today',
  'nav.plan': 'Plan',
  'nav.spray': 'Spray',
  'nav.scout': 'Scout',
  'nav.harvest': 'Harvest',
  'nav.animals': 'Animals',
  'nav.petsAndAnimals': 'Pets & animals',
  'nav.inventory': 'Inventory',
  'nav.equipment': 'Equipment',
  'nav.records': 'Records',
  'nav.cards': 'Cards',
  'nav.more': 'More',
  'nav.morePages': 'More pages',
  'nav.feedbackInbox': 'Feedback inbox',
  'nav.sendFeedback': 'Send feedback',
  'nav.settings': 'Settings',
  'nav.switchFarm': 'Switch farm',
  'nav.alerts': 'Alerts',
  'nav.alertsNone': 'Alerts, none active',
  'nav.alertsActive.one': 'Alerts, {count} active',
  'nav.alertsActive.other': 'Alerts, {count} active',
  'nav.alertsEmpty': 'No active alerts.',
  'nav.alertsOpenToday': 'Open Today →',
  'nav.language': 'Language',
  'nav.languageFailed': "Couldn't change the language. Try again.",
  'nav.pendingRecords.one': '{count} offline record waiting to sync',
  'nav.pendingRecords.other': '{count} offline records waiting to sync',

  'onboarding.language.question': 'Which language should CropCard use?',
  'onboarding.language.note':
    'You can change it any time in Settings or with the EN / ES button at the top.',

  'account.pageTitle': 'Account & sign-in · CropCard',
  'account.title': 'Account & sign-in',
  'account.kicker': 'Owner profile',
  'account.profile.title': 'Profile',
  'account.profile.sub': 'Visible to helpers in your farm.',
  'account.profile.displayName': 'Display name',
  'account.profile.displayNameHint': 'Leave blank to use your sign-in name.',
  'account.profile.timeZone': 'Time zone',
  'account.profile.displayUnits': 'Display units',
  'account.profile.saved': 'Profile saved.',
  'account.language.title': 'Language',
  'account.language.sub':
    'Menus and settings use this language. Safety steps, spray flows, label text and email stay in English.',
  'account.language.label': 'App language',
  'account.language.save': 'Use this language',
  'account.language.saved': 'Language saved.',
  'account.language.unavailable': 'That language is not available.',
  'account.signIn.title': 'Sign-in methods',
  'account.signIn.sub':
    'No passwords. Email is the main way in: one message carries a sign-in link and a 6-digit backup code. A verified mobile number works too.',
  'account.sessions.title': 'Sessions',
  'account.sessions.sub': 'Signed-in devices.',
  'account.sessions.lastSignIn': 'Last sign-in',
  'account.sessions.lastSignInHint': 'Cookie session',
  'account.sessions.lastSignInValue': 'today · {time}',
  'account.sessions.active': 'Active sessions · {count}',
  'account.sessions.thisBrowser': 'This browser session',
  'account.sessions.current': 'current',
  'account.sessions.thisDevice': 'This device',
  'account.sessions.signOut': 'Sign out',
  'account.sessions.signOutEverywhere': 'Sign out everywhere',
  'account.export.title': 'Data export',
  'account.export.sub': 'Download everything we keep about you and your farm records.',
  'account.export.json': 'Download account data (JSON)',
  'account.export.vdacs': 'Download VDACS audit pack'
} as const;

export type MessageKey = keyof typeof en;
