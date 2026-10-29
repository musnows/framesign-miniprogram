const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const event = (key, value, extra = {}) => ({ currentTarget: { dataset: { key, ...extra } }, detail: { value } })

export default ({ env }) => ({
  run() {
    if (!new URLSearchParams(location.search).has('yingqianTest')) return
    setTimeout(async () => {
      const report = { device: env.WXA_DEVICE_ID, results: [], errors: [], complete: false }
      let api
      let saves = 0
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
        api.mock('showModal', { confirm: true, cancel: false })
        await run('home loads with all eleven templates', async () => {
          const data = await api.pageData()
          check(data.templates.length === 11, 'Expected eleven home templates')
          check((await api.currentPage()).path === 'pages/home/index', 'Expected home route')
        })
        await run('native photo selection reads two local images', async () => {
          api.mock('chooseMedia', { tempFiles: [{ tempFilePath: '/assets/sample.jpg', size: 100000 }, { tempFilePath: '/assets/sample.jpg', size: 100000 }] })
          await api.callPageMethod('choosePhotos')
          await api.waitForPage('pages/editor/index')
          const data = await preview()
          check(data.photos.length === 2, 'Expected two imported photos')
        })
        await run('manual EXIF values and visibility update the preview', async () => {
          await api.callPageMethod('changeExif', event('Make', 'NIKON'))
          await api.callPageMethod('changeExif', event('Model', 'NIKON Zf'))
          await api.callPageMethod('changeExif', event('FocalLength', '40mm'))
          await api.callPageMethod('changeExif', event('FNumber', 'f/2'))
          await api.callPageMethod('changeExif', event('ISO', 'ISO 100'))
          const data = await preview()
          check(data.fields.find(field => field.key === 'Model').value === 'NIKON Zf', 'Edited camera model was lost')
        })
        const templates = (await api.pageData()).templates
        for (const template of templates) await run(`render template ${template.id}`, async () => {
          await api.callPageMethod('selectTemplate', { currentTarget: { dataset: { id: template.id } } })
          const data = await preview()
          check(data.templateId === template.id && data.previewWidth > 100 && data.previewHeight > 100, 'Invalid rendered dimensions')
          const response = await fetch(data.preview)
          check(response.ok && (await response.arrayBuffer()).byteLength > 1000, 'Preview image is empty')
        })
        await run('PNG signature uses real file and canvas APIs', async () => {
          api.mock('chooseMedia', { tempFiles: [{ tempFilePath: '/logos/nikon.png', size: 10000 }] })
          await api.callPageMethod('chooseSignature')
          await preview()
          check((await api.pageData()).signature.dataUrl.length > 0, 'Signature was not persisted')
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
          check(data.fields.find(field => field.key === 'Model').value !== 'NIKON Zf', 'Per-photo EXIF was overwritten')
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
