// module-review.spec.ts — THE HOST'S AI READS EVERY SANDBOX. The change is
// written down file by file (before and after, each a resource), published
// with a `change:` pointer, read by the host's AI with those files as context,
// and its reading published with a `review:` pointer. A verdict is a reading.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { assessSandbox, isSandboxSite, publishChange, readChange, reviewChange, reviewContext, reviewQuestion, sectionText, tallyAssessments, verdictOf, type ReviewDeps } from './module-review.js'

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
    expect(w.heap.get(file!.before)).toContain('zoom = 1')
    expect(w.heap.get(file!.after)).toContain('__proof')
    expect(w.published[0]).toEqual([file!.before, file!.after, change.sig])
    expect(w.stamped).toEqual([['change:try-zoom', change.sig]])
    expect(await readChange(change.sig, w.deps)).toEqual(change.record)

    const read = await reviewChange('content.example.com', change.sig, change.record, w.deps)
    expect(read).toMatchObject({ ok: true, verdict: 'accept', model: 'claude-haiku-4-5' })
    if (!read.ok) return
    expect(read.findings).toContain('Saw the new global')
    expect(w.asked[0]!.context).toEqual([file!.after, file!.before])
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
    expect(w.heap.get(signed.record.note)).toBe('writes to storage it did not before')
    expect(w.published.at(-1)).toEqual([signed.record.note, signed.sig])
    expect(w.stamped.at(-1)).toEqual([`assess:${root}`, signed.sig])
    expect(await assessSandbox('h', { title: 'try-zoom', package: root }, 'maybe' as never, '', w.deps)).toEqual({ ok: false, error: 'a verdict is accept, refuse or unclear' })
  })

  it("reads a door's descriptor and counts how people assessed it", () => {
    expect(isSandboxSite({ sandbox: true, title: 'try-zoom', package: 'a'.repeat(64), pubkey: 'p' })).toBe(true)
    expect(isSandboxSite({ title: 'a site', package: 'a'.repeat(64) })).toBe(false)
    const assessments = ['accept', 'refuse', 'accept', 'odd'].map((verdict, i) => ({ pubkey: String(i), record: 'r', verdict: verdict as never, at: 0 }))
    expect(tallyAssessments({ assessments })).toEqual({ accept: 2, refuse: 1, unclear: 1 })
    expect(tallyAssessments({})).toEqual({ accept: 0, refuse: 0, unclear: 0 })
  })
})
