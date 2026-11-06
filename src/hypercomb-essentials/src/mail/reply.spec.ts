// mail/reply.spec.ts — a reply, drafted. Nothing is sent from here.

import { describe, expect, it } from 'vitest'
import type { ParsedMail } from './mime.js'
import { quoteText, recipientsIn, replyDraft, replySubject } from './reply.js'

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
