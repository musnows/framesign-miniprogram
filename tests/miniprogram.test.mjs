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
import { metadataFixture } from './metadata-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = path.join(root, '.ai-docs/miniprogram/tests')
await mkdir(artifacts, { recursive: true })
const localPath = value => /^\/(assets|logos)\//.test(value) ? path.join(root, 'miniprogram', value) : value
const imageSource = Object.getOwnPropertyDescriptor(Image.prototype, 'src')
let serial = 0
let chosen = []
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
  chooseMessageFile({ success }) { success({ tempFiles: chosen }) },
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

test('original-size export preserves pixels above the previous resolution cap and rejects oversize input explicitly', async () => {
  const photo = { ...core.createDemo(91, 'noProcess'), path: path.join(artifacts, 'large-original.jpg'), width: 3000, height: 2000 }
  await sharp(sample).resize(3000, 2000).toFile(photo.path)
  const original = await core.exportPhoto(photo, target, { preserveExif: false })
  assert.deepEqual([original.width, original.height], [3000, 2000])
  assert.equal(original.format, 'jpg')
  const reduced = await core.exportPhoto(photo, target, { maxSide: 1280, preserveExif: false })
  assert.equal(reduced.width, 1280)
  await assert.rejects(core.exportPhoto({ ...photo, width: 6000, height: 4000 }, target, { preserveExif: false }), /原尺寸/)
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
