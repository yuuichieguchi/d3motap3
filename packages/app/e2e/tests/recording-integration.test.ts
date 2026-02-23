/**
 * Recording Pipeline Integration Tests
 *
 * These tests exercise the REAL recording pipeline through actual IPC handlers
 * backed by the Rust core. No mocking is used.
 *
 * Requirements:
 * - macOS with screen capture permission granted to the Electron app
 * - FFmpeg installed and available on PATH
 * - Built native addon (.node) present in the app output
 */

/// <reference path="../../src/preload/index.d.ts" />

import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import type { DisplayInfo, RecordingResultInfo, SourceInfoJs } from '@d3motap3/core';
import fs from 'node:fs';

// ==================== Helpers ====================

async function getDisplays(page: Page): Promise<DisplayInfo[]> {
  return await page.evaluate(() => window.api.invoke('recording:list-displays')) as DisplayInfo[];
}

async function addDisplaySource(page: Page, display: DisplayInfo): Promise<number> {
  const displayConfig = JSON.stringify({
    type: 'Display',
    display_index: 0,
    width: display.width,
    height: display.height,
  });
  return await page.evaluate(async ([type, config]) => {
    return await window.api.invoke('sources:add', type, config);
  }, ['display', displayConfig]) as number;
}

test.describe.serial('Recording Pipeline Integration', () => {
  const RECORDING_DURATION_MS = 3000;

  // ==================== FFmpeg Detection ====================

  test('FFmpeg is available', async ({ page }) => {
    const available = await page.evaluate(() => window.api.invoke('system:ffmpeg-available'));
    expect(available).toBe(true);

    const version = await page.evaluate(() => window.api.invoke('system:ffmpeg-version'));
    expect(typeof version).toBe('string');
    expect((version as string).length).toBeGreaterThan(0);
  });

  // ==================== Display List ====================

  test('lists available displays', async ({ page }) => {
    const displays = await getDisplays(page);

    expect(Array.isArray(displays)).toBe(true);
    expect(displays.length).toBeGreaterThanOrEqual(1);

    for (const display of displays) {
      expect(typeof display.id).toBe('number');
      expect(typeof display.width).toBe('number');
      expect(display.width).toBeGreaterThan(0);
      expect(typeof display.height).toBe('number');
      expect(display.height).toBeGreaterThan(0);
    }
  });

  // ==================== Error Path ====================

  test('rejects stop when not recording', async ({ page }) => {
    await expect(
      page.evaluate(() => window.api.invoke('recording:stop'))
    ).rejects.toThrow();
  });

  // ==================== V1 Recording ====================

  test('V1: records display and produces output file', async ({ page }) => {
    test.setTimeout(60000);

    // Get available displays
    const displays = await getDisplays(page);
    expect(displays.length).toBeGreaterThanOrEqual(1);
    const display = displays[0];

    // Build recording config
    const config = {
      displayIndex: 0,
      width: display.width,
      height: display.height,
      fps: 30,
      format: 'mp4',
      quality: 'medium',
    };

    // Start recording
    const outputPath = await page.evaluate(async (cfg) => {
      return await window.api.invoke('recording:start', cfg);
    }, config) as string;
    expect(typeof outputPath).toBe('string');
    expect(outputPath.length).toBeGreaterThan(0);

    // Verify recording state
    const isRecording = await page.evaluate(() => window.api.invoke('recording:is-recording'));
    expect(isRecording).toBe(true);

    // Wait for recording to accumulate frames
    await page.waitForTimeout(RECORDING_DURATION_MS);

    // Check elapsed time
    const elapsed = await page.evaluate(() => window.api.invoke('recording:elapsed')) as number;
    expect(elapsed).toBeGreaterThan(0);

    // Stop recording
    const result = await page.evaluate(() => window.api.invoke('recording:stop')) as RecordingResultInfo;
    expect(result.outputPath).toBeTruthy();
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.format).toBe('mp4');

    // Verify output file exists and has content (using test runner's Node.js context)
    expect(fs.existsSync(result.outputPath)).toBe(true);
    const stats = fs.statSync(result.outputPath);
    expect(stats.size).toBeGreaterThan(0);

    // Verify MP4 magic bytes (ftyp)
    const header = Buffer.alloc(8);
    const fd = fs.openSync(result.outputPath, 'r');
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    expect(header.toString('ascii', 4, 8)).toBe('ftyp');

    // Cleanup: delete the output file
    try {
      fs.unlinkSync(result.outputPath);
    } catch (e) {
      console.warn('Failed to clean up test file:', result.outputPath, e);
    }
  });

  // ==================== V2 Multi-Source Recording ====================

  test('V2: multi-source recording with display source', async ({ page }) => {
    test.setTimeout(60000);

    // Get available displays
    const displays = await getDisplays(page);
    expect(displays.length).toBeGreaterThanOrEqual(1);

    // Add display source
    const sourceId = await addDisplaySource(page, displays[0]);
    expect(typeof sourceId).toBe('number');

    let result: RecordingResultInfo;
    try {
      // Set layout to Single (requires source ID from the added source)
      await page.evaluate(async (layoutJson) => {
        return await window.api.invoke('layout:set', layoutJson);
      }, JSON.stringify({ type: 'Single', source: sourceId }));

      // Start V2 recording
      const v2Config = {
        outputWidth: 1920,
        outputHeight: 1080,
        fps: 30,
        format: 'mp4',
        quality: 'medium',
      };
      const outputPath = await page.evaluate(async (cfg) => {
        return await window.api.invoke('recording:start-v2', cfg);
      }, v2Config) as string;
      expect(typeof outputPath).toBe('string');
      expect(outputPath.length).toBeGreaterThan(0);

      // Verify V2 recording state
      const isRecording = await page.evaluate(() => window.api.invoke('recording:is-recording-v2'));
      expect(isRecording).toBe(true);

      // Wait for recording to accumulate frames
      await page.waitForTimeout(RECORDING_DURATION_MS);

      // Check V2 elapsed time
      const elapsed = await page.evaluate(() => window.api.invoke('recording:elapsed-v2')) as number;
      expect(elapsed).toBeGreaterThan(0);

      // Stop V2 recording
      result = await page.evaluate(() => window.api.invoke('recording:stop-v2')) as RecordingResultInfo;
      expect(result.outputPath).toBeTruthy();
      expect(result.frameCount).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.format).toBe('mp4');

      // Verify output file exists and has content (using test runner's Node.js context)
      expect(fs.existsSync(result.outputPath)).toBe(true);
      const stats = fs.statSync(result.outputPath);
      expect(stats.size).toBeGreaterThan(0);

      // Verify MP4 magic bytes (ftyp)
      const header = Buffer.alloc(8);
      const fd = fs.openSync(result.outputPath, 'r');
      fs.readSync(fd, header, 0, 8, 0);
      fs.closeSync(fd);
      expect(header.toString('ascii', 4, 8)).toBe('ftyp');
    } finally {
      // Remove the source
      await page.evaluate(async (id) => {
        return await window.api.invoke('sources:remove', id);
      }, sourceId);

      // Cleanup: delete the output file
      // @ts-expect-error result may be unassigned if recording failed before stop
      if (result?.outputPath) {
        try {
          // @ts-expect-error result is checked above
          fs.unlinkSync(result.outputPath);
        } catch (e) {
          // @ts-expect-error result is checked above
          console.warn('Failed to clean up test file:', result.outputPath, e);
        }
      }
    }
  });

  // ==================== Source Management ====================

  test('manages sources: add, list, remove', async ({ page }) => {
    // Get available displays
    const displays = await getDisplays(page);
    expect(displays.length).toBeGreaterThanOrEqual(1);

    // Add a display source
    const sourceId = await addDisplaySource(page, displays[0]);
    expect(typeof sourceId).toBe('number');

    // List sources and verify the added source is present
    const sourcesAfterAdd = await page.evaluate(() => window.api.invoke('sources:list')) as SourceInfoJs[];
    expect(Array.isArray(sourcesAfterAdd)).toBe(true);
    const found = sourcesAfterAdd.find((s) => s.id === sourceId);
    expect(found).toBeDefined();

    // Remove the source
    await page.evaluate(async (id) => {
      return await window.api.invoke('sources:remove', id);
    }, sourceId);

    // List sources and verify it is gone
    const sourcesAfterRemove = await page.evaluate(() => window.api.invoke('sources:list')) as SourceInfoJs[];
    const notFound = sourcesAfterRemove.find((s) => s.id === sourceId);
    expect(notFound).toBeUndefined();
  });
});
