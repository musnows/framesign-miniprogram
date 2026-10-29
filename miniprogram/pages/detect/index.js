const core = require('../../lib/core')

Page({
  data: { appVersion: core.APP_VERSION, path: '', busy: false, checked: false, result: null, error: '' },
  onLoad(options) {
    this.unloaded = false
    if (options.exported && getApp().globalData.detectPath) this.runDetection(getApp().globalData.detectPath)
  },
  onUnload() { this.unloaded = true; core.cancelDetection() },
  async choosePhoto() {
    if (this.data.busy) return
    try {
      const result = await core.api('chooseMedia', { count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['original'] })
      if (result.tempFiles[0]) await this.runDetection(result.tempFiles[0].tempFilePath)
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: '无法选择照片，请检查相册权限。' }) }
  },
  async runDetection(path) {
    this.setData({ path, busy: true, checked: false, result: null, error: '' })
    try {
      await new Promise(resolve => setTimeout(resolve, 80))
      const result = await core.detectPhoto(path)
      if (!this.unloaded) this.setData({ result, checked: true })
    } catch (error) { if (!this.unloaded) this.setData({ error: error.message || '检测失败，请选择原始导出的照片。' }) }
    finally { if (!this.unloaded) this.setData({ busy: false }) }
  },
  copyMarker() { if (this.data.result) wx.setClipboardData({ data: this.data.result.marker }) },
  preview() { if (this.data.path) wx.previewImage({ urls: [this.data.path] }) }
})
