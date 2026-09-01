// commands/aliases/aliases.drone.ts
//
// THE ALIASES WINDOW'S DATA SIDE.
//
// The panel is a shared Angular component and must not import essentials, so
// everything it shows crosses as one `aliases:render` payload and everything
// it does comes back as an intent — the same contract the comfy and hosts
// panels keep. Nothing in the panel knows what a queen is; nothing here knows
// what a dock lane is.
//
// One row per behaviour the census admits to: its canonical name (fixed —
// not the participant's to give or take), the names the participant gave it,
// and the candidates on offer — the old code-declared names, minus any that
// would collide with a name someone can already say. A candidate that
// collides (solomon's old `game`) is not drawn greyed-out and explained; it
// is simply not offered, because the window is for giving names, not for
// studying why one cannot be given.

import { Drone } from '@hypercomb/core'
import { ALIAS_SUGGESTIONS } from './alias-suggestions.js'
import type { ParticipantAliases, RefusedName } from './participant-aliases.js'

export interface AliasRow {
  command: string
  description: string
  /** The participant's names for it, as held right now. */
  given: string[]
  /** Names on offer — picked over: nothing already given, nothing that
   *  shadows a canonical command, nothing another behaviour holds. */
  candidates: string[]
}

/** Mirrors AliasesPanelPayload in `hypercomb-shared/ui/aliases-panel` —
 *  shared cannot import essentials, so the shape is kept field-for-field by
 *  hand (the same arrangement the comfy panel has). */
export interface AliasesRenderPayload {
  open: boolean
  /** Seed for the panel's filter box, when a command asked to look at one. */
  filter: string
  rows: AliasRow[]
  /** Which row the last decision belonged to, when part of it was refused. */
  refusedFor: string
  refused: RefusedName[]
}

export class AliasesDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'

  protected override listens: string[] = [
    'aliases:open', 'aliases:close', 'aliases:reopen', 'aliases:set', 'aliases:changed',
  ]
  protected override emits: string[] = ['aliases:render', 'activity:log']

  #open = false
  #filter = ''
  #refusedFor = ''
  #refused: RefusedName[] = []

  constructor() {
    super()

    this.onEffect<{ filter?: string }>('aliases:open', (p) => {
      const filter = String(p?.filter ?? '').trim().toLowerCase()
      // A word that asked for a behaviour is a request to LOOK at it, never
      // to put the window away — only the bare gesture toggles.
      if (filter) { this.#open = true; this.#filter = filter }
      else { this.#open = !this.#open; this.#filter = '' }
      this.#refusedFor = ''
      this.#refused = []
      this.#emit()
    })

    this.onEffect('aliases:close', () => {
      if (!this.#open) return
      this.#open = false
      this.#emit()
    })

    // The shell puts windows away and brings them back — idempotent, both
    // directions, announced by the panel's session (the lesson the comfy
    // window paid for: a park this drone never learned about leaves the next
    // /aliases toggling a window the screen already lost).
    this.onEffect('aliases:reopen', () => {
      if (this.#open) return
      this.#open = true
      this.#emit()
    })

    this.onEffect<{ command?: string; names?: string[] }>('aliases:set', (p) => {
      const command = String(p?.command ?? '').trim().toLowerCase()
      const held = this.#ledger()
      if (!command || !held) return
      const result = held.set(command, Array.isArray(p?.names) ? p.names : [])
      this.#refusedFor = result.refused.length ? command : ''
      this.#refused = [...result.refused]
      // The ledger's own aliases:changed re-emits; nothing more to do here.
    })

    // The one live source this window is a pure read of.
    this.onEffect('aliases:changed', () => { if (this.#open) this.#emit() })
  }

  #ledger(): ParticipantAliases | undefined {
    return get('@diamondcoreprocessor.com/ParticipantAliases') as ParticipantAliases | undefined
  }

  #emit(): void {
    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
      { entries?: () => { name: string; description?: string; hidden?: boolean }[] } | undefined
    const held = this.#ledger()

    const entries = (drone?.entries?.() ?? []).filter(e => !e.hidden)
    const canonical = new Set(entries.map(e => e.name.toLowerCase()))
    const owned = new Map<string, string>()
    for (const [command, names] of held?.all() ?? []) {
      for (const name of names) owned.set(name, command)
    }

    const rows: AliasRow[] = entries
      .map(entry => {
        const command = entry.name.toLowerCase()
        const given = [...(held?.aliasesFor(command) ?? [])]
        const candidates = (ALIAS_SUGGESTIONS[command] ?? []).filter(name =>
          !given.includes(name)
          && !canonical.has(name)
          && (owned.get(name) ?? command) === command)
        return { command, description: entry.description ?? '', given, candidates }
      })
      .sort((a, b) => a.command.localeCompare(b.command))

    const payload: AliasesRenderPayload = {
      open: this.#open,
      filter: this.#filter,
      rows,
      refusedFor: this.#refusedFor,
      refused: [...this.#refused],
    }
    this.emitEffect('aliases:render', payload)
  }
}

const _aliasesDrone = new AliasesDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/AliasesDrone',
  _aliasesDrone,
)
