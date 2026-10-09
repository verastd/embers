import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

import plugin from './index.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});
const tsx = (code) => ({ code, filename: 'src/app/page.tsx' });

tester.run('no-async-button-click', plugin.rules['no-async-button-click'], {
  valid: [
    tsx('<button onClick={() => setOpen(true)}>Open</button>'),
    tsx('<AsyncButton label="Save" onAction={async () => save()} />'),
    tsx('<Button onClick={async () => save()}>x</Button>'),
    tsx('<button onClick={handler}>x</button>'),
    tsx('<button type="submit">x</button>'),
    tsx('<foo.button onClick={async () => save()} />'),
  ],
  invalid: [
    { ...tsx('<button onClick={async () => { await save(); }}>Save</button>'), errors: [{ messageId: 'useAsyncButton' }] },
    { ...tsx('<button onClick={async function () { await save(); }}>Save</button>'), errors: [{ messageId: 'useAsyncButton' }] },
  ],
});

tester.run('no-raw-fetch', plugin.rules['no-raw-fetch'], {
  valid: [
    { code: 'const r = await fetch(url);', filename: 'src/server/ledger-gateway.ts' },
    tsx('const q = useQuery({ queryKey: ["x"], queryFn: () => client.status() });'),
    tsx('api.fetch(url);'),
    tsx('window["fetch"](url);'),
  ],
  invalid: [
    { ...tsx('useEffect(() => { fetch("/bff/ledger/status"); }, []);'), errors: [{ messageId: 'noFetch' }] },
    { ...tsx('window.fetch(url);'), errors: [{ messageId: 'noFetch' }] },
    { code: 'globalThis.fetch(url);', filename: 'src/x.jsx', errors: [{ messageId: 'noFetch' }] },
  ],
});

tester.run('no-token-literals', plugin.rules['no-token-literals'], {
  valid: [
    tsx('<div style={{ color: "var(--text-primary)", font: "var(--type-body)" }} />'),
    tsx('<div style={{ boxShadow: "var(--elevation-1)", textShadow: "none" }} />'),
    tsx('<a href="/docs#section-a1b2c3">x</a>'),
    tsx('<a href={`https://x.dev/#abc`}>x</a>'),
    tsx('const n = 14; const s = { gap: 12, padding: 16 };'),
    tsx('const s = { fontSize: "var(--text-sm)" };'),
    tsx('const s = { [key]: 1 };'),
    tsx('import x from "#internal";'),
    tsx('const f = { font: `var(--type-${size})` };'),
  ],
  invalid: [
    { ...tsx('<div style={{ color: "#ff6600" }} />'), errors: [{ messageId: 'hex' }] },
    { ...tsx('const c = `1px solid #abc`;'), errors: [{ messageId: 'hex' }] },
    { ...tsx('const s = { fontSize: 14 };'), errors: [{ messageId: 'fontSize' }] },
    { ...tsx('const s = { "fontSize": "13px" };'), errors: [{ messageId: 'fontSize' }] },
    { ...tsx('const s = { font: "600 14px Work Sans" };'), errors: [{ messageId: 'fontSize' }] },
    { ...tsx('const s = { boxShadow: "0 1px 2px black" };'), errors: [{ messageId: 'shadow' }] },
    { ...tsx('const s = { textShadow: `0 0 4px red` };'), errors: [{ messageId: 'shadow' }] },
  ],
});

describe('preset', () => {
  it('turns all three rules on as errors', async () => {
    const { expect } = await import('vitest');
    expect(plugin.configs.feature.rules).toEqual({
      'embers/no-async-button-click': 'error',
      'embers/no-raw-fetch': 'error',
      'embers/no-token-literals': 'error',
    });
  });
});
