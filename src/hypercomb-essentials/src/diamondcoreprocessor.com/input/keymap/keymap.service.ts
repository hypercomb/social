// keymap.service.ts — layered keyboard shortcut engine
//
// Manages a priority-sorted stack of KeyMapLayers. Listens for keydown
// events, tracks multi-step chord sequences, and emits 'keymap:invoke'
// effects when a complete sequence matches.
//
// Isolation:
//   - Suppression gate: any drone can suppress/unsuppress via effects.
//     While suppressed, only pierce:true bindings fire.
//   - Layer stacking IS the mode system: entering a mode = adding a layer,
//     exiting = removing it. No separate mode tracking needed.
//   - Navigation guard bridge: auto-suppresses during layer transitions.
//   - Interactive focus: auto-suppresses when typing in inputs.

import { EffectBus, type KeyBinding, type KeyChord, type KeyMapLayer } from '@hypercomb/core'
import { globalKeyMap, defaultKeyMap } from './default-keymap.js'

const SEQUENCE_TIMEOUT_MS = 500

export class KeyMapService extends EventTarget {

  // -------------------------------------------------
  // layer stack (context isolation)
  // -------------------------------------------------

  #layers: KeyMapLayer[] = []
  #effectiveCache: KeyBinding[] | null = null

  addLayer(layer: KeyMapLayer): void {
    this.removeLayer(layer.id)
    this.#layers.push(layer)
    this.#layers.sort((a, b) => a.priority - b.priority)
    this.#effectiveCache = null
    this.#resetSequences()
    EffectBus.emit('keymap:changed', undefined)
  }

  removeLayer(id: string): void {
    const idx = this.#layers.findIndex(l => l.id === id)
    if (idx === -1) return
    this.#layers.splice(idx, 1)
    this.#effectiveCache = null
    this.#resetSequences()
    EffectBus.emit('keymap:changed', undefined)
  }

  getEffective(): KeyBinding[] {
    if (this.#effectiveCache) return this.#effectiveCache

    // flatten: highest priority wins per cmd
    const byCmd = new Map<string, KeyBinding>()
    for (const layer of this.#layers) {
      for (const b of layer.bindings) {
        byCmd.set(b.cmd, b)
      }
    }
    this.#effectiveCache = [...byCmd.values()]
    return this.#effectiveCache
  }

  // -------------------------------------------------
  // suppression gate (mode isolation)
  // -------------------------------------------------

  #suppressions = new Set<string>()

  get suppressed(): boolean { return this.#suppressions.size > 0 }

  suppress(reason: string): void {
    this.#suppressions.add(reason)
  }

  unsuppress(reason: string): void {
    this.#suppressions.delete(reason)
  }

  // -------------------------------------------------
  // sequence state (chord tracking)
  // -------------------------------------------------

  #sequenceState = new Map<string, number>()
  #sequenceTimer: ReturnType<typeof setTimeout> | null = null

  #resetSequences(): void {
    this.#sequenceState.clear()
    if (this.#sequenceTimer) {
      clearTimeout(this.#sequenceTimer)
      this.#sequenceTimer = null
    }
  }

  #touchSequenceTimer(): void {
    if (this.#sequenceTimer) clearTimeout(this.#sequenceTimer)
    this.#sequenceTimer = setTimeout(() => {
      this.#sequenceState.clear()
      this.#sequenceTimer = null
    }, SEQUENCE_TIMEOUT_MS)
  }

  // -------------------------------------------------
  // platform detection
  // -------------------------------------------------

  #isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)

  // -------------------------------------------------
  // keyboard listener
  // -------------------------------------------------

  #navigationGuardTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    super()

    // load baseline layers
    this.addLayer(globalKeyMap)
    this.addLayer(defaultKeyMap)

    // keyboard events
    window.addEventListener('keydown', this.#onKeyDown, { capture: true })

    // effect subscriptions for layer management
    EffectBus.on<{ layer: KeyMapLayer }>('keymap:add-layer', ({ layer }) => {
      this.addLayer(layer)
    })

    EffectBus.on<{ id: string }>('keymap:remove-layer', ({ id }) => {
      this.removeLayer(id)
    })

    // effect subscriptions for suppression
    EffectBus.on<{ reason: string }>('keymap:suppress', ({ reason }) => {
      this.suppress(reason)
    })

    EffectBus.on<{ reason: string }>('keymap:unsuppress', ({ reason }) => {
      this.unsuppress(reason)
    })

    // navigation guard bridge (same pattern as TileOverlayDrone)
    EffectBus.on('navigation:guard-start', () => {
      this.suppress('navigation-transition')
      if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer)
      this.#navigationGuardTimer = setTimeout(() => {
        this.unsuppress('navigation-transition')
      }, 200)
    })

    EffectBus.on('navigation:guard-end', () => {
      this.unsuppress('navigation-transition')
      if (this.#navigationGuardTimer) {
        clearTimeout(this.#navigationGuardTimer)
        this.#navigationGuardTimer = null
      }
    })
  }

  // -------------------------------------------------
  // keydown handler
  // -------------------------------------------------

  #onKeyDown = (e: KeyboardEvent): void => {
    // pure modifier keys are not shortcut triggers
    if (this.#isModifierOnly(e)) return

    const isSuppressed = this.suppressed || this.#isInteractiveFocus()
    const bindings = this.getEffective()
    let anyAdvanced = false
    let matched = false

    for (const binding of bindings) {
      // when suppressed, only pierce bindings fire
      if (isSuppressed && !binding.pierce) {
        this.#sequenceState.delete(binding.cmd)
        continue
      }

      const step = this.#sequenceState.get(binding.cmd) ?? 0
      const chord = binding.sequence[step]
      if (!chord) {
        this.#sequenceState.delete(binding.cmd)
        continue
      }

      if (this.#matchesChord(e, chord)) {
        if (step + 1 >= binding.sequence.length) {
          // complete sequence — invoke
          this.#sequenceState.delete(binding.cmd)
          matched = true

          e.preventDefault()
          EffectBus.emit('keymap:invoke', { cmd: binding.cmd, binding, event: e })
        } else {
          // advance sequence
          this.#sequenceState.set(binding.cmd, step + 1)
          anyAdvanced = true
          e.preventDefault()
        }
      } else {
        // reset progress for this command
        if (this.#sequenceState.has(binding.cmd)) {
          this.#sequenceState.delete(binding.cmd)
        }
      }
    }

    // start/refresh sequence timeout if any chord is in progress
    if (anyAdvanced) {
      this.#touchSequenceTimer()
    } else if (matched) {
      // completed a sequence — clear timer
      if (this.#sequenceTimer) {
        clearTimeout(this.#sequenceTimer)
        this.#sequenceTimer = null
      }
    }
  }

  // -------------------------------------------------
  // chord matching
  // -------------------------------------------------

  #matchesChord(e: KeyboardEvent, chord: KeyChord[]): boolean {
    return chord.every(k => this.#matchesSingleKey(e, k))
  }

  #matchesSingleKey(e: KeyboardEvent, k: KeyChord): boolean {
    if (this.#normalize(e.key) !== k.key) return false

    if (k.ctrl !== undefined && e.ctrlKey !== k.ctrl) return false
    if (k.shift !== undefined && e.shiftKey !== k.shift) return false
    if (k.alt !== undefined && e.altKey !== k.alt) return false
    if (k.meta !== undefined && e.metaKey !== k.meta) return false

    if (k.primary !== undefined) {
      const actual = this.#isMac ? e.metaKey : e.ctrlKey
      if (actual !== k.primary) return false
    }

    return true
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  #normalize(key: string): string {
    const k = key.toLowerCase()
    if (k === 'control') return 'ctrl'
    if (k === ' ') return 'space'
    return k
  }

  #isModifierOnly(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase()
    return k === 'control' || k === 'shift' || k === 'alt' || k === 'meta'
  }

  #isInteractiveFocus(): boolean {
    const el = document.activeElement
    if (!el) return false
    return !!el.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'
    )
  }
}

window.ioc.register('@diamondcoreprocessor.com/KeyMapService', new KeyMapService())
