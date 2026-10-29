const core = require('../../lib/core')
const { STORAGE } = require('../../brand')
const displayKeys = ['showBrand', 'showModel', 'showLens', 'showFocalLength', 'showAperture', 'showShutter', 'showISO', 'showDateTime']
const dateFormats = [...core.DATE_TIME_FORMAT_OPTIONS, { value: 'custom', label: '自定义格式' }]
const clone = value => JSON.parse(JSON.stringify(value))

Page({
  data: {
    appVersion: core.APP_VERSION,
    photos: [], activeIndex: 0, tab: 'template',
    tabs: [{ id: 'template', name: '模板' }, { id: 'exif', name: '参数' }, { id: 'signature', name: '签名' }, { id: 'export', name: '导出' }],
    templates: core.templates.map(item => ({ id: item.id, name: item.name })),
    logos: [{ name: '自动识别相机品牌', path: '' }, ...core.logos],
    dateFormats, dateIndex: 0, logoIndex: 0,
    settings: { ...core.defaultExport }, sizeLabels: ['1280 px · 轻量', '2048 px · 推荐', '2560 px · 精细'], sizeIndex: 1,
    formats: ['JPEG · 通用照片', 'PNG · 无损画质'], formatIndex: 0,
    signaturePositions: ['跟随模板', '自定义位置'], signatureMasks: ['自动适配颜色', '保留原色', '自定义颜色'], signatureMaskIndex: 0,
    signatureAnchors: ['参数旁', '相机型号旁'], signatureAnchorIndex: 0,
    textPositions: ['底部居中', '顶部居中', '左下角', '右下角'], textPositionIndex: 0,
    config: {}, options: {}, labels: {}, signature: { ...core.DEFAULT_SIGNATURE }, fields: [], rawFields: [], showRaw: false,
    preview: '', previewWidth: 0, previewHeight: 0, rendering: false, importing: false, exporting: false,
    error: '', notice: '', progress: '', savedCount: 0, needsPermission: false, markerLength: 0
  },
  onLoad() {
    const app = getApp().globalData
    this.photos = app.photos
    this.renderVersion = 0
    this.unloaded = false
    if (!this.photos.length) { wx.redirectTo({ url: '/pages/home/index' }); return }
    const saved = app.preferences || {}
    const settings = { ...core.defaultExport, ...saved.settings }
    this.setData({ settings, sizeIndex: Math.max(0, [1280, 2048, 2560].indexOf(settings.maxSide)), formatIndex: settings.format === 'png' ? 1 : 0, notice: (app.importFailures || []).join('\n') })
    this.refreshPhoto()
  },
  onReady() {
    wx.createSelectorQuery().select('#exportCanvas').fields({ node: true, size: true }).exec(result => {
      this.canvas = result[0] && result[0].node
      if (!this.canvas) { this.setData({ error: '无法初始化画布，请更新微信后重试。' }); return }
      this.requestPreview()
    })
  },
  onUnload() {
    this.unloaded = true
    this.cancelled = true
    core.cancelDetection()
    this.renderVersion++
    clearTimeout(this.previewTimer)
  },
  currentPhoto() { return this.photos && this.photos[this.data.activeIndex] },
  refreshPhoto() {
    const photo = this.currentPhoto()
    if (!photo) return
    const config = photo.config
    const exif = { ...photo.exif, ...photo.overrides }
    const signature = { ...core.DEFAULT_SIGNATURE, ...config.signature }
    this.setData({
      photos: this.photos.map(item => ({ id: item.id, path: item.path, name: item.name })),
      photoName: photo.name, isDemo: !!photo.isDemo, sourceSize: `${photo.width} × ${photo.height}`,
      config, signature, options: core.template(photo.templateId).userOptions, templateId: photo.templateId,
      labels: Object.fromEntries(['imageMargin', 'watermarkScale', 'borderRadius', 'blurRadius', 'nikonZScale'].map(key => [key, Math.round(Number(config[key]) * 100)]).concat([['signatureWidth', Math.round(signature.width * 100)]])),
      templateName: core.template(photo.templateId).name,
      fields: core.EDITABLE_EXIF_FIELDS.map((field, index) => ({ ...field, value: String(exif[field.key] || ''), showKey: displayKeys[index], visible: config[displayKeys[index]] !== false })),
      rawFields: Object.entries(photo.rawExif || {}).filter(([, value]) => typeof value !== 'object' || value instanceof Date).map(([key, value]) => ({ key, value: String(value).slice(0, 1000) })),
      dateIndex: Math.max(0, dateFormats.findIndex(item => item.value === config.dateTimeFormat)),
      logoIndex: Math.max(0, this.data.logos.findIndex(item => item.path === config.customLogoUrl)),
      signatureMaskIndex: Math.max(0, ['auto', 'original', 'custom'].indexOf(signature.mask)),
      signatureAnchorIndex: signature.anchor === 'camera' ? 1 : 0,
      textPositionIndex: Math.max(0, ['bottom-center', 'top-center', 'left-bottom', 'right-bottom'].indexOf(config.textPosition)),
      markerLength: core.markerBytes(config.hiddenWatermarkText || ''), metadataWarning: photo.metadataWarning || ''
    })
  },
  requestPreview() {
    const version = ++this.renderVersion
    clearTimeout(this.previewTimer)
    if (!this.canvas || !this.currentPhoto() || this.unloaded || this.data.exporting) return
    this.setData({ rendering: true, error: '' })
    this.previewTimer = setTimeout(async () => {
      if (this.unloaded || version !== this.renderVersion) return
      try {
        const result = await core.previewPhoto(this.currentPhoto(), this.canvas)
        if (!this.unloaded && version === this.renderVersion) this.setData({ preview: result.path, previewWidth: result.width, previewHeight: result.height, rendering: false })
      } catch (error) {
        if (!this.unloaded && version === this.renderVersion) this.setData({ rendering: false, error: '预览失败：' + (error.message || '请重新选择照片') })
      }
    }, 180)
  },
  selectPhoto(event) {
    if (this.data.exporting || this.data.importing) return
    this.setData({ activeIndex: Number(event.currentTarget.dataset.index), preview: '', error: '' })
    this.refreshPhoto(); this.requestPreview()
  },
  selectTab(event) { this.setData({ tab: event.currentTarget.dataset.id }) },
  selectTemplate(event) {
    if (this.data.exporting) return
    const photo = this.currentPhoto()
    const id = event.currentTarget.dataset.id
    photo.templateId = id
    photo.config = { ...core.defaults(id), signature: photo.config.signature, hiddenWatermarkEnabled: photo.config.hiddenWatermarkEnabled, hiddenWatermarkText: photo.config.hiddenWatermarkText }
    this.refreshPhoto(); this.requestPreview()
  },
  changeConfig(event) {
    if (this.data.exporting) return
    const key = event.currentTarget.dataset.key
    let value = event.detail.value
    if (event.currentTarget.dataset.scale) value = Number(value) / Number(event.currentTarget.dataset.scale)
    this.currentPhoto().config[key] = value
    this.refreshPhoto(); this.requestPreview()
  },
  changeExif(event) {
    if (this.data.exporting) return
    this.currentPhoto().overrides[event.currentTarget.dataset.key] = event.detail.value.trim()
    this.refreshPhoto(); this.requestPreview()
  },
  resetExif() { this.currentPhoto().overrides = {}; this.refreshPhoto(); this.requestPreview() },
  toggleRaw() { this.setData({ showRaw: !this.data.showRaw }) },
  changeDate(event) { this.currentPhoto().config.dateTimeFormat = dateFormats[Number(event.detail.value)].value; this.refreshPhoto(); this.requestPreview() },
  changeLogo(event) {
    const path = this.data.logos[Number(event.detail.value)].path
    Object.assign(this.currentPhoto().config, { customLogoUrl: path, customDefaultLogoUrl: path })
    this.refreshPhoto(); this.requestPreview()
  },
  changeTextPosition(event) { this.currentPhoto().config.textPosition = ['bottom-center', 'top-center', 'left-bottom', 'right-bottom'][Number(event.detail.value)]; this.refreshPhoto(); this.requestPreview() },
  async chooseSignature() {
    if (this.data.exporting || this.data.importing || !this.canvas) return
    this.setData({ importing: true, error: '' })
    try {
      const signature = await core.importSignature(this.canvas)
      this.currentPhoto().config.signature = signature
      getApp().globalData.signature = { ...signature }
      wx.setStorageSync(STORAGE.signature, signature)
      this.refreshPhoto(); this.requestPreview()
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: error.message || '签名读取失败，请选择透明 PNG。' }) }
    finally { if (!this.unloaded) this.setData({ importing: false }) }
  },
  changeSignature(event) {
    const key = event.currentTarget.dataset.key
    let value = event.detail.value
    if (event.currentTarget.dataset.scale) value = Number(value) / Number(event.currentTarget.dataset.scale)
    if (key === 'position') value = Number(value) === 0 ? 'template' : 'custom'
    if (key === 'mask') value = ['auto', 'original', 'custom'][Number(value)]
    if (key === 'anchor') value = Number(value) === 0 ? 'params' : 'camera'
    this.currentPhoto().config.signature = { ...this.data.signature, [key]: value }
    getApp().globalData.signature = { ...this.currentPhoto().config.signature }
    wx.setStorageSync(STORAGE.signature, this.currentPhoto().config.signature)
    this.refreshPhoto(); this.requestPreview()
  },
  changeSetting(event) {
    const key = event.currentTarget.dataset.key
    let value = event.detail.value
    if (key === 'maxSide') value = [1280, 2048, 2560][Number(value)]
    if (key === 'format') value = Number(value) === 0 ? 'jpg' : 'png'
    const settings = { ...this.data.settings, [key]: value }
    this.setData({ settings, sizeIndex: [1280, 2048, 2560].indexOf(settings.maxSide), formatIndex: settings.format === 'png' ? 1 : 0 })
    getApp().globalData.preferences = { settings }
    wx.setStorageSync(STORAGE.preferences, { settings })
  },
  async addPhotos() {
    if (this.data.exporting || this.data.importing || this.photos.length >= 9) return
    this.setData({ importing: true, error: '' })
    try {
      const result = await core.importPhotos(this.currentPhoto().templateId, 9 - this.photos.length)
      const app = getApp().globalData
      for (const photo of result.photos) this.photos.push({ ...photo, id: app.nextPhotoId++, config: { ...photo.config, ...(app.signature ? { signature: { ...app.signature } } : {}) } })
      this.setData({ notice: result.failures.join('\n') }); this.refreshPhoto()
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: '添加照片失败，请检查相册权限。' }) }
    finally { if (!this.unloaded) this.setData({ importing: false }) }
  },
  async removePhoto() {
    if (this.data.exporting) return
    const result = await core.api('showModal', { title: '移出编辑列表', content: '只移出当前照片，不影响相册原图。', confirmText: '移出' })
    if (!result.confirm) return
    this.photos.splice(this.data.activeIndex, 1)
    if (!this.photos.length) { wx.navigateBack(); return }
    this.setData({ activeIndex: Math.min(this.data.activeIndex, this.photos.length - 1), preview: '' })
    this.refreshPhoto(); this.requestPreview()
  },
  async applyToAll() {
    if (this.data.exporting) return
    const result = await core.api('showModal', { title: '应用到全部照片', content: '将当前模板、样式和签名应用到所有照片。每张照片仍使用自己的 EXIF 参数。', confirmText: '应用' })
    if (!result.confirm) return
    const current = this.currentPhoto()
    for (const photo of this.photos) { photo.templateId = current.templateId; photo.config = clone(current.config) }
    wx.showToast({ title: '已应用到全部', icon: 'success' })
  },
  previewImage() { if (this.data.preview) wx.previewImage({ urls: [this.data.preview] }) },
  cancelExport() { this.cancelled = true; this.setData({ progress: '当前照片完成后停止' }) },
  async savePhotos(event) {
    if (this.data.exporting || this.data.importing || !this.canvas) return
    const photos = event.currentTarget.dataset.all ? this.photos.map(clone) : [clone(this.currentPhoto())]
    try { photos.forEach(photo => core.validateConfig(photo.config)) }
    catch (error) { this.setData({ error: error.message }); return }
    this.cancelled = false
    clearTimeout(this.previewTimer)
    this.renderVersion++
    this.setData({ exporting: true, rendering: false, error: '', notice: '', savedCount: 0, needsPermission: false, progress: '正在准备导出…' })
    let saved = 0
    try {
      for (const photo of photos) {
        if (this.cancelled || this.unloaded) break
        this.setData({ progress: `正在处理 ${saved + 1} / ${photos.length}` })
        await new Promise(resolve => setTimeout(resolve, 30))
        const result = await core.exportPhoto(photo, this.canvas, this.data.settings)
        if (this.unloaded) break
        await core.api('saveImageToPhotosAlbum', { filePath: result.path })
        saved++
        this.setData({ savedCount: saved, lastExport: result })
      }
      if (!this.unloaded) this.setData({ notice: this.cancelled ? `已停止，已保存 ${saved} 张照片。` : `已保存 ${saved} 张照片到相册。`, progress: '' })
    } catch (error) {
      if (!this.unloaded) {
        const permission = /auth|denied|permission/i.test(error.errMsg || '')
        this.setData({ error: permission ? '需要相册写入权限，请点击下方按钮开启后重新保存。' : `导出中断，已保存 ${saved} 张。${error.message || '请检查剩余存储空间并重试。'}`, needsPermission: permission, progress: '' })
      }
    } finally { if (!this.unloaded) this.setData({ exporting: false }) }
  },
  permissionChanged() { this.setData({ needsPermission: false, error: '' }) },
  detectExport() {
    if (!this.data.lastExport) return
    getApp().globalData.detectPath = this.data.lastExport.path
    wx.navigateTo({ url: '/pages/detect/index?exported=1' })
  }
})
