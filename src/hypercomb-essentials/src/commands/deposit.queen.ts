// commands/deposit.queen.ts

import { QueenBee, EffectBus, get } from '@hypercomb/core'
import { cellLocationSig } from '../editor/tile-properties.js'
import { mintDeposit } from '../pheromones/pheromone-deposits.js'

/**
 * /deposit — author a signed pheromone deposit on a tile's exact content.
 *
 * This is deliberately NOT `/keyword`. A keyword is a LOCATION mark: the
 * author's own classification of their own tile, living in the layer,
 * belonging (per documentation/pheromones.md's 2026-09-13 reframe) to the
 * hypergraph's naming model. A deposit is a SIGNATURE mark: a signed claim
 * that this depositor — a person, another participant, or an agent that read
 * the content — thinks these exact BYTES are worth a reader's attention. It
 * travels with the bytes, not the tile's name, and it is judged against a
 * reader's own private interests (pheromones/intake-filter.ts), never shown
 * as a label.
 *
 * ANY CALLER REACHES THIS THE SAME WAY. `mintDeposit` does not know or care
 * whether a human typed this command or an agent's routine did — this queen
 * is simply the command-line door onto it, and the command line is exactly
 * where an agent acting on the hive already speaks (documentation/
 * hive-read-fence.md). No special "agent mode" exists or is needed.
 *
 * Syntax:
 *   /deposit mark                 — deposit on the selected tile(s)
 *   /deposit mark1, mark2         — deposit several marks at once
 *   /deposit cell = mark          — deposit on a NAMED tile, whatever is selected
 *
 * THE NAMED FORM IS FOR SPEAKERS, same reasoning as `/keyword`'s: an agent
 * saying `/deposit roadmap = worth-a-look` needs no selection state, and it
 * is the only form that names its target unambiguously regardless of what
 * is or is not currently picked on screen.
 *
 * Resolving a target's content signature costs one lineage-sig derivation
 * (`cellLocationSig`) plus one head read (`HistoryService.currentLayerRefAt`)
 * per tile — deliberately NOT wired into the mouse-click scent gesture in
 * tile-overlay.drone.ts, which resolves tiles by LABEL only and has no
 * content signature in hand at click time. That gesture stays a location
 * mark; this command is the sig-addressed door.
 */

type HistoryServiceLike = {
  currentLayerRefAt(locationSig: string): Promise<{ layerSig: string } | null>
}

type SelectionServiceLike = { selected: ReadonlySet<string> }
type LineageLike = { explorerSegments?: () => readonly string[] }

export class DepositQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'deposit'
  override description = 'Deposit a signed pheromone — an authored interest-signal on a tile\'s exact content'
  override options = ['<mark>', '<mark1>, <mark2>', '<cell> = <mark>']
  override examples = [
    { input: '/deposit cigars', result: 'Deposits "cigars" on the selected tile(s)' },
    { input: '/deposit roadmap = worth-a-look', result: 'Deposits on the tile "roadmap", whatever is selected' },
  ]

  protected async execute(args: string): Promise<void> {
    const named = readNamedTarget(args)
    if (named && 'refuse' in named) { this.#log(`Deposit — ${named.refuse}`); return }

    const marks = (named ? named.marks : args).split(',').map(m => m.trim()).filter(Boolean)
    if (marks.length === 0) { this.#log('Deposit — needs at least one mark'); return }

    const selection = get('@diamondcoreprocessor.com/SelectionService') as SelectionServiceLike | undefined
    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined

    const labels = named ? [named.cell] : selection ? Array.from(selection.selected) : []
    if (labels.length === 0) { this.#log('Deposit — nothing selected, and no <cell> = <mark> target given'); return }
    if (!history) { this.#log('Deposit — history is not ready yet'); return }

    const parentSegments = lineage?.explorerSegments?.() ?? []
    let deposited = 0
    let refused = 0

    for (const label of labels) {
      const locationSig = await cellLocationSig(parentSegments, label)
      const ref = locationSig ? await history.currentLayerRefAt(locationSig) : null
      if (!ref?.layerSig) { refused += marks.length; continue }
      for (const mark of marks) {
        const result = await mintDeposit(ref.layerSig, mark)
        if (result.ok) deposited++
        else refused++
      }
    }

    this.#log(deposited > 0
      ? `Deposited ${marks.join(', ')} on ${labels.length} tile${labels.length === 1 ? '' : 's'}${refused ? ` (${refused} refused)` : ''}`
      : `Deposit — nothing landed${refused ? ` (${refused} refused — no signer available, or the tile has no content yet)` : ''}`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '#' })
  }
}

/** `<cell> = <marks>` — the named form, or undefined when the line uses
 *  none. Local to this queen, same reasoning as `/keyword`'s own copy: each
 *  command owns its tiny parser rather than sharing one across unrelated
 *  behaviours. */
const readNamedTarget = (
  args: string,
): { cell: string; marks: string } | { refuse: string } | undefined => {
  const equals = args.indexOf('=')
  if (equals === -1) return undefined
  const cell = args.slice(0, equals).trim()
  const marks = args.slice(equals + 1).trim()
  if (!cell || cell.includes('/') || cell.includes(String.fromCharCode(92))) {
    return { refuse: 'the named form is /deposit <cell> = <mark>, one tile on this page' }
  }
  if (!marks) return { refuse: '/deposit needs at least one mark after =' }
  return { cell, marks }
}

const _deposit = new DepositQueenBee()
