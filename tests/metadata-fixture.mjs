export function metadataFixture(image = Buffer.from([0xff, 0xd8, 0xff, 0xd9])) {
  const tiff = Buffer.alloc(1024)
  tiff.write('II')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  let offset = 8
  function directory(entries) {
    const start = offset
    offset += 2 + entries.length * 12 + 4
    tiff.writeUInt16LE(entries.length, start)
    entries.forEach(([tag, type, count, data], index) => {
      const position = start + 2 + index * 12
      tiff.writeUInt16LE(tag, position)
      tiff.writeUInt16LE(type, position + 2)
      tiff.writeUInt32LE(count, position + 4)
      if (data.length <= 4) data.copy(tiff, position + 8)
      else {
        tiff.writeUInt32LE(offset, position + 8)
        data.copy(tiff, offset)
        offset += data.length
      }
    })
    return start
  }
  const ascii = (tag, text) => [tag, 2, Buffer.byteLength(text) + 1, Buffer.from(`${text}\0`)]
  const long = value => { const data = Buffer.alloc(4); data.writeUInt32LE(value); return data }
  const root = directory([
    ascii(271, 'NIKON CORPORATION'), ascii(272, 'NIKON Zf'),
    ascii(305, 'Metadata fixture editor'), ascii(315, 'Yingqian test photographer'),
    ascii(33432, 'Copyright Yingqian 2026'), [34665, 4, 1, long(0)], [34853, 4, 1, long(0)]
  ])
  const comment = Buffer.from('ASCII\0\0\0Complete user comment')
  const maker = Buffer.from([0x4e, 0x69, 0x6b, 0x6f, 0x6e, 0x00, 0xfe, 0xff])
  const exif = directory([
    ascii(36867, '2026:10:15 12:34:56'), [37500, 7, maker.length, maker], [37510, 7, comment.length, comment]
  ])
  const rational = values => { const data = Buffer.alloc(values.length * 8); values.forEach((value, index) => { data.writeUInt32LE(value, index * 8); data.writeUInt32LE(1, index * 8 + 4) }); return data }
  const gps = directory([[1, 2, 2, Buffer.from('N\0')], [2, 5, 3, rational([31, 13, 0])], [3, 2, 2, Buffer.from('E\0')], [4, 5, 3, rational([121, 28, 0])]])
  tiff.writeUInt32LE(exif, root + 2 + 5 * 12 + 8)
  tiff.writeUInt32LE(gps, root + 2 + 6 * 12 + 8)
  function segment(marker, payload) {
    const header = Buffer.from([0xff, marker, 0, 0])
    header.writeUInt16BE(payload.length + 2, 2)
    return Buffer.concat([header, payload])
  }
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:description="Full metadata search fixture" dc:title="Yingqian full metadata" /></rdf:RDF></x:xmpmeta>'
  return Buffer.concat([
    image.subarray(0, 2),
    segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), tiff.subarray(0, offset)])),
    segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${xmp}`)),
    image.subarray(2)
  ])
}

export function cameraFixture(image, { make = 'FUJIFILM', model = 'X-T30 III', littleEndian = false, tiffSize = 512, orientation = 6 } = {}) {
  const tiff = Buffer.alloc(tiffSize)
  const uint16 = (value, offset) => littleEndian ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset)
  const uint32 = (value, offset) => littleEndian ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset)
  tiff.write(littleEndian ? 'II' : 'MM')
  uint16(42, 2)
  uint32(8, 4)
  uint16(3, 8)
  let valueOffset = 8 + 2 + 3 * 12 + 4
  for (const [index, tag, text] of [[0, 0x010f, make], [1, 0x0110, model]]) {
    const entry = 10 + index * 12
    const value = Buffer.from(`${text}\0`)
    uint16(tag, entry)
    uint16(2, entry + 2)
    uint32(value.length, entry + 4)
    if (value.length <= 4) value.copy(tiff, entry + 8)
    else { uint32(valueOffset, entry + 8); value.copy(tiff, valueOffset); valueOffset += value.length }
  }
  uint16(0x0112, 34)
  uint16(3, 36)
  uint32(1, 38)
  uint16(orientation, 42)
  const header = Buffer.from([0xff, 0xe1, 0, 0])
  header.writeUInt16BE(tiff.length + 8, 2)
  return Buffer.concat([image.subarray(0, 2), header, Buffer.from('Exif\0\0'), tiff, image.subarray(2)])
}
