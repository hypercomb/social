// pivot-toggle.ts — handles the render.togglePivot keymap command.
//
// Persists pivot state in localStorage and emits render:set-pivot so
// ShowHoneycombWorker (and any future consumer) can react. Restores
// persisted state on load.

import { EffectBus } from '@hypercomb/core'

let pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'

// restore persisted pivot state on load
if (pivotOn) {
  EffectBus.emit('render:set-pivot', { pivot: true })
}

// toggle on keymap command
EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'render.togglePivot') return

  pivotOn = !pivotOn
  localStorage.setItem('hc:hex-pivot', String(pivotOn))
  EffectBus.emit('render:set-pivot', { pivot: pivotOn })
})
