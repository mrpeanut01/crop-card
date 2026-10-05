import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getField } from '$lib/db/fields';
import { listBlocks } from '$lib/db/blocks';
import { farmTimeZone } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { t } from '$lib/i18n';
import { applicationsOnField, loadGrazingContext } from '$lib/server/areaGrazing';
import { formatClearDate } from '$lib/safety/animalWithdrawal';
import {
  STRICTEST_SUBJECT,
  evaluateGrazing,
  evaluateHayCut,
  type GrazingVerdict
} from '$lib/safety/grazingInterval';

function holdText(v: GrazingVerdict, timeZone: string): string {
  if (v.status === 'clear') return 'Clear';
  if (v.reason === 'GRAZING_PROHIBITED') return 'Not allowed: the label forbids it';
  if (v.reason === 'GRAZING_UNKNOWN') return 'Not on file yet';
  const at = v.clearsAtMs ?? v.knownClearsAtMs;
  return at === null ? 'On hold' : `On hold until ${formatClearDate(at, timeZone)}`;
}

/** Owner page for C-27: every application on an Area inside the lookback
 *  window, with the grazing and haying times on file. The owner types the
 *  times read from each label; nothing is filled in for them. */
export const load: PageServerLoad = async (event) => {
  const field = getField(event.params.id);
  if (!field) error(404, t(event.locals?.locale, 'forage.page.areaNotFound'));
  const user = currentUser(event);
  const timeZone = farmTimeZone();
  const blocks = new Map(
    listBlocks({ plantings: 'none' })
      .filter((b) => b.fieldId === field.id)
      .map((b) => [b.id, b.name])
  );
  const now = Date.now();
  const context = await loadGrazingContext(now);
  const rows = applicationsOnField(context.applications, field.id)
    .map((a) => {
      const base = {
        applications: [a],
        attestations: context.attestations,
        atMs: now,
        timeZone,
        registryMaxIntervalDays: context.registryMaxIntervalDays
      };
      const graze = evaluateGrazing({
        ...base,
        subject: { ...STRICTEST_SUBJECT, lactating: false }
      });
      const milking = evaluateGrazing({ ...base, subject: STRICTEST_SUBJECT });
      const hay = evaluateHayCut(base);
      const attested = context.attestations
        .filter(
          (t) =>
            t.sprayEventRef === a.ref && (t.productPluginId ?? null) === (a.productPluginId ?? null)
        )
        .map((t) => ({
          grazeDays: t.grazeDays,
          hayDays: t.hayDays,
          lactatingGrazeDays: t.lactatingGrazeDays ?? null,
          meatRemovalDays: t.meatRemovalDays ?? null
        }));
      return {
        key: `${a.ref}|${a.productPluginId ?? ''}`,
        ref: a.ref,
        productPluginId: a.productPluginId,
        productName: a.productName,
        blockName: blocks.get(a.blockId) ?? 'a deleted block',
        appliedAtMs: a.appliedAtMs,
        forbidden: a.restrictions?.notForPasture === true,
        needsLabel:
          graze.reason === 'GRAZING_UNKNOWN' ||
          milking.reason === 'GRAZING_UNKNOWN' ||
          hay.reason === 'GRAZING_UNKNOWN',
        grazing: holdText(graze, timeZone),
        milking: holdText(milking, timeZone),
        haying: holdText(hay, timeZone),
        attested
      };
    })
    .sort((x, y) => Number(y.needsLabel) - Number(x.needsLabel) || y.appliedAtMs - x.appliedAtMs);
  return {
    field: { id: field.id, name: field.name },
    rows,
    isOwner: user?.role === 'owner',
    timeZone
  };
};
