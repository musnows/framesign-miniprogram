import type { TemplateConfig } from './types'
import { DEFAULT_DATE_TIME_FORMAT, DEFAULT_CUSTOM_DATE_TIME_FORMAT } from '../editor/exif'

export function getTemplateDefaultConfig(template: TemplateConfig): Record<string, any> {
  return {
    hiddenWatermarkEnabled: template.userOptions.hiddenWatermark?.enabled ?? false,
    hiddenWatermarkText: template.userOptions.hiddenWatermark?.text ?? '映签',
    showBrand: template.userOptions.exifFields?.showBrand ?? true,
    showModel: template.userOptions.exifFields?.showModel ?? true,
    showLens: template.userOptions.exifFields?.showLens ?? true,
    showFocalLength: template.userOptions.exifFields?.showFocalLength ?? true,
    showAperture: template.userOptions.exifFields?.showAperture ?? true,
    showShutter: template.userOptions.exifFields?.showShutter ?? true,
    showISO: template.userOptions.exifFields?.showISO ?? true,
    showDateTime: template.userOptions.exifFields?.showDateTime ?? true,
    dateTimeFormat: DEFAULT_DATE_TIME_FORMAT,
    customDateTimeFormat: DEFAULT_CUSTOM_DATE_TIME_FORMAT,
    logoEnabled: template.userOptions.logo?.enabled ?? true,
    logoPosition: template.userOptions.logo?.position ?? 'left',
    textColor: template.userOptions.colors?.textColor ?? '#242424',
    secondaryTextColor: template.userOptions.colors?.secondaryTextColor ?? '#666666',
    nikonZColor: template.userOptions.colors?.nikonZColor ?? '#FFFFFF',
    nikonZScale: template.userOptions.nikonZ?.scale ?? 1,
    backgroundColor: template.userOptions.background?.backgroundColor ?? '#FFFFFF',
    padding: template.userOptions.layout?.padding ?? 0.03,
    imageMargin: template.userOptions.layout?.imageMargin ?? 0.12,
    showBorder: template.userOptions.border?.showBorder ?? true,
    borderColor: template.userOptions.border?.borderColor ?? '#E5E5E5',
    borderRadius: template.userOptions.border?.borderRadius ?? 0.01,
    shadowEnabled: template.userOptions.shadow?.shadowEnabled ?? true,
    shadowColor: template.userOptions.shadow?.shadowColor ?? 'rgba(0,0,0,0.15)',
    shadowRadius: template.userOptions.shadow?.shadowRadius ?? 0.015,
    blurRadius: template.userOptions.blur?.blurRadius ?? 0.03,
    vignetteEnabled: template.userOptions.blur?.vignetteEnabled ?? true,
    vignetteStrength: template.userOptions.blur?.vignetteStrength ?? 0.3,
    personalText: template.userOptions.personalText?.text ?? 'photographed by leoon '.toUpperCase(),
    textMargin: template.userOptions.personalText?.margin ?? 0.04,
    textFontSize: template.userOptions.personalText?.fontSize ?? 0.045,
    textOpacity: template.userOptions.personalText?.opacity ?? 0.9,
    textPosition: template.userOptions.personalText?.position ?? 'bottom-center',
    watermarkScale: template.userOptions.typography?.portraitScale ?? 1
  }
}
