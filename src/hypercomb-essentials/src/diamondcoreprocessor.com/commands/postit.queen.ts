// /postit — attach, update, or open a post-it on the current cell.
//
// A post-it is the smallest shareable "read this" surface: the decorated
// tile shows a small sticky note on screen, and opening it expands into a
// full page — either the payload's `htmlSig` resource (a one-page site)
// or, when only `text` is present, a large sticky rendering that text.
//
// Like a website page, the CONTENT is authored first (the page resource),
// so the behaviour is not `attachable` — but `/postit here <text>` covers
// the plain-text case entirely from the command line.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'

export const POSTIT_VIEW = 'postit'
export const POSTIT_KIND = 'visual:postit:note'

/** Payload of a `visual:postit:note` record. Exactly one of `htmlSig` /
 *  `text` is expected; `htmlSig` wins when both are present. */
export interface PostitPayload {
  readonly version: 1
  /** Heading shown on the small sticky. Falls back to the cell's title. */
  readonly title?: string
  /** Plain sticky text — the expanded view renders it as a large note. */
  readonly text?: string
  /** A one-page HTML resource — the expanded view mounts it whole. */
  readonly htmlSig?: string
}

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class PostitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'postit'
  override readonly aliases = ['sticky', 'note-view']
  override description = 'Post-it — a small sticky on the tile that opens into a full page'
  override options = ['here <text>', 'remove', 'on', 'off']
  override examples = [
    { input: '/postit here Call the venue before Saturday', result: 'Sticks that text on the current cell' },
    { input: '/postit', result: 'Opens or closes the post-it view' },
    { input: '/postit remove', result: 'Takes the post-it off the current cell' },
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
      ? POSTIT_VIEW
      : vm.mode === POSTIT_VIEW ? 'hexagons' : POSTIT_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** Attach or update — one live record per cell (`replaceDecoration`), so
   *  re-sticking never piles superseded notes onto the manifest. */
  async #attach(text: string): Promise<void> {
    const segments = this.#segments()
    const payload: PostitPayload = { version: 1, ...(text ? { text } : {}) }
    await replaceDecoration({
      kind: POSTIT_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'Post-it stuck on this cell', icon: 'sticky_note_2' })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: POSTIT_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'Post-it removed', icon: 'sticky_note_2' })
  }
}

const _postit = new PostitQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PostitQueenBee', _postit)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: POSTIT_VIEW,
    slashCommand: '/postit',
    iconName: 'sticky_note_2',
    toggleIcon: 'sticky_note_2',
    behavior: 'render',
    decorationKind: POSTIT_KIND,
    labelKey: 'view.postit',
    descriptionKey: 'view.postit.description',
    queenKey: '@diamondcoreprocessor.com/PostitQueenBee',
    adoptable: true,
    // Clicking the sticky (or the tile's view-enter icon) opens the note in
    // place — navigating away from the note to read the note would be absurd.
    opensOnTileClick: true,
    // A post-it cell IS its sticky: the tile is the asset, the view is the
    // presence. The hexagon never renders while the mark is on.
    replacesTileRender: true,
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
