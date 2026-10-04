// hypercomb-grammar.write.spec.ts — a write is judged by the grant, and a
// row marked for review waits for a hand even in a trusted conversation.
//
// The execution-queue audit (natural-language-surface-audit.md, item 14): a
// module or doctrine section written back is a change no census row declares,
// so no rung of the gate read it — a hive that granted a machine only additive
// verbs, or kept it within one page, still had its running code rewritten.
// And a trusted conversation (every manager's ask is one) released rows marked
// for review, so a doctrine section — "ALWAYS waits in Execution for their
// hand" — was written with no hand at all.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hypercombWriteRefusal } from './hypercomb-grammar'

describe('a write, judged by the grant', () => {
  it('runs within the default ceiling', () => {
    expect(hypercombWriteRefusal({ reach: 'editing', scope: 'network' })).toBeUndefined()
    expect(hypercombWriteRefusal({ reach: 'destructive', scope: 'hive' })).toBeUndefined()
  })

  it('is refused by a ceiling below editing', () => {
    expect(hypercombWriteRefusal({ reach: 'additive', scope: 'network' }))
      .toBe('/write is editing, and this hive grants a machine no further than additive')
  })

  it('is refused by a scope narrower than the hive', () => {
    expect(hypercombWriteRefusal({ reach: 'editing', scope: 'page' }))
      .toBe('/write reaches the hive, and this hive keeps a machine within the page')
  })

  it('is refused by the off switch', () => {
    expect(hypercombWriteRefusal({ reach: 'none', scope: 'network' }))
      .toBe('this hive grants a machine nothing at present, so /write cannot be run from here')
  })

  it('is not asked for a roster grant — there is no behaviour to grant', () => {
    expect(hypercombWriteRefusal({ reach: 'editing', scope: 'network', granted: [] })).toBeUndefined()
  })
})

describe('the chat window', () => {
  const source = readFileSync(join(process.cwd(), 'hypercomb-shared', 'ui', 'chat-window', 'chat-window.component.ts'), 'utf8')

  it('a trusted conversation never releases a row marked for review', () => {
    const release = source.slice(source.indexOf('#releaseTrusted(): void {'), source.indexOf('#releaseTrusted(): void {') + 500)
    expect(release).toContain('!row.forceReview')
  })

  it("holds a change for the rest of a conversation that read a peer's words, at every door", () => {
    expect(source).toContain('const conversationForeign = (): boolean =>')
    expect(source).toContain("(component.#foreignSigs.get(convoId)?.size ?? 0) > 0")
    expect(source).toContain('const foreign = !own && conversationForeign()')
    expect(source.split('foreign: conversationForeign()').length - 1).toBe(2)   // write, doctrine
    expect(source).not.toMatch(/foreign:?\s*=?\s*(!own && )?turnForeign\.length > 0/)
  })

  it('asks the grant before a write is queued and again after the wait, for code and doctrine alike', () => {
    for (const door of ['const runWrite = async', 'const runDoctrine = async']) {
      const at = source.indexOf(door)
      const body = source.slice(at, source.indexOf('\n      }\n', at))
      expect(body.split('hypercombWriteRefusal()').length - 1, door).toBe(2)
      expect(body.indexOf('hypercombWriteRefusal()'), door).toBeLessThan(body.indexOf('queue.request('))
      expect(body.lastIndexOf('hypercombWriteRefusal()'), door).toBeGreaterThan(body.indexOf("=== 'skip'"))
    }
  })
})
