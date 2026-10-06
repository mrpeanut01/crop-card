/** The calendar as the screens show it (#562, #593): stages in order, each
 *  with the windows the season's low-input filter keeps (OR-8) and whether
 *  "Check the label." goes under each (OP-8). The calendar page and the
 *  offline snapshot both build it here, so the online and offline copies
 *  cannot drift. The bee line is never data: screens get it from
 *  `beeLineFor(guide.publicationId)`. Client-safe. */

import type { OrchardCalendarPlugin, OrchardWindow } from '$lib/plugins/schemas';
import { showsLabelLine, shownWindows } from './calendar';

export interface OrchardWindowView {
  id: string;
  purpose: OrchardWindow['purpose'];
  targets: OrchardWindow['targets'];
  note?: string;
  pollinatorSensitive: boolean;
  labelLine: boolean;
}

export interface OrchardStageView {
  id: string;
  name: string;
  description: string;
  windows: OrchardWindowView[];
}

export interface OrchardCalendarView {
  pluginId: string;
  audience: OrchardCalendarPlugin['audience'];
  edition: string;
  guide: OrchardCalendarPlugin['guide'];
  stages: OrchardStageView[];
}

export function orchardCalendarView(
  calendar: OrchardCalendarPlugin,
  lowInput: boolean
): OrchardCalendarView {
  return {
    pluginId: calendar.pluginId,
    audience: calendar.audience,
    edition: calendar.edition,
    guide: calendar.guide,
    stages: [...calendar.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.recognise.description,
        windows: shownWindows(calendar, s, lowInput).map((w) => ({
          id: w.id,
          purpose: w.purpose,
          targets: w.targets,
          ...(w.note ? { note: w.note } : {}),
          pollinatorSensitive: !!w.pollinatorSensitive,
          labelLine: showsLabelLine(calendar, w)
        }))
      }))
  };
}
