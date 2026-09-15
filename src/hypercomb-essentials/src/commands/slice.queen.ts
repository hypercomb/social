// commands/slice.queen.ts

import { QueenBee, EffectBus, get } from '@hypercomb/core'
import { cellLocationSig } from '../editor/tile-properties.js'
import { mintSlice } from '../assistant/context-slices.js'

const SIG_RE = /^[0-9a-f]{64}$/i

/**
 * /slice — choose a handful of tiles as one merkle SLICE, so an agent (or a
 * participant) that has decided these tiles belong together can hand a
 * model ONE sig instead of several. The choosing is an ACT (context-
 * slices.ts's file header) — this queen is simply the command-line door
 * onto `mintSlice`, same reasoning as `/deposit`'s: any caller, human or
 * agent, reaches truth-minting through the command line, and no special
 * "agent mode" exists or is needed.
 *
 * Syntax:
 *   /slice <name> = <member>, <member>, ...
 *
 * NO SELECTION FORM. `/deposit` keeps one for a person clicking tiles first;
 * a slice's whole point is a NAMED, unambiguous set an agent can speak in
 * one line, so this queen only accepts the named form. A member is either a
 * 64-hex layer sig or a tile name on the current page, resolved the same
 * way `/deposit`'s named form resolves its target:
 * `cellLocationSig(parentSegments, label)` → `HistoryService.currentLayerRefAt`.
 */

type HistoryServiceLike = {
  currentLayerRefAt(locationSig: string): Promise<{ layerSig: string } | null>
}

type LineageLike = { explorerSegments?: () => readonly string[] }

export class SliceQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'slice'
  override description = 'Choose a handful of tiles as one merkle slice — an agent-or-participant-chosen set that projects as one'
  override options = ['<name> = <member>, <member>']
  override examples = [
    { input: '/slice cigars = Cohibas, Padrons, Montecristos', result: 'Mints a slice named "cigars" from three tiles on this page' },
  ]

  protected async execute(args: string): Promise<void> {
    const parsed = readSliceLine(args)
    if ('refuse' in parsed) { this.#log(`Slice — ${parsed.refuse}`); return }

    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
    if (!history) { this.#log('Slice — history is not ready yet'); return }

    const parentSegments = lineage?.explorerSegments?.() ?? []
    const memberSigs: string[] = []
    let unresolved = 0

    for (const member of parsed.members) {
      if (SIG_RE.test(member)) { memberSigs.push(member.toLowerCase()); continue }
      const locationSig = await cellLocationSig(parentSegments, member)
      const ref = locationSig ? await history.currentLayerRefAt(locationSig) : null
      if (ref?.layerSig) memberSigs.push(ref.layerSig)
      else unresolved++
    }

    if (memberSigs.length === 0) {
      this.#log(`Slice — none of the ${parsed.members.length} member${parsed.members.length === 1 ? '' : 's'} named resolved to a tile on this page`)
      return
    }

    const result = await mintSlice(parsed.name, memberSigs)
    this.#log(result.ok
      ? `Slice ${parsed.name} — ${result.sig}${unresolved ? ` (${unresolved} member${unresolved === 1 ? '' : 's'} not found)` : ''}`
      : `Slice — ${result.reason}`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '#' })
  }
}

/** `<name> = <member>, <member>, ...` — the only form. Local to this queen,
 *  same reasoning as `/deposit`'s own copy: each command owns its tiny
 *  parser rather than sharing one across unrelated behaviours. */
const readSliceLine = (
  args: string,
): { name: string; members: string[] } | { refuse: string } => {
  const equals = args.indexOf('=')
  if (equals === -1) return { refuse: 'syntax is /slice <name> = <member>, <member>' }
  const name = args.slice(0, equals).trim()
  const rest = args.slice(equals + 1).trim()
  if (!name) return { refuse: '/slice needs a name before =' }
  const members = rest.split(',').map(m => m.trim()).filter(Boolean)
  if (members.length === 0) return { refuse: '/slice needs at least one member after =' }
  return { name, members }
}

const _slice = new SliceQueenBee()
