// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/dbMaintenance', () => ({
  runDbMaintenance: vi.fn(async () => ({
    ran: false,
    skipped: 'recent',
    pruned: {},
    durationMs: 0
  }))
}));
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import { createEquipment, updateEquipmentState } from '$lib/db/equipment';
import { upsertSubscription } from '$lib/db/pushSubscriptions';
import { optIn } from '$lib/db/emailAlertConsents';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import { createTask } from '$lib/db/tasks';
import { HARD_FREEZE_NOTE } from '$lib/climate/protection';
import { t } from '$lib/i18n';
import { clearOutbox, dispatchEmail, readOutbox } from '$lib/server/email';
import { requestMagicLink } from '$lib/server/magicLink';
import { requestSmsLogin } from '$lib/server/loginCodes';
import { clearSmsOutbox, readSmsOutbox } from '$lib/server/sms';
import { minutesInWords, smsLoginBody } from '$lib/server/otpMessage';
import { recipientLocale } from '$lib/server/recipientLocale';
import { processOwnerAlerts } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';
import {
  batchMessage,
  careDueAlerts,
  holdCoversSaleText,
  withdrawalClearsAlerts
} from './animalAlerts';
import { frostTonightAlerts } from './frost';
import { lockWindowClosingAlerts } from './triggers';

const ORIGIN = 'https://app.cropcard.io';
const HOUR = 60 * 60 * 1000;
const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
const MONDAY = Date.parse('2026-09-28T14:00:00Z');
/** Not a Monday, so the weekly summary stays out of the field-alert tests. */
const THURSDAY = Date.parse('2026-10-01T15:00:00Z');

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'memory');
  vi.stubEnv('CROPCARD_LOCALES', 'en,es');
  vi.stubEnv('SMS_TRANSPORT', 'memory');
  clearOutbox();
  clearSmsOutbox();
});
afterEach(() => vi.unstubAllEnvs());

function seedOwner(name = 'Hilltop Farm') {
  const ownerId = `es-owner-${randomUUID()}`;
  db.insert(owners).values({ id: ownerId, name, slug: ownerId, billingStatus: 'active' }).run();
  return ownerId;
}

function seedUser(ownerId: string, locale: string | null, role: 'owner' | 'helper' = 'owner') {
  const userId = `es-user-${randomUUID()}`;
  const email = `${userId}@es.test`;
  db.insert(users).values({ id: userId, email, locale }).run();
  addAssignment({ ownerId, userId, roleWithinOwner: role });
  return { userId, email };
}

function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    priv: ecdh.getPrivateKey(),
    auth,
    endpoint: `https://push.example.net/send/${randomUUID()}`,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    authB64: auth.toString('base64url')
  };
}

function subscribe(ownerId: string, userId: string) {
  const b = browser();
  runWithTenant(ownerId, () =>
    upsertSubscription({
      userId,
      endpoint: b.endpoint,
      p256dh: b.p256dh,
      auth: b.authB64,
      prefs: { ...DEFAULT_PUSH_PREFS, 'weekly-digest': true }
    })
  );
  return b;
}

function payloads(
  fetchImpl: ReturnType<typeof vi.fn>,
  b: ReturnType<typeof browser>
): Array<{ title: string; body: string; kind: string }> {
  return fetchImpl.mock.calls
    .filter(([url]) => url === b.endpoint)
    .map(([, init]) =>
      JSON.parse(
        decryptPayload(
          Buffer.from((init as RequestInit).body as Uint8Array),
          b.priv,
          b.auth
        ).toString()
      )
    );
}

const mockFetch = () =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 201 })
  );

function dirtySprayer(ownerId: string, lastSprayedAt: number) {
  runWithTenant(ownerId, () => {
    const eqp = createEquipment({ type: 'sprayer', label: 'Tank A' });
    updateEquipmentState(eqp.id, {
      lastChemistryClass: 'insecticide-load',
      lastUsedAt: lastSprayedAt
    });
  });
}

describe('recipient language', () => {
  it('reads users.locale and ignores es when CROPCARD_LOCALES leaves it out', () => {
    const ownerId = seedOwner();
    const es = seedUser(ownerId, 'es');
    const none = seedUser(ownerId, null);
    expect(recipientLocale(es.userId)).toBe('es');
    expect(recipientLocale(none.userId)).toBe('en');
    vi.stubEnv('CROPCARD_LOCALES', '');
    expect(recipientLocale(es.userId)).toBe('en');
  });
});

describe('field alert in Spanish', () => {
  it('a Spanish user gets the push and email in Spanish, an English user in English', async () => {
    const ownerId = seedOwner();
    const es = seedUser(ownerId, 'es');
    const en = seedUser(ownerId, null, 'helper');
    const bEs = subscribe(ownerId, es.userId);
    const bEn = subscribe(ownerId, en.userId);
    runWithTenant(ownerId, () => optIn(es.userId, 'decon-due', { source: 'settings' }));
    const now = THURSDAY;
    dirtySprayer(ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();

    const s = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config, emailOrigin: ORIGIN, now: () => now, fetchImpl })
    );
    expect(s).toMatchObject({ alerts: 1, sent: 2, emailed: 1 });
    const [pEs] = payloads(fetchImpl, bEs);
    const [pEn] = payloads(fetchImpl, bEn);
    expect(pEs.title).toBe('Descontaminación pendiente · Tank A');
    expect(pEs.body).toBe(
      'Tank A todavía tiene restos de insecticide-load. Usa el asistente de descontaminación antes de la próxima carga.'
    );
    expect(pEn.title).toBe('Decon due · Tank A');
    expect(pEn.body).toBe(
      'Tank A still carries insecticide-load. Run the decon wizard before the next load.'
    );

    const [mail] = readOutbox(es.email);
    expect(mail.subject).toBe('Descontaminación pendiente · Tank A · Hilltop Farm');
    expect(mail.body).toContain('Tank A todavía tiene restos de insecticide-load.');
    expect(mail.body).toContain('Abrir en CropCard:');
    expect(mail.body).toContain('Cambiar qué alertas recibes:');
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.body).not.toContain('Open in CropCard');
  });

  it('sends English to a Spanish user when es is not switched on', async () => {
    vi.stubEnv('CROPCARD_LOCALES', '');
    const ownerId = seedOwner();
    const es = seedUser(ownerId, 'es');
    const b = subscribe(ownerId, es.userId);
    runWithTenant(ownerId, () => optIn(es.userId, 'decon-due', { source: 'settings' }));
    const now = THURSDAY;
    dirtySprayer(ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();
    await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config, emailOrigin: ORIGIN, now: () => now, fetchImpl })
    );
    expect(payloads(fetchImpl, b)[0].title).toBe('Decon due · Tank A');
    expect(readOutbox(es.email)[0].subject).toBe('Decon due · Tank A · Hilltop Farm');
  });

  it('lock-window and frost text translate without changing the facts', () => {
    const now = Date.now();
    const [lock] = lockWindowClosingAlerts(
      [
        {
          kind: 'insecticide',
          id: 'r1',
          occurredAt: now - 40 * HOUR,
          performedById: 'u1',
          blockName: 'Bed 3'
        }
      ],
      now,
      'es'
    );
    expect(lock.title).toBe('Insecticida: el registro se bloquea en 8 h');
    expect(lock.body).toContain('insecticida en Bed 3');

    const [frost] = frostTonightAlerts(
      [
        {
          productKey: 'p1',
          event: 'Hard Freeze Warning',
          onsetMs: now + HOUR,
          endsMs: now + 10 * HOUR,
          nwsHeadline: null,
          senderName: 'NWS Sterling VA'
        } as never
      ],
      [
        {
          status: 'active',
          plantingDate: null,
          name: 'Tomato',
          hardiness: 'tender',
          cover: 'covered',
          blockName: 'Bed 3'
        },
        { status: 'active', plantingDate: null, name: 'Pepper', hardiness: 'tender' }
      ],
      now,
      'es'
    );
    expect(frost.title).toBe('Hard Freeze Warning · protege los cultivos sensibles');
    expect(frost.body).toBe(
      'Tomato y Pepper están en riesgo. Cubre o cosecha antes de que llegue el frío. Revisa las cubiertas en Bed 3. ' +
        'Las cubiertas dan unos pocos grados. No detienen una congelación fuerte. (NWS, Sterling VA)'
    );
    expect(t('en', 'push.frost.hardFreeze')).toBe(HARD_FREEZE_NOTE);
  });
});

describe('animal alerts in Spanish', () => {
  it('hold cleared, care due and hold-covers-sale, single and batched', () => {
    const cleared = withdrawalClearsAlerts(
      [
        { subjectKey: 'animal:a1', food: 'eggs', clearedAt: 1 },
        { subjectKey: 'group:g1', food: 'milk', clearedAt: 1 }
      ],
      new Map([['animal:a1', 'Henrietta']]),
      'es'
    );
    expect(cleared[0].title).toBe('Retención terminada: Henrietta');
    expect(cleared[1].title).toBe('Retención terminada: Un animal');
    expect(batchMessage(cleared, 'es')).toEqual({
      title: '2 retenciones terminadas',
      body: 'Terminaron las retenciones de Henrietta; Un animal. Abre CropCard para revisar antes de usar.',
      url: '/animals'
    });

    const [care] = careDueAlerts(
      [
        {
          meta: {
            planId: 'p1',
            subjectType: 'animal',
            subjectId: 'a1',
            careKind: 'vaccination',
            dueOn: '2026-10-05',
            leadDays: 14
          } as never,
          scheduledOn: '2026-10-05',
          subjectName: 'Rex'
        }
      ],
      '2026-10-05',
      'es'
    );
    expect(care.title).toBe('Vacuna para hoy: Rex');
    expect(care.batchLabel).toBe('Vacuna: Rex');

    expect(holdCoversSaleText('Daisy', 2, 1, 'es')).toEqual({
      title: 'Revisa las ventas de Daisy y 1 más',
      body: '2 registros guardados de huevos, leche o carne ahora quedan dentro de una retención. Si se vendió alguno, avísale al comprador.'
    });
    expect(holdCoversSaleText('Daisy', 1, 0)).toEqual({
      title: 'Check sales from Daisy',
      body: '1 saved egg, milk or meat record is now inside a hold. If it was sold, tell the buyer.'
    });
  });
});

describe('Monday summary in Spanish', () => {
  it('push and email follow the recipient language', async () => {
    const ownerId = seedOwner();
    const es = seedUser(ownerId, 'es');
    const b = subscribe(ownerId, es.userId);
    runWithTenant(ownerId, () => optIn(es.userId, 'weekly-digest', { source: 'settings' }));
    runWithTenant(ownerId, () => {
      const task = createTask({
        title: 'Turn the compost',
        kind: 'primary',
        scheduledFor: Date.parse('2026-09-30T12:00:00Z')
      });
      return task.id;
    });
    const fetchImpl = mockFetch();
    await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, {
        config,
        emailOrigin: ORIGIN,
        now: () => MONDAY,
        fetchImpl,
        frostAlerts: async () => []
      })
    );
    const digestPush = payloads(fetchImpl, b).find((p) => p.kind === 'weekly-digest')!;
    expect(digestPush.title).toBe('Resumen del lunes');
    expect(digestPush.body).toBe('Tu semana: 1 tarea');

    const mail = readOutbox(es.email).find((m) => m.email.kind === 'weekly-digest')!;
    expect(mail.subject).toBe('Tu semana del lun 28 sep · Hilltop Farm');
    expect(mail.body).toContain('Semana del lun 28 sep · Hilltop Farm');
    expect(mail.body).toContain('Tareas esta semana: 1');
    expect(mail.body).toContain('mié 30 sep: Turn the compost');
    expect(mail.body).toContain('Dejar de recibir correos de "Resumen del lunes":');
  });
});

describe('sign-in messages in Spanish', () => {
  it('magic-link email follows the request locale', async () => {
    const email = `ml-${randomUUID()}@es.test`;
    await requestMagicLink({ email, ip: '198.51.100.7', origin: ORIGIN, locale: 'es' });
    const [mail] = readOutbox(email);
    expect(mail.subject).toMatch(/^Tu código para iniciar sesión en CropCard es \d{6}$/);
    expect(mail.body).toContain('Vence en quince minutos y funciona una sola vez:');
    expect(mail.body).toMatch(/@app\.cropcard\.io #\d{6}$/);
  });

  it('magic-link email stays English when es is off', async () => {
    vi.stubEnv('CROPCARD_LOCALES', '');
    const email = `ml-${randomUUID()}@es.test`;
    await requestMagicLink({ email, ip: '198.51.100.8', origin: ORIGIN, locale: 'es' });
    expect(readOutbox(email)[0].subject).toMatch(/^Your CropCard sign-in code is \d{6}$/);
  });

  it('SMS code text follows the request locale and keeps the autofill line', async () => {
    const phone = `+1571${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    await requestSmsLogin({
      phone,
      ip: { hash: `h-${randomUUID()}`, max: 100 },
      origin: ORIGIN,
      locale: 'es'
    });
    const [sms] = readSmsOutbox(phone);
    expect(sms.body).toMatch(
      /^Tu código para iniciar sesión en CropCard es (\d{6})\. Vence en diez minutos\. No lo compartas con nadie\.\n\n@app\.cropcard\.io #\1$/
    );
    expect(smsLoginBody('123456', 10 * 60_000, null)).toBe(
      "Your CropCard sign-in code is 123456. It expires in ten minutes. Don't share it with anyone."
    );
    expect(minutesInWords(60_000, 'es')).toBe('un minuto');
  });

  it('helper invite and test email can go out in Spanish', async () => {
    const to = `inv-${randomUUID()}@es.test`;
    await dispatchEmail({
      kind: 'helper-invite',
      to,
      ownerName: 'Hilltop Farm',
      acceptUrl: `${ORIGIN}/invite/abc`,
      expiresAt: Date.now() + 7 * 24 * HOUR,
      locale: 'es'
    });
    const [mail] = readOutbox(to);
    expect(mail.subject).toBe('Te invitaron a Hilltop Farm en CropCard');
    expect(mail.body).toContain('Hilltop Farm te invitó a su granja en CropCard.');
  });
});
