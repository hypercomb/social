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
//
// The gate's own rule is asserted in core (machine-admission.spec.ts) and the
// declarations it reads in essentials (commands/remote-refusal.spec.ts). This
// is the piece between them: what the door hands the gate.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  admitMachineCall, spokenEntry, canonicalVerbOf, DEFAULT_MACHINE_GRANT,
  type AdmissionEntry, type MachineAdmission,
} from '@hypercomb/core'
import { dispatchedVerbsOf, slashVerbsOf } from './remote-verbs'

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
 *  destructive on the page, `rm` a name a participant gave, `/prune` concealed. */
const census: readonly AdmissionEntry[] = [
  { name: 'create', machine: { reach: 'additive', scope: 'page' } },
  { name: 'copy' },
  { name: 'move' },
  { name: 'cut', machine: { reach: 'destructive', scope: 'page' } },
  { name: 'remove', aliases: ['rm'], machine: { reach: 'destructive', scope: 'page' } },
  { name: 'prune', hidden: true },
]

/** The door's own loop: every verb judged, the first refusal answers. */
const door = (line: string, detachesView?: (line: string) => boolean): MachineAdmission | null => {
  for (const verb of dispatchedVerbsOf(line, detachesView)) {
    const verdict = admitMachineCall(verb, spokenEntry(verb, census), 'operator', DEFAULT_MACHINE_GRANT)
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
    const detaches = (line: string): boolean => { asked.push(line); return true }
    expect(dispatchedVerbsOf('~meetup@postit', detaches)).toEqual([])
    expect(door('~meetup@postit', detaches)).toBeNull()
    // Asked with the line as the pipeline will see it — and only for a line
    // the answer could change.
    expect(asked).toEqual(['~meetup@postit', '~meetup@postit'])
    asked.length = 0
    for (const line of ['meetup@postit', '/remove drafts', '[~a]', '~drafts:stale', 'drafts']) dispatchedVerbsOf(line, detaches)
    expect(asked).toEqual([])
    // A view the registry does not know is a tile's name, and the tile goes.
    expect(dispatchedVerbsOf('~meetup@nonsense', () => false)).toEqual(['remove'])
    expect(dispatchedVerbsOf('~meetup@postit')).toEqual(['remove'])
  })

  it('leaves the other sigils alone — making is not taking away', () => {
    expect(dispatchedVerbsOf('[+roadmap, +tasks]')).toEqual([])
    expect(dispatchedVerbsOf('drafts:stale')).toEqual([])
    expect(dispatchedVerbsOf('tilde~inside')).toEqual([])
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
    const readAt = body.indexOf(': dispatchedVerbsOf(line, v => !!this.#parseFeatureInput(v)?.remove)')
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
