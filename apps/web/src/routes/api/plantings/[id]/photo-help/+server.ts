import { json, type RequestHandler } from '@sveltejs/kit';
import { toCropPlugin } from '$lib/server/cardSnapshot';
import {
  badRequest,
  cleanPhoto,
  cropOr404,
  journalWriter,
  photoHelpSchema,
  readJson
} from '$lib/server/journalApi';
import { answerPhotoHelp } from '$lib/server/photoHelp';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';
import { getRegistry } from '$lib/server/registry';
import { sprayTermsFor } from '$lib/server/sprayTerms';
import { t } from '$lib/i18n';

export const _requestSchema = photoHelpSchema;

/** POST /api/plantings/[id]/photo-help. A short answer from Claude when it
 *  is on, otherwise the matching Care Guide section. Never spray advice.
 *  The ask is saved to the planting journal either way, at most once per
 *  client record id (R-23). With `wantMarks` and a photo, Claude also places
 *  marks on it (37F). */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const who = await journalWriter(event);
  if (!who.ok) return who.response;
  const parsed = photoHelpSchema.safeParse(await readJson(event));
  if (!parsed.success) return badRequest(parsed.error, event.locals?.locale);
  if (parsed.data.question === 'other' && !parsed.data.text.trim()) {
    return json({ error: t(event.locals?.locale, 'cardsui.photo.needQuestion') }, { status: 400 });
  }
  const crop = cropOr404(event.params.id, event.locals?.locale);
  if (crop instanceof Response) return crop;
  const photo = cleanPhoto(parsed.data.photo, event.locals?.locale);
  if (!photo.ok) return photo.response;

  const registry = await getRegistry();
  const rec = registry.get(crop.cropPluginId);
  const plugin = rec ? toCropPlugin(rec.plugin) : null;
  return json(
    await answerPhotoHelp({
      userId: who.userId,
      crop,
      plugin,
      req: {
        question: parsed.data.question,
        text: parsed.data.text,
        photo: photo.photo,
        wantMarks: parsed.data.wantMarks === true
      },
      sprayTerms: sprayTermsFor(registry),
      locale: event.locals?.locale,
      write: (fn) => writeRecord(event, fn)
    })
  );
});
