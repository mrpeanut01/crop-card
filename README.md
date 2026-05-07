# CropCard

Offline-first PWA replacing the paper Field Card for small-plot row crop herbicide planning, planting, and harvest tracking.

Spec: [Farm Management Web App — Final Requirements Specification](./docs/spec.md) (verbatim attachment from initial brief).

## What's here

| Path | Purpose |
|------|---------|
| `apps/web/` | SvelteKit + TypeScript application — PWA shell, server endpoints, sync, plugin manager |
| `apps/web/src/lib/safety/` | **Hard-locked safety kernel** — the only path through which a spray operation can be initiated. Plugins cannot override these rules |
| `plugins/` | Data-only crop / herbicide / insecticide / companion JSON files — extensible without code changes |
| `schemas/` | Public JSON Schemas for plugin authors |
| `infra/` | Dockerfile, compose, Litestream config, Bicep |
| `.devcontainer/` | VS Code dev container attached to compose `web` service |
| `.github/workflows/` | CI (typecheck, lint, vitest, playwright) + deploy (build → ghcr → ACA) |

## Quickstart (local dev)

```sh
cp .env.example .env
cp infra/.env.dev.example infra/.env.dev
# Open infra/.env.dev and replace PASTE_AZURITE_WELL_KNOWN_KEY_FROM_MICROSOFT_DOCS
# with the literal value documented at:
#   https://learn.microsoft.com/azure/storage/common/storage-use-azurite
# (It's the same constant for every Azurite installation — kept out of git
#  to avoid GitHub's secret-scanning false positive on the format.)

docker compose -f infra/docker-compose.yml up
# → http://localhost:5173
```

VS Code: open the repo root and choose **Reopen in Container** when prompted.

## Architecture

- **Runtime**: Azure Container Apps (consumption tier, scale-to-zero)
- **Database**: SQLite + Litestream → Azure Blob Storage (single-writer, ~$1/mo)
- **Auth**: Auth.js magic-link with `owner` / `helper` roles
- **PWA**: vite-plugin-pwa (Workbox) precaching plugin JSON, dilution tables, shell
- **Client storage**: Dexie.js → IndexedDB (offline-first per NFR-02)

See [implementation plan](https://github.com/anthropics/...) for full rationale.

## Hard locks

The safety kernel — `apps/web/src/lib/safety/` — enforces these rules **in compiled code**, never in plugin JSON:

1. Active-ingredient incompatibility (synthetic-auxin / chloroacetamide / HPPD-inhibitor / ACCase-inhibitor / glyphosate / sulfonylurea)
2. Crop-stage gates (e.g., 2,4-D blocked over corn > 8 inches)
3. Tank-mix prohibitions (Stadia + Clethodim never co-tanked, 7-day separation)
4. Sprayer cross-contamination gate — UI routes to decon wizard, not dilution table
5. Pre-spray environmental gates (wind, temp, rain forecast)
6. Plugin-bypass prevention at registration

A plugin claiming a herbicide is "safe for pumpkins" when its declared active ingredient is `synthetic-auxin` is rejected at registration with a specific error.

## Constraints

- **Single replica** — `minReplicas: 0, maxReplicas: 1`, `revisionMode: 'single'` in `infra/azure/main.bicep`. SQLite is single-writer; do not loosen this without first migrating off SQLite.
- **Plugins are data-only** — no executable code permitted. Enforced by JSON-only file format and Zod validation at registration.
- **Safety rules cannot be overridden by plugins** — encoded as TypeScript in `apps/web/src/lib/safety/`.

## License

Private. Not for external distribution at this time.
