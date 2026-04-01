// diamondcoreprocessor.com/assistant/structure.atomizer.ts
//
// Structure Atomizer — targets structure cells (install tree nodes).
// When dropped on a structure cell, opens DCP in a new tab focused on
// that node's lineage for AI-assisted editing. No property sidebar —
// the drop itself is the action.

import { EffectBus } from '@hypercomb/core'
import type { Atomizer, AtomizableTarget, AtomizerProperty } from '@hypercomb/core'
import { ATOMIZER_IOC_PREFIX } from '@hypercomb/core'

const STRUCTURE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/></svg>'

const PROPS_FILE = '0000'

export class StructureAtomizer implements Atomizer {
  readonly atomizerId = 'structure-atomizer'
  readonly name = 'Structure'
  readonly description = 'Open a program node in DCP for editing'
  readonly icon = STRUCTURE_ICON
  readonly targetTypes = ['structure-cell'] as const

  discover(target: AtomizableTarget): AtomizerProperty[] {
    // No property sidebar — the drop triggers navigation to DCP
    this.#openInDcp(target)
    return []
  }

  apply(): void {
    // No-op — structure atomizer navigates, it doesn't edit properties
  }

  reset(): void {
    // No-op
  }

  #openInDcp(target: AtomizableTarget): void {
    const props = (target as any).structureProps as Record<string, unknown> | undefined
    if (!props) {
      console.warn('[StructureAtomizer] No structure properties on target:', target.targetId)
      return
    }

    const lineage = String(props.lineage ?? '')
    const signature = String(props.signature ?? '')
    const kind = String(props.kind ?? '')

    if (!lineage) {
      console.warn('[StructureAtomizer] Missing lineage for target:', target.targetId)
      return
    }

    const dcpOrigin = location.hostname === 'localhost'
      ? 'http://localhost:2400'
      : 'https://diamondcoreprocessor.com'

    const params = new URLSearchParams()
    params.set('navigate', lineage)
    if (signature) params.set('signature', signature)
    if (kind) params.set('kind', kind)

    const url = `${dcpOrigin}?${params.toString()}`
    window.open(url, '_blank')

    EffectBus.emit('dcp:navigate', { lineage, signature, kind })
    console.log(`[StructureAtomizer] Opening DCP: ${lineage} (${kind})`)
  }
}

// Self-register
const _structureAtomizer = new StructureAtomizer()
window.ioc.register(`${ATOMIZER_IOC_PREFIX}structure-atomizer`, _structureAtomizer)

// Announce registration so the toolbar picks it up
EffectBus.emit('atomizer:registered', { atomizer: _structureAtomizer })
console.log('[StructureAtomizer] Loaded')
