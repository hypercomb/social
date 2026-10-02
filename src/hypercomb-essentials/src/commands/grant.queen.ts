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
//   /grant verbs            — the catalogue a model is taught under it, line by line
//   /grant allow <verb>…    — grant a verb a behaviour OFFERS to models (or: all)
//   /grant deny <verb>…     — take a grant back (or: all)
//
// SECURE BY DEFAULT (jwize, 2026-10-02). A behaviour with a `machine` block
// only offers itself; a model may say it once the participant grants it here,
// as declared when granted. Nothing is granted until they do.

import {
  QueenBee, EffectBus, admitMachineCall, machineCatalogue, callableBehaviours,
  DEFAULT_MACHINE_GRANT, GRANTED_REACHES, GRANTED_SCOPES,
  MACHINE_GRANT_KEY, MACHINE_ROSTER_KEY, currentMachineGrant, writeMachineGrant,
  grantedVerbOf, writeMachineRoster, type GrantedVerb,
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

type Census = Parameters<typeof machineCatalogue>[0]
const census = (): Census =>
  get<{ entries?(): Census }>('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? []

/** What behaviours OFFER to models, whatever is granted: every well-formed,
 *  unconcealed declaration — asked of the catalogue's own filter under the
 *  widest ceiling and no roster, so "offered" cannot mean two things. */
const offeredVerbs = (): Census => callableBehaviours(census(), { reach: 'destructive', scope: 'network' })

export class GrantQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'grant'
  override description = 'Set how far a machine may go in this hive'
  override descriptionKey = 'slash.grant'
  override options = ['none', ...GRANTED_REACHES.filter(r => r !== 'none'), ...GRANTED_SCOPES, 'verbs']
  override examples = [
    { input: '/grant', result: 'Shows what a machine may currently do here' },
    { input: '/grant none', result: 'A machine may say nothing in this hive' },
    { input: '/grant destructive', result: 'A machine may also use verbs that take things away' },
    { input: '/grant verbs', result: 'Shows, line by line, exactly what a model is taught it may say here' },
    { input: '/grant allow create title', result: 'A model may say /create and /title, as they are declared now' },
    { input: '/grant deny all', result: 'No verb is granted to a model' },
  ]

  // DELIBERATELY NO `machine` BLOCK, and here the absence is a security
  // property rather than an oversight: a ceiling a model can raise is not a
  // ceiling. The bridge CAN reach this word — under 'operator' a declaration
  // is not required — and that is correct, because that door is the
  // participant's own tool and refusing them their own switch there would only
  // send them to devtools to set the same key by hand.

  override slashComplete(args: string): readonly string[] {
    const query = args.trim().toLowerCase()
    const [word = '', ...rest] = query.split(/\s+/)
    if ((word === 'allow' || word === 'deny') && query.includes(' ')) {
      const typed = rest[rest.length - 1] ?? ''
      const names = ['all', ...offeredVerbs().map(entry => entry.name)]
      return names.filter(name => name.startsWith(typed)).map(name => [word, ...rest.slice(0, -1), name].join(' '))
    }
    const rungs = [...GRANTED_REACHES, ...GRANTED_SCOPES, 'verbs', 'allow ', 'deny ']
    return query ? rungs.filter(rung => rung.startsWith(query)) : rungs
  }

  protected async execute(args: string): Promise<void> {
    const current = currentMachineGrant()
    if (args.trim().toLowerCase() === 'verbs') { this.#showCatalogue(current); return }
    const [word = '', ...names] = args.trim().toLowerCase().split(/\s+/)
    if (word === 'allow' || word === 'deny') { this.#roster(word, names, current); return }
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

  /** GRANT OR TAKE BACK, verb by verb, each recorded as declared right now. A
   *  name that offers nothing is refused rather than recorded: a grant for a
   *  word no behaviour offers is a grant waiting for whatever claims it next. */
  #roster(word: 'allow' | 'deny', names: readonly string[], current: MachineGrant): void {
    if (!names.length) { this.#log(`Grant — say which verbs: /grant ${word} <verb> … or /grant ${word} all`); return }
    const offered = offeredVerbs()
    const all = names.includes('all')
    const unknown = all ? [] : names.filter(name => !offered.some(entry => entry.name === name))
    if (unknown.length) {
      this.#log(`Grant — no behaviour offers ${unknown.map(name => `/${name}`).join(' ')} to models; /grant verbs shows what is offered`)
      return
    }
    const held = current.granted ?? []
    const chosen = all ? offered : offered.filter(entry => names.includes(entry.name))
    const next: GrantedVerb[] = word === 'allow'
      ? [...held.filter(verb => !chosen.some(entry => entry.name === verb.name)), ...chosen.map(grantedVerbOf)]
      : all ? [] : held.filter(verb => !names.includes(verb.name))
    try { localStorage.setItem(MACHINE_ROSTER_KEY, writeMachineRoster(next)) }
    catch (error) {
      console.warn('[grant] the roster could not be stored:', error)
      this.#log('Grant — this browser will not store grants, so nothing changed')
      return
    }
    this.#log(`Grant — ${this.#state(currentMachineGrant())}`)
  }

  #state(grant: MachineGrant): string {
    if (grant.reach === 'none') return 'a machine may say nothing here'
    const names = admittedNames(grant)
    const offered = offeredVerbs().length
    const granted = grant.granted?.length ?? 0
    const listed = names.length
      ? `${names.length} ${names.length === 1 ? 'verb' : 'verbs'}: ${names.map(n => `/${n}`).join(' ')}`
      : granted === 0 && offered > 0
        ? `nothing yet — ${offered} ${offered === 1 ? 'verb is' : 'verbs are'} offered and none granted; /grant verbs shows them, /grant allow <verb> grants one`
        : 'nothing, as no granted behaviour declares itself within it'
    const standard = grant.reach === DEFAULT_MACHINE_GRANT.reach
      && grant.scope === DEFAULT_MACHINE_GRANT.scope
    return `${grant.reach} at the ${grant.scope}${standard ? ' (the standing default)' : ''} — ${listed}`
  }

  /** A GRANT IS A THING A PARTICIPANT MUST BE ABLE TO READ BEFORE GIVING IT
   *  (surface audit, item 8): no surface rendered the catalogue at all. This
   *  shows the very text a model is taught under the current ceiling — the
   *  same renderer, so what is read here cannot drift from what is taught —
   *  gentlest verb first, one line each. */
  #showCatalogue(grant: MachineGrant): void {
    if (grant.reach === 'none') { this.#log('Grant — a machine may say nothing here, so a model is taught no verbs'); return }
    const entries = get<{ entries?(): Parameters<typeof machineCatalogue>[0] }>('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? []
    const lines = machineCatalogue(entries, grant).split('\n').filter(Boolean)
    this.#log(`Grant — under ${grant.reach} at the ${grant.scope}, a model is taught ${lines.length} ${lines.length === 1 ? 'verb' : 'verbs'}${lines.length ? ':' : ''}`)
    for (const line of lines) this.#log(line)
    // What is OFFERED but not taught: not granted, granted as an older
    // declaration, or past the ceiling. Named, so a grant is never a guess.
    const taught = new Set(callableBehaviours(entries, grant).map(entry => entry.name))
    const waiting = offeredVerbs().filter(entry => !taught.has(entry.name)).map(entry => `/${entry.name}`)
    if (waiting.length) this.#log(`Grant — offered but not taught: ${waiting.join(' ')} (/grant allow <verb>, or raise the ceiling)`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const _grant = new GrantQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GrantQueenBee', _grant)
