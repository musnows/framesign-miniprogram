import { createCanvas } from './canvas'

export function getInkCenterY(canvas: HTMLCanvasElement): number | undefined {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  const rows = new Float64Array(canvas.height)
  let peak = 0
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      rows[y] = Math.max(rows[y], pixels[(y * canvas.width + x) * 4 + 3])
    }
    peak = Math.max(peak, rows[y])
  }
  if (peak === 0) return undefined

  const threshold = peak / 2
  let first = 0
  let last = rows.length - 1
  while (rows[first] < threshold) first++
  while (rows[last] < threshold) last--
  const before = first > 0 ? rows[first - 1] : 0
  const after = last + 1 < rows.length ? rows[last + 1] : 0
  const top = first - 0.5 + (threshold - before) / (rows[first] - before)
  const bottom = last + 0.5 + (rows[last] - threshold) / (rows[last] - after)
  return (top + bottom) / 2
}

export function alignInkLayer(render: (offsetY: number) => HTMLCanvasElement, target: number): HTMLCanvasElement {
  let best = render(0)
  const initialCenter = getInkCenterY(best)
  if (initialCenter === undefined) return best
  let bestError = Math.abs(initialCenter - target)
  let lower = -2
  let upper = 2
  for (let attempt = 0; attempt < 9 && bestError > 0.02; attempt++) {
    const offset = (lower + upper) / 2
    const candidate = render(offset)
    const center = getInkCenterY(candidate)
    if (center === undefined) break
    const error = Math.abs(center - target)
    if (error < bestError) {
      best = candidate
      bestError = error
    }
    if (center < target) lower = offset
    else upper = offset
  }
  return best
}

export function trimHorizontalInk(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width
  let right = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
    }
  }
  if (right < left) return canvas
  const trimmed = createCanvas(right - left + 1, canvas.height)
  trimmed.getContext('2d')!.drawImage(canvas, -left, 0)
  return trimmed
}
