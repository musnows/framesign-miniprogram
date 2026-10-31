const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const event = (key, value, extra = {}) => ({ currentTarget: { dataset: { key, ...extra } }, detail: { value } })

export default ({ env }) => ({
  run() {
    if (!new URLSearchParams(location.search).has('yingqianTest')) return
    setTimeout(async () => {
      const report = { device: env.WXA_DEVICE_ID, revision: env.WXA_TEST_REVISION, results: [], errors: [], complete: false }
      let api
      let saves = 0
      let modals = 0
      const sharedFiles = []
      const check = (condition, message) => { if (!condition) throw new Error(message) }
      const until = async (predicate, label, timeout = 30000) => {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          const result = await predicate()
          if (result) return result
          await wait(120)
        }
        throw new Error(`Timed out: ${label}`)
      }
      const preview = async () => until(async () => {
        const data = await api.pageData()
        if (data.error) throw new Error(`Preview error: ${data.error}`)
        return !data.rendering && data.preview ? data : null
      }, 'photo preview')
      const run = async (name, task) => {
        const started = Date.now()
        try { await task(); report.results.push({ name, passed: true, durationMs: Date.now() - started }) }
        catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error }
      }
      try {
        api = await until(() => window.__wxa_test_api__, 'test API')
        await api.ready
        api.mock('saveImageToPhotosAlbum', () => { saves++; return {} })
        api.mock('showModal', () => { modals++; return { confirm: true, cancel: false } })
        api.mock('shareFileMessage', args => { sharedFiles.push(args); return {} })
        await run('home loads with all eleven templates', async () => {
          const data = await api.pageData()
          check(data.templates.length === 11, 'Expected eleven home templates')
          check((await api.currentPage()).path === 'pages/home/index', 'Expected home route')
        })
        await run('native photo selection reads two local images', async () => {
          api.mock('chooseMedia', { tempFiles: [{ tempFilePath: '/assets/parity-source.jpg', size: 200000 }, { tempFilePath: '/assets/sample.jpg', size: 100000 }] })
          await api.callPageMethod('choosePhotos')
          await api.waitForPage('pages/editor/index')
          const data = await preview()
          check(data.photos.length === 2, 'Expected two imported photos')
          check(data.templateId === 'noProcess', 'Imported photos must start unprocessed')
          await api.callPageMethod('changeSetting', event('maxSide', 0))
          await api.callPageMethod('changeSetting', event('format', 0))
        })
        await run('manual EXIF values and visibility update the preview', async () => {
          await api.callPageMethod('changeExif', event('Make', 'NIKON'))
          await api.callPageMethod('changeExif', event('Model', 'EDITED MODEL'))
          await api.callPageMethod('changeExif', event('FocalLength', '40mm'))
          await api.callPageMethod('changeExif', event('FNumber', 'f/2'))
          await api.callPageMethod('changeExif', event('ISO', 'ISO 100'))
          const data = await preview()
          check(data.fields.find(field => field.key === 'Model').value === 'EDITED MODEL', 'Edited camera model was lost')
        })
        const templates = (await api.pageData()).templates
        for (const template of templates) await run(`render template ${template.id}`, async () => {
          await api.callPageMethod('selectTemplate', { currentTarget: { dataset: { id: template.id } } })
          const data = await preview()
          check(data.templateId === template.id && data.previewWidth > 100 && data.previewHeight > 100, 'Invalid rendered dimensions')
          const response = await fetch(data.preview)
          check(response.ok && (await response.arrayBuffer()).byteLength > 1000, 'Preview image is empty')
        })
        await run('template settings use web ranges and reset to template defaults', async () => {
          await api.callPageMethod('selectTemplate', { currentTarget: { dataset: { id: 'blurBackground' } } })
          await preview()
          const control = (await api.pageData()).controls.find(item => item.key === 'shadowRadius')
          check(control.max === 50 && control.scale === 1000, 'Shadow strength bounds differ from web')
          await api.callPageMethod('changeConfig', event('shadowRadius', 40, { scale: 1000 }))
          await preview()
          check((await api.pageData()).config.shadowRadius === 0.04, 'Shadow strength was not applied')
          await api.callPageMethod('resetConfigField', { currentTarget: { dataset: { key: 'shadowRadius' } } })
          await preview()
          check((await api.pageData()).config.shadowRadius === 0.015, 'Template reset lost its default')
        })
        await run('RGB and alpha colors update previews, apply to all photos and reset', async () => {
          await api.callPageMethod('changeConfig', event('textColor', '#7B2D8D'))
          await api.callPageMethod('changeConfig', event('shadowColor', 'rgba(24, 80, 160, 0.25)'))
          let data = await preview()
          check(data.controls.find(item => item.key === 'textColor').value === '#7B2D8D', 'Text color did not reach the editor')
          check(data.controls.find(item => item.key === 'shadowColor').value === 'rgba(24, 80, 160, 0.25)', 'Shadow opacity was lost')
          await api.callPageMethod('applyToAll')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 1 } } })
          data = await preview()
          check(data.config.textColor === '#7B2D8D' && data.config.shadowColor === 'rgba(24, 80, 160, 0.25)', 'Colors were not applied to the other photo')
          check(data.fields.find(field => field.key === 'Model').value !== 'EDITED MODEL', 'Color application overwrote per-photo EXIF')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 0 } } })
          await api.callPageMethod('resetConfigField', { currentTarget: { dataset: { key: 'textColor' } } })
          await api.callPageMethod('resetConfigField', { currentTarget: { dataset: { key: 'shadowColor' } } })
          data = await preview()
          check(data.config.textColor !== '#7B2D8D' && data.config.shadowColor !== 'rgba(24, 80, 160, 0.25)', 'Color reset did not restore template defaults')
        })
        await run('selected application preserves other photos and supports later additions', async () => {
          api.mock('chooseMessageFile', { tempFiles: [{ path: '/assets/sample.jpg', name: 'extra-original.jpg', size: 100000 }] })
          await api.callPageMethod('addPhotos', { currentTarget: { dataset: { source: 'message' } } })
          let data = await api.pageData()
          check(data.photos.length === 3, 'Appending a chat image failed')
          await api.callPageMethod('openSelection')
          await api.callPageMethod('selectTargets', { detail: { value: [String(data.photos[1].id)] } })
          await api.callPageMethod('applyToSelected')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 2 } } })
          data = await preview()
          check(data.templateId === 'noProcess', 'Unselected new photo was modified')
          await api.callPageMethod('removePhoto')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 1 } } })
          data = await preview()
          check(data.templateId === 'blurBackground', 'Selected photo did not receive the style')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 0 } } })
          await preview()
        })
        await run('brand logo replacements affect the matching brand and can be reset', async () => {
          await api.callPageMethod('selectTemplate', { currentTarget: { dataset: { id: 'standard1' } } })
          let data = await preview()
          const index = data.logos.findIndex(logo => logo.path === '/logos/apple.png')
          await api.callPageMethod('changeLogo', { currentTarget: { dataset: { brand: 'NIKON' } }, detail: { value: index } })
          data = await preview()
          check(data.brands.find(brand => brand.brand === 'NIKON').path === '/logos/apple.png', 'Brand replacement was not installed')
          api.mock('chooseMedia', { tempFiles: [{ tempFilePath: '/logos/nikon.png', size: 10000 }] })
          await api.callPageMethod('uploadLogo', { currentTarget: { dataset: { brand: 'NIKON' } } })
          data = await preview()
          check(data.brands.find(brand => brand.brand === 'NIKON').path.includes('yingqian-logo-'), 'Custom logo was not persisted')
          await api.callPageMethod('resetLogo', { currentTarget: { dataset: { brand: 'NIKON' } } })
          data = await preview()
          check(!data.brands.find(brand => brand.brand === 'NIKON').custom, 'Brand reset failed')
        })
        await run('full metadata reads the original GPS and binary fields and supports searching', async () => {
          await api.callPageMethod('toggleRaw')
          await api.waitForPage('pages/metadata/index')
          let data = await until(async () => { const data = await api.pageData(); if (data.error) throw new Error(data.error); return !data.loading ? data : null }, 'full metadata')
          check(data.total > 10, 'Full metadata tags are missing')
          await api.callPageMethod('search', { detail: { value: 'Model' } })
          data = await api.pageData()
          check(data.rows.some(row => row.value === 'NIKON Zf'), 'Metadata was replaced by the display override')
          await api.callPageMethod('search', { detail: { value: 'GPS' } })
          check((await api.pageData()).matching > 0, 'GPS metadata was discarded')
          await api.callPageMethod('search', { detail: { value: 'MakerNote' } })
          check((await api.pageData()).rows.some(row => row.binary && row.value.length), 'Binary metadata was discarded')
          await api.navigateBack()
          await api.waitForPage('pages/editor/index')
        })
        await run('saved date patterns persist through export preference changes', async () => {
          const data = await api.pageData()
          await api.callPageMethod('changeDate', { detail: { value: data.dateFormats.length - 1 } })
          await api.callPageMethod('changeConfig', event('customDateTimeFormat', 'YYYY年MM月DD日'))
          await api.callPageMethod('saveDateFormat')
          await api.callPageMethod('changeSetting', event('format', 0))
          await preview()
          check((await api.pageData()).savedDateFormats.includes('YYYY年MM月DD日'), 'Saved date pattern was lost')
          await api.callPageMethod('resetTemplate')
          await preview()
        })
        await run('PNG signature uses real file and canvas APIs', async () => {
          api.mock('chooseMedia', { tempFiles: [{ tempFilePath: '/logos/nikon.png', size: 10000 }] })
          await api.callPageMethod('chooseSignature')
          await preview()
          check((await api.pageData()).signature.dataUrl.length > 0, 'Signature was not persisted')
          await api.callPageMethod('changeSignature', event('width', 100, { scale: 100 }))
          await api.callPageMethod('changeSignature', event('opacity', 0, { scale: 100 }))
          await preview()
          check((await api.pageData()).signature.position === 'custom' && (await api.pageData()).signature.width === 1 && (await api.pageData()).signature.opacity === 0, 'Signature size and opacity do not match web bounds')
          await api.callPageMethod('resetSignatureLayout')
          await api.callPageMethod('removeSignature')
          check(!(await api.pageData()).signature.dataUrl, 'Signature removal failed')
          await api.callPageMethod('chooseSignature')
          await preview()
          await api.callPageMethod('changeSignature', event('position', '1'))
          await api.callPageMethod('changeSignature', event('x', 10, { scale: 100 }))
          await api.callPageMethod('changeSignature', event('y', 10, { scale: 100 }))
          await preview()
        })
        await run('batch style application preserves per-photo EXIF', async () => {
          await api.callPageMethod('selectTemplate', { currentTarget: { dataset: { id: 'standard1' } } })
          await api.callPageMethod('applyToAll')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 1 } } })
          const data = await preview()
          check(data.templateId === 'standard1', 'Shared template was not applied')
          check(data.fields.find(field => field.key === 'Model').value !== 'EDITED MODEL', 'Per-photo EXIF was overwritten')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 0 } } })
          await preview()
        })
        await run('batch export saves two full images', async () => {
          const before = saves
          await api.callPageMethod('savePhotos', { currentTarget: { dataset: { all: true } } })
          const data = await api.pageData()
          check(!data.error && data.savedCount === 2 && saves - before === 2, `Batch export failed: ${data.error}`)
          check(data.lastExport.width > 900, 'Export unexpectedly used thumbnail resolution')
        })
        await run('original-size files and multi-photo ZIP exports use real file APIs', async () => {
          await api.callPageMethod('changeSetting', event('maxSide', 0))
          await api.callPageMethod('exportFile', { currentTarget: { dataset: {} } })
          let data = await api.pageData()
          check(!data.error && data.lastFileExport.count === 1 && data.lastExport.width === 1080, 'Single original-size export failed: ' + JSON.stringify({ error: data.error, width: data.lastExport?.width, file: data.lastFileExport?.fileName }))
          await api.callPageMethod('exportFile', { currentTarget: { dataset: { all: true } } })
          data = await api.pageData()
          check(!data.error && data.lastFileExport.count === 2 && data.lastFileExport.fileName.endsWith('.zip'), 'ZIP export failed')
          check(sharedFiles.length === 0, 'File handoff must wait for an explicit user tap')
        })
        await run('invalid hidden marker blocks saving and recovers', async () => {
          await api.callPageMethod('changeSignature', event('enabled', false))
          await api.callPageMethod('changeConfig', event('hiddenWatermarkEnabled', true))
          await api.callPageMethod('changeConfig', event('hiddenWatermarkText', '中'.repeat(22)))
          await api.callPageMethod('savePhotos', { currentTarget: { dataset: {} } })
          check((await api.pageData()).error.length > 0, 'Oversized marker was accepted')
          await api.callPageMethod('changeConfig', event('hiddenWatermarkText', '映签 本地测试 42'))
          await preview()
        })
        await run('worker embeds a marker in lossless PNG', async () => {
          await api.callPageMethod('changeSetting', event('format', 1))
          await api.callPageMethod('savePhotos', { currentTarget: { dataset: {} } })
          const data = await api.pageData()
          check(!data.error && data.savedCount === 1, `Hidden export failed: ${data.error}`)
          check(data.lastExport.format === 'png', 'Hidden export must be PNG')
        })
        await run('detector reads back the exported marker', async () => {
          await api.callPageMethod('detectExport')
          await api.waitForPage('pages/detect/index')
          const data = await until(async () => { const data = await api.pageData(); if (data.error) throw new Error(data.error); return data.checked && !data.busy ? data : null }, 'worker detection', 90000)
          check(data.result?.marker === '映签 本地测试 42', 'Hidden watermark round-trip failed')
          check(data.confidence.endsWith('%') && data.blockCount > 0 && data.dimensions.includes('px'), 'Detector details are missing')
          await api.callPageMethod('retry')
          check((await api.pageData()).result?.marker === '映签 本地测试 42', 'Detector retry failed')
        })
        await run('oversized photos hide original size and select the supported maximum automatically', async () => {
          await api.navigateBack()
          await api.waitForPage('pages/editor/index')
          api.mock('chooseMessageFile', { tempFiles: [{ path: '/assets/oversized-source.jpg', name: 'oversized-source.jpg', size: 5000000 }] })
          await api.callPageMethod('addPhotos', { currentTarget: { dataset: { source: 'message' } } })
          const index = (await api.pageData()).photos.length - 1
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index } } })
          await preview()
          await api.callPageMethod('changeSetting', event('maxSide', 0))
          await api.callPageMethod('changeSetting', event('format', 0))
          const data = await api.pageData()
          check(data.sourceSize === '6000 × 4000', 'Expected the real oversized input')
          check(!data.sizeLabels.includes('原始尺寸'), 'Unsupported original size is still offered')
          check(data.sizeLabels[0].includes('最高支持尺寸') && data.sizeIndex === 0, 'Maximum supported size was not selected')
          check(data.resolutionNotice.includes('最高分辨率'), 'Automatic resize notice is missing')
        })
        await run('oversized album exports succeed at the highest supported size without a confirmation prompt', async () => {
          const before = modals
          await api.callPageMethod('savePhotos', { currentTarget: { dataset: {} } })
          const data = await api.pageData()
          check(!data.error && data.savedCount === 1 && data.lastExport.autoAdjusted, 'Oversized photo did not export automatically: ' + data.error)
          check(data.lastExport.width * data.lastExport.height <= 16000000 && Math.max(data.lastExport.width, data.lastExport.height) <= 8192, 'Export exceeded canvas limits')
          check(data.lastExport.width * data.lastExport.height > 15800000, 'Export was unnecessarily reduced to a small preset')
          check(data.notice.includes('最高分辨率') && modals === before, 'Export asked the user to choose a smaller size')
        })
        await run('size choices update across photos and preserve explicit smaller choices', async () => {
          const largeIndex = (await api.pageData()).photos.length - 1
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: 0 } } })
          check((await preview()).sizeLabels.includes('原始尺寸'), 'Supported original size was removed')
          await api.callPageMethod('selectPhoto', { currentTarget: { dataset: { index: largeIndex } } })
          const data = await preview()
          await api.callPageMethod('changeSetting', event('maxSide', data.sizeValues.indexOf(1280)))
          await api.callPageMethod('savePhotos', { currentTarget: { dataset: {} } })
          const reduced = await api.pageData()
          check(!reduced.error && reduced.lastExport.width === 1280 && !reduced.lastExport.autoAdjusted, 'The selected smaller size was not preserved')
          await api.callPageMethod('changeSetting', event('maxSide', 0))
        })
        await run('oversized file exports explain automatic fitting and remain ready for native handoff', async () => {
          await api.callPageMethod('exportFile', { currentTarget: { dataset: {} } })
          const data = await api.pageData()
          check(!data.error && data.lastFileExport.adjustedCount === 1 && data.lastFileExport.count === 1, 'Automatic file export failed')
          check(data.notice.includes('最高分辨率') && !data.sizeLabels.includes('原始尺寸'), 'Export result and size choices are inconsistent')
          await api.callPageMethod('selectTab', { currentTarget: { dataset: { id: 'export' } } })
        })
        await run('no runtime errors or unimplemented native APIs', async () => {
          report.errors = await api.errors()
          check(report.errors.length === 0, JSON.stringify(report.errors))
        })
        report.complete = true
      } catch (error) {
        report.failure = error.message
        if (api) report.errors = await api.errors()
      } finally {
        await fetch(env.WXA_REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) })
      }
    }, 0)
  }
})
