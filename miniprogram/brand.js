const STORAGE = { preferences: 'yingqian-preferences-v1', signature: 'yingqian-signature-v1' }
const LEGACY_STORAGE = { preferences: 'photix-preferences-v1', signature: 'photix-signature-v1' }

function readStoredSetting(name) {
  const value = wx.getStorageSync(STORAGE[name])
  if (value !== '' && value !== undefined) return value
  const legacy = wx.getStorageSync(LEGACY_STORAGE[name])
  if (legacy && typeof legacy === 'object') {
    wx.setStorageSync(STORAGE[name], legacy)
    return legacy
  }
}

function isManagedSignature(filePath) {
  const directory = `${wx.env.USER_DATA_PATH}/`
  return typeof filePath === 'string' && filePath.startsWith(directory) && /^(yingqian|photix)-signature-\d+-\d+\.png$/.test(filePath.slice(directory.length))
}

module.exports = { STORAGE, readStoredSetting, isManagedSignature }
