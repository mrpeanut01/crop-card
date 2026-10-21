/** #870: Phase 37 follow-ups (waterer gallons with several targets, undo a
 *  skip, "running since", the brief's stored conversation). Keys start
 *  `herbsg.`; only that work edits this file. */
export const enHerbsg = {
  'herbsg.api.skipNotFound': 'No such skipped run.',
  'herbsg.api.skipUndoAskOwner':
    'Only the owner, or the person who logged it in the last 48 hours, can undo this skip. Ask the owner.',
  'herbsg.api.skipUndoReadOnly':
    'Inspectors can read watering records but not change them. Ask the owner.',
  'herbsg.api.sharesIncomplete': 'Give a share for every Area and bed it waters, or for none.',
  'herbsg.api.sharesTotal': 'The shares must add up to 100%.',
  'herbsg.api.runningSinceFuture': '"Running since" cannot be after today.',

  'herbsg.skip.title': 'Skipped runs',
  'herbsg.skip.lede':
    'Runs someone marked as not watering, from the last week and the next. Undo one and it counts as water again.',
  'herbsg.skip.none': 'No runs skipped in the last week or the next.',
  'herbsg.skip.line': '{timer} skipped {when} ({reason}).',
  'herbsg.skip.pageLine': 'Skipped {when} ({reason})',
  'herbsg.skip.reason.did-not-run': "it didn't run",
  'herbsg.skip.reason.turned-off-for-rain': 'turned off for the rain',
  'herbsg.skip.reason.other': 'another reason',
  'herbsg.skip.undo': 'Undo',
  'herbsg.skip.undoLabel': 'Undo the skip of {timer} {when}',
  'herbsg.skip.undone': 'Skip undone. That run counts as water again.',
  'herbsg.skip.undoOffline': 'Undo needs a connection. Try again when you are back online.',
  'herbsg.skip.undoError': 'That did not undo. Try again.',

  'herbsg.editor.runningSince': 'Running since (optional)',
  'herbsg.editor.runningSinceHint':
    'If the timer was already running this program before you set it up here, enter the day it started. Its runs from that day count as watering.',
  'herbsg.editor.runningSinceSet': 'Running since {date}',
  'herbsg.editor.err.runningSince': 'Pick a day no later than today.',
  'herbsg.editor.gpmHint':
    "With more than one Area or bed, the gallons are split by size unless you type each one's share. Gallons count only where the Area or bed has a size.",

  'herbsg.split.title': 'How the gallons split',
  'herbsg.split.inchesWin':
    'Inches per run is set, so each run counts as that many inches on everything it waters.',
  'herbsg.split.size': '{name}: {pct}% of the gallons, by size',
  'herbsg.split.typed': '{name}: {pct}% of the gallons',
  'herbsg.split.prov.size': 'Split by the size of each Area and bed',
  'herbsg.split.unknown.no-size':
    'The split is not known: an Area or bed here has no size. Add its size on the farm map, or type each share.',
  'herbsg.split.unknown.overlap':
    'The split is not known: a bed is inside an Area this timer also waters. Type each share.',
  'herbsg.split.unknown.shares':
    'The split is not known: the shares you typed no longer add up to 100%. Type them again.',
  'herbsg.split.typeShares': "Type each one's share of the gallons",
  'herbsg.split.shareLabel': 'Share for {name} (%)',
  'herbsg.split.total': 'Total: {pct}%',
  'herbsg.split.err.total': 'The shares must add up to 100%.',

  'herbsg.brief.earlierTitle': 'Your earlier conversation',
  'herbsg.brief.readOnlyNote':
    'Claude is not turned on for this farm, so you can read your earlier conversation but not add to it.'
} as const;
