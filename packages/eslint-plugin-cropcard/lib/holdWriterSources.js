import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/src",
);

function list(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "__fixtures__") continue;
      list(full, out);
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".d.ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".spec.ts") &&
      !name.endsWith(".svelte.ts") &&
      !name.endsWith(".fixtures.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Every non-test TypeScript source of the web app, flagged `repo` when
 *  it lives under `lib/db` (the only place hold-fact tables are written). */
export function holdWriterSources() {
  const repoDir = path.join(WEB_SRC, "lib", "db") + path.sep;
  return list(WEB_SRC, [])
    .sort()
    .map((p) => ({
      path: path.relative(WEB_SRC, p),
      text: readFileSync(p, "utf8"),
      repo: p.startsWith(repoDir),
    }));
}
