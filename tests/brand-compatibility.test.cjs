const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
async function miniProgramBrand(values, platform = {}) {
  const storage = new Map(Object.entries(values))
  const module = { exports: {} }
  vm.runInNewContext(await fs.readFile(path.resolve('miniprogram/brand.js'), 'utf8'), {
    module,
    wx: {
      env: { USER_DATA_PATH: 'wxfile://usr' },
      getStorageSync: key => storage.has(key) ? storage.get(key) : '',
      setStorageSync: (key, value) => storage.set(key, value),
      ...platform
    }
  })
  return { ...module.exports, storage }
}

test('mini-program settings migrate without removing the previous values', async () => {
  const previous = { settings: { maxSide: 1280, preserveExif: false } }
  const brand = await miniProgramBrand({ 'photix-preferences-v1': previous })
  assert.equal(brand.readStoredSetting('preferences'), previous)
  assert.equal(brand.storage.get('yingqian-preferences-v1'), previous)
  assert.equal(brand.storage.get('photix-preferences-v1'), previous)
})

test('new preferences and cleared signatures take precedence over legacy storage', async () => {
  const current = { settings: { maxSide: 2560 } }
  const brand = await miniProgramBrand({ 'yingqian-preferences-v1': current, 'photix-preferences-v1': { settings: { maxSide: 1280 } }, 'yingqian-signature-v1': null, 'photix-signature-v1': { dataUrl: 'wxfile://usr/photix-signature-123-1.png' } })
  assert.equal(brand.readStoredSetting('preferences'), current)
  assert.equal(brand.readStoredSetting('signature'), null)
})

test('saved signatures accept both managed filename generations and reject unrelated paths', async () => {
  const previous = { dataUrl: 'wxfile://usr/photix-signature-123-1.png', enabled: true }
  const brand = await miniProgramBrand({ 'photix-signature-v1': previous })
  assert.equal(brand.readStoredSetting('signature'), previous)
  assert.equal(brand.isManagedSignature(previous.dataUrl), true)
  assert.equal(brand.isManagedSignature('wxfile://usr/yingqian-signature-456-2.png'), true)
  assert.equal(brand.isManagedSignature('wxfile://usr/yingqian-signature-123-1.png/../outside.png'), false)
  assert.equal(brand.isManagedSignature('wxfile://elsewhere/yingqian-signature-456-2.png'), false)
})

test('the project link copies the public repository only after confirmation', async () => {
  let dialog
  const copied = []
  const brand = await miniProgramBrand({}, {
    showModal(options) { dialog = options },
    setClipboardData(options) { copied.push(options.data) }
  })
  brand.openProjectRepository()
  assert.equal(dialog.title, 'GitHub 项目')
  assert.equal(dialog.confirmText, '复制链接')
  assert.ok(dialog.content.includes('https://github.com/musnows/framesign-miniprogram'))
  assert.deepEqual(copied, [])
  dialog.success({ confirm: false, cancel: true })
  assert.deepEqual(copied, [])
  brand.openProjectRepository()
  dialog.success({ confirm: true, cancel: false })
  assert.deepEqual(copied, ['https://github.com/musnows/framesign-miniprogram'])
})

test('clipboard failure offers a retry without claiming the link was opened', async () => {
  let message
  const brand = await miniProgramBrand({}, {
    showModal(options) { options.success({ confirm: true }) },
    setClipboardData(options) { options.fail({ errMsg: 'setClipboardData:fail' }) },
    showToast(options) { message = options }
  })
  brand.openProjectRepository()
  assert.equal(message.title, '复制失败，请重试')
  assert.equal(message.icon, 'none')
})
