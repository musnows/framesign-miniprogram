export type SignatureAnchor = 'camera' | 'params'

interface SignatureProcessor {
  processor_name: string
  auto_camera?: boolean
}

export function getDefaultSignatureAnchor(processors: SignatureProcessor[] | { landscape: SignatureProcessor[]; portrait: SignatureProcessor[]; square?: SignatureProcessor[] }): SignatureAnchor {
  const steps = Array.isArray(processors) ? processors : [...processors.landscape, ...processors.portrait, ...(processors.square || [])]
  return steps.some(step => step.auto_camera || step.processor_name === 'multi_rich_text') ? 'camera' : 'params'
}

export interface SignatureOptions {
  enabled: boolean
  dataUrl: string
  name: string
  aspectRatio: number
  position: 'template' | 'custom'
  anchor?: SignatureAnchor
  width: number
  x: number
  y: number
  mask: 'auto' | 'original' | 'custom'
  color: string
  opacity?: number
}

export const DEFAULT_SIGNATURE: SignatureOptions = {
  enabled: true,
  dataUrl: '',
  name: '',
  aspectRatio: 3,
  position: 'template',
  width: 0.16,
  x: 0.76,
  y: 0.86,
  mask: 'auto',
  color: '#FFFFFF',
  opacity: 1
}

export function clampSignatureOpacity(opacity?: number) {
  return typeof opacity === 'number' && Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1
}

export const MIN_SIGNATURE_WIDTH = 0.01
export const MAX_SIGNATURE_WIDTH = 1

export function clampSignatureWidth(width: number) {
  return Math.max(MIN_SIGNATURE_WIDTH, Math.min(MAX_SIGNATURE_WIDTH, Number.isFinite(width) ? width : DEFAULT_SIGNATURE.width))
}

export function setSignatureWidth(options: SignatureOptions, width: number): SignatureOptions {
  return { ...options, position: 'custom', width: clampSignatureWidth(width) }
}

export function draggedSignatureWidth(options: SignatureOptions, deltaX: number, deltaY: number, imageWidth: number, imageHeight: number) {
  const horizontal = deltaX / imageWidth
  const vertical = deltaY * options.aspectRatio / imageWidth
  const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical
  const maximum = Math.min(MAX_SIGNATURE_WIDTH, 1 - options.x, (1 - options.y) * imageHeight * options.aspectRatio / imageWidth)
  return Math.min(maximum, clampSignatureWidth(options.width + delta))
}

export function hasSignature(config?: Record<string, any>): boolean {
  return !!(config?.signature?.enabled && config.signature.dataUrl)
}

export function fitSignature(width: number, height: number, aspectRatio: number, requestedWidth: number) {
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const fittedWidth = Math.max(1, Math.min(width, height * aspect, requestedWidth))
  return { width: fittedWidth, height: fittedWidth / aspect }
}

export function signatureBounds(options: SignatureOptions, width: number, height: number) {
  const size = fitSignature(width, height, options.aspectRatio, width * clampSignatureWidth(options.width))
  return {
    ...size,
    x: Math.max(0, Math.min(width - size.width, options.x * width)),
    y: Math.max(0, Math.min(height - size.height, options.y * height))
  }
}
