// diamondcoreprocessor.com/input/bee-toggle.ts
import { EffectBus } from '@hypercomb/core'

let beesVisible = localStorage.getItem('hc:bees-visible') === 'true'

// toggle on keymap command (Ctrl+Shift+B)
EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'render.toggleBees') return

  beesVisible = !beesVisible
  localStorage.setItem('hc:bees-visible', String(beesVisible))
  EffectBus.emit('render:set-bees-visible', { visible: beesVisible })
})

// emit initial state so late subscribers (avatar-swarm drone) pick it up
EffectBus.emit('render:set-bees-visible', { visible: beesVisible })
