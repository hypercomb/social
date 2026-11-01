// keyboard-desk/keyboard-desk.drone.ts
//
// THE KEYBOARD DESK IS ONE BEHAVIOUR (documentation/keyboard-desk.md). This bee
// names the whole and owns no drawing: it puts the participant's chosen chords
// into the keymap at boot, runs the ones that name a word or a lineup, and brings
// the desk with the first open. Everything else is a part in its own folder, and
// each part's folder is a trait with its own signature.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider, type KeyMapLayer } from '@hypercomb/core'
import { layerOfChoices, loadChoices } from './bindings/bindings.js'
import { fireCommand, readLineup, runSteps, sayLine } from './lineup/lineup.js'
import { PART_WORDS, lineupOf, wordOf } from './parts.js'

// The desk arrives with the first open, as the tile editor's does, and the
// element the shell's surface host already made upgrades in place. The tag and
// key are written out because importing even a constant would load the view.
const KEYBOARD_DESK_SURFACE = 'hc-keyboard-desk'
const KEYBOARD_DESK_VIEW_KEY = '@diamondcoreprocessor.com/KeyboardDeskView'
const KEYMAP_KEY = '@diamondcoreprocessor.com/KeyMapService'
const SLASH_KEY = '@diamondcoreprocessor.com/SlashBehaviourDrone'
const STORE_KEY = '@hypercomb.social/Store'

const said = (key: string, fallback: string, params: Record<string, string>): string => {
  const fill = (text: string): string => text.replace(/\{(\w+)\}/g, (whole, name) => params[name] ?? whole)
  const text = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return text && text !== key ? text : fill(fallback)
}

type DeskView = typeof import('./desk/keyboard-desk.view.js')
let viewLoad: Promise<DeskView> | null = null

const loadView = (): Promise<DeskView> => viewLoad ??= import('./desk/keyboard-desk.view.js')
  .then(module => {
    if (!customElements.get(KEYBOARD_DESK_SURFACE)) customElements.define(KEYBOARD_DESK_SURFACE, module.KeyboardDeskElement)
    return module
  })
  .catch(error => { viewLoad = null; throw error })

const viewFacade = {
  open(): void { void loadView().then(view => view.keyboardDeskFacade.open()) },
}

export class KeyboardDeskDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The keyboard desk: every key drawn, what it does, and tiles to choose a chord\'s behaviour from.'

  public override readonly traits = PART_WORDS

  protected override sense = (): boolean => false

  constructor() {
    super()
    // The bus replays its last value to a new subscriber, and an old press
    // replayed at construction is not a press now.
    let live = false
    EffectBus.on('keyboard:open', () => { if (live) viewFacade.open() })
    EffectBus.on<{ cmd?: unknown }>('keymap:invoke', payload => {
      if (!live) return
      if (payload?.cmd === 'ui.keyboard') { viewFacade.open(); return }
      const word = wordOf(payload?.cmd)
      if (word) void this.#run(word)
      const lineup = lineupOf(payload?.cmd)
      if (lineup) void this.#runLineup(lineup)
    })
    live = true
    void this.#restore()
  }

  async #run(word: string): Promise<void> {
    const slash = window.ioc.get<{ execute(name: string, args: string): unknown }>(SLASH_KEY)
    try { await slash?.execute(word, '') }
    catch (error) { console.warn('[keyboard-desk] behaviour failed', word, error) }
  }

  /** The automatons in order, each starting where the last one left the hive.
   *  The first that does not run stops the line, and says which it was. */
  async #runLineup(sig: string): Promise<void> {
    const steps = await readLineup(sig)
    if (!steps) return
    const stopped = await runSteps(steps, { say: sayLine, fire: fireCommand, read: readLineup })
    if (!stopped) return
    EffectBus.emit('toast:show', {
      type: 'warning',
      message: said('keyboard.lineup-stopped', 'The lineup stopped at {step}: {reason}', stopped),
    })
  }

  /** The chosen chords, once there is a store to read them from and a keymap to
   *  put them in. No choices is no layer. */
  async #restore(): Promise<void> {
    const store = await new Promise<{ initialize?(): Promise<unknown> }>(ready => window.ioc.whenReady(STORE_KEY, ready))
    try { await store.initialize?.() } catch { return }
    const choices = await loadChoices()
    if (!choices.length) return
    window.ioc.whenReady<{ addLayer(layer: KeyMapLayer): void }>(KEYMAP_KEY, keymap => keymap.addLayer(layerOfChoices(choices)))
  }
}

window.ioc.register(KEYBOARD_DESK_VIEW_KEY, viewFacade)
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: KEYBOARD_DESK_SURFACE, owner: KEYBOARD_DESK_VIEW_KEY, element: KEYBOARD_DESK_SURFACE, order: 225 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

window.ioc.register('@diamondcoreprocessor.com/KeyboardDeskDrone', new KeyboardDeskDrone())
