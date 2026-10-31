type DeviceBrand = { id: string; label: string; make: string; kind: 'camera' | 'phone'; models: string[]; aliases: string[] }

const camera = (id: string, name: string, make: string, models: string[], aliases: string[] = []): DeviceBrand => ({ id, label: `${name} · ${make}`, make, models, aliases: [name, ...aliases], kind: 'camera' })
const phone = (id: string, name: string, make: string, models: string[] = []): DeviceBrand => ({ id, label: `${name} · ${make}`, make, models, aliases: [name], kind: 'phone' })

export const DEVICE_CATALOG: DeviceBrand[] = [
  camera('nikon', '尼康', 'NIKON', ['Zf', 'Z6III', 'Z8', 'Z5II', 'Z50II', 'Zfc', 'Z9', 'Z7II', 'Z6II', 'Z5', 'Z50', 'Z30', 'Z7', 'Z6', 'D850', 'D780', 'D750', 'D810', 'D500', 'D7500', 'D7200', 'D5600', 'D3500'], ['NIKON CORPORATION']),
  camera('fujifilm', '富士', 'FUJIFILM', ['X-T30 III', 'X-T5', 'X100VI', 'X-S20', 'X-T50', 'X-E5', 'X-H2', 'X-H2S', 'X-T4', 'X-T3', 'X-T30 II', 'X-T30', 'X-T20', 'X-S10', 'X-E4', 'X-E3', 'X-Pro3', 'X-Pro2', 'X100V', 'X100F', 'GFX100 II', 'GFX100S II', 'GFX100RF', 'GFX100S', 'GFX50S II'], ['FUJI']),
  camera('canon', '佳能', 'Canon', ['EOS R5 Mark II', 'EOS R6 Mark III', 'EOS R6 Mark II', 'EOS R8', 'EOS R50', 'EOS R10', 'EOS R1', 'EOS R3', 'EOS R5', 'EOS R6', 'EOS R7', 'EOS RP', 'EOS R', 'EOS R100', 'EOS R50 V', 'EOS 5D Mark IV', 'EOS 6D Mark II', 'EOS 90D', 'EOS 80D', 'EOS M50 Mark II', 'PowerShot G7 X Mark III', 'PowerShot V1']),
  camera('sony', '索尼', 'SONY', ['α7 V', 'α7 IV', 'α7C II', 'α7R V', 'α6700', 'ZV-E10 II', 'α7 III', 'α7C', 'α7CR', 'α7R IV', 'α7S III', 'α1 II', 'α1', 'α9 III', 'α6400', 'α6600', 'α6100', 'ZV-E10', 'ZV-1 II', 'RX100 VII']),
  camera('panasonic', '松下', 'Panasonic', ['LUMIX S5II', 'LUMIX S5IIX', 'LUMIX S9', 'LUMIX G9II', 'LUMIX GH7', 'LUMIX S1II', 'LUMIX S1RII', 'LUMIX S5', 'LUMIX GH6', 'LUMIX GH5 II', 'LUMIX G9', 'LUMIX GX9', 'LUMIX LX100 II']),
  camera('olympus', '奥林巴斯 / OM SYSTEM', 'OLYMPUS', ['OM-1 Mark II', 'OM-1', 'OM-3', 'OM-5', 'E-M1 Mark III', 'E-M5 Mark III', 'E-M10 Mark IV', 'PEN E-P7', 'PEN-F'], ['OM Digital Solutions', 'OM SYSTEM', 'OLYMPUS CORPORATION']),
  camera('ricoh', '理光', 'RICOH', ['GR IV', 'GR IIIx', 'GR III', 'GR III HDF', 'GR IIIx HDF', 'GR II', 'GR']),
  camera('pentax', '宾得', 'PENTAX', ['K-1 Mark II', 'K-3 Mark III', 'K-3 Mark III Monochrome', 'KF', 'K-70', 'K-1', 'K-3 II', '645Z']),
  camera('leica', '徕卡', 'LEICA', ['Q3', 'Q3 43', 'SL3', 'SL3-S', 'M11', 'M11-P', 'Q2', 'SL2', 'SL2-S', 'M10', 'M10-R', 'D-Lux 8', 'D-Lux 7']),
  camera('hasselblad', '哈苏', 'HASSELBLAD', ['X2D II 100C', 'X2D 100C', '907X & CFV 100C', 'X1D II 50C', 'X1D-50c', '907X 50C', 'H6D-100c', 'H6D-50c']),
  camera('dji', '大疆', 'DJI', ['Osmo Pocket 3', 'Osmo Action 5 Pro', 'Osmo Action 4', 'Mini 4 Pro', 'Air 3S', 'Mavic 4 Pro', 'Mini 3 Pro', 'Air 3', 'Mavic 3 Pro']),
  phone('apple', '苹果', 'Apple', ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone Air', 'iPhone 17e', 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 15 Plus', 'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini', 'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12', 'iPhone 12 mini', 'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone XS Max', 'iPhone XS', 'iPhone XR', 'iPhone X', 'iPhone SE (第 3 代)', 'iPhone SE (第 2 代)']),
  phone('vivo', '手机', 'vivo'),
  phone('huawei', '华为', 'HUAWEI'),
  phone('xiaomi', '小米', 'Xiaomi'),
  phone('oppo', '手机', 'OPPO'),
  phone('honor', '荣耀', 'HONOR'),
  phone('samsung', '三星', 'SAMSUNG'),
  phone('oneplus', '一加', 'OnePlus'),
  phone('google', '谷歌', 'Google'),
  phone('realme', '真我', 'realme'),
  phone('meizu', '魅族', 'Meizu')
]

const text = (value: unknown) => value === undefined || value === null ? '' : String(value).trim()
const normalized = (value: unknown) => text(value).toUpperCase().replace(/[\s._-]/g, '')
const byId = (id: string) => DEVICE_CATALOG.find(brand => brand.id === id)
const byMake = (make: unknown) => DEVICE_CATALOG.find(brand => [brand.make, ...brand.aliases].some(alias => normalized(alias) === normalized(make)))
const phoneBrandOnly = (brand: DeviceBrand | undefined) => brand?.kind === 'phone' && brand.id !== 'apple'

export const DEVICE_BRANDS = [{ id: '', label: '请选择品牌', make: '' }, ...DEVICE_CATALOG.map(({ id, label, make }) => ({ id, label, make }))]
export const COMMON_DEVICE_BRANDS = ['nikon', 'fujifilm', 'canon', 'sony', 'apple', 'vivo'].map(id => DEVICE_BRANDS.find(brand => brand.id === id)!)

export function photoExif(photo: any): Record<string, any> {
  const brand = byId(photo.cameraSelection?.brandId)
  const selected = brand ? { Make: brand.make, Model: phoneBrandOnly(brand) ? '' : photo.cameraSelection.model } : {}
  const exif = { ...photo.exif, ...selected, ...photo.overrides }
  if (brand && phoneBrandOnly(brand) && byMake(exif.Make)?.id === brand.id) exif.Model = ''
  return exif
}

export function deviceSelectionState(photo: any) {
  const exif = photoExif(photo)
  const brand = byMake(exif.Make)
  const selected = byId(photo.cameraSelection?.brandId)
  const hasDeviceSelection = !!selected && brand?.id === selected.id
  const modelOptional = phoneBrandOnly(brand) || (hasDeviceSelection && photo.cameraSelection.brandOnly)
  return {
    needsDeviceSelection: !text(exif.Make) || (!modelOptional && !text(exif.Model)),
    hasDeviceSelection,
    deviceModelHidden: hasDeviceSelection && phoneBrandOnly(brand),
    deviceSelectionSummary: [brand?.label || text(exif.Make), text(exif.Model)].filter(Boolean).join(' · ')
  }
}

export function devicePickerDraft(photo: any, id?: string) {
  const exif = photoExif(photo)
  const originalBrand = byMake(exif.Make)
  const brand = byId(id === undefined ? originalBrand?.id || '' : id)
  const currentModel = brand && originalBrand?.id === brand.id && !phoneBrandOnly(brand) ? text(exif.Model) : ''
  const models = brand?.models.map(value => ({ label: value, value })) || []
  if (currentModel && !models.some(model => normalized(model.value) === normalized(currentModel))) models.unshift({ label: `已读取：${currentModel}`, value: currentModel })
  const modelOptions = [{ label: '请选择型号', value: '' }, ...models]
  return {
    deviceBrandId: brand?.id || '', deviceBrandIndex: Math.max(0, DEVICE_BRANDS.findIndex(item => item.id === brand?.id)),
    deviceModelOptions: modelOptions, deviceModelIndex: Math.max(0, modelOptions.findIndex(model => normalized(model.value) === normalized(currentModel))),
    deviceCommonModels: models.slice(0, 6), devicePhoneBrandOnly: phoneBrandOnly(brand)
  }
}

export function selectPhotoDevice(photo: any, id: string, model = '', brandOnly = false): boolean {
  const brand = byId(id)
  if (!brand) return false
  if (phoneBrandOnly(brand)) { model = ''; brandOnly = true }
  else if (!brandOnly && (!model || !devicePickerDraft(photo, id).deviceModelOptions.some(option => option.value === model))) return false
  if (brandOnly) model = ''
  const overrides = { ...photo.overrides }
  delete overrides.Make
  delete overrides.Model
  photo.overrides = overrides
  photo.cameraSelection = { brandId: id, model, brandOnly }
  return true
}
