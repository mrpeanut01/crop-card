/** Phase 37E (watering and automatic waterers). Keys start `herbse.`; only cluster 37E
 *  edits this file (C-1). The `equip.tpl.irrigation-*-timer.*` keys are the
 *  three timer templates' text, which `templateText.test.ts` reads by that
 *  name. */
export const enHerbse = {
  'herbse.title': 'Watering',

  'herbse.api.scheduleIrrigationOnly': 'Only a waterer (irrigation equipment) takes a schedule.',
  'herbse.api.bedNoArea': 'That bed is not in an Area.',
  'herbse.api.skipTooFar': 'Pick a run from the last week or the next week.',

  'herbse.df.container': 'Grown in pots or containers',
  'herbse.df.indoors': 'Kept indoors, such as a windowsill',

  'herbse.water.indoors': "Rain doesn't reach indoor pots. Check the soil.",
  'herbse.water.bedIndoors': "{names}: rain doesn't reach them indoors. Check the soil.",
  'herbse.water.timerNoAmount': '{timer} ran {day}, but its inches per run are not set.',
  'herbse.water.bedTimerNoAmount':
    '{names}: {timer} ran {day}, but its inches per run are not set.',
  'herbse.water.potHeat': 'Hot day and warm night ahead: check the pots today.',
  'herbse.water.checkSoil.one': 'Check the soil first: {crops} likes it dry.',
  'herbse.water.checkSoil.many': 'Check the soil first: {crops} like it dry.',
  'herbse.water.checkSoilBed.one': '{bed}: check the soil first, {crops} likes it dry.',
  'herbse.water.checkSoilBed.many': '{bed}: check the soil first, {crops} like it dry.',
  'herbse.water.mixed':
    '{bed} has plants with different water needs; this goes by the one that needs the most.',
  'herbse.water.needLine': '{bed} likes {level} ({crops}).',
  'herbse.need.low': 'dry soil',
  'herbse.need.medium': 'moderate moisture',
  'herbse.need.high': 'moist soil',

  'herbse.when.today': 'today at {time}',
  'herbse.when.tomorrow': 'tomorrow at {time}',
  'herbse.when.day': '{day} at {time}',

  'herbse.timer.next': '{timer} gives {inches} {when}.',
  'herbse.timer.nextNoAmount': '{timer} runs {when} for {minutes} min.',
  'herbse.timer.skipIt': '{timer} gives {inches} {when}; the week is at {week} already, skip it.',
  'herbse.timer.skipItNoAmount': '{timer} runs {when}; the week is at {week} already, skip it.',
  'herbse.timer.skipAction': 'Skip {timer} {when}',
  'herbse.timer.didNotRun': "{timer} didn't run {day}",
  'herbse.timer.setAmount': 'Set {timer} inches per run',
  'herbse.timer.skipped': "Skipped. That run won't count as water.",
  'herbse.timer.queued': "Saved on this phone. It will send when you're back online.",
  'herbse.timer.skipError': 'That did not save. Try again.',

  'herbse.schedule.everyDay': 'Every day',
  'herbse.schedule.summary': '{days} {start} for {minutes} min',
  'herbse.schedule.line': '{label}: {summary}',
  'herbse.schedule.lineInches': '{label}: {summary}, {inches} a run',
  'herbse.schedule.factLabel': 'Timers',
  'herbse.schedule.prov': 'Your timer schedule',

  'herbse.method.drip': 'Drip',
  'herbse.method.soaker': 'Soaker hose',
  'herbse.method.sprinkler': 'Sprinkler',

  'herbse.editor.title': 'Watering schedule',
  'herbse.editor.lede':
    'Enter what the timer is set to do. Each run counts as watering on the beds below. The app never talks to the timer.',
  'herbse.editor.none': 'No schedule yet.',
  'herbse.editor.days': 'Days it runs',
  'herbse.editor.start': 'Start time',
  'herbse.editor.minutes': 'Minutes per run',
  'herbse.editor.method': 'Kind',
  'herbse.editor.inches': 'Inches of water per run',
  'herbse.editor.inchesHint':
    "Type the inches each run gives. Without it, runs count as watering with the amount not known, and the advice can't say the beds had enough.",
  'herbse.editor.gpm': 'Gallons per minute (optional)',
  'herbse.editor.gpmHint':
    'Gallons count only when the timer waters one Area or bed, and that Area or bed has a size.',
  'herbse.editor.inchesSet': '{inches} in a run',
  'herbse.editor.noInches': 'Inches per run not set',
  'herbse.editor.save': 'Save schedule',
  'herbse.editor.edit': 'Edit schedule',
  'herbse.editor.set': 'Set a schedule',
  'herbse.editor.clear': 'Remove schedule',
  'herbse.editor.cancel': 'Cancel',
  'herbse.editor.saving': 'Saving…',
  'herbse.editor.saved': 'Saved.',
  'herbse.editor.manual': 'You entered this',
  'herbse.editor.askOwner': 'Ask the owner to change the schedule.',
  'herbse.editor.err.days': 'Pick at least one day.',
  'herbse.editor.err.minutes': 'Minutes must be a whole number from 1 to 720.',

  'herbse.targets.title': 'What it waters',
  'herbse.targets.none': 'Not linked to an Area or bed yet, so its runs count nowhere.',
  'herbse.targets.wholeArea': 'All of {area}',
  'herbse.targets.save': 'Save what it waters',
  'herbse.targets.noAreas': 'Draw a garden or field Area on the farm map first.',

  'equip.tpl.irrigation-drip-timer.category': 'Drip timer',
  'equip.tpl.irrigation-drip-timer.label': 'Drip line on a hose timer',
  'equip.tpl.irrigation-drip-timer.description':
    'Drip line or emitters on a hose-end timer. Set its days, start time and minutes, and the inches each run gives, so each run counts as watering.',
  'equip.tpl.irrigation-soaker-timer.category': 'Soaker hose timer',
  'equip.tpl.irrigation-soaker-timer.label': 'Soaker hose on a hose timer',
  'equip.tpl.irrigation-soaker-timer.description':
    'Soaker hose on a hose-end timer. Set its days, start time and minutes, and the inches each run gives, so each run counts as watering.',
  'equip.tpl.irrigation-sprinkler-timer.category': 'Sprinkler timer',
  'equip.tpl.irrigation-sprinkler-timer.label': 'Sprinkler on a hose timer',
  'equip.tpl.irrigation-sprinkler-timer.description':
    'Sprinkler on a hose-end timer. Set its days, start time and minutes, and the inches each run gives, so each run counts as watering.'
} as const;
