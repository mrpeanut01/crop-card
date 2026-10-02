// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { insertAnimal } from '$lib/db/animals';
import { insertHealthEvent } from '$lib/db/animalHealth';
import { insertOrganicStatusEntry } from '$lib/db/organicStatus';
import { load as ORGANIC_PAGE } from './+page.server';
import { load as HEALTH_PAGE } from '../../animals/[id]/health/+page.server';

// OR-10: /records/organic and /animals/[id]/health read the shipped
// animal-health library's organicUse (34A organic cluster).

const DAY = 86_400_000;
const USER = 'organic-loader-owner';

db.insert(users)
  .values({ id: USER, email: `${USER}@test.local` })
  .onConflictDoNothing()
  .run();

interface Treatment {
  id: string;
  product: string | null;
  outcomeText: string;
  organicUseLine: string | null;
}

function seed() {
  const ownerId = `organic-loader-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: 'Loader farm', slug: ownerId, billingStatus: 'active' })
    .run();
  const ids = runWithTenant(ownerId, () => {
    const out: Record<string, { animalId: string; eventId: string }> = {};
    for (const pluginId of ['cydectin-pour-on', 'covexin-8', 'ivomec-injection']) {
      const cow = insertAnimal({
        speciesId: 'cattle',
        name: `Cow ${pluginId}`,
        sex: 'female',
        purpose: 'production',
        foodProducing: true
      });
      insertOrganicStatusEntry({
        subjectType: 'animal',
        subjectId: cow.id,
        status: 'organic',
        effectiveAt: Date.now() - 400 * DAY,
        certifier: 'Valley Organic',
        note: null,
        createdBy: USER
      });
      const ev = insertHealthEvent({
        subjectType: 'animal',
        subjectId: cow.id,
        kind: pluginId === 'covexin-8' ? 'vaccination' : 'deworm',
        productPluginId: pluginId,
        route: pluginId === 'cydectin-pour-on' ? 'pour-on' : 'injection',
        labelUse: 'label',
        administeredAt: Date.now() - 2 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: USER
      });
      out[pluginId] = { animalId: cow.id, eventId: ev.id };
    }
    return out;
  });
  return { ownerId, ids };
}

function event(ownerId: string, path: string, locale: string, params: Record<string, string> = {}) {
  return {
    params,
    url: new URL(`http://localhost${path}`),
    request: new Request(`http://localhost${path}`),
    locals: {
      locale,
      authVia: 'cookie',
      user: {
        id: USER,
        email: `${USER}@test.local`,
        phone: null,
        role: 'owner',
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    cookies: { get: () => undefined }
  } as never;
}

async function organicTreatments(ownerId: string, locale = 'en'): Promise<Treatment[]> {
  return runWithTenantAsync(ownerId, async () => {
    const data = (await ORGANIC_PAGE(event(ownerId, '/records/organic', locale))) as unknown as {
      treatments: Treatment[];
    };
    return data.treatments;
  });
}

describe('organic pages read the shipped library (OR-10)', () => {
  it('shows the conditions, the allowed line and no line for an unknown product', async () => {
    const { ownerId, ids } = seed();
    const rows = await organicTreatments(ownerId);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const moxidectin = byId.get(ids['cydectin-pour-on'].eventId)!;
    expect(moxidectin.outcomeText).toBe('Needs review');
    expect(moxidectin.organicUseLine).toBe(
      'Library entry: allowed for organic use with conditions (7 CFR 205.603(a)(23)(ii)). Conditions: Parasiticides—prohibited in slaughter stock, allowed in emergency treatment for dairy and breeder stock when organic system plan-approved preventive management does not prevent infestation. In breeder stock, treatment cannot occur during the last third of gestation if the progeny will be sold as organic and must not be used during the lactation period for breeding stock. Allowed for fiber bearing animals when used a minimum of 36 days prior to harvesting of fleece or wool that is to be sold, labeled, or represented as organic. (ii) Moxidectin (CAS #113507-06-5)—milk or milk products from a treated animal cannot be labeled as provided for in subpart D of this part for: 2 days following treatment of cattle; 36 days following treatment of goats, sheep, and other dairy species. This is a fact to weigh, not the answer.'
    );

    const vaccine = byId.get(ids['covexin-8'].eventId)!;
    expect(vaccine.outcomeText).toBe('Needs review');
    expect(vaccine.organicUseLine).toMatch(
      /^Library entry: allowed for organic use \(7 CFR 205\.603\(a\)\(4\)\)\. Conditions: \(f\) Excipients/
    );

    const ivermectin = byId.get(ids['ivomec-injection'].eventId)!;
    expect(ivermectin.outcomeText).toBe('Needs review');
    expect(ivermectin.organicUseLine).toBeNull();
  });

  it('renders the fact line in Spanish around the stored English quote', async () => {
    const { ownerId, ids } = seed();
    const rows = await organicTreatments(ownerId, 'es');
    const vaccine = rows.find((r) => r.id === ids['covexin-8'].eventId)!;
    expect(vaccine.outcomeText).toBe('Necesita revisión');
    expect(vaccine.organicUseLine).toMatch(
      /^Dato de la biblioteca: permitido para uso orgánico \(7 CFR 205\.603\(a\)\(4\)\)\. Condiciones: \(f\) Excipients—only for use/
    );
  });

  it('the animal health page still renders an organic outcome for each', async () => {
    const { ownerId, ids } = seed();
    for (const { animalId, eventId } of Object.values(ids)) {
      const data = (await runWithTenantAsync(ownerId, async () =>
        HEALTH_PAGE(event(ownerId, `/animals/${animalId}/health`, 'en', { id: animalId }))
      )) as unknown as {
        organic: { outcomes: Record<string, { text: string; needsAnswer: boolean }> } | null;
      };
      expect(data.organic?.outcomes[eventId]).toEqual({ text: 'Needs review', needsAnswer: true });
    }
  });
});
