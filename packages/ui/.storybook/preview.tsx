import '../src/styles/embers.css';
import '../src/fonts';

import type { Decorator, Preview } from '@storybook/react-vite';

/** Light and dark, side by side, so no state ships checked in one theme only. */
const bothThemes: Decorator = (Story, ctx) => {
  const only = ctx.globals.theme as 'light' | 'dark' | 'both' | undefined;
  const themes = only === 'light' || only === 'dark' ? [only] : (['light', 'dark'] as const);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${themes.length}, minmax(0, 1fr))`, minHeight: '100vh' }}>
      {themes.map((t) => (
        <div key={t} data-theme={t} className="em-root" style={{ padding: 24, background: 'var(--surface-page)', minHeight: 0 }}>
          <div style={{ font: 'var(--type-eyebrow)', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' }}>{t}</div>
          <Story />
        </div>
      ))}
    </div>
  );
};

const preview: Preview = {
  decorators: [bothThemes],
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['both', 'light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'both' },
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
};

export default preview;
