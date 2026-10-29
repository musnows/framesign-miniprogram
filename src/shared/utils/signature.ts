import { DEFAULT_SIGNATURE, clampSignatureOpacity, fitSignature, hasSignature, signatureBounds, type SignatureAnchor, type SignatureOptions } from '~/lib/editor/signature'
import { createCanvas, loadImage, parseColor } from './canvas'

export interface SignatureRuntime {
  image: HTMLCanvasElement
  options: SignatureOptions
  placed: boolean
}

export function signatureColor(options: SignatureOptions, background = '#FFFFFF', lightText = false): string | null {
  if (options.mask === 'original') return null
  if (options.mask === 'custom') return options.color
  if (lightText) return '#FFFFFF'
  const sample = createCanvas(1, 1).getContext('2d')!
  sample.fillStyle = '#FFFFFF'
  sample.fillStyle = parseColor(background)
  sample.fillRect(0, 0, 1, 1)
  const [r = 255, g = 255, b = 255] = sample.getImageData(0, 0, 1, 1).data
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#000000' : '#FFFFFF'
}

export async function signatureImage(dataUrl: string, color: string | null = null): Promise<HTMLCanvasElement> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width * height > 16000000) throw new Error('PNG dimensions are too large')
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  if (color) {
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
  }
  return canvas
}

export async function readSignaturePng(file: File): Promise<Pick<SignatureOptions, 'dataUrl' | 'name' | 'aspectRatio'>> {
  if (file.size > 10 * 1024 * 1024) throw new Error('PNG must be smaller than 10 MB')
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (header.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('Invalid PNG signature')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read PNG'))
    reader.readAsDataURL(file)
  })
  const image = await signatureImage(dataUrl)
  const ctx = image.getContext('2d')!
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data
  let left = image.width
  let right = -1
  let top = image.height
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (pixels[(y * image.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left) throw new Error('PNG contains no visible pixels')
  const cropped = createCanvas(right - left + 1, bottom - top + 1)
  cropped.getContext('2d')!.drawImage(image, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
  return {
    dataUrl: cropped.toDataURL('image/png'),
    name: file.name.replace(/\.png$/i, '').slice(0, 80),
    aspectRatio: cropped.width / cropped.height
  }
}

export async function prepareSignature(config: Record<string, any>, background?: string, lightText = false, defaultAnchor: SignatureAnchor = 'params'): Promise<SignatureRuntime | undefined> {
  if (!hasSignature(config)) return
  const options: SignatureOptions = { ...DEFAULT_SIGNATURE, ...config.signature, anchor: config.signature.anchor ?? defaultAnchor }
  const image = await signatureImage(options.dataUrl, signatureColor(options, background, lightText))
  options.aspectRatio = image.width / image.height
  return { options, image, placed: false }
}

export function templateSignature(runtime?: SignatureRuntime, anchor?: SignatureAnchor) {
  return runtime?.options.position === 'template' && (!anchor || (runtime.options.anchor ?? 'params') === anchor) ? runtime : undefined
}

export function drawSignature(ctx: CanvasRenderingContext2D, runtime: SignatureRuntime, x: number, y: number, width: number, height: number) {
  ctx.save()
  ctx.globalAlpha *= clampSignatureOpacity(runtime.options.opacity)
  ctx.drawImage(runtime.image, x, y, width, height)
  ctx.restore()
  runtime.placed = true
}

export function appendSignature(layer: HTMLCanvasElement, runtime: SignatureRuntime, referenceWidth: number) {
  const requestedWidth = runtime.options.anchor === 'camera'
    ? Math.max(referenceWidth * runtime.options.width, layer.height * runtime.options.aspectRatio)
    : referenceWidth * runtime.options.width
  const size = fitSignature(referenceWidth * 0.3, layer.height, runtime.options.aspectRatio, requestedWidth)
  const gap = referenceWidth * 0.015
  const maxTextWidth = Math.max(1, referenceWidth * 0.88 - size.width - gap)
  const textWidth = Math.min(layer.width, maxTextWidth)
  const canvas = createCanvas(textWidth + gap + size.width, Math.max(layer.height, size.height))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(layer, 0, (canvas.height - layer.height) / 2, textWidth, layer.height)
  drawSignature(ctx, runtime, textWidth + gap, (canvas.height - size.height) / 2, size.width, size.height)
  return canvas
}

export function finishSignature(canvas: HTMLCanvasElement, runtime?: SignatureRuntime, preview = false) {
  if (!runtime || runtime.placed || (preview && runtime.options.position === 'custom')) return canvas
  const options = runtime.options.position === 'template'
    ? { ...runtime.options, x: 0.81, y: 0.88 }
    : runtime.options
  const bounds = signatureBounds(options, canvas.width, canvas.height)
  drawSignature(canvas.getContext('2d')!, runtime, bounds.x, bounds.y, bounds.width, bounds.height)
  return canvas
}
