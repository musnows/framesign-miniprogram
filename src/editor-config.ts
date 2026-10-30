import type { TemplateConfig } from './shared/lib/templates/types'

const fields: [keyof TemplateConfig['userOptions'], string, string, 'color' | 'range' | 'toggle', number?, number?, number?, number?, string?][] = [
  ['colors', 'textColor', '文字颜色', 'color'],
  ['colors', 'secondaryTextColor', '辅助文字颜色', 'color'],
  ['colors', 'nikonZColor', 'Z 标识颜色', 'color'],
  ['background', 'backgroundColor', '背景颜色', 'color'],
  ['layout', 'padding', '内边距', 'range', 0, 80, 1, 1000],
  ['layout', 'imageMargin', '主图边距', 'range', 40, 220, 1, 1000],
  ['border', 'showBorder', '显示边框', 'toggle'],
  ['border', 'borderColor', '边框颜色', 'color'],
  ['border', 'borderRadius', '圆角', 'range', 0, 50, 1, 1000],
  ['shadow', 'shadowEnabled', '显示阴影', 'toggle'],
  ['shadow', 'shadowColor', '阴影颜色', 'color'],
  ['shadow', 'shadowRadius', '阴影强度', 'range', 0, 50, 1, 1000],
  ['blur', 'blurRadius', '模糊强度', 'range', 0, 120, 1, 1000],
  ['blur', 'vignetteEnabled', '背景暗角', 'toggle'],
  ['blur', 'vignetteStrength', '暗角幅度', 'range', 0, 100, 1, 100],
  ['typography', 'watermarkScale', '纵向字号', 'range', 80, 100, 1, 100, 'portraitScale'],
  ['personalText', 'textMargin', '个性文字边距', 'range', 0, 120, 1, 1000, 'margin'],
  ['personalText', 'textFontSize', '个性文字大小', 'range', 9, 50, 1, 1000, 'fontSize'],
  ['personalText', 'textOpacity', '个性文字透明度', 'range', 0, 100, 1, 100, 'opacity']
]

export function configurationControls(template: TemplateConfig, config: Record<string, any>) {
  return fields.filter(([group, key, , , , , , , option]) => {
    const options = template.userOptions[group] as Record<string, any> | undefined
    return options && Object.prototype.hasOwnProperty.call(options, option || key)
  }).map(([group, key, label, type, min, max, step, scale]) => ({
    group, key, label, type, min: min || 0, max: max || 0, step: step || 1, scale: scale || 1,
    value: type === 'range' ? Math.round(Number(config[key]) * (scale || 1)) : config[key],
    display: type === 'range' ? `${Number((Number(config[key]) * 100).toFixed(1))}%` : '',
    disabled: key === 'vignetteStrength' && !config.vignetteEnabled
  }))
}
