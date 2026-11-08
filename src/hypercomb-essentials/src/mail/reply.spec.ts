// mail/reply.spec.ts — a reply, drafted. Nothing is sent from here.

import { describe, expect, it } from 'vitest'
import type { ParsedMail } from './mime.js'
import { forwardDraft, forwardSubject, quoteText, recipientsIn, replyDraft, replySubject } from './reply.js'

const mail = (over: Partial<ParsedMail> = {}): ParsedMail => ({
  from: 'Ana <ana@example.org>', to: 'jaime@hypercomb.com', cc: '', replyTo: '', subject: 'plans', date: 'Thu, 5 Nov 2026',
  messageId: '<m2@example.org>', inReplyTo: '', references: '', text: 'line one\nline two', html: '',
  attachments: [], inlineImages: {}, ...over,
})

describe('replyDraft', () => {
  it('answers the sender, quotes the message and names the thread', () => {
    const draft = replyDraft(mail(), 'jaime@hypercomb.com')
    expect(draft.to).toBe('Ana <ana@example.org>')
    expect(draft.subject).toBe('Re: plans')
    expect(draft.text).toContain('Thu, 5 Nov 2026, Ana <ana@example.org> wrote:')
    expect(draft.text).toContain('> line one\n> line two')
    expect(draft.inReplyTo).toBe('<m2@example.org>')
    expect(draft.references).toBe('<m2@example.org>')
  })

  it('goes to Reply-To when the sender set one', () => {
    expect(replyDraft(mail({ replyTo: 'list@example.org' }), 'jaime@hypercomb.com').to).toBe('list@example.org')
  })

  it('continues a thread, and caps how long its References header can grow', () => {
    const many = Array.from({ length: 30 }, (_, i) => `<r${i}@x>`).join(' ')
    const draft = replyDraft(mail({ references: many }), 'jaime@hypercomb.com')
    const ids = draft.references.split(' ')
    expect(ids.length).toBe(10)
    expect(ids[ids.length - 1]).toBe('<m2@example.org>')
  })

  it('leaves the thread headers empty for a message with no id', () => {
    const draft = replyDraft(mail({ messageId: '' }), 'jaime@hypercomb.com')
    expect(draft.inReplyTo).toBe('')
    expect(draft.references).toBe('')
  })

  it('reply-all keeps the others, minus me and minus the person already answered', () => {
    const draft = replyDraft(mail({ to: 'Jaime <jaime@hypercomb.com>, bo@example.org', cc: 'Ana@Example.org, cy@example.org' }), 'Jaime@hypercomb.com', true)
    expect(draft.cc).toBe('bo@example.org, cy@example.org')
    expect(replyDraft(mail({ to: 'bo@example.org' }), 'jaime@hypercomb.com', false).cc).toBe('')
  })
})

describe('the small helpers', () => {
  it('puts Re: on once', () => {
    expect(replySubject('plans')).toBe('Re: plans')
    expect(replySubject('Re: plans')).toBe('Re: plans')
    expect(replySubject('  RE: plans ')).toBe('RE: plans')
  })

  it('quotes every line, blank ones too', () => {
    expect(quoteText('a\n\nb')).toBe('> a\n> \n> b')
  })

  it('reads recipients however they were typed, once each, lowercase', () => {
    expect(recipientsIn('Ana <Ana@Example.org>; bo@example.org, ana@example.org  cy@example.org')).toEqual(['ana@example.org', 'bo@example.org', 'cy@example.org'])
    expect(recipientsIn('')).toEqual([])
    expect(recipientsIn('not an address')).toEqual([])
  })
})

describe('forwardDraft', () => {
  const withFiles = mail({
    cc: 'bo@example.org',
    attachments: [{ filename: 'plan.pdf', type: 'application/pdf', size: 10 }, { filename: 'rows.csv', type: 'text/csv', size: 3 }],
  })

  it('goes to nobody yet, marks the subject once and names no thread', () => {
    const draft = forwardDraft(withFiles)
    expect(draft.to).toBe('')
    expect(draft.cc).toBe('')
    expect(draft.subject).toBe('Fwd: plans')
    expect(draft.inReplyTo).toBe('')
    expect(draft.references).toBe('')
  })

  it('carries the message below a plain forwarded block', () => {
    expect(forwardDraft(withFiles).text).toBe(
      '\n\n---------- Forwarded message ----------\nFrom: Ana <ana@example.org>\nDate: Thu, 5 Nov 2026\nSubject: plans\n'
      + 'To: jaime@hypercomb.com\nCc: bo@example.org\n\nline one\nline two\n',
    )
  })

  it('leaves out a Date or Cc the message did not have', () => {
    const text = forwardDraft(mail({ date: '' })).text
    expect(text).not.toContain('Date:')
    expect(text).not.toContain('Cc:')
  })

  it('names every attachment to carry by its index, none for a message without any', () => {
    expect(forwardDraft(withFiles).attachments).toEqual([0, 1])
    expect(forwardDraft(mail()).attachments).toEqual([])
  })

  it('puts Fwd: on once, keeping a Fw: the sender already wrote', () => {
    expect(forwardSubject('plans')).toBe('Fwd: plans')
    expect(forwardSubject('Fwd: plans')).toBe('Fwd: plans')
    expect(forwardSubject(' FW: plans ')).toBe('FW: plans')
    expect(forwardSubject('Re: plans')).toBe('Fwd: Re: plans')
  })
})

describe('after the security review (R1)', () => {
  const quick = (run: () => unknown, ms: number): void => {
    const started = performance.now()
    run()
    expect(performance.now() - started).toBeLessThan(ms)
  }

  it('#3 reads a 200k-character recipients field or To header in linear time', () => {
    quick(() => expect(recipientsIn('b'.repeat(2e5))).toEqual([]), 100)
    quick(() => recipientsIn('@'.repeat(2e5)), 100)
    quick(() => recipientsIn('a@'.repeat(1e5)), 100)
    quick(() => replyDraft(mail({ to: 'b'.repeat(2e5), cc: 'c'.repeat(2e5) }), 'jaime@hypercomb.com', true), 100)
  })

  it('#3 reads only the first 8 KB of a field', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `p${i}@example.org`).join(', ')
    const got = recipientsIn(many)
    expect(got.length).toBeGreaterThan(400)
    expect(got.length).toBeLessThan(2000)
    expect(got[0]).toBe('p0@example.org')
  })

  it('#3 still finds addresses the way it always did', () => {
    expect(recipientsIn('@@ana@example.org, a@, @b, a@b@c')).toEqual(['ana@example.org', 'a@b@c'])
    expect(recipientsIn('"Ana, A." <Ana@Example.org>')).toEqual(['ana@example.org'])
  })
})
