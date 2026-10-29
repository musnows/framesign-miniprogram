interface Field {
  tag: number
  types: number[]
  count?: number
}

interface Entry {
  tag: number
  type: number
  count: number
  data: Uint8Array
}

// Match the shooting fields read by useExif, plus the exported image dimensions.
const imageFields: Field[] = [
  { tag: 0x0100, types: [3, 4], count: 1 }, // ImageWidth
  { tag: 0x0101, types: [3, 4], count: 1 }, // ImageHeight
  { tag: 0x010f, types: [2] }, // Make
  { tag: 0x0110, types: [2] }, // Model
  { tag: 0x0112, types: [3], count: 1 } // Orientation
]

const shootingFields: Field[] = [
  { tag: 0x829a, types: [5], count: 1 }, // ExposureTime
  { tag: 0x829d, types: [5], count: 1 }, // FNumber
  { tag: 0x8827, types: [3], count: 1 }, // ISO
  { tag: 0x9003, types: [2], count: 20 }, // DateTimeOriginal
  { tag: 0x9004, types: [2], count: 20 }, // CreateDate
  { tag: 0x9201, types: [10], count: 1 }, // ShutterSpeedValue
  { tag: 0x9202, types: [5], count: 1 }, // ApertureValue
  { tag: 0x920a, types: [5], count: 1 }, // FocalLength
  { tag: 0xa002, types: [3, 4], count: 1 }, // ExifImageWidth
  { tag: 0xa003, types: [3, 4], count: 1 }, // ExifImageHeight
  { tag: 0xa405, types: [3], count: 1 }, // FocalLengthIn35mmFormat
  { tag: 0xa433, types: [2] }, // LensMake
  { tag: 0xa434, types: [2] } // LensModel
]

const typeSizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 }
const directorySize = (count: number) => 2 + count * 12 + 4
const alignedSize = (size: number) => size + size % 2

export function filterPhotographyExif(original: Uint8Array): Uint8Array {
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength)
  const littleEndian = original[0] === 0x49 && original[1] === 0x49
  const bigEndian = original[0] === 0x4d && original[1] === 0x4d
  if (original.length < 8 || (!littleEndian && !bigEndian) || view.getUint16(2, littleEndian) !== 42) {
    throw new Error('Invalid EXIF TIFF header')
  }
  const visited = new Set<number>()
  let exifOffset = 0
  function readDirectory(offset: number, fields: Field[], image = false): Entry[] {
    if (offset < 8 || offset + 2 > original.length || visited.has(offset)) throw new Error('Invalid EXIF directory offset')
    visited.add(offset)
    const count = view.getUint16(offset, littleEndian)
    if (offset + directorySize(count) > original.length) throw new Error('Truncated EXIF directory')
    const entries = new Map<number, Entry>()
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12
      const tag = view.getUint16(entry, littleEndian)
      const type = view.getUint16(entry + 2, littleEndian)
      const valueCount = view.getUint32(entry + 4, littleEndian)
      if (image && tag === 0x8769) {
        if (type !== 4 || valueCount !== 1) throw new Error('Invalid EXIF directory pointer')
        exifOffset = view.getUint32(entry + 8, littleEndian)
      }
      const field = fields.find(field => field.tag === tag)
      if (!field) continue
      if (!field.types.includes(type) || valueCount === 0 || (field.count !== undefined && field.count !== valueCount)) {
        throw new Error('Invalid EXIF shooting field')
      }
      const size = valueCount * typeSizes[type]!
      const start = size <= 4 ? entry + 8 : view.getUint32(entry + 8, littleEndian)
      if (start < 8 || start + size > original.length) throw new Error('Invalid EXIF shooting field offset')
      let data = original.slice(start, start + size)
      if (type === 2) {
        // Recreate terminated strings without copying padding or trailing private data.
        const terminator = data.indexOf(0)
        if (terminator < 0) throw new Error('Unterminated EXIF shooting field')
        data = data.slice(0, terminator + 1)
      }
      entries.set(tag, { tag, type, count: type === 2 ? data.length : valueCount, data })
    }
    return [...entries.values()]
  }

  const image = readDirectory(view.getUint32(4, littleEndian), imageFields, true)
  const shooting = exifOffset ? readDirectory(exifOffset, shootingFields) : []
  const outputExifOffset = shooting.length ? 8 + directorySize(image.length + 1) : 0
  if (outputExifOffset) {
    const pointer = new Uint8Array(4)
    new DataView(pointer.buffer).setUint32(0, outputExifOffset, littleEndian)
    image.push({ tag: 0x8769, type: 4, count: 1, data: pointer })
  }
  let dataOffset = 8 + directorySize(image.length) + (shooting.length ? directorySize(shooting.length) : 0)
  const size = dataOffset + [...image, ...shooting].reduce((total, entry) => total + (entry.data.length > 4 ? alignedSize(entry.data.length) : 0), 0)
  // Allocate a fresh TIFF. GPS, MakerNote, thumbnails and unreferenced bytes never enter the export.
  const output = new Uint8Array(size)
  const target = new DataView(output.buffer)
  output.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])
  target.setUint16(2, 42, littleEndian)
  target.setUint32(4, 8, littleEndian)
  function writeDirectory(offset: number, entries: Entry[]) {
    target.setUint16(offset, entries.length, littleEndian)
    entries.sort((a, b) => a.tag - b.tag).forEach((entry, index) => {
      const position = offset + 2 + index * 12
      target.setUint16(position, entry.tag, littleEndian)
      target.setUint16(position + 2, entry.type, littleEndian)
      target.setUint32(position + 4, entry.count, littleEndian)
      if (entry.data.length <= 4) {
        output.set(entry.data, position + 8)
      } else {
        target.setUint32(position + 8, dataOffset, littleEndian)
        output.set(entry.data, dataOffset)
        dataOffset += alignedSize(entry.data.length)
      }
    })
  }
  writeDirectory(8, image)
  if (outputExifOffset) writeDirectory(outputExifOffset, shooting)
  return output
}
