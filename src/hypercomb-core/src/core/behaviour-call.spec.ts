import { describe, it, expect } from 'vitest'
import { parseBehaviourCall, primaryText, BehaviourCallError } from './behaviour-call.js'

const call = (s: string) => parseBehaviourCall(s)!

describe('behaviour call — the bare pairing still works', () => {
  it('parses target@view', () => {
    expect(call('diagram@slides')).toMatchObject({ target: 'diagram', view: 'slides', remove: false, called: false })
  })

  it('parses the ~ detach prefix', () => {
    expect(call('~diagram@slides')).toMatchObject({ target: 'diagram', view: 'slides', remove: true })
  })

  it('lowercases the view but leaves the target alone (the caller resolves names)', () => {
    expect(call('My Tile@SLIDES')).toMatchObject({ target: 'My Tile', view: 'slides' })
  })

  it('distinguishes no call from an empty call', () => {
    expect(call('a@postit').called).toBe(false)
    expect(call('a@postit()').called).toBe(true)
    expect(call('a@postit()').args).toEqual([])
  })
})

describe('behaviour call — not a call at all (never hijack other input)', () => {
  for (const input of ['', 'hello', '@slides', 'a@', 'a@b@c', 'a:b@slides', '[a,b]:tag', '/postit here x', 'me@example.com']) {
    it(`returns null for ${JSON.stringify(input)}`, () => {
      expect(parseBehaviourCall(input)).toBeNull()
    })
  }
})

describe('behaviour call — the strict grammar', () => {
  it('reads a double-quoted message', () => {
    expect(call('meetup@postit("Doors at 7")').args).toEqual(['Doors at 7'])
  })

  it('reads several arguments', () => {
    expect(call('t@x("a", "b")').args).toEqual(['a', 'b'])
  })

  it('reads numbers, booleans and null', () => {
    expect(call('deck@slide(3)').args).toEqual([3])
    expect(call('t@x(true, false, null)').args).toEqual([true, false, null])
    expect(call('t@x(-2.5)').args).toEqual([-2.5])
  })

  it('reads named arguments', () => {
    const c = call('t@website("Doors at 7", draft: true)')
    expect(c.args).toEqual(['Doors at 7'])
    expect(c.named).toEqual({ draft: true })
  })

  it('decodes escapes — the programmer standard', () => {
    expect(call(`t@postit('Don\\'t forget')`).args).toEqual(["Don't forget"])
    expect(call('t@postit("say \\"hi\\"")').args).toEqual(['say "hi"'])
    expect(call('t@postit("a\\nb")').args).toEqual(['a\nb'])
  })

  it('an escaped message parses STRICTLY, not forgivingly', () => {
    expect(call(`t@postit('Don\\'t forget')`).forgiving).toBe(false)
  })

  it('an apostrophe inside double quotes needs no help', () => {
    const c = call(`t@postit("Don't forget")`)
    expect(c.args).toEqual(["Don't forget"])
    expect(c.forgiving).toBe(false)
  })
})

describe('behaviour call — the human fallback', () => {
  it('parses the line a person actually types', () => {
    const c = call(`tile@postit('Don't forget to check this location out!')`)
    expect(c.args).toEqual(["Don't forget to check this location out!"])
    expect(c.forgiving).toBe(true)
  })

  it('runs to the LAST quote, so inner quotes survive', () => {
    expect(call(`t@postit('She said 'go' and left')`).args)
      .toEqual([`She said 'go' and left`])
  })

  it('only engages where the strict grammar has no reading', () => {
    // strict succeeds here, so the fallback must not turn it into one string
    const c = call('t@x("a", "b")')
    expect(c.forgiving).toBe(false)
    expect(c.args).toEqual(['a', 'b'])
  })

  it('leaves commas and colons inside a message alone', () => {
    const c = call(`t@postit('Bring: wine, cigars, and don't be late')`)
    expect(c.args).toEqual([`Bring: wine, cigars, and don't be late`])
  })
})

describe('behaviour call — malformed calls speak up', () => {
  it('throws when the parens never close', () => {
    expect(() => parseBehaviourCall('t@postit("hi"')).toThrow(BehaviourCallError)
  })

  it('throws when a string never closes and no fallback applies', () => {
    expect(() => parseBehaviourCall('t@x(a, "hi)')).toThrow(BehaviourCallError)
  })

  it('throws when a named argument is repeated', () => {
    expect(() => parseBehaviourCall('t@x(a: 1, a: 2)')).toThrow(BehaviourCallError)
  })

  it('throws when a plain argument follows a named one', () => {
    expect(() => parseBehaviourCall('t@x(a: 1, 2)')).toThrow(BehaviourCallError)
  })

  it('carries the position of the problem', () => {
    try { parseBehaviourCall('t@x(a: 1, a: 2)'); expect.fail('should have thrown') }
    catch (e) { expect((e as BehaviourCallError).index).toBeGreaterThan(0) }
  })
})

describe('primaryText', () => {
  it('gives the first argument as text', () => {
    expect(primaryText(call('t@postit("hi")'))).toBe('hi')
    expect(primaryText(call('t@slide(3)'))).toBe('3')
    expect(primaryText(call('t@postit()'))).toBe('')
    expect(primaryText(call('t@postit'))).toBe('')
  })
})
