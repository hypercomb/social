// mail/mail-threads.spec.ts — the order a list is drawn in, its filter, and its
// conversations. What it proves: a row placed as it arrives lands where the
// sorted page will have it (so a finished load moves nothing); a conversation is
// whatever its messages name, however the chain was cut; and a conversation
// keeps the key it was first drawn under.

import { describe, expect, it } from 'vitest'
import { matchesWords, newestFirst, placeNewestFirst, searchWords, threadsOf, timeOf, type ThreadItem } from './mail-threads.js'

const row = (sig: string, at: number, meta: Partial<NonNullable<ThreadItem['meta']>> | null = {}, marks: ThreadItem['marks'] = null): ThreadItem =>
  ({ sig: sig.repeat(64).slice(0, 64), at, meta: meta === null ? null : { at, ...meta }, marks })

describe('order', () => {
  it('is the service’s: the sealed time, else arrival; ties by signature', () => {
    const a = row('a', 5)
    const b = row('b', 5)
    const late = { sig: 'c'.repeat(64), at: 9, meta: null }
    expect(timeOf(late)).toBe(9)
    expect([b, late, a].sort(newestFirst).map(r => r.sig[0])).toEqual(['c', 'a', 'b'])
  })

  it('places each row where the finished page will have it, whatever order they open in', () => {
    const page = [row('1', 1), row('2', 7), row('3', 3), row('4', 7), row('5', 0, null)]
    let shown: ThreadItem[] = []
    for (const item of [page[2]!, page[4]!, page[0]!, page[3]!, page[1]!]) shown = placeNewestFirst(shown, item)
    expect(shown.map(r => r.sig[0])).toEqual([...page].sort(newestFirst).map(r => r.sig[0]))
  })

  it('replaces a row already held where it stood, so a refresh re-reporting it moves nothing', () => {
    const shown = [row('1', 9), row('2', 5), row('3', 1)]
    const again = { ...row('2', 5), marks: { read: true } }
    const next = placeNewestFirst(shown, again)
    expect(next.map(r => r.sig[0])).toEqual(['1', '2', '3'])
    expect(next[1]!.marks?.read).toBe(true)
    expect(shown[1]!.marks).toBeNull() // a new list; the old one is untouched
  })
})

describe('conversations', () => {
  it('groups by Message-ID, In-Reply-To and References, newest conversation first, members newest first', () => {
    const items = [
      row('1', 1, { messageId: '<root@x>' }),
      row('2', 4, { messageId: '<r1@x>', inReplyTo: '<root@x>', references: ['<root@x>'] }),
      row('3', 3, { messageId: '<other@x>' }),
      row('4', 6, { messageId: '<r2@x>', inReplyTo: '<r1@x>', references: ['<root@x>', '<r1@x>'] }),
    ]
    const threads = threadsOf(items)
    expect(threads.map(t => t.items.map(i => i.sig[0]))).toEqual([['4', '2', '1'], ['3']])
    expect(threads[0]!.count).toBe(3)
    expect(threads[0]!.newest.sig[0]).toBe('4')
  })

  it('joins two replies whose shared parent is not in the list, and ids compare without case', () => {
    const threads = threadsOf([
      row('1', 2, { messageId: '<a@x>', references: ['<GONE@X>'] }),
      row('2', 3, { messageId: '<b@x>', inReplyTo: '<gone@x>' }),
    ])
    expect(threads).toHaveLength(1)
  })

  it('leaves a message with no ids (or no metadata) on its own', () => {
    expect(threadsOf([row('1', 1), row('2', 2), row('3', 3, null)])).toHaveLength(3)
  })

  it('counts unread members (not hidden) and says whether any is flagged', () => {
    const [thread] = threadsOf([
      row('1', 1, { messageId: '<a@x>' }, { read: true }),
      row('2', 2, { inReplyTo: '<a@x>' }, null),
      row('3', 3, { inReplyTo: '<a@x>' }, { hidden: true }),
      row('4', 4, { inReplyTo: '<a@x>' }, { flagged: true, read: true }),
    ])
    expect(thread!.unread).toBe(1)
    expect(thread!.flagged).toBe(true)
  })

  it('keeps the key a conversation was first drawn under when a reply joins it', () => {
    const first = threadsOf([row('1', 1, { messageId: '<a@x>' }), row('2', 2, { inReplyTo: '<a@x>' })])
    const keep = new Map(first[0]!.items.map(i => [i.sig, first[0]!.key]))
    const joined = threadsOf([row('0', 0, { messageId: '<z@x>', references: [] }), row('1', 1, { messageId: '<a@x>', references: ['<z@x>'] }), row('2', 2, { inReplyTo: '<a@x>' }), row('3', 3, { inReplyTo: '<a@x>' })], keep)
    expect(joined).toHaveLength(1)
    expect(joined[0]!.key).toBe(first[0]!.key)
  })

  it('never gives two conversations one key, even when the message that joined them is gone', () => {
    const whole = threadsOf([row('1', 1, { messageId: '<a@x>' }), row('2', 2, { messageId: '<b@x>' }), row('3', 3, { references: ['<a@x>', '<b@x>'] })])
    const keep = new Map(whole[0]!.items.map(i => [i.sig, whole[0]!.key]))
    const split = threadsOf([row('1', 1, { messageId: '<a@x>' }), row('2', 2, { messageId: '<b@x>' })], keep)
    expect(split).toHaveLength(2)
    expect(new Set(split.map(t => t.key)).size).toBe(2)
  })
})

describe('search', () => {
  it('finds every word somewhere in the fields, case aside; no words finds everything', () => {
    expect(searchWords('  Ana   PLANS ')).toEqual(['ana', 'plans'])
    expect(matchesWords(['Ana <ana@x.org>', 'Plans for Thursday', undefined], searchWords('thursday ana'))).toBe(true)
    expect(matchesWords(['Ana <ana@x.org>', 'Plans'], searchWords('bo'))).toBe(false)
    expect(matchesWords([], [])).toBe(true)
  })
})
