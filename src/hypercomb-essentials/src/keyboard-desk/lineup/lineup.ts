// keyboard-desk/lineup/lineup.ts
//
// TRAIT `lineup` — automatons in a row. A sentence is the program, so a script is
// sentences in order: each step is said through the door machines use, and the
// next starts when that one has finished, where it left the hive. A lineup is its
// own resource, named by its signature. That makes it shareable, and it makes a
// lineup inside a lineup safe: a signature cannot contain itself.

import {
  EffectBus,
  REMOTE_SUBMIT,
  type RemoteSubmitOutcome,
  type RemoteSubmitRequest,
} from '@hypercomb/core'
import { lineupOf, wordCmd, wordOf, type LineupPart, type Step } from '../parts.js'

/** Long enough for a behaviour that opens something; a line that never answers
 *  must not hold the rest of the row for ever. */
const STEP_DEADLINE_MS = 30_000
const BARE_WORD = /^\/([a-z0-9][a-z0-9-]*)$/i

type ResourceStore = {
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (signature: string) => Promise<Blob | null>
}

const store = (): ResourceStore | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Store') as ResourceStore | undefined

/** A word is said with its slash, which is exact: no reading, no ambiguity. */
export const stepOf = (behaviourId: string): Step => {
  const word = wordOf(behaviourId)
  return word ? { say: `/${word}` } : { cmd: behaviourId }
}

export const commandOf = (steps: readonly Step[]): string | null => {
  const only = steps.length === 1 ? steps[0] : undefined
  if (!only) return null
  if ('cmd' in only) return only.cmd
  const bare = BARE_WORD.exec(only.say)
  return bare ? wordCmd(bare[1]!) : null
}

export const stepsOfScript = (text: string): readonly Step[] =>
  text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(say => ({ say }))

const isStep = (value: unknown): value is Step => {
  const step = (value ?? {}) as { say?: unknown; cmd?: unknown }
  return typeof step.say === 'string' || typeof step.cmd === 'string'
}

export const parseSteps = (text: string): readonly Step[] | null => {
  try {
    const record = JSON.parse(text) as { kind?: unknown; steps?: unknown }
    return record.kind === 'lineup' && Array.isArray(record.steps) ? record.steps.filter(isStep) : null
  } catch { return null }
}

export const keepLineup = async (steps: readonly Step[]): Promise<string | null> => {
  const bytes = JSON.stringify({ kind: 'lineup', steps })
  return await store()?.putResource?.(new Blob([bytes], { type: 'application/json' })) ?? null
}

export const readLineup = async (sig: string): Promise<readonly Step[] | null> => {
  const blob = await store()?.getResource?.(sig)
  return blob ? parseSteps(await blob.text()) : null
}

/** One line said, answered when its behaviour has finished. */
export const sayLine = (text: string): Promise<RemoteSubmitOutcome> => new Promise(answer => {
  const deadline = window.setTimeout(() => answer({ kind: 'unknown', reason: 'no answer in time' }), STEP_DEADLINE_MS)
  const settle = (outcome: RemoteSubmitOutcome): void => { window.clearTimeout(deadline); answer(outcome) }
  let heard = false
  EffectBus.emitTransient<RemoteSubmitRequest>(REMOTE_SUBMIT, { text, accept: () => { heard = true }, complete: settle })
  if (!heard) settle({ kind: 'refused', reason: 'the command line is not here' })
})

export const fireCommand = (cmd: string): void => {
  EffectBus.emit('keymap:invoke', { cmd, binding: null, event: null })
}

export interface RunPorts {
  say(text: string): Promise<RemoteSubmitOutcome>
  fire(cmd: string): void
  read(sig: string): Promise<readonly Step[] | null>
}

const refusal = (outcome: RemoteSubmitOutcome): string | null => {
  switch (outcome.kind) {
    case 'ran': {
      const failed = outcome.actions.find(action => !action.ok)
      return failed ? failed.error ?? failed.command : null
    }
    case 'ambiguous': return `"${outcome.word}" could be ${outcome.candidates.join(' or ')}`
    case 'refused': return outcome.reason
    // Not a failure: the line went down a path that cannot report back.
    case 'unknown': return null
  }
}

/** Every step in order. Null when the row finished, else where it stopped. */
export const runSteps = async (
  steps: readonly Step[],
  ports: RunPorts,
): Promise<{ step: string; reason: string } | null> => {
  for (const step of steps) {
    if ('say' in step) {
      const reason = refusal(await ports.say(step.say))
      if (reason) return { step: step.say, reason }
      continue
    }
    const sig = lineupOf(step.cmd)
    if (!sig) { ports.fire(step.cmd); continue }
    const inner = await ports.read(sig)
    if (!inner) return { step: step.cmd, reason: 'that lineup is not here' }
    const stopped = await runSteps(inner, ports)
    if (stopped) return stopped
  }
  return null
}

export const lineupPart: LineupPart = {
  stepOf,
  commandOf,
  stepsOfScript,
  keep: keepLineup,
  read: readLineup,
}
