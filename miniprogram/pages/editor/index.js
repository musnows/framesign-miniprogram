const core = require('../../lib/core')
const { STORAGE } = require('../../brand')
const displayKeys = ['showBrand', 'showModel', 'showLens', 'showFocalLength', 'showAperture', 'showShutter', 'showISO', 'showDateTime']
const dateFormats = [...core.DATE_TIME_FORMAT_OPTIONS, { value: 'custom', label: '自定义格式' }]
const clone = value => JSON.parse(JSON.stringify(value))

Page({
  data: {
    appVersion: core.APP_VERSION,
    photos: [], activeIndex: 0, tab: 'template', brands: [], selectionOpen: false, selectedIds: [], selectionPhotos: [],
    tabs: [{ id: 'template', name: '模板' }, { id: 'exif', name: '参数' }, { id: 'signature', name: '签名' }, { id: 'export', name: '导出' }],
    templates: core.templates.map(item => ({ id: item.id, name: item.name })),
    logos: [{ name: '自动识别相机品牌', path: '' }, ...core.logos],
    dateFormats, dateIndex: 0, logoIndex: 0,
    settings: { ...core.defaultExport }, sizeLabels: ['原始尺寸', '1280 px · 轻量', '2048 px', '2560 px', '4096 px'], sizeIndex: 0,
    formats: ['JPEG · 通用照片', 'PNG · 无损画质'], formatIndex: 0,
    signaturePositions: ['跟随模板', '自定义位置'], signatureMasks: ['自动适配颜色', '保留原色', '自定义颜色'], signatureMaskIndex: 0,
    signatureAnchors: ['参数旁', '相机型号旁'], signatureAnchorIndex: 0,
    textPositions: ['底部居中', '顶部居中', '左下角', '右下角'], textPositionIndex: 0,
    config: {}, options: {}, labels: {}, controls: [], savedDateFormats: [], datePreview: '', signatureBox: '', signature: { ...core.DEFAULT_SIGNATURE }, fields: [], rawFields: [], showRaw: false,
    preview: '', previewWidth: 0, previewHeight: 0, rendering: false, importing: false, exporting: false,
    error: '', notice: '', progress: '', savedCount: 0, needsPermission: false, markerLength: 0
  },
  onLoad() {
    const app = getApp().globalData
    this.photos = app.photos
    if (!app.customLogos) app.customLogos = new Map()
    this.renderVersion = 0
    this.unloaded = false
    if (!this.photos.length) { wx.redirectTo({ url: '/pages/home/index' }); return }
    const saved = app.preferences || {}
    const settings = { ...core.defaultExport, ...saved.settings }
    this.setData({ settings, sizeIndex: Math.max(0, [0, 1280, 2048, 2560, 4096].indexOf(settings.maxSide)), formatIndex: settings.format === 'png' ? 1 : 0, notice: (app.importFailures || []).join('\n') })
    this.setData({ savedDateFormats: core.parseSavedDateTimeFormats(JSON.stringify(saved.dateFormats || [])) })
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
      brands: core.brandGroups(this.photos, getApp().globalData.customLogos).map(item => ({ ...item, logoIndex: Math.max(0, this.data.logos.findIndex(logo => logo.path === item.path)) })),
      photoName: photo.name, isDemo: !!photo.isDemo, sourceSize: `${photo.width} × ${photo.height}`,
      config, signature, controls: core.templateControls(photo.templateId, config), datePreview: core.formatDateTimeValue(exif.DateTimeOriginal || '2026-10-12 14:30:45', config.dateTimeFormat, config.customDateTimeFormat), options: core.template(photo.templateId).userOptions, templateId: photo.templateId,
      labels: Object.fromEntries(['imageMargin', 'watermarkScale', 'borderRadius', 'blurRadius', 'nikonZScale'].map(key => [key, Math.round(Number(config[key]) * 100)]).concat([['signatureWidth', Math.round(signature.width * 100)]])),
      templateName: core.template(photo.templateId).name,
      fields: core.EDITABLE_EXIF_FIELDS.map((field, index) => ({ ...field, value: String(exif[field.key] || ''), showKey: displayKeys[index], visible: config[displayKeys[index]] !== false, supported: Object.prototype.hasOwnProperty.call(core.template(photo.templateId).userOptions.exifFields || {}, displayKeys[index]) })),
      rawFields: Object.entries(photo.rawExif || {}).filter(([, value]) => typeof value !== 'object' || value instanceof Date).map(([key, value]) => ({ key, value: String(value).slice(0, 1000) })),
      dateIndex: Math.max(0, dateFormats.findIndex(item => item.value === config.dateTimeFormat)),
      logoIndex: Math.max(0, this.data.logos.findIndex(item => item.path === config.customLogoUrl)),
      signatureMaskIndex: Math.max(0, ['auto', 'original', 'custom'].indexOf(signature.mask)),
      signatureAnchorIndex: (signature.anchor || core.getDefaultSignatureAnchor(core.template(photo.templateId).processors)) === 'camera' ? 1 : 0,
      textPositionIndex: Math.max(0, ['bottom-center', 'top-center', 'left-bottom', 'right-bottom'].indexOf(config.textPosition)),
      markerLength: core.markerBytes(config.hiddenWatermarkText || ''), metadataWarning: photo.metadataWarning || ''
    })
  },
  resetConfigField(event) {
    if (this.data.exporting) return
    const key = event.currentTarget.dataset.key
    this.currentPhoto().config[key] = core.defaults(this.currentPhoto().templateId)[key]
    this.refreshPhoto(); this.requestPreview()
  },
  resetTemplate() {
    if (this.data.exporting) return
    const photo = this.currentPhoto()
    photo.config = { ...core.defaults(photo.templateId), ...(photo.config.signature ? { signature: photo.config.signature } : {}) }
    this.refreshPhoto(); this.requestPreview()
  },
  resetConfigGroup(event) {
    if (this.data.exporting) return
    const keys = event.currentTarget.dataset.group === 'text'
      ? ['personalText', 'textMargin', 'textFontSize', 'textOpacity', 'textPosition', 'textColor']
      : ['logoEnabled', ...displayKeys, 'dateTimeFormat', 'customDateTimeFormat']
    const defaults = core.defaults(this.currentPhoto().templateId)
    for (const key of keys) this.currentPhoto().config[key] = defaults[key]
    this.refreshPhoto(); this.requestPreview()
  },
  saveDateFormat() {
    const format = String(this.currentPhoto().config.customDateTimeFormat || '').trim()
    if (!format) return
    const dateFormats = core.addSavedDateTimeFormat(this.data.savedDateFormats, format)
    const preferences = { ...(getApp().globalData.preferences || {}), dateFormats }
    getApp().globalData.preferences = preferences
    wx.setStorageSync(STORAGE.preferences, preferences)
    this.setData({ savedDateFormats: dateFormats })
  },
  applyDateFormat(event) {
    Object.assign(this.currentPhoto().config, { dateTimeFormat: 'custom', customDateTimeFormat: event.currentTarget.dataset.format })
    this.refreshPhoto(); this.requestPreview()
  },
  requestPreview() {
    const version = ++this.renderVersion
    clearTimeout(this.previewTimer)
    if (!this.canvas || !this.currentPhoto() || this.unloaded || this.data.exporting) return
    this.setData({ rendering: true, error: '' })
    this.previewTimer = setTimeout(async () => {
      if (this.unloaded || version !== this.renderVersion) return
      try {
        const result = await core.previewPhoto(core.withBrandLogos(this.currentPhoto(), getApp().globalData.customLogos), this.canvas)
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
    this.currentPhoto().overrides = core.normalizeExifOverrides({ ...this.currentPhoto().overrides, [event.currentTarget.dataset.key]: event.detail.value })
    this.refreshPhoto(); this.requestPreview()
  },
  resetExif() { this.currentPhoto().overrides = {}; this.refreshPhoto(); this.requestPreview() },
  toggleRaw() { wx.navigateTo({ url: '/pages/metadata/index?id=' + this.currentPhoto().id }) },
  changeDate(event) { this.currentPhoto().config.dateTimeFormat = dateFormats[Number(event.detail.value)].value; this.refreshPhoto(); this.requestPreview() },
  changeLogo(event) {
    const path = this.data.logos[Number(event.detail.value)].path
    const brand = event.currentTarget.dataset.brand === undefined ? core.photoBrand(this.currentPhoto()) : event.currentTarget.dataset.brand
    if (path) getApp().globalData.customLogos.set(brand, path)
    else getApp().globalData.customLogos.delete(brand)
    this.refreshPhoto(); this.requestPreview()
  },
  async uploadLogo(event) {
    if (this.data.exporting || this.data.importing || !this.canvas) return
    this.setData({ importing: true, error: '' })
    try {
      const path = await core.importLogo(this.canvas, event.currentTarget.dataset.source || 'album')
      getApp().globalData.customLogos.set(event.currentTarget.dataset.brand, path)
      this.refreshPhoto(); this.requestPreview()
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: error.message || '无法读取 Logo 图片。' }) }
    finally { if (!this.unloaded) this.setData({ importing: false }) }
  },
  resetLogo(event) {
    getApp().globalData.customLogos.delete(event.currentTarget.dataset.brand)
    this.refreshPhoto(); this.requestPreview()
  },
  changeTextPosition(event) { this.currentPhoto().config.textPosition = ['bottom-center', 'top-center', 'left-bottom', 'right-bottom'][Number(event.detail.value)]; this.refreshPhoto(); this.requestPreview() },
  async chooseSignature(event) {
    if (this.data.exporting || this.data.importing || !this.canvas) return
    this.setData({ importing: true, error: '' })
    try {
      const signature = await core.importSignature(this.canvas, event?.currentTarget?.dataset?.source || 'album')
      this.currentPhoto().config.signature = { ...this.data.signature, dataUrl: signature.dataUrl, name: signature.name, aspectRatio: signature.aspectRatio, enabled: true }
      getApp().globalData.signature = { ...this.currentPhoto().config.signature }
      wx.setStorageSync(STORAGE.signature, this.currentPhoto().config.signature)
      this.refreshPhoto(); this.requestPreview()
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.setData({ error: error.message || '签名读取失败，请选择透明 PNG。' }) }
    finally { if (!this.unloaded) this.setData({ importing: false }) }
  },
  changeSignature(event) {
    if (this.data.exporting || this.data.importing) return
    const key = event.currentTarget.dataset.key
    let value = event.detail.value
    if (['width', 'opacity'].includes(key) && !String(value).trim()) return
    if (event.currentTarget.dataset.scale) value = Number(value) / Number(event.currentTarget.dataset.scale)
    if (key === 'position') value = Number(value) === 0 ? 'template' : 'custom'
    if (key === 'mask') value = ['auto', 'original', 'custom'][Number(value)]
    if (key === 'anchor') value = Number(value) === 0 ? 'params' : 'camera'
    if (key === 'opacity') value = core.clampSignatureOpacity(Number(value))
    this.currentPhoto().config.signature = key === 'width' ? core.setSignatureWidth(this.data.signature, Number(value)) : { ...this.data.signature, [key]: value }
    getApp().globalData.signature = { ...this.currentPhoto().config.signature }
    wx.setStorageSync(STORAGE.signature, this.currentPhoto().config.signature)
    this.refreshPhoto(); this.requestPreview()
  },
  removeSignature() {
    if (this.data.exporting || this.data.importing) return
    this.currentPhoto().config.signature = undefined
    getApp().globalData.signature = null
    wx.setStorageSync(STORAGE.signature, null)
    this.refreshPhoto(); this.requestPreview()
  },
  resetSignatureLayout() {
    Object.assign(this.currentPhoto().config.signature, { position: 'template', anchor: undefined, width: core.DEFAULT_SIGNATURE.width, x: core.DEFAULT_SIGNATURE.x, y: core.DEFAULT_SIGNATURE.y })
    this.refreshPhoto(); this.requestPreview()
  },
  measurePreview() {
    wx.createSelectorQuery().select('#photo-preview').boundingClientRect(rect => {
      if (!rect || this.unloaded) return
      this.previewRect = rect
      this.updateSignatureBox(this.data.signature)
    }).exec()
  },
  updateSignatureBox(signature) {
    if (!this.previewRect) return
    const { width, height } = this.previewRect
    const box = core.signatureBounds(signature, width, height)
    this.setData({ signatureBox: 'left:' + box.x / width * 100 + '%;top:' + box.y / height * 100 + '%;width:' + box.width / width * 100 + '%;height:' + box.height / height * 100 + '%' })
  },
  startSignatureGesture(event) {
    if (!this.previewRect || this.data.exporting || this.data.rendering || !event.touches.length) return
    const touch = event.touches[0]
    const { width, height } = this.previewRect
    const box = core.signatureBounds(this.data.signature, width, height)
    this.signatureGesture = { mode: event.currentTarget.dataset.mode, x: touch.clientX, y: touch.clientY, signature: { ...this.data.signature, x: box.x / width, y: box.y / height, width: box.width / width } }
  },
  moveSignatureGesture(event) {
    if (!this.signatureGesture || !event.touches.length) return
    const touch = event.touches[0]
    const gesture = this.signatureGesture
    const { width, height } = this.previewRect
    const signature = { ...gesture.signature, position: 'custom' }
    if (gesture.mode === 'resize') signature.width = core.draggedSignatureWidth(signature, touch.clientX - gesture.x, touch.clientY - gesture.y, width, height)
    else { signature.x += (touch.clientX - gesture.x) / width; signature.y += (touch.clientY - gesture.y) / height }
    const box = core.signatureBounds(signature, width, height)
    Object.assign(signature, { x: box.x / width, y: box.y / height, width: box.width / width })
    this.gestureDraft = signature
    this.updateSignatureBox(signature)
  },
  finishSignatureGesture() {
    if (this.gestureDraft) {
      this.currentPhoto().config.signature = this.gestureDraft
      getApp().globalData.signature = { ...this.gestureDraft }
      wx.setStorageSync(STORAGE.signature, this.gestureDraft)
      this.refreshPhoto(); this.requestPreview()
    }
    this.signatureGesture = null; this.gestureDraft = null
  },
  cancelSignatureGesture() { this.signatureGesture = null; this.gestureDraft = null; this.updateSignatureBox(this.data.signature) },
  changeSetting(event) {
    const key = event.currentTarget.dataset.key
    let value = event.detail.value
    if (key === 'maxSide') value = [0, 1280, 2048, 2560, 4096][Number(value)]
    if (key === 'format') value = Number(value) === 0 ? 'jpg' : 'png'
    const settings = { ...this.data.settings, [key]: value }
    this.setData({ settings, sizeIndex: [0, 1280, 2048, 2560, 4096].indexOf(settings.maxSide), formatIndex: settings.format === 'png' ? 1 : 0 })
    const preferences = { ...(getApp().globalData.preferences || {}), settings }
    getApp().globalData.preferences = preferences
    wx.setStorageSync(STORAGE.preferences, preferences)
  },
  async addPhotos(event) {
    if (this.data.exporting || this.data.importing) return
    this.setData({ importing: true, error: '' })
    try {
      const result = await core.importPhotos('noProcess', 9, event?.currentTarget?.dataset?.source || 'album')
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
    core.applyPhotoStyle(this.photos, current, this.photos.map(photo => photo.id))
    this.refreshPhoto(); this.requestPreview()
    wx.showToast({ title: '已应用到全部', icon: 'success' })
  },
  openSelection() { this.setData({ selectionOpen: true, selectedIds: [], selectionPhotos: this.data.photos.map(photo => ({ ...photo, selected: false })) }) },
  selectTargets(event) {
    const selectedIds = event.detail.value.map(String)
    this.setData({ selectedIds, selectionPhotos: this.data.photos.map(photo => ({ ...photo, selected: selectedIds.includes(String(photo.id)) })) })
  },
  selectAllTargets() { this.selectTargets({ detail: { value: this.photos.map(photo => String(photo.id)) } }) },
  clearTargets() { this.selectTargets({ detail: { value: [] } }) },
  async applyToSelected() {
    if (this.data.exporting || !this.data.selectedIds.length) return
    const response = await core.api('showModal', { title: '应用到选中照片', content: '将当前模板、样式和签名应用到选中的 ' + this.data.selectedIds.length + ' 张照片，保留各自的 EXIF 参数。', confirmText: '应用' })
    if (!response.confirm) return
    core.applyPhotoStyle(this.photos, this.currentPhoto(), this.data.selectedIds)
    this.setData({ selectionOpen: false })
    this.refreshPhoto(); this.requestPreview()
    wx.showToast({ title: '已应用到选中照片', icon: 'success' })
  },
  previewImage() { if (this.data.preview) wx.previewImage({ urls: [this.data.preview] }) },
  cancelExport() { this.cancelled = true; this.setData({ progress: '当前照片完成后停止' }) },
  async savePhotos(event) {
    if (this.data.exporting || this.data.importing || !this.canvas) return
    const all = !!event.currentTarget.dataset.all
    const selected = all ? this.photos.filter(core.isPhotoProcessed) : [this.currentPhoto()]
    const skipped = all ? this.photos.length - selected.length : 0
    if (!selected.length) { this.setData({ error: '没有已处理的照片可以导出。' }); return }
    const photos = selected.map(photo => clone(core.withBrandLogos(photo, getApp().globalData.customLogos)))
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
      if (!this.unloaded) this.setData({ notice: this.cancelled ? `已停止，已保存 ${saved} 张照片。` : `已保存 ${saved} 张照片到相册。${skipped ? '跳过 ' + skipped + ' 张未处理照片。' : ''}`, progress: '' })
    } catch (error) {
      if (!this.unloaded) {
        const permission = /auth|denied|permission/i.test(error.errMsg || '')
        this.setData({ error: permission ? '需要相册写入权限，请点击下方按钮开启后重新保存。' : `导出中断，已保存 ${saved} 张。${error.message || '请检查剩余存储空间并重试。'}`, needsPermission: permission, progress: '' })
      }
    } finally { if (!this.unloaded) this.setData({ exporting: false }) }
  },
  async exportFile(event) {
    if (this.data.exporting || this.data.importing || !this.canvas) return
    const all = !!event.currentTarget.dataset.all
    const selected = all ? this.photos.filter(core.isPhotoProcessed) : [this.currentPhoto()]
    const photos = selected.map(photo => clone(core.withBrandLogos(photo, getApp().globalData.customLogos)))
    const skipped = all ? this.photos.length - selected.length : 0
    this.cancelled = false
    clearTimeout(this.previewTimer)
    this.renderVersion++
    this.setData({ exporting: true, rendering: false, error: '', notice: '', progress: '正在生成文件…' })
    try {
      photos.forEach(photo => core.validateConfig(photo.config))
      const result = await core.exportFiles(photos, this.canvas, this.data.settings, (current, total, packing) => {
        if (!this.unloaded) this.setData({ progress: packing ? '正在打包 ZIP…' : '正在处理 ' + (current + 1) + ' / ' + total })
      }, () => this.cancelled || this.unloaded)
      if (this.unloaded) return
      this.setData({ lastExport: result.lastImage, lastFileExport: result, progress: '' })
      this.setData({ notice: '已生成 ' + result.count + ' 张照片的导出文件，请点击下方按钮转发文件。' + (skipped ? '跳过 ' + skipped + ' 张未处理照片。' : '') })
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) console.error('[FrameSign] File export failed:', error.errMsg || error.message || String(error))
      if (!this.unloaded) this.setData({ error: /cancel/i.test(error.errMsg || '') ? '' : error.message || '文件导出失败，请更新微信或选择保存到相册。' })
    } finally { if (!this.unloaded) this.setData({ exporting: false, progress: '' }) }
  },
  async shareExportFile() {
    if (this.data.exporting || !this.data.lastFileExport) return
    const result = this.data.lastFileExport
    const pending = core.api('shareFileMessage', { filePath: result.path, fileName: result.fileName })
    this.setData({ exporting: true, progress: '正在打开文件界面…', error: '' })
    try {
      await pending
      if (!this.unloaded) this.setData({ notice: '已打开导出文件的微信转发界面。' })
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) console.warn('[FrameSign] Native file handoff failed:', error.errMsg || error.message || String(error))
      if (!this.unloaded && !/cancel/i.test(error.errMsg || '')) this.setData({ error: '无法打开文件转发，请重新点击转发按钮，或更新微信后重试。' })
    } finally { if (!this.unloaded) this.setData({ exporting: false, progress: '' }) }
  },
  async clearPhotos() {
    if (this.data.exporting || this.data.importing) return
    const response = await core.api('showModal', { title: '结束本次编辑', content: '移出全部照片及本次样式设置，原始照片和已保存的签名不受影响。', confirmText: '移出' })
    if (!response.confirm) return
    getApp().globalData.photos = []
    getApp().globalData.customLogos = new Map()
    wx.navigateBack()
  },
  permissionChanged() { this.setData({ needsPermission: false, error: '' }) },
  detectExport() {
    if (!this.data.lastExport) return
    getApp().globalData.detectPath = this.data.lastExport.path
    wx.navigateTo({ url: '/pages/detect/index?exported=1' })
  }
})
