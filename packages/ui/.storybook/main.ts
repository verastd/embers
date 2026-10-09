import type { StorybookConfig } from '@storybook/react-vite';

/**
 * PRD 6.5 rule 3 / 5.9: every primitive's story shows every state in both
 * themes. Stories live in src/stories; the preview renders each one in a
 * light pane and a dark pane side by side.
 */
const config: StorybookConfig = {
  stories: ['../src/stories/**/*.stories.@(ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
};

export default config;
