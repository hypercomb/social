// presentation/tiles/image-only.queen.ts
//
// `/image-only` — pictures without their names.
//
// The pair of `/text-only`: text only hides every picture, image only hides
// every NAME, so a page of photographs reads as photographs. It used to be the
// yellow `J` icon on the tile overlay, which emitted `tile:toggle-text`; the
// icon went with the tile-actions rewrite (7098ac3cb, 2026-05-20) and left the
// renderer listening at a door nobody opened. This word is that door again, and
// the rail button beside text only says the same word (`controls:action`).
//
// TWO SCOPES, ONE WORD:
//   nothing selected — a view mode, like text only: every name on the page goes
//                      quiet until the word is said again. Nothing is written.
//   tiles selected   — the selected tiles' own name switch (the editor's
//                      `hideText`), flipped and SAVED, so it travels with the
//                      tile. They all land on one side: if any still shows its
//                      name, every one hides it; only when every one already
//                      hides does the word show them again. A tile with no
//                      picture keeps the mark but still draws its name
//                      (show-cell's #hidesName): a hidden name needs something
//                      to stand behind.
//
// `tile:toggle-text` now CARRIES ITS STATE (`{ imageOnly }`), the way
// `render:set-text-only` carries `{ textOnly }`. The bare flip it used to be
// replayed to every late subscriber as one more flip, so a renderer that
// re-subscribed drifted from the rest; a stated value is idempotent. Both
// listeners still take the bare form.
//
// Text only and image only are exclusive — both at once is a page of blank
// hexagons — so turning one on turns the other off, decided here, in one place.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../../editor/tile-properties.js'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export type ImageOnlyPayload = { imageOnly: boolean }

/** Where a bulk flip lands: if any selected tile still shows its name they all
 *  hide; only when every one hides already do they all show. */
export const nextHideText = (hiding: readonly boolean[]): boolean => !hiding.every(Boolean)

export class ImageOnlyQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'image-only'
  override description = 'Hide tile names: every name on the page, or the selected tiles\' own name switch'
  override descriptionKey = 'slash.image-only'
  override examples = [
    { input: '/image-only', result: 'Every name on the page goes quiet; say it again to bring them back. With tiles selected, it flips just their own name switch instead, and that is saved' },
  ]

  override machine = {
    forms: '(bare)',
    example: '/image-only',
    bare: true,
    // EDITING at the TILE as a ceiling: with a selection it writes those tiles'
    // own properties, a layer commit each, undoable. Bare with nothing selected
    // it is a lens in this browser and writes nothing.
    reach: 'editing' as const,
    scope: 'tile' as const,
    refuse: (args: string): string | undefined => (args.trim() ? '/image-only takes no arguments' : undefined),
  }

  #imageOnly = false
  #textOnly = false

  constructor() {
    super()
    EffectBus.on<Partial<ImageOnlyPayload> | undefined>('tile:toggle-text', p => {
      if (p?.imageOnly != null) this.#imageOnly = p.imageOnly
    })
    EffectBus.on<{ textOnly?: boolean } | undefined>('render:set-text-only', p => {
      if (p?.textOnly == null) return
      this.#textOnly = p.textOnly
      if (p.textOnly && this.#imageOnly) this.#setImageOnly(false)
    })
    // The rail button says this word (controls-bar `toggleImageOnly`).
    EffectBus.on<{ action?: string } | undefined>('controls:action', p => {
      if (p?.action === 'image-only') void this.invoke('').catch(error => console.warn('[image-only]', error))
    })
  }

  protected async execute(args: string): Promise<void> {
    const refusal = this.machine.refuse(args)
    if (refusal) throw new Error(`Image only — ${refusal}`)

    const selection = get<{ selected: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
    const labels = [...(selection?.selected ?? [])]

    if (labels.length === 0) {
      this.#setImageOnly(!this.#imageOnly)
      this.#log(this.#imageOnly
        ? 'Image only — names are quiet; say it again to bring them back'
        : 'Image only — names are back')
      return
    }

    const lineage = get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const segments: readonly string[] = [...(lineage?.explorerSegments?.() ?? [])]
    const hiding = await Promise.all(labels.map(async label =>
      (await readTilePropertiesAt(segments, label))['hideText'] === true))
    const hide = nextHideText(hiding)

    const changed: string[] = []
    for (let i = 0; i < labels.length; i++) {
      if (hiding[i] === hide) continue
      // `undefined` is the write's explicit removal; the editor clears the
      // switch the same way (tile-editor.service.ts setHideText).
      await writeTilePropertiesAt(segments, labels[i], { hideText: hide ? true : undefined })
      EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', { cell: labels[i], segments })
      changed.push(labels[i])
    }

    const one = changed.length === 1
    const noun = one ? `"${changed[0]}"` : `${changed.length} tiles`
    this.#log(hide
      ? `Image only — ${noun} ${one ? 'hides its name' : 'hide their names'} now`
      : `Image only — ${noun} ${one ? 'shows its name' : 'show their names'} again`)
  }

  #setImageOnly(on: boolean): void {
    if (on && this.#textOnly) EffectBus.emit('render:set-text-only', { textOnly: false })
    this.#imageOnly = on
    EffectBus.emit<ImageOnlyPayload>('tile:toggle-text', { imageOnly: on })
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const _imageOnly = new ImageOnlyQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ImageOnlyQueenBee', _imageOnly)
