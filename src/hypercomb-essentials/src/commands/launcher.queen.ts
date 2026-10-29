// /launcher — home screens of the place you are standing.
//
// Swipe left or right to turn the screen. On a launch-group page the
// screens are the groups (/games, then /websites, then the next). Anywhere
// else the screens are pages of this layer's tiles. The tiles themselves
// are phone icons, or square plates — `/launcher icons`, `/launcher square`,
// or the switch on the screen.
//
// A mark at a cell makes the face available down the branch, the same way
// the square tile view does. Opening it with the word needs no mark.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'
import {
  ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn,
} from '../sharing/behavior-enablement.js'
import {
  LAUNCHER_COHORT, LAUNCHER_KIND, LAUNCHER_VIEW,
  isLauncherStyle, launcherStylePreference, setLauncherStylePreference,
  type LauncherPayload, type LauncherStyle,
} from './launcher-kind.js'

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class LauncherQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'launcher'
  override description = 'Launcher screens — swipe sideways between them, as square tiles or phone icons'
  override options = ['here', 'icons', 'square', 'remove', 'on', 'off']
  override examples = [
    { input: '/launcher', result: 'Opens or closes the launcher screens' },
    { input: '/launcher icons', result: 'Phone icons, and opens the launcher' },
    { input: '/launcher square', result: 'Square tiles, and opens the launcher' },
    { input: '/launcher here', result: 'Marks the current cell as a launcher page' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = ''] = trimmed.toLowerCase().split(/\s+/, 1)

    if (isLauncherStyle(verb)) {
      setLauncherStylePreference(verb)
      get<ViewModeShape>('@hypercomb.social/ViewMode')?.setMode(LAUNCHER_VIEW)
      return
    }
    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#attach(launcherStylePreference() ?? 'icons')
      return
    }
    if (verb === 'remove' || verb === 'detach') {
      await this.#remove()
      return
    }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (verb === 'off' || verb === 'close') {
      vm.setMode('hexagons')
      return
    }
    vm.setMode(verb === 'on' || verb === 'open'
      ? LAUNCHER_VIEW
      : vm.mode === LAUNCHER_VIEW ? 'hexagons' : LAUNCHER_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  async #attach(style: LauncherStyle): Promise<void> {
    const segments = this.#segments()
    const payload: LauncherPayload = { version: 1, style }
    await replaceDecoration({
      kind: LAUNCHER_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'Launcher set on this cell', icon: 'apps' })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: LAUNCHER_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'Launcher removed', icon: 'apps' })
  }
}

/** A kind nobody has seen is globally off. Light it once, after the on-list
 *  exists, and never on a hive that opened dark. */
const lightLauncherOnce = (): void => {
  if (!readGlobalOnKinds()) return
  seedCohortOn(LAUNCHER_COHORT, [LAUNCHER_KIND])
}
lightLauncherOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightLauncherOnce)

const _launcher = new LauncherQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LauncherQueenBee', _launcher)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: LAUNCHER_VIEW,
    slashCommand: '/launcher',
    iconName: 'apps',
    toggleIcon: 'apps',
    behavior: 'render',
    decorationKind: LAUNCHER_KIND,
    labelKey: 'view.launcher',
    descriptionKey: 'view.launcher.description',
    queenKey: '@diamondcoreprocessor.com/LauncherQueenBee',
    adoptable: true,
    attachable: true,
    opensOnTileClick: true,
    scope: 'branch',
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
