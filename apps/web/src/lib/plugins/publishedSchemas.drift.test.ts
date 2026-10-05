import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSchemas } from './publishedSchemas';

// Ruling OP-19: the author-facing schemas/*.json must match the Zod schemas.

const SCHEMAS_DIR = path.resolve(__dirname, '../../../../../schemas');

describe('published plugin JSON Schemas', () => {
  it.each(renderSchemas().map((r) => [r.file, r.text]))(
    '%s matches the Zod schema (run `pnpm gen:schemas` if not)',
    (file, text) => {
      expect(readFileSync(path.join(SCHEMAS_DIR, file), 'utf8')).toBe(text);
    }
  );
});
