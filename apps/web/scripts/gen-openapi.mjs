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
  setPlacementPatchSchema,
  successionRequestSchema
} from '../src/lib/garden/api.ts';
import { hintsPostSchema } from '../src/lib/hints.ts';
import { emergencyContactSchema } from '../src/lib/farm/emergencyContacts.ts';
import { CLIENT_RECORD_HEADER } from '../src/lib/clientRecordHeader.ts';

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

function recordEndpoint({ summary, description, source, created = false }) {
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
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: `Exact shape is enforced inline in ${source} via Zod.`
            }
          }
        }
      },
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

  '/api/spray/record': {
    post: {
      ...recordEndpoint({
        summary: 'Record a spray event (safety-kernel re-validated)',
        description:
          'Every POST re-runs `evaluateSpray()` on the server regardless of UI. A Bearer-authed agent cannot bypass the safety kernel, the 48h spray lock, the helper custom-rate restriction, or tenant isolation. Returns 422 with kernel violations on safety failure.',
        source: 'apps/web/src/routes/api/spray/record/+server.ts'
      }).post,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description:
                'Spray-event payload. Exact shape is enforced inline in apps/web/src/routes/api/spray/record/+server.ts via Zod.',
              properties: {
                blockId: { type: 'string' },
                products: { type: 'array', items: { type: 'object' } },
                occurredAt: { type: 'integer', description: 'Unix epoch ms.' }
              }
            }
          }
        }
      }
    }
  },

  '/api/insecticide/record': recordEndpoint({
    summary: 'Record an insecticide application',
    description:
      'Runs the IPM threshold, pollinator-protection, cross-contamination and environment gates on the server before saving. Safe to replay from the offline queue with the client record id header.',
    source: 'apps/web/src/routes/api/insecticide/record/+server.ts'
  }),

  '/api/fungicide/record': recordEndpoint({
    summary: 'Record a fungicide application',
    description:
      'Runs the FRAC rotation, tank-mix, bloom and cross-contamination gates on the server before saving. Safe to replay from the offline queue with the client record id header.',
    source: 'apps/web/src/routes/api/fungicide/record/+server.ts'
  }),

  '/api/harvest/record': recordEndpoint({
    summary: 'Record a harvest',
    description:
      'Checks stored moisture against the crop archetype and the pre-harvest interval of recent sprays. Safe to replay from the offline queue with the client record id header.',
    source: 'apps/web/src/routes/api/harvest/record/+server.ts'
  }),

  '/api/scout/record': recordEndpoint({
    summary: 'Record a scouting observation',
    description:
      'Saves one observation against a block (and optionally a planting). Safe to replay from the offline queue with the client record id header.',
    source: 'apps/web/src/routes/api/scout/record/+server.ts',
    created: true
  }),

  '/api/hay/cuttings': recordEndpoint({
    summary: 'Record a hay cutting',
    description:
      'Re-runs the mow decision against the forecast before saving; a bale moisture danger stop cannot be overridden. Safe to replay from the offline queue with the client record id header.',
    source: 'apps/web/src/routes/api/hay/cuttings/+server.ts',
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
      summary: 'Place a planting in a garden bed',
      description:
        "Only the `set-placement` action is described here; the route's other actions (`mark-harvested`, `archive`, `mark-failed`, `reactivate`, `set-schedule`, `edit-details`, `unschedule`, `split`) are not yet published. Owner only. Places, moves or clears a planting's spot (`footprint: null`) and moves its date when `plantingDateMs` is sent. A planting already in the ground can't change beds and its date can't move past today (409 `IN_GROUND`). A linked succession sowing needs a spot that is free for its whole time in the bed (409 `OVERLAP`), and a spot past the bed edge is refused with `OUTSIDE_AREA`.",
      security: [{ cookieSession: [] }, { bearerAuth: [] }],
      requestBody: jsonBody(setPlacementPatchSchema),
      responses: {
        200: jsonResponse('Saved.', {
          type: 'object',
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
        }),
        400: jsonResponse(
          'Invalid request body, a spot past the bed edge (`OUTSIDE_AREA`) or an unknown bed (`FOREIGN_REF`).',
          gardenErrorRef
        ),
        401: errorResponse('Authentication required.'),
        403: jsonResponse('Owner role required (`READ_ONLY`).', gardenErrorRef),
        404: jsonResponse('Planting not found for the active Owner.', gardenErrorRef),
        409: jsonResponse(
          'Already in the ground (`IN_GROUND`), the spot is taken for a linked sowing (`OVERLAP`) or the block is not a sized bed in a garden (`NOT_DESIGNABLE`).',
          gardenErrorRef
        )
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
  }
};

// ─── Document composition ──────────────────────────────────────────────

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'CropCard External Agent API',
    version: '0.1.0',
    description:
      'Owner-scoped JSON API for external Claude agents and SaaS integrations (Phase 24, UC-43). Bearer tokens minted at `/settings/api-tokens`. Safety kernel re-runs on every state-changing call — agents cannot bypass tenant isolation, the 48h spray lock, helper custom-rate restrictions, or kernel violations regardless of which endpoint they hit.\n\nCoverage is incremental: Phase 24 shipped auth, health, spray/record and blocks; Phase 30 adds Areas, blocks and garden beds, the garden designer, offline Cards, geocoding, first-use hints and the offline-safe record endpoints. Additional endpoints adopt the OpenAPI registry in domain batches — track open work in [docs/phase-24-agent-api.md](https://github.com/mrpeanut01/crop-card/blob/main/docs/phase-24-agent-api.md).',
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
      TokenSummary: TOKEN_SUMMARY_SCHEMA
    }
  },
  // Default security: Bearer OR cookie. Endpoints that override security
  // (e.g., `security: []` for public endpoints) win locally.
  security: [{ cookieSession: [] }, { bearerAuth: [] }],
  paths
};

writeFileSync(OUT_PATH, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${OUT_PATH} (${Object.keys(paths).length} paths)`);
