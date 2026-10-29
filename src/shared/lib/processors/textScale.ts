export function resolveTextScale(config: Record<string, any>, width: number, height: number): number {
  if (height <= width) return 1

  const value = Number(config.watermarkScale)
  if (!Number.isFinite(value)) return 1

  return Math.min(Math.max(value, 0.8), 1.2)
}
