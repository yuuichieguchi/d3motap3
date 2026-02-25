import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';

/**
 * Test: Source reorder persistence across tab switches.
 *
 * When a user reorders sources via drag-and-drop in the Recording view,
 * the new order must persist after switching to the Editor tab and back.
 *
 * The SourcePanel component unmounts when the user navigates to Editor and
 * remounts on return. On remount, refreshSources() fetches from the backend
 * and mergeSourcesPreservingOrder() should keep the user's ordering.
 *
 * This test verifies that the reordered state survives the unmount/remount cycle.
 */

test.describe('Source reorder persistence', () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss any leftover dialog from previous tests via the Cancel button
    const closeBtn = page.locator(S.dialogCloseBtn);
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click();
      await page.locator(S.dialogOverlay).waitFor({ state: 'hidden' });
    }
    // Ensure we are on the Recording tab
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click();
    // Remove any existing sources so we start clean
    while (await page.locator(S.sourceRemoveBtn).count() > 0) {
      await page.locator(S.sourceRemoveBtn).first().click();
      await page.waitForTimeout(300);
    }
  });

  test('reordered sources persist after tab switch', async ({ page }) => {
    // ------------------------------------------------------------------
    // Step 1: Add first source (Display)
    // ------------------------------------------------------------------
    await page.locator(S.addSourceBtn).click();
    await page.locator(S.dialog).waitFor({ state: 'visible' });

    // Explicitly select Display type (may be set to Region from a prior test,
    // which adds a second select; use .first() to target the type dropdown)
    await page.locator(`${S.dialog} select`).first().selectOption('Display');
    await page.locator(S.sourceOptionBtn).first().click();
    await page.locator(S.dialog).waitFor({ state: 'hidden' });

    // Wait for the source to appear in the panel
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 });

    // ------------------------------------------------------------------
    // Step 2: Add second source (Terminal)
    // ------------------------------------------------------------------
    await page.locator(S.addSourceBtn).click();
    await page.locator(S.dialog).waitFor({ state: 'visible' });

    // Select Terminal from the type dropdown
    await page.locator(`${S.dialog} select`).selectOption('Terminal');

    // Click "Default Terminal (zsh, 80x24)"
    await page.locator(S.sourceOptionBtn).first().click();
    await page.locator(S.dialog).waitFor({ state: 'hidden' });

    // ------------------------------------------------------------------
    // Step 3: Wait for both sources to appear
    // ------------------------------------------------------------------
    await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10_000 });

    // ------------------------------------------------------------------
    // Step 4: Record initial source names in their current order
    // ------------------------------------------------------------------
    const namesBefore = await page.locator('.source-name').allTextContents();
    expect(namesBefore).toHaveLength(2);
    const [first, second] = namesBefore;

    // Sanity: the two sources should have different names
    expect(first).not.toEqual(second);

    // ------------------------------------------------------------------
    // Step 5: Reorder sources (swap index 0 and 1)
    //
    // Playwright's locator.dragTo() dispatches real pointer + drag events.
    // In Electron, window-level mousemove during drag is unreliable, but
    // dragTo() uses a higher-level protocol and works for simple cases.
    //
    // We drag from the first source's drag handle onto the second
    // source item, which triggers onDrop -> reorderSources(0, 1).
    // ------------------------------------------------------------------
    const firstHandle = page.locator('.source-drag-handle').first();
    const secondItem = page.locator(S.sourceItem).nth(1);

    await firstHandle.dragTo(secondItem);

    // Allow React to re-render after the state update
    await page.waitForTimeout(500);

    // ------------------------------------------------------------------
    // Step 6: Verify order changed
    // ------------------------------------------------------------------
    const namesAfterReorder = await page.locator('.source-name').allTextContents();
    expect(namesAfterReorder).toEqual([second, first]);

    // ------------------------------------------------------------------
    // Step 7: Switch to Editor tab
    // ------------------------------------------------------------------
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click();

    // Verify the Editor view rendered (SourcePanel is now unmounted)
    await page.locator(S.editorView).waitFor({ state: 'visible', timeout: 10_000 });

    // ------------------------------------------------------------------
    // Step 8: Switch back to Recording tab
    // ------------------------------------------------------------------
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click();

    // Wait for SourcePanel to remount and refreshSources() to complete
    await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10_000 });

    // ------------------------------------------------------------------
    // Step 9: Verify the reordered order is preserved
    //
    // This is the critical assertion. After SourcePanel remounts, it calls
    // refreshSources() which fetches from the backend. The backend returns
    // sources in its own order. mergeSourcesPreservingOrder() must keep
    // the user's reordered sequence from the Zustand store.
    // ------------------------------------------------------------------
    const namesAfterTabSwitch = await page.locator('.source-name').allTextContents();
    expect(namesAfterTabSwitch).toEqual([second, first]);
  });
});
