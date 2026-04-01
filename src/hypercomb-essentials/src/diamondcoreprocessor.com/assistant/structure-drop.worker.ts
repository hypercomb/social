// diamondcoreprocessor.com/assistant/structure-drop.worker.ts
//
// Bridges the structure view with the atomizer drag-drop system.
// When the explorer is inside __structure__/, this worker registers
// the PixiJS canvas as an AtomizableTarget so the structure atomizer
// can be dropped onto hex cells. On drop, it resolves the hovered cell
// and passes its structure properties to the atomizer.

import { Bee, EffectBus } from '@hypercomb/core'
import { ATOMIZABLE_TARGET_PREFIX } from '@hypercomb/core'

const get = (key: string) => (globalThis as any).ioc?.get(key)

const STRUCTURE_PREFIX = '__structure__'
const PROPS_FILE = '0000'
const TARGET_KEY = `${ATOMIZABLE_TARGET_PREFIX}structure:canvas`

type Axial = { q: number; r: number }

export class StructureDropWorker extends Bee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'Registers structure cells as atomizer drop targets'

  protected override listens = ['render:host-ready', 'drop:target']
  protected override emits: string[] = []

  #canvas: HTMLCanvasElement | null = null
  #registered = false
  #currentLabel: string | null = null
  #structureProps: Record<string, unknown> | null = null

  public async pulse(): Promise<void> {
    // Worker — no-op pulse
  }

  constructor() {
    super()

    this.onEffect<{ app: any; container: any; canvas: HTMLCanvasElement }>(
      'render:host-ready',
      ({ canvas }) => {
        this.#canvas = canvas
        this.#checkRegistration()
      },
    )

    // Track the currently-hovered cell during drag
    this.onEffect<{ q: number; r: number; occupied: boolean; label: string | null; index: number }>(
      'drop:target',
      ({ label }) => {
        if (label && label !== this.#currentLabel) {
          this.#currentLabel = label
          this.#loadStructureProps(label)
        }
      },
    )

    // Re-check registration when navigation changes
    EffectBus.on('tile:navigate-in', () => this.#checkRegistration())
    EffectBus.on('tile:navigate-back', () => this.#checkRegistration())
  }

  #isInStructureMode(): boolean {
    const lineage = get('@hypercomb.social/Lineage') as any
    if (!lineage) return false
    const segments = lineage.explorerSegments?.() ?? lineage.explorerPath ?? []
    return segments.length > 0 && segments[0] === STRUCTURE_PREFIX
  }

  #checkRegistration(): void {
    const ioc = (globalThis as any).ioc
    if (!ioc || !this.#canvas) return

    if (this.#isInStructureMode()) {
      if (!this.#registered) {
        ioc.register(TARGET_KEY, {
          targetType: 'structure-cell',
          targetId: 'structure:canvas',
          element: this.#canvas,
          tileLabel: undefined,
          get structureProps() {
            return workerRef.#structureProps
          },
        })
        this.#registered = true
      }
    } else {
      if (this.#registered) {
        try { ioc.unregister?.(TARGET_KEY) } catch { /* ignore */ }
        this.#registered = false
        this.#structureProps = null
        this.#currentLabel = null
      }
    }
  }

  async #loadStructureProps(label: string): Promise<void> {
    try {
      const lineage = get('@hypercomb.social/Lineage') as any
      const dir = await lineage?.explorerDir?.()
      if (!dir) return

      const cellDir = await dir.getDirectoryHandle(label, { create: false })
      const handle = await cellDir.getFileHandle(PROPS_FILE)
      const file = await handle.getFile()
      this.#structureProps = JSON.parse(await file.text())
    } catch {
      this.#structureProps = { lineage: label, kind: 'unknown', signature: '' }
    }
  }
}

// Capture `this` for the getter in the registered target
const workerRef = new StructureDropWorker()
window.ioc.register('@diamondcoreprocessor.com/StructureDropWorker', workerRef)
console.log('[StructureDropWorker] Loaded')
