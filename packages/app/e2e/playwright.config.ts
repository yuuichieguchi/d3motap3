import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 60_000,
  globalSetup: require.resolve('./global-setup'),
  use: {
    trace: 'on-first-retry',
  },
  reporter: [['html', { outputFolder: '../playwright-report' }], ['list']],
  outputDir: '../test-results',
});
