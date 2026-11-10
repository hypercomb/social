// hypercomb-shared/ui/command-line/remote-door.headless.ts
//
// THE REMOTE DOOR WITH NO COMMAND LINE. A try- door carries no interface
// (jwize, 2026-11-10: "your AI should definitely be able to do stuff through
// behaviors but the interface is not included in the debugging on
// subdomains"). The command line is where a machine's sentence was heard
// (`REMOTE_SUBMIT`, command-line.component.ts), so a page without one answered
// every caller "no command line is open to say it". This is that door for a
// page that mounts no command line: the same contract, heard without a screen.
//
// IT RUNS BEHAVIOUR WORDS AND NOTHING ELSE. Two kinds of line run here: a
// sentence the Common Tongue reads, and a plain `/word args` call. Both end in
// the behaviour drone's own `execute`, awaited, so the receipt says what ran.
// The command line's other grammar (a selection `[a, b]`, a `~` or `#` sigil,
// a path, a tag, `tile@view`) is carried out by the component itself and has
// no executor here. Such a line is REFUSED and runs nothing; it is never
// answered `unknown`. Everything a session does on a door is a word
// (documentation/speak-dont-bridge.md).
//
// THE GATE IS CORE'S. Every verb in the line is asked of `admitMachineCall`
// as an operator's, with the participant's grant, and then of the behaviour's
// own `refuse`, exactly as the command line's door asks. The verbs are read by
// the same `dispatchedCallsOf`, so a line judged there is judged the same way
// here. This file decides nothing about which word may run.
//
// ONE DOOR ANSWERS. Where a command line is mounted it is the door, and this
// one stays silent: two listeners would run a line twice.

import {
  EffectBus, hypercomb, REMOTE_SUBMIT,
  admitMachineCall, spokenEntry, currentMachineGrant,
  type AdmissionEntry, type RemoteSubmitAction, type RemoteSubmitOutcome, type RemoteSubmitRequest,
} from '@hypercomb/core'
import { dispatchedCallsOf, speaksStructure, type SpokenCall } from './remote-verbs'

const BEHAVIOURS_KEY = '@diamondcoreprocessor.com/SlashBehaviourDrone'
const READER_KEY = '@diamondcoreprocessor.com/UtteranceReader'

/** What a line of the command line's own grammar is told on a door. */
export const NO_COMMAND_LINE =
  'this door has no command line, so only a behaviour word runs here — say the word and its arguments'

type CensusRow = AdmissionEntry & {
  readonly machine?: AdmissionEntry['machine'] & { readonly refuse?: (args: string) => string | undefined }
}

type Behaviours = {
  entries?(): readonly CensusRow[]
  retired?(name: string): AdmissionEntry['retired']
  has?(name: string): boolean
  rawArgs?(name: string): boolean
  execute?(name: string, args: string): Promise<unknown>
}

type Reading = {
  readonly spans: readonly { readonly role: string; readonly text: string; readonly candidates?: readonly { readonly name: string }[] }[]
  readonly actions: readonly { readonly command: string; readonly args: string }[]
}

type Reader = { read(text: string): Reading | null }

const resolve = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** Each action through the behaviour drone's own `execute`, in word order.
 *  `ok` is did-not-throw, never proof the hive changed. */
const run = async (
  behaviours: Behaviours | undefined,
  actions: readonly { readonly command: string; readonly args: string }[],
): Promise<RemoteSubmitAction[]> => {
  const execute = behaviours?.execute?.bind(behaviours)
  if (!execute) {
    return actions.map(action => ({ ...action, ok: false, error: 'no behaviour executor is registered' }))
  }
  const outcomes: RemoteSubmitAction[] = []
  for (const { command, args } of actions) {
    // Asked again per action: a word can stop being claimed between the
    // reading and the run, and `execute` answers an unclaimed name silently.
    if (behaviours?.has && !behaviours.has(command)) {
      outcomes.push({ command, args, ok: false, error: 'no behaviour claims that name' })
      continue
    }
    try {
      await execute(command, args)
      outcomes.push({ command, args, ok: true })
    } catch (error) {
      outcomes.push({ command, args, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  // The processor is the one dispatcher of `synchronize`.
  void new hypercomb().act()
  return outcomes
}

/** Say one line on a page with no command line, and answer for it. */
export const sayHeadless = async (text: string): Promise<RemoteSubmitOutcome> => {
  const behaviours = resolve<Behaviours>(BEHAVIOURS_KEY)

  // A word that keeps its arguments verbatim is canonical with or without its
  // slash: the reader is skipped and only that word is judged.
  const trimmed = text.trimStart()
  const word = trimmed.replace(/^\//, '').split(/[\s(\[]/, 1)[0]
  const keeps = !trimmed.startsWith('/') && !!word && !!behaviours?.rawArgs?.(word)
  const line = keeps ? '/' + trimmed : text
  const prose = !line.trimStart().startsWith('/')
  const reading = prose ? resolve<Reader>(READER_KEY)?.read(text.toLowerCase()) ?? null : null

  const named: readonly SpokenCall[] = reading?.actions.length
    ? reading.actions.map(action => ({ verb: action.command, args: action.args }))
    : dispatchedCallsOf(line)
  // A line that names nothing is asked about too, as the empty verb.
  const spokenCalls = named.length ? named : [{ verb: '' }]

  const census = behaviours?.entries?.() ?? []
  const entryOf = (verb: string): CensusRow | undefined => {
    const live = spokenEntry(verb, census)
    const retired = live || !verb ? undefined : behaviours?.retired?.(verb)
    return live ?? (retired ? { name: verb, retired } : undefined)
  }
  const grant = currentMachineGrant()
  for (const { verb, args } of spokenCalls) {
    const entry = entryOf(verb)
    const verdict = admitMachineCall(verb, entry, 'operator', grant)
    const refused = !verdict.admit ? verdict.reason
      : args === undefined ? undefined : entry?.machine?.refuse?.(args)
    if (refused) return { kind: 'refused', reason: refused }
  }

  if (reading?.actions.length) {
    const ambiguous = reading.spans.find(span => span.role === 'ambiguity')
    if (ambiguous) {
      return {
        kind: 'ambiguous',
        word: ambiguous.text,
        candidates: (ambiguous.candidates ?? []).map(candidate => candidate.name),
      }
    }
    return { kind: 'ran', actions: await run(behaviours, reading.actions) }
  }

  if (prose && !speaksStructure(line)) {
    return { kind: 'refused', reason: 'no word in this line matched a behaviour, so nothing ran — to make a tile, say: create <name>' }
  }

  const only = !prose && named.length === 1 ? named[0] : undefined
  if (only?.verb && only.args !== undefined && behaviours?.has?.(only.verb)) {
    return { kind: 'ran', actions: await run(behaviours, [{ command: only.verb, args: only.args }]) }
  }

  return { kind: 'refused', reason: NO_COMMAND_LINE }
}

/** Is a command line mounted on this page? Then it is the door. */
const commandLineMounted = (): boolean => {
  try { return !!globalThis.document?.querySelector('hc-command-line') } catch { return false }
}

let uninstall: (() => void) | undefined

/** Hear `REMOTE_SUBMIT` on this page. Idempotent; returns the way to stop. */
export const installHeadlessRemoteDoor = (): (() => void) => {
  if (uninstall) return uninstall
  const off = EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, ({ text, accept, complete }) => {
    if (commandLineMounted()) return
    accept?.()
    // ALWAYS SETTLE, EXACTLY ONCE: a caller never answered hangs.
    let settled = false
    const settle = (outcome: RemoteSubmitOutcome): void => {
      if (settled) return
      settled = true
      try { complete?.(outcome) }
      catch (error) { console.warn('[remote-submit] receipt handler threw:', error) }
    }
    void sayHeadless(String(text ?? ''))
      .then(settle)
      .catch(error => settle({ kind: 'unknown', reason: error instanceof Error ? error.message : String(error) }))
  })
  uninstall = () => { off(); uninstall = undefined }
  return uninstall
}
