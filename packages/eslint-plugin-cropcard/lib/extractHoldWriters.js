import { parse } from "@typescript-eslint/parser";

const WRITE_METHODS = new Set(["insert", "update", "delete"]);
const SQL_WRITE =
  /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+[`"]?(\w+)/gi;
const EXEMPT = /@hold-exempt\b\s*[:(-]?\s*\S/;
const TAGGED = /@holdWriter\b/;

function snake(name) {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const WRAPPERS = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

function propName(node) {
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  )
    return node.property.value;
  return null;
}

/**
 * Whether `node` can name a hold-fact table: the table itself, through a
 * type cast, a ternary or `??`/`||`, or a local alias (`const t = table`,
 * `const tables = { h: table }; tables.h`) declared anywhere in the file
 * (round 7). `aliases` maps a declared name to every initializer it has.
 */
function namesTable(node, tableSet, aliases, depth = 0) {
  if (!node || depth > 8) return false;
  const again = (n) => namesTable(n, tableSet, aliases, depth + 1);
  if (WRAPPERS.has(node.type)) return again(node.expression);
  if (node.type === "ConditionalExpression")
    return again(node.consequent) || again(node.alternate);
  if (node.type === "LogicalExpression")
    return again(node.left) || again(node.right);
  if (node.type === "Identifier") {
    if (tableSet.has(node.name)) return true;
    return (aliases.get(node.name) ?? []).some(again);
  }
  if (node.type === "MemberExpression") {
    const prop = propName(node);
    if (prop && tableSet.has(prop)) return true;
    const objects =
      node.object.type === "Identifier"
        ? (aliases.get(node.object.name) ?? [])
        : [node.object];
    for (const obj of objects) {
      if (obj?.type !== "ObjectExpression") continue;
      for (const p of obj.properties) {
        if (p.type !== "Property") continue;
        const key =
          p.key.type === "Identifier" && !p.computed
            ? p.key.name
            : p.key.type === "Literal"
              ? String(p.key.value)
              : null;
        if ((prop === null || key === prop) && again(p.value)) return true;
      }
    }
    return false;
  }
  return false;
}

function collectAliases(ast) {
  const aliases = new Map();
  walk(ast, null, (node) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init
    ) {
      const list = aliases.get(node.id.name) ?? [];
      list.push(node.init);
      aliases.set(node.id.name, list);
    }
    if (
      node.type === "AssignmentExpression" &&
      node.left.type === "Identifier"
    ) {
      const list = aliases.get(node.left.name) ?? [];
      list.push(node.right);
      aliases.set(node.left.name, list);
    }
  });
  return aliases;
}

function calleeName(node) {
  const c = node.callee;
  if (c.type === "Identifier") return c.name;
  if (
    c.type === "MemberExpression" &&
    !c.computed &&
    c.property.type === "Identifier"
  ) {
    return c.property.name;
  }
  return null;
}

function functionName(node) {
  if (node.type === "FunctionDeclaration") return node.id?.name ?? null;
  const parent = node.parent;
  if (
    parent?.type === "VariableDeclarator" &&
    parent.id.type === "Identifier"
  ) {
    return parent.id.name;
  }
  return null;
}

function leadingText(node, comments, text) {
  let target = node;
  if (target.type !== "FunctionDeclaration") {
    while (
      target.parent &&
      target.parent.type !== "Program" &&
      target.parent.type !== "ExportNamedDeclaration"
    ) {
      target = target.parent;
      if (target.type === "VariableDeclaration") break;
    }
  }
  if (target.parent?.type === "ExportNamedDeclaration") target = target.parent;
  const start = target.range[0];
  let best = null;
  for (const c of comments) {
    if (c.range[1] <= start && (!best || c.range[1] > best.range[1])) best = c;
  }
  if (!best || text.slice(best.range[1], start).trim() !== "") return "";
  return best.value;
}

function walk(node, parent, visit) {
  if (!node || typeof node.type !== "string") return;
  node.parent = parent;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "range" || key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, node, visit);
    else if (v && typeof v.type === "string") walk(v, node, visit);
  }
}

function enclosingName(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (
      p.type === "FunctionDeclaration" ||
      p.type === "FunctionExpression" ||
      p.type === "ArrowFunctionExpression"
    ) {
      const name = functionName(p);
      if (name) return { name, fn: p };
    }
  }
  return null;
}

/**
 * C-35: the functions that write hold facts. A repo function (any file
 * under `lib/db`) is a writer when it writes a hold-fact table itself
 * (`db.insert|update|delete(table)`, `del(table, …)` or raw SQL) or calls
 * another writer. A repo function whose JSDoc carries `@hold-exempt: reason`
 * is left out (it only touches columns no hold reads, such as a lock stamp
 * or a photo). Outside `lib/db`, a function is a writer only when its JSDoc
 * carries `@holdWriter`: its callers must then run it inside the guard.
 *
 * @param {{ path: string, text: string, repo: boolean }[]} files
 * @param {string[]} tables hold-fact table export names
 * @returns {{ writers: string[], exempt: string[] }}
 */
export function extractHoldWriters(files, tables) {
  const tableSet = new Set(tables);
  const snakeSet = new Set(tables.map(snake));
  /** `file#name` → facts about one named function. */
  const fns = new Map();
  /** name → `file#name` of every exported repo function with that name. */
  const exported = new Map();
  const localNames = new Map();
  const tagged = new Set();
  const get = (file, name) => {
    const id = `${file}#${name}`;
    let f = fns.get(id);
    if (!f) {
      f = { id, file, name, direct: false, exempt: false, calls: new Set() };
      fns.set(id, f);
    }
    return f;
  };
  for (const file of files) {
    const ast = parse(file.text, {
      range: true,
      comment: true,
      jsx: false,
      loc: false,
    });
    const comments = ast.comments ?? [];
    const aliases = collectAliases(ast);
    const isTable = (n) => namesTable(n, tableSet, aliases);
    const locals = new Set();
    localNames.set(file.path, locals);
    walk(ast, null, (node) => {
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        const name = functionName(node);
        if (!name) return;
        const doc = leadingText(node, comments, file.text);
        if (!file.repo) {
          if (TAGGED.test(doc)) tagged.add(name);
          return;
        }
        locals.add(name);
        const f = get(file.path, name);
        if (EXEMPT.test(doc)) f.exempt = true;
        let p = node.parent;
        while (p && p.type !== "ExportNamedDeclaration" && p.type !== "Program")
          p = p.parent;
        if (p?.type === "ExportNamedDeclaration") {
          const list = exported.get(name) ?? [];
          list.push(f.id);
          exported.set(name, list);
        }
        return;
      }
      if (!file.repo) return;
      const owner = () => {
        const e = enclosingName(node);
        return e ? get(file.path, e.name) : null;
      };
      if (node.type === "CallExpression") {
        const name = calleeName(node);
        const f = owner();
        if (!f || !name) return;
        const writesTable =
          (WRITE_METHODS.has(name) &&
            node.callee.type === "MemberExpression" &&
            isTable(node.arguments[0])) ||
          (name === "del" && isTable(node.arguments[0]));
        if (writesTable) f.direct = true;
        f.calls.add(name);
        return;
      }
      if (
        node.type === "TemplateElement" ||
        (node.type === "Literal" && typeof node.value === "string")
      ) {
        const text =
          node.type === "TemplateElement" ? node.value.raw : node.value;
        for (const m of text.matchAll(SQL_WRITE)) {
          if (snakeSet.has(m[1].toLowerCase())) {
            const f = owner();
            if (f) f.direct = true;
          }
        }
      }
    });
  }
  const writer = new Set();
  for (const f of fns.values()) if (f.direct && !f.exempt) writer.add(f.id);
  const resolve = (f, name) => {
    if (localNames.get(f.file)?.has(name)) return [`${f.file}#${name}`];
    return exported.get(name) ?? [];
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of fns.values()) {
      if (writer.has(f.id) || f.exempt) continue;
      for (const c of f.calls) {
        if (resolve(f, c).some((id) => writer.has(id))) {
          writer.add(f.id);
          grew = true;
          break;
        }
      }
    }
  }
  const names = new Set(tagged);
  for (const id of writer) {
    const f = fns.get(id);
    if ((exported.get(f.name) ?? []).includes(id)) names.add(f.name);
  }
  const exempt = new Set(
    [...fns.values()].filter((f) => f.exempt).map((f) => f.name),
  );
  return { writers: [...names].sort(), exempt: [...exempt].sort() };
}
