import { detectHiddenWatermarkInRgba, embedHiddenWatermarkInRgba } from './shared/lib/watermark/hiddenWatermarkCore'

declare const worker: any
worker.onMessage((message: any) => {
  try {
    const pixels = new Uint8ClampedArray(message.pixels)
    if (message.mode === 'embed') {
      embedHiddenWatermarkInRgba(pixels, message.width, message.height, message.marker)
      worker.postMessage({ pixels: pixels.buffer })
    } else {
      worker.postMessage({ result: detectHiddenWatermarkInRgba(pixels, message.width, message.height) })
    }
  } catch {
    worker.postMessage({ error: 'Watermark processing failed' })
  }
})
