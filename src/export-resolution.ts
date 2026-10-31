export const MAX_CANVAS_PIXELS = 16000000
export const MAX_CANVAS_EDGE = 8192
export const EXPORT_PRESETS = [1280, 2048, 2560, 4096]

export interface RenderMetrics {
  key: string
  sourceWidth: number
  sourceHeight: number
  referenceWidth: number
  referenceHeight: number
  outputWidth: number
  outputHeight: number
  peakWidth: number
  peakHeight: number
  peakPixels: number
}

export function canvasScale(width: number, height: number, pixels = width * height) {
  if (!(width > 0 && height > 0 && pixels > 0) || !Number.isFinite(width + height + pixels)) throw new Error('Invalid image dimensions')
  return Math.min(1, MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height, Math.sqrt(MAX_CANVAS_PIXELS / pixels))
}

export class CanvasSizeLimitError extends Error {
  constructor(readonly width: number, readonly height: number) {
    super('Canvas size exceeds the mobile memory limit')
  }
}

export function resolutionKey(photo: any) {
  return JSON.stringify([photo.path, photo.templateId, photo.config, photo.exif, photo.overrides, photo.cameraSelection])
}

export function matchingMetrics(photo: any): RenderMetrics | undefined {
  return photo.renderMetrics?.key === resolutionKey(photo) ? photo.renderMetrics : undefined
}

export function exportResolution(photo: any) {
  const metrics = matchingMetrics(photo)
  const sourceWidth = metrics?.sourceWidth || photo.width
  const sourceHeight = metrics?.sourceHeight || photo.height
  const factor = metrics ? Math.max(sourceWidth / metrics.referenceWidth, sourceHeight / metrics.referenceHeight) : 1
  const outputWidth = metrics ? Math.round(metrics.outputWidth * factor) : sourceWidth
  const outputHeight = metrics ? Math.round(metrics.outputHeight * factor) : sourceHeight
  const peakWidth = Math.max(sourceWidth, metrics ? metrics.peakWidth * factor : sourceWidth)
  const peakHeight = Math.max(sourceHeight, metrics ? metrics.peakHeight * factor : sourceHeight)
  const peakPixels = Math.max(sourceWidth * sourceHeight, metrics ? metrics.peakPixels * factor * factor : sourceWidth * sourceHeight)
  const scale = canvasScale(peakWidth, peakHeight, peakPixels)
  const originalSupported = scale >= 1 - 1e-10
  const fittedScale = originalSupported ? 1 : scale
  return {
    originalSupported, sourceWidth, sourceHeight,
    sourceMaxSide: originalSupported ? Math.max(sourceWidth, sourceHeight) : Math.max(1, Math.floor(Math.max(sourceWidth, sourceHeight) * scale)),
    width: Math.max(1, Math.floor(outputWidth * fittedScale)), height: Math.max(1, Math.floor(outputHeight * fittedScale))
  }
}

export function exportSizeOptions(photo: any, maxSide = 0) {
  const size = exportResolution(photo)
  const longest = Math.max(size.width, size.height)
  const values = [0, ...EXPORT_PRESETS.filter(value => value < longest)]
  const labels = [size.originalSupported ? '原始尺寸' : `最高支持尺寸 · 约 ${size.width} × ${size.height}`, ...values.slice(1).map(value => `${value} px${value === 1280 ? ' · 轻量' : ''}`)]
  const index = Math.max(0, values.indexOf(Number(maxSide)))
  const notice = size.originalSupported ? '' : values[index] === 0
    ? `照片或模板成片超出原始尺寸支持范围，将自动以支持的最高分辨率导出（约 ${size.width} × ${size.height}）。`
    : `原图超出原始尺寸支持范围，将按你选择的 ${values[index]} px 导出，无需修改原图。`
  const hint = values[index] === 0 ? '优先保留原始尺寸；超限时会自动以支持的最高分辨率导出，无需手动调整。' : `按所选长边 ${values[index]} px 导出，小图不会放大。`
  return { sizeLabels: labels, sizeValues: values, sizeIndex: index, resolutionNotice: notice, exportSizeHint: notice || hint }
}
