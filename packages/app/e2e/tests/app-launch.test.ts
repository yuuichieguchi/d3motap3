import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';

test.describe('App Launch', () => {
  test('Header displays app title', async ({ page }) => {
    const title = page.locator(S.appTitle);
    await expect(title).toContainText('d3motap3');
  });

test('Empty source state', async ({ page }) => {
    const emptyMessage = page.locator(S.emptyMessage);
    await expect(emptyMessage).toBeVisible();
    await expect(emptyMessage).toContainText('No sources added');
  });

  test('Preview shows placeholder', async ({ page }) => {
    const placeholder = page.locator(S.previewPlaceholder);
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Add a source to see preview');
  });

  test('Default layout is Single', async ({ page }) => {
    const selected = page.locator(S.layoutOptionSelected);
    await expect(selected).toBeVisible();
    await expect(selected).toContainText('Single');
  });

  test('Window size is at least 960x600', async ({ page }) => {
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(size.width).toBeGreaterThanOrEqual(960);
    expect(size.height).toBeGreaterThanOrEqual(600);
  });
});
