// mail/reply.ts
//
// A REPLY, DRAFTED. Pure: from a message that was read, what a reply to it starts
// as. Nothing is sent from here; the window shows the draft and the participant
// presses Send.

import type { ParsedMail } from './mime.js'

export interface Draft {
  readonly to: string
  readonly cc: string
  readonly subject: string
  readonly text: string
  readonly inReplyTo: string
  readonly references: string
}

const addressesIn = (field: string): string[] =>
  (field.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map(a => a.toLowerCase())

const ID = /<[^<>\s]{1,200}>/g

/** `Re: ` once, never stacked. */
export const replySubject = (subject: string): string => (/^\s*re:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`)

export const quoteText = (text: string): string => text.split(/\r?\n/).map(line => `> ${line}`).join('\n')

/** Reply to the sender (their Reply-To if they set one). `all` also keeps the other recipients, minus `me`. */
export function replyDraft(mail: ParsedMail, me: string, all = false): Draft {
  const asker = (mail.replyTo || mail.from).trim()
  const self = me.trim().toLowerCase()
  const others = all
    ? [...new Set([...addressesIn(mail.to), ...addressesIn(mail.cc)])].filter(a => a !== self && !addressesIn(asker).includes(a))
    : []

  // The thread: every id it already named, plus this message, capped so a long thread cannot grow a header past the limit.
  const prior = (mail.references.match(ID) ?? [])
  const thread = [...prior, ...(mail.messageId.match(ID) ?? [])].slice(-10)

  const when = mail.date ? `On ${mail.date}, ${mail.from} wrote:` : `${mail.from} wrote:`
  return {
    to: asker,
    cc: others.join(', '),
    subject: replySubject(mail.subject),
    text: `\n\n${when}\n${quoteText(mail.text)}\n`,
    inReplyTo: mail.messageId.match(ID)?.[0] ?? '',
    references: thread.join(' '),
  }
}

/** Recipients as typed (commas, semicolons, spaces, `Name <a@b>`) → plain addresses. */
export const recipientsIn = (field: string): string[] => [...new Set(addressesIn(field))]
