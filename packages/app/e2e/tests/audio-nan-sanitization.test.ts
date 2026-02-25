/**
 * Audio NaN/Inf Sanitization E2E Tests
 *
 * Verifies that the NaN/Inf audio sample sanitization fix works correctly
 * through the REAL Electron app recording pipeline. NO MOCKS.
 *
 * Background:
 * - macOS ScreenCaptureKit occasionally delivers audio samples containing
 *   NaN or Infinity values, which cause FFmpeg to error with
 *   "Input contains (near) NaN/Inf" and abort the audio encoding pipeline.
 * - The fix sanitizes audio samples before passing them to FFmpeg,
 *   replacing NaN/Inf with 0.0 (silence).
 *
 * These tests record for 5 seconds (longer than the standard 3s) to
 * increase the probability of encountering NaN audio samples from the
 * system audio capture pipeline.
 *
 * Requirements:
 * - macOS with screen capture permission granted
 * - FFmpeg installed and available on PATH
 * - Built app with native addon present in output
 */

/// <reference path="../../src/preload/index.d.ts" />

import { test as base, expect } from '../fixtures/electron-app';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';

// Extend the base test to expose electronApp for stderr capture
const test = base.extend<{ stderrCollector: { lines: string[]; stop: () => void } }>({
  stderrCollector: async ({ electronApp }, use) => {
    const lines: string[] = [];
    const proc = (electronApp as ElectronApplication).process();
    const onData = (data: Buffer) => {
      const text = data.toString('utf-8');
      lines.push(text);
    };
    proc.stderr?.on('data', onData);

    await use({
      lines,
      stop: () => {
        proc.stderr?.off('data', onData);
      },
    });

    // Cleanup listener after test
    proc.stderr?.off('data', onData);
  },
});

test.describe.serial('Audio NaN/Inf Sanitization (real pipeline)', () => {
  const OUTPUT_DIR = join(tmpdir(), 'd3motap3-e2e-nan-audio-test');
  const RECORDING_SECONDS = 5;
  let recordedFilePath: string;

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

  // ==================== System Audio Recording Without NaN Errors ====================

  test('system audio recording completes without NaN errors and produces valid output', async ({
    page,
    stderrCollector,
  }) => {
    test.setTimeout(90000);

    // Clear any prior stderr lines so we only capture this test's output
    stderrCollector.lines.length = 0;

    // Get available displays from the real system
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

      // Start recording WITH system audio enabled — this is the scenario
      // that triggers NaN audio samples from ScreenCaptureKit
      const outputPath = (await page.evaluate(
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
      expect(typeof outputPath).toBe('string');
      expect(outputPath.length).toBeGreaterThan(0);

      // Verify recording state is active
      const isRecording = await page.evaluate(() =>
        window.api.invoke('recording:is-recording-v2'),
      );
      expect(isRecording).toBe(true);

      // Record for 5 seconds — longer duration increases chance of NaN occurrence
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

      // Stop collecting stderr after recording completes
      stderrCollector.stop();

      // ---- Assertions on recording result ----
      expect(result.outputPath).toBeTruthy();
      expect(result.frameCount).toBeGreaterThan(0);
      expect(result.format).toBe('mp4');

      // Verify output file exists and has substantial size (5s video should be > 10KB)
      expect(fs.existsSync(result.outputPath)).toBe(true);
      const stats = fs.statSync(result.outputPath);
      expect(stats.size).toBeGreaterThan(10_000);

      // ---- ffprobe validation: duration ----
      const ffprobeFormatOutput = execSync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${result.outputPath}"`,
        { encoding: 'utf-8' },
      );
      const probeData = JSON.parse(ffprobeFormatOutput);
      const durationSecs = parseFloat(probeData.format.duration);

      // Duration must be at least 3.0s (allowing margin for a 5s recording).
      // The old NaN bug caused recordings to be truncated to ~0.21s.
      expect(durationSecs).toBeGreaterThan(3.0);
      expect(durationSecs).toBeLessThan(15.0);

      // ---- ffprobe validation: AAC audio stream exists ----
      const audioStream = probeData.streams?.find(
        (s: { codec_type: string }) => s.codec_type === 'audio',
      );
      expect(audioStream).toBeTruthy();
      expect(audioStream.codec_name).toBe('aac');

      // ---- NaN/Inf check: stderr must NOT contain NaN-related FFmpeg errors ----
      const allStderr = stderrCollector.lines.join('\n');
      expect(allStderr).not.toContain('NaN');
      expect(allStderr).not.toContain('Input contains (near) NaN');
      expect(allStderr).not.toContain('Infinity');

      // Store the file path for the next test
      recordedFilePath = result.outputPath;
    } finally {
      // Always clean up the source
      await page.evaluate(
        (id) => window.api.invoke('sources:remove', id),
        sourceId,
      );
    }
  });

  // ==================== Recorded Audio Stream Validation ====================

  test('recorded audio stream is valid AAC with correct properties', async () => {
    test.setTimeout(30000);

    // This test depends on the file recorded in test 1
    expect(recordedFilePath).toBeTruthy();
    expect(fs.existsSync(recordedFilePath)).toBe(true);

    // Run ffprobe to get detailed audio stream info
    const ffprobeOutput = execSync(
      `ffprobe -v quiet -print_format json -show_streams -select_streams a:0 "${recordedFilePath}"`,
      { encoding: 'utf-8' },
    );
    const probeData = JSON.parse(ffprobeOutput);

    expect(probeData.streams).toBeDefined();
    expect(probeData.streams.length).toBeGreaterThanOrEqual(1);

    const audioStream = probeData.streams[0];

    // Verify codec is AAC
    expect(audioStream.codec_name).toBe('aac');
    expect(audioStream.codec_type).toBe('audio');

    // Verify sample rate is 48000 Hz (ScreenCaptureKit default)
    expect(audioStream.sample_rate).toBe('48000');

    // Verify audio duration is at least 3.0 seconds
    // Use the stream-level duration if available, otherwise fall back to format duration
    let audioDuration: number;
    if (audioStream.duration) {
      audioDuration = parseFloat(audioStream.duration);
    } else if (audioStream.tags?.DURATION) {
      // Some containers store duration in tags as HH:MM:SS.mmm
      const parts = audioStream.tags.DURATION.split(':');
      audioDuration =
        parseFloat(parts[0]) * 3600 +
        parseFloat(parts[1]) * 60 +
        parseFloat(parts[2]);
    } else {
      // Fall back to computing from nb_frames and sample_rate
      const nbFrames = parseInt(audioStream.nb_frames, 10);
      const sampleRate = parseInt(audioStream.sample_rate, 10);
      // AAC frame = 1024 samples
      audioDuration = (nbFrames * 1024) / sampleRate;
    }

    // Audio duration must be at least 3.0 seconds for a 5-second recording
    expect(audioDuration).toBeGreaterThan(3.0);

    // Verify channels (should be stereo for system audio capture)
    expect(audioStream.channels).toBeGreaterThanOrEqual(1);

    // Verify the audio stream has actual content (not just silence markers)
    // nb_frames or duration_ts should indicate real encoded data
    if (audioStream.nb_frames) {
      const nbFrames = parseInt(audioStream.nb_frames, 10);
      // 5 seconds at 48000 Hz with 1024-sample AAC frames = ~234 frames minimum
      // Allow margin: at least 100 frames for a 3+ second recording
      expect(nbFrames).toBeGreaterThan(100);
    }
  });
});
