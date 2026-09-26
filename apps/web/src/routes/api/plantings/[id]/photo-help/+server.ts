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
import { getRegistry } from '$lib/server/registry';

export const _requestSchema = photoHelpSchema;

/** POST /api/plantings/[id]/photo-help. A short answer from Claude when it
 *  is on, otherwise the matching Care Guide section. Never spray advice.
 *  The ask is saved to the planting journal either way. */
export const POST: RequestHandler = async (event) => {
  const who = await journalWriter(event);
  if (!who.ok) return who.response;
  const parsed = photoHelpSchema.safeParse(await readJson(event));
  if (!parsed.success) return badRequest(parsed.error);
  if (parsed.data.question === 'other' && !parsed.data.text.trim()) {
    return json({ error: 'Type a question or pick one of the chips.' }, { status: 400 });
  }
  const crop = cropOr404(event.params.id);
  if (crop instanceof Response) return crop;
  const photo = cleanPhoto(parsed.data.photo);
  if (!photo.ok) return photo.response;

  const rec = (await getRegistry()).get(crop.cropPluginId);
  const plugin = rec ? toCropPlugin(rec.plugin) : null;
  return json(
    await answerPhotoHelp({
      userId: who.userId,
      crop,
      plugin,
      req: { question: parsed.data.question, text: parsed.data.text, photo: photo.photo }
    })
  );
};
