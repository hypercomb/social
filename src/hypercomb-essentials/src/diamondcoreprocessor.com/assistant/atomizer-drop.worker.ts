// diamondcoreprocessor.com/assistant/atomizer-drop.worker.ts
//
// Handles drag-and-drop of atomizers onto target controls.
// When an atomizer drag starts, this worker highlights valid drop targets.
// On drop, it resolves the atomizer and target, discovers properties,
// and emits the result for the property sidebar to display.

import { Bee, BeeState, EffectBus } from '@hypercomb/core'
import type { Atomizer, AtomizableTarget, AtomizerProperty } from '@hypercomb/core'
import { ATOMIZER_IOC_PREFIX, ATOMIZABLE_TARGET_PREFIX } from '@hypercomb/core'

const get = (key: string) => (globalThis as any).ioc?.get(key)
const ioc = () => (globalThis as any).ioc

/** CSS class applied to valid drop targets during drag */
const HIGHLIGHT_CLASS = 'atomizer-drop-target'
const HOVER_CLASS = 'atomizer-drop-hover'

export class AtomizerDropWorker extends Bee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'Manages atomizer drag-and-drop onto controls'

  protected override listens = ['atomizer:drag-start', 'atomizer:drag-end']
  protected override emits = ['atomizer:dropped', 'atomizer:properties']

  #activeDrag: { atomizerId: string; targetTypes: readonly string[] } | null = null
  #highlightedElements: Element[] = []
  #dropHandlers = new Map<Element, { dragover: EventListener; dragleave: EventListener; drop: EventListener }>()

  public async pulse(): Promise<void> {
    // Worker — no-op pulse
  }

  constructor() {
    super()

    this.onEffect<{ atomizerId: string; targetTypes: readonly string[] }>(
      'atomizer:drag-start',
      (payload) => this.#onDragStart(payload),
    )

    this.onEffect('atomizer:drag-end', () => this.#onDragEnd())
  }

  #onDragStart(payload: { atomizerId: string; targetTypes: readonly string[] }): void {
    this.#activeDrag = payload

    // Find all registered atomizable targets that match the drag's target types
    const container = ioc()
    if (!container) return

    // Query all registered targets
    const targets = this.#findMatchingTargets(payload.targetTypes)

    for (const target of targets) {
      const el = target.element

      // Add highlight class
      el.classList.add(HIGHLIGHT_CLASS)
      this.#highlightedElements.push(el)

      // Attach drop zone handlers
      const dragover: EventListener = (e: Event) => {
        const de = e as DragEvent
        de.preventDefault()
        if (de.dataTransfer) de.dataTransfer.dropEffect = 'copy'
        el.classList.add(HOVER_CLASS)
      }
      const dragleave: EventListener = () => {
        el.classList.remove(HOVER_CLASS)
      }
      const drop: EventListener = (e: Event) => {
        const de = e as DragEvent
        de.preventDefault()
        el.classList.remove(HOVER_CLASS)
        this.#onDrop(de, target)
      }

      el.addEventListener('dragover', dragover)
      el.addEventListener('dragleave', dragleave)
      el.addEventListener('drop', drop)
      this.#dropHandlers.set(el, { dragover, dragleave, drop })
    }
  }

  #onDragEnd(): void {
    // Remove all highlights and handlers
    for (const el of this.#highlightedElements) {
      el.classList.remove(HIGHLIGHT_CLASS)
      el.classList.remove(HOVER_CLASS)
      const handlers = this.#dropHandlers.get(el)
      if (handlers) {
        el.removeEventListener('dragover', handlers.dragover)
        el.removeEventListener('dragleave', handlers.dragleave)
        el.removeEventListener('drop', handlers.drop)
      }
    }
    this.#highlightedElements = []
    this.#dropHandlers.clear()
    this.#activeDrag = null
  }

  #onDrop(event: DragEvent, target: AtomizableTarget): void {
    const atomizerId = event.dataTransfer?.getData('application/x-atomizer-id')
    if (!atomizerId) return

    const atomizer = get(`${ATOMIZER_IOC_PREFIX}${atomizerId}`) as Atomizer | undefined
    if (!atomizer) {
      console.warn(`[atomizer-drop] Atomizer not found: ${atomizerId}`)
      return
    }

    // Discover properties
    const properties = atomizer.discover(target)

    // Emit results
    EffectBus.emit('atomizer:dropped', { atomizer })
    EffectBus.emit('atomizer:properties', {
      atomizer,
      target,
      properties,
    })

    console.log(`[atomizer-drop] ${atomizer.name} → ${target.targetId} (${properties.length} properties)`)
  }

  #findMatchingTargets(targetTypes: readonly string[]): AtomizableTarget[] {
    const targets: AtomizableTarget[] = []
    const container = ioc()
    if (!container?.list) return targets

    // Scan all IoC keys that start with the atomizable target prefix
    const keys = container.list() as readonly string[]
    for (const key of keys) {
      if (!key.startsWith(ATOMIZABLE_TARGET_PREFIX)) continue
      const target = container.get(key) as AtomizableTarget | undefined
      if (target && targetTypes.includes(target.targetType)) {
        targets.push(target)
      }
    }
    return targets
  }
}

const _worker = new AtomizerDropWorker()
window.ioc.register('@diamondcoreprocessor.com/AtomizerDropWorker', _worker)
console.log('[AtomizerDropWorker] Loaded')
