// commands/grant.queen.ts
//
// `/grant` — how far a machine may go in this hive, said by the person whose
// hive it is.
//
// WHY THERE HAD TO BE A WORD. The model channel's capability switched itself
// on: `canAct` was true whenever some behaviour declared itself callable and a
// trusted local model was reachable. Nobody chose that. The participant's only
// way to withdraw it was to stop running a local model — which is to say, no
// way at all, and certainly not one they would find. A capability that arrives
// because two unrelated conditions happen to be true is not a grant; it is a
// default nobody set.
//
// EVERY ACT HAS A WORD is standing doctrine here, and a security ceiling is an
// act. So the ceiling core's `machine-admission` reads is written by this verb
// and nothing else, and `/grant none` closes the door on one line.
//
// IT GOVERNS MACHINES, NEVER THE PARTICIPANT. Typing is not a call to be
// admitted — the keyboard consults no gate and this word does not narrow it.
// What it bounds is the bridge and the model channel, which is why lowering it
// can make the model channel disappear entirely: with nothing admitted there is
// nothing to offer, and the tool is not offered.
//
// Syntax:
//   /grant                  — what is granted now, and what that admits
//   /grant destructive      — raise how MUCH a machine may change
//   /grant additive         — lower it
//   /grant page             — narrow how FAR a change may travel
//   /grant none             — a machine may say nothing here

import {
  QueenBee, EffectBus, admitMachineCall,
  DEFAULT_MACHINE_GRANT, GRANTED_REACHES, GRANTED_SCOPES,
  MACHINE_GRANT_KEY, currentMachineGrant, writeMachineGrant,
  type AdmissionEntry, type MachineGrant, type GrantedReach, type MachineScope,
} from '@hypercomb/core'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const isReach = (word: string): word is GrantedReach =>
  (GRANTED_REACHES as readonly string[]).includes(word)
const isScope = (word: string): word is MachineScope =>
  (GRANTED_SCOPES as readonly string[]).includes(word)

type Reading =
  | { readonly show: true }
  | { readonly grant: MachineGrant }
  | { readonly refuse: string }

/** ONE reading for both callers, as every queen here keeps: the participant's
 *  parser and the machine's admission gate must never disagree about what a
 *  line means. A word may name either rung — the two ladders share no value,
 *  so which axis is being moved is unambiguous from the word alone. */
export const readGrant = (args: string, from: MachineGrant): Reading => {
  const words = args.trim().toLowerCase().split(/[\s,/]+/).filter(Boolean)
  if (!words.length) return { show: true }
  let grant = from
  for (const word of words) {
    if (isReach(word)) grant = { ...grant, reach: word }
    // `none` closes the door by reach alone, and is caught above; scope has no
    // closed rung because a scope of 'local' still admits a lens, which is a
    // different and useful position to hold.
    else if (isScope(word)) grant = { ...grant, scope: word }
    else return {
      refuse: `"${word}" is not something to grant — say one of ${
        [...GRANTED_REACHES, ...GRANTED_SCOPES].join(', ')}`,
    }
  }
  return { grant }
}

/** What the ceiling currently admits, ASKED OF THE GATE ITSELF and named from
 *  the live census. A participant asking "what did I just grant" wants the
 *  verbs, not the vocabulary — and an answer computed any other way would be a
 *  second opinion about admission, which is the whole class of bug this gate
 *  was built to end. */
const admittedNames = (grant: MachineGrant): readonly string[] =>
  (get<{ entries?(): readonly AdmissionEntry[] }>(
    '@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? [])
    .filter(entry => entry.machine && admitMachineCall(entry.name, entry, 'model', grant).admit)
    .map(entry => entry.name)

export class GrantQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'grant'
  override description = 'Set how far a machine may go in this hive'
  override descriptionKey = 'slash.grant'
  override options = ['none', ...GRANTED_REACHES.filter(r => r !== 'none'), ...GRANTED_SCOPES]
  override examples = [
    { input: '/grant', result: 'Shows what a machine may currently do here' },
    { input: '/grant none', result: 'A machine may say nothing in this hive' },
    { input: '/grant destructive', result: 'A machine may also use verbs that take things away' },
  ]

  // DELIBERATELY NO `machine` BLOCK, and here the absence is a security
  // property rather than an oversight: a ceiling a model can raise is not a
  // ceiling. The bridge CAN reach this word — under 'operator' a declaration
  // is not required — and that is correct, because that door is the
  // participant's own tool and refusing them their own switch there would only
  // send them to devtools to set the same key by hand.

  override slashComplete(args: string): readonly string[] {
    const query = args.trim().toLowerCase()
    const rungs = [...GRANTED_REACHES, ...GRANTED_SCOPES]
    return query ? rungs.filter(rung => rung.startsWith(query)) : rungs
  }

  protected async execute(args: string): Promise<void> {
    const current = currentMachineGrant()
    const reading = readGrant(args, current)

    if ('refuse' in reading) { this.#log(`Grant — ${reading.refuse}`); return }
    if ('show' in reading) { this.#log(`Grant — ${this.#state(current)}`); return }

    const { grant } = reading
    try { localStorage.setItem(MACHINE_GRANT_KEY, writeMachineGrant(grant)) }
    catch (error) {
      // A ceiling that cannot be stored must not be REPORTED as set. A private
      // window with storage blocked would otherwise leave the participant
      // believing they had closed a door that is still open.
      console.warn('[grant] the ceiling could not be stored:', error)
      this.#log('Grant — this browser will not store the ceiling, so nothing changed')
      return
    }
    // Read it back rather than echoing what was asked: the stored form is what
    // the gate will consult, and a clamp on the way in would otherwise go
    // unmentioned.
    this.#log(`Grant — ${this.#state(currentMachineGrant())}`)
  }

  #state(grant: MachineGrant): string {
    if (grant.reach === 'none') return 'a machine may say nothing here'
    const names = admittedNames(grant)
    const listed = names.length
      ? `${names.length} ${names.length === 1 ? 'verb' : 'verbs'}: ${names.map(n => `/${n}`).join(' ')}`
      : 'nothing, as no behaviour declares itself within it'
    const standard = grant.reach === DEFAULT_MACHINE_GRANT.reach
      && grant.scope === DEFAULT_MACHINE_GRANT.scope
    return `${grant.reach} at the ${grant.scope}${standard ? ' (the standing default)' : ''} — ${listed}`
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const _grant = new GrantQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GrantQueenBee', _grant)
