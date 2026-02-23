import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'path';

interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
}

export const test = base.extend<Pick<ElectronFixtures, 'page'>, Pick<ElectronFixtures, 'electronApp'>>({
  electronApp: [
    async ({}, use) => {
      const electronApp = await _electron.launch({
        args: [resolve(__dirname, '../../out/main/index.js')],
        env: { ...process.env, NODE_ENV: 'production' },
      });

      await electronApp.firstWindow();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await use(electronApp);

      await electronApp.close();
    },
    { scope: 'worker' },
  ],

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    await page.locator('.app-header').waitFor({ state: 'visible', timeout: 30000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';
