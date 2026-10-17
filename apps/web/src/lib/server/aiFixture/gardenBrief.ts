/** TEST ONLY. Fixture Claude answers for the garden brief (Phase 37, R-24).
 *  A request is routed here when its prompt carries `GARDEN_BRIEF_FIXTURE_MARKER`.
 *  The answer is shaped from the request: the first herbs of the prompt's
 *  library that the owner does not avoid, plus one unknown id and one
 *  sentence the spray-advice guard must replace, so the server's checks run
 *  on every e2e turn. The wording is placeholder text with no advice. */
import { type FixtureEntry, FixtureNoAnswerError, promptHasMarker, promptText } from './types';

export const GARDEN_BRIEF_FIXTURE_MARKER = 'CROPCARD_FIXTURE:garden-brief';
export const FIXTURE_BRIEF_REPLY = 'Fixture Claude reply: what do you like to cook most?';
export const FIXTURE_BRIEF_BECAUSE = 'Fixture Claude picked this herb for your kitchen.';
export const FIXTURE_BRIEF_UNKNOWN_ID = 'fixture-not-a-herb';
export const FIXTURE_BRIEF_SPRAY_LINE = 'Spray it with neem oil every week.';

const LIBRARY_LEAD = 'Herb library';
const AVOID_LEAD = '- Herbs they never use (never suggest these): ';

interface LibraryHerb {
  id: string;
  name: string;
}

export function parseBriefLibrary(prompt: string): LibraryHerb[] {
  const lines = prompt.split('\n');
  const start = lines.findIndex((l) => l.startsWith(LIBRARY_LEAD));
  if (start < 0) return [];
  const out: LibraryHerb[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^- ([a-z0-9-]+): (.+) \([^()]*\)$/.exec(line);
    if (!m) break;
    out.push({ id: m[1], name: m[2] });
  }
  return out;
}

export function fixtureBriefAnswer(prompt: string): string {
  const library = parseBriefLibrary(prompt);
  if (library.length === 0) throw new FixtureNoAnswerError('garden brief request');
  const avoidLine = prompt.split('\n').find((l) => l.startsWith(AVOID_LEAD)) ?? '';
  const avoided = new Set(
    avoidLine
      .slice(AVOID_LEAD.length)
      .split(',')
      .map((s) => s.trim())
  );
  const picks = library.filter((h) => !avoided.has(h.name) && !avoided.has(h.id)).slice(0, 3);
  return JSON.stringify({
    reply: FIXTURE_BRIEF_REPLY,
    followUp: 'cuisines',
    shortlist: [
      ...picks.map((h, i) => ({
        cropPluginId: h.id,
        because: i === picks.length - 1 ? FIXTURE_BRIEF_SPRAY_LINE : FIXTURE_BRIEF_BECAUSE
      })),
      { cropPluginId: FIXTURE_BRIEF_UNKNOWN_ID, because: FIXTURE_BRIEF_BECAUSE }
    ]
  });
}

export const gardenBriefFixture: FixtureEntry = {
  name: 'garden-brief',
  matches: (params) => promptHasMarker(params, GARDEN_BRIEF_FIXTURE_MARKER),
  answer(params) {
    return fixtureBriefAnswer(promptText(params));
  }
};
