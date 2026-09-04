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
  /** Where the sticky is PINNED, as viewport fractions (0..1 of width/height,
   *  the note's top-left corner). Written by dragging the sticky; absent
   *  means the note sits in the docked column. Riding the payload makes a
   *  position one ordinary layer edit — it survives reloads, travels with
   *  the tile, and undoes like anything else. */
  readonly pin?: { readonly x: number; readonly y: number }
  /** How big the sticky is, in px — written by the bottom-right grip.
   *  Absent means the participant's last chosen size (see POSTIT_SIZE_KEY),
   *  and failing that the CSS default. Px, not viewport fractions: a note is
   *  chrome-scale paper, so it should keep its size on a bigger screen
   *  rather than grow with it (unlike `pin`, which is a PLACE on the glass). */
  readonly size?: { readonly w: number; readonly h: number }
}

/** Where the last size a participant resized a sticky to is remembered, so
 *  it becomes the default for every note that has not been resized itself.
 *  Participant-local presentation preference — the same class of setting as
 *  `hc:world-mode`, and deliberately NOT in the layer: it is about this
 *  person's screen, not about the note, so it must not travel on adoption. */
export const POSTIT_SIZE_KEY = 'hc:postit:size'

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
/** The shell's feature-hidden WRITE surface (features-viewer/feature-hidden.ts),
 *  resolved loosely — essentials never imports shared; the seam is IoC. */
type FeatureHiddenWriterShape = {
  hide?: (f: { featKind: string; view: string; label: string; segments: readonly string[] }) => Promise<string | null>
  restoreAt?: (featKind: string, segments: readonly string[]) => Promise<boolean>
}

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class PostitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'postit'
  override description = 'Post-it — a small sticky on the tile that opens into a full page'
  override options = ['here <text>', 'tile', 'sticky', 'remove', 'on', 'off']

  /** The bare forms toggle a VIEW, which a speaker cannot see the result of.
   *  Only the form that writes something is offered. */
  override machine = {
    forms: 'here <text>',
    example: '/postit here First draft',
    reach: 'additive' as const,
    scope: 'tile' as const,
    refuse: (args: string): string | undefined =>
      /^here[ ]+[^ ]/i.test(args) ? undefined : '/postit needs the form: /postit here <text>',
  }

  override examples = [
    { input: 'meetup@postit Call the venue before Saturday', result: 'Sticks that note on the "meetup" tile — from anywhere, no need to go there' },
    { input: '/postit here Call the venue before Saturday', result: 'Sticks that text on the current cell' },
    { input: '/postit', result: 'Opens or closes the post-it view' },
    { input: '/postit tile', result: 'The tile renders again here — the note is kept, just dormant' },
    { input: '/postit sticky', result: 'The post-it takes the cell back over' },
    { input: '/postit remove', result: 'Takes the post-it off the current cell' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = ''] = trimmed.toLowerCase().split(/\s+/, 1)

    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#attach(trimmed.slice(verb.length).trim())
      return
    }
    if (verb === 'tile' || verb === 'revert' || verb === 'hex') {
      await this.#tile()
      return
    }
    if (verb === 'sticky' || verb === 'restore') {
      await this.#sticky()
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

  /**
   * Receive a CALL — `meetup@postit("Doors at 7 — bring the humidor")`.
   *
   * The `@` grammar names a TARGET, so unlike `/postit here` this authors the
   * note on another tile without going there or selecting it. The message is
   * the first argument; `title:` may name the sticky's heading. Everything
   * else (pin, size, an htmlSig page) stays with the note's own editing —
   * a call says what the note SAYS, not how it sits.
   *
   * Implementing this method IS how a behaviour declares it takes a message:
   * ShowFeaturesDrone resolves it through the registry's `queenKey`.
   */
  public async applyCall(call: {
    segments: readonly string[]
    args: readonly unknown[]
    named: Readonly<Record<string, unknown>>
  }): Promise<void> {
    const segments = call.segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) return
    const text = call.args[0] === undefined || call.args[0] === null ? '' : String(call.args[0])
    const title = call.named['title'] === undefined ? undefined : String(call.named['title'])
    await this.#attachAt(segments, text, title)
  }

  /** Attach or update — one live record per cell (`replaceDecoration`), so
   *  re-sticking never piles superseded notes onto the manifest. A pin the
   *  participant dragged into place is POSITION, not content — re-sticking
   *  the text must not snap the note back to the dock, so it carries over. */
  async #attach(text: string): Promise<void> {
    await this.#attachAt(this.#segments(), text)
  }

  /** The one write both `/postit here` and `tile@postit("…")` go through, so
   *  the two spellings can never drift apart. `segments` is explicit because
   *  the call form names a target rather than acting where you stand. */
  async #attachAt(segments: readonly string[], text: string, title?: string): Promise<void> {
    const segs = [...segments]
    const prior = (await listDecorations<PostitPayload>({ kind: POSTIT_KIND, segments: segs }))
      .at(-1)?.record.payload
    const payload: PostitPayload = {
      version: 1,
      ...(text ? { text } : {}),
      ...(title ? { title } : prior?.title ? { title: prior.title } : {}),
      ...(prior?.pin ? { pin: prior.pin } : {}),
      ...(prior?.size ? { size: prior.size } : {}),
    }
    await replaceDecoration({
      kind: POSTIT_KIND,
      appliesTo: segs,
      segments: segs,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', {
      message: `Post-it stuck on "${segs[segs.length - 1] ?? 'this cell'}"`,
      icon: 'sticky_note_2',
    })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: POSTIT_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'Post-it removed', icon: 'sticky_note_2' })
  }

  /** `/postit tile` — the TILE renders again and the sticky stands down; the
   *  note is KEPT, just dormant. Rides the feature-hidden pool (the
   *  participant-local off every activation lens already reads), so nothing
   *  leaves the layer and `/postit sticky` brings the takeover back. */
  async #tile(): Promise<void> {
    const segments = this.#segments()
    const writer = get<FeatureHiddenWriterShape>('@hypercomb.social/FeatureHiddenWriter')
    if (!writer?.hide) return
    await writer.hide({
      featKind: POSTIT_KIND, view: POSTIT_VIEW,
      label: segments.at(-1) ?? '/', segments,
    })
    // Un-claim the hex NOW: the union filter only runs during a geometry
    // pass, and the hidden write itself forces none.
    EffectBus.emit('takeover:indexed', { label: segments.at(-1) ?? '' })
    EffectBus.emit('activity:log', { message: 'Tile restored — the post-it stands down here', icon: 'sticky_note_2' })
  }

  /** `/postit sticky` — undo `tile`: the post-it takes the cell back over. */
  async #sticky(): Promise<void> {
    const segments = this.#segments()
    const writer = get<FeatureHiddenWriterShape>('@hypercomb.social/FeatureHiddenWriter')
    if (!writer?.restoreAt) return
    if (!await writer.restoreAt(POSTIT_KIND, segments)) return
    EffectBus.emit('takeover:indexed', { label: segments.at(-1) ?? '' })
    EffectBus.emit('activity:log', { message: 'Post-it back on this cell', icon: 'sticky_note_2' })
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
    // What `meetup@postit …` can be told. The message is the primary, so the
    // paren-less form fills it; `title:` needs naming because a note that is
    // all heading and no body is not the common case.
    parameters: [
      {
        name: 'message', type: 'text', primary: true,
        descriptionKey: 'postit.param.message',
        fallbackDescription: 'What the note says',
      },
      {
        name: 'title', type: 'text',
        descriptionKey: 'postit.param.title',
        fallbackDescription: 'Heading on the sticky (defaults to the tile’s title)',
      },
    ],
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
