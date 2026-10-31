import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createCanvas, Image } from '@napi-rs/canvas'
import { build } from 'esbuild'
import sharp from 'sharp'
import exifr from 'exifr'
import JSZip from 'jszip'
import { metadataFixture, cameraFixture } from './metadata-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = path.join(root, '.ai-docs/miniprogram/tests')
await mkdir(artifacts, { recursive: true })
const localPath = value => /^\/(assets|logos)\//.test(value) ? path.join(root, 'miniprogram', value) : value
const imageSource = Object.getOwnPropertyDescriptor(Image.prototype, 'src')
let serial = 0
let chosen = []
let devicePlatform = 'android'
let pickerCalls = []
const failures = []
const workerBundle = await build({ entryPoints: [path.join(root, 'src/watermark-worker.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', inject: [path.join(root, 'src/binary.ts')], logLevel: 'silent' })
const fsApi = {
  readFile({ filePath, success, fail }) { readFile(localPath(filePath)).then(buffer => success({ data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }), fail) },
  writeFile({ filePath, data, success, fail }) { writeFile(filePath, new Uint8Array(data)).then(() => success({}), fail) }
}
const wx = {
  env: { USER_DATA_PATH: artifacts },
  createWorker() {
    let receive, deliver, terminated = false
    runInNewContext(workerBundle.outputFiles[0].text, {
      worker: { onMessage(callback) { receive = callback }, postMessage(message) { if (!terminated) deliver(message) } },
      Uint8ClampedArray, Uint8Array, ArrayBuffer, DataView
    })
    return {
      onMessage(callback) { deliver = callback },
      postMessage(message) { setTimeout(() => { if (!terminated) receive(message) }, 1) },
      terminate() { terminated = true }
    }
  },
  createOffscreenCanvas({ width, height }) {
    const canvas = createCanvas(width, height)
    canvas.createImage = () => {
      const image = new Image()
      Object.defineProperty(image, 'src', { set(value) { imageSource.set.call(image, localPath(value)) } })
      return image
    }
    return canvas
  },
  getFileSystemManager: () => fsApi,
  canvasToTempFilePath({ canvas, fileType, quality, success, fail }) {
    const tempFilePath = path.join(artifacts, `render-${++serial}.${fileType}`)
    canvas.encode(fileType === 'jpg' ? 'jpeg' : 'png', fileType === 'jpg' ? Math.round(quality * 100) : undefined).then(bytes => writeFile(tempFilePath, bytes)).then(() => success({ tempFilePath }), fail)
  },
  chooseMedia({ success }) { success({ tempFiles: chosen }) },
  getDeviceInfo() { return { platform: devicePlatform } },
  chooseImage(options) { pickerCalls.push({ api: 'chooseImage', options }); options.success({ tempFiles: chosen }) },
  chooseMessageFile(options) { pickerCalls.push({ api: 'chooseMessageFile', options }); options.success({ tempFiles: chosen }) },
  getImageInfo({ src, success, fail }) { sharp(localPath(src)).metadata().then(info => success({ width: info.width, height: info.height }), fail) }
}
const bundled = await build({
  entryPoints: [path.join(root, 'src/core.ts')], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2019',
  inject: [path.join(root, 'src/binary.ts')], alias: { '~': path.join(root, 'src/shared') }, logLevel: 'silent',
  define: { global: 'globalThis' }
})
const module = { exports: {} }
runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, wx, setTimeout, clearTimeout, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView, console: { log() {}, warn() {}, error(...args) { failures.push(args) } } })
const core = module.exports
const target = createCanvas(1, 1)
const sample = path.join(root, 'miniprogram/assets/sample.jpg')
const originalHash = createHash('sha256').update(await readFile(sample)).digest('hex')

test('UTF-8 limits and mobile image dimensions are enforced', () => {
  assert.equal(core.markerBytes('摄影'), 6)
  assert.equal(core.markerBytes(String.fromCodePoint(0x1f4f7)), 4)
  assert.equal(core.markerBytes('\ud800'), 3)
  assert.throws(() => core.validateConfig({ hiddenWatermarkEnabled: true, hiddenWatermarkText: '中'.repeat(22) }))
  assert.throws(() => core.validateConfig({ hiddenWatermarkEnabled: true, hiddenWatermarkText: '  ' }))
  const size = core.fitDimensions(6000, 4000, 2560)
  assert.ok(size.width <= 2560 && size.width * size.height <= 4001000)
  assert.equal(core.fitDimensions(400, 300, 2048).width, 400)
  assert.throws(() => core.fitDimensions(0, 300, 2048))
})

test('all eleven templates render landscape, portrait and square images', async t => {
  assert.equal(core.templates.length, 11)
  const portrait = path.join(artifacts, 'portrait.jpg')
  const square = path.join(artifacts, 'square.jpg')
  await sharp(sample).resize(600, 900, { fit: 'cover' }).toFile(portrait)
  await sharp(sample).resize(640, 640, { fit: 'cover' }).toFile(square)
  for (const item of core.templates) {
    await t.test(item.id, async () => {
      for (const input of [sample, portrait, square]) {
        const photo = { ...core.createDemo(1, item.id), path: input }
        const result = await core.exportPhoto(photo, target, { maxSide: 1280, preserveExif: false })
        const metadata = await sharp(result.path).metadata()
        assert.equal(metadata.width, result.width)
        assert.equal(metadata.height, result.height)
        assert.ok(result.width <= 1280 && result.height <= 1280)
        assert.ok(result.width > 100 && result.height > 100)
        const statistics = await sharp(result.path).stats()
        assert.ok(statistics.channels[0].stdev > 15, `${item.id} must contain image content`)
      }
    })
  }
  assert.deepEqual(failures, [])
  assert.equal(createHash('sha256').update(await readFile(sample)).digest('hex'), originalHash)
})

test('JPEG and PNG exports preserve original EXIF and filter private metadata', async () => {
  const input = path.join(artifacts, 'source-exif.jpg')
  const original = metadataFixture(await readFile(sample))
  await writeFile(input, original)
  for (const format of ['jpg', 'png']) {
    for (const photographyOnly of [false, true]) {
      const photo = { ...core.createDemo(3), isDemo: false, path: input, overrides: { Model: 'DISPLAY ONLY' } }
      const result = await core.exportPhoto(photo, target, { format, preserveExif: true, photographyOnly, maxSide: 1280 })
      const bytes = await readFile(result.path)
      const exif = await exifr.parse(bytes)
      assert.equal(exif.Model, 'NIKON Zf')
      assert.equal(exif.DateTimeOriginal.getFullYear(), 2026)
      assert.equal(exif.Artist, photographyOnly ? undefined : 'Yingqian test photographer')
      assert.equal(typeof exif.latitude, photographyOnly ? 'undefined' : 'number')
      assert.equal((await sharp(bytes).metadata()).width, result.width)
      if (format === 'png') {
        let count = 0
        for (let i = 8; i + 12 <= bytes.length; i += bytes.readUInt32BE(i) + 12) if (bytes.toString('ascii', i + 4, i + 8) === 'eXIf') count++
        assert.equal(count, 1)
      }
    }
  }
  assert.deepEqual(await readFile(input), original)
})

test('hidden watermark survives exported PNG and detects the shared project marker', async () => {
  const photo = core.createDemo(4, 'standard1')
  photo.config.hiddenWatermarkEnabled = true
  photo.config.hiddenWatermarkText = '映签 样片 42'
  const result = await core.exportPhoto(photo, target, { format: 'png', maxSide: 1280, preserveExif: false })
  assert.equal(result.format, 'png')
  const detection = await core.detectPhoto(result.path)
  assert.equal(detection.marker, photo.config.hiddenWatermarkText)
  assert.equal(detection.version, 3)
})

test('PNG signature is cropped, persisted and rendered at a custom position', async () => {
  const signaturePath = path.join(artifacts, 'signature-input.png')
  const signature = createCanvas(300, 120)
  const ctx = signature.getContext('2d')
  ctx.fillStyle = '#f00000'
  ctx.fillRect(60, 30, 180, 60)
  await writeFile(signaturePath, await signature.encode('png'))
  chosen = [{ tempFilePath: signaturePath, size: (await readFile(signaturePath)).length }]
  const imported = await core.importSignature(target)
  assert.equal(imported.aspectRatio, 3)
  const metadata = await sharp(imported.dataUrl).metadata()
  assert.equal(metadata.width, 180)
  assert.equal(metadata.height, 60)
  const originalSignature = await readFile(imported.dataUrl)
  const importedAgain = await core.importSignature(target)
  assert.notEqual(importedAgain.dataUrl, imported.dataUrl)
  assert.deepEqual(await readFile(imported.dataUrl), originalSignature)
  const photo = core.createDemo(6, 'noProcess')
  photo.config.signature = { ...imported, position: 'custom', x: 0, y: 0, width: .3, mask: 'original' }
  const result = await core.exportPhoto(photo, target, { format: 'png', preserveExif: false })
  const { data } = await sharp(result.path).raw().toBuffer({ resolveWithObject: true })
  assert.ok(data[0] > 220 && data[1] < 20 && data[2] < 20)
})

test('invalid files do not poison the serialized rendering queue', async () => {
  await assert.rejects(core.exportPhoto({ ...core.createDemo(5), path: path.join(artifacts, 'missing.jpg') }, target))
  const valid = await core.previewPhoto(core.createDemo(6), target)
  assert.ok(valid.width > 0 && valid.path)
  chosen = [{ tempFilePath: sample, size: 1000 }, { tempFilePath: path.join(artifacts, 'missing.jpg'), size: 10 }]
  const imported = await core.importPhotos()
  assert.equal(imported.photos.length, 1)
  assert.equal(imported.failures.length, 1)
})

test('Android original-photo imports recognize Nikon and large big-endian Fujifilm EXIF before manual edits', async () => {
  const image = await readFile(sample)
  for (const [name, bytes, make, model] of [
    ['nikon-import.jpg', metadataFixture(image), 'NIKON', 'NIKON Zf'],
    ['fujifilm-import.jpg', cameraFixture(image, { tiffSize: 65466 }), 'FUJIFILM', 'X-T30 III']
  ]) {
    const file = path.join(artifacts, name)
    await writeFile(file, bytes)
    pickerCalls = []
    chosen = [{ path: file, size: bytes.length }]
    const result = await core.importPhotos()
    assert.equal(result.failures.length, 0)
    assert.equal(result.photos.length, 1)
    assert.equal(result.photos[0].exif.Make, make)
    assert.equal(result.photos[0].exif.Model, model)
    assert.equal(core.brandGroups(result.photos)[0].brand, make)
    assert.equal(pickerCalls[0].api, 'chooseImage')
    assert.deepEqual(Array.from(pickerCalls[0].options.sizeType), ['original'])
    const rows = await core.readPhotoMetadata(result.photos[0])
    assert.ok(rows.some(row => row.key === 'ifd0.Model' && row.value === model))
    assert.deepEqual(await readFile(file), bytes)
  }
})

test('original photo picking supports path-only results, cancellation and unavailable API fallback', async () => {
  const previous = { chooseImage: wx.chooseImage, chooseMedia: wx.chooseMedia }
  let fallbackCalls = 0
  try {
    wx.chooseMedia = options => { fallbackCalls++; options.success({ tempFiles: [{ tempFilePath: sample }] }) }
    wx.chooseImage = options => options.success({ tempFilePaths: [sample] })
    assert.equal((await core.pickImages('album', 9, true))[0].tempFilePath, sample)
    assert.equal(fallbackCalls, 0)
    wx.chooseImage = options => options.fail({ errMsg: 'chooseImage:fail cancel' })
    await assert.rejects(core.pickImages('album', 9, true))
    assert.equal(fallbackCalls, 0)
    wx.chooseImage = options => options.fail({ errMsg: 'chooseImage:fail not supported' })
    assert.equal((await core.pickImages('album', 9, true))[0].tempFilePath, sample)
    assert.equal(fallbackCalls, 1)
    devicePlatform = 'ios'
    await core.pickImages('album', 9, true)
    assert.equal(fallbackCalls, 2)
    devicePlatform = 'android'
    await core.pickImages('album', 1)
    assert.equal(fallbackCalls, 3)
  } finally { Object.assign(wx, previous); devicePlatform = 'android' }
})

test('chat photograph picking includes JPEG documents and keeps their original camera data', async () => {
  const file = path.join(artifacts, 'camera-document.jpg')
  await writeFile(file, cameraFixture(await readFile(sample)))
  chosen = [{ path: file, name: 'camera-original.JPG' }]
  pickerCalls = []
  const result = await core.importPhotos(undefined, 9, 'message')
  assert.equal(pickerCalls[0].options.type, 'all')
  assert.equal(result.photos[0].name, 'camera-original.JPG')
  assert.equal(result.photos[0].exif.Make, 'FUJIFILM')
  assert.equal(result.photos[0].exif.Model, 'X-T30 III')
})

test('camera import recovers missing XMP fields without overwriting valid TIFF camera tags', async () => {
  const payload = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="FUJIFILM" tiff:Model="X-T30 III" /></rdf:RDF></x:xmpmeta>')
  const header = Buffer.from([0xff, 0xe1, 0, 0])
  header.writeUInt16BE(payload.length + 2, 2)
  const original = await readFile(sample)
  const xmp = Buffer.concat([original.subarray(0, 2), header, payload, original.subarray(2)])
  for (const [name, bytes, make] of [
    ['xmp-camera.jpg', xmp, 'FUJIFILM'],
    ['mixed-camera.jpg', cameraFixture(xmp, { make: 'NIKON CORPORATION', model: '' }), 'NIKON']
  ]) {
    const file = path.join(artifacts, name)
    await writeFile(file, bytes)
    chosen = [{ path: file }]
    const { photos } = await core.importPhotos()
    assert.equal(photos[0].exif.Make, make)
    assert.equal(photos[0].exif.Model, 'X-T30 III')
    assert.equal(photos[0].metadataWarning, '')
  }
})

test('missing camera metadata remains visible and file properties are not counted as embedded tags', async () => {
  chosen = [{ tempFilePath: sample }]
  const { photos } = await core.importPhotos()
  const photo = photos[0]
  assert.match(photo.metadataWarning, /未读到相机品牌、型号/)
  assert.match(photo.metadataWarning, /JPG 原文件/)
  const { page } = await pageHarness()
  Object.assign(page.currentPhoto(), photo)
  page.refreshPhoto()
  assert.equal(page.data.metadataWarning, photo.metadataWarning)
  page.onUnload()
  let metadataPage
  runInNewContext(await readFile(path.join(root, 'miniprogram/pages/metadata/index.js'), 'utf8'), { Page(value) { metadataPage = value }, require: () => core })
  metadataPage.setData = patch => Object.assign(metadataPage.data, structuredClone(patch))
  metadataPage.photo = photo
  await metadataPage.load()
  assert.equal(metadataPage.data.embeddedCount, 0)
  assert.equal(metadataPage.data.fileInfoCount, 5)
  assert.equal(metadataPage.data.metadataWarning, photo.metadataWarning)
})

test('lens metadata never substitutes for a missing camera brand or model', async () => {
  const image = await readFile(sample)
  const payload = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:LensMake="VILTROX" exif:LensModel="AF 56/1.7 XF" /></rdf:RDF></x:xmpmeta>')
  const header = Buffer.from([0xff, 0xe1, 0, 0])
  header.writeUInt16BE(payload.length + 2, 2)
  const bytes = cameraFixture(Buffer.concat([image.subarray(0, 2), header, payload, image.subarray(2)]), { make: '', model: '' })
  const file = path.join(artifacts, 'lens-only-metadata.jpg')
  await writeFile(file, bytes)
  chosen = [{ tempFilePath: file }]
  const photo = (await core.importPhotos()).photos[0]
  assert.equal(photo.exif.LensMake, 'VILTROX')
  assert.equal(photo.exif.LensModel, 'AF 56/1.7 XF')
  assert.ok(!photo.exif.Make && !photo.exif.Model)
  assert.equal(core.brandGroups([photo])[0].brand, '')
  assert.match(photo.metadataWarning, /未读到相机品牌、型号/)
})

test('camera presets fill missing device details and select the matching logo without changing source EXIF', () => {
  const photo = core.createDemo(201)
  photo.exif = { LensMake: 'VILTROX', LensModel: 'AF 56/1.7 XF' }
  photo.overrides = { ISO: 'ISO 800' }
  assert.equal(core.deviceSelectionState(photo).needsDeviceSelection, true)
  assert.equal(core.selectPhotoDevice(photo, 'fujifilm', 'X-T30 III'), true)
  assert.equal(core.photoExif(photo).Make, 'FUJIFILM')
  assert.equal(core.photoExif(photo).Model, 'X-T30 III')
  assert.equal(core.photoExif(photo).LensModel, 'AF 56/1.7 XF')
  assert.equal(core.photoExif(photo).ISO, 'ISO 800')
  assert.equal(photo.exif.Make, undefined)
  assert.equal(photo.exif.Model, undefined)
  assert.equal(core.brandGroups([photo])[0].path, '/logos/fujifilm.png')
  assert.equal(core.deviceSelectionState(photo).needsDeviceSelection, false)
  assert.equal(core.selectPhotoDevice(photo, 'nikon', 'not a real model'), false)
  assert.equal(core.photoExif(photo).Make, 'FUJIFILM')
})

test('only Apple phones offer model presets and other phones suppress stale camera models', () => {
  for (const brand of core.DEVICE_CATALOG.filter(brand => brand.kind === 'phone')) {
    const photo = core.createDemo(202)
    if (brand.id === 'apple') {
      assert.ok(brand.models.includes('iPhone 17 Pro'))
      assert.equal(core.selectPhotoDevice(photo, brand.id, 'iPhone 17 Pro'), true)
      assert.equal(core.photoExif(photo).Model, 'iPhone 17 Pro')
      assert.equal(core.deviceSelectionState(photo).deviceModelHidden, false)
    } else {
      assert.equal(brand.models.length, 0)
      assert.equal(core.selectPhotoDevice(photo, brand.id, 'OLD DEVICE MODEL'), true)
      assert.equal(core.photoExif(photo).Make, brand.make)
      assert.equal(core.photoExif(photo).Model, '')
      assert.equal(core.deviceSelectionState(photo).deviceModelHidden, true)
    }
    assert.equal(core.deviceSelectionState(photo).needsDeviceSelection, false)
    assert.equal(photo.exif.Model, 'NIKON Z 6_2')
  }
})

test('camera choices retain original unlisted models and remain specific to each photo when applying styles', () => {
  const photo = core.createDemo(203)
  photo.exif.Model = 'NIKON SPECIAL MODEL'
  const draft = core.devicePickerDraft(photo)
  assert.equal(draft.deviceBrandId, 'nikon')
  assert.ok(draft.deviceModelOptions.some(model => model.value === 'NIKON SPECIAL MODEL'))
  assert.equal(core.selectPhotoDevice(photo, 'nikon', 'NIKON SPECIAL MODEL'), true)
  const other = core.createDemo(204)
  core.selectPhotoDevice(other, 'vivo')
  core.applyPhotoStyle([photo, other], photo, [203, 204])
  assert.equal(core.photoExif(other).Make, 'vivo')
  assert.equal(core.photoExif(other).Model, '')
  assert.equal(core.photoExif(photo).Model, 'NIKON SPECIAL MODEL')
  core.selectPhotoDevice(photo, 'canon', '', true)
  assert.equal(core.photoExif(photo).Make, 'Canon')
  assert.equal(core.photoExif(photo).Model, '')
  assert.equal(core.deviceSelectionState(photo).needsDeviceSelection, false)
})

test('preset camera details reach the rendered watermark and invalidate its previous layout measurement', async () => {
  const photo = core.createDemo(205)
  photo.exif = {}
  const before = await core.previewPhoto(photo, target)
  const originalBytes = await readFile(before.path)
  core.selectPhotoDevice(photo, 'fujifilm', 'X-T30 III')
  const after = await core.previewPhoto(photo, target)
  assert.notEqual(before.renderMetrics.key, after.renderMetrics.key)
  assert.notDeepEqual(await readFile(after.path), originalBytes)
  assert.equal(core.photoBrand(photo), 'FUJIFILM')
})

test('the device picker applies camera choices atomically and keeps cancelled drafts out of photo parameters', async () => {
  const { page } = await pageHarness()
  const source = page.currentPhoto().exif.Model
  page.openDevicePicker()
  page.chooseDeviceBrand({ currentTarget: { dataset: { id: 'fujifilm' } }, detail: {} })
  assert.equal(page.data.deviceBrandId, 'fujifilm')
  assert.equal(page.data.fields.find(field => field.key === 'Make').value, 'NIKON')
  page.closeDevicePicker()
  assert.equal(page.currentPhoto().cameraSelection, undefined)
  page.openDevicePicker()
  page.chooseDeviceBrand({ currentTarget: { dataset: { id: 'fujifilm' } }, detail: {} })
  page.chooseDeviceModel({ currentTarget: { dataset: { model: 'X-T30 III' } }, detail: {} })
  assert.equal(page.data.devicePickerOpen, false)
  assert.equal(page.data.fields.find(field => field.key === 'Make').value, 'FUJIFILM')
  assert.equal(page.data.fields.find(field => field.key === 'Model').value, 'X-T30 III')
  assert.equal(page.currentPhoto().exif.Model, source)
  page.selectPhoto({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.fields.find(field => field.key === 'Make').value, 'NIKON')
  page.selectPhoto({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.fields.find(field => field.key === 'Model').value, 'X-T30 III')
  page.onUnload()
})

test('phone presets hide non-Apple model controls and restoring read values clears selected devices', async () => {
  const { page } = await pageHarness()
  page.openDevicePicker()
  page.chooseDeviceBrand({ currentTarget: { dataset: { id: 'vivo' } }, detail: {} })
  assert.equal(page.data.devicePickerOpen, false)
  assert.equal(page.data.fields.find(field => field.key === 'Make').value, 'vivo')
  assert.equal(page.data.fields.some(field => field.key === 'Model'), false)
  assert.equal(page.data.needsDeviceSelection, false)
  page.openDevicePicker()
  page.chooseDeviceBrand({ currentTarget: { dataset: { id: 'apple' } }, detail: {} })
  assert.equal(page.data.devicePickerOpen, true)
  page.chooseDeviceModel({ currentTarget: { dataset: { model: 'iPhone 17 Pro' } }, detail: {} })
  assert.equal(page.data.fields.find(field => field.key === 'Model').value, 'iPhone 17 Pro')
  page.resetExif()
  assert.equal(page.currentPhoto().cameraSelection, undefined)
  assert.equal(page.data.fields.find(field => field.key === 'Model').value, 'NIKON Z 6_2')
  page.onUnload()
})

test('unrecognized devices can use a known brand without requiring a typed model', async () => {
  const { page } = await pageHarness()
  page.currentPhoto().exif = {}
  page.refreshPhoto()
  assert.equal(page.data.needsDeviceSelection, true)
  page.openDevicePicker()
  page.chooseDeviceBrand({ currentTarget: { dataset: { id: 'canon' } }, detail: {} })
  page.useDeviceBrandOnly()
  assert.equal(page.data.needsDeviceSelection, false)
  assert.equal(page.data.fields.find(field => field.key === 'Make').value, 'Canon')
  assert.equal(page.data.fields.find(field => field.key === 'Model').value, '')
  page.openDevicePicker()
  page.selectPhoto({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.devicePickerOpen, false)
  page.onUnload()
})

test('imported metadata survives later changes to temporary JPEGs and export snapshots', async () => {
  const pixels = await readFile(sample)
  for (const [make, model] of [['NIKON', 'NIKON Zf'], ['FUJIFILM', 'X-T30 III']]) {
    const file = path.join(artifacts, `temporary-${make}.jpg`)
    const original = cameraFixture(pixels, { make, model, tiffSize: 65466 })
    await writeFile(file, original)
    chosen = [{ tempFilePath: file }]
    const photo = (await core.importPhotos()).photos[0]
    await writeFile(file, pixels)
    assert.equal((await exifr.parse(await readFile(file)))?.Model, undefined)
    const snapshot = core.clonePhoto(core.withBrandLogos(photo))
    const rows = await core.readPhotoMetadata(snapshot)
    assert.ok(rows.some(row => row.key === 'ifd0.Model' && row.value === model))
    assert.ok(rows.some(row => row.key === 'File.Size' && row.value === `${original.length} bytes`))
    for (const format of ['jpg', 'png']) {
      const result = await core.exportPhoto(snapshot, target, { format, maxSide: 1280, preserveExif: true })
      const exported = await exifr.parse(await readFile(result.path))
      assert.equal(exported.Make, make)
      assert.equal(exported.Model, model)
    }
    const { page } = await pageHarness()
    page.photos[0] = { ...photo, id: 1 }
    page.refreshPhoto()
    await page.exportFile({ currentTarget: { dataset: {} } })
    assert.equal(page.data.error, '')
    const exported = await exifr.parse(await readFile(page.data.lastFileExport.path))
    assert.equal(exported.Make, make)
    assert.equal(exported.Model, model)
    page.onUnload()
  }
})

function pageHarness(overrides = {}) {
  let page
  const app = { globalData: { photos: [core.createDemo(1), core.createDemo(2)], nextPhotoId: 3 } }
  const platform = { ...wx, showToast() {}, setStorageSync() {}, navigateBack() {}, redirectTo() {} }
  const implementation = { ...core, api: async () => ({ confirm: true }), ...overrides }
  return readFile(path.join(root, 'miniprogram/pages/editor/index.js'), 'utf8').then(source => {
    runInNewContext(source, { Page(value) { page = value }, getApp: () => app, wx: platform, require: name => name === '../../brand' ? { STORAGE: { preferences: 'yingqian-preferences-v1', signature: 'yingqian-signature-v1' } } : implementation, setTimeout, clearTimeout })
    page.data = structuredClone(page.data)
    page.setData = patch => Object.assign(page.data, structuredClone(patch))
    page.onLoad()
    page.canvas = target
    return { page, app }
  })
}

const colorModule = { exports: {} }
runInNewContext(await readFile(path.join(root, 'miniprogram/components/color-picker/color.js'), 'utf8'), { module: colorModule })
const { parseColor, formatColor } = colorModule.exports
async function colorPickerHarness(value = '#242424', allowAlpha = false) {
  let definition
  runInNewContext(await readFile(path.join(root, 'miniprogram/components/color-picker/index.js'), 'utf8'), { Component(value) { definition = value }, require: () => colorModule.exports })
  const changes = []
  const component = {
    ...definition.methods, data: structuredClone(definition.data), properties: { value, allowAlpha, disabled: false },
    setData(patch) { Object.assign(this.data, structuredClone(patch)) },
    triggerEvent(name, detail) { changes.push({ name, ...detail }) }
  }
  definition.lifetimes.attached.call(component)
  return { component, changes, synchronize(next) { component.properties.value = next; definition.observers['value, allowAlpha'].call(component, next) } }
}

test('RGB color parsing covers template defaults, HEX, percentages and transparent colors', () => {
  for (const template of core.templates) {
    for (const control of core.templateControls(template.id, core.defaults(template.id)).filter(control => control.type === 'color')) assert.ok(parseColor(control.value), `${template.id}: ${control.key}`)
  }
  for (const [value, expected] of [['#abc', '#AABBCC'], ['rgb(50%, 0%, 100%)', '#8000FF'], ['rgb(12 34 56 / 25%)', 'rgba(12, 34, 56, 0.25)'], ['rgba(30, 40, 50, 0)', 'rgba(30, 40, 50, 0)'], ['black', '#000000'], ['transparent', 'rgba(0, 0, 0, 0)'], ['#1234', 'rgba(17, 34, 51, 0.267)'], ['#12345680', 'rgba(18, 52, 86, 0.502)']]) assert.equal(formatColor(parseColor(value)), expected)
  for (const value of ['', '#12', '#GGGGGG', 'rgb(1, two, 3)', 'rgba(1, 2)', 'rgb(NaN, 0, 0)']) assert.equal(parseColor(value), null)
})

test('RGB picker previews channel drags and commits without losing shadow opacity', async () => {
  const { component, changes, synchronize } = await colorPickerHarness('rgba(0,0,0,0.15)', true)
  const channel = (key, value) => ({ currentTarget: { dataset: { channel: key } }, detail: { value } })
  component.toggle()
  component.previewChannel(channel('r', 128))
  assert.equal(component.data.preview, 'rgba(128, 0, 0, 0.15)')
  assert.equal(changes.length, 0)
  component.changeChannel(channel('r', 128))
  assert.deepEqual(changes, [{ name: 'change', value: 'rgba(128, 0, 0, 0.15)' }])
  synchronize(changes[0].value)
  assert.equal(component.data.expanded, true)
  component.changeChannel(channel('a', 0))
  assert.equal(changes.at(-1).value, 'rgba(128, 0, 0, 0)')
  component.selectSwatch({ currentTarget: { dataset: { color: '#FFFFFF' } } })
  assert.equal(changes.at(-1).value, 'rgba(255, 255, 255, 0)')
  synchronize('#242424')
  assert.equal(component.data.preview, '#242424')
  assert.equal(component.data.opacity, 100)
  assert.equal(component.data.channels[0].value, 36)
  assert.equal(component.data.showAlpha, true)
})

test('RGB picker rejects invalid edits, clamps channels and honors disabled state', async () => {
  const { component, changes } = await colorPickerHarness()
  component.commitInput({ detail: { value: 'not a color' } })
  assert.ok(component.data.error)
  assert.equal(component.data.preview, '#242424')
  assert.equal(changes.length, 0)
  component.commitInput({ detail: { value: 'rgb(256, -10, 12)' } })
  assert.equal(changes.at(-1).value, '#FF000C')
  assert.equal(component.data.error, '')
  component.changeChannel({ currentTarget: { dataset: { channel: 'g' } }, detail: { value: '' } })
  assert.equal(changes.length, 1)
  component.properties.disabled = true
  component.toggle()
  component.commitInput({ detail: { value: '#FFFFFF' } })
  component.changeChannel({ currentTarget: { dataset: { channel: 'a' } }, detail: { value: 50 } })
  component.selectSwatch({ currentTarget: { dataset: { color: '#FFFFFF' } } })
  assert.equal(component.data.expanded, false)
  assert.equal(changes.length, 1)
})

test('picker colors reach photo styles, reset to defaults and apply without overwriting EXIF', async () => {
  const { page } = await pageHarness()
  page.selectTemplate({ currentTarget: { dataset: { id: 'blurBackground' } } })
  const { component, changes } = await colorPickerHarness(page.data.config.shadowColor, true)
  component.changeChannel({ currentTarget: { dataset: { channel: 'b' } }, detail: { value: 120 } })
  page.changeConfig({ currentTarget: { dataset: { key: 'shadowColor' } }, detail: { value: changes.at(-1).value } })
  page.photos[1].overrides.Model = 'KEEP ORIGINAL OVERRIDE'
  await page.applyToAll()
  assert.equal(page.photos[1].config.shadowColor, page.currentPhoto().config.shadowColor)
  assert.equal(page.photos[1].overrides.Model, 'KEEP ORIGINAL OVERRIDE')
  assert.equal(parseColor(page.data.config.shadowColor).b, 120)
  page.resetConfigField({ currentTarget: { dataset: { key: 'shadowColor' } } })
  assert.equal(page.data.config.shadowColor, core.defaults('blurBackground').shadowColor)
  page.onUnload()
})

test('apply to all copies styles while retaining per-photo EXIF overrides', async () => {
  const { page, app } = await pageHarness()
  app.globalData.photos[0].overrides.Model = 'FIRST'
  app.globalData.photos[1].overrides.Model = 'SECOND'
  app.globalData.photos[0].config.textColor = '#123456'
  await page.applyToAll()
  assert.equal(app.globalData.photos[1].config.textColor, '#123456')
  assert.equal(app.globalData.photos[1].overrides.Model, 'SECOND')
  assert.notEqual(app.globalData.photos[0].config, app.globalData.photos[1].config)
  page.onUnload()
})

test('batch save reports partial failure and allows a later retry', async () => {
  let attempts = 0
  const { page } = await pageHarness({
    exportPhoto: async () => ({ path: sample, width: 1080, height: 720 }),
    api: async () => { if (++attempts === 2) throw { errMsg: 'saveImageToPhotosAlbum:fail auth deny' }; return {} }
  })
  await page.savePhotos({ currentTarget: { dataset: { all: true } } })
  assert.equal(page.data.savedCount, 1)
  assert.equal(page.data.needsPermission, true)
  assert.equal(page.data.exporting, false)
  await page.savePhotos({ currentTarget: { dataset: {} } })
  assert.equal(page.data.savedCount, 1)
  assert.equal(page.data.error, '')
  page.onUnload()
})

test('cancel stops a batch between photos without discarding completed exports', async () => {
  let calls = 0
  let currentPage
  const { page } = await pageHarness({
    exportPhoto: async () => ({ path: sample }),
    api: async () => { calls++; currentPage.cancelExport(); return {} }
  })
  currentPage = page
  await page.savePhotos({ currentTarget: { dataset: { all: true } } })
  assert.equal(calls, 1)
  assert.equal(page.data.savedCount, 1)
  assert.match(page.data.notice, /1/)
  page.onUnload()
})

test('template controls expose web parameters with their original bounds and defaults', () => {
  const controls = core.templates.flatMap(item => core.templateControls(item.id, core.defaults(item.id)))
  for (const key of ['secondaryTextColor', 'padding', 'showBorder', 'borderColor', 'shadowColor', 'shadowRadius', 'textMargin']) assert.ok(controls.some(item => item.key === key), key)
  for (const [key, min, max, step, scale] of [['padding', 0, 80, 1, 1000], ['imageMargin', 40, 220, 1, 1000], ['watermarkScale', 80, 100, 1, 100], ['blurRadius', 0, 120, 1, 1000], ['textOpacity', 0, 100, 1, 100]]) {
    const field = controls.find(item => item.key === key)
    assert.deepEqual([field.min, field.max, field.step, field.scale], [min, max, step, scale])
  }
  assert.equal(core.templateControls('noProcess', core.defaults('noProcess')).length, 0)
  assert.equal(core.defaults('personalText').personalText, core.template('personalText').userOptions.personalText.text)
})

test('signature resizing activates free positioning and supports invisible or full-width signatures', async () => {
  const { page } = await pageHarness()
  page.currentPhoto().config.signature = { ...core.DEFAULT_SIGNATURE, dataUrl: 'local-signature.png' }
  page.refreshPhoto()
  const event = (key, value) => ({ currentTarget: { dataset: { key, scale: 100 } }, detail: { value } })
  page.changeSignature(event('width', 100))
  assert.equal(page.currentPhoto().config.signature.position, 'custom')
  assert.equal(page.currentPhoto().config.signature.width, 1)
  page.changeSignature(event('opacity', 0))
  assert.equal(page.currentPhoto().config.signature.opacity, 0)
  page.changeSignature(event('width', 25))
  Object.assign(page.currentPhoto().config.signature, { x: 0.1, y: 0.1 })
  page.refreshPhoto()
  page.data.rendering = false
  page.previewRect = { width: 300, height: 200 }
  page.startSignatureGesture({ currentTarget: { dataset: { mode: 'move' } }, touches: [{ clientX: 20, clientY: 20 }] })
  page.moveSignatureGesture({ touches: [{ clientX: 800, clientY: 800 }] })
  page.finishSignatureGesture()
  const box = core.signatureBounds(page.currentPhoto().config.signature, 300, 200)
  assert.deepEqual([box.x, box.y, box.width, box.height], [225, 175, 75, 25])
  page.resetSignatureLayout()
  assert.equal(page.currentPhoto().config.signature.width, core.DEFAULT_SIGNATURE.width)
  page.removeSignature()
  assert.equal(page.currentPhoto().config.signature, undefined)
  page.onUnload()
})

test('template resets preserve signature while saved date patterns survive export setting changes', async () => {
  const { page, app } = await pageHarness()
  const signature = { ...core.DEFAULT_SIGNATURE, dataUrl: 'signature.png' }
  page.currentPhoto().config.signature = signature
  page.currentPhoto().config.customDateTimeFormat = 'YYYY年MM月DD日'
  page.saveDateFormat()
  page.changeSetting({ currentTarget: { dataset: { key: 'format' } }, detail: { value: 1 } })
  assert.deepEqual(Array.from(app.globalData.preferences.dateFormats), ['YYYY年MM月DD日'])
  page.currentPhoto().config.textColor = '#ff0000'
  page.resetTemplate()
  assert.equal(page.currentPhoto().config.signature, signature)
  assert.equal(page.currentPhoto().config.textColor, core.defaults(page.currentPhoto().templateId).textColor)
  page.onUnload()
})

test('full metadata retains nested private and binary tags without changing photograph overrides', async () => {
  const photo = { ...core.createDemo(90), path: path.join(artifacts, 'full-metadata.jpg'), overrides: { Model: 'DISPLAY ONLY' } }
  await writeFile(photo.path, metadataFixture(await readFile(sample)))
  const rows = await core.readPhotoMetadata(photo)
  assert.ok(rows.some(row => /Model$/.test(row.key) && row.value === 'NIKON Zf'))
  assert.ok(rows.some(row => /GPSLatitude/.test(row.key)))
  assert.ok(rows.some(row => /MakerNote/.test(row.key) && row.binary && row.value.length > 0))
  assert.equal(photo.overrides.Model, 'DISPLAY ONLY')
  assert.ok(core.metadataPage(rows, 'gps').matching > 0)
  const longValue = 'ab '.repeat(50000)
  const all = [{ key: 'exif.MakerNote', value: longValue, binary: true }]
  const first = core.metadataPage(all)
  const chunks = []
  for (let page = 0; page < first.pages; page++) chunks.push(...core.metadataPage(all, '', page).rows)
  assert.equal(chunks.map(row => row.value).join(''), longValue)
  assert.ok(chunks.every(row => row.value.length <= 4096))
})

test('chat photo imports retain filenames and begin without an applied template', async () => {
  chosen = [{ path: sample, name: 'original-photo.jpg', size: 100000 }]
  const imported = await core.importPhotos(undefined, 9, 'message')
  assert.equal(imported.photos[0].name, 'original-photo.jpg')
  assert.equal(imported.photos[0].templateId, 'noProcess')
  assert.equal(imported.photos[0].path, sample)
})

test('photo selection changes only chosen styles and respects each effective camera brand', () => {
  const photos = [core.createDemo(1), core.createDemo(2), core.createDemo(3)]
  photos[0].config.textColor = '#123456'
  photos[1].overrides = { Make: 'Canon', Model: 'SECOND' }
  photos[2].overrides = { Make: '', Model: 'THIRD' }
  const previous = JSON.stringify(photos[2].config)
  core.applyPhotoStyle(photos, photos[0], [2])
  assert.equal(photos[1].config.textColor, '#123456')
  assert.equal(photos[1].overrides.Model, 'SECOND')
  assert.equal(JSON.stringify(photos[2].config), previous)
  const logos = new Map([['NIKON', '/logos/nikon.png'], ['Canon', '/logos/sony.png'], ['', '/logos/apple.png']])
  assert.equal(core.withBrandLogos(photos[1], logos).config.customLogoUrl, '/logos/sony.png')
  assert.equal(core.withBrandLogos(photos[2], logos).config.customDefaultLogoUrl, '/logos/apple.png')
  logos.delete('Canon')
  assert.equal(core.withBrandLogos(photos[1], logos).config.customLogoUrl, undefined)
  assert.deepEqual(Array.from(core.brandGroups(photos, logos), row => row.count), [1,1,1])
})

test('editing sessions accept additional batches beyond nine photographs', async () => {
  const { page, app } = await pageHarness({ importPhotos: async (templateId, count) => {
    assert.equal(templateId, 'noProcess')
    assert.equal(count, 9)
    return { photos: [core.createDemo(100, templateId)], failures: [] }
  } })
  page.photos.splice(0, page.photos.length, ...Array.from({ length: 9 }, (_, index) => core.createDemo(index + 1)))
  app.globalData.nextPhotoId = 10
  await page.addPhotos()
  assert.equal(page.photos.length, 10)
  assert.equal(page.photos[9].templateId, 'noProcess')
  page.openSelection()
  page.selectTargets({ detail: { value: ['10'] } })
  page.currentPhoto().config.padding = 0.075
  await page.applyToSelected()
  assert.equal(page.photos[9].config.padding, 0.075)
  assert.notEqual(page.photos[1].config.padding, 0.075)
  page.onUnload()
})

test('custom logo import persists an independent local image without changing the source', async () => {
  chosen = [{ tempFilePath: sample }]
  const logo = await core.importLogo(target)
  assert.match(logo, /yingqian-logo-\d+-\d+\.png$/)
  assert.deepEqual([(await sharp(logo).metadata()).width, (await sharp(logo).metadata()).height], [1080, 720])
  assert.equal(createHash('sha256').update(await readFile(sample)).digest('hex'), originalHash)
})

test('original-size export preserves supported originals and explicit smaller choices', async () => {
  const photo = { ...core.createDemo(91, 'noProcess'), path: path.join(artifacts, 'large-original.jpg'), width: 3000, height: 2000 }
  await sharp(sample).resize(3000, 2000).toFile(photo.path)
  const original = await core.exportPhoto(photo, target, { preserveExif: false })
  assert.deepEqual([original.width, original.height], [3000, 2000])
  assert.equal(original.format, 'jpg')
  const reduced = await core.exportPhoto(photo, target, { maxSide: 1280, preserveExif: false })
  assert.equal(reduced.width, 1280)
  assert.equal(original.autoAdjusted, false)
  assert.equal(reduced.autoAdjusted, false)
})

test('file export creates a valid ZIP with distinct duplicate names, matching formats and preserved metadata', async () => {
  const source = path.join(artifacts, 'archive-exif.jpg')
  await writeFile(source, metadataFixture(await readFile(sample)))
  const photos = [1, 2].map(id => ({ ...core.createDemo(id), path: source, name: 'same-name.jpg', isDemo: false }))
  const result = await core.exportFiles(photos, target, { format: 'png', maxSide: 1280, preserveExif: true })
  const zip = await JSZip.loadAsync(await readFile(result.path), { checkCRC32: true })
  assert.deepEqual(Object.keys(zip.files), ['same-name.png', 'same-name (2).png'])
  for (const entry of Object.values(zip.files)) {
    const bytes = await entry.async('nodebuffer')
    assert.equal((await sharp(bytes).metadata()).format, 'png')
    assert.equal((await exifr.parse(bytes)).Model, 'NIKON Zf')
  }
  const single = await core.exportFiles([photos[0]], target, { format: 'jpg', preserveExif: false })
  assert.equal(single.fileName, 'same-name.jpg')
  assert.equal(single.count, 1)
  await assert.rejects(core.exportFiles(photos, target, {}, () => {}, () => true), /停止/)
})

test('batch export skips untouched originals but includes signature-only and watermark-only images', async () => {
  const original = core.createDemo(10, 'noProcess')
  assert.equal(core.isPhotoProcessed(original), false)
  assert.equal(core.isPhotoProcessed({ ...original, config: { ...original.config, signature: { ...core.DEFAULT_SIGNATURE, dataUrl: 'signature.png' } } }), true)
  assert.equal(core.isPhotoProcessed({ ...original, config: { ...original.config, hiddenWatermarkEnabled: true, hiddenWatermarkText: 'owner' } }), true)
  let exports = 0
  const { page } = await pageHarness({ exportPhoto: async () => { exports++; return { path: sample } } })
  page.photos.push(original)
  await page.savePhotos({ currentTarget: { dataset: { all: true } } })
  assert.equal(exports, 2)
  assert.match(page.data.notice, /跳过 1 张/)
  page.onUnload()
})

test('JPEG remains an explicit export choice with hidden-watermark metadata', async () => {
  const photo = core.createDemo(92)
  photo.config.hiddenWatermarkEnabled = true
  photo.config.hiddenWatermarkText = 'jpeg parity'
  const result = await core.exportPhoto(photo, target, { format: 'jpg', preserveExif: false })
  assert.equal(result.format, 'jpg')
  assert.equal((await sharp(result.path).metadata()).format, 'jpeg')
  const detected = await core.detectPhoto(result.path)
  assert.equal(detected.marker, photo.config.hiddenWatermarkText)
})

test('small photographs are not blocked by a mini-program-only hidden-watermark size restriction', async () => {
  const photo = { ...core.createDemo(93, 'noProcess'), path: path.join(artifacts, 'small-hidden.jpg'), width: 300, height: 300 }
  await sharp(sample).resize(300, 300).toFile(photo.path)
  Object.assign(photo.config, { hiddenWatermarkEnabled: true, hiddenWatermarkText: 'small image' })
  const exported = await core.exportPhoto(photo, target, { format: 'png', preserveExif: false })
  assert.deepEqual([exported.width, exported.height], [300, 300])
})

test('clearing a manual EXIF field restores the original value as in the web editor', async () => {
  const { page } = await pageHarness()
  page.changeExif({ currentTarget: { dataset: { key: 'Model' } }, detail: { value: 'edited model' } })
  assert.equal(page.currentPhoto().overrides.Model, 'edited model')
  page.changeExif({ currentTarget: { dataset: { key: 'Model' } }, detail: { value: '  ' } })
  assert.equal(page.currentPhoto().overrides.Model, undefined)
  assert.equal(page.data.fields.find(field => field.key === 'Model').value, page.currentPhoto().exif.Model)
  page.onUnload()
})

test('file generation and native handoff are separate user actions', async () => {
  const calls = []
  const { page } = await pageHarness({ exportFiles: async () => ({ path: sample, fileName: 'photo.jpg', count: 1, lastImage: { path: sample } }), api: async (name, options) => { calls.push({ name, options }); return {} } })
  await page.exportFile({ currentTarget: { dataset: {} } })
  assert.equal(calls.length, 0)
  await page.shareExportFile()
  assert.equal(calls[0].name, 'shareFileMessage')
  assert.equal(calls[0].options.fileName, 'photo.jpg')
  page.onUnload()
})

test('a generated single-file export remains unchanged by later album exports', async () => {
  const source = path.join(artifacts, 'stable-export-exif.jpg')
  await writeFile(source, metadataFixture(await readFile(sample)))
  const photo = { ...core.createDemo(94), path: source, isDemo: false }
  const file = await core.exportFiles([photo], target, { format: 'jpg', preserveExif: true })
  const saved = await readFile(file.path)
  await core.exportPhoto({ ...photo, path: sample, templateId: 'noProcess' }, target, { format: 'jpg', preserveExif: true })
  assert.deepEqual(await readFile(file.path), saved)
  assert.equal((await exifr.parse(saved)).Model, 'NIKON Zf')
})

test('cancelling detection before analysis starts prevents stale results and allows retry', async () => {
  let page
  let calls = 0
  const implementation = { ...core, api: async () => ({ width: 1080, height: 720 }), detectPhoto: async () => { calls++; return { marker: 'retry marker', confidence: 0.9, blockCount: 20 } }, cancelDetection() {} }
  runInNewContext(await readFile(path.join(root, 'miniprogram/pages/detect/index.js'), 'utf8'), { Page(value) { page = value }, require: () => implementation, getApp: () => ({ globalData: {} }), setTimeout })
  page.setData = patch => Object.assign(page.data, patch)
  page.onLoad({})
  const pending = page.runDetection(sample)
  page.cancel()
  await pending
  assert.equal(calls, 0)
  assert.equal(page.data.checked, false)
  await page.retry()
  assert.equal(calls, 1)
  assert.equal(page.data.confidence, '90%')
  assert.equal(page.data.result.marker, 'retry marker')
  page.onUnload()
})

test('removing a selected photo refreshes the batch selection instead of applying to stale entries', async () => {
  const { page } = await pageHarness()
  page.openSelection()
  page.selectTargets({ detail: { value: [String(page.photos[1].id)] } })
  page.selectPhoto({ currentTarget: { dataset: { index: 1 } } })
  await page.removePhoto()
  assert.equal(page.data.selectionPhotos.length, 1)
  assert.equal(page.data.selectedIds.length, 0)
  page.onUnload()
})

test('oversized photos automatically export near the highest supported pixel count and retain their original metadata', async () => {
  const input = path.join(artifacts, 'oversized-6000.jpg')
  const bytes = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: '#708b64' } }).jpeg().toBuffer()
  const original = metadataFixture(bytes)
  await writeFile(input, original)
  const photo = { ...core.createDemo(101, 'noProcess'), path: input, width: 6000, height: 4000, isDemo: false }
  const notices = []
  const result = await core.exportPhoto(photo, target, { preserveExif: true }, message => notices.push(message))
  assert.equal(result.autoAdjusted, true)
  assert.ok(result.width * result.height <= core.MAX_CANVAS_PIXELS)
  assert.ok(result.width * result.height > core.MAX_CANVAS_PIXELS * 0.99)
  assert.ok(result.width > 4096, 'The highest supported export must not be unnecessarily reduced to a preset')
  assert.ok(Math.abs(result.width / result.height - 1.5) < 0.001)
  assert.match(notices[0], /最高分辨率/)
  const metadata = await sharp(result.path).metadata()
  assert.deepEqual([metadata.width, metadata.height], [result.width, result.height])
  assert.equal((await exifr.parse(await readFile(result.path))).Model, 'NIKON Zf')
  assert.deepEqual(await readFile(input), original)
  const smaller = await core.exportPhoto(photo, target, { maxSide: 1280, preserveExif: false })
  assert.equal(smaller.width, 1280)
  assert.equal(smaller.autoAdjusted, false)
})

test('wide panoramas automatically obey the edge limit without asking for a new size', async () => {
  const input = path.join(artifacts, 'wide-9000.jpg')
  await sharp({ create: { width: 9000, height: 1000, channels: 3, background: '#708b64' } }).jpeg().toFile(input)
  const photo = { ...core.createDemo(102, 'noProcess'), path: input, width: 9000, height: 1000 }
  const result = await core.exportPhoto(photo, target, { preserveExif: false })
  assert.equal(result.width, core.MAX_CANVAS_EDGE)
  assert.equal(result.autoAdjusted, true)
  assert.ok(result.height > 900 && result.height < 920)
})

test('template expansion is included in size choices and automatic export limits', async () => {
  const input = path.join(artifacts, 'square-4000.jpg')
  await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#708b64' } }).jpeg().toFile(input)
  const photo = { ...core.createDemo(103, 'standard1'), path: input, width: 4000, height: 4000 }
  const preview = await core.previewPhoto(photo, target)
  photo.renderMetrics = preview.renderMetrics
  const choices = core.exportSizeOptions(photo)
  assert.ok(!choices.sizeLabels.includes('原始尺寸'))
  assert.match(choices.resolutionNotice, /最高分辨率/)
  const result = await core.exportPhoto(photo, target, { preserveExif: false })
  assert.equal(result.autoAdjusted, true)
  assert.ok(result.width * result.height <= core.MAX_CANVAS_PIXELS)
  assert.ok(result.width * result.height > core.MAX_CANVAS_PIXELS * 0.98)
  assert.ok(result.height > 4000, 'The output must not be capped to the smaller source-layer dimensions')
  photo.templateId = 'noProcess'
  photo.config = core.defaults('noProcess')
  assert.equal(core.exportSizeOptions(photo).sizeLabels[0], '原始尺寸')
})

test('the resolution picker hides unsupported originals and maps filtered choices to stable values', async () => {
  assert.match(core.exportSizeOptions({ ...core.createDemo(100, 'noProcess'), width: 3000, height: 2000 }, 1280).exportSizeHint, /1280/)
  const { page } = await pageHarness()
  Object.assign(page.photos[0], { width: 6000, height: 4000, templateId: 'noProcess', config: core.defaults('noProcess') })
  page.refreshPhoto()
  assert.equal(page.data.settings.maxSide, 0)
  assert.ok(!page.data.sizeLabels.includes('原始尺寸'))
  assert.match(page.data.sizeLabels[0], /最高支持尺寸/)
  assert.match(page.data.resolutionNotice, /自动/)
  const index = page.data.sizeValues.indexOf(4096)
  assert.ok(index >= 0)
  page.changeSetting({ currentTarget: { dataset: { key: 'maxSide' } }, detail: { value: index } })
  assert.equal(page.data.settings.maxSide, 4096)
  page.selectPhoto({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.sizeLabels[0], '原始尺寸')
  assert.equal(page.data.settings.maxSide, 4096)
  page.onUnload()
})

test('album and file exports report automatic adaptation without interrupting a mixed batch', async () => {
  const { page } = await pageHarness({
    exportPhoto: async (photo, canvas, settings, notify) => {
      if (photo.id === 1) notify('超限照片将自动以支持的最高分辨率导出。')
      return { path: sample, width: 4898, height: 3265, sourceId: photo.id, autoAdjusted: photo.id === 1 }
    },
    exportFiles: async () => ({ path: sample, fileName: 'photos.zip', count: 2, adjustedCount: 1, lastImage: { path: sample } })
  })
  await page.savePhotos({ currentTarget: { dataset: { all: true } } })
  assert.equal(page.data.savedCount, 2)
  assert.equal(page.data.error, '')
  assert.match(page.data.notice, /1 张超限照片.*最高分辨率/)
  await page.exportFile({ currentTarget: { dataset: { all: true } } })
  assert.equal(page.data.error, '')
  assert.match(page.data.notice, /1 张超限照片.*最高分辨率/)
  page.onUnload()
})

test('all templates automatically fit oversized photos using their rendered layout bounds', async t => {
  const input = path.join(artifacts, 'oversized-template-input.jpg')
  await sharp({ create: { width: 6000, height: 4000, channels: 3, background: '#708b64' } }).jpeg().toFile(input)
  for (const definition of core.templates) await t.test(definition.id, async () => {
    const photo = { ...core.createDemo(110, definition.id), path: input, width: 6000, height: 4000 }
    photo.renderMetrics = (await core.previewPhoto(photo, target)).renderMetrics
    assert.ok(!core.exportSizeOptions(photo).sizeLabels.includes('原始尺寸'))
    const result = await core.exportPhoto(photo, target, { preserveExif: false })
    assert.equal(result.autoAdjusted, true)
    assert.ok(result.width * result.height <= core.MAX_CANVAS_PIXELS)
    assert.ok(Math.max(result.width, result.height) <= core.MAX_CANVAS_EDGE)
    const metadata = await sharp(result.path).metadata()
    assert.deepEqual([metadata.width, metadata.height], [result.width, result.height])
  })
})
