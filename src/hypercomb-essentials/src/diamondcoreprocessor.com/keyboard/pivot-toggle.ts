// diamondcoreprocessor.com/input/pivot-toggle.ts
import { EffectBus } from '@hypercomb/core'

let pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'

// toggle on keymap command
EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'render.togglePivot') return

  pivotOn = !pivotOn
  localStorage.setItem('hc:hex-pivot', String(pivotOn))
  EffectBus.emit('render:set-pivot', { pivot: pivotOn })
})
