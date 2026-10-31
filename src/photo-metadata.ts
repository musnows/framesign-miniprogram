import exifr from 'exifr'

const options = { mergeOutput: true, translateValues: true, reviveValues: true }
const extendedOptions = { ...options, xmp: true, multiSegment: true }
const xmpOptions = { ...extendedOptions, tiff: false }
const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).replace(/\0/g, '').trim() !== ''
// Keep metadata out of JSON and page data while retaining it across photo object spreads.
const sourceMetadata = Symbol('sourceMetadata')

function jpegMetadata(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Retain metadata segments without retaining the full-resolution image buffer.
  const parts = [bytes.subarray(0, 2)]
  let offset = 2
  while (offset + 4 <= bytes.length) {
    const start = offset
    if (bytes[offset++] !== 0xff) return
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]!
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return
    const length = view.getUint16(offset)
    const end = offset + length
    if (length < 2 || end > bytes.length) return
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) parts.push(bytes.subarray(start, end))
    offset = end
  }
  if (parts.length === 1) return
  parts.push(new Uint8Array([0xff, 0xd9]))
  const snapshot = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let position = 0
  for (const part of parts) { snapshot.set(part, position); position += part.length }
  return snapshot
}

export function rememberPhotoMetadata(photo: any, bytes: Uint8Array) {
  const snapshot = jpegMetadata(bytes)
  if (snapshot) photo[sourceMetadata] = snapshot
}

export function originalPhotoMetadata(photo: any): Uint8Array | undefined { return photo[sourceMetadata] }

export function clonePhoto(photo: any) {
  const snapshot = JSON.parse(JSON.stringify(photo))
  if (photo[sourceMetadata]) snapshot[sourceMetadata] = photo[sourceMetadata]
  return snapshot
}

export async function readCameraMetadata(bytes: Uint8Array) {
  let rawExif: Record<string, any> = {}
  let failed = false
  try { rawExif = await exifr.parse(bytes, options) || {} }
  catch { failed = true }
  for (const fallbackOptions of [extendedOptions, xmpOptions]) {
    if (hasValue(rawExif.Make) && hasValue(rawExif.Model)) break
    try {
      const fallback = await exifr.parse(bytes, fallbackOptions) || {}
      for (const [key, value] of Object.entries(fallback)) if (!hasValue(rawExif[key])) rawExif[key] = value
    } catch { failed = true }
  }
  const missing = [['Make', '品牌'], ['Model', '型号']].filter(([key]) => !hasValue(rawExif[key!])).map(([, label]) => label)
  const partial = failed || (Array.isArray(rawExif.errors) && rawExif.errors.length > 0)
  const metadataWarning = missing.length
    ? `${partial ? '相机信息读取不完整，暂' : '这份导入文件'}未读到相机${missing.join('、')}。可重新选择原图，或从聊天中导入 JPG 原文件。`
    : partial ? '已读取相机品牌和型号，部分附加元数据未能读取。' : ''
  return { rawExif, metadataWarning }
}
