import { ImageProcessor, type ProcessorContext } from './types'
import { createCanvas, drawText, loadImage, parseColor, loadCanvasFont } from '~/utils/canvas'
import { renderTemplate } from './templateRenderer'
import { alignInkLayer, getInkCenterY, trimHorizontalInk } from '~/utils/inkAlignment'
import { appendSignature, templateSignature } from '~/utils/signature'
import { resolveTextScale } from './textScale'

/**
 * 多段富文本处理器
 * 渲染多段不同样式的文本及可着色的图片标识
 */
export class MultiRichTextProcessor extends ImageProcessor {
  name = 'multi_rich_text'
  category = 'generator' as const

  async process(ctx: ProcessorContext): Promise<ProcessorContext> {
    const config = ctx.config
    const exif = ctx.exif

    if (!config.text_segments || !Array.isArray(config.text_segments)) {
      console.warn('[MultiRichTextProcessor] No text_segments configured')
      return ctx
    }

    // 渲染每段文本
    const segments = config.text_segments.map((segment: any) => ({
      text: renderTemplate(segment.text || '', exif, config),
      image: segment.image,
      image_scale: config[segment.image_scale_key] ?? segment.image_scale ?? 1,
      color: config[segment.color_key] || segment.color || 'white',
      is_bold: segment.is_bold || false,
      trim: segment.trim || false
    })).filter((seg: any) => seg.text || seg.image)

    if (segments.length === 0) {
      console.warn('[MultiRichTextProcessor] No text after rendering')
      return ctx
    }

    // 获取参考尺寸（原图尺寸）
    const referenceHeight = ctx.buffer[0]?.height || 1000
    const referenceWidth = ctx.buffer[0]?.width || 1000

    // 计算文本高度和间距
    const textScale = resolveTextScale(config, referenceWidth, referenceHeight)
    const height = this.calculateHeight(config.height, referenceHeight) * textScale
    const fontSize = height * 0.8
    const textSpacing = this.calculateSpacing(config.text_spacing, referenceWidth)  // 使用图片宽度作为参考

    await Promise.all([...new Set(segments.filter((seg: any) => seg.text).map((seg: any) => seg.is_bold ? '700' : '300'))].map(weight =>
      loadCanvasFont(`${weight} ${fontSize}px "Alibaba PuHuiTi"`)
    ))

    // 创建临时 canvas 测量文本
    const tempCanvas = createCanvas(1, 1)
    const tempCtx = tempCanvas.getContext('2d')!

    const segmentMetrics = await Promise.all(segments.map(async (seg: any) => {
      if (seg.image) {
        const image = await loadImage(seg.image)
        // 固定排版占位，缩放标识时不改变两侧文字的尺寸和位置。
        const baseImageHeight = height * 0.8
        const aspectRatio = (image.naturalWidth || image.width) / (image.naturalHeight || image.height)
        const width = Math.ceil(baseImageHeight * aspectRatio)
        const scale = Number(seg.image_scale)
        const imageHeight = baseImageHeight * (Number.isFinite(scale) && scale > 0 ? scale : 1)
        const imageWidth = Math.ceil(imageHeight * aspectRatio)
        const rasterScale = 4
        const imageCanvas = createCanvas(imageWidth * rasterScale, Math.ceil(imageHeight * rasterScale))
        const imageCtx = imageCanvas.getContext('2d')!
        imageCtx.drawImage(image, 0, 0, imageWidth * rasterScale, imageHeight * rasterScale)
        imageCtx.globalCompositeOperation = 'source-in'
        imageCtx.fillStyle = parseColor(seg.color)
        imageCtx.fillRect(0, 0, imageCanvas.width, imageCanvas.height)
        return { ...seg, width, imageCanvas, imageWidth, imageHeight }
      }

      const fontWeight = seg.is_bold ? '700' : '300'
      const fontFamily = '"Alibaba PuHuiTi", Arial, sans-serif'
      tempCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
      const metrics = tempCtx.measureText(seg.text)
      const width = Math.ceil(metrics.width)
      const baselineOffset = Number.isFinite(metrics.actualBoundingBoxAscent) && Number.isFinite(metrics.actualBoundingBoxDescent)
        ? (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
        : fontSize * 0.3
      const glyphPadding = 2
      const glyphWidth = width + glyphPadding * 2
      const glyphHeight = height + glyphPadding * 2
      const glyphCanvas = createCanvas(glyphWidth * 4, Math.ceil(glyphHeight * 4))
      const glyphCtx = glyphCanvas.getContext('2d')!
      glyphCtx.scale(4, 4)
      drawText(glyphCtx, {
        text: seg.text,
        x: glyphPadding,
        y: height / 2 + glyphPadding + baselineOffset,
        align: 'left',
        baseline: 'alphabetic',
        color: parseColor(seg.color),
        fontSize,
        fontWeight: seg.is_bold ? '700' : '300',
        fontFamily: '"Alibaba PuHuiTi", Arial, sans-serif'
      })
      return {
        ...seg,
        width,
        glyphCanvas,
        glyphPadding,
        glyphWidth,
        glyphHeight
      }
    }))

    // 计算总宽度
    const totalWidth = segmentMetrics.reduce((sum: number, seg: any) => sum + seg.width, 0) +
                       textSpacing * (segments.length - 1)

    // 创建文本图层
    const padding = config.trim ? 0 : 40
    const textCanvas = createCanvas(totalWidth + padding * 2, height + padding * 2)
    const tCtx = textCanvas.getContext('2d')!

    // 绘制每段文本
    const renderSegment = (seg: any, currentX: number, offsetY: number) => {
      const layer = createCanvas(textCanvas.width, textCanvas.height)
      const layerCtx = layer.getContext('2d', { willReadFrequently: true })!
      if (seg.imageCanvas) {
        layerCtx.drawImage(
          seg.imageCanvas,
          currentX + (seg.width - seg.imageWidth) / 2,
          padding + (height - seg.imageHeight) / 2 + offsetY,
          seg.imageWidth,
          seg.imageHeight
        )
        return layer
      }

      layerCtx.drawImage(
        seg.glyphCanvas,
        currentX - seg.glyphPadding,
        padding - seg.glyphPadding + offsetY,
        seg.glyphWidth,
        seg.glyphHeight
      )
      return layer
    }
    let currentX = padding
    let inkCenter: number | undefined
    segmentMetrics.forEach((seg: any) => {
      const render = (offsetY: number) => renderSegment(seg, currentX, offsetY)
      const layer = inkCenter === undefined ? render(0) : alignInkLayer(render, inkCenter)
      inkCenter ??= getInkCenterY(layer)
      tCtx.drawImage(layer, 0, 0)
      currentX += seg.width + textSpacing
    })

    // 添加到 buffer
    const cameraCanvas = config.trim_ink_x ? trimHorizontalInk(textCanvas) : textCanvas
    const signature = templateSignature(ctx.signature, 'camera')
    ctx.buffer.push(signature ? appendSignature(cameraCanvas, signature, referenceWidth) : cameraCanvas)
    return ctx
  }

  private calculateHeight(value: number | undefined, reference: number): number {
    if (!value) return 50
    if (value > 0 && value <= 1) return value * reference
    return value
  }

  private calculateSpacing(value: number | undefined, reference: number): number {
    if (value === undefined) return 10  // 默认 10 像素

    // 支持负值（让文字重叠）
    if (value > -1 && value < 1) {
      // 小数（-1 到 1 之间）视为百分比
      return value * reference
    }

    // 其他情况视为固定像素（包括负数）
    return value
  }
}
