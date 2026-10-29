export class TextEncoder {
  encode(value = ''): Uint8Array {
    const clean = Array.from(String(value), character => {
      const code = character.codePointAt(0)!
      return code >= 0xd800 && code <= 0xdfff ? '\ufffd' : character
    }).join('')
    const encoded = encodeURIComponent(clean)
    const bytes: number[] = []
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === '%') {
        bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16))
        i += 2
      } else bytes.push(encoded.charCodeAt(i))
    }
    return Uint8Array.from(bytes)
  }
}

export class TextDecoder {
  fatal: boolean
  constructor(_encoding = 'utf-8', options: { fatal?: boolean } = {}) {
    this.fatal = !!options.fatal
  }
  decode(input: ArrayBuffer | ArrayBufferView = new Uint8Array()): string {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input)
    try {
      return decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, '0')}`).join(''))
    } catch (error) {
      if (this.fatal) throw error
      return Array.from(bytes, byte => byte < 128 ? String.fromCharCode(byte) : '\ufffd').join('')
    }
  }
}

export class Blob {
  bytes: Uint8Array
  type: string
  size: number
  constructor(parts: Array<ArrayBuffer | ArrayBufferView | Blob | string> = [], options: { type?: string } = {}) {
    const arrays = parts.map(part => typeof part === 'string' ? new TextEncoder().encode(part)
      : part instanceof Blob ? part.bytes : ArrayBuffer.isView(part)
        ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength) : new Uint8Array(part))
    this.size = arrays.reduce((size, part) => size + part.length, 0)
    this.bytes = new Uint8Array(this.size)
    let offset = 0
    for (const part of arrays) { this.bytes.set(part, offset); offset += part.length }
    this.type = options.type || ''
  }
  async arrayBuffer(): Promise<ArrayBuffer> { return this.bytes.slice().buffer }
  slice(start = 0, end = this.size, type = '') { return new Blob([this.bytes.slice(start, end)], { type }) }
}

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

export function insertPngExif(png: Uint8Array, tiff?: Uint8Array): Uint8Array {
  if (!tiff) return png
  if (png.length < 33 || png[0] !== 137 || png[1] !== 80) throw new Error('Invalid PNG output')
  const chunk = new Uint8Array(tiff.length + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, tiff.length)
  chunk.set([101, 88, 73, 102], 4)
  chunk.set(tiff, 8)
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)))
  const parts: Uint8Array[] = [png.subarray(0, 33), chunk]
  const pngView = new DataView(png.buffer, png.byteOffset, png.byteLength)
  for (let offset = 33; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk')
    const end = offset + pngView.getUint32(offset) + 12
    if (end > png.length) throw new Error('Invalid PNG chunk size')
    if (!(png[offset + 4] === 101 && png[offset + 5] === 88 && png[offset + 6] === 73 && png[offset + 7] === 102)) parts.push(png.subarray(offset, end))
    offset = end
  }
  return new Blob(parts).bytes
}
