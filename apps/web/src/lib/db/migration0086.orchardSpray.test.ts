// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';

const source = join(__dirname, '../../../drizzle');
const TAG = '0086_remove_orchard_spray_tasks';

const REMOVED: Record<string, string[]> = {
  'pear-bartlett': ['dormant-oil', 'bloom', 'fire-blight-cover'],
  'peach-redhaven': ['dormant-spray', 'shuck-split-cover', 'summer-cover', 'pre-harvest'],
  'blueberry-bluecrop': ['mummy-berry-cover', 'anthracnose-pre-bloom'],
  'grape-concord': ['downy-mildew-cover', 'post-bloom-cover']
};

function folderWithout(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig0086-'));
  cpSync(source, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.tag !== tag);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function migrated(dir: string): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  migrate(drizzle(sqlite), { migrationsFolder: dir });
  return sqlite;
}

type Row = {
  id: string;
  title: string;
  body: string | null;
  aborted_at: number | null;
  abort_reason: string | null;
  completed_at: number | null;
};

describe(`migration ${TAG}`, () => {
  it('aborts only open tasks made from the removed spray rows', () => {
    const sqlite = migrated(folderWithout(TAG));
    const insert = sqlite.prepare(
      `INSERT INTO tasks (id, owner_id, title, body, kind, scheduled_for, completed_at, aborted_at,
         abort_reason, plugin_template_key, linked_to_task_id)
       VALUES (@id, 'owner_a', @title, @body, @kind, 1, @completed, @aborted, @reason, @key,
         @linked)`
    );
    const add = (
      id: string,
      key: string | null,
      extra: Partial<{
        completed: number;
        aborted: number;
        reason: string;
        kind: string;
        linked: string;
        title: string;
        body: string;
      }> = {}
    ) =>
      insert.run({
        id,
        key,
        title: extra.title ?? 't',
        body: extra.body ?? null,
        kind: extra.kind ?? 'primary',
        completed: extra.completed ?? null,
        aborted: extra.aborted ?? null,
        reason: extra.reason ?? null,
        linked: extra.linked ?? null
      });

    const openRemoved: string[] = [];
    for (const [pluginId, keys] of Object.entries(REMOVED)) {
      for (const key of keys) {
        const id = `open_${pluginId}_${key}`;
        add(id, `crop:${pluginId}:seasonal:${key}`);
        openRemoved.push(id);
      }
    }
    add('linked_prep', null, { kind: 'pre-task', linked: 'open_pear-bartlett_bloom' });
    add('done_removed', 'crop:peach-redhaven:seasonal:summer-cover', { completed: 500 });
    add('aborted_removed', 'crop:grape-concord:seasonal:post-bloom-cover', {
      aborted: 400,
      reason: 'skipped'
    });
    add('kept_harvest', 'crop:peach-redhaven:seasonal:harvest');
    add('kept_prune', 'crop:blueberry-bluecrop:seasonal:winter-prune');
    add('kept_swd', 'crop:blueberry-bluecrop:seasonal:swd-monitoring');
    add('other_crop', 'crop:pear-asian:seasonal:dormant-oil');
    add('manual', null);

    add('derived_apple_body', 'derived:orchard-task:blk_1:1700000000000', {
      title: 'Pre-bloom fungicide (silver-tip → green-tip) — Honeycrisp',
      body: 'Scab + powdery mildew protectant. Captan / sulfur per label.'
    });
    add('derived_apple_title', 'derived:orchard-task:blk_1:1700000000001', {
      title: 'Pre-harvest cover spray (sooty blotch / flyspeck) — Gala',
      body: 'Edited by the farmer'
    });
    add('derived_peach', 'derived:seasonal-task:blk_2:1700000000002', {
      title: 'Pre-harvest brown rot — Redhaven',
      body: 'DMI fungicide 3 wk + 7 d before harvest. Respect 3-day PHI.'
    });
    add('derived_prep', null, { kind: 'pre-task', linked: 'derived_peach' });
    add('derived_other', 'derived:seasonal-task:blk_3:1700000000003', {
      title: 'Peach harvest window — Redhaven',
      body: 'Ground-color yellow-orange + slight give = pick.'
    });
    add('derived_scout', 'derived:scout:blk_3:1700000000004', {
      title: 'Pre-harvest brown rot — Redhaven',
      body: 'DMI fungicide 3 wk + 7 d before harvest. Respect 3-day PHI.'
    });

    add('edit_raspberry', 'crop:raspberry-heritage:seasonal:swd-monitoring', {
      title: 'SWD trap + spray decision',
      body: 'Spotted-wing drosophila is the dominant ripe-fruit pest. Pyrethroids on 5–7 d intervals during ripening.'
    });
    add('edit_blueberry', 'crop:blueberry-bluecrop:seasonal:swd-monitoring', {
      title: 'Spotted-wing drosophila trap monitoring',
      body: 'Apple cider vinegar + yeast traps; 7-d insecticide intervals once SWD detected.'
    });
    add('edit_grape', 'crop:grape-concord:seasonal:leaf-pull', {
      title: 'Pull basal leaves around clusters',
      body: 'Improves spray penetration + reduces botrytis.'
    });
    add('edit_grape_farmer', 'crop:grape-concord:seasonal:leaf-pull', {
      title: 'My leaf pull',
      body: 'My own note'
    });
    add('edit_grape_done', 'crop:grape-concord:seasonal:leaf-pull', {
      title: 'Pull basal leaves around clusters',
      body: 'Improves spray penetration + reduces botrytis.',
      completed: 600
    });
    add('edit_apple_derived', 'derived:orchard-task:blk_1:1700000000005', {
      title: 'Hand or chemical fruit thinning — Gala',
      body: 'Thin to one fruit per cluster at 10–15 mm fruit size for size + return-bloom.'
    });
    add('edit_peach_harvest', 'crop:peach-redhaven:seasonal:harvest', {
      title: 'Peach harvest window',
      body: 'Ground-color yellow-orange + slight give = pick. Refrigerate within 4 h.'
    });

    const before = Date.now();
    migrate(drizzle(sqlite), { migrationsFolder: source });
    const after = Date.now();

    const rows = new Map(
      (
        sqlite
          .prepare('SELECT id, title, body, aborted_at, abort_reason, completed_at FROM tasks')
          .all() as Row[]
      ).map((r) => [r.id, r])
    );

    const aborted = [
      ...openRemoved,
      'linked_prep',
      'derived_apple_body',
      'derived_apple_title',
      'derived_peach',
      'derived_prep'
    ];
    for (const id of aborted) {
      const r = rows.get(id)!;
      expect(r.abort_reason, id).toBe('Removed: unsourced spray advice');
      expect(r.aborted_at, id).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect(r.aborted_at, id).toBeLessThanOrEqual(after + 1000);
      expect(r.completed_at, id).toBeNull();
    }
    expect(rows.get('done_removed')).toMatchObject({
      completed_at: 500,
      aborted_at: null,
      abort_reason: null
    });
    expect(rows.get('aborted_removed')).toMatchObject({ aborted_at: 400, abort_reason: 'skipped' });
    for (const id of [
      'kept_harvest',
      'kept_prune',
      'kept_swd',
      'other_crop',
      'manual',
      'derived_other',
      'derived_scout',
      'edit_raspberry',
      'edit_blueberry',
      'edit_grape',
      'edit_grape_farmer',
      'edit_apple_derived',
      'edit_peach_harvest'
    ]) {
      expect(rows.get(id), id).toMatchObject({ aborted_at: null, abort_reason: null });
    }
    expect(rows.get('edit_raspberry')).toMatchObject({
      title: 'SWD trap monitoring',
      body: 'Spotted-wing drosophila is the dominant ripe-fruit pest.'
    });
    expect(rows.get('edit_blueberry')).toMatchObject({
      title: 'Spotted-wing drosophila trap monitoring',
      body: 'Apple cider vinegar + yeast traps.'
    });
    expect(rows.get('edit_grape')).toMatchObject({ body: 'Reduces botrytis.' });
    expect(rows.get('edit_grape_farmer')).toMatchObject({
      title: 'My leaf pull',
      body: 'My own note'
    });
    expect(rows.get('edit_grape_done')).toMatchObject({
      body: 'Improves spray penetration + reduces botrytis.'
    });
    expect(rows.get('edit_apple_derived')).toMatchObject({
      title: 'Hand fruit thinning — Gala',
      body: 'Thin to one fruit per cluster for size + return-bloom.'
    });
    expect(rows.get('edit_peach_harvest')).toMatchObject({
      body: 'Ground-color yellow-orange + slight give = pick.'
    });
    sqlite.close();
  });

  it('matches apple rows by their text, since they never had a crop: key', () => {
    const sql = readFileSync(join(source, `${TAG}.sql`), 'utf8');
    expect(sql).not.toContain("'crop:apple-orchard:seasonal:");
    for (const word of ['Captan', 'Pyrethroids', 'mancozeb', 'Streptomycin', 'spray penetration']) {
      expect(sql, word).toContain(word);
    }
  });

  it('lists every removed pear, peach, blueberry and grape key', () => {
    const sql = readFileSync(join(source, `${TAG}.sql`), 'utf8');
    for (const [pluginId, keys] of Object.entries(REMOVED)) {
      for (const key of keys) expect(sql).toContain(`'crop:${pluginId}:seasonal:${key}'`);
    }
  });
});
