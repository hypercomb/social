// input/keymap/keymap.service.ts
import { EffectBus, type KeyBinding, type KeyChord, type KeyMapLayer } from '@hypercomb/core'
import { USER_KEYMAP_LAYER, chordFits, pressOfEvent } from './chord-match.js'
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
        const under = layer.id === USER_KEYMAP_LAYER ? byCmd.get(b.cmd) : undefined
        byCmd.set(b.cmd, under ? { ...under, ...b } : b)
      }
    }
    this.#effectiveCache = [...byCmd.values()]
    return this.#effectiveCache
  }

  // -------------------------------------------------
  // the hold (a surface reading keys as data)
  // -------------------------------------------------

  // Stronger than suppression: nothing fires, pierce bindings included. The
  // keyboard desk holds the map while it is open, so pressing Ctrl+K there names
  // the chord instead of opening the palette.
  #holds = new Set<string>()

  hold(reason: string): void {
    this.#holds.add(reason)
    this.#resetSequences()
  }

  release(reason: string): void {
    this.#holds.delete(reason)
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

    EffectBus.on<{ reason: string }>('keymap:hold', ({ reason }) => {
      this.hold(reason)
    })

    EffectBus.on<{ reason: string }>('keymap:release', ({ reason }) => {
      this.release(reason)
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
    if (this.#holds.size) return

    const isSuppressed = this.suppressed || this.#isInteractiveFocus()
    const bindings = this.getEffective()
    let anyAdvanced = false
    let matched = false

    // A press a participant chose is theirs alone. `{ key: 'h' }` does not look
    // at Ctrl, so without this Ctrl+H would fire their binding and the default.
    const chosen = this.#chosenFor(e, isSuppressed)

    for (const binding of bindings) {
      // when suppressed, only pierce bindings fire
      if (isSuppressed && !binding.pierce) {
        this.#sequenceState.delete(binding.cmd)
        continue
      }

      if (chosen && !chosen.has(binding.cmd)) {
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

  /** The chosen commands this press would move, or null when it is nobody's. */
  #chosenFor(e: KeyboardEvent, isSuppressed: boolean): Set<string> | null {
    const layer = this.#layers.find(l => l.id === USER_KEYMAP_LAYER)
    if (!layer) return null
    const chosen = new Set<string>()
    for (const binding of layer.bindings) {
      if (isSuppressed && !binding.pierce) continue
      const chord = binding.sequence[this.#sequenceState.get(binding.cmd) ?? 0]
      if (chord && this.#matchesChord(e, chord)) chosen.add(binding.cmd)
    }
    return chosen.size ? chosen : null
  }

  // -------------------------------------------------
  // chord matching
  // -------------------------------------------------

  #matchesChord(e: KeyboardEvent, chord: KeyChord[]): boolean {
    // A step's KeyChords are ALTERNATIVES (any-of), not simultaneous. A keydown
    // carries exactly one base key, so listing several base keys in one step can
    // only mean "delete OR backspace" — never "both at once". Modifiers
    // (ctrl/shift/alt/meta/primary) ride ON each KeyChord, so a lone-key step is
    // unaffected: `.some` and `.every` agree for the one-entry steps every other
    // binding uses. This is what lets `selection.remove` fire from a SINGLE
    // Delete or Backspace press (previously it was authored as a two-step
    // sequence — Delete THEN Backspace — so a lone press deleted nothing).
    return chord.some(k => this.#matchesSingleKey(e, k))
  }

  #matchesSingleKey(e: KeyboardEvent, k: KeyChord): boolean {
    return chordFits(pressOfEvent(e), k)
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  #isModifierOnly(e: KeyboardEvent): boolean {
    // Some keyboard events (synthetic IME, certain mobile soft-keyboards,
    // browser-internal autofill chips) deliver an event with `key`
    // undefined. Guard before .toLowerCase() so the keymap pipeline
    // doesn't throw on every keystroke and abort the surrounding
    // listeners (which include swarm-related render triggers).
    const raw = typeof e.key === 'string' ? e.key : ''
    if (!raw) return false
    const k = raw.toLowerCase()
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

// keyboard/keyboard.drone.ts registers this (atomic-modules-plan.md): a dependency registers nothing.
