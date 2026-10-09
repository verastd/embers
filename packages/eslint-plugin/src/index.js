/**
 * @embers/eslint-plugin: the lint half of PRD §5.9 ("disallow raw
 * `<button onClick={async ...}>` and raw `fetch` in components") and §6.5
 * rule 1 ("no hex values, px font sizes, or ad hoc shadows in feature code").
 *
 * Feature code is `apps/web`; the design system's own package is exempt from
 * the token rule (it is where the tokens are applied).
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const PX = /\b\d+(?:\.\d+)?px\b/;
const isFn = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression');

/** <button onClick={async () => …}>: no pending/error state. Use AsyncButton. */
const noAsyncButtonClick = {
  meta: {
    type: 'problem',
    docs: { description: 'Async click handlers on raw <button> must use AsyncButton (PRD 5.2)' },
    messages: {
      useAsyncButton: 'An async onClick on a raw <button> shows no pending, slow or error state. Use AsyncButton from @embers/ui (PRD 5.2).',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'onClick') return;
        const el = node.parent;
        if (!el || el.type !== 'JSXOpeningElement' || el.name.type !== 'JSXIdentifier' || el.name.name !== 'button') return;
        const v = node.value;
        if (v && v.type === 'JSXExpressionContainer' && isFn(v.expression) && v.expression.async) {
          context.report({ node, messageId: 'useAsyncButton' });
        }
      },
    };
  },
};

/** fetch() in a component file: bypasses TanStack Query + DataState. */
const noRawFetch = {
  meta: {
    type: 'problem',
    docs: { description: 'No raw fetch in components; read through TanStack Query hooks wrapped by DataState (PRD 5.9)' },
    messages: {
      noFetch: 'Raw fetch in a component has no loading, error or empty state. Use a TanStack Query hook (and DataState), or move the call to server code (PRD 5.9).',
    },
    schema: [],
  },
  create(context) {
    const file = context.filename ?? context.getFilename();
    if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) return {};
    const isFetch = (callee) =>
      (callee.type === 'Identifier' && callee.name === 'fetch') ||
      (callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'fetch' &&
        callee.object.type === 'Identifier' &&
        (callee.object.name === 'window' || callee.object.name === 'globalThis'));
    return {
      CallExpression(node) {
        if (isFetch(node.callee)) context.report({ node, messageId: 'noFetch' });
      },
    };
  },
};

/** Hex colors, px font sizes and literal shadows belong to the tokens package. */
const noTokenLiterals = {
  meta: {
    type: 'problem',
    docs: { description: 'No hex colors, px font sizes or ad hoc shadows in feature code (PRD 6.5 rule 1)' },
    messages: {
      hex: 'Hex color "{{value}}" in feature code. Use a semantic token, e.g. var(--text-primary) (PRD 6.5).',
      fontSize: 'Literal font size in feature code. Use a type token, e.g. font: var(--type-body) (PRD 6.5).',
      shadow: 'Ad hoc shadow in feature code. Use an elevation token, e.g. var(--elevation-1) (PRD 6.5).',
    },
    schema: [],
  },
  create(context) {
    const text = (n) => (n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateLiteral' ? n.quasis.map((q) => q.value.cooked ?? '').join('') : null);
    const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null);
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const m = HEX.exec(node.value);
        // Skip import specifiers and URL fragments like "/x#section".
        if (m && node.parent?.type !== 'ImportDeclaration' && !/^[/.]|^https?:/.test(node.value)) {
          context.report({ node, messageId: 'hex', data: { value: m[0] } });
        }
      },
      TemplateLiteral(node) {
        const s = text(node);
        const m = s && HEX.exec(s);
        if (m && !/^[/.]|^https?:/.test(s)) context.report({ node, messageId: 'hex', data: { value: m[0] } });
      },
      Property(node) {
        const k = keyName(node);
        if (!k) return;
        const v = node.value;
        if (k === 'fontSize' && (v.type === 'Literal' ? typeof v.value === 'number' || (typeof v.value === 'string' && PX.test(v.value)) : false)) {
          context.report({ node, messageId: 'fontSize' });
        }
        if (k === 'font') {
          const s = text(v);
          if (s && PX.test(s) && !s.includes('var(')) context.report({ node, messageId: 'fontSize' });
        }
        if (k === 'boxShadow' || k === 'textShadow') {
          const s = text(v);
          if (s && s !== 'none' && !/^\s*var\(--[\w-]+\)\s*$/.test(s)) context.report({ node, messageId: 'shadow' });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: '@embers/eslint-plugin', version: '0.0.0' },
  rules: {
    'no-async-button-click': noAsyncButtonClick,
    'no-raw-fetch': noRawFetch,
    'no-token-literals': noTokenLiterals,
  },
};

/** Flat-config preset for feature code. */
plugin.configs = {
  feature: {
    plugins: { embers: plugin },
    rules: {
      'embers/no-async-button-click': 'error',
      'embers/no-raw-fetch': 'error',
      'embers/no-token-literals': 'error',
    },
  },
};

export default plugin;
