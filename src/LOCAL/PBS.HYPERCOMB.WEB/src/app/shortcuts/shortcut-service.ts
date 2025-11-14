import { Injectable, computed, effect, inject, signal } from "@angular/core"
import { environment } from "src/environments/environment"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"
import { defaultShortcuts } from "./layouts/default-shortcuts"
import { globalShortcuts } from "./layouts/global-shortcuts"
import { IShortcut, IShortcutKey, IShortcutOverride } from "./shortcut-model"
import { ShortcutRegistry } from "./shortcut-registry"
import { PayloadBase, fromKeyboard } from "../actions/action-contexts"
import { CoordinateDetector } from "../helper/detection/coordinate-detector"
import { PayloadInfuser } from "./payload-infuser"

@Injectable({ providedIn: 'root' })
export class ShortcutService extends Hypercomb {
  private readonly detector = inject(CoordinateDetector)
  private readonly infuser = inject(PayloadInfuser)
  private readonly registry = inject(ShortcutRegistry)
  private readonly overrides = signal<IShortcutOverride[]>([])
  private readonly layoutShortcuts = signal<IShortcut[]>([])

  private readonly layouts: Record<string, readonly IShortcut[]> = {
    global: globalShortcuts,
    default: defaultShortcuts,
  }

  // state to track progress within multi-step sequences per command
  private readonly sequenceState = new Map<string, number>()

  constructor() {
    super()

    // listen to keyUp events
    effect(() => {
      const ev = this.ks.keyUp()
      if (!ev) return

      this.handleKeyUp(ev)
      this.ks.done()
    })
  }

  /** load a layout (or default) into current session */
  public loadLayout(layoutId: string = 'default') {
    const cfg = this.layouts[layoutId] ?? []
    this.layoutShortcuts.set([...cfg]) // clone for mutability
    this.sequenceState.clear()
  }

  /** merge global + active layout + overrides */
  public readonly effectiveShortcuts = computed<IShortcut[]>(() => {
    const global = this.layouts['global'] ?? []
    const layout = this.layouts['default']
    const merged = new Map<string, IShortcut>()

    for (const sc of [...global, ...layout]) {
      merged.set(sc.cmd, sc)
    }

    for (const ov of this.overrides()) {
      const base = merged.get(ov.cmd)
      if (base) {
        merged.set(ov.cmd, { ...base, keys: ov.keys })
      }
    }

    return [...merged.values()]
  })

  /** check if event matches a chord (all keys/mods in that inner array) */
  private matches(ev: KeyboardEvent, keys: IShortcutKey[]): boolean {
    try {
      this.debug.log('shortcuts', keys)
      const result = keys.every(k => this.ks.when(ev).key(k.key, k))
      return result
    } catch (error) {
      debugger
    }
    return false
  }

  /** handle a keyUp event */
  private handleKeyUp(ev: KeyboardEvent) {
    let anyMatched = false
    const shortcuts = this.effectiveShortcuts()
    for (const sc of shortcuts) {

      const seq = sc.keys // array of chords
      const currentStep = this.sequenceState.get(sc.cmd) ?? 0
      const expectedChord = seq[currentStep]

      const matches = this.matches(ev, expectedChord)
      if (matches) {
        if (currentStep + 1 >= seq.length) {
          // finished full sequence â†’ reset and invoke
          this.sequenceState.set(sc.cmd, 0)
          anyMatched = true

          if (!environment.production) {
            console.debug(`[ShortcutService] âœ… matched sequence: ${sc.cmd}`, {
              got: this.prettyPrintEvent(ev),
              expected: seq.map(s => s.map(k => this.prettyPrintKey(k)).join('+')).join(' then ')
            })
          }

          const tile = this.detector.activeTile()
          let payload: PayloadBase = fromKeyboard(ev, sc.payload)
          this.infuser.infuse(payload, tile)

          this.registry.invoke(sc.cmd, payload)
        } else {
          // advance sequence progress
          this.sequenceState.set(sc.cmd, currentStep + 1)
        }
      } else {
        // reset progress for this command
        this.sequenceState.set(sc.cmd, 0)
      }
    }

    if (!anyMatched && !environment.production) {
      console.debug('[ShortcutService] (no shortcuts matched)', this.prettyPrintEvent(ev))
    }
  }

  private readonly isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)

  private prettyPrintKey(k: IShortcutKey): string {
    const mods: string[] = []
    if (k.primary) mods.push(this.isMac ? 'Meta' : 'Ctrl')
    if (k.ctrl) mods.push('Ctrl')
    if (k.meta) mods.push('Meta')
    if (k.shift) mods.push('Shift')
    if (k.alt) mods.push('Alt')
    return [...mods, k.key.toUpperCase()].join('+')
  }

  private prettyPrintEvent(ev: KeyboardEvent): string {
    const mods: string[] = []
    if (ev.ctrlKey) mods.push('Ctrl')
    if (ev.metaKey) mods.push('Meta')
    if (ev.shiftKey) mods.push('Shift')
    if (ev.altKey) mods.push('Alt')
    return [...mods, ev.key.toUpperCase()].join('+')
  }
}


