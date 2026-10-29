const core = require('../../lib/core')

Page({
  data: {
    appVersion: core.APP_VERSION,
    templates: core.templates.map((item, index) => ({ id: item.id, name: item.name, number: String(index + 1).padStart(2, '0') })),
    busy: false,
    photoCount: 0,
    error: ''
  },
  onShow() { this.setData({ photoCount: getApp().globalData.photos.length }) },
  async choosePhotos() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try {
      const result = await core.importPhotos()
      if (!result.photos.length) {
        if (result.failures.length) this.setData({ error: result.failures.join('\n') })
        return
      }
      const app = getApp().globalData
      app.photos = result.photos.map(photo => ({ ...photo, id: app.nextPhotoId++, config: { ...photo.config, ...(app.signature ? { signature: { ...app.signature } } : {}) } }))
      app.importFailures = result.failures
      wx.navigateTo({ url: '/pages/editor/index' })
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: error.message || '无法打开相册，请检查微信的照片权限后重试。' })
    } finally { this.setData({ busy: false }) }
  },
  useDemo(event) {
    const app = getApp().globalData
    const id = event.currentTarget.dataset.id || 'standard1'
    app.photos = [core.createDemo(app.nextPhotoId++, id)]
    if (app.signature) app.photos[0].config.signature = { ...app.signature }
    app.importFailures = []
    wx.navigateTo({ url: '/pages/editor/index' })
  },
  resume() { wx.navigateTo({ url: '/pages/editor/index' }) },
  detect() { wx.navigateTo({ url: '/pages/detect/index' }) }
})
