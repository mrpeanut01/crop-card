/**
 * Custom ESLint rule (32F, F5-5): user-facing English written straight into
 * a Svelte template, in files that have moved onto `t()`.
 *
 * Flags text nodes that contain a letter and literal values of the
 * `aria-label`, `title` and `placeholder` attributes (on elements and
 * components alike). Expressions are left alone, so `{tr('nav.today')}` and
 * `aria-label={tr('nav.more')}` pass. Text inside <style> and <script> is
 * not template text.
 *
 * Options: `{ allow: string[] }` exact trimmed strings that stay as they
 * are (a brand name), `{ attributes: string[] }` to replace the attribute
 * list. Runs at `warn` on opted-in globs only (see apps/web/eslint.config.js).
 */

const DEFAULT_ATTRIBUTES = ['aria-label', 'title', 'placeholder'];
const HAS_LETTER = /\p{L}/u;

function insideRawBlock(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'SvelteStyleElement' || p.type === 'SvelteScriptElement') return true;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow raw user-facing text in Svelte templates that use the i18n catalog.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
          attributes: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: false
      }
    ],
    messages: {
      rawText: 'Raw text "{{text}}": put it in the i18n catalog and render it with t().',
      rawAttribute:
        'Raw {{name}} "{{text}}": put it in the i18n catalog and pass it with {t(...)}.'
    }
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allow = new Set(options.allow ?? []);
    const attributes = new Set(options.attributes ?? DEFAULT_ATTRIBUTES);
    const flagged = (text) => {
      const trimmed = text.trim();
      return trimmed !== '' && HAS_LETTER.test(trimmed) && !allow.has(trimmed) ? trimmed : null;
    };
    const short = (text) => (text.length > 40 ? `${text.slice(0, 37)}...` : text);
    return {
      SvelteText(node) {
        if (insideRawBlock(node)) return;
        const text = flagged(node.value);
        if (text) context.report({ node, messageId: 'rawText', data: { text: short(text) } });
      },
      SvelteAttribute(node) {
        const name = node.key && node.key.name;
        if (typeof name !== 'string' || !attributes.has(name)) return;
        for (const part of node.value ?? []) {
          if (part.type !== 'SvelteLiteral') continue;
          const text = flagged(part.value);
          if (text) {
            context.report({
              node: part,
              messageId: 'rawAttribute',
              data: { name, text: short(text) }
            });
          }
        }
      }
    };
  }
};

export default rule;
