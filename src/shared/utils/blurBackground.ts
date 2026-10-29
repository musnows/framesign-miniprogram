import { createCanvas, drawBlurredCanvas } from './canvas'

export function blurBackground(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  radius: number,
  strength: number
): HTMLCanvasElement {
  const padding = Math.ceil(radius * 3) + 1
  const padded = createCanvas(width + padding * 2, height + padding * 2)
  const pCtx = padded.getContext('2d')!
  const columns = [
    [0, 1, 0, padding],
    [0, source.width, padding, width],
    [source.width - 1, 1, padding + width, padding]
  ]
  const rows = [
    [0, 1, 0, padding],
    [0, source.height, padding, height],
    [source.height - 1, 1, padding + height, padding]
  ]

  // Extend image edges so disabling the vignette also removes transparent blur borders.
  for (const [sx, sw, dx, dw] of columns) {
    for (const [sy, sh, dy, dh] of rows) {
      pCtx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
    }
  }

  const result = createCanvas(width, height)
  const ctx = result.getContext('2d')!
  drawBlurredCanvas(ctx, padded, -padding, -padding, radius)

  const amount = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0
  if (amount > 0) {
    ctx.save()
    ctx.scale(width / 2, height / 2)
    const gradient = ctx.createRadialGradient(1, 1, 0.35, 1, 1, Math.SQRT2)
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, `rgba(0,0,0,${amount})`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 2, 2)
    ctx.restore()
  }

  return result
}
