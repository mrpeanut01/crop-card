/**
 * Test-only harness for the Phase 33A document routes: seeded farms with
 * real users, a switchable signed-in user, request events and a ZIP reader.
 * Test files mock `$lib/server/auth` with `authOverrides()` and
 * `$lib/server/billing/plans` with `planOverrides()`.
 */

import { randomUUID } from 'node:crypto';
import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertSoilTest } from '$lib/db/fertility';

export type TestRole = 'owner' | 'helper' | 'inspector' | 'custom-operator';

export const authState = {
  ownerId: '',
  userId: '',
  role: 'owner' as TestRole,
  authVia: 'cookie' as 'cookie' | 'bearer',
  impersonating: false,
  capBytes: null as number | null
};

export function signedInUser() {
  if (!authState.userId) return null;
  return {
    id: authState.userId,
    email: `${authState.userId}@test.local`,
    phone: null,
    role: authState.role,
    activeOwnerId: authState.ownerId,
    isSuperadmin: false,
    impersonating: authState.impersonating
  };
}

export function authOverrides() {
  const requireUser = () => {
    const u = signedInUser();
    if (!u) throw error(401, 'authentication required');
    return u;
  };
  return {
    currentUser: signedInUser,
    requireUser,
    requireOwner: () => {
      const u = requireUser();
      if (u.role !== 'owner') throw error(403, 'owner role required');
      return u;
    },
    requireMutator: () => {
      const u = requireUser();
      if (u.role === 'inspector') throw error(403, 'inspector role is read-only');
      return u;
    }
  };
}

export function planOverrides(original: { storageCapBytes: (o: string, n?: number) => number }) {
  return {
    storageCapBytes: (ownerId: string, now?: number) =>
      authState.capBytes ?? original.storageCapBytes(ownerId, now)
  };
}

export interface TestFarm {
  ownerId: string;
  ownerUser: string;
  helperUser: string;
  inspectorUser: string;
  fieldId: string;
  blockId: string;
  soilTestId: string;
}

export function seedFarm(label = randomUUID().slice(0, 8)): TestFarm {
  const ownerId = `docs-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  const ids = {
    ownerUser: `u-own-${randomUUID()}`,
    helperUser: `u-help-${randomUUID()}`,
    inspectorUser: `u-insp-${randomUUID()}`
  };
  for (const [role, id] of [
    ['owner', ids.ownerUser],
    ['helper', ids.helperUser],
    ['inspector', ids.inspectorUser]
  ] as const) {
    db.insert(users)
      .values({ id, email: `${id}@test.local` })
      .run();
    db.insert(helperAssignments)
      .values({ ownerId, userId: id, roleWithinOwner: role, status: 'active' })
      .run();
  }
  const farm = runWithTenant(ownerId, () => {
    const field = createField({
      name: `${label} garden`,
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    const block = createBlock({
      name: `${label} bed`,
      fieldId: field.id,
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8
    });
    const soil = insertSoilTest({ blockId: block.id, sampledAt: Date.UTC(2026, 3, 1), ph: 6.2 });
    return { fieldId: field.id, blockId: block.id, soilTestId: soil.id };
  });
  return { ownerId, ...ids, ...farm };
}

/** Sign in as one of the farm's members. */
export function actAs(
  farm: TestFarm,
  role: TestRole,
  opts: { authVia?: 'cookie' | 'bearer'; impersonating?: boolean } = {}
): void {
  authState.ownerId = farm.ownerId;
  authState.role = role;
  authState.userId =
    role === 'owner' ? farm.ownerUser : role === 'inspector' ? farm.inspectorUser : farm.helperUser;
  authState.authVia = opts.authVia ?? 'cookie';
  authState.impersonating = opts.impersonating ?? false;
}

export interface EventInit {
  method?: string;
  path?: string;
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: Uint8Array | string | null;
  json?: unknown;
  /** Overrides the Content-Length header; null leaves it off. */
  contentLength?: number | null;
}

export function makeEvent(init: EventInit = {}): RequestEvent {
  const url = new URL(`http://localhost${init.path ?? '/api/documents'}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const method = init.method ?? 'GET';
  const headers = new Headers();
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set('content-type', 'application/json');
  } else if (init.body !== undefined && init.body !== null) {
    body = (
      typeof init.body === 'string' ? new TextEncoder().encode(init.body) : init.body
    ) as BodyInit;
    headers.set('content-type', 'application/octet-stream');
  }
  const len =
    init.contentLength === undefined
      ? body instanceof Uint8Array
        ? (body as Uint8Array).byteLength
        : typeof body === 'string'
          ? new TextEncoder().encode(body).byteLength
          : null
      : init.contentLength;
  if (len !== null) headers.set('content-length', String(len));
  const request = new Request(url, {
    method,
    headers,
    body,
    ...(body !== undefined ? { duplex: 'half' } : {})
  } as RequestInit);
  const user = signedInUser();
  return {
    request,
    url,
    params: init.params ?? {},
    locals: { user, authVia: authState.authVia },
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
}

type Handler = (event: RequestEvent) => Response | Promise<Response>;

/** Runs a handler in the signed-in Owner's tenant; thrown kit errors come
 *  back as responses, the way SvelteKit answers them. */
export async function call(handler: Handler, init: EventInit = {}): Promise<Response> {
  const event = makeEvent(init);
  try {
    return await runWithTenantAsync(authState.ownerId, async () => await handler(event));
  } catch (err) {
    if (isHttpError(err)) return Response.json(err.body, { status: err.status });
    throw err;
  }
}

export async function bytesOf(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

export function contains(hay: Uint8Array, needle: string): boolean {
  return Buffer.from(hay).includes(Buffer.from(needle));
}

/** Store-only ZIP reader (no ZIP64), enough for exports built in tests. */
export function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  if (dv.getUint32(eocd, true) !== 0x06054b50) throw new Error('no end record');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central record');
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = Buffer.from(buf.subarray(p + 46, p + 46 + nameLen)).toString('latin1');
    const lName = dv.getUint16(offset + 26, true);
    const lExtra = dv.getUint16(offset + 28, true);
    const start = offset + 30 + lName + lExtra;
    out.set(name, buf.subarray(start, start + size));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function uniquePdf(marker: string): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`
  );
}
