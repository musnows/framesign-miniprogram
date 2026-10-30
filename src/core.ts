import exifr from 'exifr'
import * as templateDefinitions from './shared/lib/templates'
import { getTemplateDefaultConfig } from './shared/lib/templates/userOptions'
import { initProcessors, getProcessor } from './shared/lib/processors'
import { createCanvas, loadImage } from './shared/utils/canvas'
import { prepareSignature, finishSignature } from './shared/utils/signature'
import { DEFAULT_SIGNATURE, getDefaultSignatureAnchor } from './shared/lib/editor/signature'
import { normalizeParsedExif, EDITABLE_EXIF_FIELDS, DATE_TIME_FORMAT_OPTIONS } from './shared/lib/editor/exif'
import { preserveExportExif, extractExif, normalizeExif } from './shared/lib/editor/exportExif'
import { filterPhotographyExif } from './shared/lib/editor/photographyExif'
import { BUILTIN_LOGOS } from './shared/lib/editor/builtinLogos'
import { configurationControls } from './editor-config'
import { Blob, TextEncoder, insertPngExif } from './binary'
import { api, readBytes, writeBytes, installPlatform, releaseCanvases, fitDimensions } from './platform'

declare const wx: any
export { version as APP_VERSION } from '../package.json'
export { api, readBytes, fitDimensions, EDITABLE_EXIF_FIELDS, DATE_TIME_FORMAT_OPTIONS, DEFAULT_SIGNATURE }
export { getDefaultSignatureAnchor, clampSignatureOpacity, clampSignatureWidth, setSignatureWidth, signatureBounds, draggedSignatureWidth } from './shared/lib/editor/signature'
export { addSavedDateTimeFormat, parseSavedDateTimeFormats } from './shared/lib/editor/savedDateTimeFormats'
export { formatDateTimeValue } from './shared/lib/editor/exif'
export { readPhotoMetadata, metadataPage } from './metadata'
export { photoBrand, withBrandLogos, brandGroups, applyPhotoStyle } from './photo-selection'
export const templates = ['noProcess', 'standard1', 'standard2', 'logoCentered', 'blurBackground', 'nikonBlur', 'folderNameParams', 'centeredWatermark', 'sidebarWatermark', 'centeredWatermark2', 'personalText'].map(key => (templateDefinitions as any)[key])
export const logos = BUILTIN_LOGOS.map(logo => ({ ...logo, path: logo.path.replace(/\.svg$/, '.png') })).filter((logo, index, list) => list.findIndex(item => item.path === logo.path) === index)
export const defaultExport = { maxSide: 2048, format: 'jpg', preserveExif: true, photographyOnly: false }
export const demoExif = { Make: 'NIKON', Model: 'NIKON Z 6_2', LensModel: 'NIKKOR Z 24-200mm f/4-6.3 VR', FocalLength: '67mm', FNumber: 'f/6.3', ExposureTime: '1/200s', ISO: 'ISO 360', DateTimeOriginal: '2023-06-16 07:15:00' }
let initialized = false
let operation = Promise.resolve()
let signatureSerial = 0
let cancelWorker: (() => void) | undefined

export function cancelDetection() { cancelWorker?.() }

function processWatermark(mode: 'embed' | 'detect', pixels: Uint8ClampedArray, width: number, height: number, marker = ''): Promise<any> {
  return new Promise((resolve, reject) => {
    const thread = wx.createWorker('workers/watermark.js')
    let settled = false
    const finish = (error?: Error, result?: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cancelWorker = undefined
      thread.terminate()
      error ? reject(error) : resolve(result)
    }
    const timer = setTimeout(() => finish(new Error('水印处理超时，请使用较小的照片重试。')), 90000)
    cancelWorker = () => finish(new Error('水印处理已停止。'))
    thread.onMessage((message: any) => finish(message.error ? new Error('水印处理失败，请重试。') : undefined, message))
    if (thread.onError) thread.onError(() => finish(new Error('水印处理线程启动失败，请更新微信后重试。')))
    try { thread.postMessage({ mode, pixels: pixels.buffer, width, height, marker }) }
    catch { finish(new Error('无法启动水印处理，请重试。')) }
  })
}

export function initialize() {
  if (initialized) return
  installPlatform()
  initProcessors()
  initialized = true
}

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const pending = operation.then(task, task)
  operation = pending.then(() => undefined, () => undefined)
  return pending
}

export function template(id: string) { return templates.find(item => item.id === id) || templates[1] }
export function defaults(id: string) { return getTemplateDefaultConfig(template(id)) }
export function templateControls(id: string, config: Record<string, any>) { return configurationControls(template(id), config) }
export function markerBytes(marker: string) { return new TextEncoder().encode(String(marker).trim()).length }

export function validateConfig(config: Record<string, any>) {
  if (config.hiddenWatermarkEnabled && (markerBytes(config.hiddenWatermarkText || '') < 1 || markerBytes(config.hiddenWatermarkText) > 64)) {
    throw new Error('隐藏水印需要 1–64 字节，中文约占 3 字节。')
  }
}

export function createDemo(id: number, templateId = 'standard1') {
  return { id, path: '/assets/sample.jpg', name: '山间晨光 · 示例', width: 1080, height: 720, exif: { ...demoExif }, rawExif: { ...demoExif }, overrides: {}, templateId, config: defaults(templateId), isDemo: true }
}

export async function pickImages(source = 'album', count = 9) {
  const result = source === 'message'
    ? await api('chooseMessageFile', { count: Math.min(100, count), type: 'image' })
    : await api('chooseMedia', { count: Math.min(9, count), mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] })
  return (result.tempFiles || []).map((file: any) => ({ ...file, tempFilePath: file.tempFilePath || file.path }))
}

export async function importPhotos(templateId = 'noProcess', remaining = 9, source = 'album') {
  const selected = await pickImages(source, remaining)
  const photos = []
  const failures = []
  for (const file of selected) {
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('照片超过 40 MB，请选择较小的图片。')
      const info = await api('getImageInfo', { src: file.tempFilePath })
      const bytes = await readBytes(file.tempFilePath)
      let rawExif = {}
      let metadataWarning = ''
      try { rawExif = await exifr.parse(bytes, { mergeOutput: true, translateValues: true, reviveValues: true }) || {} }
      catch { metadataWarning = '未能读取 EXIF，可以手动补充。' }
      photos.push({ path: file.tempFilePath, name: file.name || file.tempFilePath.split('/').pop(), type: info.type || '', size: bytes.length, width: info.width, height: info.height, exif: normalizeParsedExif(rawExif), rawExif, overrides: {}, templateId, config: defaults(templateId), metadataWarning })
    } catch (error: any) { failures.push(error.message || error.errMsg || '图片无法读取') }
  }
  return { photos, failures }
}

function stepsFor(photo: any, width: number, height: number) {
  const processors = template(photo.templateId).processors
  if (Array.isArray(processors)) return processors
  return width / height > 1.1 ? processors.landscape : width / height < 0.9 ? processors.portrait : processors.square || processors.portrait
}

async function render(photo: any, maxSide: number, hidden = false) {
  initialize()
  const config = { ...defaults(photo.templateId), ...photo.config }
  if (hidden) validateConfig(config)
  const image = await loadImage(photo.path)
  const dimensions = fitDimensions(image.width, image.height, maxSide)
  const source = createCanvas(dimensions.width, dimensions.height)
  source.getContext('2d')!.drawImage(image, 0, 0, source.width, source.height)
  const steps = stepsFor(photo, source.width, source.height)
  const context: any = { sourceCanvas: source, buffer: [source], exif: { ...photo.exif, ...photo.overrides }, config }
  const lightText = steps.length === 0 || steps.some((step: any) => step.auto_params || step.processor_name === 'personal_text_overlay')
  context.signature = await prepareSignature(config, config.backgroundColor, lightText, getDefaultSignatureAnchor(steps))
  for (const step of steps) {
    const Processor = getProcessor(step.processor_name)
    if (!Processor) throw new Error(`Unknown image processor: ${step.processor_name}`)
    context.config = { ...step, ...config }
    await new Processor().process(context)
    releaseCanvases([source, ...context.buffer, ...(context.signature ? [context.signature.image] : [])])
  }
  let output = finishSignature(context.buffer[context.buffer.length - 1] || source, context.signature)
  const finalDimensions = fitDimensions(output.width, output.height, maxSide)
  if (finalDimensions.resized) {
    const resized = createCanvas(finalDimensions.width, finalDimensions.height)
    resized.getContext('2d')!.drawImage(output, 0, 0, resized.width, resized.height)
    output = resized
  }
  if (hidden && config.hiddenWatermarkEnabled) {
    if (output.width < 448 || output.height < 448) throw new Error('隐藏水印需要宽、高均至少 448 像素的照片。')
    const ctx = output.getContext('2d')!
    const pixels = ctx.getImageData(0, 0, output.width, output.height)
    const embedded = await processWatermark('embed', pixels.data, output.width, output.height, config.hiddenWatermarkText.trim())
    pixels.data.set(new Uint8ClampedArray(embedded.pixels))
    ctx.putImageData(pixels, 0, 0)
  }
  return output
}

async function canvasFile(source: HTMLCanvasElement, target: HTMLCanvasElement, format: string) {
  target.width = source.width
  target.height = source.height
  const ctx = target.getContext('2d')!
  ctx.clearRect(0, 0, target.width, target.height)
  if (format === 'jpg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, target.width, target.height) }
  ctx.drawImage(source, 0, 0)
  const result = await api('canvasToTempFilePath', { canvas: target, x: 0, y: 0, width: target.width, height: target.height, destWidth: target.width, destHeight: target.height, fileType: format, quality: 1 })
  return result.tempFilePath as string
}

export function previewPhoto(photo: any, canvas: HTMLCanvasElement) {
  const snapshot = JSON.parse(JSON.stringify(photo))
  return exclusive(async () => {
    try {
      const output = await render(snapshot, 960)
      const path = await canvasFile(output, canvas, 'png')
      return { path, width: output.width, height: output.height }
    } finally { releaseCanvases(); canvas.width = 1; canvas.height = 1 }
  })
}

export async function preserveMetadata(output: Uint8Array, source: Uint8Array, options: any, width: number, height: number) {
  if (!options.preserveExif) return output
  const sourceBlob = new Blob([source]) as any
  if (options.format === 'png') {
    const original = await extractExif(sourceBlob)
    if (!original) return output
    const selected = options.photographyOnly ? filterPhotographyExif(original) : original
    return insertPngExif(output, normalizeExif(selected, width, height))
  }
  const result = await preserveExportExif(new Blob([output]) as any, sourceBlob, true, options.photographyOnly)
  return new Uint8Array(await result.arrayBuffer())
}

export function exportPhoto(photo: any, canvas: HTMLCanvasElement, settings: any = defaultExport) {
  const snapshot = JSON.parse(JSON.stringify(photo))
  const options = { ...defaultExport, ...settings }
  options.maxSide = [1280, 2048, 2560].includes(Number(options.maxSide)) ? Number(options.maxSide) : 2048
  options.format = snapshot.config.hiddenWatermarkEnabled ? 'png' : options.format === 'png' ? 'png' : 'jpg'
  return exclusive(async () => {
    try {
      const output = await render(snapshot, options.maxSide, true)
      const width = output.width
      const height = output.height
      let path = await canvasFile(output, canvas, options.format)
      if (options.preserveExif && !snapshot.isDemo) {
        const result = await preserveMetadata(await readBytes(path), await readBytes(snapshot.path), options, width, height)
        path = await writeBytes(`${wx.env.USER_DATA_PATH}/yingqian-export.${options.format}`, result)
      }
      return { path, width, height, format: options.format }
    } finally { releaseCanvases(); canvas.width = 1; canvas.height = 1 }
  })
}

export function importSignature(canvas: HTMLCanvasElement, sourceType = 'album') {
  return exclusive(async () => {
    try {
      initialize()
      const picked = await pickImages(sourceType, 1)
      if (!picked[0]) throw new Error('未选择签名图片。')
      const path = picked[0].tempFilePath
      const bytes = await readBytes(path)
      if (bytes.length > 10 * 1024 * 1024 || Array.from(bytes.subarray(0, 8)).join(',') !== '137,80,78,71,13,10,26,10') throw new Error('请选择 10 MB 以内的透明 PNG 签名。')
      const image = await loadImage(path)
      if (image.width * image.height > 16000000) throw new Error('签名图片过大，请使用 1600 万像素以内的 PNG。')
      const source = createCanvas(image.width, image.height)
      source.getContext('2d')!.drawImage(image, 0, 0)
      const data = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data
      let left = source.width, right = -1, top = source.height, bottom = -1
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) if (data[(y * source.width + x) * 4 + 3]) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
      if (right < left) throw new Error('签名 PNG 中没有可见内容。')
      const cropped = createCanvas(right - left + 1, bottom - top + 1)
      cropped.getContext('2d')!.drawImage(source, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
      const temp = await canvasFile(cropped, canvas, 'png')
      const dataUrl = await writeBytes(`${wx.env.USER_DATA_PATH}/yingqian-signature-${Date.now()}-${++signatureSerial}.png`, await readBytes(temp))
      return { ...DEFAULT_SIGNATURE, dataUrl, name: picked[0].name || '我的签名', aspectRatio: cropped.width / cropped.height }
    } finally { releaseCanvases(); canvas.width = 1; canvas.height = 1 }
  })
}

export function importLogo(canvas: HTMLCanvasElement, sourceType = 'album') {
  return exclusive(async () => {
    try {
      initialize()
      const selected = await pickImages(sourceType, 1)
      if (!selected[0]) throw new Error('未选择 Logo 图片。')
      const bytes = await readBytes(selected[0].tempFilePath)
      if (bytes.length > 40 * 1024 * 1024) throw new Error('Logo 图片超过 40 MB。')
      const image = await loadImage(selected[0].tempFilePath)
      const source = createCanvas(image.width, image.height)
      source.getContext('2d')!.drawImage(image, 0, 0)
      const temp = await canvasFile(source, canvas, 'png')
      return writeBytes(`${wx.env.USER_DATA_PATH}/yingqian-logo-${Date.now()}-${++signatureSerial}.png`, await readBytes(temp))
    } finally { releaseCanvases(); canvas.width = 1; canvas.height = 1 }
  })
}

export function detectPhoto(path: string) {
  return exclusive(async () => {
    try {
      initialize()
      const image = await loadImage(path)
      if (image.width * image.height > 8000000) throw new Error('检测支持 800 万像素以内的照片；请使用导出原图，避免再次缩放。')
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const message = await processWatermark('detect', pixels.data, canvas.width, canvas.height)
      return message.result
    } finally { releaseCanvases() }
  })
}
