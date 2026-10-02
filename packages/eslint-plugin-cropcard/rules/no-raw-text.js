/**
 * Custom ESLint rule (32F F5-5, extended in 34B): user-facing English written
 * straight into a Svelte template on a translated surface.
 *
 * Flags text nodes and literal values of the `aria-label`, `title` and
 * `placeholder` attributes (on elements and components alike) that still hold
 * a word once allowed tokens are dropped. Expressions are left alone, so
 * `{tr('nav.today')}` and `aria-label={tr('nav.more')}` pass. Text inside
 * <style>, <script>, <code>, <pre>, <kbd> and <samp> is not checked.
 *
 * English-by-rule text (safety and regulatory wording, CLAUDE.md invariant 9)
 * is exempted by wrapping it in a native element that carries both a static
 * `lang="en"` and `data-english-only="<reason>"` (rulings B34-07 to B34-09).
 * Everything inside that element is skipped. The rule reports the marker on a
 * component, without `lang="en"`, or with a reason outside `reasons`.
 *
 * Options:
 * - `allow`: exact trimmed strings that stay as they are (a brand name).
 * - `allowWords`: whole tokens (after trimming surrounding punctuation) that
 *   are dropped before deciding, such as units and acronyms.
 * - `attributes`: replaces the attribute list.
 * - `reasons`: allowed `data-english-only` values, default DEFAULT_REASONS,
 *   which must match ENGLISH_ONLY_REASONS in apps/web/src/lib/i18n/englishOnly.ts.
 */

export const DEFAULT_REASONS = ["safety", "regulatory"];
const DEFAULT_ATTRIBUTES = ["aria-label", "title", "placeholder"];
const RAW_TAGS = new Set(["code", "pre", "kbd", "samp"]);
const HAS_LETTER = /\p{L}/u;
const EDGE_PUNCT = /^[·•—–\-:()[\],.→↑↗/]+|[·•—–\-:()[\],.→↑↗/]+$/gu;
const DOMAIN = /^[\p{L}\d_-]+(\.[\p{L}\d_-]+)+$/u;
const MARKER = "data-english-only";

function attrName(attr) {
  return attr && attr.type === "SvelteAttribute" && attr.key
    ? attr.key.name
    : null;
}

/** Static string value of an attribute, or null when it has expressions. */
function staticValue(attr) {
  const parts = attr.value ?? [];
  if (parts.length === 0) return "";
  if (parts.every((p) => p.type === "SvelteLiteral"))
    return parts.map((p) => p.value).join("");
  return null;
}

function findAttr(element, name) {
  return (
    (element.startTag?.attributes ?? []).find((a) => attrName(a) === name) ??
    null
  );
}

function elementName(element) {
  const n = element.name;
  return n && typeof n.name === "string" ? n.name : "";
}

function isNative(element) {
  return element.kind === "html";
}

/** A native element with static lang="en" and an allowed marker reason. */
function isExemptRegion(element, reasons) {
  if (!isNative(element)) return false;
  const marker = findAttr(element, MARKER);
  if (!marker) return false;
  const lang = findAttr(element, "lang");
  if (!lang || staticValue(lang) !== "en") return false;
  const reason = staticValue(marker);
  return reason !== null && reasons.has(reason);
}

function skipped(node, reasons) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "SvelteStyleElement" || p.type === "SvelteScriptElement")
      return true;
    if (p.type === "SvelteElement") {
      if (isNative(p) && RAW_TAGS.has(elementName(p))) return true;
      if (isExemptRegion(p, reasons)) return true;
    }
  }
  return false;
}

function droppable(rawToken, allowWords) {
  if (rawToken.includes("/")) return true;
  const token = rawToken.replace(EDGE_PUNCT, "");
  if (token === "") return true;
  if (allowWords.has(token)) return true;
  if (DOMAIN.test(token)) return true;
  return !HAS_LETTER.test(token);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw user-facing text in Svelte templates that use the i18n catalog.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
          allowWords: { type: "array", items: { type: "string" } },
          attributes: { type: "array", items: { type: "string" } },
          reasons: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawText:
        'Raw text "{{text}}": put it in the i18n catalog and render it with t().',
      rawAttribute:
        'Raw {{name}} "{{text}}": put it in the i18n catalog and pass it with {t(...)}.',
      missingLang:
        'data-english-only needs a static lang="en" on the same element, so screen readers read it as English.',
      badReason:
        'data-english-only="{{reason}}" is not an allowed reason ({{allowed}}).',
      onComponent:
        "data-english-only only works on a native element. Wrap the component in a <span> or <div> that carries it.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allow = new Set(options.allow ?? []);
    const allowWords = new Set(options.allowWords ?? []);
    const attributes = new Set(options.attributes ?? DEFAULT_ATTRIBUTES);
    const reasons = new Set(options.reasons ?? DEFAULT_REASONS);
    const flagged = (text) => {
      const trimmed = text.trim();
      if (trimmed === "" || !HAS_LETTER.test(trimmed) || allow.has(trimmed))
        return null;
      const words = trimmed.split(/\s+/u);
      return words.every((w) => droppable(w, allowWords)) ? null : trimmed;
    };
    const short = (text) =>
      text.length > 40 ? `${text.slice(0, 37)}...` : text;
    return {
      SvelteText(node) {
        if (skipped(node, reasons)) return;
        const text = flagged(node.value);
        if (text)
          context.report({
            node,
            messageId: "rawText",
            data: { text: short(text) },
          });
      },
      SvelteAttribute(node) {
        const name = attrName(node);
        if (typeof name !== "string") return;
        const element = node.parent && node.parent.parent;
        if (name === MARKER && element && element.type === "SvelteElement") {
          if (!isNative(element)) {
            context.report({ node, messageId: "onComponent" });
            return;
          }
          const lang = findAttr(element, "lang");
          if (!lang || staticValue(lang) !== "en") {
            context.report({ node, messageId: "missingLang" });
          }
          const reason = staticValue(node);
          if (reason === null || !reasons.has(reason)) {
            context.report({
              node,
              messageId: "badReason",
              data: {
                reason: reason ?? "{...}",
                allowed: [...reasons].join(", "),
              },
            });
          }
          return;
        }
        if (!attributes.has(name)) return;
        if (skipped(node, reasons)) return;
        for (const part of node.value ?? []) {
          if (part.type !== "SvelteLiteral") continue;
          const text = flagged(part.value);
          if (text) {
            context.report({
              node: part,
              messageId: "rawAttribute",
              data: { name, text: short(text) },
            });
          }
        }
      },
    };
  },
};

export default rule;
