// /welcome — the Revolución threshold. A cell carrying
// `visual:revolucion:welcome` opens into a 3D welcome page whose ELEMENTS
// are the cell's children: each child tile becomes a gilded panel in a
// receding colonnade, and stepping through a panel navigates into that
// child — whose own view implementation takes the surface from there.
//
// One layer at a time: this behaviour renders exactly the decorated layer.
// Child layers are doorways, not content — their views come later.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from '../../diamondcoreprocessor.com/commands/visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from '../../diamondcoreprocessor.com/commands/decoration-manifest.js'

export const WELCOME_VIEW = 'revolucion-welcome'
export const WELCOME_KIND = 'visual:revolucion:welcome'

/** Payload of a `visual:revolucion:welcome` record. Everything is optional —
 *  the view is built from the cell's CHILDREN, not from authored content. */
export interface WelcomePayload {
  readonly version: 1
  /** Headline over the colonnade. Falls back to the cell's title. */
  readonly title?: string
  /** One line under the headline. */
  readonly tagline?: string
}

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class WelcomeQueenBee extends QueenBee {
  readonly namespace = 'revolucionstyle.com'
  readonly command = 'welcome'
  override readonly aliases = ['threshold']
  override description = 'Welcome — a 3D threshold page built from the cell\'s children'
  override options = ['here [tagline]', 'remove', 'on', 'off']
  override examples = [
    { input: '/welcome here Walk in — the room is yours', result: 'Marks the current cell as a welcome threshold' },
    { input: '/welcome', result: 'Opens or closes the welcome view' },
    { input: '/welcome remove', result: 'Takes the welcome mark off the current cell' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = ''] = trimmed.toLowerCase().split(/\s+/, 1)

    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#attach(trimmed.slice(verb.length).trim())
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
      ? WELCOME_VIEW
      : vm.mode === WELCOME_VIEW ? 'hexagons' : WELCOME_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** One live record per cell — re-marking replaces, never piles. */
  async #attach(tagline: string): Promise<void> {
    const segments = this.#segments()
    const payload: WelcomePayload = { version: 1, ...(tagline ? { tagline } : {}) }
    await replaceDecoration({
      kind: WELCOME_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'Welcome threshold set on this cell', icon: 'door_open' })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: WELCOME_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'Welcome threshold removed', icon: 'door_open' })
  }
}

const _welcome = new WelcomeQueenBee()
window.ioc.register('@revolucionstyle.com/WelcomeQueenBee', _welcome)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: WELCOME_VIEW,
    slashCommand: '/welcome',
    iconName: 'door_open',
    toggleIcon: 'door_open',
    behavior: 'render',
    decorationKind: WELCOME_KIND,
    labelKey: 'view.revolucionWelcome',
    descriptionKey: 'view.revolucionWelcome.description',
    queenKey: '@revolucionstyle.com/WelcomeQueenBee',
    adoptable: true,
    // The content IS the cell's children — no authoring step, so a bare
    // `name@revolucion-welcome` install works.
    attachable: true,
    // The threshold opens where the tile stands — the children behind it
    // are what the view shows.
    opensOnTileClick: true,
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
