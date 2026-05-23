# CropCard Plugin Specification

**Version:** 1.1
**Audience:** external authoring tools, AI agents emitting plugin JSON, integrators building bulk-import pipelines.
**Authoritative schemas:** [/schemas/](../schemas/) (JSON Schema, draft 2020-12). Regenerated from [`apps/web/src/lib/plugins/schemas.ts`](../apps/web/src/lib/plugins/schemas.ts) via `pnpm gen:schemas`.

---

## 1. What plugins are

A **plugin** is a JSON document that extends CropCard's domain knowledge — crop varieties, herbicide chemistries, companion systems, etc. — without touching application code. Plugins are **data-only**: any executable JavaScript in a plugin file is rejected at registration.

There are **six kinds**, distinguished by the top-level `type` field:

| Kind | Adds to the system |
|---|---|
| `crop` | A specific cultivar/variety. Drives planting, scheduling, harvest, safety checks. |
| `herbicide` | A weed-control product. Adds chemistry, rate, application timing, label-safe claims. |
| `insecticide` | A pest-control product. Adds IRAC group, REI/PHI, target pests, scouting thresholds. |
| `fungicide` | A disease-control product. Adds FRAC code, application timing, target diseases. |
| `fertilizer` | A nutrient product. Adds N-P-K analysis, form, compliance flags. |
| `companion` | A polyculture system or pairwise affinity (e.g. Three Sisters). |

The shapes share a small base (`pluginId`, `displayName`, `version`, `type`, `pluginSchemaVersion`) and then diverge by kind. See §4 for the per-kind shapes.

---

## 2. Import workflow

Three ways to get a plugin into CropCard, ranked by recommended use:

1. **HTTP upload** (the supported integration path)
   `POST /api/plugins/upload` with a JSON body of the plugin payload, owner-authenticated. Server validates → runs the bypass check → appends a `plugin_versions` row → writes the canonical JSON file under `plugins/<kind>s/<pluginId>.json` → returns `{ pluginId, version, hash, noChange, bumped, diff, priorVersion }`.

2. **Filesystem drop** (build-time / repo PR path)
   Drop a JSON file under `plugins/<kind>s/<pluginId>.json` in the source tree. The registry loads it at process startup; the migration runner seeds a `plugin_versions` row on first boot.

3. **AI label / receipt / web-search ingestion** (in-app authoring)
   `/plugins` page hosts label-scan, web-name-search, and (planned) receipt-scan flows that produce candidate plugins. Same validation pipeline applies; an external tool can call the same endpoints if it has the cropping image / query.

**For external integrators**, path 1 is the contract. Path 2 is for in-tree contributions.

---

## 3. Validation pipeline

Every uploaded plugin runs through three gates, in order. Failing any gate returns `400 Bad Request` with an `issues[]` array.

### 3.1 Zod schema validation

The candidate must parse against the discriminated union in [`schemas.ts`](../apps/web/src/lib/plugins/schemas.ts). Unknown top-level fields are preserved (not stripped) so future tooling can carry forward optional data. Field types, ranges, regex patterns, enum values must match.

**Error code:** `schema`. Issues array carries `{ path, message }` per Zod issue.

### 3.2 Cross-field rules

Some constraints don't fit Zod's discriminated-union shape. Examples:

- `cornType` only valid when `cropFamily === 'corn'`
- `anchor: 'stage'` requires a `stageCode`
- `offsetDaysMin <= offsetDaysMax` on spray windows

**Error code:** `schema`. Same `{ path, message }` shape.

### 3.3 Safety-kernel bypass check

Plugin authors cannot override the hard-locked safety rules. The bypass check (`apps/web/src/lib/plugins/bypassCheck.ts`) enforces:

- A herbicide's `labelClaims.safeForCropPluginIds[]` cannot claim safety on a crop family the herbicide's chemistry kills (e.g. you cannot claim glyphosate is safe on corn — the kill matrix in [`cropFamilyLethality.ts`](../apps/web/src/lib/safety/cropFamilyLethality.ts) takes precedence).
- A few hardcoded bans (e.g. `pumpkin + synthetic-auxin`) are rejected even when no crop plugin defines `pumpkin`.
- Trait-gated claims (`traitGatedSafeFor[]`) are accepted only when the named crop plugin actually carries every listed trait — see §6.

**Error code:** `bypass`. Issues carry the offending pluginId/chemistry/reason.

### 3.4 Validate locally before upload

You can run the JSON Schema validators against [/schemas/<kind>.schema.json](../schemas/) with any standard JSON Schema library (ajv, jsonschema, etc.). The bypass check is server-only; expect it to fire on upload even when the local schema validates.

---

## 4. Common fields (all kinds)

```jsonc
{
  // Required on every kind.
  "pluginId": "corn-bantam-sweet",     // kebab-case, /^[a-z0-9][a-z0-9-]{0,63}$/
  "displayName": "Bantam Sweet Corn",  // 1-120 chars, human-readable
  "type": "crop",                       // discriminator: crop|herbicide|insecticide|fungicide|fertilizer|companion
  "version": "1.0.0",                   // semver. Server auto-bumps the patch on every payload change.
  "pluginSchemaVersion": "1.1"          // optional. '1.0' or '1.1'. Authors emitting v1.1 fields set this.
}
```

**`pluginId` rules**

- Lowercase ASCII letters, digits, hyphens. Must start with a letter or digit. Max 64 chars.
- Globally unique across **all** kinds. Two plugins cannot share an id even if they're different kinds.
- Stable across re-uploads — re-uploading the same `pluginId` updates the existing plugin (creates a new `plugin_versions` row, supersedes the prior one).

**`version` semantics**

- Three-segment semver (`MAJOR.MINOR.PATCH`).
- On upload, the server compares against the current `plugin_versions` row:
  - If the candidate's payload (ignoring the version field) is byte-identical to the current row → no-op, returns `noChange: true`.
  - If the candidate's `version` is **not strictly greater** than the current version → server auto-bumps the patch (`1.0.0 → 1.0.1`) and writes that. Response sets `bumped: true`.
  - If the candidate's `version` is strictly greater → used as-is.
- New plugins should ship with `"1.0.0"`.

**`pluginSchemaVersion`**

- Tracks the spec version the plugin targets. Currently `"1.0"` (legacy) or `"1.1"` (current).
- v1.1 introduces `complianceFlags` on input plugins and `purpose` / `*Gate` tags on crop spray windows. Both are optional + additive — v1.0 plugins remain valid forever.
- Set `"1.1"` whenever you populate any v1.1 field.

---

## 5. Per-kind specifications

### 5.1 Crop

[/schemas/crop.schema.json](../schemas/crop.schema.json)

Minimum viable crop plugin:

```jsonc
{
  "pluginId": "corn-bantam-sweet",
  "type": "crop",
  "displayName": "Bantam Sweet Corn",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "cropFamily": "corn"
}
```

**Required:** `pluginId`, `type`, `displayName`, `version`, `cropFamily`.

**`cropFamily`** is an enum drawn from [`apps/web/src/lib/safety/cropFamilyLethality.ts`](../apps/web/src/lib/safety/cropFamilyLethality.ts). Current values: `corn`, `cucurbit`, `solanaceae`, `brassica`, `allium`, `leafy-green`, `legume`, `root`, `small-fruit`, `cane-fruit`, `orchard`, `stone-fruit`, `vine-fruit`, `apiaceae`, `cereal-grain`, `forage`, `cover-crop`, `culinary-herb`, `broadleaf-companion`.

**Common optional fields:**

```jsonc
{
  "daysToMaturity": { "min": 70, "max": 80 },
  "defaultRowSpacingInches": 36,
  "preHarvestIntervalDays": 7,
  "harvestIndicators": ["Husks fully dry", "Black layer at kernel tip"],
  "traits": ["glyphosate-tolerant-rr2", "dicamba-tolerant-xtend"],
  "notes": "Open-pollinated heirloom. Best for fresh eating.",
  "plantingGuide": {
    "soilTempMinF": 60,
    "rowSpacingIn": 36
  },
  "postHarvestCuring": {
    "method": "air-dry",
    "durationWeeks": 2,
    "targetMoisturePercent": 14,
    "storageLocation": "barn loft"
  },
  "agronomy": {
    "lifecycle": "annual",
    "rotationLookbackYears": 1,
    "emergenceWindowDays": 7
  },
  "cornType": "sweet",                  // only valid if cropFamily === 'corn'
  "preTasks": [
    {
      "key": "test-germination",
      "title": "Test germination",
      "category": "scout",
      "daysBeforePlant": 14,
      "body": "Pull 100 kernels from stored seed, paper-towel germ test."
    }
  ],
  "postTasks": [...],
  "seasonalTasks": [...],
  "sprayWindows": [
    {
      "chemistryClass": "accase-inhibitor",
      "anchor": "planting",
      "offsetDaysMin": 30,
      "offsetDaysMax": 60,
      "title": "POST grass window (clethodim)",
      "purpose": "post-emergent",       // v1.1
      "weedStrategyGate": "post-emergence-ok"  // v1.1
    }
  ]
}
```

See the JSON Schema for the full optional surface, including `growthStageTable`, `orchardSeasonalTasks`, `harvestTargets`, `crossesWith`, etc.

### 5.2 Herbicide

[/schemas/herbicide.schema.json](../schemas/herbicide.schema.json)

Minimum viable:

```jsonc
{
  "pluginId": "pin-dee-3-3-ec",
  "type": "herbicide",
  "displayName": "Pin-Dee 3.3 EC (Pendimethalin)",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "activeIngredients": [
    { "name": "pendimethalin", "chemistryClass": "microtubule-inhibitor" }
  ],
  "ratePerAcre": { "amount": 2.4, "unit": "qt" }
}
```

**Required:** base fields + `activeIngredients[]` (≥1) + `ratePerAcre`.

**`chemistryClass`** drives the kill matrix. Valid values (HRAC-aligned, see [`safety/types.ts`](../apps/web/src/lib/safety/types.ts)):
`synthetic-auxin`, `chloroacetamide`, `hppd-inhibitor`, `accase-inhibitor`, `glyphosate`, `sulfonylurea`, `microtubule-inhibitor`, `photosystem-ii-triazine`, `photosystem-i-diquat`, `glufosinate`, `ppo-inhibitor`, `als-imidazolinone`, `vlcfa-pyroxasulfone`, `clomazone`.

**`ratePerAcre.unit`** is one of `oz | fl-oz | lb | pt | qt`.

**Common optional fields:**

```jsonc
{
  "gpaCalibration": 15,
  "applicationTiming": "PRE",           // BURNDOWN | PRE | POST | POST-DIRECTED
  "requiresAMS": false,
  "deconRequired": false,
  "epaRegistrationNumber": "1381-194",
  "labelClaims": {
    "safeForCropPluginIds": ["corn-bantam-sweet"]
  },
  "traitGatedSafeFor": [
    {
      "cropPluginId": "soybean-asgrow-roundup-ready-2-xtend",
      "requiresTraits": ["dicamba-tolerant-xtend"]
    }
  ],
  "complianceFlags": {
    "omriListed": false,
    "nonGmoCompliant": true,
    "certifiedOrganicAllowed": false,
    "transitioningAllowed": false
  },
  "notes": "..."
}
```

**Bypass-check rules** (see §3.3):

- `labelClaims.safeForCropPluginIds` is **rejected** if the chemistry's HRAC group is on the kill matrix for the referenced crop's family. The kill matrix is non-negotiable.
- `traitGatedSafeFor` is **accepted** only when the referenced crop plugin already carries every trait in `requiresTraits[]`. The bypass check looks up the live registry — order matters when uploading both plugins.

### 5.3 Insecticide

[/schemas/insecticide.schema.json](../schemas/insecticide.schema.json)

```jsonc
{
  "pluginId": "beleaf-50sg",
  "type": "insecticide",
  "displayName": "Beleaf 50SG (FMC Flonicamid)",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "activeIngredients": [
    { "name": "flonicamid", "iracGroup": "29" }
  ],
  "reEntryIntervalHours": 12
}
```

**Required:** base + `activeIngredients[]` (≥1) + `reEntryIntervalHours`.

**`iracGroup`** is an IRAC mode-of-action code: a 1-4 character alphanumeric string (e.g. `1A`, `4A`, `11A`, `29`). Drives resistance-rotation hints in the spray flow.

**Common optional fields:** `ratePerAcre`, `preHarvestIntervalDays`, `pollinatorRisk` (`none | low | moderate | high`), `targetPests[]`, `scoutingThresholds[]`, `applicationProtocol[]`, `epaRegistrationNumber`, `labelClaims.safeForCropPluginIds[]`, `complianceFlags`, `notes`.

### 5.4 Fungicide

[/schemas/fungicide.schema.json](../schemas/fungicide.schema.json)

```jsonc
{
  "pluginId": "kocide-3000-o",
  "type": "fungicide",
  "displayName": "Kocide 3000-O (copper hydroxide)",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "activeIngredients": [
    { "name": "copper hydroxide", "fracCode": "M01" }
  ],
  "ratePerAcre": { "amount": 1.75, "unit": "lb" },
  "reEntryIntervalHours": 48,
  "preHarvestIntervalDays": 1
}
```

**Required:** base + `activeIngredients[]` (≥1) + `ratePerAcre` + `reEntryIntervalHours` + `preHarvestIntervalDays`.

**`fracCode`** matches `/^(M\d{2}|P\d{2}|U\d{2}|BM\d{2}|\d{1,3})$/` — e.g. `M01` (copper), `P01` (host defense), `11` (strobilurins), `7` (SDHIs), `BM01` (biologicals). Drives resistance-rotation hints. **Required** on every fungicide ingredient (unlike IRAC on insecticides, which is optional).

**Common optional:** `applicationTiming` (`DORMANT | PRE-BLOOM | BLOOM | POST-BLOOM | COVER | PRE-HARVEST`), `pollinatorRisk`, `deconRequired`, `targetDiseases[]`, `labelClaims`, `complianceFlags`, `notes`.

### 5.5 Fertilizer

[/schemas/fertilizer.schema.json](../schemas/fertilizer.schema.json)

```jsonc
{
  "pluginId": "feather-meal-12-0-0",
  "type": "fertilizer",
  "displayName": "Feather Meal 12-0-0",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "analysis": { "n": 12, "p": 0, "k": 0 },
  "form": "meal",
  "organic": true
}
```

**Required:** base + `analysis` + `form`.

**`analysis`** carries the guaranteed-analysis N-P-K percentages by weight. `p` is reported as P₂O₅ and `k` as K₂O, per US labeling convention.

**`form`** enum: `granular | liquid | soluble | compost | slow-release | meal`.

**Common optional:** `organic` (boolean, default false), `secondaryNutrients` (Ca, Mg, S, B, Zn, Mn, Cu, Fe), `applicationRange { min, max, unit }`, `complianceFlags`, `notes`.

### 5.6 Companion

[/schemas/companion.schema.json](../schemas/companion.schema.json)

```jsonc
{
  "pluginId": "three-sisters",
  "type": "companion",
  "displayName": "Three Sisters (Corn/Beans/Squash)",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "primaryFamily": "corn",
  "goodWith": ["corn-bantam-sweet", "pole-bean-kentucky-wonder"],
  "badWith": [],
  "benefit": "Beans fix nitrogen; squash vines suppress weeds.",
  "members": [
    {
      "family": "legume",
      "role": "trellis + n-fixer",
      "plantingOffsetDays": 14,
      "title": "Three Sisters: plant beans (corn at ~6 in)",
      "body": "Plant pole beans 6 in from each cornstalk."
    },
    {
      "family": "cucurbit",
      "role": "ground-cover",
      "plantingOffsetDays": 35,
      "title": "Three Sisters: plant squash on outer hills"
    }
  ]
}
```

**Required:** base. All other fields optional.

Two shapes share the same `type: 'companion'`:

- **Pairwise affinity**: just `goodWith[]` + `badWith[]` (lists of cropPluginIds) + `benefit`. Surfaced as ✓/✗ chips in the companion advisor.
- **Companion-system**: adds `primaryFamily` + `members[]`. Engine emits `companion-trigger` events for each member when the primary crop plants.

`members[i]` shape: `family` (cropFamily enum), `role` (free text ≤80 chars), `plantingOffsetDays` (0-365), optional `title` (≤120 chars) + `body` (≤500 chars).

---

## 6. Cross-references

Several fields hold **pluginId references** to other plugins:

| Field | Where | References |
|---|---|---|
| `labelClaims.safeForCropPluginIds[]` | herbicide / insecticide / fungicide | crop pluginIds |
| `traitGatedSafeFor[].cropPluginId` | herbicide | crop pluginId |
| `goodWith[]` / `badWith[]` | companion | crop pluginIds |
| `crossesWith[]` | crop (pollination data, optional) | crop pluginIds OR `family:<name>` tags |

References are validated **on read at registration time**:

- Unknown references (a pluginId not in the live registry when this plugin loads) don't fail validation — they're tolerated so plugins can be loaded in any order. The detail page surfaces unknown references with a "not found" indicator so authors can spot typos.
- The bypass check, however, **does** look up referenced crops to verify trait gates + chemistry safety, so trait-gated herbicides require the referenced crop to be registered first if you want the bypass to validate against actual trait data (otherwise it falls back to hardcoded ban logic).

---

## 7. Compliance flags (v1.1)

Used by herbicide / insecticide / fungicide / fertilizer. Optional — absent is treated as "unknown" (excluded from organic-philosophy planning):

```jsonc
{
  "complianceFlags": {
    "omriListed": true,                     // OMRI-Listed for USDA-organic use (label-verified)
    "nonGmoCompliant": true,                // Active ingredients are not GMO-derived
    "certifiedOrganicAllowed": true,        // Usable under National Organic Program
    "transitioningAllowed": true,           // Usable during 3-year organic transition
    "notes": "OMRI certificate 12345"
  }
}
```

Drives the Phase 21 inputs-planner philosophy filter:

- `conventional` → no filter
- `non-gmo` → requires `nonGmoCompliant === true`
- `organic-transitioning` → requires `transitioningAllowed === true` OR `omriListed === true`
- `certified-organic` → requires `omriListed === true` AND `certifiedOrganicAllowed !== false`

Be conservative: set flags only when label-verified. The planner treats absent flags as excluded.

---

## 8. Validation reference

### 8.1 Local validation

```js
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import herbicideSchema from './schemas/herbicide.schema.json' assert { type: 'json' };

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(herbicideSchema);

if (!validate(myPlugin)) {
  console.error(validate.errors);
}
```

Pick the schema file matching `plugin.type`. Schemas are draft 2020-12; ajv 8.x supports it.

### 8.2 Upload-endpoint response

**Success:**

```jsonc
{
  "pluginId": "pin-dee-3-3-ec",
  "version": "1.0.1",
  "hash": "ab12…",
  "noChange": false,
  "bumped": true,
  "priorVersion": "1.0.0",
  "diff": {
    "addedKeys": ["complianceFlags"],
    "removedKeys": [],
    "changedKeys": ["ratePerAcre.amount"]
  }
}
```

**Failure (400):**

```jsonc
{
  "error": "plugin failed schema validation",
  "code": "schema",
  "issues": [
    { "path": "activeIngredients.0.chemistryClass", "message": "Invalid enum value." }
  ]
}
```

`code` is one of `schema | bypass | other`. `issues[].path` is a dot-joined JSON path; `issues[].message` is human-readable.

### 8.3 Common rejection causes

| Symptom | Likely cause |
|---|---|
| `Invalid enum value` on `cropFamily` / `chemistryClass` / `fracCode` | Value not in the spec — check enum list above. |
| `pluginId must be kebab-case ≤64 chars` | Uppercase, underscores, or too long. Slugify the displayName. |
| `cornType is only valid when cropFamily === 'corn'` | Cross-field rule — remove `cornType` or change family. |
| `plugin attempts to bypass safety kernel` | A `labelClaims.safeForCropPluginIds[]` entry contradicts the kill matrix. Drop the entry or move to `traitGatedSafeFor`. |
| `pluginId 'x' already exists` (on `POST` from the scan flow only) | Use the edit flow instead — re-upload with the existing pluginId via `/api/plugins/upload` auto-bumps the version. |

---

## 9. Versioning + history

Every successful upload creates a row in `plugin_versions`. The schema (server-side) is:

```sql
plugin_versions (
  id            text PK,
  plugin_id     text NOT NULL,
  version       text NOT NULL,
  kind          text NOT NULL,        -- crop|herbicide|insecticide|fungicide|fertilizer|companion
  hash          text NOT NULL,        -- SHA-256 of payloadJson
  payload_json  text NOT NULL,
  changed_by_user_id  text,
  change_reason       text,
  diff_summary_json   text,
  created_at    integer NOT NULL,
  superseded_at integer,              -- NULL = current
  retired_at    integer               -- NULL = active
)
```

The on-disk JSON under `plugins/<kind>s/<pluginId>.json` always reflects the **current** row (non-superseded, non-retired). Spray events store `pluginHashesJson` so they can resolve back to the exact version active at spray time even after rollbacks or retires.

**Rollback:** `POST /api/plugins/[pluginId]/rollback { toVersion }` creates a new forward version whose payload is a copy of the target historical row. History is append-only — rollback never edits prior rows.

---

## 10. Naming conventions

- **`pluginId`**: kebab-case slug, ≤64 chars. Derive from displayName + product line (e.g. `roundup-powermax-ii`, `corn-bloody-butcher`). Avoid version numbers in the slug — use the `version` field instead.
- **`displayName`**: ≤120 chars, human-readable. Include brand + variant when relevant (e.g. `"Roundup PowerMax II (Bayer glyphosate)"`).
- **Task keys** (inside `preTasks` / `postTasks` / `seasonalTasks`): kebab-case identifier ≤64 chars. Used to deduplicate tasks across plugin re-uploads — same key = same task across versions.
- **Trait identifiers**: kebab-case strings (e.g. `glyphosate-tolerant-rr2`, `dicamba-tolerant-xtend`). Authoritative list lives implicitly on the crop plugins that declare them.

---

## 11. Examples (full payloads)

### Herbicide with all v1.1 fields

```jsonc
{
  "pluginId": "atrazine-4l",
  "type": "herbicide",
  "displayName": "Atrazine 4L",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "activeIngredients": [
    { "name": "atrazine", "chemistryClass": "photosystem-ii-triazine" }
  ],
  "ratePerAcre": { "amount": 2.0, "unit": "qt" },
  "gpaCalibration": 15,
  "applicationTiming": "PRE",
  "requiresAMS": false,
  "deconRequired": false,
  "epaRegistrationNumber": "228-707",
  "labelClaims": {
    "safeForCropPluginIds": ["corn-bantam-sweet", "corn-bloody-butcher"]
  },
  "complianceFlags": {
    "omriListed": false,
    "nonGmoCompliant": true,
    "certifiedOrganicAllowed": false,
    "transitioningAllowed": false
  },
  "notes": "Pre-emergence broadleaf + grass control on corn. Carries over 12-18 months on most rotations — verify the rotation interval before planting a sensitive crop."
}
```

### Companion system

```jsonc
{
  "pluginId": "three-sisters",
  "type": "companion",
  "displayName": "Three Sisters (Corn/Beans/Squash)",
  "version": "1.1.0",
  "pluginSchemaVersion": "1.1",
  "primaryFamily": "corn",
  "goodWith": ["corn-bantam-sweet", "pole-bean-kentucky-wonder"],
  "badWith": [],
  "benefit": "Beans fix nitrogen + climb cornstalks; squash vines suppress weeds at the ground layer.",
  "members": [
    {
      "family": "legume",
      "role": "trellis + n-fixer",
      "plantingOffsetDays": 14,
      "title": "Three Sisters: plant beans (corn at ~6 in)",
      "body": "Plant pole beans 6 in from each cornstalk. Avoid before corn reaches 6 in."
    },
    {
      "family": "cucurbit",
      "role": "ground-cover",
      "plantingOffsetDays": 35,
      "title": "Three Sisters: plant pumpkins on outer hills",
      "body": "Plant pumpkin hills at outer block edges so vines do not shade young corn or beans."
    }
  ]
}
```

### Crop with tasks + spray windows

```jsonc
{
  "pluginId": "corn-bantam-sweet",
  "type": "crop",
  "displayName": "Bantam Sweet Corn",
  "version": "1.0.0",
  "pluginSchemaVersion": "1.1",
  "cropFamily": "corn",
  "cornType": "sweet",
  "daysToMaturity": { "min": 70, "max": 80 },
  "defaultRowSpacingInches": 36,
  "preHarvestIntervalDays": 7,
  "harvestIndicators": [
    "Silks brown and dry",
    "Kernel milk-stage on the 'pop the kernel with a thumbnail' test"
  ],
  "plantingGuide": {
    "soilTempMinF": 60,
    "rowSpacingIn": 36
  },
  "agronomy": {
    "lifecycle": "annual",
    "rotationLookbackYears": 1
  },
  "preTasks": [
    {
      "key": "test-germination",
      "title": "Test germination",
      "category": "scout",
      "daysBeforePlant": 14,
      "body": "Pull 100 kernels from stored seed, paper-towel germ test."
    }
  ],
  "seasonalTasks": [
    {
      "key": "side-dress-n-v6",
      "title": "Side-dress N at V6",
      "category": "fertilize",
      "kind": "fertilize",
      "daysAfterPlanting": 35,
      "windowDays": 7
    }
  ],
  "sprayWindows": [
    {
      "chemistryClass": "accase-inhibitor",
      "anchor": "planting",
      "offsetDaysMin": 30,
      "offsetDaysMax": 60,
      "title": "POST grass window (clethodim)",
      "body": "For grass escapes. Sprayer must be decon-clean of auxin residue.",
      "purpose": "post-emergent",
      "weedStrategyGate": "post-emergence-ok"
    }
  ]
}
```

---

## 12. Glossary

| Term | Meaning |
|---|---|
| HRAC | Herbicide Resistance Action Committee. Mode-of-action group code (integer, e.g. `2`, `9`, `15`). |
| IRAC | Insecticide Resistance Action Committee. Mode-of-action group code (`1A`, `4A`, `11A`, etc.). |
| FRAC | Fungicide Resistance Action Committee. Mode-of-action code (`M01`, `P01`, `11`, `BM01`, etc.). |
| REI | Re-Entry Interval. Hours after spraying before workers may re-enter the treated area. |
| PHI | Pre-Harvest Interval. Days after spraying before harvest is legal. |
| EPA reg # | EPA registration number on the product label, format `NNNNN-NNN` or `NNNNN-NNN-NNN`. |
| OMRI | Organic Materials Review Institute. Listing certifies a product for USDA-organic use. |
| NOP | National Organic Program (USDA). |
| GPA | Gallons per acre. Total spray solution volume the sprayer is calibrated to deliver. |
| AMS | Ammonium sulfate. A common adjuvant for glyphosate + a few other chemistries. |
| DTM | Days To Maturity. Seed-to-harvest window. |
| Bypass check | Server-side rule that rejects plugin claims contradicting the safety kernel's kill matrix. |
| Kill matrix | The hardcoded HRAC × cropFamily lethality table in `cropFamilyLethality.ts`. Plugins cannot override it. |

---

## 13. Versioning of this spec

This document tracks the plugin schema major.minor. Bumps are announced via:

- Updated `pluginSchemaVersion` enum in [`schemas.ts`](../apps/web/src/lib/plugins/schemas.ts)
- Regenerated [/schemas/](../schemas/) JSON Schemas
- Updated examples in this document

v1.0 plugins remain valid against v1.1+ for the foreseeable future — every new field is additive + optional. If a breaking change ever lands, it'll bump the major and define a migration path here.

---

**Last updated:** 2026-05-22.
**Source of truth:** [`apps/web/src/lib/plugins/schemas.ts`](../apps/web/src/lib/plugins/schemas.ts).
