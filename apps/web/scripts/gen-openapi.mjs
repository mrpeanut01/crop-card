#!/usr/bin/env node
/**
 * Regenerate apps/web/static/openapi.json from a hand-curated registry of
 * `/api/**` endpoints (Phase 24, Sub-task C / #57; Phase 30 endpoints added
 * in Sprint 30H).
 *
 * To add an endpoint:
 *   1. Move the route's request schema into a `$lib` module that imports
 *      nothing server-only, and have the route re-export it as
 *      `export const _requestSchema = ...` (SvelteKit only allows
 *      underscore-prefixed extra exports from `+server.ts`).
 *   2. Import that schema below and describe the path with `jsonBody()`, so
 *      the published contract is generated from the same Zod schema the
 *      handler validates with.
 *   Endpoints whose schema still lives inline in the route keep a
 *   hand-written body shape until they are promoted the same way.
 *
 * Runs under `tsx` with `scripts/tsconfig.openapi.json`, which maps `$lib`
 * without needing `svelte-kit sync` first.
 *
 * The generated artifact is served by `apps/web/src/routes/api/openapi.json/+server.ts`
 * and checked in so external agents can fetch it without a build step. CI
 * runs `pnpm gen:openapi && git diff --exit-code apps/web/static/openapi.json`
 * to catch drift between source intent and the served file.
 *
 * Usage:
 *   pnpm gen:openapi
 */

import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import {
  blockCreateSchema,
  blockPatchSchema,
  blockProtectionCreateSchema,
  fieldCreateSchema,
  fieldPatchSchema,
  mapFeatureCreateSchema,
  mapFeaturePatchSchema
} from '../src/lib/farm/apiSchemas.ts';
import { MAP_FEATURE_KINDS } from '../src/lib/farm/mapFeatures.ts';
import { AREA_KINDS, BLOCK_KINDS } from '../src/lib/farm/areaKinds.ts';
import {
  fillRequestSchema,
  plantingCreateSchema,
  recipeRequestSchema,
  successionRequestSchema
} from '../src/lib/garden/api.ts';
import { hintsPostSchema } from '../src/lib/hints.ts';
import { bedLayoutRequestSchema } from '../src/lib/plan/bedLayoutApi.ts';
import {
  journalEntrySchema,
  photoHelpSchema,
  queuedJournalSchema
} from '../src/lib/journal/apiSchemas.ts';
import { JOURNAL_KINDS, JOURNAL_PROVENANCE } from '../src/lib/journal/model.ts';
import { taskCloseSchema, taskCreateSchema, taskPatchSchema } from '../src/lib/tasks/apiSchemas.ts';
import {
  carePlanCreateSchema,
  carePlanPatchSchema
} from '../src/lib/animals/carePlanApiSchemas.ts';
import {
  fungicideRecordSchema,
  harvestRecordSchema,
  hayCuttingSchema,
  insecticideRecordSchema,
  scoutRecordSchema,
  sprayRecordSchema
} from '../src/lib/records/apiSchemas.ts';
import { cropPatchSchema } from '../src/lib/crops/apiSchemas.ts';
import { soilTestCreateSchema } from '../src/lib/fertility/apiSchemas.ts';
import {
  documentLinkCreateSchema,
  documentListQuerySchema,
  documentMetaSchema,
  documentUploadQuerySchema,
  soilTestDocumentPatchSchema
} from '../src/lib/documents/apiSchemas.ts';
import {
  animalCreateSchema,
  animalGroupCreateSchema,
  animalGroupPatchSchema,
  animalMoveSchema,
  animalPatchSchema,
  animalStatusSchema
} from '../src/lib/animals/apiSchemas.ts';
import {
  grazingAttestationSchema,
  healthRecordSchema,
  productionPatchSchema,
  productionRecordSchema,
  withdrawalEntrySchema
} from '../src/lib/animals/recordApiSchemas.ts';
import { holdVoidSchema } from '../src/lib/animals/holdVoidSchema.ts';
import { biofixPutSchema } from '../src/lib/ipm/apiSchemas.ts';
import { CARD_RECORD_KINDS } from '../src/lib/db/recordKinds.ts';
import { emergencyContactSchema } from '../src/lib/farm/emergencyContacts.ts';
import { CLIENT_RECORD_HEADER } from '../src/lib/clientRecordHeader.ts';
import { feedUseSchema } from '../src/lib/stock/apiSchemas.ts';
import {
  seedStartCreateSchema,
  seedStartPatchSchema,
  seedStartProgressSchema
} from '../src/lib/seedStart/apiSchemas.ts';
import {
  irrigationCreateSchema,
  rainGaugeCreateSchema,
  waterTargetSchema
} from '../src/lib/irrigation/apiSchemas.ts';
import {
  labourRateSchema,
  ledgerEntryCreateSchema,
  ledgerEntryPatchSchema
} from '../src/lib/finance/apiSchemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(APP_ROOT, 'static/openapi.json');

mkdirSync(dirname(OUT_PATH), { recursive: true });

// ─── Reusable component schemas ─────────────────────────────────────────

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', description: 'Human-readable error message.' }
  }
};

const TOKEN_SUMMARY_SCHEMA = {
  type: 'object',
  required: [
    'id',
    'ownerId',
    'userId',
    'label',
    'isServiceAccount',
    'dailyQuota',
    'createdAt',
    'requestCount'
  ],
  properties: {
    id: { type: 'string' },
    ownerId: { type: 'string' },
    userId: { type: 'string' },
    label: { type: 'string', maxLength: 64 },
    isServiceAccount: { type: 'boolean' },
    dailyQuota: {
      type: 'object',
      properties: {
        allocate: { type: ['integer', 'null'] },
        schedule: { type: ['integer', 'null'] },
        inputs: { type: ['integer', 'null'] },
        stockRefresh: { type: ['integer', 'null'] }
      }
    },
    createdAt: { type: 'integer', description: 'Unix epoch ms.' },
    lastUsedAt: { type: ['integer', 'null'], description: 'Unix epoch ms; debounced 1/minute.' },
    requestCount: { type: 'integer' },
    revokedAt: { type: ['integer', 'null'] }
  }
};

function fromZod(schema) {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any'
  });
  return json;
}

function jsonBody(schema, description) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: description ? { ...fromZod(schema), description } : fromZod(schema)
      }
    }
  };
}

const errorRef = { $ref: '#/components/schemas/Error' };

function errorResponse(description) {
  return { description, content: { 'application/json': { schema: errorRef } } };
}

function jsonResponse(description, schema) {
  return { description, content: { 'application/json': { schema } } };
}

const AUTH_ERRORS = {
  401: errorResponse('Authentication required.'),
  403: errorResponse('Cross-origin blocked, or read-only role.')
};

const OWNER_ERRORS = {
  401: errorResponse('Authentication required.'),
  403: errorResponse('Owner role required. Helpers can read but not change this.')
};

const GARDEN_ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
    code: {
      type: 'string',
      enum: [
        'OFFLINE',
        'READ_ONLY',
        'OUTSIDE_AREA',
        'OVERLAP',
        'NOT_DESIGNABLE',
        'IN_GROUND',
        'BED_HAS_RECORDS',
        'FOREIGN_REF',
        'STALE'
      ]
    },
    issues: {}
  }
};

const gardenErrorRef = { $ref: '#/components/schemas/GardenError' };

const GARDEN_ERRORS = {
  400: jsonResponse('Invalid request body.', gardenErrorRef),
  ...OWNER_ERRORS,
  404: jsonResponse('Bed not found for the active Owner.', gardenErrorRef),
  409: jsonResponse(
    'The layout does not fit: `OVERLAP`, `OUTSIDE_AREA` or `NOT_DESIGNABLE`.',
    gardenErrorRef
  )
};

const PLACED_PLANTING_SCHEMA = {
  type: 'object',
  description:
    'A planting placed in a bed. `plantCountProvenance` and `sourceProvenance` say where a value came from; a hand-placed planting has no `sourceProvenance`.',
  required: ['cropId', 'blockId', 'cropPluginId', 'varietyDisplayName', 'status'],
  properties: {
    cropId: { type: 'string' },
    blockId: { type: 'string' },
    cropPluginId: { type: 'string' },
    varietyDisplayName: { type: 'string' },
    cropFamily: { type: 'string' },
    status: { type: 'string' },
    plantingDateMs: { type: ['integer', 'null'] },
    harvestedAtMs: { type: ['integer', 'null'] },
    footprint: { type: ['object', 'null'] },
    spacing: { type: 'object' },
    plantCount: { type: ['integer', 'null'] },
    plantCountProvenance: { type: ['string', 'null'] },
    groupId: { type: ['string', 'null'] },
    groupSystemKind: {
      type: ['string', 'null'],
      enum: ['three-sisters', 'succession', 'manual', null]
    },
    groupRole: { type: ['string', 'null'], enum: ['anchor', 'companion', null] },
    sourceProvenance: { type: ['string', 'null'], enum: ['ai', 'fallback', 'plugin', null] }
  }
};

const placedRef = { $ref: '#/components/schemas/PlacedPlanting' };

const clientRecordRef = { $ref: '#/components/parameters/ClientRecordId' };

const CLIENT_RECORD_PARAMETER = {
  name: CLIENT_RECORD_HEADER,
  in: 'header',
  required: false,
  description:
    'Offline-queue row id (8 to 80 of `A-Z a-z 0-9 _ -`). A replay of an id the active Owner already saved answers 200 `{ ok: true, duplicate: true }` and writes nothing, so a record is saved at most once. Omit it for a plain request; an id that does not match the pattern is ignored.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,80}$', example: 'q_01J9Z6X4K2M8' }
};

const DUPLICATE_SCHEMA = {
  type: 'object',
  description:
    'Either the saved record, or `{ ok: true, duplicate: true }` when the client record id was already saved and nothing new was written.',
  properties: {
    ok: { const: true },
    duplicate: { type: 'boolean' }
  }
};

function recordEndpoint({ summary, description, schema, created = false }) {
  const saved = created
    ? {
        200: jsonResponse('A replay of a client record id that was already saved.', {
          type: 'object',
          required: ['ok', 'duplicate'],
          properties: { ok: { const: true }, duplicate: { const: true } }
        }),
        201: jsonResponse('Record saved.', { type: 'object' })
      }
    : { 200: jsonResponse('Record saved, or a replay that was already saved.', DUPLICATE_SCHEMA) };
  return {
    post: {
      summary,
      description,
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(schema),
      responses: {
        ...saved,
        400: errorResponse('Invalid body.'),
        ...AUTH_ERRORS,
        404: errorResponse('Unknown block, crop, product or sprayer for the active Owner.'),
        422: errorResponse('A safety check or the season close-out gate rejected the record.'),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  };
}

const JOURNAL_ENTRY_SCHEMA = {
  type: 'object',
  required: ['id', 'cropId', 'blockId', 'createdAt', 'kind', 'text', 'hasPhoto', 'provenance'],
  properties: {
    id: { type: 'string' },
    cropId: { type: 'string' },
    blockId: { type: 'string' },
    createdAt: { type: 'integer', description: 'Unix epoch ms.' },
    createdBy: { type: ['string', 'null'] },
    kind: { type: 'string', enum: [...JOURNAL_KINDS] },
    text: { type: 'string' },
    hasPhoto: { type: 'boolean' },
    answer: { type: ['object', 'null'] },
    provenance: { type: 'string', enum: [...JOURNAL_PROVENANCE] }
  }
};

const journalEntryRef = { $ref: '#/components/schemas/JournalEntry' };

const journalWriteResponses = {
  200: jsonResponse('A replay of a client record id that was already saved.', {
    type: 'object',
    required: ['ok', 'duplicate'],
    properties: { ok: { const: true }, duplicate: { const: true } }
  }),
  201: jsonResponse('Saved.', {
    type: 'object',
    required: ['entry'],
    properties: { entry: journalEntryRef }
  }),
  400: errorResponse('Invalid body, or a photo that is too large or not a JPEG.'),
  401: errorResponse('Authentication required.'),
  403: errorResponse('Inspector role is read-only.'),
  404: errorResponse('Planting not found for the active Owner.'),
  503: errorResponse(
    'The same client record id is being saved by another request right now. Retry shortly.'
  )
};

const kindQuery = (kinds, example) => ({
  name: 'kind',
  in: 'query',
  required: false,
  description: `Comma-separated kinds to include (${kinds.map((k) => `\`${k}\``).join(', ')}). An unknown kind returns 400.`,
  schema: { type: 'string', example }
});

const idPath = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' }
});

/** C-35 §5: the owner void of a fresh mistake, the one way a hold can
 *  shorten. Same contract on every record kind that has one. */
function voidEndpoint(summary, what) {
  return {
    parameters: [idPath('id', `${what} id.`)],
    post: {
      summary,
      description:
        'Interactive owner only: a cookie session with the owner role that is not impersonating. API tokens, helpers and impersonating superadmins get 403 `OWNER_ONLY`. Only within 48 hours of when the entry was saved (`VOID_TOO_LATE` after that, and for entries saved before holds were snapshotted). The first call answers 409 `HOLD_WOULD_SHORTEN` with the holds that would shorten and a `diffHash`; resubmit with `confirmShorten` set to it. A changed diff answers 409 `HOLD_DIFF_STALE`. A hold from a prohibited drug, an unknown label or with no end is never shortened (403 `HOLD_NOT_VOIDABLE`). An accepted void leaves a tombstone and a `hold_corrections` audit row.',
      security: [{ cookieSession: [] }],
      requestBody: jsonBody(holdVoidSchema),
      responses: {
        200: jsonResponse('Voided.', {
          type: 'object',
          required: ['voided', 'kind'],
          properties: { voided: { type: 'string' }, kind: { type: 'string' } }
        }),
        400: errorResponse('Invalid body: a reason is required.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('`OWNER_ONLY` or `HOLD_NOT_VOIDABLE`.'),
        404: errorResponse('Record not found for the active Owner.'),
        409: errorResponse(
          '`HOLD_WOULD_SHORTEN` (with `holds`, `coverage` and `diffHash`), `HOLD_DIFF_STALE` or `VOID_TOO_LATE`.'
        )
      }
    }
  };
}

// ─── Path registry ──────────────────────────────────────────────────────

const paths = {
  '/api/health': {
    get: {
      summary: 'Liveness probe',
      description:
        'Public; no auth required. Returns the running safety-kernel rules version + uptime.',
      security: [],
      responses: {
        200: {
          description: 'Service is up.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status', 'rulesVersion', 'uptime'],
                properties: {
                  status: { type: 'string', enum: ['ok'] },
                  rulesVersion: { type: 'string', example: '0.4.0-safety-kernel' },
                  uptime: { type: 'number', description: 'Process uptime in seconds.' }
                }
              }
            }
          }
        }
      }
    }
  },

  '/api/openapi.json': {
    get: {
      summary: 'This document',
      description:
        'Public; no auth required. Returns the OpenAPI 3.1 description of the agent-facing surface.',
      security: [],
      responses: {
        200: {
          description: 'OpenAPI 3.1 document.',
          content: { 'application/json': { schema: { type: 'object' } } }
        }
      }
    }
  },

  '/api/auth/token': {
    post: {
      summary: 'Mint a new owner-scoped Bearer token',
      description:
        'Cookie-session ONLY (a Bearer token cannot mint another Bearer — closes the bootstrap loop on a leaked credential). Plaintext is returned **once** in the response; the DB only sees sha256(plaintext).',
      security: [{ cookieSession: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['label'],
              properties: {
                label: { type: 'string', maxLength: 64, example: 'scouting-drone-1' },
                isServiceAccount: {
                  type: 'boolean',
                  default: false,
                  description:
                    'When true, AI rate-limit keys on (tokenId, endpoint) instead of (userId, endpoint) — protects the human owner from a runaway agent.'
                }
              }
            }
          }
        }
      },
      responses: {
        201: {
          description: 'Token minted. Plaintext returned ONCE.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'token', 'label', 'isServiceAccount', 'createdAt'],
                properties: {
                  id: { type: 'string' },
                  token: {
                    type: 'string',
                    description: 'Bearer token. Format: `cck_<base64url-32-bytes>`.',
                    pattern: '^cck_[A-Za-z0-9_-]+$'
                  },
                  label: { type: 'string' },
                  isServiceAccount: { type: 'boolean' },
                  createdAt: { type: 'integer' }
                }
              }
            }
          }
        },
        400: {
          description: 'Invalid label.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        403: {
          description: 'Bearer-authed sessions cannot mint.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        }
      }
    },
    get: {
      summary: "List the active Owner's tokens",
      description: 'Never returns plaintext (the DB does not have it). Owner role required.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: {
          description: 'Token list.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tokens'],
                properties: {
                  tokens: { type: 'array', items: { $ref: '#/components/schemas/TokenSummary' } }
                }
              }
            }
          }
        }
      }
    }
  },

  '/api/auth/token/{id}': {
    delete: {
      summary: 'Revoke a Bearer token',
      description:
        "Composite (owner_id, id) gate — an Owner cannot revoke another Owner's token. Immediate: next Bearer request → 401.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Revoked.',
          content: {
            'application/json': { schema: { type: 'object', properties: { ok: { const: true } } } }
          }
        },
        404: {
          description: 'Token not found.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        }
      }
    }
  },

  '/api/spray/record': recordEndpoint({
    summary: 'Record a spray event (safety-kernel re-validated)',
    description:
      'Every POST re-runs `evaluateSpray()` on the server regardless of UI. A Bearer-authed agent cannot bypass the safety kernel, the 48h spray lock, the helper custom-rate restriction, or tenant isolation. Returns 422 with kernel violations on safety failure.',
    schema: sprayRecordSchema
  }),

  '/api/insecticide/record': recordEndpoint({
    summary: 'Record an insecticide application',
    description:
      'Runs the IPM threshold, pollinator-protection, cross-contamination and environment gates on the server before saving. Safe to replay from the offline queue with the client record id header.',
    schema: insecticideRecordSchema
  }),

  '/api/fungicide/record': recordEndpoint({
    summary: 'Record a fungicide application',
    description:
      'Runs the FRAC rotation, tank-mix, bloom and cross-contamination gates on the server before saving. Safe to replay from the offline queue with the client record id header.',
    schema: fungicideRecordSchema
  }),

  '/api/harvest/record': recordEndpoint({
    summary: 'Record a harvest',
    description:
      'Checks stored moisture against the crop archetype and the pre-harvest interval of recent sprays. Safe to replay from the offline queue with the client record id header.',
    schema: harvestRecordSchema
  }),

  '/api/scout/record': recordEndpoint({
    summary: 'Record a scouting observation',
    description:
      'Saves one observation against a block (and optionally a planting). Safe to replay from the offline queue with the client record id header.',
    schema: scoutRecordSchema,
    created: true
  }),

  '/api/hay/cuttings': recordEndpoint({
    summary: 'Record a hay cutting',
    description:
      'Re-runs the mow decision against the forecast before saving; a bale moisture danger stop cannot be overridden. Safe to replay from the offline queue with the client record id header.',
    schema: hayCuttingSchema,
    created: true
  }),

  '/api/fields': {
    get: {
      summary: 'List Areas for the active Owner',
      description:
        'Areas (stored as fields) with their block counts and acres. Tenant-scoped; helpers can read.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [kindQuery(AREA_KINDS, 'garden,greenhouse')],
      responses: {
        200: jsonResponse('Area list.', {
          type: 'object',
          required: ['fields'],
          properties: { fields: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse('Unknown kind.')
      }
    },
    post: {
      summary: 'Create an Area',
      description:
        'Owner only. `details` is checked against the schema for `kind` (garden watering, greenhouse structure, orchard spacing and so on) and rejected with 400 when it does not fit.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(fieldCreateSchema),
      responses: {
        201: jsonResponse('Area created.', {
          type: 'object',
          required: ['field'],
          properties: { field: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, or `details` that do not fit the kind.'),
        ...OWNER_ERRORS
      }
    }
  },

  '/api/fields/{id}': {
    parameters: [idPath('id', 'Area id.')],
    get: {
      summary: 'Fetch one Area',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The Area.', {
          type: 'object',
          required: ['field'],
          properties: { field: { type: 'object' } }
        }),
        404: errorResponse('Area not found for the active Owner.')
      }
    },
    patch: {
      summary: 'Edit an Area',
      description:
        'Owner only. Null clears a value. Reshaping a garden or greenhouse that would leave a bed outside its edge answers 409 `OUTSIDE_AREA`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(fieldPatchSchema),
      responses: {
        200: jsonResponse('Area saved.', {
          type: 'object',
          required: ['field'],
          properties: { field: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, or `details` that do not fit the kind.'),
        ...OWNER_ERRORS,
        404: errorResponse('Area not found for the active Owner.'),
        409: jsonResponse('A bed would end up outside the Area.', gardenErrorRef)
      }
    },
    delete: {
      summary: 'Delete an Area and everything in it',
      description: 'Owner only. Cascades through every block, planting and event in the Area.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Deleted; the body counts what was removed.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Area not found for the active Owner.')
      }
    }
  },

  '/api/blocks': {
    get: {
      summary: 'List blocks for the active Owner',
      description:
        'Tenant-scoped via `runWithTenantAsync(activeOwnerId, …)`. Bearer tokens see only the Owner they were minted under.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [kindQuery(BLOCK_KINDS, 'bed,container')],
      responses: {
        200: jsonResponse('Block list.', {
          type: 'object',
          properties: {
            blocks: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse('Unknown kind.')
      }
    },
    post: {
      summary: 'Create a block, bed, row or container',
      description:
        'Owner only. Designer layout fields (`xFt`, `yFt`, `rotationDeg`, `bedStyle`) are in feet from the Area corner and only apply to beds and containers in a garden or greenhouse. A bed that overlaps another or leaves the Area answers 409 `OVERLAP` or `OUTSIDE_AREA`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(blockCreateSchema),
      responses: {
        201: jsonResponse('Block created.', {
          type: 'object',
          required: ['block'],
          properties: { block: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, or a kind that cannot sit in that Area.'),
        ...OWNER_ERRORS,
        409: jsonResponse('The bed does not fit.', gardenErrorRef)
      }
    }
  },

  '/api/blocks/{id}': {
    parameters: [idPath('id', 'Block id.')],
    get: {
      summary: 'Fetch one block with its plantings',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The block.', {
          type: 'object',
          required: ['block'],
          properties: { block: { type: 'object' } }
        }),
        404: errorResponse('Block not found for the active Owner.')
      }
    },
    patch: {
      summary: 'Move, resize, rotate or rename a block',
      description:
        'Owner only. Null clears a value. Shrinking a bed past a planting answers 409; finished plantings are clamped to the new size.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(blockPatchSchema),
      responses: {
        200: jsonResponse('Block saved.', {
          type: 'object',
          required: ['block'],
          properties: { block: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, an unknown `fieldId`, or a kind that cannot sit there.'),
        ...OWNER_ERRORS,
        404: errorResponse('Block not found for the active Owner.'),
        409: jsonResponse('The new layout does not fit.', gardenErrorRef)
      }
    },
    delete: {
      summary: 'Delete a block',
      description:
        'Owner only. Cascades through its plantings and events. With `?ifEmpty=1` (the garden designer) a block holding anything but planned plantings is kept and the answer is 409 `BED_HAS_RECORDS`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'ifEmpty',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['1'] }
        }
      ],
      responses: {
        200: jsonResponse('Deleted; the body counts what was removed.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Block not found for the active Owner.'),
        409: jsonResponse('The block has records.', gardenErrorRef)
      }
    }
  },

  '/api/blocks/{id}/protections': {
    parameters: [idPath('id', 'Block (bed) id.')],
    get: {
      summary: "List a bed's covers and its effective frost",
      description:
        'Phase 32E season extension. Any member. Returns the covers on the bed and its frost dates for the planning year (`?year=` to pick another) after covers: the largest single shift per side wins, shifts never add, a heated greenhouse is frost-free. Covers move planning windows only.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [{ name: 'year', in: 'query', required: false, schema: { type: 'integer' } }],
      responses: {
        200: jsonResponse('Covers and effective frost.', {
          type: 'object',
          required: ['protections', 'seasonYear', 'effectiveFrost', 'frost'],
          properties: {
            protections: { type: 'array', items: { type: 'object' } },
            seasonYear: { type: 'integer' },
            effectiveFrost: { type: 'object' },
            frost: { type: 'object' }
          }
        }),
        404: errorResponse('Block not found for the active Owner.')
      }
    },
    post: {
      summary: 'Add a cover to a bed',
      description:
        "Owner only. Omitted shifts take the kind's sourced default (`data`), or stay unknown when no source is on file; typed shifts are `manual`. Shifts are whole days, 0 to 120. Dates are epoch ms. Never gated by a closed season.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(blockProtectionCreateSchema),
      responses: {
        201: jsonResponse('Cover saved; the body is the refreshed list and frost.', {
          type: 'object',
          required: ['protection', 'protections', 'frost'],
          properties: {
            protection: { type: 'object' },
            protections: { type: 'array', items: { type: 'object' } },
            frost: { type: 'object' }
          }
        }),
        400: errorResponse('Invalid body.'),
        ...OWNER_ERRORS,
        404: errorResponse('Block not found for the active Owner.')
      }
    }
  },

  '/api/blocks/{id}/protections/{pid}': {
    parameters: [idPath('id', 'Block (bed) id.'), idPath('pid', 'Cover id.')],
    delete: {
      summary: 'Remove a cover',
      description: 'Owner only. A hard delete: a cover is planning data, not a record.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Removed.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Block or cover not found for the active Owner.')
      }
    }
  },

  '/api/map-features': {
    get: {
      summary: 'List map lines and points',
      description:
        'Fences, gates, water sources, hydrants, irrigation lines and paths for the active Owner. Tenant-scoped; helpers can read. `?fieldId=` keeps the features linked to one Area.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        kindQuery(MAP_FEATURE_KINDS, 'fence,gate'),
        { name: 'fieldId', in: 'query', required: false, schema: { type: 'string' } }
      ],
      responses: {
        200: jsonResponse('Map features.', {
          type: 'object',
          required: ['mapFeatures'],
          properties: { mapFeatures: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse('Unknown kind.')
      }
    },
    post: {
      summary: 'Add a map line or point',
      description:
        "Owner only. `geometry` is a GeoJSON LineString for fence, irrigation line and path, and a Point for gate, water source and hydrant. `details` only applies to a water source: `{ source?: well | municipal | pond | rain, flowRateGpm?: number }`. `fieldId` links the feature to one of the Owner's Areas.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(mapFeatureCreateSchema),
      responses: {
        201: jsonResponse('Feature saved.', {
          type: 'object',
          required: ['mapFeature'],
          properties: { mapFeature: { type: 'object' } }
        }),
        400: errorResponse(
          "Invalid body, a geometry that does not fit the kind, details on the wrong kind, or another Owner's Area."
        ),
        ...OWNER_ERRORS
      }
    }
  },

  '/api/map-features/{id}': {
    parameters: [idPath('id', 'Map feature id.')],
    get: {
      summary: 'Fetch one map line or point',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The feature.', {
          type: 'object',
          required: ['mapFeature'],
          properties: { mapFeature: { type: 'object' } }
        }),
        404: errorResponse('Feature not found for the active Owner.')
      }
    },
    patch: {
      summary: 'Edit a map line or point',
      description:
        'Owner only. The kind cannot change. Null `fieldId` unlinks the feature from its Area.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(mapFeaturePatchSchema),
      responses: {
        200: jsonResponse('Feature saved.', {
          type: 'object',
          required: ['mapFeature'],
          properties: { mapFeature: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, or a geometry or details that do not fit the kind.'),
        ...OWNER_ERRORS,
        404: errorResponse('Feature not found for the active Owner.')
      }
    },
    delete: {
      summary: 'Remove a map line or point',
      description: 'Owner only.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Removed.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Feature not found for the active Owner.')
      }
    }
  },

  '/api/animals': {
    get: {
      summary: 'List animals',
      description:
        'Individual animals of the active Owner. `status` is `active` (default), `gone` (sold, died, culled or rehomed), `archived` or `all`. `groupId`, `fieldId` (where they live now), `speciesId` and `ungrouped=1|0` narrow the list. Helpers can read.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['active', 'gone', 'archived', 'all'] }
        },
        { name: 'groupId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'fieldId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'speciesId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'ungrouped',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['1', '0'] }
        }
      ],
      responses: {
        200: jsonResponse('Animals.', {
          type: 'object',
          required: ['animals'],
          properties: { animals: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse('Unknown status.')
      }
    },
    post: {
      summary: 'Add an animal',
      description:
        'Owner only. Needs a name or a tag. The food-producing flag comes from the species plugin and is changed later with `PATCH /api/animals/{id}`. An animal in a group lives where its group lives; otherwise `housingFieldId` writes its first stay. A tag already in use comes back as a `TAG_IN_USE` warning, never a refusal.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(animalCreateSchema),
      responses: {
        201: jsonResponse('Animal added.', {
          type: 'object',
          required: ['animal', 'warnings'],
          properties: {
            animal: { type: 'object' },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse(
          "Invalid body, an unknown species, another Owner's Area or group, or an Area animals cannot live on (`NOT_A_HOUSING_AREA`)."
        ),
        ...OWNER_ERRORS,
        409: errorResponse('The group is archived or holds another species (`SPECIES_MISMATCH`).')
      }
    }
  },

  '/api/animals/{id}': {
    parameters: [idPath('id', 'Animal id.')],
    get: {
      summary: 'One animal with its history',
      description:
        'The animal, its group, its stays, its status changes (with lock state) and its flag changes.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The animal.', { type: 'object', required: ['animal'] }),
        404: errorResponse('Animal not found for the active Owner.')
      }
    },
    patch: {
      summary: 'Edit an animal',
      description:
        'Owner only, except that a helper may set `photo` (a JPEG data URL under 300 KB; metadata is stripped). Changing `foodProducing` or `notForSlaughter` needs `flagReason` and writes an audit row in the same save; `notForSlaughter` exists only for species that offer it and never changes `foodProducing`. `status` archives or restores. An animal that is no longer here only takes `notes` and `photo` (`READ_ONLY`).',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(animalPatchSchema),
      responses: {
        200: jsonResponse('Saved.', {
          type: 'object',
          required: ['animal', 'flagChanges', 'warnings'],
          properties: {
            animal: { type: 'object' },
            flagChanges: { type: 'array', items: { type: 'object' } },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse(
          'Invalid body, no name or tag left, a bad photo, or a toggle the species does not offer.'
        ),
        ...OWNER_ERRORS,
        404: errorResponse('Animal not found for the active Owner.'),
        409: errorResponse(
          'The animal is no longer here, or the change needs `POST /api/animals/status`.'
        )
      }
    },
    delete: {
      summary: 'Delete a mistaken animal',
      description:
        'Owner only. Deletes an animal with no records along with the stay written when it was added. Anything with a record answers `ANIMAL_HAS_RECORDS`; archive it instead. `?ifEmpty=1` is accepted and behaves the same.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        { name: 'ifEmpty', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } }
      ],
      responses: {
        200: jsonResponse('Deleted.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Animal not found for the active Owner.'),
        409: errorResponse('The animal has records (`ANIMAL_HAS_RECORDS`).')
      }
    }
  },

  '/api/animals/{id}/photo': {
    parameters: [idPath('id', 'Animal id.')],
    get: {
      summary: "An animal's photo",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: {
          description: 'The photo.',
          content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } }
        },
        401: errorResponse('Authentication required.'),
        404: { description: 'No photo for this animal of the active Owner.' }
      }
    }
  },

  '/api/animals/move': {
    post: {
      summary: 'Move animals',
      description:
        'Owners and helpers. Moves a group or an individual to an Area (`fieldId`), part of a group into a new group (`count` unnamed animals and/or named `animalIds`), or an individual into a group (`toGroupId`; it then lives where the group lives, and one moved to an Area leaves its group). `movedAt` may be backdated; moves arriving out of order are slotted into a non-overlapping timeline. Natural areas, water and boundaries cannot house animals. A coop over its capacity is reported in `capacity`, never refused. Safe to replay from the offline queue with the client record id header. A move queued offline sends `queuedLive: true` and is judged as live at `movedAt`, so a grazing hold answers 422 instead of saving it as a move that already happened.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(animalMoveSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Moved.', {
          type: 'object',
          required: ['move'],
          properties: { move: { type: 'object' } }
        }),
        400: errorResponse(
          "Invalid body, a subject that is not on this farm (`UNKNOWN_SUBJECT`), another Owner's Area or group, an Area animals cannot live on, or a time in the future."
        ),
        ...AUTH_ERRORS,
        409: errorResponse(
          'The subject is archived or gone, already there, a count larger than the group, another move at the same moment (`SAME_TIME`), or a group change before a later move (`OUT_OF_ORDER`).'
        ),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/animals/locations/{id}': {
    parameters: [idPath('id', 'Stay (animal location) id.')],
    delete: {
      summary: 'Undo the latest move',
      description:
        "Owner only. Removes a subject's latest stay and reopens the one before it. Stays that changed a group are not undone here; move the animal again instead. Helpers correct a move by moving the animals back.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Undone.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Stay not found for the active Owner.'),
        409: errorResponse(
          'Not the latest stay (`NOT_LATEST`), or it changed a group (`GROUP_CHANGE`).'
        )
      }
    }
  },

  '/api/animals/locations/{id}/void': voidEndpoint(
    'Void a move entered by mistake',
    'Stay (animal location)'
  ),
  '/api/animals/health/{id}/void': voidEndpoint(
    'Void a health record entered by mistake',
    'Health event'
  ),
  '/api/spray/records/{id}/void': voidEndpoint(
    'Void a herbicide spray entered by mistake',
    'Spray record'
  ),
  '/api/insecticide/{id}/void': voidEndpoint(
    'Void an insecticide application entered by mistake',
    'Insecticide record'
  ),
  '/api/fungicide/{id}/void': voidEndpoint(
    'Void a fungicide application entered by mistake',
    'Fungicide record'
  ),
  '/api/animals/production/{id}/void': voidEndpoint(
    'Void an eggs, milk or weight log entered by mistake',
    'Production log'
  ),
  '/api/animals/status/{id}/void': voidEndpoint(
    'Void a status change entered by mistake (latest change only)',
    'Status change'
  ),
  '/api/hay/cuttings/{id}/void': voidEndpoint(
    'Void a hay cutting entered by mistake',
    'Hay cutting'
  ),

  '/api/animals/{id}/care-plans': {
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        description: 'An animal id or a group id.',
        schema: { type: 'string' }
      }
    ],
    get: {
      summary: 'List care plans of an animal or group',
      description:
        'Everyone on the farm can read. A plan repeats every `intervalDays` or happens once on `onceOn`; `nextDueOn` is null while the plan waits for a date ("ask your vet"). `provenance` is `plugin` for a species suggestion and `manual` once the owner changed it.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The plans.', {
          type: 'object',
          required: ['plans'],
          properties: { plans: { type: 'array', items: { type: 'object' } } }
        }),
        401: errorResponse('Authentication required.'),
        404: errorResponse('No animal or group with that id on the active farm.')
      }
    },
    post: {
      summary: 'Add a care plan',
      description:
        'Owner only. The next due day is `nextDueOn`, or `lastDoneOn` plus `intervalDays`, or `onceOn`; with none of them the plan is saved undated and never shows on /today. `leadDays` (how many days ahead the task shows and the first reminder goes out) defaults to 14 for a vaccine and 3 for anything else. Care tasks are written into `tasks` (category `animal-care`, id `tk_care_<planId>_<yyyymmdd>`) by /today and the push tick. Not gated by the season close-out.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(carePlanCreateSchema),
      responses: {
        201: jsonResponse('Added.', {
          type: 'object',
          required: ['plan'],
          properties: { plan: { type: 'object' } }
        }),
        400: errorResponse('Invalid body.'),
        ...OWNER_ERRORS,
        404: errorResponse('No animal or group with that id on the active farm.'),
        409: errorResponse('The animal or group is no longer here (`NOT_ACTIVE`).')
      }
    }
  },

  '/api/animals/{id}/care-plans/{planId}': {
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        description: 'An animal id or a group id.',
        schema: { type: 'string' }
      },
      { name: 'planId', in: 'path', required: true, schema: { type: 'string' } }
    ],
    patch: {
      summary: 'Change a care plan',
      description:
        'Owner only. Open tasks of the plan are aborted with reason `plan-edited` and written again from the edited plan; `active: false` ends them with `plan-ended`. A `lastDoneOn` needs an interval (`NO_INTERVAL`). The plan becomes `manual`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(carePlanPatchSchema),
      responses: {
        200: jsonResponse('Saved.', {
          type: 'object',
          required: ['plan'],
          properties: { plan: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, or a last date with no interval (`NO_INTERVAL`).'),
        ...OWNER_ERRORS,
        404: errorResponse('Care plan not found for this animal or group.')
      }
    },
    delete: {
      summary: 'Delete a care plan',
      description:
        'Owner only. Open tasks end with reason `plan-ended`; done tasks and the health records they wrote stay.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Deleted.', {
          type: 'object',
          required: ['deleted'],
          properties: { deleted: { type: 'boolean' } }
        }),
        ...OWNER_ERRORS,
        404: errorResponse('Care plan not found for this animal or group.')
      }
    }
  },

  '/api/animals/{id}/care-plans/defaults': {
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        description: 'An animal id or a group id.',
        schema: { type: 'string' }
      }
    ],
    post: {
      summary: "Add the species' suggested care",
      description:
        "Owner only. Adds each care suggestion of the species plugin that the animal or group does not have yet, tagged `plugin`, with no due date: the owner says when it was last done. Suggestions carry an interval only when it is sourced; today's dog and cat suggestions carry none and say to ask the vet.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Nothing new to add.', {
          type: 'object',
          properties: { added: { type: 'array', items: { type: 'object' } } }
        }),
        201: jsonResponse('Added.', {
          type: 'object',
          properties: { added: { type: 'array', items: { type: 'object' } } }
        }),
        ...OWNER_ERRORS,
        404: errorResponse('No animal or group with that id on the active farm.')
      }
    }
  },

  '/api/animals/status': {
    post: {
      summary: 'Record a status change',
      description:
        'Owners and helpers. Sold, died, culled or rehomed, or `active` to correct a mistaken outcome. On a group, losses carry a negative `headCountDelta` for unnamed animals and `active` with a positive one records a hatch or purchase. `sold-for-meat` and `slaughtered` are refused until the withdrawal gate ships. A group that reaches zero answers `emptied: true` so the app can offer to archive it. Not gated by the season close-out.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(animalStatusSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Recorded.', {
          type: 'object',
          required: ['event', 'emptied'],
          properties: { event: { type: 'object' }, emptied: { type: 'boolean' } }
        }),
        400: errorResponse('Invalid body, or a subject that is not on this farm.'),
        ...AUTH_ERRORS,
        409: errorResponse(
          'The subject is archived or already in that state, or the loss is larger than the group.'
        ),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/animals/status/{id}': {
    parameters: [idPath('id', 'Status change id.')],
    delete: {
      summary: 'Undo the latest status change',
      description:
        "Owner only. Removes the subject's latest status change and restores it. A food-producing subject's change locks 48 hours after it happened (`RECORD_LOCKED`); pets stay editable. Older changes are corrected by recording a new one.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Undone.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Status change not found for the active Owner.'),
        409: errorResponse('Locked, not the latest change, or it would leave a negative count.')
      }
    }
  },

  '/api/animals/health/record': {
    post: {
      summary: 'Record an animal health event',
      description:
        "Owners and helpers. A treatment, vaccination, deworm, vet visit, injury or note on an animal or a group. Any event that names a product carries a withdrawal hold on meat, milk and eggs; the kernel's verdict is stored in `withdrawalClear` with `rulesVersion`, and the treatment always saves. A dose taken from `stockItemId` is deducted as an `animal-treatment` movement when its unit converts, and the bottle's product wins over a different pick. `coveredLogs` lists earlier food or sale logs the new hold covers (a log later changed to discarded still counts, and so do logs of groups split off the treated group), and `coveredMeat` lists slaughters or sales for meat already recorded inside it. The prohibited-drug check reads the stock bottle's name and active ingredients as well as the typed name. Withdrawal numbers are never set here; the owner adds them through `POST /api/animals/health/{id}/entries`. Not gated by the season close-out. Safe to replay from the offline queue with the client record id header.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(healthRecordSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Recorded.', {
          type: 'object',
          required: [
            'event',
            'withdrawalClear',
            'holds',
            'carriesHold',
            'coveredLogs',
            'coveredMeat',
            'warnings'
          ],
          properties: {
            event: { type: 'object' },
            withdrawalClear: { type: 'object' },
            holds: { type: 'object' },
            carriesHold: { type: 'boolean' },
            locksOnSave: { type: 'boolean' },
            coveredLogs: { type: 'array', items: { type: 'object' } },
            coveredMeat: { type: 'array', items: { type: 'object' } },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse(
          "Invalid body, a subject that is not on this farm (`UNKNOWN_SUBJECT`), another Owner's stock item, a product not in the library (`UNKNOWN_PRODUCT`) or a date in the future."
        ),
        ...AUTH_ERRORS,
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/animals/health/{id}': {
    parameters: [idPath('id', 'Health event id.')],
    delete: {
      summary: 'Remove a health record',
      description:
        'A record that carries a withdrawal hold can only be removed by the owner. On a food-producing subject it locks 48 hours after the dose (`RECORD_LOCKED`); the owner can force it with `force=true` and a `reason`. Every delete leaves a tombstone, and a deleted dose keeps its hold unless `neverGiven=true`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        { name: 'force', in: 'query', required: false, schema: { type: 'boolean' } },
        { name: 'neverGiven', in: 'query', required: false, schema: { type: 'boolean' } },
        { name: 'reason', in: 'query', required: false, schema: { type: 'string' } }
      ],
      responses: {
        200: jsonResponse('Removed.', {
          type: 'object',
          properties: { removed: { type: 'string' }, holdKept: { type: 'boolean' } }
        }),
        400: errorResponse('A locked record needs a reason (`REASON_REQUIRED`).'),
        ...AUTH_ERRORS,
        404: errorResponse('Health record not found for the active Owner.'),
        409: errorResponse('Locked (`RECORD_LOCKED`).')
      }
    }
  },

  '/api/animals/health/{id}/entries': {
    parameters: [idPath('id', 'Health event id.')],
    post: {
      summary: 'Add a withdrawal entry',
      description:
        'Owner only. Appends a withdrawal read from the label (the owner confirms the label names this species and class; zero needs `labelSaysNone`), a vet-directed withdrawal (`vetName` required), the actual last dose of a course, or the product that proves on-label use. Entries are never edited or removed, so this works on locked records and can only resolve or lengthen a hold. Extra-label use and a label that says not to use the product for this food only take a vet entry (`LABEL_PATH_CLOSED`). Numbers are typed by the owner, never filled in by AI.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(withdrawalEntrySchema),
      responses: {
        201: jsonResponse('Added.', {
          type: 'object',
          required: ['event', 'withdrawalClear', 'holds'],
          properties: {
            event: { type: 'object' },
            withdrawalClear: { type: 'object' },
            holds: { type: 'object' }
          }
        }),
        400: errorResponse('Invalid body.'),
        ...OWNER_ERRORS,
        404: errorResponse('Health record not found for the active Owner.'),
        409: errorResponse(
          'The entry is refused by the withdrawal rules (`LABEL_PATH_CLOSED`, `LABEL_NOT_CONFIRMED`, `ZERO_NOT_CONFIRMED`, `COURSE_END_EARLIER` and others).'
        )
      }
    }
  },

  '/api/stock/{id}/use': {
    post: {
      summary: 'Take feed or bedding off stock',
      description:
        'Owners and helpers. Feed and bedding items only (`NOT_FEED` otherwise). The use is typed in pounds and converted to the item unit; a bag item needs its pounds per bag first (`NEEDS_LB_PER_BAG`). Saved as an `animal-feed` stock movement; an optional animal or group rides in the movement notes as `animal-feed:<subjectType>:<id>`. A shortfall saves what was on hand and returns a `STOCK_SHORT` warning. Safe to replay from the offline queue with the client record id header.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [idPath('id', 'Stock item id.'), clientRecordRef],
      requestBody: jsonBody(feedUseSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Used.', {
          type: 'object',
          required: ['used', 'shortfall', 'onHand', 'warnings'],
          properties: {
            used: {
              type: 'object',
              properties: {
                lb: { type: 'number' },
                amount: { type: 'number' },
                unit: { type: 'string' }
              }
            },
            shortfall: { type: 'number' },
            onHand: { type: 'number' },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse(
          'Invalid body, not a feed or bedding item, a subject that is not on this farm, or a future date.'
        ),
        ...AUTH_ERRORS,
        404: errorResponse('No such stock item on this farm.'),
        409: errorResponse(
          'The item cannot take a use in pounds yet (`NEEDS_LB_PER_BAG`, `UNIT_NOT_WEIGHT`).'
        ),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/seed-starts': {
    get: {
      summary: "List a planting's seed-starting trays",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'cropId',
          in: 'query',
          required: true,
          description: 'Planting id.',
          schema: { type: 'string' }
        }
      ],
      responses: {
        200: jsonResponse('Trays, oldest sowing first.', {
          type: 'object',
          properties: { trays: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse('cropId missing.'),
        ...AUTH_ERRORS
      }
    },
    post: {
      summary: 'Log a seed-starting tray',
      description:
        "Owner only. One row per tray for a planting. The planting's indoor sowing date becomes the earliest tray's sowing. Not gated by the season close-out. Safe to replay from the offline queue with the client record id header.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(seedStartCreateSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Tray saved.', {
          type: 'object',
          properties: { tray: { type: 'object' } }
        }),
        400: errorResponse(
          'Invalid body, a planting, Area or stock lot that is not on this farm, or a future sowing (`IN_THE_FUTURE`).'
        ),
        ...AUTH_ERRORS
      }
    }
  },

  '/api/seed-starts/{id}': {
    get: {
      summary: 'Get one tray',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [idPath('id', 'Tray id.')],
      responses: {
        200: jsonResponse('The tray.', {
          type: 'object',
          properties: { tray: { type: 'object' } }
        }),
        ...AUTH_ERRORS,
        404: errorResponse('No such tray on this farm.')
      }
    },
    patch: {
      summary: 'Edit a tray',
      description: 'Owner only, online only.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [idPath('id', 'Tray id.')],
      requestBody: jsonBody(seedStartPatchSchema),
      responses: {
        200: jsonResponse('Tray saved.', {
          type: 'object',
          properties: { tray: { type: 'object' } }
        }),
        400: errorResponse('Invalid body or a future sowing.'),
        ...AUTH_ERRORS,
        404: errorResponse('No such tray on this farm.')
      }
    }
  },

  '/api/seed-starts/{id}/progress': {
    post: {
      summary: 'Record germination or tray progress',
      description:
        'Owners and helpers. The germinated count is absolute; the value with the latest `observedAt` wins, so an older replay never overwrites a newer count (`countApplied: false`). Hardening and transplant dates keep the earliest value sent. Not gated by the season close-out. The `seed-start` offline queue kind replays here with the client record id header.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [idPath('id', 'Tray id.'), clientRecordRef],
      requestBody: jsonBody(seedStartProgressSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Saved.', {
          type: 'object',
          properties: { tray: { type: 'object' }, countApplied: { type: 'boolean' } }
        }),
        400: errorResponse(
          'Invalid body, a count above the seeds in the tray (`OVER_TRAY`) or a future date.'
        ),
        ...AUTH_ERRORS,
        404: errorResponse('No such tray on this farm.'),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/animals/production/record': {
    post: {
      summary: 'Log eggs, milk or a weight',
      description:
        'Owners and helpers. Eggs and milk declared as `food` or `sale` run the withdrawal gate at the time they were collected, with no override: a stop answers 422 with `code` (`WITHDRAWAL_ACTIVE`, `WITHDRAWAL_UNKNOWN` or `PROHIBITED_DRUG`), the clear date when known and `resubmitAs: discard`. `discard` always saves; `feed-to-animals` and `unknown` save with a warning. Weights are never gated. Not gated by the season close-out. Safe to replay from the offline queue; a replay that now hits a hold gets the same 422 and waits in the queue. Resending it as `discard` with `convertedFromUse` (the use it was queued with) saves once and keeps that change in the record trail.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(productionRecordSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Logged.', {
          type: 'object',
          required: ['log', 'warnings'],
          properties: {
            log: { type: 'object' },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse('Invalid body, a subject that is not on this farm, or a future date.'),
        ...AUTH_ERRORS,
        422: errorResponse('A withdrawal hold stops this food or sale declaration.'),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/animals/production/{id}': {
    parameters: [idPath('id', 'Production log id.')],
    patch: {
      summary: 'Change what happened to a log',
      description:
        'A change toward `discard` always saves, even on a locked log. Any other change runs the withdrawal gate and respects the 48 hour lock of a food-producing subject. The previous value is kept in the record trail.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(productionPatchSchema),
      responses: {
        200: jsonResponse('Changed.', { type: 'object' }),
        400: errorResponse('Invalid body.'),
        ...AUTH_ERRORS,
        404: errorResponse('Log not found for the active Owner.'),
        409: errorResponse('Locked (`RECORD_LOCKED`).'),
        422: errorResponse('A withdrawal hold stops this food or sale declaration.')
      }
    },
    delete: {
      summary: 'Remove a log',
      description:
        "A food-producing subject's log locks 48 hours after it was collected; only the owner can then remove it, with `force=true` and a `reason`, leaving a tombstone.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        { name: 'force', in: 'query', required: false, schema: { type: 'boolean' } },
        { name: 'reason', in: 'query', required: false, schema: { type: 'string' } }
      ],
      responses: {
        200: jsonResponse('Removed.', { type: 'object' }),
        400: errorResponse('A locked log needs a reason.'),
        ...AUTH_ERRORS,
        404: errorResponse('Log not found for the active Owner.'),
        409: errorResponse('Locked (`RECORD_LOCKED`).')
      }
    }
  },

  '/api/animals/grazing-attestations': {
    post: {
      summary: 'Record grazing intervals read from a label',
      description:
        "Owner only. For applications on one Area (`spray|insecticide|fungicide:<event id>`), records the grazing and haying days read from the product's label, which lift a `GRAZING_UNKNOWN` block for exactly those applications. One row per application and product with `manual` provenance and the owner's reason; rows are never edited or deleted. A label that forbids grazing is never cleared (`LABEL_FORBIDS_GRAZING`), and a number below a label value on file never shortens a hold.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(grazingAttestationSchema),
      responses: {
        201: jsonResponse('Recorded.', {
          type: 'object',
          required: ['attestations'],
          properties: { attestations: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse(
          "Invalid body, another Owner's Area, an application that is not on the Area (`UNKNOWN_APPLICATION`) or a multi-product application with no product named (`PRODUCT_REQUIRED`)."
        ),
        ...OWNER_ERRORS,
        409: errorResponse('The label forbids grazing (`LABEL_FORBIDS_GRAZING`).')
      }
    }
  },

  '/api/irrigation': {
    post: {
      summary: 'Log a watering',
      description:
        'Owners and helpers; inspectors are read-only. Give `inches`, `gallons` or `durationMin` (minutes alone have no amount, so the watering advice cannot count them). `blockId` must be a bed of `fieldId`. `occurredAt` defaults to now and may not be in the future or more than a year back. A light record: no lock, not in compliance exports, never gated by the season close-out. Safe to replay from the offline queue with the client record id header.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(irrigationCreateSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Saved.', {
          type: 'object',
          required: ['irrigation'],
          properties: { irrigation: { type: 'object' } }
        }),
        400: errorResponse(
          "Invalid body, another Owner's Area or bed, a bed outside the Area, or a time in the future (`IN_THE_FUTURE`) or over a year ago (`TOO_OLD`)."
        ),
        ...AUTH_ERRORS,
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    },
    get: {
      summary: 'List watering logs',
      description:
        "The active Owner's watering logs, newest first, at most 500. Every member can read them.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        { name: 'fieldId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'from',
          in: 'query',
          required: false,
          description: 'Epoch ms.',
          schema: { type: 'integer' }
        },
        {
          name: 'to',
          in: 'query',
          required: false,
          description: 'Epoch ms.',
          schema: { type: 'integer' }
        }
      ],
      responses: {
        200: jsonResponse('Watering logs.', {
          type: 'object',
          required: ['irrigation'],
          properties: { irrigation: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse('`from` or `to` is not epoch milliseconds.'),
        401: errorResponse('Authentication required.')
      }
    }
  },

  '/api/irrigation/{id}': {
    parameters: [idPath('id', 'Watering log id.')],
    delete: {
      summary: 'Remove a watering log',
      description:
        'The owner, or the member who logged it. No lock and no tombstone: a mistyped amount would mislead the watering advice for a week.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Removed.', { type: 'object', properties: { ok: { const: true } } }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Only the owner or the person who logged it can remove it.'),
        404: errorResponse('No such watering log for the active Owner.')
      }
    }
  },

  '/api/irrigation/target': {
    post: {
      summary: "Set an Area's weekly water target",
      description:
        'Owner only. Stored as `manual`; `inches: null` goes back to the sourced default (1 inch a week, tagged `fallback`).',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(waterTargetSchema),
      responses: {
        200: jsonResponse('The target now in force.', {
          type: 'object',
          required: ['target'],
          properties: { target: { type: ['object', 'null'] } }
        }),
        400: errorResponse("Invalid body or another Owner's Area."),
        ...OWNER_ERRORS
      }
    }
  },

  '/api/irrigation/summary': {
    get: {
      summary: "One Area's watering summary",
      description:
        'Beds, the weekly target and where it came from, watering this week, recent gauge readings and every garden or field Area with its latest reading. Every member can read it.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [{ name: 'fieldId', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        200: jsonResponse('Summary.', { type: 'object' }),
        401: errorResponse('Authentication required.'),
        404: errorResponse('No such Area for the active Owner.')
      }
    }
  },

  '/api/rain-gauge': {
    post: {
      summary: 'Enter a rain-gauge reading',
      description:
        "Owners and helpers. A reading is the rain since that Area's previous reading, or the 24 hours before it when there is none in the last 7 days; each Area in `fieldIds` gets its own row and the answer says where each one counts from (`countsFrom`). Hours inside a gauge period take the gauge and ignore the weather station. Never gated by the season close-out. Safe to replay from the offline queue with the client record id header.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(rainGaugeCreateSchema),
      responses: {
        200: jsonResponse(
          'A replay of a client record id that was already saved.',
          DUPLICATE_SCHEMA
        ),
        201: jsonResponse('Saved.', {
          type: 'object',
          required: ['readings'],
          properties: { readings: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse(
          "Invalid body, another Owner's Area, or a time in the future or over a year ago."
        ),
        ...AUTH_ERRORS,
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/rain-gauge/{id}': {
    parameters: [idPath('id', 'Gauge reading id.')],
    delete: {
      summary: 'Remove a rain-gauge reading',
      description: 'The owner, or the member who entered it.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Removed.', { type: 'object', properties: { ok: { const: true } } }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Only the owner or the person who entered it can remove it.'),
        404: errorResponse('No such reading for the active Owner.')
      }
    }
  },

  '/api/animal-groups': {
    get: {
      summary: 'List animal groups',
      description:
        'Groups of the active Owner with `total` (unnamed `headCount` plus active named members) and `effectiveFoodProducing` (the group flag or any active member). `status` is `active` (default), `archived` or `all`; `fieldId` and `speciesId` narrow the list.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['active', 'archived', 'all'] }
        },
        { name: 'fieldId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'speciesId', in: 'query', required: false, schema: { type: 'string' } }
      ],
      responses: {
        200: jsonResponse('Groups.', {
          type: 'object',
          required: ['groups'],
          properties: { groups: { type: 'array', items: { type: 'object' } } }
        }),
        400: errorResponse('Unknown status.')
      }
    },
    post: {
      summary: 'Add a group with a head count',
      description:
        'Owner only. `headCount` is the whole group; each entry in `members` becomes a named animal in the group and comes off the unnamed count. One species per group.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(animalGroupCreateSchema),
      responses: {
        201: jsonResponse('Group added.', {
          type: 'object',
          required: ['group', 'members', 'warnings'],
          properties: {
            group: { type: 'object' },
            members: { type: 'array', items: { type: 'object' } },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse(
          "Invalid body, an unknown species, another Owner's Area or an Area animals cannot live on."
        ),
        ...OWNER_ERRORS
      }
    }
  },

  '/api/animal-groups/{id}': {
    parameters: [idPath('id', 'Group id.')],
    get: {
      summary: 'One group with its members and history',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The group.', { type: 'object', required: ['group'] }),
        404: errorResponse('Group not found for the active Owner.')
      }
    },
    patch: {
      summary: 'Edit a group',
      description:
        'Owner only. A `headCount` change writes a status change with the difference (`countReason`, default "Count corrected"). Changing `foodProducing` needs `flagReason` and writes an audit row. A group with active named members cannot be archived.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(animalGroupPatchSchema),
      responses: {
        200: jsonResponse('Saved.', {
          type: 'object',
          required: ['group', 'flagChanges'],
          properties: {
            group: { type: 'object' },
            flagChanges: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse('Invalid body.'),
        ...OWNER_ERRORS,
        404: errorResponse('Group not found for the active Owner.'),
        409: errorResponse(
          'The group still has named animals (`GROUP_HAS_MEMBERS`), or is archived.'
        )
      }
    },
    delete: {
      summary: 'Delete a mistaken group',
      description:
        'Owner only. Deletes a group with no member rows and no records. Otherwise `GROUP_HAS_MEMBERS` or `ANIMAL_HAS_RECORDS`; archive it instead.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Deleted.', { type: 'object' }),
        ...OWNER_ERRORS,
        404: errorResponse('Group not found for the active Owner.'),
        409: errorResponse('The group has members or records.')
      }
    }
  },

  '/api/garden/plantings': {
    post: {
      summary: 'Plant into garden beds as one batch',
      description:
        'Owner only. Creates `planned` plantings in beds. Every item is checked before anything is written, so one bad item saves nothing. `source` records where each proposal came from and is stored as its provenance.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(plantingCreateSchema),
      responses: {
        201: jsonResponse('Plantings saved.', {
          type: 'object',
          required: ['plantings'],
          properties: { plantings: { type: 'array', items: placedRef } }
        }),
        ...GARDEN_ERRORS
      }
    }
  },

  '/api/garden/beds/{blockId}/succession': {
    parameters: [idPath('blockId', 'Bed (block) id.')],
    post: {
      summary: 'Preview or save succession sowings',
      description:
        'Owner only. `commit: false` previews the sowings that fit after a planting; `commit: true` saves them linked as one succession group.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(successionRequestSchema),
      responses: {
        200: jsonResponse('Preview.', { type: 'object' }),
        201: jsonResponse('Sowings saved.', {
          type: 'object',
          properties: {
            proposal: { type: 'object' },
            groupId: { type: ['string', 'null'] },
            anchor: placedRef,
            created: { type: 'array', items: placedRef }
          }
        }),
        ...GARDEN_ERRORS
      }
    }
  },

  '/api/garden/beds/{blockId}/fill': {
    parameters: [idPath('blockId', 'Bed (block) id.')],
    post: {
      summary: 'Propose plantings for the free space in a bed',
      description:
        'Owner only. Never saves anything; accepted proposals go to `POST /api/garden/plantings`. Claude is asked only when it is available (through `aiTry()`); otherwise, or when its answer fails the server checks, the proposals come from the best-fitting bed recipe or a spacing-packed plan and are tagged `fallback`, with `fallbackReason` saying why.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(fillRequestSchema),
      responses: {
        200: jsonResponse('Proposals.', {
          type: 'object',
          required: ['proposals', 'provenance', 'fallbackReason', 'message'],
          properties: {
            proposals: { type: 'array', items: { type: 'object' } },
            provenance: { type: 'string', enum: ['ai', 'fallback'] },
            fallbackReason: {
              type: ['string', 'null'],
              enum: ['no-key', 'over-cap', 'offline', 'rate-limit', 'timeout', null]
            },
            message: { type: ['string', 'null'] }
          }
        }),
        ...GARDEN_ERRORS
      }
    }
  },

  '/api/plan/beds/suggest': {
    post: {
      summary: 'Suggest beds sized for the seed being planted',
      description:
        "Owner only. Never saves anything; the planning wizard adds the beds the owner keeps through `POST /api/blocks`. Claude groups the seed when it is available (through `aiTry()`, on the Fill this bed allowance); every bed is checked against each crop's plugin spacing and every plant must be placed. Otherwise the beds come from a plain spacing plan and are tagged `fallback`. `bedWidthFt` and `maxBedLengthFt` are the owner's own choice.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(bedLayoutRequestSchema),
      responses: {
        200: jsonResponse('Suggested beds.', {
          type: 'object',
          required: ['beds', 'provenance', 'message'],
          properties: {
            beds: { type: 'array', items: { type: 'object' } },
            provenance: { type: 'string', enum: ['ai', 'fallback'] },
            note: { type: ['string', 'null'] },
            message: { type: ['string', 'null'] }
          }
        }),
        400: { description: 'Invalid body.' },
        403: { description: 'Not the owner.' },
        404: { description: 'A seed id is not a seed on this farm.' }
      }
    }
  },

  '/api/garden/beds/{blockId}/recipe': {
    parameters: [idPath('blockId', 'Bed (block) id.')],
    post: {
      summary: 'Preview or apply a bed recipe',
      description:
        'Owner only. `commit: false` previews the recipe on the bed as stored and saves nothing. `commit: true` saves the kept steps (`acceptKeys`, or the keys in `expected`, or every step) as `planned` plantings with `plugin` provenance, all or none. The server recomputes the recipe first; when a kept step no longer fits, or a step in `expected` came out with a different date or spot (the bed Size or the frost dates changed), nothing is saved and the answer is 409 `STALE`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(recipeRequestSchema),
      responses: {
        200: jsonResponse('Preview.', {
          type: 'object',
          required: ['application', 'created'],
          properties: {
            application: { type: 'object' },
            created: { type: 'array', maxItems: 0, items: placedRef }
          }
        }),
        201: jsonResponse('Plantings saved.', {
          type: 'object',
          required: ['application', 'created'],
          properties: {
            application: { type: 'object' },
            created: { type: 'array', items: placedRef }
          }
        }),
        400: jsonResponse('Invalid request body, or no step kept.', gardenErrorRef),
        ...OWNER_ERRORS,
        404: jsonResponse('Bed or recipe not found for the active Owner.', gardenErrorRef),
        409: jsonResponse(
          'The bed changed since the preview (`STALE`), a step does not fit (`OVERLAP`, `OUTSIDE_AREA`), or the block is not a sized bed in a garden (`NOT_DESIGNABLE`).',
          gardenErrorRef
        )
      }
    }
  },

  '/api/garden/areas/{id}/design': {
    parameters: [idPath('id', 'Area id.')],
    get: {
      summary: "A garden or greenhouse Area's designer data",
      description:
        "Readable by every signed-in role; `canEdit` is true only for the owner. Returns the beds, placed plantings, frost dates, crop catalog, companions, bed recipes and each bed's planting history. Another Owner's Area, or an Area that is not a garden or greenhouse, is a 404.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'season',
          in: 'query',
          required: false,
          description:
            'Season year (`YYYY`). Honoured only when it is one of the `seasons` the answer lists; otherwise the active planning year is used.',
          schema: { type: 'string', pattern: '^\\d{4}$', example: '2027' }
        }
      ],
      responses: {
        200: jsonResponse('The designer data.', {
          type: 'object',
          required: ['design', 'history', 'catalog', 'canEdit', 'role', 'seasons', 'activeYear'],
          properties: {
            design: { type: 'object' },
            history: { type: 'object', additionalProperties: { type: 'array' } },
            catalog: { type: 'array', items: { type: 'object' } },
            companions: { type: 'array', items: { type: 'object' } },
            lookbackByFamily: { type: 'object', additionalProperties: { type: 'integer' } },
            areaKind: { type: 'string', enum: ['garden', 'greenhouse'] },
            recipes: { type: 'array', items: { type: 'object' } },
            canEdit: { type: 'boolean' },
            role: { type: 'string' },
            seasons: { type: 'array', items: { type: 'integer' } },
            activeYear: { type: 'integer' }
          }
        }),
        401: errorResponse('Authentication required.'),
        404: errorResponse('Not a garden or greenhouse Area of the active Owner.')
      }
    }
  },

  '/api/crops/{id}': {
    parameters: [idPath('id', 'Planting (crop) id.')],
    patch: {
      summary: 'Change a planting',
      description:
        "The body's `action` picks what changes: the status (`mark-harvested`, `archive`, `mark-failed`, `reactivate`), the date and block (`set-schedule`), the crop plugin (`change-plugin`, not available yet), the variety and quantity (`edit-details`), taking it off the schedule (`unschedule`), splitting it (`split`) or its spot in a garden bed (`set-placement`). Inspectors are read-only. `set-placement` is owner only: it places, moves or clears a planting's spot (`footprint: null`) and moves its date when `plantingDateMs` is sent. A planting already in the ground can't change beds and its date can't move past today (409 `IN_GROUND`). A linked succession sowing needs a spot that is free for its whole time in the bed (409 `OVERLAP`), and a spot past the bed edge is refused with `OUTSIDE_AREA`.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(cropPatchSchema),
      responses: {
        200: jsonResponse('Saved. The shape depends on the action.', {
          oneOf: [
            {
              type: 'object',
              description: 'Status, `set-schedule` and `edit-details`: the saved planting.',
              required: ['crop'],
              properties: { crop: { type: 'object' } }
            },
            {
              type: 'object',
              description: '`split`: every part.',
              required: ['crops'],
              properties: { crops: { type: 'array', items: { type: 'object' } } }
            },
            {
              type: 'object',
              description: '`unschedule`: what was removed with it.',
              required: ['ok'],
              properties: {
                ok: { const: true },
                tasksDeleted: { type: 'integer' },
                disbandedGroupId: { type: ['string', 'null'] }
              }
            },
            {
              type: 'object',
              description: '`set-placement`: the placed planting.',
              required: ['planting', 'reanchored', 'warnings'],
              properties: {
                planting: placedRef,
                reanchored: {
                  type: ['object', 'null'],
                  properties: { shifted: { type: 'integer' }, flaggedStale: { type: 'integer' } }
                },
                followers: { type: 'array', items: placedRef },
                warnings: { type: 'array', items: { type: 'string' } }
              }
            }
          ]
        }),
        400: jsonResponse(
          'Invalid request body, a spot past the bed edge (`OUTSIDE_AREA`) or an unknown bed (`FOREIGN_REF`).',
          gardenErrorRef
        ),
        401: errorResponse('Authentication required.'),
        403: jsonResponse(
          'Inspectors are read-only; `set-placement` needs the owner role (`READ_ONLY`).',
          gardenErrorRef
        ),
        404: jsonResponse('Planting not found for the active Owner.', gardenErrorRef),
        409: jsonResponse(
          'Already in the ground (`IN_GROUND`), the spot is taken for a linked sowing (`OVERLAP`), the block is not a sized bed in a garden (`NOT_DESIGNABLE`), a split that could not be made, or `change-plugin` on the anchor of a planting group.',
          gardenErrorRef
        ),
        501: errorResponse('`change-plugin` is not available yet.')
      }
    }
  },

  '/api/cards/snapshot': {
    get: {
      summary: "The active Owner's offline Card bundle",
      description:
        'Everything the offline Cards need, built from tenant-scoped reads: Areas, blocks, plantings, open tasks, equipment, stock, crop and spray product data, frost dates and the Farm Map Card emergency contacts. Helpers can read it. Sends a weak ETag and answers 304 to a matching `If-None-Match`.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'If-None-Match',
          in: 'header',
          required: false,
          description: 'ETag from an earlier response.',
          schema: { type: 'string' }
        }
      ],
      responses: {
        200: {
          description: 'The snapshot.',
          headers: {
            ETag: {
              description: 'Weak validator over everything but `generatedAt`.',
              schema: { type: 'string' }
            }
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'version',
                  'ownerId',
                  'generatedAt',
                  'rulesVersion',
                  'areas',
                  'blocks',
                  'plantings',
                  'tasks',
                  'equipment',
                  'stock',
                  'cropPlugins',
                  'frost'
                ],
                properties: {
                  version: { const: 1 },
                  ownerId: { type: 'string' },
                  farmName: { type: ['string', 'null'] },
                  generatedAt: { type: 'integer', description: 'Unix epoch ms.' },
                  rulesVersion: { type: 'string' },
                  origin: { type: ['string', 'null'] },
                  areas: { type: 'array', items: { type: 'object' } },
                  blocks: { type: 'array', items: { type: 'object' } },
                  plantings: { type: 'array', items: { type: 'object' } },
                  tasks: { type: 'array', items: { type: 'object' } },
                  equipment: { type: 'array', items: { type: 'object' } },
                  stock: { type: 'array', items: { type: 'object' } },
                  cropPlugins: { type: 'object' },
                  frost: {
                    type: ['object', 'null'],
                    description:
                      'Frost dates with their provenance (`data`, `manual` or `fallback`).'
                  },
                  sprayProducts: { type: 'object' },
                  emergencyContacts: {
                    type: 'array',
                    maxItems: 5,
                    items: fromZod(emergencyContactSchema)
                  }
                }
              }
            }
          }
        },
        304: { description: 'Unchanged since the ETag you sent.' },
        401: errorResponse('Authentication required.')
      }
    }
  },

  '/api/fertility/soil-tests': {
    post: {
      summary: 'Save a soil test for a bed or block',
      description:
        "Owner only. Enter the numbers exactly as the lab printed them and say whether they were ppm or lb/acre in `unitsBasis` (missing means ppm); planning converts lb/acre to ppm before crediting nutrients. `labRatings` holds the lab's own low/medium/high words, which are shown in place of CropCard's computed class. Soil tests are saved online only. Another Owner's `blockId` is refused.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(soilTestCreateSchema),
      responses: {
        201: jsonResponse('The saved soil test.', {
          type: 'object',
          required: ['soilTest'],
          properties: { soilTest: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, or a `blockId` the active Owner does not have.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Owner role required.')
      }
    }
  },

  '/api/fertility/soil-tests/{id}': {
    parameters: [idPath('id', 'Soil test id.')],
    patch: {
      summary: "Attach, replace or remove a soil test's lab report",
      description:
        'Owner only. `documentId` names a live, non-photo document of the active Owner (upload it first with `POST /api/documents`); `null` removes the report. The soil test pointer and its `soil-test` document link change in one transaction. A deleted document is 409 `DOCUMENT_DELETED`; a journal or animal photo is 409 `PHOTO_DOCUMENT`. Not gated by the season close-out.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(soilTestDocumentPatchSchema),
      responses: {
        200: jsonResponse('Saved.', {
          type: 'object',
          properties: {
            soilTest: {
              type: 'object',
              properties: { id: { type: 'string' }, documentId: { type: ['string', 'null'] } }
            }
          }
        }),
        400: errorResponse('Invalid body, or a `documentId` the active Owner does not have.'),
        ...OWNER_ERRORS,
        404: errorResponse('Soil test not found for the active Owner.'),
        409: errorResponse('`DOCUMENT_DELETED` or `PHOTO_DOCUMENT`.')
      }
    },
    delete: {
      summary: 'Delete a soil test',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Deleted.', { type: 'object' }),
        ...OWNER_ERRORS
      }
    }
  },

  '/api/documents': {
    post: {
      summary: "Upload a file to the farm's document vault",
      description:
        "Owner only (cookie session or the owner's API token); helpers and inspectors get 403 `OWNER_ONLY`. The request body is the raw file and `Content-Length` is required (411 `LENGTH_REQUIRED`). The declared `Content-Type` is ignored: the type is read from the bytes, and only PDF, JPEG, PNG, WebP and UTF-8 CSV are stored (415 `UNSUPPORTED_TYPE` otherwise). Over 20,000,000 bytes is 413 `TOO_LARGE`; an upload that would take the farm past its plan's storage cap is 413 `STORAGE_FULL` and stores nothing. Zero bytes is 400 `EMPTY`; a body shorter or longer than `Content-Length` is 400 `TRUNCATED`. JPEG, PNG and WebP metadata (EXIF, XMP, GPS, text chunks) is removed before storage. With no storage configured the answer is 503 `VAULT_OFF`; during a deploy handoff 503 `FENCED` with `Retry-After`. An optional `subjectType` + `subjectId` attaches the new file in the same transaction (another Owner's subject is 400 `FOREIGN_REF`). Not gated by the season close-out.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: Object.entries(fromZod(documentUploadQuerySchema).properties ?? {}).map(
        ([name, schema]) => ({
          name,
          in: 'query',
          required: name === 'kind',
          schema
        })
      ),
      requestBody: {
        required: true,
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary', maxLength: 20000000 }
          }
        }
      },
      responses: {
        201: jsonResponse('The stored document.', {
          type: 'object',
          required: ['document'],
          properties: { document: { $ref: '#/components/schemas/DocumentMeta' } }
        }),
        400: errorResponse('`EMPTY`, `TRUNCATED`, `FOREIGN_REF` or an invalid query.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('`OWNER_ONLY`.'),
        411: errorResponse('`LENGTH_REQUIRED`.'),
        413: errorResponse('`TOO_LARGE` or `STORAGE_FULL`.'),
        415: errorResponse('`UNSUPPORTED_TYPE`.'),
        503: errorResponse('`VAULT_OFF` or `FENCED`.')
      }
    },
    get: {
      summary: 'List documents the caller may read',
      description:
        'Newest first, 100 per page; pass `nextBefore` and `nextBeforeId` back as `before` and `beforeId` for the next page. Owners see every document; helpers and inspectors see only files linked to subjects their role can read (a money record is owner only; a farm or organic status link is owner and inspector). Journal and animal photos are listed only for the owner and only when `kind` asks for them. `includeDeleted=1` is honoured for the owner only. `vault.enabled` says whether uploads can be stored; `canDelete` is true for the signed-in owner.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: Object.entries(fromZod(documentListQuerySchema).properties ?? {}).map(
        ([name, schema]) => ({ name, in: 'query', required: false, schema })
      ),
      responses: {
        200: jsonResponse('A page of documents.', {
          type: 'object',
          properties: {
            documents: { type: 'array', items: { $ref: '#/components/schemas/DocumentMeta' } },
            nextBefore: { type: ['integer', 'null'] },
            nextBeforeId: { type: ['string', 'null'] },
            vault: { type: 'object', properties: { enabled: { type: 'boolean' } } },
            canDelete: { type: 'boolean' }
          }
        }),
        400: errorResponse('Invalid query.'),
        401: errorResponse('Authentication required.')
      }
    }
  },

  '/api/documents/{id}': {
    parameters: [idPath('id', 'Document id.')],
    get: {
      summary: "A document's metadata",
      description:
        'Same access as the file. A deleted document still answers, with `deletedAt` and `deletedBy`, to anyone who could read it. A missing, foreign or unreadable id is 404 with an identical body. Storage keys are never returned.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The document.', {
          type: 'object',
          properties: { document: { $ref: '#/components/schemas/DocumentMeta' } }
        }),
        401: errorResponse('Authentication required.'),
        404: errorResponse('`NOT_FOUND`.')
      }
    },
    delete: {
      summary: 'Delete a file',
      description:
        "Interactive owner only: a cookie session with the owner role that is not impersonating; API tokens, helpers and impersonating superadmins get 403 `INTERACTIVE_OWNER_ONLY`. The bytes are deleted at once and the row keeps its metadata with `deletedAt` and `deletedBy`, so records that point at the file say when it was deleted. Links stay. Journal and animal photos are removed from their entry or animal instead (409 `PHOTO_DOCUMENT`). The storage provider's backup copies are removed within 30 days.",
      security: [{ cookieSession: [] }],
      responses: {
        200: jsonResponse('The deleted document.', {
          type: 'object',
          properties: { document: { $ref: '#/components/schemas/DocumentMeta' } }
        }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('`INTERACTIVE_OWNER_ONLY`.'),
        404: errorResponse('`NOT_FOUND`.'),
        409: errorResponse('`PHOTO_DOCUMENT`.')
      }
    }
  },

  '/api/documents/{id}/file': {
    parameters: [idPath('id', 'Document id.')],
    get: {
      summary: "A document's bytes",
      description:
        "Streamed with the stored type, `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'`, `Cache-Control: private, no-store` and `Cross-Origin-Resource-Policy: same-origin`. Images are served `inline`; PDF and CSV as `attachment`, named from the title. No range requests. A missing, deleted, foreign or unreadable id is the same 404. With storage switched off a readable file answers 503 `VAULT_OFF`.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: {
          description: 'The file.',
          content: {
            'application/pdf': { schema: { type: 'string', format: 'binary' } },
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
            'text/csv': { schema: { type: 'string' } }
          }
        },
        401: errorResponse('Authentication required.'),
        404: errorResponse('`NOT_FOUND`.'),
        503: errorResponse('`VAULT_OFF`.')
      }
    }
  },

  '/api/documents/{id}/links': {
    parameters: [idPath('id', 'Document id.')],
    post: {
      summary: 'Attach a file to a record',
      description:
        "Owner only. A repeated link is a no-op. `farm` links name the active Owner's id. The subject must belong to the active Owner (400 `FOREIGN_REF`). A deleted file is 409 `DOCUMENT_DELETED`; journal and animal photos are 409 `PHOTO_DOCUMENT`. Links decide who else can read the file.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(documentLinkCreateSchema),
      responses: {
        201: jsonResponse('The link and the document.', {
          type: 'object',
          properties: {
            link: { type: 'object' },
            document: { $ref: '#/components/schemas/DocumentMeta' }
          }
        }),
        400: errorResponse('Invalid body or `FOREIGN_REF`.'),
        ...OWNER_ERRORS,
        404: errorResponse('`NOT_FOUND`.'),
        409: errorResponse('`DOCUMENT_DELETED` or `PHOTO_DOCUMENT`.')
      }
    }
  },

  '/api/documents/{id}/links/{linkId}': {
    parameters: [idPath('id', 'Document id.'), idPath('linkId', 'Link id.')],
    delete: {
      summary: 'Detach a file from a record',
      description:
        "Owner only. Removing a soil test's link to its own lab report also clears the soil test's report.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The document after the change.', {
          type: 'object',
          properties: { document: { $ref: '#/components/schemas/DocumentMeta' } }
        }),
        ...OWNER_ERRORS,
        404: errorResponse('`NOT_FOUND`.')
      }
    }
  },

  '/api/account/export.zip': {
    get: {
      summary: 'Download every record and file as one ZIP',
      description:
        'Interactive owner only (API tokens and impersonation get 403 `INTERACTIVE_OWNER_ONLY`). Streams `export.json` (the same object as `GET /api/account/export.json`) and every live document, photos included, as `documents/<id>-<slug>.<ext>`. Store-only ZIP with ZIP64 when needed. A file whose bytes cannot be read is left out and named in `documents/MISSING.txt`.',
      security: [{ cookieSession: [] }],
      responses: {
        200: {
          description: 'The ZIP file.',
          content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } }
        },
        401: errorResponse('Authentication required.'),
        403: errorResponse('`INTERACTIVE_OWNER_ONLY`.')
      }
    }
  },

  '/api/tasks/close': {
    post: {
      summary: 'Close a task (offline replay of Done or Skip)',
      description:
        "The offline queue's replay of a Done or Skip made on /today with no signal. Owners and helpers can close any task of the active Owner; inspectors are read-only. Idempotent: a task that is already closed answers 200 with `alreadyClosed: true` and is left as it was, and a replay of a client record id that was already saved writes nothing. `occurredAt` keeps the moment of the tap, clamped to no later than now and no earlier than 30 days back. An animal-care task (category `animal-care`) closes through its care plan: a vaccine, wormer or treatment must carry `healthEvent` (the body of `POST /api/animals/health/record`, for the task's own animal or group), which is saved with the kernel verdict, stock deduction and hold guard in the same transaction as the close; without it the answer is 422 `CARE_NEEDS_RECORD`. A vet visit with no `healthEvent` saves a plain vet-visit record. Done may carry `minutes` (whole minutes, 1 to 720; refused with `abort`), saved as a time row for the person closing in the same transaction, with the task's planting, block and field; the answer then carries `timeSaved: true`. Time sent for a task someone else already closed is still saved (`alreadyClosed: true, timeSaved: true`). Done rolls the plan forward from the day it was done, or to `nextDueOn` when the signed-in owner gives one (stored as `manual`; a helper's is ignored with a `NEXT_DUE_OWNER` warning). Skip on a vaccine, wormer or treatment must say `careSkip`: `skip-this` rolls from the due day, `snooze` with `snoozeDays` (1, 3 or 7) keeps the task open and moves it; otherwise 422 `CARE_SKIP_CHOICE`. Not gated by the season close-out.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(taskCloseSchema),
      responses: {
        200: jsonResponse('The task after closing, or as it already was.', {
          type: 'object',
          properties: {
            task: { type: 'object' },
            alreadyClosed: { type: 'boolean' },
            timeSaved: { type: 'boolean' },
            nextDueOn: { type: ['string', 'null'] },
            snoozedUntil: { type: 'string' },
            event: { type: 'object' },
            warnings: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse(
          'Invalid body, or a treatment for another animal than the task (`SUBJECT_MISMATCH`).'
        ),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Inspector role is read-only.'),
        404: errorResponse('Task not found for the active Owner.'),
        409: errorResponse('The hold guard refused the treatment (see the health endpoint).'),
        422: errorResponse(
          'An animal-care close needs the treatment (`CARE_NEEDS_RECORD`) or a Skip choice (`CARE_SKIP_CHOICE`).'
        ),
        503: errorResponse(
          'The same client record id is being saved by another request right now. Retry shortly.'
        )
      }
    }
  },

  '/api/tasks': {
    get: {
      summary: 'List tasks',
      description:
        'Tasks of the active Owner, oldest scheduled first. Each carries `assigneeUserId` and `assignee` (`{ id, name }` or null), the name shown as the chosen name, else the email local-part, else "phone ending 1234".',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'from',
          in: 'query',
          description: 'Earliest scheduled time, epoch ms.',
          schema: { type: 'integer' }
        },
        {
          name: 'to',
          in: 'query',
          description: 'Latest scheduled time, epoch ms.',
          schema: { type: 'integer' }
        },
        { name: 'cropId', in: 'query', schema: { type: 'string' } },
        { name: 'blockId', in: 'query', schema: { type: 'string' } },
        { name: 'equipmentId', in: 'query', schema: { type: 'string' } },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['open', 'completed', 'aborted'] }
        },
        {
          name: 'kind',
          in: 'query',
          schema: { type: 'string', enum: ['primary', 'pre-task', 'post-task'] }
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000 } }
      ],
      responses: {
        200: jsonResponse('The tasks.', {
          type: 'object',
          properties: { tasks: { type: 'array', items: { type: 'object' } } }
        }),
        401: errorResponse('Authentication required.')
      }
    },
    post: {
      summary: 'Create a task',
      description:
        "Owners and helpers create tasks; inspectors are read-only. A primary that names a planting or implement gets its plugin prep and follow-up tasks. `assigneeUserId` gives the task (and its prep and follow-up tasks) to an active owner, helper or custom operator of this farm; only an owner may send one (403 `OWNER_ONLY` with `askOwner: true` otherwise, and a superadmin impersonating is not the owner). Anyone else, including another farm's users and inspectors, is 400 `FOREIGN_REF`. Not gated by the season close-out.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(taskCreateSchema),
      responses: {
        201: jsonResponse('The task and the ids of the prep and follow-up tasks written.', {
          type: 'object',
          properties: { task: { type: 'object' }, materialized: { type: 'object' } }
        }),
        400: errorResponse('Invalid body, an id from another Owner, or `FOREIGN_REF`.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Inspector role is read-only, or `OWNER_ONLY` for an assignee.')
      }
    }
  },

  '/api/tasks/{id}': {
    parameters: [idPath('id', 'Task id.')],
    get: {
      summary: 'A task with its prep and follow-up tasks',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The task and its linked tasks.', {
          type: 'object',
          properties: {
            primary: { type: 'object' },
            linked: { type: 'array', items: { type: 'object' } }
          }
        }),
        404: errorResponse('Task not found for the active Owner.')
      }
    },
    patch: {
      summary: 'Complete, skip, reschedule, edit or assign a task',
      description:
        '`complete` may carry `minutes` (1 to 720), saved as a time row for the person closing; completing a task that is already closed changes nothing but still saves the time (`alreadyClosed: true, timeSaved: true`). `abort` refuses `minutes`. `assign` is owner only (403 `OWNER_ONLY` with `askOwner: true` for helpers, custom operators, inspectors and impersonation), only on an open task (409 `TASK_CLOSED`), and only to an active owner, helper or custom operator of this farm (400 `FOREIGN_REF`); `null` gives it to nobody. Assigning a primary also assigns its open prep and follow-up tasks. Not gated by the season close-out.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(taskPatchSchema),
      responses: {
        200: jsonResponse('The task after the change.', {
          type: 'object',
          properties: {
            task: { type: 'object' },
            alreadyClosed: { type: 'boolean' },
            timeSaved: { type: 'boolean' }
          }
        }),
        400: errorResponse('Invalid body, or `FOREIGN_REF` for an assignee.'),
        403: errorResponse('Inspector role is read-only, or `OWNER_ONLY` for assign.'),
        404: errorResponse('Task not found for the active Owner.'),
        409: errorResponse('`TASK_CLOSED`: only open tasks can be assigned.')
      }
    }
  },

  '/api/tasks/assignees': {
    get: {
      summary: 'Farm members a task can be given to',
      description:
        'Owner only. Active owners, helpers and custom operators of the active Owner, by display name (never a full email or phone number). Inspectors are never listed.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The members.', {
          type: 'object',
          required: ['assignees'],
          properties: {
            assignees: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'role'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  role: { type: 'string', enum: ['owner', 'helper', 'custom-operator'] }
                }
              }
            }
          }
        }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('`OWNER_ONLY`.')
      }
    }
  },

  '/api/plantings/{id}/hours': {
    parameters: [idPath('id', 'Planting (crop) id.')],
    get: {
      summary: 'Time logged on a planting, per person',
      description:
        'Owner only. Minutes logged on Done for this planting\'s tasks, in total and per person. Everyone else sees only the total, as "Time logged" on the Planting Card.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Totals.', {
          type: 'object',
          properties: {
            totalMinutes: { type: 'integer' },
            byPerson: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  minutes: { type: 'integer' }
                }
              }
            }
          }
        }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Owner role required.'),
        404: errorResponse('Planting not found for the active Owner.')
      }
    }
  },

  '/api/records/{kind}/{id}/card': {
    parameters: [
      {
        name: 'kind',
        in: 'path',
        required: true,
        description:
          'Record kind. `irrigation` is a watering log, which is not a compliance record.',
        schema: { type: 'string', enum: [...CARD_RECORD_KINDS] }
      },
      idPath('id', 'Record id.')
    ],
    get: {
      summary: 'The read-only Card for a record',
      description:
        'The printable Card a /records row expands into, built from tenant-scoped reads. Helpers can read it. Spray, insecticide and fungicide records give a read-only record card marked "Reference, not a clearance"; scout records give a `scout` card; harvest, hay, planting and fertility records give their Planting Card and decon records the Equipment Card. Another Owner\'s record, or a record with no card, is a 404.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The cards for the record.', {
          type: 'object',
          required: ['cards', 'origin', 'voidableUntilMs', 'canVoidHolds'],
          properties: {
            cards: { type: 'array', items: { type: 'object' } },
            origin: { type: ['string', 'null'] },
            voidableUntilMs: {
              type: ['integer', 'null'],
              description:
                'Spray, insecticide and fungicide records: until when the owner may void the entry (save time plus 48 hours); null for other kinds and for entries with no save time.'
            },
            canVoidHolds: {
              type: 'boolean',
              description:
                'Whether the viewer is the owner signed in on their own account (not a helper, an API token or an impersonating superadmin).'
            }
          }
        }),
        401: errorResponse('Authentication required.'),
        404: errorResponse('No such record for the active Owner.')
      }
    }
  },

  '/api/plantings/{id}/journal': {
    parameters: [idPath('id', 'Planting (crop) id.')],
    get: {
      summary: "A planting's journal",
      description: 'Newest first. Photos load separately from the entry photo endpoint.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('The journal entries.', {
          type: 'object',
          required: ['entries'],
          properties: { entries: { type: 'array', items: journalEntryRef } }
        }),
        401: errorResponse('Authentication required.'),
        404: errorResponse('Planting not found for the active Owner.')
      }
    },
    post: {
      summary: 'Add a note, observation or photo to the journal',
      description:
        'Owners and helpers can write; inspectors are read-only. Saved as `manual`. A photo is a JPEG data URL of 300 KB or less; its EXIF and other metadata are stripped on the server.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(journalEntrySchema),
      responses: journalWriteResponses
    }
  },

  '/api/plantings/{id}/journal/{entryId}': {
    parameters: [idPath('id', 'Planting (crop) id.'), idPath('entryId', 'Journal entry id.')],
    delete: {
      summary: 'Delete a journal entry',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Deleted.', {
          type: 'object',
          required: ['ok'],
          properties: { ok: { const: true } }
        }),
        ...OWNER_ERRORS,
        404: errorResponse('Planting or entry not found for the active Owner.')
      }
    }
  },

  '/api/plantings/{id}/journal/{entryId}/photo': {
    parameters: [idPath('id', 'Planting (crop) id.'), idPath('entryId', 'Journal entry id.')],
    get: {
      summary: "A journal entry's photo",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: {
          description: 'The photo.',
          content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } }
        },
        401: errorResponse('Authentication required.'),
        404: { description: 'No photo for this entry of the active Owner.' }
      }
    }
  },

  '/api/journal/record': {
    post: {
      summary: 'Replay a queued journal note or photo',
      description:
        "The offline queue's replay endpoint for journal notes and photos; the planting id travels in the body as `cropId`. Otherwise the same as `POST /api/plantings/{id}/journal`.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [clientRecordRef],
      requestBody: jsonBody(queuedJournalSchema),
      responses: journalWriteResponses
    }
  },

  '/api/plantings/{id}/photo-help': {
    parameters: [idPath('id', 'Planting (crop) id.')],
    post: {
      summary: 'Ask about a photo of a planting',
      description:
        "A short answer from Claude when AI is on (through `aiTry()` and `aiGuard` under the `photo-help` daily quota), otherwise the matching Care Guide section tagged `fallback`. Never spray advice: a question that asks for it is sent to the Spray flow and the label without calling Claude, and any sentence naming a pesticide, spray, mix rate, REI or PHI is removed. The ask and its answer are saved to the planting journal either way. `question: 'other'` needs `text`.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(photoHelpSchema),
      responses: {
        200: jsonResponse('The answer and the saved journal entry.', {
          type: 'object',
          required: ['provenance', 'fallbackReason', 'message', 'answer', 'entry'],
          properties: {
            provenance: { type: 'string', enum: ['ai', 'fallback'] },
            fallbackReason: {
              type: ['string', 'null'],
              description: 'Why the Care Guide answered instead of Claude.'
            },
            message: { type: ['string', 'null'] },
            answer: { type: 'object' },
            entry: journalEntryRef
          }
        }),
        400: errorResponse('Invalid body, an empty free-text question or an unreadable photo.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Inspector role is read-only.'),
        404: errorResponse('Planting not found for the active Owner.')
      }
    }
  },

  '/api/geocode': {
    get: {
      summary: 'Look up an address',
      description:
        'Signed-in only. Asks the US Census geocoder for up to 5 matches. Limited to 20 lookups a minute per user.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'q',
          in: 'query',
          required: true,
          description: 'The address, 3 to 200 characters.',
          schema: { type: 'string', minLength: 3, maxLength: 200 }
        }
      ],
      responses: {
        200: jsonResponse('Matches, best first. Empty when nothing matched or the lookup failed.', {
          type: 'object',
          required: ['matches'],
          properties: {
            matches: {
              type: 'array',
              maxItems: 5,
              items: {
                type: 'object',
                required: ['label', 'lat', 'lon'],
                properties: {
                  label: { type: 'string' },
                  lat: { type: 'number' },
                  lon: { type: 'number' }
                }
              }
            }
          }
        }),
        400: errorResponse('`q` is missing, too short or too long.'),
        401: errorResponse('Authentication required.'),
        429: errorResponse('Too many lookups; try again in a minute.')
      }
    }
  },

  '/api/me/hints': {
    get: {
      summary: 'First-use hints the signed-in user has dismissed',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Dismissed hint keys.', {
          type: 'object',
          required: ['hints'],
          properties: { hints: { type: 'array', items: { type: 'string' } } }
        }),
        401: errorResponse('Authentication required.')
      }
    },
    post: {
      summary: 'Mark hints seen',
      description:
        'One `key`, or a batch of up to 50 `keys` (the client flushes offline dismissals this way). Answers with the full dismissed list.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(hintsPostSchema),
      responses: {
        200: jsonResponse('Dismissed hint keys.', {
          type: 'object',
          required: ['hints'],
          properties: { hints: { type: 'array', items: { type: 'string' } } }
        }),
        400: errorResponse('Invalid body.'),
        401: errorResponse('Authentication required.'),
        409: errorResponse('Too many hints recorded for this user.')
      }
    }
  },
  '/api/weather/degree-days': {
    get: {
      summary: 'Degree days for the farm pest models',
      description:
        'Any member of the farm. For each degree-day pest model (or the one named by `model`): the weather station (nearest NOAA GHCN-Daily `USW` station within 30 miles), method, base and upper cutoff, the biofix with its provenance (`plugin` for January 1, `fallback` for the model date, `manual` for a recorded trap catch), the running total, the days missing and the last day counted, and the stage. Gaps are never filled, so a total with missing days is a lower bound. No location or no station within 30 miles answers 200 with `location` and a plain `message`. Advice is about scouting, trapping or covering only.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'model',
          in: 'query',
          required: false,
          description: 'One pest model id. An unknown id answers 404.',
          schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' }
        },
        {
          name: 'year',
          in: 'query',
          required: false,
          description: 'Calendar year; defaults to this year. A future year answers 400.',
          schema: { type: 'integer', minimum: 2000, maximum: 2100 }
        }
      ],
      responses: {
        200: jsonResponse('Degree days per model.', {
          type: 'object',
          required: ['year', 'location', 'message', 'station', 'models'],
          properties: {
            year: { type: 'integer' },
            location: { type: 'string', enum: ['ok', 'no-location', 'no-station'] },
            message: { type: ['string', 'null'] },
            station: { type: ['object', 'null'] },
            dataError: { type: ['string', 'null'] },
            models: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse('Invalid query or a future year.'),
        401: errorResponse('Authentication required.'),
        404: errorResponse('Pest model not found.')
      }
    }
  },

  '/api/pest-models/{id}/biofix': {
    parameters: [idPath('id', 'Pest model id.')],
    put: {
      summary: 'Record or clear the first trap catch',
      description:
        'Owners and helpers; inspectors are read-only. Sets the biofix of a trap-catch pest model for a year to the date of the first catch (`manual`), or clears it with `date: null` so the model date applies again. Models that count from a fixed date answer 400 `BIOFIX_NOT_TRAP`; a date after today answers 400 `IN_THE_FUTURE`. Never gated by a closed season.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(biofixPutSchema),
      responses: {
        200: jsonResponse('Saved or cleared.', {
          type: 'object',
          required: ['biofix'],
          properties: { biofix: { type: ['object', 'null'] } }
        }),
        400: errorResponse('Invalid body, `BIOFIX_NOT_TRAP` or `IN_THE_FUTURE`.'),
        ...AUTH_ERRORS,
        404: errorResponse('Pest model not found.')
      }
    }
  },

  '/api/finance/entries': {
    get: {
      summary: 'List money entries for a season',
      description:
        "Owner only (helpers, custom operators and inspectors get 403). The season is the calendar year in the farm's time zone. `state=deleted` lists soft-deleted entries. Each entry carries `linkedTo`, `enterpriseLabel` and `enteredBy` names.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [
        { name: 'year', in: 'query', required: false, schema: { type: 'integer' } },
        {
          name: 'state',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['live', 'deleted'] }
        }
      ],
      responses: {
        200: jsonResponse('Entries, newest first.', {
          type: 'object',
          required: ['year', 'entries'],
          properties: {
            year: { type: 'integer' },
            entries: { type: 'array', items: { type: 'object' } }
          }
        }),
        400: errorResponse('Bad year or state.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Money is only shown to the farm owner.')
      }
    },
    post: {
      summary: 'Add an expense or income',
      description:
        'Owner only; impersonation may not write. Link at most one of crop, Area (with an optional bed inside it), animal or group; `stockLotId` only on an expense and `harvestEventId` only on income. A lot may have one live purchase expense (409 `LOT_ALREADY_EXPENSED`). The date may be at most a day ahead. Never gated by the season close-out. Writes an audit row in the same transaction.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(ledgerEntryCreateSchema),
      responses: {
        201: jsonResponse('Saved.', {
          type: 'object',
          required: ['entry'],
          properties: { entry: { type: 'object' } }
        }),
        400: errorResponse(
          "Invalid body, another Owner's id, a bed outside its Area, or a date more than a day ahead."
        ),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Not the owner, or impersonating.'),
        409: errorResponse(
          '`LOT_ALREADY_EXPENSED`: that stock lot already has a live purchase expense.'
        )
      }
    }
  },

  '/api/finance/entries/{id}': {
    parameters: [idPath('id', 'Money entry id.')],
    get: {
      summary: 'Read a money entry and its history',
      description: 'Owner only. `changes` lists every create, update, delete and restore.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Entry and history.', {
          type: 'object',
          required: ['entry', 'changes'],
          properties: {
            entry: { type: 'object' },
            changes: { type: 'array', items: { type: 'object' } }
          }
        }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Money is only shown to the farm owner.'),
        404: errorResponse('No such entry for the active Owner.')
      }
    },
    patch: {
      summary: 'Change a money entry',
      description:
        'Owner only. No lock. The patch is merged over the stored entry and checked with the same rules as a new one.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(ledgerEntryPatchSchema),
      responses: {
        200: jsonResponse('Saved.', { type: 'object', properties: { entry: { type: 'object' } } }),
        400: errorResponse('Invalid change.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Not the owner, or impersonating.'),
        404: errorResponse('No such entry for the active Owner.'),
        409: errorResponse('`LOT_ALREADY_EXPENSED`.')
      }
    },
    delete: {
      summary: 'Delete a money entry',
      description:
        'Owner only. A soft delete: the entry leaves the totals, the Profit Card and the CSV, and can be restored.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Deleted.', {
          type: 'object',
          properties: { entry: { type: 'object' } }
        }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Not the owner, or impersonating.'),
        404: errorResponse('No such entry for the active Owner.')
      }
    }
  },

  '/api/finance/entries/{id}/restore': {
    parameters: [idPath('id', 'Money entry id.')],
    post: {
      summary: 'Restore a deleted money entry',
      description: 'Owner only.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      responses: {
        200: jsonResponse('Restored.', {
          type: 'object',
          properties: { entry: { type: 'object' } }
        }),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Not the owner, or impersonating.'),
        404: errorResponse('No such entry for the active Owner.'),
        409: errorResponse('`LOT_ALREADY_EXPENSED`: another live expense already names that lot.')
      }
    }
  },

  '/api/finance/summary': {
    get: {
      summary: 'Season profit by enterprise',
      description:
        'Owner only. `cash` sums the live entries. Each enterprise (a crop, animal group, animal, tag or Area) adds derived input cost from stock use times lot cost, with uses of unknown cost counted, never priced at zero, and labour from logged minutes times the owner rate. Derived cost and labour are never part of `cash`; a lot purchase is counted in `lotPurchaseCents` and never again as an enterprise cost.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [{ name: 'year', in: 'query', required: false, schema: { type: 'integer' } }],
      responses: {
        200: jsonResponse('Season profit.', {
          type: 'object',
          required: ['year', 'profit'],
          properties: { year: { type: 'integer' }, profit: { type: 'object' } }
        }),
        400: errorResponse('Bad year.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Money is only shown to the farm owner.')
      }
    }
  },

  '/api/finance/export.csv': {
    get: {
      summary: 'Download the season ledger as CSV',
      description:
        'Owner only. Live entries with columns date, kind, category, amount, description, linked to, enterprise, quantity, unit, entered by. Cells that start with =, +, -, or @ get a leading quote.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      parameters: [{ name: 'year', in: 'query', required: false, schema: { type: 'integer' } }],
      responses: {
        200: { description: 'CSV file.', content: { 'text/csv': { schema: { type: 'string' } } } },
        400: errorResponse('Bad year.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Money is only shown to the farm owner.')
      }
    }
  },

  '/api/finance/labour-rate': {
    put: {
      summary: 'Set the labour rate',
      description: 'Owner only. One rate for everyone, in cents an hour; null clears it.',
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(labourRateSchema),
      responses: {
        200: jsonResponse('Saved.', {
          type: 'object',
          properties: { centsPerHour: { type: ['integer', 'null'] } }
        }),
        400: errorResponse('Invalid rate.'),
        401: errorResponse('Authentication required.'),
        403: errorResponse('Not the owner, or impersonating.')
      }
    }
  }
};

// ─── Document composition ──────────────────────────────────────────────

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'CropCard External Agent API',
    version: '0.1.0',
    description:
      'Owner-scoped JSON API for external Claude agents and SaaS integrations (Phase 24, UC-43). Bearer tokens minted at `/settings/api-tokens`. Safety kernel re-runs on every state-changing call — agents cannot bypass tenant isolation, the 48h spray lock, helper custom-rate restrictions, or kernel violations regardless of which endpoint they hit.\n\nCoverage is incremental: Phase 24 shipped auth, health, spray/record and blocks; Phase 30 adds Areas, blocks and garden beds, the garden designer, offline Cards, geocoding, first-use hints, the offline-safe record endpoints, map lines and points, task closing, record cards and the planting journal with photo help; Phase 32B adds animals, groups, moves and status changes. Additional endpoints adopt the OpenAPI registry in domain batches — track open work in [docs/phase-24-agent-api.md](https://github.com/mrpeanut01/crop-card/blob/main/docs/phase-24-agent-api.md).',
    contact: { name: 'CropCard' }
  },
  servers: [
    {
      url: '/',
      description:
        'Relative to wherever CropCard is hosted. The same path works against `localhost:5173` in dev and the deployed Azure Container App in prod.'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'cck_<base64url-32-bytes>',
        description:
          'Owner-scoped Bearer token. Mint at `/settings/api-tokens`. CSRF Origin check is bypassed for `/api/**` Bearer requests; cookie sessions still enforce same-origin.'
      },
      cookieSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'cropcard.session',
        description:
          'HMAC-signed session cookie set by `/signin`. Cookie mutations under `/api/**` require matching Origin.'
      }
    },
    parameters: {
      ClientRecordId: CLIENT_RECORD_PARAMETER
    },
    schemas: {
      Error: ERROR_SCHEMA,
      GardenError: GARDEN_ERROR_SCHEMA,
      PlacedPlanting: PLACED_PLANTING_SCHEMA,
      JournalEntry: JOURNAL_ENTRY_SCHEMA,
      TokenSummary: TOKEN_SUMMARY_SCHEMA,
      DocumentMeta: fromZod(documentMetaSchema)
    }
  },
  // Default security: Bearer OR cookie. Endpoints that override security
  // (e.g., `security: []` for public endpoints) win locally.
  security: [{ cookieSession: [] }, { bearerAuth: [] }],
  paths
};

writeFileSync(OUT_PATH, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${OUT_PATH} (${Object.keys(paths).length} paths)`);
