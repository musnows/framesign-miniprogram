import { detectRobustWatermark } from './hiddenWatermarkRobust.ts'
import { ROBUST_MAX_BYTES } from './hiddenWatermarkCodec.ts'

/**
 * Quality-first watermark with a repeated 8x8 DCT carrier. New images use
 * at most one RGB level of correction and do not receive a low-frequency
 * carrier. Detection also supports the stronger V1 and normalized V2 formats.
 *
 * A 784-bit legacy frame is tiled across the whole image. Every frame bit is
 * stored in one 8x8 luminance block, so the identifier remains recoverable
 * after the visible border is cropped. Detection tries the possible block
 * grid offsets and frame phases instead of relying on image dimensions or
 * metadata.
 */

export const HIDDEN_WATERMARK_MAX_BYTES = ROBUST_MAX_BYTES

const BLOCK_SIZE = 8
const TILE_BLOCKS_X = 28
const TILE_BLOCKS_Y = 28
const FRAME_BITS = TILE_BLOCKS_X * TILE_BLOCKS_Y
const QIM_STEP = 4
const LEGACY_QIM_STEP = 20
const MAX_PIXEL_CHANGE = 1
const SYNC_BITS_COUNT = 128
const MAGIC = new Uint8Array([0x50, 0x4d, 0x48, 0x57]) // PMHW
const VERSION = 3
const FAST_SAMPLE_TARGET = 768
const DENSE_SAMPLE_TARGET = 30000
const MAX_PHASE_CANDIDATES = 24

interface FrequencyBasis {
  u: number
  v: number
  values: Float32Array
}

interface Observation {
  blockX: number
  blockY: number
  confidence: number
}

interface PhaseCandidate {
  offsetX: number
  offsetY: number
  phaseX: number
  phaseY: number
  fastScore: number
}

export interface HiddenWatermarkDetection {
  marker: string
  confidence: number
  version: 1 | 2 | 3
  blockCount: number
  gridOffsetX: number
  gridOffsetY: number
  framePhaseX: number
  framePhaseY: number
}

const COS_TABLE = createCosTable()
const FREQUENCIES: FrequencyBasis[] = [
  createFrequencyBasis(2, 2),
  createFrequencyBasis(3, 2)
]
const LOGICAL_TO_PHYSICAL = createPermutation(0x7f4a7c15)
const PHYSICAL_TO_LOGICAL = invertPermutation(LOGICAL_TO_PHYSICAL)
const INDEX_MASK = createIndexMask()
const SYNC_BITS = createSyncBits()
const SYNC_CARRIER_SIGNS = createSyncCarrierSigns()
const CRC_TABLE = createCrcTable()

function createCosTable(): Float32Array {
  const table = new Float32Array(BLOCK_SIZE * BLOCK_SIZE)
  for (let position = 0; position < BLOCK_SIZE; position++) {
    for (let frequency = 0; frequency < BLOCK_SIZE; frequency++) {
      table[position * BLOCK_SIZE + frequency] = Math.cos(((2 * position + 1) * frequency * Math.PI) / 16)
    }
  }
  return table
}

function createFrequencyBasis(u: number, v: number): FrequencyBasis {
  const values = new Float32Array(BLOCK_SIZE * BLOCK_SIZE)
  const alphaU = u === 0 ? Math.SQRT1_2 : 1
  const alphaV = v === 0 ? Math.SQRT1_2 : 1
  const scale = 0.25 * alphaU * alphaV

  for (let y = 0; y < BLOCK_SIZE; y++) {
    for (let x = 0; x < BLOCK_SIZE; x++) {
      values[y * BLOCK_SIZE + x] =
        scale * COS_TABLE[x * BLOCK_SIZE + u]! * COS_TABLE[y * BLOCK_SIZE + v]!
    }
  }

  return { u, v, values }
}

function createPermutation(seed: number): Uint16Array {
  const result = new Uint16Array(FRAME_BITS)
  for (let i = 0; i < FRAME_BITS; i++) result[i] = i

  let state = seed >>> 0
  for (let i = FRAME_BITS - 1; i > 0; i--) {
    state = nextRandom(state)
    const j = state % (i + 1)
    const value = result[i]!
    result[i] = result[j]!
    result[j] = value
  }

  return result
}

function invertPermutation(permutation: Uint16Array): Uint16Array {
  const inverse = new Uint16Array(FRAME_BITS)
  for (let logical = 0; logical < FRAME_BITS; logical++) {
    inverse[permutation[logical]!] = logical
  }
  return inverse
}

function createIndexMask(): Uint8Array {
  const mask = new Uint8Array(FRAME_BITS)
  let state = 0x1a2b3c4d
  for (let i = 0; i < FRAME_BITS; i++) {
    state = nextRandom(state)
    mask[i] = state & 1
  }
  return mask
}

function createSyncBits(): Uint8Array {
  const bits = new Uint8Array(SYNC_BITS_COUNT)
  let state = 0x4d595df4
  for (let i = 0; i < bits.length; i++) {
    state = nextRandom(state)
    bits[i] = state & 1
  }
  return bits
}

function createSyncCarrierSigns(): Int8Array {
  const signs = new Int8Array(SYNC_BITS_COUNT)
  for (let i = 0; i < signs.length; i++) {
    signs[i] = (SYNC_BITS[i]! ^ INDEX_MASK[i]!) === 1 ? 1 : -1
  }
  return signs
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table[i] = value >>> 0
  }
  return table
}

function nextRandom(value: number): number {
  let state = value >>> 0
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state >>> 0
}

function positiveModulo(value: number, modulus: number): number {
  const result = value % modulus
  return result < 0 ? result + modulus : result
}

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff
  for (let i = start; i < end; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeByte(bits: Uint8Array, bitOffset: number, value: number) {
  for (let bit = 0; bit < 8; bit++) {
    bits[bitOffset + bit] = (value >> (7 - bit)) & 1
  }
}

function readByte(bits: Uint8Array, bitOffset: number): number {
  let value = 0
  for (let bit = 0; bit < 8; bit++) {
    value = (value << 1) | bits[bitOffset + bit]!
  }
  return value
}

function buildFrame(marker: string, version: 1 | 3 = VERSION): Uint8Array {
  const payload = new TextEncoder().encode(marker)
  if (payload.length === 0) {
    throw new Error('Hidden watermark marker cannot be empty')
  }
  if (payload.length > HIDDEN_WATERMARK_MAX_BYTES) {
    throw new Error(`Hidden watermark marker exceeds ${HIDDEN_WATERMARK_MAX_BYTES} UTF-8 bytes`)
  }

  const headerBytes = new Uint8Array(6 + payload.length)
  headerBytes.set(MAGIC, 0)
  headerBytes[4] = version
  headerBytes[5] = payload.length
  headerBytes.set(payload, 6)
  const checksum = crc32(headerBytes, 4)

  const logicalBits = new Uint8Array(FRAME_BITS)
  logicalBits.set(SYNC_BITS, 0)
  let bitOffset = SYNC_BITS_COUNT
  for (let i = 0; i < headerBytes.length; i++, bitOffset += 8) {
    writeByte(logicalBits, bitOffset, headerBytes[i]!)
  }
  writeByte(logicalBits, bitOffset, (checksum >>> 24) & 0xff)
  writeByte(logicalBits, bitOffset + 8, (checksum >>> 16) & 0xff)
  writeByte(logicalBits, bitOffset + 16, (checksum >>> 8) & 0xff)
  writeByte(logicalBits, bitOffset + 24, checksum & 0xff)
  bitOffset += 32

  let state = (checksum ^ (payload.length << 24) ^ 0xa57d31c9) >>> 0
  for (let i = bitOffset; i < FRAME_BITS; i++) {
    state = nextRandom(state)
    logicalBits[i] = state & 1
  }

  const carrierBits = new Uint8Array(FRAME_BITS)
  for (let logical = 0; logical < FRAME_BITS; logical++) {
    carrierBits[LOGICAL_TO_PHYSICAL[logical]!] = logicalBits[logical]! ^ INDEX_MASK[logical]!
  }
  return carrierBits
}

function parseFrame(evidence: Float32Array): { marker: string; version: 1 | 3; expectedBits: Uint8Array; confidence: number } | null {
  const logicalBits = new Uint8Array(FRAME_BITS)
  for (let logical = 0; logical < FRAME_BITS; logical++) {
    const value = evidence[LOGICAL_TO_PHYSICAL[logical]!]!
    logicalBits[logical] = (value >= 0 ? 1 : 0) ^ INDEX_MASK[logical]!
  }

  for (let i = 0; i < SYNC_BITS_COUNT; i++) {
    if (logicalBits[i]! !== SYNC_BITS[i]!) return null
  }

  const headerBitOffset = SYNC_BITS_COUNT
  for (let i = 0; i < MAGIC.length; i++) {
    if (readByte(logicalBits, headerBitOffset + i * 8) !== MAGIC[i]!) return null
  }
  const version = readByte(logicalBits, headerBitOffset + 32)
  if (version !== VERSION && version !== 1) return null

  const length = readByte(logicalBits, headerBitOffset + 40)
  if (length === 0 || length > HIDDEN_WATERMARK_MAX_BYTES) return null

  const headerLength = 6 + length
  const headerBytes = new Uint8Array(headerLength)
  for (let i = 0; i < headerLength; i++) {
    headerBytes[i] = readByte(logicalBits, headerBitOffset + i * 8)
  }

  const totalBitsWithCrc = headerBitOffset + (headerLength + 4) * 8
  if (totalBitsWithCrc > FRAME_BITS) return null

  let expectedCrc = 0
  for (let i = 0; i < 4; i++) {
    expectedCrc = (expectedCrc << 8) | readByte(logicalBits, headerBitOffset + headerLength * 8 + i * 8)
  }
  expectedCrc >>>= 0
  if (expectedCrc !== crc32(headerBytes, 4)) return null

  const payload = headerBytes.slice(6)
  let marker: string
  try {
    marker = new TextDecoder('utf-8', { fatal: true }).decode(payload)
  } catch {
    return null
  }

  const expectedBits = buildFrame(marker, version)
  let agreement = 0
  let weight = 0
  for (let physical = 0; physical < FRAME_BITS; physical++) {
    const value = evidence[physical]!
    const magnitude = Math.abs(value)
    if (magnitude === 0) continue
    agreement += (expectedBits[physical]! === 1 ? 1 : -1) * value
    weight += magnitude
  }

  return {
    marker,
    version,
    expectedBits,
    confidence: weight > 0 ? Math.max(-1, Math.min(1, agreement / weight)) : 0
  }
}

function getLuminance(data: Uint8ClampedArray | Uint8Array, offset: number): number {
  return data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114
}

function getCoefficient(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  pixelX: number,
  pixelY: number,
  basis: Float32Array
): number {
  let coefficient = 0
  for (let y = 0; y < BLOCK_SIZE; y++) {
    const rowOffset = ((pixelY + y) * width + pixelX) * 4
    for (let x = 0; x < BLOCK_SIZE; x++) {
      coefficient += getLuminance(data, rowOffset + x * 4) * basis[y * BLOCK_SIZE + x]!
    }
  }
  return coefficient
}

function chooseQuantizedValue(coefficient: number, carrierBit: number): number {
  const nearest = Math.round(coefficient / QIM_STEP)
  if ((nearest & 1) === carrierBit) return nearest * QIM_STEP

  const lower = (nearest - 1) * QIM_STEP
  const upper = (nearest + 1) * QIM_STEP
  return Math.abs(coefficient - lower) <= Math.abs(upper - coefficient) ? lower : upper
}

function embedBlock(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  pixelX: number,
  pixelY: number,
  carrierBit: number
) {
  const corrections = new Float32Array(BLOCK_SIZE * BLOCK_SIZE)

  for (const frequency of FREQUENCIES) {
    const coefficient = getCoefficient(data, width, pixelX, pixelY, frequency.values)
    const delta = chooseQuantizedValue(coefficient, carrierBit) - coefficient
    for (let i = 0; i < corrections.length; i++) {
      corrections[i]! += delta * frequency.values[i]!
    }
  }

  for (let y = 0; y < BLOCK_SIZE; y++) {
    const rowOffset = ((pixelY + y) * width + pixelX) * 4
    for (let x = 0; x < BLOCK_SIZE; x++) {
      const correction = Math.max(-MAX_PIXEL_CHANGE, Math.min(MAX_PIXEL_CHANGE, corrections[y * BLOCK_SIZE + x]!))
      if (correction === 0) continue
      const offset = rowOffset + x * 4
      data[offset] = Math.max(0, Math.min(255, Math.round(data[offset]! + correction)))
      data[offset + 1] = Math.max(0, Math.min(255, Math.round(data[offset + 1]! + correction)))
      data[offset + 2] = Math.max(0, Math.min(255, Math.round(data[offset + 2]! + correction)))
    }
  }
}

function readBlockSignal(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  pixelX: number,
  pixelY: number,
  step: number
): number {
  let signed = 0
  let weight = 0

  for (const frequency of FREQUENCIES) {
    const coefficient = getCoefficient(data, width, pixelX, pixelY, frequency.values)
    const normalized = coefficient / step
    const nearest = Math.round(normalized)
    const confidence = 1 - 2 * Math.abs(normalized - nearest)
    signed += (nearest & 1 ? 1 : -1) * confidence
    weight += Math.abs(confidence)
  }

  return weight > 0 ? signed / weight : 0
}

export function embedHiddenWatermarkInRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  marker: string
) {
  const frame = buildFrame(marker)
  const blockColumns = Math.floor(width / BLOCK_SIZE)
  const blockRows = Math.floor(height / BLOCK_SIZE)

  for (let blockY = 0; blockY < blockRows; blockY++) {
    for (let blockX = 0; blockX < blockColumns; blockX++) {
      const physical = positiveModulo(blockY, TILE_BLOCKS_Y) * TILE_BLOCKS_X + positiveModulo(blockX, TILE_BLOCKS_X)
      embedBlock(data, width, blockX * BLOCK_SIZE, blockY * BLOCK_SIZE, frame[physical]!)
    }
  }
}

function collectObservations(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  targetCount: number,
  step: number
): Observation[] {
  const blockColumns = Math.floor((width - offsetX) / BLOCK_SIZE)
  const blockRows = Math.floor((height - offsetY) / BLOCK_SIZE)
  if (blockColumns <= 0 || blockRows <= 0) return []

  const observations: Observation[] = []
  const totalBlocks = blockColumns * blockRows
  const sampleCount = Math.min(totalBlocks, targetCount)
  let state = (width * 73856093 ^ height * 19349663 ^ offsetX * 83492791 ^ offsetY * 2654435761 ^ targetCount) >>> 0

  for (let sample = 0; sample < sampleCount; sample++) {
    const index = totalBlocks <= targetCount ? sample : (state = nextRandom(state)) % totalBlocks
    const blockX = index % blockColumns
    const blockY = Math.floor(index / blockColumns)
    const confidence = readBlockSignal(
      data,
      width,
      offsetX + blockX * BLOCK_SIZE,
      offsetY + blockY * BLOCK_SIZE,
      step
    )
    if (Math.abs(confidence) >= 0.015) {
      observations.push({ blockX, blockY, confidence })
    }
  }

  return observations
}

function scorePhase(observations: Observation[], phaseX: number, phaseY: number): number {
  const syncEvidence = new Float32Array(SYNC_BITS_COUNT)

  for (const observation of observations) {
    const physical =
      positiveModulo(observation.blockY - phaseY, TILE_BLOCKS_Y) * TILE_BLOCKS_X +
      positiveModulo(observation.blockX - phaseX, TILE_BLOCKS_X)
    const logical = PHYSICAL_TO_LOGICAL[physical]!
    if (logical < SYNC_BITS_COUNT) {
      syncEvidence[logical]! += observation.confidence
    }
  }

  let score = 0
  for (let i = 0; i < SYNC_BITS_COUNT; i++) {
    score += syncEvidence[i]! * SYNC_CARRIER_SIGNS[i]!
  }
  return score
}

function buildEvidence(observations: Observation[], phaseX: number, phaseY: number): Float32Array {
  const evidence = new Float32Array(FRAME_BITS)
  for (const observation of observations) {
    const physical =
      positiveModulo(observation.blockY - phaseY, TILE_BLOCKS_Y) * TILE_BLOCKS_X +
      positiveModulo(observation.blockX - phaseX, TILE_BLOCKS_X)
    evidence[physical]! += observation.confidence
  }
  return evidence
}

export function detectHiddenWatermarkInRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): HiddenWatermarkDetection | null {
  if (width < BLOCK_SIZE * 4 || height < BLOCK_SIZE * 4) return null

  const aligned = detectAlignedWatermark(data, width, height, QIM_STEP)
  if (aligned?.version === VERSION) return aligned

  const robust = detectRobustWatermark(data, width, height)
  if (robust) {
    return {
      ...robust,
      version: 2,
      gridOffsetX: 0,
      gridOffsetY: 0,
      framePhaseX: 0,
      framePhaseY: 0
    }
  }

  return aligned || detectRepeatedWatermark(data, width, height, QIM_STEP) ||
    detectRepeatedWatermark(data, width, height, LEGACY_QIM_STEP)
}

function detectAlignedWatermark(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  step: number
): HiddenWatermarkDetection | null {
  const aligned = collectObservations(data, width, height, 0, 0, DENSE_SAMPLE_TARGET, step)
  const frame = parseFrame(buildEvidence(aligned, 0, 0))
  if (frame) {
    return {
      marker: frame.marker,
      confidence: frame.confidence,
      version: frame.version,
      blockCount: aligned.length,
      gridOffsetX: 0,
      gridOffsetY: 0,
      framePhaseX: 0,
      framePhaseY: 0
    }
  }
  return null
}

function detectRepeatedWatermark(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  step: number
): HiddenWatermarkDetection | null {
  const aligned = detectAlignedWatermark(data, width, height, step)
  if (aligned) return aligned

  const candidates: PhaseCandidate[] = []

  for (let offsetY = 0; offsetY < BLOCK_SIZE; offsetY++) {
    for (let offsetX = 0; offsetX < BLOCK_SIZE; offsetX++) {
      const observations = collectObservations(
        data,
        width,
        height,
        offsetX,
        offsetY,
        FAST_SAMPLE_TARGET,
        step
      )
      if (observations.length === 0) continue

      for (let phaseY = 0; phaseY < TILE_BLOCKS_Y; phaseY++) {
        for (let phaseX = 0; phaseX < TILE_BLOCKS_X; phaseX++) {
          candidates.push({
            offsetX,
            offsetY,
            phaseX,
            phaseY,
            fastScore: scorePhase(observations, phaseX, phaseY)
          })
        }
      }
    }
  }

  candidates.sort((a, b) => b.fastScore - a.fastScore)
  const denseByOffset = new Map<string, Observation[]>()
  let best: HiddenWatermarkDetection | null = null

  for (const candidate of candidates.slice(0, MAX_PHASE_CANDIDATES)) {
    const offsetKey = `${candidate.offsetX}:${candidate.offsetY}`
    let observations = denseByOffset.get(offsetKey)
    if (!observations) {
      observations = collectObservations(
        data,
        width,
        height,
        candidate.offsetX,
        candidate.offsetY,
        DENSE_SAMPLE_TARGET,
        step
      )
      denseByOffset.set(offsetKey, observations)
    }

    const evidence = buildEvidence(observations, candidate.phaseX, candidate.phaseY)
    const parsed = parseFrame(evidence)
    if (!parsed) continue

    const result: HiddenWatermarkDetection = {
      marker: parsed.marker,
      confidence: parsed.confidence,
      version: parsed.version,
      blockCount: observations.length,
      gridOffsetX: candidate.offsetX,
      gridOffsetY: candidate.offsetY,
      framePhaseX: candidate.phaseX,
      framePhaseY: candidate.phaseY
    }

    if (!best || result.confidence > best.confidence) {
      best = result
    }
  }

  return best
}
