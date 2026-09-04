// clipboard/clipboard.queen.ts
//
// `/copy`, `/cut`, `/paste` — the three verbs everyone assumes a tool has, and
// the three Hypercomb had no word for.
//
// The acts themselves are old and well-built: `ClipboardWorker` captures a set
// of tiles and places them again, the clipboard is a SWAP rather than a
// duplicate, and both a keystroke and a control-bar button already reach it.
// What was missing was a way to SAY them. That is not decoration — the
// communication layer is the grammar, so a capability with no word does not
// exist to a participant who is speaking, and does not exist at all to a model
// with no pointer and no bridge.
//
// TARGETS, NOT A SELECTION, ON THE MACHINE SEAM. The existing doors act on
// whatever is currently picked, which is exactly right for a hand on a mouse
// and useless to a speaker: a model cannot see a selection and must never
// guess at one. So these verbs NAME their tiles and set the selection
// themselves; the bare forms stay for the participant, who can see what is
// picked.
//
// Syntax:
//   /copy <tile>              — take that tile
//   /copy [<tile>, <tile>]    — take several
//   /copy                     — take what is picked right now
//   /cut  …                   — same, as a move rather than a take
//   /paste                    — place what is held, here
//
// Nothing here is a new mechanism. Every form ends in the same
// `controls:action` the button emits, so there is ONE implementation of
// copying and this file is only a way to ask for it.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type SelectionLike = {
  selected: ReadonlySet<string>
  add(label: string): void
  clear(): void
}

/** `[a, b, c]` or one bare name — the list shape `/remove` and `/hide` read. */
const parseTargets = (raw: string): string[] => {
  const trimmed = raw.trim()
  const bracket = trimmed.match(/^\[(.*)\]$/s)
  const body = bracket ? bracket[1] : trimmed
  return (bracket ? body.split(',') : [body])
    .map(part => part.trim())
    .filter(Boolean)
}

const refuseTargets = (verb: string, bare: boolean) => (args: string): string | undefined => {
  const raw = args.trim()
  if (!raw) return bare ? undefined : `${verb} needs a tile name — a machine cannot see what is picked`
  const targets = parseTargets(raw)
  if (!targets.length) return `${verb} needs at least one tile name`
  if (targets.some(name => name.includes('/') || name.includes(String.fromCharCode(92)))) {
    return `${verb} names tiles on this page; it does not reach through /`
  }
  return undefined
}

abstract class ClipboardVerbQueen extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'

  /** The `controls:action` name this verb ends in — the button's own door. */
  protected abstract readonly action: string

  /** Tiles on this page, so the line completes what is actually here. */
  override slashComplete(args: string): readonly string[] {
    const cells = get<{ suggestions(): string[] }>('@hypercomb.social/CellSuggestionProvider')?.suggestions?.() ?? []
    const query = args.trim().toLowerCase()
    return query ? cells.filter(name => name.toLowerCase().startsWith(query)) : cells
  }

  protected async execute(args: string): Promise<void> {
    const targets = parseTargets(args)

    // Named tiles BECOME the selection, because the worker's contract is "act
    // on what is picked" and a speaker's names are how they pick.
    if (targets.length) {
      const selection = get<SelectionLike>('@diamondcoreprocessor.com/SelectionService')
      if (!selection) { this.#log(`${this.command} — selection is not ready yet`); return }
      selection.clear()
      for (const label of targets) selection.add(label)
    }

    // WAIT FOR THE WORK, NOT FOR THE DELIVERY. This used to emit and return,
    // so `execute()` resolved the instant dispatch did — and a sentence like
    // `/copy drafts` then `/paste` raced: the capture stages the clipboard only
    // after a chain of awaits, so the paste found it empty, returned silently,
    // and the receipt still said two grammars ran.
    //
    // TRANSIENT, because this payload carries callbacks. `emit` stores a last
    // value that replays to every later subscriber, which would settle this
    // promise from someone else's action — and re-run the verb. The buttons
    // that emit this channel plainly are unchanged and unaffected.
    let accepted = false
    let settled = false
    let finish!: (error?: unknown) => void
    const completed = new Promise<void>((resolve, reject) => {
      finish = error => {
        if (settled) return
        settled = true
        error === undefined ? resolve() : reject(error)
      }
    })
    EffectBus.emitTransient('controls:action', {
      action: this.action,
      accept: () => { accepted = true },
      complete: finish,
    })

    if (!accepted) {
      // No worker is listening, so nothing will ever happen. Saying so beats
      // logging a success nobody earned.
      this.#log(`${this.command} — the clipboard is not ready yet`)
      return
    }
    await completed

    const count = targets.length
    this.#log(count === 0
      ? `${this.command} — what is picked`
      : count === 1 ? `${this.command} — "${targets[0]}"` : `${this.command} — ${count} tiles`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⧉' })
  }
}

export class CopyQueenBee extends ClipboardVerbQueen {
  readonly command = 'copy'
  override description = 'Take tiles onto the clipboard'
  override descriptionKey = 'slash.copy'
  override options = ['<tile>', '[<tile>, <tile>, ...]', '']
  override examples = [
    { input: '/copy drafts', result: 'Takes the tile "drafts"' },
    { input: '/copy', result: 'Takes whatever is picked right now' },
  ]
  override machine = {
    forms: '<tile> | [<tile>, <tile>, ...]',
    example: '/copy drafts',
    reach: 'additive' as const,
    scope: 'hive' as const,
    refuse: refuseTargets('/copy', false),
  }

  protected readonly action = 'copy'
}

export class CutQueenBee extends ClipboardVerbQueen {
  readonly command = 'cut'
  override description = 'Take tiles onto the clipboard to move them'
  override descriptionKey = 'slash.cut'
  override options = ['<tile>', '[<tile>, <tile>, ...]', '']
  override examples = [
    { input: '/cut drafts', result: 'Holds "drafts" to place somewhere else' },
    { input: '/cut', result: 'Holds whatever is picked right now' },
  ]
  /** A cut does not delete: the tile is HELD, and stays held until it lands. */
  override machine = {
    forms: '<tile> | [<tile>, <tile>, ...]',
    example: '/cut drafts',
    reach: 'destructive' as const,
    scope: 'hive' as const,
    refuse: refuseTargets('/cut', false),
  }

  protected readonly action = 'cut'
}

export class PasteQueenBee extends ClipboardVerbQueen {
  readonly command = 'paste'
  override description = 'Place what the clipboard is holding, here'
  override descriptionKey = 'slash.paste'
  override options = ['']
  override examples = [
    { input: '/paste', result: 'Places what is held on this page' },
  ]
  /** Bare means something entire: place what is held, where you are. */
  override machine = {
    forms: '',
    example: '/paste',
    bare: true,
    reach: 'additive' as const,
    scope: 'hive' as const,
    refuse: (args: string): string | undefined =>
      args.trim() ? '/paste places what is held here; it takes no argument' : undefined,
  }

  protected readonly action = 'paste'

  override slashComplete(): readonly string[] { return [] }
}

const _copy = new CopyQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CopyQueenBee', _copy)

const _cut = new CutQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CutQueenBee', _cut)

const _paste = new PasteQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PasteQueenBee', _paste)
