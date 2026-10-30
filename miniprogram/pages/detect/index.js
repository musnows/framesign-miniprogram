const core = require('../../lib/core')

Page({
  data: { appVersion: core.APP_VERSION, path: '', busy: false, checked: false, result: null, error: '', dimensions: '', confidence: '', blockCount: 0 },
  onLoad(options) {
    this.unloaded = false
    this.detectionVersion = 0
    if (options.exported && getApp().globalData.detectPath) this.runDetection(getApp().globalData.detectPath)
  },
  onUnload() { this.unloaded = true; this.detectionVersion++; core.cancelDetection() },
  async choosePhoto(event) {
    if (this.data.busy) return
    try {
      const files = await core.pickImages(event?.currentTarget?.dataset?.source || 'album', 1)
      if (files[0]) await this.runDetection(files[0].tempFilePath)
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: '无法选择照片，请检查相册权限。' }) }
  },
  async runDetection(path) {
    const version = ++this.detectionVersion
    this.setData({ path, busy: true, checked: false, result: null, error: '', dimensions: '', confidence: '', blockCount: 0 })
    try {
      await new Promise(resolve => setTimeout(resolve, 80))
      if (this.unloaded || version !== this.detectionVersion) return
      const info = await core.api('getImageInfo', { src: path })
      if (this.unloaded || version !== this.detectionVersion) return
      const result = await core.detectPhoto(path)
      if (!this.unloaded && version === this.detectionVersion) this.setData({ result, checked: true, dimensions: info.width + ' × ' + info.height + ' px', confidence: result ? Math.round(result.confidence * 100) + '%' : '', blockCount: result ? result.blockCount : 0 })
    } catch (error) { if (!this.unloaded && version === this.detectionVersion) this.setData({ error: error.message || '检测失败，请选择原始导出的照片。' }) }
    finally { if (!this.unloaded && version === this.detectionVersion) this.setData({ busy: false }) }
  },
  retry() { if (this.data.path && !this.data.busy) return this.runDetection(this.data.path) },
  cancel() { this.detectionVersion++; core.cancelDetection(); this.setData({ busy: false, checked: false, error: '检测已停止。' }) },
  copyMarker() { if (this.data.result) wx.setClipboardData({ data: this.data.result.marker }) },
  preview() { if (this.data.path) wx.previewImage({ urls: [this.data.path] }) }
})
