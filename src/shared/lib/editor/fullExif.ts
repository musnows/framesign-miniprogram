import exifr from 'exifr'

const fullExifCache = new WeakMap<Blob, Promise<Record<string, any>>>()

export function readFullExif(file: Blob): Promise<Record<string, any>> {
  const cached = fullExifCache.get(file)
  if (cached) return cached

  const pending = exifr.parse(file, {
    tiff: true,
    ifd1: true,
    xmp: true,
    iptc: true,
    icc: true,
    jfif: true,
    ihdr: true,
    makerNote: true,
    userComment: true,
    multiSegment: true,
    mergeOutput: false,
    sanitize: false,
    translateValues: false,
    reviveValues: false
  }).then(value => value || {}).catch(error => {
    fullExifCache.delete(file)
    throw error
  })
  fullExifCache.set(file, pending)
  return pending
}

export interface MetadataRow {
  key: string
  value: string
  binary: boolean
}

export function metadataRows(metadata: Record<string, any>): MetadataRow[] {
  const rows: MetadataRow[] = []
  function visit(value: unknown, key: string) {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      rows.push({ key, value: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' '), binary: true })
    } else if (value instanceof Date) {
      rows.push({ key, value: Number.isNaN(value.getTime()) ? String(value) : value.toISOString(), binary: false })
    } else if (value !== null && typeof value === 'object' && Object.keys(value).length) {
      for (const [childKey, child] of Object.entries(value)) visit(child, key ? `${key}.${childKey}` : childKey)
    } else {
      rows.push({ key, value: typeof value === 'object' ? JSON.stringify(value) : String(value), binary: false })
    }
  }
  for (const [key, value] of Object.entries(metadata)) visit(value, key)
  return rows
}
