import exifr from 'exifr'

const options = { mergeOutput: true, translateValues: true, reviveValues: true }
const extendedOptions = { ...options, xmp: true, multiSegment: true }
const xmpOptions = { ...extendedOptions, tiff: false }
const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).replace(/\0/g, '').trim() !== ''

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
