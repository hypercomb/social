// module-review.spec.ts — THE HOST'S AI READS EVERY SANDBOX. The change is
// written down file by file (before and after, each a resource), published
// with a `change:` pointer, read by the host's AI with those files as context,
// and its reading published with a `review:` pointer. A verdict is a reading.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { assessSandbox, changedPaths, countedAssessors, diffText, isSandboxSite, jevReadTrial, publishChange, readChange, readTrial, recordChange, reviewChange, reviewContext, reviewQuestion, sectionText, takeTrial, tallyAssessments, trialsOf, verdictOf, type ReviewDeps, type TakeDeps, jevPassZone, trialAdoption, trialClashes, trialEvidence, type SandboxTrial, openChangeHops, openHop, putHop } from './module-review.js'
import { diffLines } from './line-diff.js'

const BEFORE = ['// src/preferences/settings.ts', 'export const zoom = 1;', '// src/preferences/other.ts', 'export {};'].join('\n')
const AFTER = ['// src/preferences/settings.ts', 'export const zoom = 2;', 'globalThis.__proof = 1;', '// src/preferences/other.ts', 'export {};'].join('\n')

const world = async () => {
  const heap = new Map<string, string>()
  const put = async (text: string) => { const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer); heap.set(sig, text); return sig }
  const from = await put(BEFORE)
  const to = await put(AFTER)
  const published: string[][] = []
  const stamped: [string, string][] = []
  const asked: { question: string; context: readonly string[] }[] = []
  const deps: ReviewDeps = {
    put: async text => put(text),
    get: async sig => heap.get(sig) ?? null,
    bytesOf: async sig => heap.has(sig) ? new TextEncoder().encode(heap.get(sig)!) : null,
    publish: async (_host, sigs) => { published.push([...sigs]); return { ok: true } },
    ask: async (_host, question, context) => {
      asked.push({ question, context })
      const seen = context.map(sig => heap.get(sig) ?? '').join('\n')
      return { ok: true, text: `It raises zoom and sets a global.${seen.includes('__proof') ? ' Saw the new global.' : ''}\nVERDICT: accept`, model: 'claude-haiku-4-5' }
    },
    stamp: async (_host, key, sig) => { stamped.push([key, sig]); return { ok: true } },
    now: () => 1_700_000_000_000,
  }
  return { heap, from, to, deps, published, stamped, asked }
}

describe('module review', () => {
  it('slices one source file out of a module, header included', () => {
    expect(sectionText(AFTER, 'src/preferences/settings.ts')).toBe('// src/preferences/settings.ts\nexport const zoom = 2;\nglobalThis.__proof = 1;\n')
    expect(sectionText(AFTER, 'src/nowhere.ts')).toBe('')
  })

  it('reads a verdict from the last VERDICT line, and unclear when there is none', () => {
    expect(verdictOf('fine\nVERDICT: accept')).toBe('accept')
    expect(verdictOf('VERDICT: accept\nlater: VERDICT: Refuse')).toBe('refuse')
    expect(verdictOf('no verdict here')).toBe('unclear')
  })

  it('publishes the change file by file, stamps change:, and the host AI reads the AFTER and BEFORE files', async () => {
    const w = await world()
    const change = await publishChange('content.example.com', 'try-zoom', 'r'.repeat(64),
      [{ path: 'preferences', section: 'src/preferences/settings.ts', from: w.from, to: w.to }], ['games/pong'], w.deps)
    expect(change.ok).toBe(true)
    if (!change.ok) return
    const [file] = change.record.changes
    // Each side is one typed hop to the section's text; the host serves both the text and the hop.
    const [before, after] = await Promise.all([openHop(file!.before, w.deps.get), openHop(file!.after, w.deps.get)])
    expect(before!.text).toContain('zoom = 1')
    expect(after!.text).toContain('__proof')
    expect(w.published[0]).toEqual([before!.sig, after!.sig, file!.before, file!.after, change.sig])
    expect(w.stamped).toEqual([['change:try-zoom', change.sig]])
    expect(change.record.at).toBe(1_700_000_000_000)
    expect(await readChange(change.sig, w.deps)).toEqual(change.record)

    const read = await reviewChange('content.example.com', change.sig, change.record, w.deps)
    expect(read).toMatchObject({ ok: true, verdict: 'accept', model: 'claude-haiku-4-5' })
    if (!read.ok) return
    expect(read.findings).toContain('Saw the new global')
    expect(w.asked[0]!.context).toEqual([after!.sig, before!.sig])
    expect(w.asked[0]!.question).toContain('src/preferences/settings.ts')
    expect(w.asked[0]!.question).toContain('games/pong')
    const review = JSON.parse(w.heap.get(read.sig)!)
    expect(review).toMatchObject({ kind: 'module-review', sandbox: 'try-zoom', change: change.sig, verdict: 'accept' })
    expect(w.stamped[1]).toEqual(['review:try-zoom', read.sig])
  })

  it('keeps the question within the host AI budget and the context to eight files', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ path: `p${i}`, section: `src/p${i}.ts`, from: 'a', to: 'b', before: `b${i}`, after: `a${i}` }))
    expect(reviewContext(many)).toEqual(['a0', 'b0', 'a1', 'b1', 'a2', 'b2', 'a3', 'b3'])
    expect(reviewQuestion('try-x', many, Array.from({ length: 400 }, (_, i) => `path/${i}`)).length).toBeLessThanOrEqual(3_900)
  })

  it('says why when the host AI cannot answer, and stamps nothing', async () => {
    const w = await world()
    const change = await publishChange('h', 'try-zoom', 'r'.repeat(64), [{ path: 'p', section: 'src/preferences/settings.ts', from: w.from, to: w.to }], [], w.deps)
    if (!change.ok) throw new Error(change.error)
    const refused = await reviewChange('h', change.sig, change.record, { ...w.deps, ask: async () => ({ ok: false, error: 'h said 503: AI is not configured' }) })
    expect(refused).toEqual({ ok: false, error: 'h said 503: AI is not configured' })
    expect(w.stamped.map(([key]) => key)).toEqual(['change:try-zoom'])
  })
})

describe('public assessments', () => {
  it("signs an assessment into the assessor's own index as assess:<root>, with the note by signature", async () => {
    const w = await world()
    const root = 'e'.repeat(64)
    const signed = await assessSandbox('content.example.com', { title: 'try-zoom', package: root, change: 'c'.repeat(64) }, 'refuse', '  writes to storage it did not before  ', w.deps)
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    expect(signed.record).toMatchObject({ kind: 'module-assessment', sandbox: 'try-zoom', root, change: 'c'.repeat(64), verdict: 'refuse' })
    const note = await openHop(signed.record.note, w.deps.get)
    expect(note!.text).toBe('writes to storage it did not before')
    expect(w.published.at(-1)).toEqual([note!.sig, signed.record.note, signed.sig])
    expect(w.stamped.at(-1)).toEqual([`assess:${root}`, signed.sig])
    expect(await assessSandbox('h', { title: 'try-zoom', package: root }, 'maybe' as never, '', w.deps)).toEqual({ ok: false, error: 'a verdict is accept, refuse or unclear' })
  })

  it("reads a door's descriptor and counts how people assessed it", () => {
    expect(isSandboxSite({ sandbox: true, title: 'try-zoom', package: 'a'.repeat(64), pubkey: 'p' })).toBe(true)
    expect(isSandboxSite({ title: 'a site', package: 'a'.repeat(64) })).toBe(false)
    const assessments = ['accept', 'refuse', 'accept', 'odd'].map((verdict, i) => ({ pubkey: String(i), record: 'r', verdict: verdict as never, at: 0 }))
    expect(tallyAssessments({ assessments })).toEqual({ accept: 2, refuse: 1, unclear: 1, others: 0 })
    expect(tallyAssessments({})).toEqual({ accept: 0, refuse: 0, unclear: 0, others: 0 })
  })

  it('counts only the people who count: this hive and the publisher it follows — a fresh key is shown, never counted', () => {
    const own = 'a'.repeat(64), followed = 'b'.repeat(64), stranger = 'c'.repeat(64)
    localStorage.setItem('hc:install-follow', JSON.stringify({ pubkey: followed, hosts: [], channel: 'essentials' }))
    try {
      const counted = countedAssessors(own)
      expect([...counted].sort()).toEqual([own, followed])
      const assessments = [[own, 'accept'], [followed, 'refuse'], ...Array.from({ length: 40 }, () => [stranger, 'accept'])]
        .map(([pubkey, verdict]) => ({ pubkey: pubkey!, record: 'r', verdict: verdict as never, at: 0 }))
      expect(tallyAssessments({ assessments }, counted)).toEqual({ accept: 1, refuse: 1, unclear: 0, others: 40 })
      localStorage.setItem('hc:install-follow', 'off')
      expect([...countedAssessors(null)]).toEqual([])
    } finally { localStorage.removeItem('hc:install-follow') }
  })
})

describe('the trials on a zone', () => {
  it('reads a listing newest first, and leaves out what is not a trial', () => {
    const sig = (c: string) => c.repeat(64)
    const trial = (name: string, at: unknown, extra: Record<string, unknown> = {}) =>
      ({ name, door: `https://${name}.hypercomb.com`, package: sig('a'), pubkey: sig('b'), publisher: 'Jaime', at, sections: ['src/a.ts', 7], off: [], ...extra })
    const trials = trialsOf({ zone: 'hypercomb.com', trials: [
      trial('try-old', 1000, { review: sig('c'), reviewVerdict: 'refuse' }),
      trial('try-new', 2000, { change: sig('d'), reviewVerdict: 'accept' }),
      trial('try-undated', 'soon'),
      trial('fresh-rooms', 3000),
      trial('try-no-package', 4000, { package: 'x' }),
      { ...trial('try-no-door', 5000), door: 'javascript:alert(1)' },
    ] })
    expect(trials.map(t => t.name)).toEqual(['try-new', 'try-old', 'try-undated'])
    const [fresh, old, undated] = trials
    expect(fresh).toMatchObject({ change: sig('d'), sections: ['src/a.ts'] })
    expect(fresh!.reviewVerdict).toBeUndefined()
    expect(old).toMatchObject({ review: sig('c'), reviewVerdict: 'refuse' })
    expect(undated!.at).toBeNull()
    expect(trialsOf(null)).toEqual([])
    expect(trialsOf({ trials: 'none' })).toEqual([])
  })
})

describe('reading a trial', () => {
  it('walks the change file by file, with the host AI reading and every assessment of this root', async () => {
    const w = await world()
    const put = (text: string) => w.deps.put(text, 'text/plain')
    const root = 'e'.repeat(64)
    const gone = 'f'.repeat(64)
    const [b1, a1, b2] = await Promise.all([put('export const zoom = 1;\n'), put('export const zoom = 2;\nglobalThis.__proof = 1;\n'), put('export {};\n')])
    const change = await put(JSON.stringify({
      kind: 'module-change', sandbox: 'try-zoom', root, off: ['games/pong'], at: 1234,
      changes: [
        { path: 'preferences', section: 'src/a.ts', from: 'x', to: 'y', before: b1, after: a1 },
        { path: 'other', section: 'src/b.ts', from: 'x', to: 'y', before: b2, after: gone },
      ],
    }))
    const findings = await put('It raises zoom.\nVERDICT: refuse')
    const review = await put(JSON.stringify({ kind: 'module-review', verdict: 'refuse', model: 'claude-haiku-4-5', findings }))
    const note = await put('reads well')
    const mine = await put(JSON.stringify({ kind: 'module-assessment', root, verdict: 'accept', note }))
    const elsewhere = await put(JSON.stringify({ kind: 'module-assessment', root: 'a'.repeat(64), verdict: 'refuse', note }))
    const reading = await readTrial({
      sandbox: true, title: 'try-zoom', package: root, pubkey: 'p', change, review,
      assessments: [{ pubkey: 'k1', record: mine, verdict: 'accept', at: 5 }, { pubkey: 'k2', record: elsewhere, verdict: 'refuse', at: 6 }],
    }, async sig => w.heap.get(sig) ?? null)

    const [readable, unreadable] = reading.files
    expect([readable!.section, readable!.diff?.added, readable!.diff?.removed]).toEqual(['src/a.ts', 2, 1])
    // A side that cannot be read is named as missing, never drawn as an emptied file.
    expect(unreadable!.diff).toBeNull()
    expect(reading.missing).toEqual([gone])
    expect([reading.off, reading.at]).toEqual([['games/pong'], 1234])
    expect(reading.review).toEqual({ verdict: 'refuse', model: 'claude-haiku-4-5', findings: 'It raises zoom.\nVERDICT: refuse' })
    expect(reading.people).toEqual([{ pubkey: 'k1', verdict: 'accept', note: 'reads well', at: 5 }])
  })

  it('names what a build folded in from other builds — in the record, the question and the reading', async () => {
    const w = await world()
    const taken = [{ path: 'games/pong', root: 'f'.repeat(64) }]
    const change = await publishChange('h', 'try-zoom', 'r'.repeat(64), [{ path: 'preferences', section: 'src/preferences/settings.ts', from: w.from, to: w.to }], [], w.deps, taken)
    if (!change.ok) throw new Error(change.error)
    expect(change.record.taken).toEqual(taken)
    expect(reviewQuestion('try-zoom', change.record.changes, [], taken)).toContain('games/pong (from ffffffffffff…)')
    const reading = await readTrial({ sandbox: true, title: 'try-zoom', package: 'r'.repeat(64), pubkey: 'p', change: change.sig }, async sig => w.heap.get(sig) ?? null)
    expect(reading.taken).toEqual(taken)
    // A change with nothing folded in says nothing of it.
    const plain = await publishChange('h', 'try-zoom', 'r'.repeat(64), [], ['notes'], w.deps)
    if (!plain.ok) throw new Error(plain.error)
    expect('taken' in plain.record).toBe(false)
  })

  it('reads a trial with no change and no review as exactly that', async () => {
    const reading = await readTrial({ sandbox: true, title: 'try-zoom', package: 'e'.repeat(64), pubkey: 'p' }, async () => null)
    expect(reading).toEqual({ files: [], jev: null, off: [], taken: [], at: null, review: null, people: [], missing: [] })
  })
})

describe('taking a trial into your own build', () => {
  const root = 'e'.repeat(64)
  const deps = (carried: Record<string, string>, refuse: Record<string, string> = {}) => {
    const picked: { path: string; layer: string; root: string; zones: readonly string[]; byHand: boolean }[] = []
    const take: TakeDeps = {
      revisionsOf: async (path, _zones, roots) => carried[path]
        ? [{ layer: 'a'.repeat(64), sources: [{ root: 'f'.repeat(64) }] }, { layer: carried[path]!, sources: roots.map(r => ({ root: r })) }]
        : [],
      pick: async (path, revision, zones, options) => {
        picked.push({ path, ...revision, zones, byHand: options.byHand })
        return refuse[path] ? { ok: false, error: refuse[path] } : { ok: true }
      },
      held: async held => held === root ? 2 : 0,
    }
    return { take, picked }
  }

  it('picks the trial\'s own layer at each path, by hand, and says how much waits in the brood', async () => {
    const { take, picked } = deps({ preferences: 'c'.repeat(64), 'games/pong': 'd'.repeat(64) })
    const outcome = await takeTrial(root, ['preferences', 'games/pong'], ['try-zoom.hypercomb.com'], take)
    expect(outcome).toEqual({ taken: ['preferences', 'games/pong'], refused: [], held: 2 })
    expect(picked).toEqual([
      { path: 'preferences', layer: 'c'.repeat(64), root, zones: ['try-zoom.hypercomb.com'], byHand: true },
      { path: 'games/pong', layer: 'd'.repeat(64), root, zones: ['try-zoom.hypercomb.com'], byHand: true },
    ])
  })

  it('names what it could not take, and counts nothing held when nothing was taken', async () => {
    const { take } = deps({ preferences: 'c'.repeat(64) }, { preferences: 'nothing is installed here to pick onto' })
    expect(await takeTrial(root, ['preferences', 'notes'], ['h'], take)).toEqual({
      taken: [], held: 0,
      refused: [{ path: 'preferences', error: 'nothing is installed here to pick onto' }, { path: 'notes', error: 'the trial does not carry notes' }],
    })
  })

  it('takes the paths a change touched, once each', () => {
    const file = (path: string) => ({ path, section: 's', from: 'x', to: 'y', before: 'b', after: 'a' })
    expect(changedPaths({ changes: [file('preferences'), file('preferences'), file('games/pong'), file('../escape')] })).toEqual(['preferences', 'games/pong'])
    expect(changedPaths(null)).toEqual([])
  })
})

describe('Jev reads a trial', () => {
  it('judges every changed file\'s diff against the doctrine, publishes the reading, and stamps jev:<sandbox>', async () => {
    const w = await world()
    const change = await publishChange('h', 'try-zoom', 'r'.repeat(64), [{ path: 'preferences', section: 'src/preferences/settings.ts', from: w.from, to: w.to }], [], w.deps)
    if (!change.ok) throw new Error(change.error)
    const asked: unknown[] = []
    const jev = async (input: { sandbox: string; files: readonly { section: string; diff: string }[]; doctrine: readonly string[] }) => {
      asked.push(input)
      return { verdict: 'follows' as const, model: 'typesafe/jev-fake', answers: {}, files: input.files.map(file => ({ section: file.section, worst: { rule: 'The Life Primitive', breaks: 0.02 }, rules: [{ rule: 'The Life Primitive', breaks: 0.02 }] })) }
    }
    const read = await jevReadTrial('h', change.sig, change.record, ['### The Life Primitive\nOne typed hop.'], jev, w.deps)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const input = asked[0] as { files: { section: string; diff: string }[]; doctrine: string[] }
    expect(input.files[0]!.section).toBe('src/preferences/settings.ts')
    expect(input.files[0]!.diff).toContain('+ globalThis.__proof = 1;')
    expect(input.files[0]!.diff).toContain('− export const zoom = 1;')
    expect(input.doctrine).toEqual(['### The Life Primitive\nOne typed hop.'])
    expect(read.record).toMatchObject({ kind: 'jev-reading', sandbox: 'try-zoom', change: change.sig, verdict: 'follows', model: 'typesafe/jev-fake', rubric: 5 })
    expect(w.published.at(-1)).toEqual([read.sig])
    expect(w.stamped.at(-1)).toEqual(['jev:try-zoom', read.sig])
    // The door names it; a reader gets the standing and each file's worst rule.
    const reading = await readTrial({ sandbox: true, title: 'try-zoom', package: 'r'.repeat(64), pubkey: 'p', change: change.sig, jev: read.sig, jevVerdict: 'follows' }, async sig => w.heap.get(sig) ?? null)
    expect(reading.jev).toEqual({ verdict: 'follows', model: 'typesafe/jev-fake', files: read.record.files })
    // Jev not answering is said, and nothing is stamped.
    const refused = await jevReadTrial('h', change.sig, change.record, ['rule'], async () => { throw new Error('Jev requires Jev switched on') }, w.deps)
    expect(refused).toEqual({ ok: false, error: 'Jev requires Jev switched on' })
    expect(w.stamped.filter(([key]) => key === 'jev:try-zoom')).toHaveLength(1)
  })

  it('writes a diff the way Jev reads it, and cuts a long one with a count', () => {
    const text = diffText(diffLines('a\nb\nc\n', 'a\nB\nc\n'), 1_000)
    expect(text).toBe('  a\n− b\n+ B\n  c')
    const cut = diffText(diffLines('a\nb\nc\n', 'A\nB\nC\n'), 12)
    expect(cut).toBe('− a\n− b\n− c\n… (cut: 3 more rows)')
  })
})

describe('Jev weighs a zone', () => {
  const trial = (name: string, over: Partial<SandboxTrial> = {}): SandboxTrial => ({
    name, door: `https://${name}.hypercomb.com`, package: 'r'.repeat(64), pubkey: 'p'.repeat(64), publisher: 'Jaime', at: 1_700_000_000_000,
    sections: ['src/preferences/settings.ts'], off: [], taken: [], ...over,
  })

  it('lists what a trial took and how Jev read it', () => {
    const listed = trialsOf({ trials: [{ name: 'try-a', door: 'https://try-a.z', package: 'c'.repeat(64), pubkey: 'd'.repeat(64), jev: 'e'.repeat(64), jevVerdict: 'breaks', taken: [{ path: 'commands', root: 'f'.repeat(64) }, { path: 7 }, { path: 'x', root: 'short' }] }] })
    expect(listed[0]).toMatchObject({ jev: 'e'.repeat(64), jevVerdict: 'breaks', taken: [{ path: 'commands', root: 'f'.repeat(64) }] })
  })

  it('names which trials change one file, and who took whose package', () => {
    const a = trial('try-a')
    const b = trial('try-b', { package: 's'.repeat(64), sections: ['src/preferences/settings.ts', 'src/b.ts'] })
    const c = trial('try-c', { package: 't'.repeat(64), sections: [], taken: [{ path: 'preferences', root: 'r'.repeat(64) }] })
    expect([...trialClashes([a, b, c])]).toEqual([['try-a', ['try-b']], ['try-b', ['try-a']], ['try-c', []]])
    expect([...trialAdoption([a, b, c])]).toEqual([['try-a', ['try-c']], ['try-b', []], ['try-c', []]])
  })

  it('writes what is known in plain words: the readings, the people, adoption and clashes', () => {
    const read = { people: [{ pubkey: 'x', verdict: 'refuse' as const, note: 'raises  zoom\nwithout asking', at: 1 }], jev: { verdict: 'follows' as const, model: 'm', files: [{ section: 'src/a.ts', rules: [], worst: { rule: 'The core rule', breaks: 0.02 } }] } }
    const text = trialEvidence(trial('try-a', { reviewVerdict: 'accept', off: ['games/pong'] }), read, ['try-c'], ['try-b'])
    expect(text).toBe([
      'try-a by Jaime, 2023-11-14: changes src/preferences/settings.ts; turns off games/pong.',
      'The publisher\'s own records, which nobody checked, say its host\'s AI read accept and its Jev read follows (closest to breaking "The core rule", 2%) — the publisher\'s word, not evidence.',
      'People who count: 0 accept, 1 refuse, 0 unclear. Notes: refuse — "raises zoom without asking".',
      'Taken into try-c.',
      'Changes a file that try-b also changes.',
    ].join('\n'))
    expect(trialEvidence(trial('try-d', { sections: [] }), null, [], [])).toContain('no source changes.\nThe publisher\'s own records, which nobody checked, say its host\'s AI read nothing yet and its Jev read nothing yet — the publisher\'s word, not evidence.\nPeople who count: 0 accept, 0 refuse, 0 unclear.')
    // A stranger's refusal is shown as a number, never counted.
    const counted = new Set(['y'])
    expect(trialEvidence(trial('try-a'), read, [], [], counted)).toContain('People who count: 0 accept, 0 refuse, 0 unclear. 1 others assessed it and are not counted.')
  })

  it('weighs every open trial from its door, publishes the pass, and stamps pass:<zone>', async () => {
    const w = await world()
    const a = trial('try-a', { reviewVerdict: 'accept' })
    const b = trial('try-b', { package: 's'.repeat(64), sections: [], taken: [{ path: 'preferences', root: 'r'.repeat(64) }] })
    const asked: unknown[] = []
    const jev = async (input: { zone: string; trials: readonly { name: string; evidence: string }[] }) => {
      asked.push(input)
      return { model: 'typesafe/jev-fake', answers: {}, focus: 'try-b', trials: input.trials.map(t => ({ name: t.name, conforms: 0.95, refused: t.name === 'try-a' ? 0.9 : 0.02, standing: t.name === 'try-a' ? 'discuss' as const : 'take' as const })) }
    }
    const passed = await jevPassZone('h', 'hypercomb.com', [a, b], jev, { ...w.deps, site: async t => ({ sandbox: true, title: t.name, package: t.package, pubkey: t.pubkey }), reader: () => async () => null })
    expect(passed.ok).toBe(true)
    if (!passed.ok) return
    expect((asked[0] as { trials: { evidence: string }[] }).trials[0]!.evidence).toContain('Taken into try-b.')
    expect(passed.record).toMatchObject({ kind: 'jev-pass', zone: 'hypercomb.com', focus: 'try-b', rubric: 5, trials: [
      { name: 'try-a', standing: 'discuss', takenBy: ['try-b'], clashes: [] }, { name: 'try-b', standing: 'take', takenBy: [], clashes: [] },
    ] })
    expect(w.published.at(-1)).toEqual([passed.sig])
    expect(w.stamped.at(-1)).toEqual(['pass:hypercomb.com', passed.sig])
    expect(await jevPassZone('h', 'z', [], jev, { ...w.deps, site: async () => null, reader: () => async () => null })).toEqual({ ok: false, error: 'no trial is open' })
  })
})

describe('the trail wears the Life Primitive', () => {
  it('writes every hop a reader opens as one typed envelope with its relation, and opens raw signatures too', async () => {
    const w = await world()
    const recorded = await recordChange('try-zoom', 'r'.repeat(64), [{ path: 'preferences', section: 'src/preferences/settings.ts', from: w.from, to: w.to }], [], w.deps)
    if ('error' in recorded) throw new Error(recorded.error)
    const before = JSON.parse(w.heap.get(recorded.record.changes[0]!.before)!)
    expect(before).toEqual({ meta: 1, resource: expect.stringMatching(/^[0-9a-f]{64}$/), relation: 'before' })
    expect(JSON.parse(w.heap.get(recorded.record.changes[0]!.after)!).relation).toBe('after')
    expect(w.heap.get(before.resource)).toBe('// src/preferences/settings.ts\nexport const zoom = 1;\n')
    // The host serves the text and the envelope: four hops' worth for one file, then the record.
    expect(recorded.files).toHaveLength(5)
    expect(recorded.files).toContain(before.resource)
    // A hop opens to the text it names; a raw signature (a record from before the primitive) opens to itself.
    expect(await openHop(recorded.record.changes[0]!.before, w.deps.get)).toEqual({ sig: before.resource, text: w.heap.get(before.resource) })
    expect(await openHop(before.resource, w.deps.get)).toEqual({ sig: before.resource, text: w.heap.get(before.resource) })
    expect(await openHop('0'.repeat(64), w.deps.get)).toBeNull()
    expect((await openChangeHops(recorded.record, w.deps.get))!.changes[0]!.before).toBe(before.resource)
    // The same hop is the same signature.
    expect(await putHop(w.deps, 'resource', before.resource, 'before')).toBe(recorded.record.changes[0]!.before)
  })

  it('shows the host AI the text behind the hops, and wraps its findings and an assessor\'s note the same way', async () => {
    const w = await world()
    const change = await publishChange('h', 'try-zoom', 'r'.repeat(64), [{ path: 'preferences', section: 'src/preferences/settings.ts', from: w.from, to: w.to }], [], w.deps)
    if (!change.ok) throw new Error(change.error)
    const read = await reviewChange('h', change.sig, change.record, w.deps)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const context = w.asked.at(-1)!.context
    expect(context.every(sig => { try { return !(JSON.parse(w.heap.get(sig)!) as { meta?: number }).meta } catch { return true } })).toBe(true)
    expect(read.findings).toContain('Saw the new global.')
    const review = JSON.parse(w.heap.get(read.sig)!)
    expect(JSON.parse(w.heap.get(review.findings)!)).toEqual({ meta: 1, resource: expect.any(String), relation: 'findings' })
    const signed = await assessSandbox('h', { title: 'try-zoom', package: 'r'.repeat(64), change: change.sig }, 'refuse', 'raises zoom', w.deps)
    if (!signed.ok) throw new Error(signed.error)
    expect(JSON.parse(w.heap.get(signed.record.note)!)).toEqual({ meta: 1, resource: expect.any(String), relation: 'note' })
    // A reader opens every hop: the diff, the findings, the note.
    const reading = await readTrial({ sandbox: true, title: 'try-zoom', package: 'r'.repeat(64), pubkey: 'p', change: change.sig, review: read.sig, assessments: [{ pubkey: 'q', record: signed.sig, verdict: 'refuse', at: 1 }] }, async sig => w.heap.get(sig) ?? null)
    expect(reading.files[0]!.after).toContain('globalThis.__proof = 1;')
    expect(reading.review?.findings).toContain('Saw the new global.')
    expect(reading.people[0]!.note).toBe('raises zoom')
    expect(reading.missing).toEqual([])
  })
})
