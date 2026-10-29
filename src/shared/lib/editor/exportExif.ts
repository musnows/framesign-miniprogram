import exifr from 'exifr'
import { filterPhotographyExif } from './photographyExif.ts'

const exifCache = new WeakMap<Blob, Promise<Uint8Array | undefined>>()
const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0])

export { extractExif, normalizeExif }

export class ExifExportError extends Error {
  constructor(cause: unknown) {
    super('Failed to preserve original EXIF', { cause })
    this.name = 'ExifExportError'
  }
}

function matches(bytes: Uint8Array, offset: number, value: Uint8Array | number[]) {
  return value.every((byte, index) => bytes[offset + index] === byte)
}

function jpegSegments(bytes: Uint8Array) {
  if (!matches(bytes, 0, [0xff, 0xd8])) throw new Error('Expected a JPEG export')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const segments: Array<{ marker: number; start: number; payload: number; end: number }> = []
  let offset = 2
  while (offset < bytes.length) {
    const start = offset
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]!
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) throw new Error('Truncated JPEG segment')
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG segment length')
    segments.push({ marker, start, payload: offset + 2, end: offset + length })
    offset += length
  }
  return segments
}

async function extractExif(source: Blob): Promise<Uint8Array | undefined> {
  const bytes = new Uint8Array(await source.arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (matches(bytes, 0, [0xff, 0xd8])) {
    const segment = jpegSegments(bytes).find(segment => segment.marker === 0xe1 && matches(bytes, segment.payload, exifHeader))
    return segment ? bytes.slice(segment.payload + exifHeader.length, segment.end) : undefined
  }
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset)
      const end = offset + 12 + length
      if (end > bytes.length) throw new Error('Invalid PNG chunk length')
      if (matches(bytes, offset + 4, [101, 88, 73, 102])) return bytes.slice(offset + 8, end - 4)
      offset = end
    }
    return undefined
  }
  if (matches(bytes, 0, [82, 73, 70, 70]) && matches(bytes, 8, [87, 69, 66, 80])) {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true)
      const end = offset + 8 + length
      if (end > bytes.length) throw new Error('Invalid WebP chunk length')
      if (matches(bytes, offset, [69, 88, 73, 70])) {
        const start = offset + 8
        return bytes.slice(start + (matches(bytes, start, exifHeader) ? exifHeader.length : 0), end)
      }
      offset = end + (length % 2)
    }
    return undefined
  }
  if (matches(bytes, 4, [102, 116, 121, 112])) {
    // Reuse exifr's HEIF/AVIF item locator, keeping the original TIFF bytes and MakerNote offsets.
    const reader = new exifr.Exifr({ exif: false, gps: false, interop: false }) as InstanceType<typeof exifr.Exifr> & {
      parsers: { tiff?: { chunk: { toUint8(): Uint8Array } } }
    }
    await reader.read(bytes)
    await reader.parse()
    const tiff = reader.parsers.tiff?.chunk.toUint8()
    return tiff ? Uint8Array.from(tiff) : undefined
  }
  return undefined
}

function readOriginalExif(source: Blob) {
  let pending = exifCache.get(source)
  if (!pending) {
    pending = extractExif(source).catch(error => {
      exifCache.delete(source)
      throw error
    })
    exifCache.set(source, pending)
  }
  return pending
}

function normalizeExif(original: Uint8Array, width: number, height: number) {
  const bytes = Uint8Array.from(original)
  const view = new DataView(bytes.buffer)
  const littleEndian = matches(bytes, 0, [0x49, 0x49])
  if (bytes.length < 8 || (!littleEndian && !matches(bytes, 0, [0x4d, 0x4d])) || view.getUint16(2, littleEndian) !== 42) {
    throw new Error('Invalid EXIF TIFF header')
  }
  const visited = new Set<number>()
  function updateDirectory(offset: number, kind: 'image' | 'exif' | 'interop') {
    if (offset < 8 || offset + 2 > bytes.length || visited.has(offset)) throw new Error('Invalid EXIF directory offset')
    visited.add(offset)
    const count = view.getUint16(offset, littleEndian)
    const next = offset + 2 + count * 12
    if (next + 4 > bytes.length) throw new Error('Truncated EXIF directory')
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12
      const tag = view.getUint16(entry, littleEndian)
      const type = view.getUint16(entry + 2, littleEndian)
      const size = view.getUint32(entry + 4, littleEndian)
      if ((kind === 'image' && tag === 0x8769) || (kind === 'exif' && tag === 0xa005)) {
        if (type !== 4 || size !== 1) throw new Error('Invalid EXIF directory pointer')
        const child = view.getUint32(entry + 8, littleEndian)
        if (child) updateDirectory(child, kind === 'image' ? 'exif' : 'interop')
      }
      let value: number | undefined
      if (kind === 'image') {
        if (tag === 0x0112) value = 1
        if (tag === 0x0100) value = width
        if (tag === 0x0101) value = height
      } else if (kind === 'exif') {
        if (tag === 0xa002) value = width
        if (tag === 0xa003) value = height
        if (tag === 0xa001) value = 1
      } else {
        if (tag === 0x1001) value = width
        if (tag === 0x1002) value = height
      }
      if (value === undefined) continue
      if ((type !== 3 && type !== 4) || size !== 1) throw new Error('Invalid EXIF image property')
      const useShort = type === 3 && value <= 0xffff
      view.setUint16(entry + 2, useShort ? 3 : 4, littleEndian)
      view.setUint32(entry + 8, 0, littleEndian)
      if (useShort) view.setUint16(entry + 8, value, littleEndian)
      else view.setUint32(entry + 8, value, littleEndian)
    }
    // The source thumbnail depicts the unedited image. Detach it without moving other data.
    if (kind === 'image') view.setUint32(next, 0, littleEndian)
  }
  updateDirectory(view.getUint32(4, littleEndian), 'image')
  return bytes
}

export async function preserveExportExif(output: Blob, source: Blob, enabled = true, photographyOnly = false): Promise<Blob> {
  if (!enabled) return output
  try {
    const original = await readOriginalExif(source)
    if (!original) return output
    const selected = photographyOnly ? filterPhotographyExif(original) : original
    if (selected.length > 0xffff - 8) throw new Error('EXIF exceeds the JPEG APP1 size limit')
    const bytes = new Uint8Array(await output.arrayBuffer())
    const segments = jpegSegments(bytes)
    const frame = segments.find(segment => [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(segment.marker))
    if (!frame || frame.end - frame.payload < 6) throw new Error('Missing JPEG dimensions')
    const view = new DataView(bytes.buffer)
    const tiff = normalizeExif(selected, view.getUint16(frame.payload + 3), view.getUint16(frame.payload + 1))
    const header = new Uint8Array(10)
    header.set([0xff, 0xe1])
    new DataView(header.buffer).setUint16(2, tiff.length + 8)
    header.set(exifHeader, 4)
    const parts: BlobPart[] = [bytes.subarray(0, 2), header, tiff]
    let offset = 2
    for (const segment of segments) {
      const remove = photographyOnly
        ? (segment.marker >= 0xe1 && segment.marker <= 0xef) || segment.marker === 0xfe
        : segment.marker === 0xe1 && matches(bytes, segment.payload, exifHeader)
      if (!remove) continue
      parts.push(bytes.subarray(offset, segment.start))
      offset = segment.end
    }
    parts.push(bytes.subarray(offset))
    return new Blob(parts, { type: 'image/jpeg' })
  } catch (error) {
    throw new ExifExportError(error)
  }
}
