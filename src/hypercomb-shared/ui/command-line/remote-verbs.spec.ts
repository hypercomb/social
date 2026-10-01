// ui/command-line/remote-verbs.spec.ts — a remote line is judged on the verbs
// it will be DISPATCHED on, however they were spelled and wherever they sit.
//
// THE REGRESSION THIS GUARDS. The remote door read a slash line's verb with
// core's `canonicalVerbOf` — lowercase, hard against the slash, the model
// channel's shape — and skipped the gate when that read nothing. The dispatch
// behind the door is looser, and each looseness ran a refused verb unasked:
//   `/Remove drafts`, `/ remove drafts`   the registry folds, the executor trims
//   `[drafts]/remove`, `/select[x]/prune` the op after a bracket is a verb too
//   `~drafts`, `[~drafts]`                the sigil removes with no word at all
//   `meetup@postit`                       a view that is not attachable runs its own word
//
// The gate's own rule is asserted in core (machine-admission.spec.ts) and the
// declarations it reads in essentials (commands/remote-refusal.spec.ts). This
// is the piece between them: what the door hands the gate.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  admitMachineCall, spokenEntry, canonicalVerbOf, DEFAULT_MACHINE_GRANT,
  type AdmissionEntry, type MachineAdmission, type MachineGrant,
} from '@hypercomb/core'
import { dispatchedVerbsOf, slashVerbsOf, viewCommandOf, type FeatureReading } from './remote-verbs'

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8')
const component = read('hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts')

/** The source of one member of the component, from its opening to the next
 *  member at the same depth. */
const member = (start: string): string => {
  const from = component.indexOf(start)
  expect(from, start).toBeGreaterThan(-1)
  const to = component.indexOf('\n  }\n', from)
  expect(to).toBeGreaterThan(from)
  return component.slice(from, to)
}

/** Census rows shaped as the shipped ones are: `/remove` and `/cut`
 *  destructive on the page, `rm` a name a participant gave, `/prune` concealed,
 *  `/postit` a view's word an operator may say, `/lounge` a view still a prototype. */
const census: readonly AdmissionEntry[] = [
  { name: 'create', machine: { reach: 'additive', scope: 'page' } },
  { name: 'copy' },
  { name: 'move' },
  { name: 'cut', machine: { reach: 'destructive', scope: 'page' } },
  { name: 'remove', aliases: ['rm'], machine: { reach: 'destructive', scope: 'page' } },
  { name: 'prune', hidden: true },
  { name: 'postit', machine: { reach: 'editing', scope: 'tile' } },
  { name: 'lounge', prototype: true },
]

/** The door's own loop: every verb judged, the first refusal answers, and a
 *  line that names nothing asked about as the empty verb. */
const door = (
  line: string,
  featureOf?: (line: string) => FeatureReading | null,
  grant: MachineGrant = DEFAULT_MACHINE_GRANT,
): MachineAdmission | null => {
  const named = dispatchedVerbsOf(line, featureOf)
  for (const verb of named.length ? named : ['']) {
    const verdict = admitMachineCall(verb, spokenEntry(verb, census), 'operator', grant)
    if (!verdict.admit) return verdict
  }
  return null
}

/** `#executeSlashBehaviour`'s split — the name the registry is then asked for. */
const executorName = (line: string): string => {
  const raw = line.slice(1).trim()
  const spaceIdx = raw.indexOf(' ')
  const parenIdx = raw.indexOf('(')
  const delimIdx = spaceIdx >= 0 && (parenIdx < 0 || spaceIdx < parenIdx) ? spaceIdx
    : parenIdx >= 0 ? parenIdx
    : -1
  return delimIdx === -1 ? raw : raw.slice(0, delimIdx)
}

const refusedRemove = {
  admit: false,
  reason: '/remove is destructive, and this hive grants a machine no further than editing',
}

const smuggled = [
  '/Remove drafts',
  '/REMOVE drafts',
  '/ remove drafts',
  '/\tRemove drafts',
  '  /Remove drafts',
  '/Remove(drafts)',
  '/Remove[drafts, notes]',
]

describe('the head of a remote slash line', () => {
  it('is the word the registry resolves, whatever its case and wherever it sits after the slash', () => {
    for (const line of smuggled) expect(slashVerbsOf(line), line).toEqual(['remove'])
    expect(slashVerbsOf('/RM drafts')).toEqual(['rm'])
  })

  it('is what the canonical reading could not see — which is why the gate was never asked', () => {
    // `canonicalVerbOf` is right for the model channel, whose parser accepts
    // nothing else. This door accepts the line a person would type.
    expect(canonicalVerbOf('/Remove drafts')).toBe('')
    expect(canonicalVerbOf('/ remove drafts')).toBe('')
  })

  it('reads a canonical line exactly as before', () => {
    expect(slashVerbsOf('/remove drafts')).toEqual(['remove'])
    expect(slashVerbsOf('/create roadmap')).toEqual(['create'])
    expect(slashVerbsOf('/collapse-history')).toEqual(['collapse-history'])
    expect(slashVerbsOf('/create /remove')).toEqual(['create'])
    expect(slashVerbsOf('/models request a planner that holds forty files')).toEqual(['models'])
  })

  it('keeps the canonical reading beside it, so nothing refused before is admitted now', () => {
    // The registry holds no `remove.drafts`, so this line removes nothing —
    // but the door named `remove` in it before, and still does.
    expect(slashVerbsOf('/remove.drafts')).toContain('remove')
    expect(door('/remove.drafts')?.admit).toBe(false)
  })

  it('names nothing in prose, and nothing in a bare slash', () => {
    for (const line of ['remove drafts', 'Remove drafts', '', '/', '/   ']) {
      expect(slashVerbsOf(line), line).toEqual([])
      expect(dispatchedVerbsOf(line), line).toEqual([])
    }
  })
})

describe('what the gate answers once it is asked about a slash line', () => {
  it('refuses the canonical line — the baseline', () => {
    expect(door('/remove drafts')).toEqual(refusedRemove)
  })

  it('gives every other spelling the same refusal', () => {
    for (const line of smuggled) expect(door(line), line).toEqual(refusedRemove)
  })

  it('follows a participant alias through a capital too', () => {
    expect(door('/Rm drafts')?.admit).toBe(false)
    expect(door('/ RM drafts')?.admit).toBe(false)
  })

  it('refuses a concealed verb, capitalised or not', () => {
    expect(door('/prune')?.admit).toBe(false)
    expect(door('/Prune')).toEqual(door('/prune'))
    expect(door('/ PRUNE')).toEqual(door('/prune'))
  })

  it('still admits what an operator may say, in any case', () => {
    expect(door('/create roadmap')).toBeNull()
    expect(door('/Create roadmap')).toBeNull()
    // An unresolved word is the create-goto convenience, not a refusal — and a
    // word outside the canonical alphabet is still only a word.
    expect(door('/2026 plans')).toBeNull()
    expect(door('/日本語')).toBeNull()
  })
})

describe('the op after a bracket is a verb, and is judged as one', () => {
  it('is read where the select dispatch reads it: after the first `]`', () => {
    expect(dispatchedVerbsOf('[drafts]/remove')).toEqual(['remove'])
    expect(dispatchedVerbsOf('[a, b]/Remove')).toEqual(['remove'])
    expect(dispatchedVerbsOf('  [a, b]/cut')).toEqual(['cut'])
    expect(dispatchedVerbsOf('[a]/move(3)')).toEqual(['move'])
    expect(dispatchedVerbsOf('[a]/keyword work')).toEqual(['keyword'])
    expect(dispatchedVerbsOf('[x]/prune')).toEqual(['prune'])
  })

  it('reads the legacy forms through the dispatch\'s own normaliser', () => {
    expect(dispatchedVerbsOf('/select[a, b]/remove')).toEqual(['select', 'remove'])
    expect(dispatchedVerbsOf('/SELECT[x]/Prune')).toEqual(['select', 'prune'])
    expect(dispatchedVerbsOf('/format[a]')).toEqual(['format'])
    // `/fp[a]/remove` normalises to `[a]/format/remove`: only the first op runs.
    expect(dispatchedVerbsOf('/fp[a]/remove')).toEqual(['fp', 'format'])
  })

  it('judges the hyphenated word beside the one the dispatch stops at', () => {
    expect(dispatchedVerbsOf('[a]/break-apart')).toEqual(['break', 'break-apart'])
  })

  it('names nothing where there is no op', () => {
    expect(dispatchedVerbsOf('[a, b]')).toEqual([])
    expect(dispatchedVerbsOf('[a, b]:focus')).toEqual([])
    expect(dispatchedVerbsOf('[a, b]:[focus, ~stale]')).toEqual([])
    expect(dispatchedVerbsOf('[a, b')).toEqual([])
    // Not a LEADING bracket: the select dispatch is not reached.
    expect(dispatchedVerbsOf('/postit see [a]/remove')).toEqual(['postit'])
    expect(dispatchedVerbsOf('dolphin/[model]')).toEqual([])
  })

  it('gets the refusal its slash form gets', () => {
    expect(door('[drafts]/remove')).toEqual(refusedRemove)
    expect(door('/select[drafts]/remove')).toEqual(refusedRemove)
    expect(door('[drafts]/RM')).toEqual(door('/rm drafts'))
    expect(door('[a, b]/cut')).toEqual(door('/cut'))
    expect(door('[a, b]/cut')?.admit).toBe(false)
    expect(door('[x]/prune')).toEqual(door('/prune'))
    expect(door('/select[x]/prune')).toEqual(door('/prune'))
  })

  it('still admits the ops an operator may say, and a destination is only a word', () => {
    expect(door('[a, b]/copy')).toBeNull()
    expect(door('[a]/move(3)')).toBeNull()
    expect(door('[a, b]:focus')).toBeNull()
    expect(door('[a]/break-apart')).toBeNull()
    expect(door('[cigars, whiskey]/interests/')).toBeNull()
  })
})

describe('a `~` removal is `remove`', () => {
  const removals = [
    '~drafts',
    '  ~drafts',
    '~parent/child',
    '~[drafts, notes]',
    '[~stale]',
    '[+new, keep, ~old]',
    '[new, ~old]/dest',
    '/select[~stale]',
  ]

  it('whether the sigil leads the line or an item inside a leading bracket', () => {
    for (const line of removals) expect(dispatchedVerbsOf(line), line).toContain('remove')
    expect(dispatchedVerbsOf('~drafts')).toEqual(['remove'])
    expect(dispatchedVerbsOf('[new, ~old]/dest')).toEqual(['dest', 'remove'])
  })

  it('and gets the refusal `/remove` gets', () => {
    for (const line of removals) expect(door(line), line).toEqual(refusedRemove)
  })

  it('except a tag coming off, which takes no tile away', () => {
    for (const line of ['~drafts:stale', '~drafts:stale(#ff0)', '  ~drafts:stale', '[a, ~b:stale]', '[~b:stale]/copy']) {
      expect(dispatchedVerbsOf(line), line).not.toContain('remove')
      expect(door(line), line).toBeNull()
    }
  })

  it('reads wide where the tag form is not clean', () => {
    // No label, a label that folds to nothing, a call in the line: the tag
    // extractor does not take these whole, so they are not trusted to be tags.
    for (const line of ['~:stale', '~!!!:stale', '~a@b:stale', '[~!!!:stale]']) {
      expect(dispatchedVerbsOf(line), line).toEqual(['remove'])
    }
  })

  it('except a view coming off a tile, which only the live registry can tell', () => {
    const asked: string[] = []
    const detaches = (line: string): FeatureReading => { asked.push(line); return { remove: true, command: '' } }
    expect(dispatchedVerbsOf('~meetup@postit', detaches)).toEqual([])
    expect(door('~meetup@postit', detaches)).toBeNull()
    // Asked with the line as the pipeline will see it, once per reading — and
    // only of a line that could be a call.
    expect(asked).toEqual(['~meetup@postit', '~meetup@postit'])
    asked.length = 0
    for (const line of ['/remove drafts', '[~a]', '~drafts:stale', 'drafts']) dispatchedVerbsOf(line, detaches)
    expect(asked).toEqual([])
    // A view the registry does not know is a tile's name, and the tile goes.
    expect(dispatchedVerbsOf('~meetup@nonsense', () => null)).toEqual(['remove'])
    expect(dispatchedVerbsOf('~meetup@postit')).toEqual(['remove'])
  })

  it('leaves the other sigils alone — making is not taking away', () => {
    expect(dispatchedVerbsOf('[+roadmap, +tasks]')).toEqual([])
    expect(dispatchedVerbsOf('drafts:stale')).toEqual([])
    expect(dispatchedVerbsOf('tilde~inside')).toEqual([])
  })
})

describe('the word a `tile@view` line runs is judged like any other', () => {
  const runs = (command: string) => (): FeatureReading => ({ remove: false, command })

  it("is the view's own slash command, for a view that still needs it", () => {
    expect(viewCommandOf({ remove: false, called: false }, { slashCommand: '/postit' })).toBe('postit')
    expect(viewCommandOf({ remove: false }, { slashCommand: 'postit', attachable: false })).toBe('postit')
  })

  it('and nothing for a view the emit already finished', () => {
    const bee = { slashCommand: '/postit' }
    expect(viewCommandOf({ remove: true }, bee)).toBe('')
    expect(viewCommandOf({ remove: false, called: true }, bee)).toBe('')
    expect(viewCommandOf({ remove: false }, { ...bee, attachable: true })).toBe('')
    expect(viewCommandOf({ remove: false }, undefined)).toBe('')
  })

  it('reaches the gate as that word, folded', () => {
    expect(dispatchedVerbsOf('meetup@postit', runs('postit'))).toEqual(['postit'])
    expect(dispatchedVerbsOf('Meetup@Postit', runs('Postit'))).toEqual(['postit'])
    expect(dispatchedVerbsOf('diagram@slides', runs(''))).toEqual([])
    expect(dispatchedVerbsOf('meetup@postit')).toEqual([])
  })

  it('so a concealed view word is refused as its slash form is, and an open one admitted', () => {
    expect(door('bar@lounge', runs('lounge'))).toEqual(door('/lounge'))
    expect(door('bar@lounge', runs('lounge'))?.admit).toBe(false)
    expect(door('meetup@postit', runs('postit'))).toBeNull()
  })

  it('the pipeline runs exactly the word viewCommandOf names, and the door asks the same parse quietly', () => {
    const apply = member('async #applyFeatureOps(op: {')
    expect(apply).toContain('const slash = viewCommandOf(op, bee)')
    expect(apply).toContain("await drone?.execute(slash, '')")
    expect(apply).not.toContain('bee.slashCommand')
    const asked = member('#featureOf(v: string): FeatureReading | null {')
    expect(asked).toContain('this.#parseFeatureInput(v, true)')
    expect(asked).toContain('viewCommandOf(feat, registry?.get(feat.view))')
    // Quiet means quiet: a malformed call is the pipeline's to report, once.
    const parse = member('#parseFeatureInput(v: string, quiet = false): {')
    expect(parse).toContain("if (!quiet) EffectBus.emit('activity:log'")
    // Every other caller still reports.
    expect(component.split('this.#parseFeatureInput(v)').length - 1).toBe(1)
  })
})

describe('`/grant none` refuses every line the door is sent', () => {
  const closed: MachineGrant = { reach: 'none', scope: 'network' }
  const runs = (command: string) => (): FeatureReading => ({ remove: false, command })

  it('the verbs, as it always did', () => {
    for (const line of ['/create roadmap', '[a]/copy', '~drafts', '/remove drafts']) {
      expect(door(line, undefined, closed)?.admit, line).toBe(false)
    }
    expect(door('meetup@postit', runs('postit'), closed)?.admit).toBe(false)
  })

  it('and the lines that name no verb, which walked past it', () => {
    // A bare name (a tile, in tiles stance), a tag, a create inside a bracket,
    // a word the census does not hold (create-goto), a called view.
    for (const line of ['roadmap', 'drafts:stale', '[+roadmap]', '/roadmap', 'meetup@postit Doors at 7']) {
      expect(door(line, runs(''), closed), line).toEqual({
        admit: false,
        reason: line === '/roadmap'
          ? 'this hive grants a machine nothing at present, so /roadmap cannot be run from here'
          : 'this hive grants a machine nothing at present, so a line that names no behaviour cannot be run from here',
      })
    }
  })

  it("while one rung up those lines are the operator's again, as they always were", () => {
    for (const line of ['roadmap', 'drafts:stale', '[+roadmap]', '/roadmap']) {
      expect(door(line), line).toBeNull()
    }
  })

  it('the door asks about the empty verb rather than skipping it', () => {
    const from = component.indexOf('EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, ({ text, accept, complete }) => {')
    const body = component.slice(from, component.indexOf('\n    // voice active state sync', from))
    expect(body).toContain("const spokenVerbs = named.length ? named : ['']")
    expect(body).not.toContain('if (!verb) continue')
    expect(body).not.toContain("grant.reach === 'none'")   // core decides, the door asks
  })
})

describe('the reading and the dispatch cannot disagree', () => {
  it('the slash executor splits on a space or a paren after trimming past the slash', () => {
    const body = component.slice(component.indexOf('readonly #executeSlashBehaviour = async'))
    expect(body).toContain('const raw = line.slice(1).trim()')
    expect(body).toContain("const spaceIdx = raw.indexOf(' ')")
    expect(body).toContain("const parenIdx = raw.indexOf('(')")
    expect(body).toContain('drone.has(commandName)')
    expect(body).toContain('drone.execute(commandName, args)')
  })

  it('the registry folds the name it is asked for', () => {
    const drone = read('hypercomb-essentials', 'src', 'commands', 'slash-behaviour.drone.ts')
    for (const method of ['  execute(behaviourName: string, args: string)', '  has(behaviourName: string)']) {
      const at = drone.indexOf(method)
      expect(at, method).toBeGreaterThan(-1)
      expect(drone.slice(at, at + 160)).toContain('const name = behaviourName.toLowerCase().trim()')
    }
  })

  it('so the folded name the slash executor would ask for is always among the verbs judged', () => {
    const lines = [...smuggled.filter(line => line.startsWith('/')), '/remove drafts', '/Rm x', '/Move(3)', '/CREATE a b']
    for (const line of lines) {
      const asked = executorName(line).toLowerCase().trim()
      // Where the executor's word runs on past a `[` or a tab it names nothing
      // the registry holds; the reading stops short and judges the head.
      const head = asked.split(/[\s\[]/, 1)[0]
      expect(dispatchedVerbsOf(line), line).toContain(head)
    }
  })

  it('the select dispatch finds its op after the first `]`, as a `/word`, folded', () => {
    const body = component.slice(component.indexOf('readonly #executeSelectCommand = async'), component.indexOf('// per-item bracket operators'))
    expect(body).toContain("const bracketClose = v.indexOf(']')")
    expect(body).toContain('const afterBracket = v.slice(bracketClose + 1)')
    expect(body).toContain('const opMatch = afterBracket.match(/^\\/(\\w+)/)')
    expect(body).toContain("const op = opMatch ? opMatch[1].toLowerCase() : ''")
    // …and hands any registered word to the registry, which is why the op is
    // judged as a verb and not as one of a list of names.
    expect(body).toContain('await slash.execute(op, args)')
  })

  it('one normaliser for a bracket line, shared and not restated', () => {
    expect(component).toContain("import { isSelectOp, BRACKET_CMD_RE, normalizeSelectInput } from './select-ops'")
    expect(component).not.toContain('function normalizeSelectInput')
    expect(read('hypercomb-shared', 'ui', 'command-line', 'remote-verbs.ts'))
      .toContain("import { normalizeSelectInput } from './select-ops'")
  })

  it('the per-item `~` removes, in the bracket pre-pass and in the `~` behaviour', () => {
    const items = member('async #applyBracketItemOps(v: string): Promise<string> {')
    expect(items).toContain("} else if (t.startsWith('~')) {")
    expect(items).toContain('await this.#removeLabels(removes)')
    expect(read('hypercomb-shared', 'ui', 'command-line', 'remove-cell.behavior.ts'))
      .toContain("input.startsWith('~')")
  })

  it('the tag extractor takes `~label:tag` by the shape the reading excuses', () => {
    const extractor = member('async #extractAndPersistTags(input: string): Promise<string> {')
    const shape = 'match(/^~([^:]+):([^(]+)(?:\\(([^)]+)\\))?$/)'
    // In a bracket item and on a plain line — the two places a tile-less `~` lives.
    expect(extractor.split(shape).length - 1).toBe(2)
    expect(read('hypercomb-shared', 'ui', 'command-line', 'remote-verbs.ts'))
      .toContain('const TAG_REMOVAL_RE = /^~([^:]+):([^(]+)(?:\\(([^)]+)\\))?$/')
  })
})

describe('the remote door asks through this reading, and only the remote door', () => {
  it('judges a line the reader matched nothing in by dispatchedVerbsOf', () => {
    const from = component.indexOf('EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, ({ text, accept, complete }) => {')
    const to = component.indexOf('\n    // voice active state sync', from)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const body = component.slice(from, to)
    // The view question is the pipeline's own: the parse it will make, of the
    // line it will be handed.
    const readAt = body.indexOf(': dispatchedVerbsOf(line, v => this.#featureOf(v))')
    const judged = body.indexOf('for (const verb of spokenVerbs)')
    const run = body.indexOf('void this.#preprocessTagsThenExecute(line)')
    expect(readAt).toBeGreaterThan(-1)
    expect(readAt).toBeLessThan(judged)
    expect(judged).toBeLessThan(run)
    expect(body).not.toContain('canonicalVerbOf(')
  })

  it('leaves the keyboard path alone', () => {
    // One call in the component, and it is the door's.
    expect(component.split('dispatchedVerbsOf(').length - 1).toBe(1)
    expect(component).not.toContain('slashVerbsOf(')
  })
})
