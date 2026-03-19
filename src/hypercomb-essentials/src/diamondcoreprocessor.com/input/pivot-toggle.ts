// pivot-toggle.ts — handles the render.togglePivot keymap command.
//
// Persists pivot state in localStorage and emits render:set-pivot so
// ShowHoneycombWorker (and any future consumer) can react.
// Initial restore is handled by runtime-initializer.ts (after bees are loaded).

import { EffectBus } from '@hypercomb/core'

let pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'

// toggle on keymap command
EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'render.togglePivot') return

  pivotOn = !pivotOn
  localStorage.setItem('hc:hex-pivot', String(pivotOn))
  EffectBus.emit('render:set-pivot', { pivot: pivotOn })
})
