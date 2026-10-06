import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', () => ({
  requireUser: (event: { locals: { user: unknown } }) => event.locals.user
}));

import { personName } from '$lib/finance/people';
import {
  MONEY_NO_IMPERSONATION,
  MONEY_OWNER_ONLY,
  moneyNoImpersonationText,
  moneyOwnerOnlyText,
  requireMoneyReader,
  requireMoneyWriter
} from '$lib/finance/access';
import { enterpriseLabelFor } from '$lib/finance/profit.server';
import { cellCountRecommendation } from '$lib/planterPlate/match';
import { fetchBlockCovers, removeBlockCover } from '$lib/climate/protectionView';
import { UPDATING_MESSAGE, updatingMessage } from '$lib/updating';
import { fenceResponse } from '$lib/server/ops/fenceResponse';
import { DEFAULT_PREFS } from '$lib/prefs';
import { en } from './catalogs/en';
import type { RequestEvent } from '@sveltejs/kit';
import type { LedgerEntry } from '$lib/db/ledger';

const KEY_LIKE = new RegExp(
  `\\b(${[...new Set(Object.keys(en).map((k) => k.split('.')[0]))].join('|')})\\.[A-Za-z]`
);

function spanish(out: string, english: string): void {
  expect(out).not.toBe(english);
  expect(out).not.toMatch(KEY_LIKE);
}

describe('finance/people personName', () => {
  it('stays byte-identical English without a locale', () => {
    expect(personName({ email: null, phone: '+1 540 555 1234' })).toBe('phone ending 1234');
    expect(personName({ email: null, phone: null })).toBe('Someone on the farm');
  });
  it('reads Spanish with a locale and keeps names as typed', () => {
    spanish(personName({ email: null, phone: '5405551234' }, 'es'), 'phone ending 1234');
    expect(personName({ email: null, phone: '5405551234' }, 'es')).toContain('1234');
    spanish(personName({ email: null, phone: null }, 'es'), 'Someone on the farm');
    expect(personName({ email: 'maria@x.org', phone: null }, 'es')).toBe('maria');
  });
});

describe('finance/access refusals', () => {
  it('stays English without a locale', () => {
    expect(moneyOwnerOnlyText()).toBe(MONEY_OWNER_ONLY);
    expect(MONEY_OWNER_ONLY).toBe('Money is only shown to the farm owner.');
    expect(moneyNoImpersonationText()).toBe('Money cannot be changed while impersonating.');
    expect(MONEY_NO_IMPERSONATION).toBe('Money cannot be changed while impersonating.');
  });
  it('reads Spanish with a locale', () => {
    spanish(moneyOwnerOnlyText('es'), MONEY_OWNER_ONLY);
    spanish(moneyNoImpersonationText('es'), MONEY_NO_IMPERSONATION);
  });
  it('throws the refusal in the request language', () => {
    const ev = (role: string, locale: string, impersonating = false) =>
      ({ locals: { locale, user: { role, impersonating } } }) as unknown as RequestEvent;
    expect(() => requireMoneyReader(ev('helper', 'en'))).toThrow(
      expect.objectContaining({
        status: 403,
        body: expect.objectContaining({ message: MONEY_OWNER_ONLY })
      })
    );
    expect(() => requireMoneyReader(ev('helper', 'es'))).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ message: moneyOwnerOnlyText('es') })
      })
    );
    expect(() => requireMoneyWriter(ev('owner', 'es', true))).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ message: moneyNoImpersonationText('es') })
      })
    );
  });
});

describe('finance/profit.server enterpriseLabelFor', () => {
  const names = {
    plantingPlugin: {},
    plantingLabel: {},
    crop: {},
    group: {},
    animal: {},
    area: {},
    bed: {},
    blockField: new Map()
  };
  const lot = { kind: 'expense', stockLotId: 'lot1', occurredAt: 0 } as unknown as LedgerEntry;
  const loose = { kind: 'expense', stockLotId: null, occurredAt: 0 } as unknown as LedgerEntry;
  it('stays English without a locale', () => {
    expect(enterpriseLabelFor(lot, names)).toBe('Stock purchase (counted as used)');
    expect(enterpriseLabelFor(loose, names)).toBe('Not tied to anything');
  });
  it('reads Spanish with a locale', () => {
    spanish(enterpriseLabelFor(lot, names, {}, 'es'), 'Stock purchase (counted as used)');
    spanish(enterpriseLabelFor(loose, names, {}, 'es'), 'Not tied to anything');
  });
});

describe('planterPlate cellCountRecommendation', () => {
  it('stays byte-identical English without a locale', () => {
    expect(cellCountRecommendation(8, 30)?.note).toBe(
      '26,136 plants/ac is a typical/high stand — a 24-cell plate matches at standard sprockets.'
    );
    expect(cellCountRecommendation(10, 30)?.note).toBe(
      '20,909 plants/ac is a sparse stand — a 16-cell plate matches at standard sprockets.'
    );
    expect(cellCountRecommendation(9, 30, DEFAULT_PREFS)?.note).toBe(
      '23,232 plants/ac is between 22k–26k — either works, but 24-cell gives more downward sprocket headroom.'
    );
  });
  it('reads Spanish from the prefs locale', () => {
    const es = { ...DEFAULT_PREFS, locale: 'es' };
    for (const inRow of [8, 9, 10]) {
      const out = cellCountRecommendation(inRow, 30, es)!.note;
      spanish(out, cellCountRecommendation(inRow, 30)!.note);
      expect(out).not.toMatch(/—/);
    }
  });
});

describe('climate/protectionView error fallback', () => {
  const failing = (async () => new Response('', { status: 502 })) as unknown as typeof fetch;
  it('stays English without a locale', async () => {
    await expect(fetchBlockCovers('b1', 2026, failing)).rejects.toThrow(
      'Could not save (HTTP 502).'
    );
  });
  it('reads Spanish with a locale', async () => {
    const err = await removeBlockCover('b1', 'p1', failing, 'es').catch((e: Error) => e);
    spanish((err as Error).message, 'Could not save (HTTP 502).');
    expect((err as Error).message).toContain('502');
  });
  it('shows the server message as sent', async () => {
    const said = (async () =>
      new Response(JSON.stringify({ error: 'Solo el propietario' }), {
        status: 403
      })) as unknown as typeof fetch;
    await expect(fetchBlockCovers('b1', 2026, said, 'es')).rejects.toThrow('Solo el propietario');
  });
});

describe('updating fence message', () => {
  const post = (headers: Record<string, string> = {}) =>
    new Request('http://app.test/api/spray/record', { method: 'POST', headers });
  it('stays English without a locale', async () => {
    expect(updatingMessage()).toBe(UPDATING_MESSAGE);
    expect(updatingMessage('en')).toBe(UPDATING_MESSAGE);
    const res = fenceResponse(post(), true)!;
    expect(await res.json()).toEqual({ error: UPDATING_MESSAGE, code: 'SERVER_UPDATING' });
    const page = await fenceResponse(post({ accept: 'text/html' }), true)!.text();
    expect(page).toContain('<title>Updating</title>');
    expect(page).toContain('Go back');
  });
  it('reads Spanish with a locale, code unchanged', async () => {
    spanish(updatingMessage('es'), UPDATING_MESSAGE);
    const res = fenceResponse(post(), true, 'es')!;
    expect(await res.json()).toEqual({ error: updatingMessage('es'), code: 'SERVER_UPDATING' });
    const page = await fenceResponse(post({ accept: 'text/html' }), true, 'es')!.text();
    expect(page).not.toContain('Go back');
    expect(page).toContain(updatingMessage('es'));
  });
});
