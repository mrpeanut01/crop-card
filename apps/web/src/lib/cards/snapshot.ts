/**
 * The offline bundle `/api/cards/snapshot` returns for the active Owner and
 * Dexie stores per Owner. Plain, JSON-serializable types only: this module is
 * imported by the client and must never pull in server code.
 *
 * Calendar dates (planting, frost, expiry) are `YYYY-MM-DD` strings so they
 * render as the same day in every time zone; moments are epoch ms.
 */

import type { EmergencyContact } from '$lib/farm/emergencyContacts';
import type { AreaKind, BedStyle, BlockKind } from '$lib/farm/areaKinds';
import type { MapFeatureView } from '$lib/farm/mapFeatures';
import type { Footprint, SpacingPattern } from '$lib/farm/footprint';
import type { ExtractionMethod, LabRatings, UnitsBasis } from '$lib/fertility/soilInterpret';

/** 2 since 32D: animals, flocks, care plans and precomputed holds.
 *  3 since 32E: open seed-starting trays on each planting. */
export const FARM_SNAPSHOT_VERSION = 3 as const;

export type SnapshotProvenance = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

/** `fields.kind` values. The UI calls these Areas; the table stays `fields`. */
export type SnapshotAreaKind = AreaKind;

export type SnapshotBlockKind = BlockKind;

export type SnapshotBedStyle = BedStyle;

export interface SnapshotArea {
  id: string;
  name: string;
  kind: SnapshotAreaKind;
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
  perimeterFt: number | null;
  /** Where `acres` came from: drawn map geometry, sketch dimensions or a
   *  typed value. Null when there are no acres. */
  acresSource: SnapshotAcresSource | null;
  notes: string | null;
}

export type SnapshotAcresSource = 'geometry' | 'dimensions' | 'typed';

/** Illustrative position inside the parent Area's feet grid. Never a
 *  geometry input (pollination distance, shade, weather centroids). */
export interface SnapshotBlockLayout {
  xFt: number | null;
  yFt: number | null;
  rotationDeg: number | null;
  bedStyle: SnapshotBedStyle | null;
}

export interface SnapshotBlock {
  id: string;
  areaId: string | null;
  name: string;
  blockLabel: string | null;
  kind: SnapshotBlockKind;
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
  layout: SnapshotBlockLayout | null;
}

export type SnapshotPlantingStatus = 'planned' | 'active' | 'harvested';

export interface SnapshotPlanting {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  status: SnapshotPlantingStatus;
  plantingDate: string | null;
  harvestedAt: string | null;
  quantityPlanted: number | null;
  quantityUnit: string | null;
  /** Owner-entered spacing overrides the plugin's (`manual` provenance). */
  spacingIn: number | null;
  rowSpacingIn: number | null;
  plantCount: number | null;
  /** How `plantCount` was set; `fallback` means computed without plugin spacing. */
  plantCountProvenance: 'data' | 'manual' | 'fallback' | null;
  sourceProvenance: 'ai' | 'fallback' | 'plugin' | null;
  /** The calendar engine's harvest window (the one /plan shows), as UTC
   *  days. Absent on older bundles; cards then count days to maturity. */
  harvestWindow?: { start: string; end: string } | null;
  /** Where it sits in its bed (garden designer), for the printed bed map.
   *  Absent on older bundles and when it has no spot yet. */
  footprint?: Footprint | null;
  spacingPattern?: SpacingPattern | null;
  /** Phase 32E "Seed or seedling?". Absent on older bundles. */
  establishment?: 'direct-seed' | 'transplant' | null;
  /** Earliest tray sowing, epoch ms. */
  sownIndoorsAt?: number | null;
  /** Phase 32F (F1-17): minutes logged on this planting's tasks by
   *  everyone. Absent on older bundles and when nothing was logged. */
  minutesLogged?: number;
  /** Trays not yet transplanted, for the offline germination stepper
   *  (E1-18). Absent on bundles saved before version 3. */
  trays?: SnapshotSeedTray[];
}

export interface SnapshotSeedTray {
  id: string;
  trayLabel: string | null;
  cells: number | null;
  seedsPerCell: number | null;
  germinatedCount: number | null;
  sownAt: number;
}

export type SnapshotTaskCategory =
  | 'plant'
  | 'till'
  | 'fertilize'
  | 'spray'
  | 'scout'
  | 'companion-check'
  | 'prune'
  | 'harvest'
  | 'hay-cutting'
  | 'other';

export interface SnapshotTask {
  id: string;
  title: string;
  category: SnapshotTaskCategory | null;
  scheduledFor: number;
  cropId: string | null;
  blockId: string | null;
  equipmentId: string | null;
  /** Phase 32F (F1-11). Absent on older bundles; absent means unassigned. */
  assigneeUserId?: string | null;
  /** The record the task becomes, when it names one. Absent on older bundles. */
  relatedEventTable?: string | null;
}

/** A farm member who can be given tasks, by name only (F1-11). */
export interface SnapshotPerson {
  id: string;
  name: string;
}

export type SnapshotEquipmentType =
  'sprayer' | 'planter' | 'drill' | 'rake' | 'baler' | 'tractor' | 'mower' | 'irrigation' | 'other';

export interface SnapshotEquipmentState {
  calibratedGpa: number | null;
  calibrationDate: number | null;
  lastDeconAt: number | null;
  lastUsedAt: number | null;
  lastChemistryClass: string | null;
  winterizedAt: number | null;
}

export interface SnapshotEquipment {
  id: string;
  type: SnapshotEquipmentType;
  label: string;
  state: SnapshotEquipmentState | null;
  /** Tank size from the equipment spec (`spec.tankGal`). Absent on bundles
   *  saved before Sprint 30F. */
  tankGal?: number | null;
}

export type SnapshotStockCategory =
  | 'herbicide'
  | 'insecticide'
  | 'fungicide'
  | 'fertilizer'
  | 'seed'
  | 'adjuvant'
  | 'fuel'
  | 'part'
  | 'feed'
  | 'bedding'
  | 'animal-health';

export interface SnapshotStockItem {
  id: string;
  pluginId: string | null;
  category: SnapshotStockCategory;
  displayName: string;
  unit: string;
  onHand: number;
  reorderThreshold: number | null;
  earliestExpiry: string | null;
}

export interface SnapshotMinMax {
  min: number;
  max: number;
}

/** The subset of a crop plugin the Planting, Area and Care Guide cards read. */
export interface SnapshotCropPlugin {
  pluginId: string;
  displayName: string;
  version: string;
  cropFamily: string;
  archetype?: string;
  daysToMaturity?: SnapshotMinMax;
  defaultRowSpacingInches?: number;
  preHarvestIntervalDays?: number;
  plantingGuide?: {
    rowSpacingIn?: number;
    inRowSpacingIn?: SnapshotMinMax;
    seedDepthIn?: SnapshotMinMax;
    soilTempMinF?: number;
    /** Phase 32E seed starting, sourced values only. */
    establishment?: 'direct-seed' | 'transplant' | 'either';
    startIndoorsWeeks?: SnapshotMinMax;
    hardenOffDays?: SnapshotMinMax;
    germinationTempF?: SnapshotMinMax;
    dtmFrom?: 'direct-seed' | 'transplant';
  };
  harvestIndicators?: string[];
  notes?: string;
  /** The plugin's pruning and thinning steps (never its spray tasks). */
  careTasks?: SnapshotCareTask[];
}

export interface SnapshotCareTask {
  title: string;
  body?: string;
}

/** Month-day strings (`MM-DD`). `cautious` holds the 90%-sure dates, which
 *  are NOAA's P10 columns for both spring and fall. */
export interface SnapshotFrostDates {
  lastSpring: string | null;
  firstFall: string | null;
  hardLastSpring: string | null;
  hardFirstFall: string | null;
  cautious: { lastSpring: string | null; firstFall: string | null } | null;
  frostFree: boolean;
  provenance: 'data' | 'manual' | 'fallback';
  stationName: string | null;
  distanceMi: number | null;
}

export interface SnapshotZone {
  zone: string;
  provenance: 'data' | 'manual';
  stationName: string | null;
  distanceMi: number | null;
  extremeMinF: number | null;
  reach?: 'near' | 'wide';
  elevDeltaFt?: number | null;
}

export type SnapshotSprayProductType = 'herbicide' | 'insecticide' | 'fungicide';

export type SnapshotRateUnit = 'oz' | 'fl-oz' | 'lb' | 'pt' | 'qt';

/** The label facts a Spray Card reads for one stocked pesticide. Rates are
 *  the plugin's; the card scales them only through `lib/dilution`. */
export interface SnapshotSprayProduct {
  pluginId: string;
  type: SnapshotSprayProductType;
  displayName: string;
  version: string;
  epaRegistrationNumber: string | null;
  ratePerAcre: { amount: number; unit: SnapshotRateUnit } | null;
  gpaCalibration: number | null;
  reEntryIntervalHours: number | null;
  preHarvestIntervalDays: number | null;
  targets: string[];
  /** Sprayer load classes the kernel's cross-contamination gate compares:
   *  HRAC classes for herbicides, `insecticide-load` / `fungicide-load`
   *  otherwise. */
  loadClasses: string[];
  /** The kernel's `buildTankMixSteps` for this product (herbicides only). */
  mixSteps: string[];
  rainfastHours: number | null;
  pollinator: { beeToxicity: string; bloomRestriction: string } | null;
}

/** The newest soil test on a bed or block. Nutrient values are as the lab
 *  printed them, in `unitsBasis` (null means ppm). */
export interface SnapshotSoilTest {
  id: string;
  blockId: string;
  sampledAt: number;
  lab: string | null;
  ph: number | null;
  bufferPh: number | null;
  organicMatterPct: number | null;
  cec: number | null;
  nitratePpm: number | null;
  phosphorusPpm: number | null;
  potassiumPpm: number | null;
  caPpm: number | null;
  mgPpm: number | null;
  extractionMethod: ExtractionMethod | null;
  unitsBasis: UnitsBasis | null;
  labRatings: LabRatings | null;
  /** The lab report in the document vault (A-38). Its bytes are never in
   *  the snapshot; the card links to the file route for when online. */
  labReport?: { documentId: string; title: string; deletedAt: number | null } | null;
  /** A report link typed by hand before the vault existed. */
  reportPdfUrl?: string | null;
}

/** A species' display facts for Animal and Flock Cards. */
export interface SnapshotSpecies {
  pluginId: string;
  displayName: string;
  /** Plural ("Chickens"). */
  label: string;
  groupNoun: string;
  foodProducingDefault: boolean;
  products: string[];
}

export type SnapshotAnimalPurpose = 'production' | 'pet' | 'mixed';

/** An active animal. */
export interface SnapshotAnimal {
  id: string;
  groupId: string | null;
  speciesId: string;
  name: string | null;
  tag: string | null;
  sex: string;
  breed: string | null;
  birthDate: number | null;
  birthDateEstimated: boolean;
  purpose: SnapshotAnimalPurpose;
  foodProducing: boolean;
  notForSlaughter: boolean;
  /** Where it lives; a grouped animal lives where its group lives. */
  housingFieldId: string | null;
  microchipId: string | null;
  feedingNote: string | null;
}

/** An active herd, flock or litter. */
export interface SnapshotAnimalGroup {
  id: string;
  name: string;
  speciesId: string;
  purpose: SnapshotAnimalPurpose;
  /** Unnamed members only. */
  headCount: number;
  namedCount: number;
  /** Unnamed plus active named members (`groupTotal`). */
  total: number;
  /** The group's flag or any active member's. */
  foodProducing: boolean;
  housingFieldId: string | null;
}

export type SnapshotCareKind =
  | 'vaccination'
  | 'deworm'
  | 'treatment'
  | 'vet-visit'
  | 'hoof-trim'
  | 'grooming'
  | 'shearing'
  | 'health-check'
  | 'other';

/** An active care plan. `nextDueAt` is null for "ask your vet" plans with
 *  no date yet (D2-09). */
export interface SnapshotCarePlan {
  id: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  kind: SnapshotCareKind;
  title: string;
  intervalDays: number | null;
  nextDueAt: number | null;
  provenance: 'plugin' | 'manual' | 'fallback';
}

/** A treatment from the last 90 days, for display only. Holds never come
 *  from these rows; they come from `animalHolds`. */
export interface SnapshotTreatment {
  id: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  kind: string;
  productName: string | null;
  administeredAt: number;
  courseEndAt: number | null;
}

export type SnapshotHoldStatus = 'held' | 'unknown' | 'prohibited';

/**
 * One stretch of a food hold the server's kernel projected (D1-01), for
 * every hold still open when the snapshot was built, whatever its age.
 * `subject` is `animal:<id>` or `group:<id>`. `clearMs` is when it ends,
 * already rounded up to local midnight in `holdTimeZone` like the server
 * gate; null when it never ends on the data we have (unknown or
 * prohibited). The client never computes a clear by itself.
 */
export interface SnapshotAnimalHold {
  subject: string;
  food: 'meat' | 'milk' | 'eggs';
  fromMs: number;
  clearMs: number | null;
  status: SnapshotHoldStatus;
}

/** A grazing or haying hold on an Area, for the move pre-check and the
 *  Area Card. */
export interface SnapshotAreaHold {
  areaId: string;
  kind: 'graze' | 'hay';
  fromMs: number;
  clearMs: number | null;
  status: SnapshotHoldStatus;
}

export interface FarmSnapshot {
  version: typeof FARM_SNAPSHOT_VERSION | 2 | 1;
  ownerId: string;
  farmName: string | null;
  generatedAt: number;
  rulesVersion: string;
  /** Server-provided `ORIGIN` for printed QR links; never the Host header. */
  origin: string | null;
  /** Language the bundle was built for (32F, F5-4). Absent before 32F. */
  locale?: string;
  areas: SnapshotArea[];
  blocks: SnapshotBlock[];
  plantings: SnapshotPlanting[];
  tasks: SnapshotTask[];
  /** Phase 32F (F1-11): active working members, names only. Never hours
   *  or money, since one snapshot serves every role. */
  people?: SnapshotPerson[];
  equipment: SnapshotEquipment[];
  stock: SnapshotStockItem[];
  cropPlugins: Record<string, SnapshotCropPlugin>;
  frost: SnapshotFrostDates | null;
  /** Display-only hardiness zone; absent on bundles saved before it existed. */
  zone?: SnapshotZone | null;
  /** Stocked pesticides keyed by plugin id. Absent on bundles saved before
   *  Sprint 30F. */
  sprayProducts?: Record<string, SnapshotSprayProduct>;
  /** `sprayProductTerms` for every pesticide in the Owner's library, so the
   *  offline Care Guide and photo help drop brand names too. */
  sprayTerms?: string[];
  /** Fences, gates, water and paths. Absent on bundles saved before 30H. */
  mapFeatures?: SnapshotMapFeature[];
  /** The owner's saved emergency contacts for the Farm Map Card. Absent on
   *  bundles saved before Sprint 30H. */
  emergencyContacts?: EmergencyContact[];
  /** Newest soil test per bed or block. Absent on bundles saved before 32A. */
  soilTests?: SnapshotSoilTest[];
  /** 32D. Absent on bundles saved before it; cards then show no animals. */
  animals?: SnapshotAnimal[];
  animalGroups?: SnapshotAnimalGroup[];
  species?: Record<string, SnapshotSpecies>;
  /** `farm` or `pets` (`animalsLayout`), for the pet layout of a card. */
  animalsLayout?: 'farm' | 'pets';
  carePlans?: SnapshotCarePlan[];
  treatments?: SnapshotTreatment[];
  animalHolds?: SnapshotAnimalHold[];
  areaHolds?: SnapshotAreaHold[];
  /** The zone the hold clear times were rounded in (the farm's). */
  holdTimeZone?: string;
  /** Holds are projected as if every open stay and course ran to this
   *  moment, so an offline chip can only read longer than the server's. */
  holdsProjectedTo?: number;
  /** The span `tasks` covers, so Week and Month Cards know which days are
   *  complete. Absent on bundles saved before 32F. */
  taskWindow?: { fromMs: number; toMs: number };
}

/** One map line or point, as the map and the Farm Map Card read it. */
export type SnapshotMapFeature = MapFeatureView;
