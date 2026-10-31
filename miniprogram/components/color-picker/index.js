const { parseColor, formatColor } = require('./color')

Component({
  properties: {
    value: { type: String, value: '#000000' },
    label: { type: String, value: '颜色' },
    allowAlpha: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false }
  },
  data: {
    expanded: false, inputValue: '#000000', preview: '#000000', channels: [], opacity: 100, showAlpha: false, error: '',
    swatches: ['#242424', '#FFFFFF', '#9B7632', '#EF4444', '#3B82F6', '#10B981']
  },
  observers: {
    'value, allowAlpha': function(value) {
      const color = parseColor(value)
      if (color) this.updateColor(color)
    }
  },
  lifetimes: {
    attached() { this.updateColor(parseColor(this.properties.value) || { r: 0, g: 0, b: 0, a: 1 }) }
  },
  methods: {
    updateColor(color, emit = false) {
      const value = formatColor(color)
      this.color = parseColor(value)
      this.setData({
        inputValue: value, preview: value, error: '', opacity: Math.round(this.color.a * 100), showAlpha: this.properties.allowAlpha || this.color.a < 1,
        channels: ['r', 'g', 'b'].map(key => ({ key, label: key.toUpperCase(), value: this.color[key], color: { r: '#C15B4A', g: '#6A8D56', b: '#577FBA' }[key] }))
      })
      if (emit && value !== this.properties.value) this.triggerEvent('change', { value })
    },
    toggle() {
      if (!this.properties.disabled) this.setData({ expanded: !this.data.expanded })
    },
    commitInput(event) {
      if (this.properties.disabled) return
      const color = parseColor(event.detail.value)
      if (!color) { this.setData({ error: '请输入有效的 HEX、RGB 或 RGBA 颜色值' }); return }
      this.updateColor(color, true)
    },
    editChannel(event, emit) {
      if (this.properties.disabled) return
      const key = event.currentTarget.dataset.channel
      if (!['r', 'g', 'b', 'a'].includes(key)) return
      const raw = String(event.detail.value).trim()
      if (!raw || !Number.isFinite(Number(raw))) { this.updateColor(this.color); return }
      this.updateColor({ ...this.color, [key]: key === 'a' ? Number(raw) / 100 : Number(raw) }, emit)
    },
    previewChannel(event) { this.editChannel(event, false) },
    changeChannel(event) { this.editChannel(event, true) },
    selectSwatch(event) {
      if (this.properties.disabled) return
      this.updateColor({ ...parseColor(event.currentTarget.dataset.color), a: this.color.a }, true)
    }
  }
})
