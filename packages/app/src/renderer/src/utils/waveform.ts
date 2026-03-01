/**
 * Extract peak amplitude data from an AudioBuffer for waveform visualization.
 * Averages all channels, divides into buckets, and returns the max absolute value per bucket.
 * Result is normalized to 0–1 range.
 */
export function extractPeaks(buffer: AudioBuffer, targetSamples: number = 1000): Float32Array {
  const channelCount = buffer.numberOfChannels
  const length = buffer.length
  const peaks = new Float32Array(targetSamples)

  if (length === 0 || targetSamples <= 0) return peaks

  const samplesPerBucket = length / targetSamples

  // Get all channel data upfront
  const channels: Float32Array[] = []
  for (let ch = 0; ch < channelCount; ch++) {
    channels.push(buffer.getChannelData(ch))
  }

  let globalMax = 0

  for (let i = 0; i < targetSamples; i++) {
    const start = Math.floor(i * samplesPerBucket)
    const end = Math.floor((i + 1) * samplesPerBucket)
    let maxVal = 0

    for (let j = start; j < end && j < length; j++) {
      let sum = 0
      for (let ch = 0; ch < channelCount; ch++) {
        sum += Math.abs(channels[ch][j])
      }
      const avg = sum / channelCount
      if (avg > maxVal) maxVal = avg
    }

    peaks[i] = maxVal
    if (maxVal > globalMax) globalMax = maxVal
  }

  // Normalize to 0–1
  if (globalMax > 0) {
    for (let i = 0; i < targetSamples; i++) {
      peaks[i] /= globalMax
    }
  }

  return peaks
}
