import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { spawn, type ChildProcess, execFileSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  'ffmpeg',
]

function findFfmpeg(): string {
  for (const p of FFMPEG_PATHS) {
    try {
      execFileSync(p, ['-version'], { stdio: 'ignore' })
      return p
    } catch {}
  }
  throw new Error('ffmpeg not found')
}

function generateTestTone(): string {
  const ffmpeg = findFfmpeg()
  const outputPath = join(tmpdir(), 'd3motap3-test-tone.wav')
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
    '-ac', '2', '-ar', '48000', outputPath,
  ], { stdio: 'ignore' })
  return outputPath
}

test.describe('Audio Recording E2E', () => {
  let testTonePath: string

  test.beforeAll(() => {
    testTonePath = generateTestTone()
  })

  test.afterAll(() => {
    try { unlinkSync(testTonePath) } catch {}
  })

  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs
    const closeBtn = page.locator(S.dialogCloseBtn)
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click()
      await page.locator(S.dialogOverlay).waitFor({ state: 'hidden' })
    }
    // Ensure Recording tab is active
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    // Turn OFF audio toggles if left on by previous test
    for (const label of ['Microphone', 'System Audio']) {
      const group = page.locator('.control-group.toggle').filter({ hasText: label })
      if (await group.locator('input[type="checkbox"]').isChecked().catch(() => false)) {
        await group.locator('.toggle-switch').click()
        await page.waitForTimeout(200)
      }
    }
    // Remove existing sources
    while (await page.locator(S.sourceRemoveBtn).count() > 0) {
      await page.locator(S.sourceRemoveBtn).first().click()
      await page.waitForTimeout(300)
    }
  })

  test('Microphone recording with Jabra completes without NaN/Inf error', async ({ electronApp, page }) => {
    const stderrChunks: string[] = []
    const stdoutChunks: string[] = []
    const proc = electronApp.process()
    const onStderr = (data: Buffer) => { stderrChunks.push(data.toString()) }
    const onStdout = (data: Buffer) => { stdoutChunks.push(data.toString()) }
    proc.stderr?.on('data', onStderr)
    proc.stdout?.on('data', onStdout)

    try {
      // Step 1: Add a Display source via UI
      await page.locator(S.addSourceBtn).click()
      await page.locator(S.dialog).waitFor({ state: 'visible' })
      await page.locator(`${S.dialog} select`).first().selectOption('Display')
      await page.locator(S.sourceOptionBtn).first().click()
      await page.locator(S.dialog).waitFor({ state: 'hidden' })
      await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

      // Step 2: Turn ON Microphone toggle via UI
      const micGroup = page.locator('.control-group.toggle').filter({ hasText: 'Microphone' })
      await micGroup.locator('.toggle-switch').click()
      await expect(micGroup.locator('input[type="checkbox"]')).toBeChecked()

      // Step 3: Select Jabra from mic device dropdown
      const micDeviceSelect = page.locator('.control-group').filter({ hasText: 'Mic Device' }).locator('select')
      await expect(micDeviceSelect).toBeVisible({ timeout: 5_000 })
      const options = await micDeviceSelect.locator('option').allTextContents()
      const jabraOption = options.find(o => o.toLowerCase().includes('jabra'))
      expect(jabraOption, `Jabra mic not found in device list: ${options.join(', ')}`).toBeTruthy()
      await micDeviceSelect.selectOption({ label: jabraOption! })

      // Step 4: Click Start Recording
      const startBtn = page.getByRole('button', { name: 'Start Recording' })
      await startBtn.scrollIntoViewIfNeeded()
      stderrChunks.length = 0
      stdoutChunks.length = 0
      await startBtn.click()

      // Step 5: Wait for recording to be active
      const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
      await expect(stopBtn).toBeVisible({ timeout: 10_000 })

      // Step 6: Record for 3 seconds
      await page.waitForTimeout(3000)

      // Step 7: Click Stop Recording
      await stopBtn.click()

      // Step 8: Wait for processing to complete
      await expect(
        page.locator(S.editorView)
          .or(page.locator(S.errorBox))
          .or(page.getByRole('button', { name: 'Start Recording' }))
      ).toBeVisible({ timeout: 60_000 })

      // Step 9: Check terminal output for NaN/Inf/muxing errors
      const allOutput = [...stderrChunks, ...stdoutChunks].join('\n')
      expect(allOutput, 'Terminal output should not contain NaN/Inf errors').not.toMatch(/Input contains.*NaN/)
      expect(allOutput, 'Terminal output should not contain muxing failed').not.toContain('muxing failed')

      // Step 10: Assert no error-box
      const errorBox = page.locator(S.errorBox)
      const errorVisible = await errorBox.isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await errorBox.textContent()
        expect(errorVisible, `Recording failed with error: ${errorText}`).toBe(false)
      }

      // Step 11: Verify editor view loaded
      await expect(page.locator(S.editorView)).toBeVisible({ timeout: 10_000 })

      // Step 12: Verify playback controls loaded (recording produced valid file)
      const playBtn = page.locator(S.playBtn)
      await expect(playBtn).toBeVisible({ timeout: 10_000 })
    } finally {
      proc.stderr?.off('data', onStderr)
      proc.stdout?.off('data', onStdout)
    }
  })

  test('Default microphone recording produces working audio', async ({ electronApp, page }) => {
    const stderrChunks: string[] = []
    const stdoutChunks: string[] = []
    const proc = electronApp.process()
    const onStderr = (data: Buffer) => { stderrChunks.push(data.toString()) }
    const onStdout = (data: Buffer) => { stdoutChunks.push(data.toString()) }
    proc.stderr?.on('data', onStderr)
    proc.stdout?.on('data', onStdout)

    try {
      // Step 1: Add a Display source via UI
      await page.locator(S.addSourceBtn).click()
      await page.locator(S.dialog).waitFor({ state: 'visible' })
      await page.locator(`${S.dialog} select`).first().selectOption('Display')
      await page.locator(S.sourceOptionBtn).first().click()
      await page.locator(S.dialog).waitFor({ state: 'hidden' })
      await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

      // Step 2: Turn ON Microphone toggle via UI (default device)
      const micGroup = page.locator('.control-group.toggle').filter({ hasText: 'Microphone' })
      await micGroup.locator('.toggle-switch').click()
      await expect(micGroup.locator('input[type="checkbox"]')).toBeChecked()

      // Step 3: Click Start Recording
      const startBtn = page.getByRole('button', { name: 'Start Recording' })
      await startBtn.scrollIntoViewIfNeeded()
      stderrChunks.length = 0
      stdoutChunks.length = 0
      await startBtn.click()

      // Step 4: Wait for recording to be active
      const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
      await expect(stopBtn).toBeVisible({ timeout: 10_000 })

      // Step 5: Record for 3 seconds
      await page.waitForTimeout(3000)

      // Step 6: Click Stop Recording
      await stopBtn.click()

      // Step 7: Wait for processing to complete
      await expect(
        page.locator(S.editorView)
          .or(page.locator(S.errorBox))
          .or(page.getByRole('button', { name: 'Start Recording' }))
      ).toBeVisible({ timeout: 60_000 })

      // Step 8: Assert no error-box
      const errorBox = page.locator(S.errorBox)
      const errorVisible = await errorBox.isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await errorBox.textContent()
        expect(errorVisible, `Recording failed with error: ${errorText}`).toBe(false)
      }

      // Step 9: Verify editor view loaded
      await expect(page.locator(S.editorView)).toBeVisible({ timeout: 10_000 })

      // Step 10: Wait for async errors to propagate (Chromium pixel format error is async)
      await page.waitForTimeout(3000)

      // Step 11: Check terminal output for muxing errors (not pixel format — that's Chromium internal)
      const allOutput = [...stderrChunks, ...stdoutChunks].join('\n')
      expect(allOutput, 'Terminal should not contain NaN/Inf error').not.toMatch(/Input contains.*NaN/)
      expect(allOutput, 'Terminal should not contain muxing failed').not.toContain('muxing failed')
    } finally {
      proc.stderr?.off('data', onStderr)
      proc.stdout?.off('data', onStdout)
    }
  })

  test('System audio recording completes without errors', async ({ electronApp, page }) => {
    const stderrChunks: string[] = []
    const stdoutChunks: string[] = []
    const proc = electronApp.process()
    const onStderr = (data: Buffer) => { stderrChunks.push(data.toString()) }
    const onStdout = (data: Buffer) => { stdoutChunks.push(data.toString()) }
    proc.stderr?.on('data', onStderr)
    proc.stdout?.on('data', onStdout)

    let afplay: ChildProcess | null = null

    try {
      // Step 1: Add a Display source via UI
      await page.locator(S.addSourceBtn).click()
      await page.locator(S.dialog).waitFor({ state: 'visible' })
      await page.locator(`${S.dialog} select`).first().selectOption('Display')
      await page.locator(S.sourceOptionBtn).first().click()
      await page.locator(S.dialog).waitFor({ state: 'hidden' })
      await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

      // Step 2: Turn ON System Audio toggle via UI
      const systemAudioGroup = page.locator('.control-group.toggle').filter({ hasText: 'System Audio' })
      await systemAudioGroup.locator('.toggle-switch').click()
      await expect(systemAudioGroup.locator('input[type="checkbox"]')).toBeChecked()

      // Step 3: Play test tone in background
      afplay = spawn('afplay', [testTonePath], { stdio: 'ignore' })
      await page.waitForTimeout(500)

      // Step 4: Click Start Recording
      const startBtn = page.getByRole('button', { name: 'Start Recording' })
      await startBtn.scrollIntoViewIfNeeded()
      stderrChunks.length = 0
      stdoutChunks.length = 0
      await startBtn.click()

      // Step 5: Wait for recording to be active
      const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
      await expect(stopBtn).toBeVisible({ timeout: 10_000 })

      // Step 6: Record for 3 seconds
      await page.waitForTimeout(3000)

      // Step 7: Click Stop Recording
      await stopBtn.click()

      // Step 8: Wait for processing to complete
      await expect(
        page.locator(S.editorView)
          .or(page.locator(S.errorBox))
          .or(page.getByRole('button', { name: 'Start Recording' }))
      ).toBeVisible({ timeout: 60_000 })

      // Step 9: Assert no error-box
      const errorBox = page.locator(S.errorBox)
      const errorVisible = await errorBox.isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await errorBox.textContent()
        expect(errorVisible, `Recording failed with error: ${errorText}`).toBe(false)
      }

      // Step 10: Verify editor view loaded
      await expect(page.locator(S.editorView)).toBeVisible({ timeout: 10_000 })

      // Step 11: Check terminal output for errors (not pixel format — that's Chromium internal)
      const allOutput = [...stderrChunks, ...stdoutChunks].join('\n')
      expect(allOutput, 'Terminal should not contain NaN/Inf error').not.toMatch(/Input contains.*NaN/)
      expect(allOutput, 'Terminal should not contain muxing failed').not.toContain('muxing failed')
    } finally {
      if (afplay) afplay.kill()
      proc.stderr?.off('data', onStderr)
      proc.stdout?.off('data', onStdout)
    }
  })
})
