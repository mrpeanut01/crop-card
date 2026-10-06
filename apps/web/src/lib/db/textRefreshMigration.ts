/**
 * OP-21 (docs/design/ORCHARD_CALENDAR.md): writes the SQL that refreshes open
 * tasks made from edited or removed crop seasonal rows, matching tasks the
 * way migration 0086 did. A task made by `materializeSeasonalTasks` carries
 * the row's `crop:<pluginId>:seasonal:<key>` template key; a task scheduled
 * from a /today suggestion carries a `derived:seasonal-task:` or
 * `derived:orchard-task:` key, the row's body and a title of the row title,
 * " — " and the variety. Every change is compare-and-set: a title or body is
 * only rewritten while it still equals the old text, so a farmer's own edit
 * stays. Closed and skipped tasks are never touched. Run by
 * `scripts/gen-text-refresh-migration.ts`.
 */

export interface TextRefreshRow {
  /** `crop:<pluginId>:seasonal:<key>`, or null for rows never materialized
   *  under a template key (apple's `orchardSeasonalTasks`). */
  templateKey: string | null;
  oldTitle: string;
  newTitle: string;
  oldBody: string | null;
  newBody: string | null;
  /** The row is gone: open tasks made from it are skipped instead. */
  removed?: boolean;
}

export interface TextRefreshOptions {
  /** Temp-table prefix, unique per migration (e.g. `m0087`). */
  prefix: string;
  /** `abort_reason` written on tasks made from removed rows. */
  abortReason?: string;
  /** OP-27: the calendar engine no longer has an `orchard-task` kind, so
   *  every `derived:orchard-task:` key becomes `derived:seasonal-task:`
   *  (the same block and start), keeping an already scheduled suggestion
   *  matched. A key whose new spelling the Owner already holds is left. */
  retireOrchardTaskKeys?: boolean;
}

const ORCHARD_KEY_PREFIX = 'derived:orchard-task:';
const SEASONAL_KEY_PREFIX = 'derived:seasonal-task:';

const BREAK = '\n--> statement-breakpoint\n';
const DERIVED =
  "(`t`.`plugin_template_key` LIKE 'derived:orchard-task:%' OR `t`.`plugin_template_key` LIKE 'derived:seasonal-task:%')";

function lit(v: string | null): string {
  return v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
}

export function validateTextRefreshRows(rows: readonly TextRefreshRow[]): string[] {
  const problems: string[] = [];
  const byTitle = new Map<string, string>();
  const byBody = new Map<string, string | null>();
  for (const r of rows) {
    const at = r.templateKey ?? r.oldTitle;
    if (r.templateKey !== null && !/^crop:[^:]+:seasonal:.+$/.test(r.templateKey)) {
      problems.push(`${at}: template key is not a crop seasonal key`);
    }
    if (!r.removed && r.oldTitle === r.newTitle && r.oldBody === r.newBody) {
      problems.push(`${at}: nothing changes`);
    }
    if (r.oldTitle.includes(' — ')) problems.push(`${at}: old title holds " — "`);
    const t = byTitle.get(r.oldTitle);
    if (t !== undefined && t !== (r.removed ? '\0removed' : r.newTitle)) {
      problems.push(`${at}: old title "${r.oldTitle}" maps to two new titles`);
    }
    byTitle.set(r.oldTitle, r.removed ? '\0removed' : r.newTitle);
    if (r.oldBody !== null) {
      const b = byBody.get(r.oldBody);
      if (b !== undefined && b !== (r.removed ? '\0removed' : r.newBody)) {
        problems.push(`${at}: old body maps to two new bodies`);
      }
      byBody.set(r.oldBody, r.removed ? '\0removed' : r.newBody);
    }
  }
  return problems;
}

export function textRefreshMigrationSql(
  rows: readonly TextRefreshRow[],
  opts: TextRefreshOptions
): string {
  const problems = validateTextRefreshRows(rows);
  if (problems.length) throw new Error(`text refresh rows:\n${problems.join('\n')}`);
  if (!/^[a-z][a-z0-9_]*$/.test(opts.prefix)) throw new Error('prefix must be snake_case');
  const removed = rows.filter((r) => r.removed);
  const edited = rows.filter((r) => !r.removed);
  const p = opts.prefix;
  const out: string[] = [];

  if (removed.length) {
    out.push(
      `CREATE TEMP TABLE \`${p}_removed\` (\`template_key\` text, \`title\` text NOT NULL, \`body\` text);`
    );
    out.push(
      `INSERT INTO \`${p}_removed\` VALUES\n` +
        removed
          .map((r) => `\t(${lit(r.templateKey)}, ${lit(r.oldTitle)}, ${lit(r.oldBody)})`)
          .join(',\n') +
        ';'
    );
    out.push(`CREATE TEMP TABLE \`${p}_abort\` (\`id\` text PRIMARY KEY);`);
    out.push(
      `INSERT OR IGNORE INTO \`${p}_abort\` SELECT \`t\`.\`id\` FROM \`tasks\` \`t\` WHERE \`t\`.\`completed_at\` IS NULL AND \`t\`.\`aborted_at\` IS NULL AND (\n` +
        `\t\`t\`.\`plugin_template_key\` IN (SELECT \`template_key\` FROM \`${p}_removed\` WHERE \`template_key\` IS NOT NULL)\n` +
        `\tOR (${DERIVED} AND EXISTS (\n` +
        `\t\tSELECT 1 FROM \`${p}_removed\` \`r\` WHERE \`t\`.\`body\` = \`r\`.\`body\` OR substr(\`t\`.\`title\`, 1, length(\`r\`.\`title\`) + 3) = \`r\`.\`title\` || ' — '\n` +
        `\t))\n);`
    );
    out.push(
      `INSERT OR IGNORE INTO \`${p}_abort\` SELECT \`id\` FROM \`tasks\` WHERE \`completed_at\` IS NULL AND \`aborted_at\` IS NULL AND \`linked_to_task_id\` IN (SELECT \`id\` FROM \`${p}_abort\`);`
    );
    out.push(
      `UPDATE \`tasks\` SET \`aborted_at\` = unixepoch() * 1000, \`abort_reason\` = ${lit(opts.abortReason ?? 'Removed from the crop library')}\n` +
        `WHERE \`id\` IN (SELECT \`id\` FROM \`${p}_abort\`);`
    );
  }

  if (edited.length) {
    out.push(
      `CREATE TEMP TABLE \`${p}_edited\` (\`template_key\` text, \`old_title\` text NOT NULL, \`new_title\` text NOT NULL, \`old_body\` text, \`new_body\` text);`
    );
    out.push(
      `INSERT INTO \`${p}_edited\` VALUES\n` +
        edited
          .map(
            (r) =>
              `\t(${lit(r.templateKey)}, ${lit(r.oldTitle)}, ${lit(r.newTitle)}, ${lit(r.oldBody)}, ${lit(r.newBody)})`
          )
          .join(',\n') +
        ';'
    );
    out.push(
      'UPDATE `tasks` SET\n' +
        `\t\`title\` = coalesce((SELECT \`e\`.\`new_title\` FROM \`${p}_edited\` \`e\` WHERE \`e\`.\`template_key\` = \`tasks\`.\`plugin_template_key\` AND \`e\`.\`old_title\` = \`tasks\`.\`title\`), \`title\`),\n` +
        `\t\`body\` = CASE WHEN EXISTS (SELECT 1 FROM \`${p}_edited\` \`e\` WHERE \`e\`.\`template_key\` = \`tasks\`.\`plugin_template_key\` AND \`e\`.\`old_body\` IS \`tasks\`.\`body\`) THEN (SELECT \`e\`.\`new_body\` FROM \`${p}_edited\` \`e\` WHERE \`e\`.\`template_key\` = \`tasks\`.\`plugin_template_key\` AND \`e\`.\`old_body\` IS \`tasks\`.\`body\`) ELSE \`body\` END\n` +
        `WHERE \`completed_at\` IS NULL AND \`aborted_at\` IS NULL AND \`plugin_template_key\` IN (SELECT \`template_key\` FROM \`${p}_edited\` WHERE \`template_key\` IS NOT NULL);`
    );
    out.push(
      'UPDATE `tasks` SET\n' +
        `\t\`title\` = coalesce((SELECT \`e\`.\`new_title\` || substr(\`tasks\`.\`title\`, length(\`e\`.\`old_title\`) + 1) FROM \`${p}_edited\` \`e\` WHERE \`e\`.\`old_title\` <> \`e\`.\`new_title\` AND substr(\`tasks\`.\`title\`, 1, length(\`e\`.\`old_title\`) + 3) = \`e\`.\`old_title\` || ' — '), \`title\`),\n` +
        `\t\`body\` = coalesce((SELECT \`e\`.\`new_body\` FROM \`${p}_edited\` \`e\` WHERE \`e\`.\`old_body\` = \`tasks\`.\`body\`), \`body\`)\n` +
        `WHERE \`completed_at\` IS NULL AND \`aborted_at\` IS NULL AND (\`plugin_template_key\` LIKE 'derived:orchard-task:%' OR \`plugin_template_key\` LIKE 'derived:seasonal-task:%');`
    );
  }

  if (opts.retireOrchardTaskKeys) {
    const rest = `substr(\`tasks\`.\`plugin_template_key\`, ${ORCHARD_KEY_PREFIX.length + 1})`;
    out.push(
      `UPDATE \`tasks\` SET \`plugin_template_key\` = '${SEASONAL_KEY_PREFIX}' || ${rest}\n` +
        `WHERE \`plugin_template_key\` LIKE '${ORCHARD_KEY_PREFIX}%' AND NOT EXISTS (\n` +
        `\tSELECT 1 FROM \`tasks\` \`d\` WHERE \`d\`.\`owner_id\` = \`tasks\`.\`owner_id\` AND \`d\`.\`plugin_template_key\` = '${SEASONAL_KEY_PREFIX}' || ${rest}\n` +
        `);`
    );
  }

  if (removed.length) out.push(`DROP TABLE \`${p}_abort\`;`);
  if (edited.length) out.push(`DROP TABLE \`${p}_edited\`;`);
  if (removed.length) out.push(`DROP TABLE \`${p}_removed\`;`);
  return out.join(BREAK) + '\n';
}
