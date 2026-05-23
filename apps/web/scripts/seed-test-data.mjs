/**
 * Seed test data for the playwright-clickthrough subagent.
 *
 * Defaults DATABASE_URL to file:./.playwright-data/test.db (matches
 * playwright.config.ts) so a hand-run dev server pointed at the same path
 * sees the same fixtures.
 *
 * Bring-up:
 *   pnpm --filter web run seed:test
 *   DATABASE_URL=file:./.playwright-data/test.db pnpm --filter web dev
 *
 * Re-runnable: truncates the relevant tables and re-inserts. This is a TEST
 * DB only — never point this at /data/cropcard.db.
 */

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const DEFAULT_DB = 'file:./.playwright-data/test.db';
const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DB;
const dbPath = dbUrl.replace(/^file:/, '');

if (dbPath.includes('/data/cropcard.db')) {
  console.error(`[seed] refusing to seed into ${dbPath} — looks like prod path`);
  process.exit(1);
}

mkdirSync(dirname(resolve(dbPath)), { recursive: true });

console.log(`[seed] applying migrations to ${dbPath}`);
execSync('node ./scripts/migrate.mjs', {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: 'inherit'
});

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

console.log(`[seed] truncating fixture tables`);
const truncateOrder = [
  'tasks',
  'stock_movements',
  'stock_lots',
  'stock_items',
  'equipment_log',
  'equipment_state',
  'pending_calibrations',
  'spray_events',
  'insecticide_events',
  'fertility_applications',
  'fertility_credits',
  'soil_tests',
  'hay_cuttings',
  'harvest_events',
  'crop_equipment',
  'crops',
  'equipment',
  'sprayers',
  'blocks',
  'fields',
  'users'
];
const tx = sqlite.transaction(() => {
  for (const t of truncateOrder) {
    try {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    } catch (e) {
      if (!String(e.message).includes('no such table')) throw e;
    }
  }
});
tx();

const now = Date.now();
const days = (n) => now - n * 24 * 60 * 60 * 1000;

const owner = {
  id: randomUUID(),
  email: 'owner@cropcard.local',
  role: 'owner',
  createdAt: now
};
const helper = {
  id: randomUUID(),
  email: 'helper@cropcard.local',
  role: 'helper',
  createdAt: now
};

const homeField = { id: randomUUID(), name: 'Home Field', createdAt: now };

const blockA = {
  id: randomUUID(),
  name: 'Block-A',
  acres: 2,
  blockLabel: 'A',
  fieldId: homeField.id,
  tillageMethod: 'conventional'
};
const blockB = {
  id: randomUUID(),
  name: 'Block-B',
  acres: 1,
  blockLabel: 'B',
  fieldId: homeField.id,
  tillageMethod: 'no-till'
};

const cornCrop = {
  id: randomUUID(),
  blockId: blockA.id,
  cropPluginId: 'corn',
  varietyDisplayName: 'Corn (Field)',
  plantingDate: days(30),
  status: 'active'
};
const soyCrop = {
  id: randomUUID(),
  blockId: blockB.id,
  cropPluginId: 'soybean-asgrow-roundup-ready-2-xtend',
  varietyDisplayName: 'Soybean — Asgrow RR2 Xtend',
  plantingDate: days(20),
  status: 'active'
};

const cleanSprayer = { id: randomUUID(), type: 'sprayer', label: 'Sprayer-Clean' };
const dirtySprayer = { id: randomUUID(), type: 'sprayer', label: 'Sprayer-Contaminated' };

const insertUser = sqlite.prepare(
  `INSERT INTO users (id, email, role, created_at) VALUES (?, ?, ?, ?)`
);
insertUser.run(owner.id, owner.email, owner.role, owner.createdAt);
insertUser.run(helper.id, helper.email, helper.role, helper.createdAt);

sqlite
  .prepare(`INSERT INTO fields (id, name, created_at) VALUES (?, ?, ?)`)
  .run(homeField.id, homeField.name, homeField.createdAt);

const insertBlock = sqlite.prepare(
  `INSERT INTO blocks (id, name, acres, block_label, field_id, tillage_method, axes_locked) VALUES (?, ?, ?, ?, ?, ?, 0)`
);
insertBlock.run(
  blockA.id,
  blockA.name,
  blockA.acres,
  blockA.blockLabel,
  blockA.fieldId,
  blockA.tillageMethod
);
insertBlock.run(
  blockB.id,
  blockB.name,
  blockB.acres,
  blockB.blockLabel,
  blockB.fieldId,
  blockB.tillageMethod
);

const insertCrop = sqlite.prepare(
  `INSERT INTO crops (id, block_id, crop_plugin_id, variety_display_name, planting_date, status) VALUES (?, ?, ?, ?, ?, ?)`
);
insertCrop.run(
  cornCrop.id,
  cornCrop.blockId,
  cornCrop.cropPluginId,
  cornCrop.varietyDisplayName,
  cornCrop.plantingDate,
  cornCrop.status
);
insertCrop.run(
  soyCrop.id,
  soyCrop.blockId,
  soyCrop.cropPluginId,
  soyCrop.varietyDisplayName,
  soyCrop.plantingDate,
  soyCrop.status
);

const insertEquipment = sqlite.prepare(`INSERT INTO equipment (id, type, label) VALUES (?, ?, ?)`);
insertEquipment.run(cleanSprayer.id, cleanSprayer.type, cleanSprayer.label);
insertEquipment.run(dirtySprayer.id, dirtySprayer.type, dirtySprayer.label);

const insertEquipState = sqlite.prepare(
  `INSERT INTO equipment_state (equipment_id, last_chemistry_class, last_used_at, calibrated_gpa, calibration_date)
   VALUES (?, ?, ?, ?, ?)`
);
insertEquipState.run(cleanSprayer.id, null, null, 20, days(60));
insertEquipState.run(dirtySprayer.id, 'sulfonylurea', days(2), 20, days(60));

sqlite.close();

console.log(`[seed] done`);
console.log(`  users:     ${owner.email} (owner), ${helper.email} (helper)`);
console.log(`  field:     ${homeField.name}`);
console.log(
  `  blocks:    ${blockA.name} (corn, ${blockA.acres}ac), ${blockB.name} (soybean, ${blockB.acres}ac)`
);
console.log(
  `  equipment: ${cleanSprayer.label} (clean), ${dirtySprayer.label} (contaminated → UC-04 decon target)`
);
console.log(``);
console.log(`Now start the dev server against the same DB:`);
console.log(`  DATABASE_URL=file:${dbPath} pnpm --filter web dev`);
