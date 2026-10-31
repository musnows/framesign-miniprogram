import { metadataRows, readFullExif, type MetadataRow } from './shared/lib/editor/fullExif'
import { readBytes } from './platform'
import { originalPhotoMetadata } from './photo-metadata'

export async function readPhotoMetadata(photo: { path: string; name: string; width: number; height: number; type?: string; size?: number }) {
  const bytes = originalPhotoMetadata(photo) || await readBytes(photo.path)
  const metadata = await readFullExif(bytes as any)
  return [
    ...metadataRows({ File: { Name: photo.name, Type: photo.type || 'unknown', Size: `${photo.size || bytes.length} bytes`, Width: photo.width, Height: photo.height } }),
    ...metadataRows(metadata)
  ]
}

export function metadataPage(rows: MetadataRow[], query = '', page = 0) {
  const matching = rows.filter(row => `${row.key} ${row.value}`.toLowerCase().includes(query.trim().toLowerCase()))
  const chunks = matching.flatMap((row, rowIndex) => {
    const count = Math.max(1, Math.ceil(row.value.length / 4096))
    return Array.from({ length: count }, (_, index) => ({
      ...row, id: `${rowIndex}-${index}`, key: row.key + (count > 1 ? ` [${index + 1}/${count}]` : ''), value: row.value.slice(index * 4096, (index + 1) * 4096)
    }))
  })
  const pages = Math.max(1, Math.ceil(chunks.length / 30))
  const index = Math.max(0, Math.min(pages - 1, page))
  return { rows: chunks.slice(index * 30, (index + 1) * 30), matching: matching.length, total: rows.length, page: index, pages }
}
