import { decodeRobustWatermark, encodeRobustWatermark, ROBUST_CODE_LENGTHS } from './hiddenWatermarkCodec.ts'

// A fixed, normalized luminance plane keeps the carrier in the same position
// after resizing. Low-frequency coefficients survive downsampling better than
// the legacy carrier tied to an 8-pixel grid in the original image.
const SIZE = 256
const BLOCK = 8
const GRID = SIZE / BLOCK
const CARRIERS = GRID * GRID * 2
const MAX_CORRECTION = 10
type Pixels = Uint8ClampedArray | Uint8Array

function quantizationStep(codeLength: number): number {
  return codeLength === ROBUST_CODE_LENGTHS[2] ? 24 : 20
}

const BASES = [[1, 0], [0, 1]].map(([u, v]) => Float32Array.from({ length: 64 }, (_, index) =>
  0.25 * Math.SQRT1_2 * Math.cos((2 * (index % 8) + 1) * u! * Math.PI / 16) * Math.cos((2 * Math.floor(index / 8) + 1) * v! * Math.PI / 16)
))

function random(value: number): number {
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

const ORDER = Uint16Array.from({ length: CARRIERS }, (_, index) => index)
const MASK = new Uint8Array(CARRIERS)
let seed = 0x6d2b79f5
for (let i = CARRIERS - 1; i > 0; i--) {
  seed = random(seed)
  const other = seed % (i + 1)
  const value = ORDER[i]!
  ORDER[i] = ORDER[other]!
  ORDER[other] = value
}
for (let i = 0; i < CARRIERS; i++) {
  seed = random(seed)
  MASK[i] = seed & 1
}

// Exact area averaging avoids relying on a browser-specific resize filter.
function luminancePlane(data: Pixels, width: number, height: number): Float32Array {
  const plane = new Float32Array(SIZE * SIZE)
  const scaleX = width / SIZE
  const scaleY = height / SIZE
  const row = new Float32Array(SIZE)
  for (let sy = 0; sy < height; sy++) {
    for (let x = 0; x < SIZE; x++) {
      const start = x * scaleX
      const end = (x + 1) * scaleX
      let sum = 0
      for (let sx = Math.floor(start); sx < Math.min(width, Math.ceil(end)); sx++) {
        const weight = Math.min(end, sx + 1) - Math.max(start, sx)
        const offset = (sy * width + sx) * 4
        sum += (data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114) * weight
      }
      row[x] = sum / scaleX
    }
    const first = Math.floor(sy / scaleY)
    const last = Math.min(SIZE - 1, Math.ceil((sy + 1) / scaleY) - 1)
    for (let y = first; y <= last; y++) {
      const weight = (Math.min(sy + 1, (y + 1) * scaleY) - Math.max(sy, y * scaleY)) / scaleY
      for (let x = 0; x < SIZE; x++) plane[y * SIZE + x]! += row[x]! * weight
    }
  }
  return plane
}

function coefficient(plane: Float32Array, block: number, basis: Float32Array): number {
  const left = (block % GRID) * BLOCK
  const top = Math.floor(block / GRID) * BLOCK
  let value = 0
  for (let y = 0; y < BLOCK; y++) {
    for (let x = 0; x < BLOCK; x++) value += plane[(top + y) * SIZE + left + x]! * basis[y * BLOCK + x]!
  }
  return value
}

// Treat near-clipped regions as erasures instead of forcing visible patterns
// into white borders or deep shadows. The decoder applies the same rule.
function usableBlocks(plane: Float32Array): Uint8Array {
  const usable = new Uint8Array(GRID * GRID)
  for (let block = 0; block < usable.length; block++) {
    const left = (block % GRID) * BLOCK
    const top = Math.floor(block / GRID) * BLOCK
    let mean = 0
    for (let y = 0; y < BLOCK; y++) {
      for (let x = 0; x < BLOCK; x++) mean += plane[(top + y) * SIZE + left + x]!
    }
    mean /= BLOCK * BLOCK
    usable[block] = mean >= 12 && mean <= 243 ? 1 : 0
  }
  return usable
}

function addCorrection(data: Pixels, width: number, height: number, correction: Float32Array) {
  const left = new Uint16Array(width)
  const right = new Uint16Array(width)
  const weights = new Float32Array(width)
  for (let x = 0; x < width; x++) {
    const position = Math.max(0, Math.min(SIZE - 1, (x + 0.5) * SIZE / width - 0.5))
    left[x] = Math.floor(position)
    right[x] = Math.min(SIZE - 1, left[x]! + 1)
    weights[x] = position - left[x]!
  }
  for (let y = 0; y < height; y++) {
    const position = Math.max(0, Math.min(SIZE - 1, (y + 0.5) * SIZE / height - 0.5))
    const top = Math.floor(position) * SIZE
    const bottom = Math.min(SIZE - 1, Math.floor(position) + 1) * SIZE
    const wy = position - Math.floor(position)
    for (let x = 0; x < width; x++) {
      const wx = weights[x]!
      const a = correction[top + left[x]!]! * (1 - wx) + correction[top + right[x]!]! * wx
      const b = correction[bottom + left[x]!]! * (1 - wx) + correction[bottom + right[x]!]! * wx
      const delta = a * (1 - wy) + b * wy
      const offset = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        data[offset + channel] = Math.max(0, Math.min(255, Math.round(data[offset + channel]! + delta)))
      }
    }
  }
}

export function embedRobustWatermark(data: Pixels, width: number, height: number, marker: string) {
  const code = encodeRobustWatermark(marker)
  const step = quantizationStep(code.length)
  if (Math.min(width, height) < SIZE) return
  let plane = luminancePlane(data, width, height)
  const usable = usableBlocks(plane)
  const targets = new Float32Array(CARRIERS)
  for (let index = 0; index < CARRIERS; index++) {
    const physical = ORDER[index]!
    const value = coefficient(plane, physical >>> 1, BASES[physical & 1]!)
    const bit = code[index % code.length]! ^ MASK[index]!
    targets[physical] = (Math.round((value / step - bit) / 2) * 2 + bit) * step
  }
  // Correct interpolation and channel clipping against the same normalized
  // plane used by detection, while keeping the spatial correction smooth.
  const cumulative = new Float32Array(SIZE * SIZE)
  for (let iteration = 0; iteration < 3; iteration++) {
    const correction = new Float32Array(SIZE * SIZE)
    for (let physical = 0; physical < CARRIERS; physical++) {
      const block = physical >>> 1
      if (!usable[block]) continue
      const basis = BASES[physical & 1]!
      const delta = targets[physical]! - coefficient(plane, block, basis)
      const left = (block % GRID) * BLOCK
      const top = Math.floor(block / GRID) * BLOCK
      for (let y = 0; y < BLOCK; y++) {
        for (let x = 0; x < BLOCK; x++) correction[(top + y) * SIZE + left + x]! += delta * basis[y * BLOCK + x]!
      }
    }
    for (let index = 0; index < correction.length; index++) {
      const bounded = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, cumulative[index]! + correction[index]!))
      correction[index] = bounded - cumulative[index]!
      cumulative[index] = bounded
    }
    addCorrection(data, width, height, correction)
    if (iteration < 2) plane = luminancePlane(data, width, height)
  }
}

export function detectRobustWatermark(data: Pixels, width: number, height: number) {
  if (Math.min(width, height) < SIZE / 2) return null
  const plane = luminancePlane(data, width, height)
  const usable = usableBlocks(plane)
  const coefficients = new Float32Array(CARRIERS)
  const signals = new Float32Array(CARRIERS)
  for (let index = 0; index < CARRIERS; index++) {
    const physical = ORDER[index]!
    if (!usable[physical >>> 1]) continue
    coefficients[index] = coefficient(plane, physical >>> 1, BASES[physical & 1]!)
  }
  let marker: string | null = null
  // Resampling filters slightly attenuate the carrier. Every gain candidate
  // still has to pass the complete frame CRC; a correlation alone is not a hit.
  for (const gain of [1, 0.97, 1.03, 0.9]) {
    for (const length of ROBUST_CODE_LENGTHS) {
      const evidence = new Float32Array(length)
      const step = quantizationStep(length) * gain
      for (let index = 0; index < CARRIERS; index++) {
        if (!usable[ORDER[index]! >>> 1]) continue
        const value = coefficients[index]! / step
        const nearest = Math.round(value)
        const signal = ((nearest & 1) * 2 - 1) * (1 - 2 * Math.abs(value - nearest)) * (MASK[index] ? -1 : 1)
        signals[index] = signal
        evidence[index % length]! += signal
      }
      marker = decodeRobustWatermark(evidence)
      if (marker) break
    }
    if (marker) break
  }
  if (!marker) return null
  const code = encodeRobustWatermark(marker)
  let agreement = 0
  let weight = 0
  for (let index = 0; index < CARRIERS; index++) {
    agreement += signals[index]! * (code[index % code.length]! * 2 - 1)
    weight += Math.abs(signals[index]!)
  }
  return { marker, confidence: weight ? Math.max(0, Math.min(1, agreement / weight)) : 0, blockCount: usable.reduce((sum, value) => sum + value, 0) }
}
