// Version 2 uses a terminated rate-1/2 convolutional code and a CRC-32.
// Interleaving in the image carrier spreads localized damage across the code.
export const ROBUST_MAX_BYTES = 64
const CAPACITIES = [16, 32, ROBUST_MAX_BYTES]
// Short identifiers use fewer code bits and receive more spatial repetition.
export const ROBUST_CODE_LENGTHS = CAPACITIES.map(capacity => ((8 + capacity) * 8 + 6) * 2)

function parity(value: number): number {
  value ^= value >>> 4
  value ^= value >>> 2
  value ^= value >>> 1
  return value & 1
}

const OUTPUT_A = Uint8Array.from({ length: 128 }, (_, value) => parity(value & 0o171))
const OUTPUT_B = Uint8Array.from({ length: 128 }, (_, value) => parity(value & 0o133))

function crc32(bytes: Uint8Array, end: number): number {
  let crc = 0xffffffff
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i]!
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function encodeRobustWatermark(marker: string): Uint8Array {
  const payload = new TextEncoder().encode(marker)
  if (!payload.length || payload.length > ROBUST_MAX_BYTES) {
    throw new Error(`Hidden watermark requires 1 to ${ROBUST_MAX_BYTES} UTF-8 bytes`)
  }
  const capacity = CAPACITIES.find(value => payload.length <= value)!
  const frameBytes = 8 + capacity
  const dataBits = frameBytes * 8
  const frame = new Uint8Array(frameBytes)
  frame.set([0x50, 0x4d, 2, payload.length])
  frame.set(payload, 4)
  new DataView(frame.buffer).setUint32(frameBytes - 4, crc32(frame, frameBytes - 4))
  const encoded = new Uint8Array((dataBits + 6) * 2)
  let state = 0
  for (let bit = 0; bit < dataBits + 6; bit++) {
    const value = bit < dataBits ? (frame[bit >>> 3]! >>> (7 - (bit & 7))) & 1 : 0
    state = ((state << 1) | value) & 127
    encoded[bit * 2] = OUTPUT_A[state]!
    encoded[bit * 2 + 1] = OUTPUT_B[state]!
  }
  return encoded
}

export function decodeRobustWatermark(evidence: Float32Array): string | null {
  if (!ROBUST_CODE_LENGTHS.includes(evidence.length)) return null
  const dataBits = evidence.length / 2 - 6
  const frameBytes = dataBits / 8
  let scores = new Float64Array(64).fill(-Infinity)
  scores[0] = 0
  let next = new Float64Array(64)
  const decisions = new Uint8Array((dataBits + 6) * 64)
  for (let bit = 0; bit < dataBits + 6; bit++) {
    const a = evidence[bit * 2]!
    const b = evidence[bit * 2 + 1]!
    for (let state = 0; state < 64; state++) {
      const previous = state >>> 1
      const score0 = scores[previous]! + (OUTPUT_A[state]! * 2 - 1) * a + (OUTPUT_B[state]! * 2 - 1) * b
      const score1 = scores[previous + 32]! + (OUTPUT_A[state + 64]! * 2 - 1) * a + (OUTPUT_B[state + 64]! * 2 - 1) * b
      const high = score1 > score0
      next[state] = high ? score1 : score0
      decisions[bit * 64 + state] = previous + (high ? 32 : 0)
    }
    const swap = scores
    scores = next
    next = swap
  }
  const frame = new Uint8Array(frameBytes)
  let state = 0
  for (let bit = dataBits + 5; bit >= 0; bit--) {
    if (bit < dataBits) frame[bit >>> 3]! |= (state & 1) << (7 - (bit & 7))
    state = decisions[bit * 64 + state]!
  }
  if (frame[0] !== 0x50 || frame[1] !== 0x4d || frame[2] !== 2) return null
  const length = frame[3]!
  if (!length || length > frameBytes - 8) return null
  if (new DataView(frame.buffer).getUint32(frameBytes - 4) !== crc32(frame, frameBytes - 4)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(4, 4 + length))
  } catch {
    return null
  }
}
