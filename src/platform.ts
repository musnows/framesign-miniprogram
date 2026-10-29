import { configureCanvasPlatform } from './shared/utils/canvas'

declare const wx: any
const canvases = new Set<HTMLCanvasElement>()

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  if (!Number.isFinite(w * h) || w * h > 16000000 || w > 8192 || h > 8192) throw new Error('Canvas size exceeds the mobile memory limit')
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
  if (!canvas || !canvas.getContext('2d')) throw new Error('Canvas 2D is unavailable. Update WeChat and try again.')
  canvases.add(canvas)
  return canvas
}

export function releaseCanvases(keep: HTMLCanvasElement[] = []) {
  const retained = new Set(keep)
  for (const canvas of canvases) {
    if (!retained.has(canvas)) {
      canvas.width = 1
      canvas.height = 1
      canvases.delete(canvas)
    }
  }
}

export function blurRgba(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  const r = Math.max(1, Math.round(radius))
  const temporary = new Uint8ClampedArray(data.length)
  const window = r * 2 + 1
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        for (let dx = -r; dx <= r; dx++) sum += data[(y * width + Math.max(0, Math.min(width - 1, dx))) * 4 + channel]!
        for (let x = 0; x < width; x++) {
          temporary[(y * width + x) * 4 + channel] = Math.round(sum / window)
          sum += data[(y * width + Math.min(width - 1, x + r + 1)) * 4 + channel]! - data[(y * width + Math.max(0, x - r)) * 4 + channel]!
        }
      }
    }
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        for (let dy = -r; dy <= r; dy++) sum += temporary[(Math.max(0, Math.min(height - 1, dy)) * width + x) * 4 + channel]!
        for (let y = 0; y < height; y++) {
          data[(y * width + x) * 4 + channel] = Math.round(sum / window)
          sum += temporary[(Math.min(height - 1, y + r + 1) * width + x) * 4 + channel]! - temporary[(Math.max(0, y - r) * width + x) * 4 + channel]!
        }
      }
    }
  }
}

export function installPlatform() {
  configureCanvasPlatform({
    createCanvas: makeCanvas,
    loadFont: async () => undefined,
    loadImage: src => new Promise((resolve, reject) => {
      const factory = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 })
      const image = factory.createImage()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Failed to load local image'))
      image.src = src.startsWith('/logos/') ? src.replace(/\.svg$/i, '.png') : src
    }),
    drawBlurred: (ctx, source, x, y, radius) => {
      if (!(radius > 0)) { ctx.drawImage(source, x, y); return }
      const ratio = Math.min(1, 360 / Math.max(source.width, source.height))
      const small = makeCanvas(source.width * ratio, source.height * ratio)
      const smallCtx = small.getContext('2d')!
      smallCtx.drawImage(source, 0, 0, small.width, small.height)
      const pixels = smallCtx.getImageData(0, 0, small.width, small.height)
      blurRgba(pixels.data, small.width, small.height, radius * ratio * 0.6)
      smallCtx.putImageData(pixels, 0, 0)
      ctx.drawImage(small, x, y, source.width, source.height)
    }
  })
}

export function api(name: string, options: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => wx[name]({ ...options, success: resolve, fail: reject }))
}

export function fileApi(name: string, options: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => wx.getFileSystemManager()[name]({ ...options, success: resolve, fail: reject }))
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const result = await fileApi('readFile', { filePath: path })
  return new Uint8Array(result.data)
}

export async function writeBytes(path: string, data: Uint8Array) {
  await fileApi('writeFile', { filePath: path, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
  return path
}

export function fitDimensions(width: number, height: number, maxSide: number, maxPixels = 4000000) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height)) throw new Error('Invalid image dimensions')
  const ratio = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)))
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)), resized: ratio < 1 }
}
