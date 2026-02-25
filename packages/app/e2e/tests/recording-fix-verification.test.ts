/**
 * Recording Fix Verification Tests
 *
 * Verifies two critical fixes against the REAL recording pipeline:
 * 1. The 0.21s duration bug — recordings must produce correct durations
 * 2. FFmpeg 8.x MJPEG thumbnail compatibility — thumbnail generation must work
 *
 * These tests use the REAL Electron app with NO mocks.
 * All IPC calls go through actual Rust native handlers.
 *
 * Requirements:
 * - macOS with screen capture permission granted
 * - FFmpeg installed and available on PATH
 * - Built app with native addon present in output
 */

/// <reference path="../../src/preload/index.d.ts" />

import { test, expect } from '../fixtures/electron-app';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe.serial('Recording Fix Verification (real pipeline)', () => {
  const OUTPUT_DIR = join(tmpdir(), 'd3motap3-e2e-recording-fix-test');
  const RECORDING_SECONDS = 3;
  let outputPath: string;
  let audioOutputPath: string;

  test.beforeAll(() => {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
  });

  test.afterAll(() => {
    try {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  // ==================== FFmpeg Detection ====================

  test('FFmpeg is available', async ({ page }) => {
    const available = await page.evaluate(() => window.api.invoke('system:ffmpeg-available'));
    expect(available).toBe(true);
  });

  // ==================== Recording Duration Fix ====================

  test('records 3 seconds without audio and produces valid MP4 with correct duration', async ({
    page,
  }) => {
    test.setTimeout(60000);

    // Get available displays from real system
    const displays = (await page.evaluate(() =>
      window.api.invoke('recording:list-displays'),
    )) as Array<{ id: number; width: number; height: number }>;
    expect(displays.length).toBeGreaterThanOrEqual(1);
    const display = displays[0];

    // Add a real display source
    const displayConfig = JSON.stringify({
      type: 'Display',
      display_index: 0,
      width: display.width,
      height: display.height,
    });
    const sourceId = (await page.evaluate(
      ([type, config]) => window.api.invoke('sources:add', type, config),
      ['display', displayConfig],
    )) as number;
    expect(typeof sourceId).toBe('number');

    try {
      // Set layout to single source
      await page.evaluate(
        (layoutJson) => window.api.invoke('layout:set', layoutJson),
        JSON.stringify({ type: 'Single', source: sourceId }),
      );

      // Start recording — NO audio capture to avoid permission issues in CI
      outputPath = (await page.evaluate(
        (cfg) => window.api.invoke('recording:start-v2', cfg),
        {
          outputWidth: 1280,
          outputHeight: 720,
          fps: 30,
          format: 'mp4',
          quality: 'low',
          outputDir: OUTPUT_DIR,
          captureSystemAudio: false,
          captureMicrophone: false,
        },
      )) as string;
      expect(typeof outputPath).toBe('string');
      expect(outputPath.length).toBeGreaterThan(0);

      // Verify recording state is active
      const isRecording = await page.evaluate(() =>
        window.api.invoke('recording:is-recording-v2'),
      );
      expect(isRecording).toBe(true);

      // Wait for the desired recording duration
      await page.waitForTimeout(RECORDING_SECONDS * 1000);

      // Stop recording and collect result
      const result = (await page.evaluate(() =>
        window.api.invoke('recording:stop-v2'),
      )) as {
        outputPath: string;
        frameCount: number;
        durationMs: number;
        format: string;
      };
      expect(result.outputPath).toBeTruthy();
      expect(result.frameCount).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.format).toBe('mp4');

      // Verify file exists and has substantial size (3s video should be > 10KB)
      expect(fs.existsSync(result.outputPath)).toBe(true);
      const stats = fs.statSync(result.outputPath);
      expect(stats.size).toBeGreaterThan(10_000);

      // KEY CHECK: Verify duration with ffprobe
      // The bug was producing 0.21s files — we require at least 2s (allowing margin for a 3s recording)
      const ffprobeOutput = execSync(
        `ffprobe -v quiet -print_format json -show_format "${result.outputPath}"`,
        { encoding: 'utf-8' },
      );
      const probeData = JSON.parse(ffprobeOutput);
      const durationSecs = parseFloat(probeData.format.duration);
      expect(durationSecs).toBeGreaterThan(2.0);
      expect(durationSecs).toBeLessThan(10.0);

      outputPath = result.outputPath;
    } finally {
      // Always clean up the source
      await page.evaluate(
        (id) => window.api.invoke('sources:remove', id),
        sourceId,
      );
    }
  });

  // ==================== System Audio Recording (the actual 0.21s bug) ====================

  test('records 3 seconds WITH system audio — the core 0.21s bug scenario', async ({
    page,
  }) => {
    test.setTimeout(60000);

    const displays = (await page.evaluate(() =>
      window.api.invoke('recording:list-displays'),
    )) as Array<{ id: number; width: number; height: number }>;
    expect(displays.length).toBeGreaterThanOrEqual(1);
    const display = displays[0];

    const displayConfig = JSON.stringify({
      type: 'Display',
      display_index: 0,
      width: display.width,
      height: display.height,
    });
    const sourceId = (await page.evaluate(
      ([type, config]) => window.api.invoke('sources:add', type, config),
      ['display', displayConfig],
    )) as number;

    try {
      await page.evaluate(
        (layoutJson) => window.api.invoke('layout:set', layoutJson),
        JSON.stringify({ type: 'Single', source: sourceId }),
      );

      // Start recording WITH system audio — this is the scenario that caused 0.21s files
      audioOutputPath = (await page.evaluate(
        (cfg) => window.api.invoke('recording:start-v2', cfg),
        {
          outputWidth: 1280,
          outputHeight: 720,
          fps: 30,
          format: 'mp4',
          quality: 'low',
          outputDir: OUTPUT_DIR,
          captureSystemAudio: true,
          captureMicrophone: false,
        },
      )) as string;

      const isRecording = await page.evaluate(() =>
        window.api.invoke('recording:is-recording-v2'),
      );
      expect(isRecording).toBe(true);

      await page.waitForTimeout(RECORDING_SECONDS * 1000);

      // Stop recording — this may fail if FFmpeg still exits early.
      // The error message (now propagated instead of swallowed) tells us what went wrong.
      const result = (await page.evaluate(() =>
        window.api.invoke('recording:stop-v2'),
      )) as {
        outputPath: string;
        frameCount: number;
        durationMs: number;
        format: string;
      };

      expect(result.outputPath).toBeTruthy();
      expect(result.frameCount).toBeGreaterThan(0);
      expect(result.format).toBe('mp4');

      // Verify with ffprobe — the file must NOT be 0.21s
      expect(fs.existsSync(result.outputPath)).toBe(true);
      const ffprobeOutput = execSync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${result.outputPath}"`,
        { encoding: 'utf-8' },
      );
      const probeData = JSON.parse(ffprobeOutput);
      const durationSecs = parseFloat(probeData.format.duration);

      // Core assertion: recording must be at least 2 seconds, not 0.21s
      expect(durationSecs).toBeGreaterThan(2.0);

      // Verify audio stream exists (proves audio pipeline worked end-to-end)
      const audioStream = probeData.streams?.find(
        (s: { codec_type: string }) => s.codec_type === 'audio',
      );
      expect(audioStream).toBeTruthy(); // Audio stream MUST be present
      expect(audioStream.codec_name).toBe('aac');

      audioOutputPath = result.outputPath;
      outputPath = result.outputPath;
    } finally {
      await page.evaluate(
        (id) => window.api.invoke('sources:remove', id),
        sourceId,
      );
    }
  });

  // ==================== FFmpeg 8.x Thumbnail Compatibility ====================

  test('generates thumbnails from recorded file (FFmpeg 8.x MJPEG compatibility)', async ({
    page,
  }) => {
    test.setTimeout(30000);

    // This test depends on the file recorded in the previous test
    expect(outputPath).toBeTruthy();
    expect(fs.existsSync(outputPath)).toBe(true);

    // Probe the recorded file through the real editor:probe handler
    // NAPI converts snake_case to camelCase
    const metadata = (await page.evaluate(
      (path) => window.api.invoke('editor:probe', path),
      outputPath,
    )) as {
      durationMs: number;
      width: number;
      height: number;
      fps: number;
      codec: string;
    };
    expect(metadata.durationMs).toBeGreaterThan(2000);
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);

    // Generate thumbnails — this was failing with FFmpeg 8.x MJPEG codec error before the fix
    // Electron IPC serializes Buffer to {type: 'Buffer', data: [...]} or Uint8Array.
    // Inspect the first item to determine the actual shape.
    const thumbInfo = await page.evaluate(
      ([path, count, width]) => {
        return window.api.invoke('editor:thumbnails', path, count, width).then((thumbs: any) => {
          if (!Array.isArray(thumbs)) return { error: `not array: ${typeof thumbs}` };
          const first = thumbs[0];
          return {
            count: thumbs.length,
            firstType: typeof first,
            firstConstructor: first?.constructor?.name,
            firstHasLength: 'length' in (first ?? {}),
            firstHasByteLength: 'byteLength' in (first ?? {}),
            firstHasData: 'data' in (first ?? {}),
            firstDataType: first?.data ? typeof first.data : 'none',
            firstDataLength: first?.data?.length ?? -1,
            firstProto: Object.getPrototypeOf(first)?.constructor?.name,
            firstJSON: JSON.stringify(first)?.slice(0, 200),
          };
        });
      },
      [outputPath, 1, 320] as const,
    ) as any;

    // Thumbnails were generated — MJPEG fix works. Assert count and data presence.
    expect(thumbInfo.count).toBeGreaterThanOrEqual(1);
    // The actual data must be present in some form
    const hasData = thumbInfo.firstDataLength > 100
      || (thumbInfo.firstHasLength && thumbInfo.firstType !== 'object')
      || thumbInfo.firstHasByteLength;
    expect(hasData).toBe(true);
  });
});
