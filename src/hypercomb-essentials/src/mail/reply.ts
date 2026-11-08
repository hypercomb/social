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

/** More than any real recipient list; a stranger's 200 KB To header is read only this far. */
const MAX_FIELD = 8 * 1024
const SEPARATORS = /[\s<>,;"']+/

/**
 * Every `local@domain` in a field. The field is cut into runs between separators
 * and each run is looked at once — a pattern that let its first half match `@`
 * cost n² on a long run with no `@` in it (a Reply all on a hostile To header).
 * A run's address starts after any leading `@` and needs one `@` with something
 * on both sides of it.
 */
const addressesIn = (field: string): string[] => {
  const found: string[] = []
  for (const run of field.slice(0, MAX_FIELD).split(SEPARATORS)) {
    let start = 0
    while (run[start] === '@') start++
    const at = run.indexOf('@', start)
    if (at > start && at < run.length - 1) found.push(run.slice(start).toLowerCase())
  }
  return found
}

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

/** `Fwd: ` once: a subject already marked forwarded (Fwd: or Fw:) is kept as it is. */
export const forwardSubject = (subject: string): string => (/^\s*fwd?:/i.test(subject) ? subject.trim() : `Fwd: ${subject.trim()}`)

/**
 * A forward, drafted: nobody to send it to yet, the message below a plain
 * "Forwarded message" block, and the attachments to carry by their index in
 * `mail.attachments` — the window opens each with attachmentBytes(raw, index)
 * when Send is pressed, so the draft holds none of the bytes. A forward starts
 * a new conversation, so it names no thread.
 */
export function forwardDraft(mail: ParsedMail): Draft & { readonly attachments: number[] } {
  const header = [
    '---------- Forwarded message ----------',
    `From: ${mail.from}`,
    ...(mail.date ? [`Date: ${mail.date}`] : []),
    `Subject: ${mail.subject}`,
    `To: ${mail.to}`,
    ...(mail.cc ? [`Cc: ${mail.cc}`] : []),
  ]
  return {
    to: '',
    cc: '',
    subject: forwardSubject(mail.subject),
    text: `\n\n${header.join('\n')}\n\n${mail.text}\n`,
    inReplyTo: '',
    references: '',
    attachments: mail.attachments.map((_, index) => index),
  }
}

/** Recipients as typed (commas, semicolons, spaces, `Name <a@b>`) → plain addresses. */
export const recipientsIn = (field: string): string[] => [...new Set(addressesIn(field))]
