// core/machine-census.ts
//
// THE VOCABULARY, RENDERED ONCE.
//
// `machine-grammar.ts` says how a behaviour DECLARES itself to a machine and
// `machine-admission.ts` says whether a given caller may say it. What was
// missing is the third thing every model-facing surface needs: the census
// turned into words — the list of verbs, their argument shapes, their
// consequences and one worked example each.
//
// That renderer lived in the shell (`ui/chat-window/hypercomb-grammar.ts`),
// which put it out of reach of every module: essentials may never import from
// shared. So the bridge tier — the one tier that can actually walk the hive —
// had no way to tell a model what this hive can do, and a bridged CLI received
// a question with all the material and none of the vocabulary. Claude Code
// only coped because a skill file happens to be checked into this repo; a
// freshly announced Codex or Gemini got nothing at all.
//
// The fix is NOT a second renderer in essentials. A hand-copied vocabulary is
// precisely the `CALLABLE_FORMS` mistake this codebase already paid for once:
// two lists, one of them quietly wrong, and a participant told their hive
// cannot do something it has done for months. So the renderer moved DOWN here,
// where core is visible to everyone, and both surfaces read it.
//
// What stays with each caller is the FRAMING, because the two transports offer
// genuinely different acts: the shell's local model is handed a function tool
// and told to call it, while a bridged session has bridge ops and a broker.
// The catalogue between those two sentences is the same text, and that is the
// only part that must never diverge.

import type { MachineGrammar } from './machine-grammar.js'
import { admitMachineCall, currentMachineGrant, type AdmissionEntry, type MachineGrant } from './machine-admission.js'

/**
 * One row of the live census, as the catalogue needs to read it: what the
 * admission gate weighs, plus the two fields only a renderer cares about.
 *
 * `description` and the full `machine` block are optional because the census
 * carries every behaviour, not just the callable ones — filtering is
 * `callableBehaviours`' job, and doing it in one place is what keeps the
 * catalogue and the gate from disagreeing about what exists.
 */
export interface CensusEntry extends AdmissionEntry {
  readonly description?: string
  readonly machine?: MachineGrammar
}

/**
 * The behaviours THIS caller may actually say, in census order.
 *
 * Two filters, and the order matters. A malformed declaration is dropped as a
 * DEFECT (it cannot be called, so teaching it would produce a line that fails);
 * a well-formed one the grant refuses is dropped as a BOUNDARY. Both leave the
 * catalogue, which is the point: a verb the grant refuses is never taught, so a
 * model is not offered `/remove` and then told no. That is the difference
 * between a boundary and a trap.
 *
 * Duplicate names collapse to the first — the census is a registry and a second
 * registration of the same word is a mistake, not a variant.
 */
export const callableBehaviours = <T extends CensusEntry>(
  entries: readonly T[],
  grant: MachineGrant = currentMachineGrant(),
): readonly T[] => {
  const seen = new Set<string>()
  const result: T[] = []
  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim().toLowerCase()
    if (!name || seen.has(name)) continue
    const machine = entry.machine
    if (!machine || typeof machine.forms !== 'string' || typeof machine.example !== 'string') continue
    if (!admitMachineCall(name, entry, 'model', grant).admit) continue
    seen.add(name)
    result.push({ ...entry, name })
  }
  return result
}

/**
 * The callable census as lines a model can read.
 *
 * The consequence is QUOTED, never composed. This module knows how far a verb
 * reaches but not what reaching there does, and a fixed sentence per reach
 * value is exactly how the catalogue once came to promise a confirmation
 * `/remove` does not perform for a leaf tile. If a behaviour says nothing
 * here, the catalogue says nothing.
 */
export const machineCatalogue = (
  entries: readonly CensusEntry[],
  grant: MachineGrant = currentMachineGrant(),
): string =>
  callableBehaviours(entries, grant).map(entry => {
    const machine = entry.machine!
    const forms = machine.forms.trim()
    const note = machine.consequence?.trim() ? ` ${machine.consequence.trim()}` : ''
    return `/${entry.name}${forms ? ` ${forms}` : ''} - ${entry.description ?? entry.name}.${note} Example: ${machine.example}`
  }).join('\n')
