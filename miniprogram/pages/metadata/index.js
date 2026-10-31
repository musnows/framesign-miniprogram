const core = require('../../lib/core')

Page({
  data: { loading: true, error: '', query: '', rows: [], total: 0, matching: 0, page: 0, pages: 1, name: '', embeddedCount: 0, fileInfoCount: 0, metadataWarning: '' },
  onLoad(options) {
    this.photo = getApp().globalData.photos.find(photo => String(photo.id) === options.id)
    this.unloaded = false
    this.load()
  },
  onUnload() { this.unloaded = true },
  async load() {
    if (!this.photo) { this.setData({ loading: false, error: '照片已移出，请返回编辑器重新选择。' }); return }
    this.setData({ loading: true, error: '', name: this.photo.name })
    try {
      this.rows = await core.readPhotoMetadata(this.photo)
      const embeddedCount = this.rows.filter(row => !row.key.startsWith('File.')).length
      if (!this.unloaded) this.setData({ ...core.metadataPage(this.rows, this.data.query), embeddedCount, fileInfoCount: this.rows.length - embeddedCount, metadataWarning: this.photo.metadataWarning || '', loading: false })
    } catch (error) { if (!this.unloaded) this.setData({ loading: false, error: '读取完整元数据失败：' + (error.message || '请重试') }) }
  },
  search(event) {
    const query = event.detail.value
    this.setData({ query, ...core.metadataPage(this.rows || [], query) })
  },
  changePage(event) { this.setData(core.metadataPage(this.rows || [], this.data.query, this.data.page + Number(event.currentTarget.dataset.delta))) }
})
