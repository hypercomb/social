import { describe, expect, it } from 'vitest'
import { splitQuestion } from '@hypercomb/core'
import { doctrineSections, fitEvidence, parseTable, tableQuestion, tableChoiceNote, persistJevInput, persistJevReceipt, persistJevVerify, formatJevUsage, JEV_STATE_CHARS, type Row } from './hypercomb-jev'
import { Blob as NodeBlob } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readResultMessage, splitWork, WorkStreamGuard } from './hypercomb-work-fence'
import { formatHypercombObservationReceipt, type HypercombObservationReceipt } from './hypercomb-observation'

const rows: Row[] = [
  { id: 'a', kind: 'read', label: 'See the notes', lines: ['list /notes'] },
  { id: 'b', kind: 'do', label: 'Group by topic', lines: ['create topics', 'move notes topics'], why: 'asked for' },
  { id: 'c', kind: 'answer', label: 'Answer now', lines: [] },
]
const fence = '```hypercomb-table\n' + JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'See the notes', line: 'list /notes' }, { id: 'b', kind: 'do', label: 'Group by topic', lines: ['create topics', 'move notes topics'], why: 'asked for' }, { id: 'c', kind: 'answer', label: 'Answer now' }] }) + '\n```'
describe('Jev usage report', () => {
  it('separates worker and decision usage across rounds', () => {
    expect(formatJevUsage([
      { usage: { inputTokens: 100, outputTokens: 20 } },
      { usage: { inputTokens: 50, outputTokens: 5 } },
      { category: 'jev-decision', usage: { inputTokens: 80, outputTokens: 0 } },
    ])).toBe('Tokens — workers: 150 input, 25 output; Jev: 80 input, 0 output.')
  })
  it('keeps partial and unavailable usage explicit for each dimension', () => {
    expect(formatJevUsage([
      { usage: { inputTokens: 100 } }, {},
      { category: 'jev-decision', usage: { inputTokens: NaN, outputTokens: -1 } },
    ])).toBe('Tokens — workers: 100 input (partial), output unavailable; Jev: input unavailable, output unavailable.')
  })
  it('distinguishes no attempts from attempts with unreported usage', () => {
    expect(formatJevUsage([])).toBe('Tokens — workers: no calls; Jev: no calls.')
    expect(formatJevUsage([{}])).toBe('Tokens — workers: input unavailable, output unavailable; Jev: no calls.')
  })
})
describe('the doctrine, section by section', () => {
  const anatomy = [
    '# Hypercomb anatomy', '', 'What the hive is.', '',
    '# Doctrine', '', 'The rules below are lifted verbatim.', '',
    '### Nothing is deleted', '(source: a.md)', '', 'Hide first; delete second.', '', '---', '',
    '### The core rule', '(source: b.md)', '', 'Content is addressed by signature.', '',
  ].join('\n')
  it('cuts the doctrine into its sections, each a verbatim piece of what the worker was sent', () => {
    const sections = doctrineSections(anatomy)
    expect(sections.map(section => section.split('\n')[0])).toEqual(['### Nothing is deleted', '### The core rule'])
    for (const section of sections) expect(anatomy.includes(section)).toBe(true)
    expect(sections.join('')).not.toContain('What the hive is')
  })
  it('falls back to the whole text when there is no doctrine heading', () => {
    expect(doctrineSections('Follow the request.')).toEqual(['Follow the request.'])
    expect(doctrineSections('')).toEqual([])
  })
})

describe('the possibility table protocol', () => {
  it('reuses signed content while changed evidence creates new provenance', async () => {
    const records = new Map<string, unknown>()
    const store = { async putResource(blob: Blob) {
      const text = await blob.text()
      const sig = createHash('sha256').update(text).digest('hex')
      records.set(sig, JSON.parse(text)); return sig
    } }
    const original = globalThis.Blob
    globalThis.Blob = NodeBlob as typeof Blob
    try {
      const input = { request: 'Organize', doctrine: ['Append history.', 'Hide first.'], evidence: ['Before'], rows }
      const first = await persistJevInput(store, input)
      expect(await persistJevInput(store, input)).toBe(first)
      const second = await persistJevInput(store, { ...input, evidence: ['After'] })
      expect(second).not.toBe(first)
      const a = records.get(first!) as Record<string, unknown>
      const b = records.get(second!) as Record<string, unknown>
      expect(a['doctrine']).toEqual(b['doctrine'])
      expect(a['rows']).toEqual(b['rows'])
      expect((a['doctrine'] as string[]).map(sig => records.get(sig))).toEqual(input.doctrine)
      expect(a).not.toHaveProperty('state')
      const receipt = await persistJevReceipt(store, second!, { plan: { kind: 'revise' }, rejected: ['b'], model: 'resolved', reason: 'Conflict', answers: { b_rules: 0.01 } })
      const decision = records.get(receipt!) as Record<string, unknown>
      expect(decision['source']).toBe(second)
      expect(decision['plan']).toEqual({ kind: 'revise' })
      expect(records.get(decision['reason'] as string)).toBe('Conflict')
      expect(records.get(decision['answers'] as string)).toEqual({ b_rules: 0.01 })
    } finally { globalThis.Blob = original }
  })
  it('keeps the request and the evidence a verification judged, each by signature, so a verdict can be replayed', async () => {
    const records = new Map<string, unknown>()
    const store = { async putResource(blob: Blob) {
      const text = await blob.text()
      const sig = createHash('sha256').update(text).digest('hex')
      records.set(sig, JSON.parse(text)); return sig
    } }
    const original = globalThis.Blob
    globalThis.Blob = NodeBlob as typeof Blob
    try {
      const decision = { verified: false, reason: 'supported .42 · complete .95', model: 'resolved', answers: { supported: 0.42 } }
      const checked = { request: 'Quote the note on /x.', evidence: ['{"kind":"hypercomb-tree-observation"}', 'second piece'] }
      const sig = await persistJevVerify(store, '> The note.', decision, checked)
      const record = records.get(sig!) as Record<string, unknown>
      expect(record['kind']).toBe('jev-verify')
      expect(records.get(record['request'] as string)).toBe(checked.request)
      expect((record['evidence'] as string[]).map(part => records.get(part))).toEqual(checked.evidence)
      expect(records.get(record['answer'] as string)).toBe('> The note.')
      // the verdict carries the evidence as the service rendered it for Jev: that is what is kept
      const rendered = { ...decision, evidence: ['read 1 of 1: read /x\n  note 1:\n  | The note.'] }
      const shown = records.get((await persistJevVerify(store, '> The note.', rendered, checked))!) as Record<string, unknown>
      expect((shown['evidence'] as string[]).map(part => records.get(part))).toEqual(rendered.evidence)
      expect(records.get(shown['request'] as string)).toBe(checked.request)
      const bare =records.get((await persistJevVerify(store, '> The note.', decision))!) as Record<string, unknown>
      expect(bare).not.toHaveProperty('evidence')
    } finally { globalThis.Blob = original }
  })
  it('parses the table verbatim and never executes a co-emitted action', () => {
    const work = splitWork(fence + '\n```hypercomb-do\nhide notes\n```')
    expect(work.request?.kind).toBe('table')
    expect(parseTable(work.request!.lines)).toEqual(rows)
    expect(work.heldDo).toBe(true)
  })
  it('reads first and refuses partial, duplicate or malformed tables', () => {
    expect(splitWork('```hypercomb-read\nread here\n```\n' + fence).request?.kind).toBe('read')
    expect(() => parseTable(splitWork(fence.slice(0, -3)).request!.lines)).toThrow()
    expect(() => parseTable(splitWork(fence + '\n' + fence).request!.lines)).toThrow()
    expect(() => parseTable([JSON.stringify({ rows: [{ id: 'a', kind: 'plan', label: 'x', line: 'y' }] })])).toThrow()
    expect(() => parseTable([JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'Something else', line: 'y' }] })])).toThrow()
    expect(() => parseTable([JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'x', lines: ['y', 'z'] }] })])).toThrow()
  })
  it('recognises a table by shape in a json fence, a bare fence, or no fence at all', () => {
    const body = JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'See the notes', line: 'list /notes' }] })
    for (const text of ['```json\n' + body + '\n```', '```\n' + body + '\n```', body, 'Here is the table:\n```json\n' + body + '\n```']) {
      const work = splitWork(text)
      expect(work.request?.kind).toBe('table')
      expect(parseTable(work.request!.lines)[0].label).toBe('See the notes')
    }
    expect(splitWork('```json\n{"nodes":[]}\n```').request).toBeUndefined()
    expect(splitWork('plain prose about rows').request).toBeUndefined()
  })
  it('hides the table during streaming', () => {
    const guard = new WorkStreamGuard()
    expect([...fence].map(c => guard.push(c)).join('') + guard.end()).toBe('')
  })
  it('offers the behaviour sentences as the options, never the labels, with an ask row as the prompt', () => {
    const text = tableQuestion(rows.slice(0, 2), 'Evidence is insufficient.')
    expect(text).toContain('create topics')
    expect(splitQuestion(text).question?.options).toEqual(['list /notes', 'create topics · move notes topics', 'Something else'])
    const asked = tableQuestion(rows.slice(0, 2), 'Jev chose to ask.', 'By city or by role?')
    expect(splitQuestion(asked).question?.prompt).toBe('By city or by role?')
  })
  it('tells the worker what Jev chose, what could not run, and what conflicts', () => {
    const note = tableChoiceNote(
      { plan: { kind: 'read', rows: ['a'] }, rejected: ['b'], reason: '', model: 'm', answers: {} },
      rows, [{ id: 'z', reason: 'unknown verb' }],
    )
    expect(note).toContain('Jev chose to read: See the notes.')
    expect(note).toContain('z (unknown verb)')
    expect(note).toContain('Group by topic')
    expect(note).toContain('grants no permission')
  })
})

describe('what Jev is shown of the evidence', () => {
  it('keeps the request, then the newest evidence still seen as written, within the room', () => {
    const seen = (part: string): boolean => part !== 'folded away'
    const code = 'x'.repeat(30_000)
    const fitted = fitEvidence(['the request', 'folded away', 'an older read', code], seen, 10_000, 1)
    expect(fitted[0]).toBe('the request')
    expect(fitted).not.toContain('folded away')
    // the newest piece is never dropped whole: it is shown as its head and its
    // tail, two pieces each as written — a cut of what was written is still
    // what was written, which is all Jev's source boundary accepts
    const [front, back] = fitted.slice(-2)
    expect(code.startsWith(front)).toBe(true)
    expect(code.endsWith(back)).toBe(true)
    expect(front.length + back.length).toBeLessThan(code.length)
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(10_000)
  })

  it('never exceeds what Jev itself accepts, however much the work read', () => {
    const fitted = fitEvidence(['the request', ...Array.from({ length: 30 }, (_, i) => `read ${i} "${'y'.repeat(2_000)}"`)], () => true, 1_000_000, 1)
    expect(fitted.length).toBeLessThanOrEqual(12)
    expect(fitted.join('').length).toBeLessThanOrEqual(16_000)
    expect(fitted[fitted.length - 1]).toContain('read 29')
  })
})

describe('a read, as Jev is shown it', () => {
  const sigOf = (seed: string): string => createHash('sha256').update(seed).digest('hex')
  const receipt = (...results: HypercombObservationReceipt['results']): string =>
    formatHypercombObservationReceipt({ results, snapshots: [], signatures: [] })
  const request = 'What does the note on /dolphin/community/members say? Quote it exactly.'
  /** How the receipt holds a string: JSON-escaped, as the worker was sent it. */
  const held = (text: string): string => JSON.stringify(text).slice(1, -1)
  // THE SOURCE BOUNDARY (essentials jev-decision.service.ts): verify takes a
  // piece only when it is, as written, in a message the worker was sent, and
  // a decision (jevUnseen) takes that or its escaped forms. The shell may not
  // import the module, so every fit here is held to the strictest form.
  const sent = (pieces: readonly string[]): { content: string }[] =>
    [{ content: request }, ...pieces.map(piece => ({ content: readResultMessage(piece, request) }))]
  const asWritten = (shown: readonly string[], messages: readonly { content: string }[]): void => {
    for (const part of shown) expect(messages.some(entry => entry.content.includes(part))).toBe(true)
  }
  const NOTE = 'Members: jwize, Dolphin and the "Thursday" circle — ask before inviting anyone new. [community, people]'
  // The verify door's own fit (chat-window verifyAnswer): the reads, judged
  // "seen" against what the worker was sent and the answer it spoke.
  const fitted = (pieces: readonly string[], room = JEV_STATE_CHARS): string[] => {
    const said = [...sent(pieces), { content: `> ${NOTE}` }]
    const shown = fitEvidence(pieces, part => said.some(entry => entry.content.includes(part)), room)
    asWritten(shown, said)
    return shown
  }
  const members = receipt({ grammar: 'read /dolphin/community/members', kind: 'node', read: {
    ok: true, root: '/dolphin/community/members', name: 'members', layerSig: sigOf('members'),
    children: [{ name: 'alice', sig: sigOf('alice') }, { name: 'bob', sig: sigOf('bob') }],
    projection: 'name: members\nlinks: 2', truncated: false, notes: [NOTE], noteCount: 1,
  } })
  const children = Array.from({ length: 120 }, (_, i) => ({ name: `member-${String(i).padStart(3, '0')}`, sig: sigOf(`child ${i}`) }))
  const projection = Array.from({ length: 100 }, (_, i) => `line ${String(i).padStart(2, '0')}: ${'p'.repeat(50)}`).join('\n')
  const DUES = 'Dues are collected in January. [money]'
  const WITHHELD = 'The tile /dolphin/community/private is withheld from this model; nothing under it was read.'
  const big = receipt({ grammar: 'read /dolphin/community', kind: 'node', read: {
    ok: true, root: '/dolphin/community', name: 'community', layerSig: sigOf('community'),
    children, projection, truncated: false, notes: [NOTE, DUES], noteCount: 2,
  } }) + `\n\n${WITHHELD}`

  it('shows the members note whole, as the worker was sent it', () => {
    expect(fitted([members])).toEqual([members])
    expect(members).toContain(held(NOTE))
  })

  it('keeps a big tile\'s notes: a cut piece is its head and its tail, each as written', () => {
    expect(big.length).toBeGreaterThan(16_000)
    // before: the notes sat past what a cut from the start could keep
    expect(big.indexOf(held(DUES))).toBeGreaterThan(16_000)
    for (const room of [JEV_STATE_CHARS, 4_000]) {
      const shown = fitted([big], room)
      expect(shown).toHaveLength(2)
      const [front, back] = shown
      // the head names the read; the tail holds the notes and the withheld notice
      expect(front.startsWith('{"kind":"hypercomb-tree-observation"')).toBe(true)
      expect(front).toContain('"grammar":"read /dolphin/community"')
      expect(back).toContain(`"notes":${JSON.stringify([NOTE, DUES])}`)
      expect(back).toContain('"noteCount":2')
      expect(back.endsWith(WITHHELD)).toBe(true)
      // each end stops at a line's end or between two fields, never inside a name
      expect(big.slice(front.length)).toMatch(/^\s*(?:\n|\\n|,")/)
      expect(big.slice(0, big.indexOf(back))).toMatch(/(?:\n|\\n|,)\s*$/)
      expect(JSON.stringify(shown).length + shown.length).toBeLessThanOrEqual(Math.min(room, 16_000))
    }
  })

  it('shows the decision only what the worker was sent, as written, after the request', () => {
    const pieces = [members, big, 'x'.repeat(30_000), 'context: /dolphin\n\n' + members + '\n\nNot run — a block holds at most 8 reads: read /z.']
    for (const room of [JEV_STATE_CHARS, 6_000]) {
      const messages = sent(pieces)
      const shown = fitEvidence([request, ...pieces], part => messages.some(entry => entry.content.includes(part)), room, 1)
      expect(shown[0]).toBe(request)
      expect(shown.length).toBeLessThanOrEqual(12)
      asWritten(shown, messages)
    }
  })

  it('stores what Jev was shown: the fitted evidence, piece for piece', async () => {
    const records = new Map<string, unknown>()
    const store = { async putResource(blob: Blob) {
      const text = await blob.text()
      const sig = createHash('sha256').update(text).digest('hex')
      records.set(sig, JSON.parse(text)); return sig
    } }
    const original = globalThis.Blob
    globalThis.Blob = NodeBlob as typeof Blob
    try {
      for (const pieces of [[members], [members, big]]) {
        const shown = fitted(pieces)
        const decision = { verified: true, reason: 'supported .95 · complete .95', model: 'resolved', answers: { supported: 0.95 } }
        const sig = await persistJevVerify(store, `> ${NOTE}`, decision, { request, evidence: shown })
        const record = records.get(sig!) as Record<string, unknown>
        expect((record['evidence'] as string[]).map(part => records.get(part))).toEqual(shown)
      }
    } finally { globalThis.Blob = original }
  })
})
