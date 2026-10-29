const { readStoredSetting, isManagedSignature } = require('./brand')

App({
  globalData: { photos: [], nextPhotoId: 1, templateId: 'standard1' },
  onLaunch() {
    const saved = readStoredSetting('preferences')
    if (saved && typeof saved === 'object') this.globalData.preferences = saved
    const signature = readStoredSetting('signature')
    if (signature && isManagedSignature(signature.dataUrl)) {
      try {
        wx.getFileSystemManager().accessSync(signature.dataUrl)
        this.globalData.signature = signature
      } catch { this.globalData.signature = undefined }
    }
  }
})
