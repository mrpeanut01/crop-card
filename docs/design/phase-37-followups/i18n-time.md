# #868 follow-up: Spanish time phrasing and the pantry cut task

Two defects from "Still open after 37" in the Phase 37 plan. No migration, no safety-rule change (`RULES_VERSION` stays 0.7.11), no snapshot or export version bump. English output is byte-identical on every screen touched.

## 1. "a la 1:00", not "a las 1:00"

Spanish takes the singular article at one o'clock ("a la 1:00 p. m.", "a la 1:30") and the plural at every other hour ("a las 2:00", "a las 12:00 a. m.", "a las 13:00", "a las 0:00"). A fixed "a las {time}" template cannot do that, so the time now arrives as a whole phrase.

### Helper: `apps/web/src/lib/i18n/atTime.ts` (client-safe)

- `atText(time, locale?, style = 'at')`: wraps clock text that is already formatted. It reads the hour the text shows (`shownHour`, the first run of digits, so "1:00 p.m." and "01:00" are 1 and "13:00" is 13) and picks the plural key by it, so Spanish gets `.one` only for a shown 1.
- `atTime(value, { timeZone, locale }, style = 'at')`: an instant (`Date`, ms or ISO string) formatted through `formatInstant(..., 'time')` in the zone, or a stored `HH:MM` clock value ("06:00" reads "6:00", the timer's own form).
- `style: 'at'` gives English "at 1:00 PM"; `style: 'clock'` gives English the bare clock text, for sentences whose English takes no "at" ("fetched 2:00 PM", "Mon, Wed 6:00 for 20 min"). Spanish keeps its article in both styles.
- Without a locale, English. Callers that already format their own time keep doing so and pass the text to `atText`, which is how English stays byte for byte.

### Keys

New plural pairs in `core` (`catalogs/{en,es}/core.ts`):

| Key                                   | English     | Spanish                        |
| ------------------------------------- | ----------- | ------------------------------ |
| `core.at.one` / `core.at.other`       | `at {time}` | `a la {time}` / `a las {time}` |
| `core.clock.one` / `core.clock.other` | `{time}`    | `a la {time}` / `a las {time}` |

Keys changed to take the phrase as `{at}` (each in its own area file, English and Spanish):

| Key                        | English now                                     | Spanish now                             | Caller                                                        |
| -------------------------- | ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `herbse.when.today`        | `today {at}`                                    | `hoy {at}`                              | `runWhenText` in `lib/weather/waterCopy.ts`                   |
| `herbse.when.tomorrow`     | `tomorrow {at}`                                 | `mañana {at}`                           | `runWhenText`                                                 |
| `herbse.when.day`          | `{day} {at}`                                    | `el {day} {at}`                         | `runWhenText`, `skipWhenText`                                 |
| `herbse.schedule.summary`  | `{days} {at} for {minutes} min` (was `{start}`) | `{days} {at} durante {minutes} min`     | `scheduleSummary` in `lib/irrigation/summary.ts`, clock style |
| `sprayui.fun.fetched`      | `NWS forecast · fetched {at}`                   | `Pronóstico del NWS · obtenido {at}`    | `/spray/fungicide`, clock style                               |
| `entry.demo.banner`        | `… is cleared {at}.`                            | `… se borra {at}.`                      | `DemoBanner.svelte`                                           |
| `cardsui.one.printingCopy` | `Printing the copy saved {at}. …`               | `Imprimiendo la copia guardada {at}. …` | `/cards/[kind]/[key]`                                         |

Those are every Spanish catalog value that put "a las" in front of a time placeholder. A new sentence that names a clock time should take `{at}` from `atText` / `atTime` instead of writing "a las" itself.

Tests: `lib/i18n/atTime.test.ts` (both languages at 1:00, 13:00, 2:00 and midnight, a fast-check property that English is "at {time}" / the bare time for every minute of the day, and each caller's English against the old template on fixed instants), plus the existing `t.test.ts`, `irrigation/snapshot.test.ts` and `waterCopy.timer.test.ts`.

## 2. The pantry cut task is stored in English

`/plan/pantry`'s "Schedule the next cut" used to post `herbsc.task.title` / `herbsc.task.body` in the reader's language. It now posts English, like every other `derived:` task, and the task shows in each reader's language on display.

- `lib/garden/pantryCutTask.ts` (pure, client-safe): `PANTRY_CUT_KEY_PREFIX`, `pantryCutTemplateKey(plantingId, week)`, `isPantryCutKey`, `pantryCutTaskText(cropName)` (the English title and notes saved), `pantryCutTitleIn(title, locale)` and `pantryCutBodyIn(body, locale)`.
- The English crop name is the planting's stored name, which the page cannot rebuild from its localized `cropName`, so the server hands the text over: `harvestScheduleWithCutTasks(scope)` in `lib/server/pantry.server.ts` returns `{ schedule, cutTasks }` (`cutTasks[plantingId] = { title, body }`, English whatever the locale) from the same read; `harvestScheduleResponse` is now a wrapper over it, and `GET /api/garden/harvest-schedule` is unchanged. The page loader returns `cutTasks` and the button posts it. `POST /api/tasks` is unchanged.
- `taskDisplayTitle` / `taskDisplayBody` in `lib/tasks/title.ts` translate a `derived:pantry-cut:` task the way the herb calendar events are translated: a title of the form "Cut {crop}" becomes `herbsc.task.title` in the reader's language with the crop through `cropDisplayNameByEnglish` (a plugin name turns Spanish, an owner-typed name stays as typed), and the notes turn Spanish only while they are still the shipped English. An edited title or note shows as saved.
- Titles a Spanish owner stored before this change ("Cortar …") stay as stored; nothing rewrites them.

Tests: `lib/garden/pantryCutTask.test.ts` (mapping, a fast-check property over typed names, edited text left alone, other keys untouched), `routes/plan/pantry/pantryCutTask.route.test.ts` (the loader gives English in Spanish and English, a Spanish owner's `POST /api/tasks` stores English that reads Spanish to a Spanish reader and English to an English one). `tests/e2e/pantry.spec.ts` gains no Spanish case: Spanish is on only for the magic-link e2e server, `pantry.spec.ts` signs in on the direct one, and the magic sign-in helper is copied per spec rather than shared, so the route and unit tests carry this. "Schedule the next cut" is not clicked in e2e either, because whether a herb has a next cut depends on the date the suite runs. The existing `pantry.spec.ts` cases pass unchanged.
