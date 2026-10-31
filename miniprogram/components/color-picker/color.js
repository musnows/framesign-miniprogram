const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value))
const namedColors = { black: '#000000', white: '#ffffff', transparent: '#00000000' }
const number = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%?$/

function parseColor(value) {
  const input = String(value || '').trim().toLowerCase()
  const text = namedColors[input] || input
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)
  if (hex) {
    const digits = hex[1].length < 5 ? hex[1].split('').map(char => char + char).join('') : hex[1]
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1 }
  }
  const rgb = /^rgba?\(([^()]+)\)$/.exec(text)
  if (!rgb) return null
  const values = rgb[1].trim().split(/\s*[,/]\s*|\s+/)
  if (![3, 4].includes(values.length) || !values.every(value => number.test(value))) return null
  const channel = value => Math.round(clamp(value.endsWith('%') ? parseFloat(value) / 100 * 255 : parseFloat(value), 255))
  const alpha = values[3]
  return { r: channel(values[0]), g: channel(values[1]), b: channel(values[2]), a: alpha === undefined ? 1 : clamp(parseFloat(alpha) / (alpha.endsWith('%') ? 100 : 1), 1) }
}

function formatColor(color) {
  const values = ['r', 'g', 'b'].map(key => Math.round(clamp(color[key], 255)))
  const alpha = Number(clamp(color.a, 1).toFixed(3))
  return alpha === 1 ? '#' + values.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase() : `rgba(${values.join(', ')}, ${alpha})`
}

module.exports = { parseColor, formatColor }
