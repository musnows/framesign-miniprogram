import { buildCustomLogoConfig } from './shared/utils/customLogos'
import { getLogoPath } from './shared/utils/logoMapper'

export function photoBrand(photo: any): string { return String(({ ...photo.exif, ...photo.overrides }).Make || '').trim() }

export function withBrandLogos(photo: any, logos: Map<string, string> = new Map()) {
  return { ...photo, config: { ...photo.config, ...buildCustomLogoConfig(photoBrand(photo), logos) } }
}

export function brandGroups(photos: any[], logos: Map<string, string> = new Map()) {
  const counts = new Map<string, number>()
  for (const photo of photos) counts.set(photoBrand(photo), (counts.get(photoBrand(photo)) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([brand, count]) => ({ brand, name: brand || '无品牌照片（默认 Logo）', count, path: logos.get(brand) || getLogoPath(brand), custom: logos.has(brand) }))
}

export function applyPhotoStyle(photos: any[], source: any, selectedIds: Array<number | string>) {
  const selected = new Set(selectedIds.map(String))
  const config = JSON.stringify(source.config)
  for (const photo of photos) if (selected.has(String(photo.id))) {
    photo.templateId = source.templateId
    photo.config = JSON.parse(config)
  }
}
