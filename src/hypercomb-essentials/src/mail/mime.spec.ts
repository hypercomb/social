// mail/mime.spec.ts — one message, read. The messages here are written the way
// real mail is: CRLF line ends, folded headers, encoded words, and parts in
// every transfer encoding.

import { describe, expect, it } from 'vitest'
import { htmlToText, MAX_MESSAGE_BYTES, parseMail } from './mime.js'

/** Bytes where each character is one byte, so an 0xE9 really is a Latin-1 é. */
const raw = (text: string): Uint8Array => Uint8Array.from(text, c => c.charCodeAt(0) & 0xff)
const crlf = (lines: string[]): string => lines.join('\r\n')
const b64 = (text: string): string => btoa(text).replace(/(.{60})/g, '$1\r\n')

describe('headers', () => {
  it('reads a plain message', () => {
    const mail = parseMail(raw(crlf([
      'From: Ana <ana@example.org>', 'To: jaime@hypercomb.com', 'Cc: leanne@hypercomb.com',
      'Subject: hello', 'Date: Thu, 5 Nov 2026 17:09:00 -0800', 'Message-ID: <m1@example.org>',
      'In-Reply-To: <m0@example.org>', 'References: <m-1@example.org> <m0@example.org>', '', 'one line', '',
    ])))
    expect(mail.from).toBe('Ana <ana@example.org>')
    expect(mail.to).toBe('jaime@hypercomb.com')
    expect(mail.cc).toBe('leanne@hypercomb.com')
    expect(mail.subject).toBe('hello')
    expect(mail.messageId).toBe('<m1@example.org>')
    expect(mail.inReplyTo).toBe('<m0@example.org>')
    expect(mail.references).toBe('<m-1@example.org> <m0@example.org>')
    expect(mail.text).toBe('one line')
    expect(mail.html).toBe('')
  })

  it('unfolds a header that was wrapped', () => {
    const mail = parseMail(raw(crlf(['Subject: a long subject that', ' continues here', '', 'x'])))
    expect(mail.subject).toBe('a long subject that continues here')
  })

  it('decodes encoded words in both forms, and joins adjacent ones without the space between', () => {
    const utf8 = btoa(String.fromCharCode(...new TextEncoder().encode('Café ☕')))
    expect(parseMail(raw(`Subject: =?UTF-8?B?${utf8}?=\r\n\r\nx`)).subject).toBe('Café ☕')
    expect(parseMail(raw('Subject: =?iso-8859-1?Q?Caf=E9_cr=E8me?=\r\n\r\nx')).subject).toBe('Café crème')
    expect(parseMail(raw('Subject: =?utf-8?Q?foo?= =?utf-8?Q?bar?=\r\n\r\nx')).subject).toBe('foobar')
    expect(parseMail(raw('Subject: =?bogus?Z?nope?=\r\n\r\nx')).subject).toBe('=?bogus?Z?nope?=')
  })

  it('reads a header the sender wrote as raw UTF-8', () => {
    const bytes = new TextEncoder().encode('Subject: Résumé\r\n\r\nx')
    expect(parseMail(bytes).subject).toBe('Résumé')
  })

  it('answers with empty fields, never a throw, for nothing or for noise', () => {
    expect(parseMail(new Uint8Array(0)).text).toBe('')
    expect(() => parseMail(raw('\u0000\u0001ÿ garbage with no headers at all'))).not.toThrow()
    expect(parseMail(raw('From: a@b.co')).from).toBe('a@b.co')
  })
})

describe('bodies', () => {
  it('decodes quoted-printable in the declared charset', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable', '',
      'caf=E9 and a soft=', ' break', '',
    ])))
    expect(mail.text).toBe('café and a soft break')
  })

  it('decodes base64 text', () => {
    const body = btoa(String.fromCharCode(...new TextEncoder().encode('héllo ✓')))
    const mail = parseMail(raw(crlf(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body, ''])))
    expect(mail.text).toBe('héllo ✓')
  })

  it('takes both sides of multipart/alternative', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/alternative; boundary="B"', '',
      '--B', 'Content-Type: text/plain; charset=utf-8', '', 'plain side', '',
      '--B', 'Content-Type: text/html; charset=utf-8', '', '<p>html <b>side</b></p>', '',
      '--B--', '',
    ])))
    expect(mail.text).toBe('plain side')
    expect(mail.html).toContain('<b>side</b>')
  })

  it('makes a text for a message that came as html only', () => {
    const mail = parseMail(raw(crlf(['Content-Type: text/html', '', '<style>p{color:red}</style><p>Hi&nbsp;there &amp; <a href="x">you</a></p><p>second</p>', ''])))
    expect(mail.text).toBe('Hi there & you\nsecond')
  })

  it('joins several text parts of a mixed message', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/mixed; boundary=X', '',
      '--X', 'Content-Type: text/plain', '', 'body', '',
      '--X', 'Content-Type: text/plain', '', '-- signature', '',
      '--X--', '',
    ])))
    expect(mail.text).toBe('body\n\n-- signature')
  })
})

describe('attachments and inline images', () => {
  it('lists an attachment by name, type and decoded size, without keeping its bytes', () => {
    const file = 'a'.repeat(100)
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/mixed; boundary=X', '',
      '--X', 'Content-Type: text/plain', '', 'see attached', '',
      '--X', 'Content-Type: application/pdf; name="plan.pdf"', 'Content-Disposition: attachment; filename="plan.pdf"',
      'Content-Transfer-Encoding: base64', '', b64(file), '',
      '--X--', '',
    ])))
    expect(mail.text).toBe('see attached')
    expect(mail.attachments).toEqual([{ filename: 'plan.pdf', type: 'application/pdf', size: 100 }])
  })

  it('decodes an RFC 2231 filename with a non-ASCII character', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/mixed; boundary=X', '',
      '--X', "Content-Type: application/octet-stream", "Content-Disposition: attachment; filename*=utf-8''na%C3%AFve%20plan.txt",
      'Content-Transfer-Encoding: base64', '', btoa('hi'), '',
      '--X--', '',
    ])))
    expect(mail.attachments[0].filename).toBe('naïve plan.txt')
  })

  it('carries an inline image by Content-ID as a data URL, and does not list it as an attachment', () => {
    const png = String.fromCharCode(0x89, 0x50, 0x4e, 0x47)
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/related; boundary=R', '',
      '--R', 'Content-Type: text/html', '', '<img src="cid:logo@x">', '',
      '--R', 'Content-Type: image/png', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '', btoa(png), '',
      '--R--', '',
    ])))
    expect(mail.inlineImages['logo@x']).toBe(`data:image/png;base64,${btoa(png)}`)
    expect(mail.attachments).toEqual([])
  })

  it('never inlines an svg (it can carry script) — it is listed instead', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/related; boundary=R', '',
      '--R', 'Content-Type: text/html', '', '<img src="cid:s">', '',
      '--R', 'Content-Type: image/svg+xml', 'Content-ID: <s>', 'Content-Transfer-Encoding: base64', '', btoa('<svg onload="x()"/>'), '',
      '--R--', '',
    ])))
    expect(mail.inlineImages['s']).toBeUndefined()
    expect(mail.attachments.map(a => a.type)).toEqual(['image/svg+xml'])
  })

  it('refuses to inline an image over its cap', () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 10)
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/related; boundary=R', '',
      '--R', 'Content-Type: image/png', 'Content-ID: <big>', 'Content-Transfer-Encoding: base64', '', btoa(big), '',
      '--R--', '',
    ])))
    expect(mail.inlineImages['big']).toBeUndefined()
    expect(mail.attachments[0].size).toBe(big.length)
  })

  it('names a forwarded message', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/mixed; boundary=X', '',
      '--X', 'Content-Type: message/rfc822', '', 'Subject: inner', '', 'inner body', '',
      '--X--', '',
    ])))
    expect(mail.attachments[0].filename).toBe('message.eml')
  })
})

describe('hostile messages', () => {
  it('stops at the depth cap instead of recursing forever', () => {
    let body = 'Content-Type: text/plain\r\n\r\ndeep'
    for (let i = 0; i < 30; i++) body = `Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n${body}\r\n--b${i}--\r\n`
    expect(() => parseMail(raw(body))).not.toThrow()
  })

  it('stops at the part cap', () => {
    const parts = Array.from({ length: 500 }, (_, i) => `--X\r\nContent-Type: text/plain\r\n\r\npart ${i}\r\n`).join('')
    const mail = parseMail(raw(`Content-Type: multipart/mixed; boundary=X\r\n\r\n${parts}--X--\r\n`))
    expect(mail.text.split('\n\n').length).toBeLessThanOrEqual(200)
  })

  it('reads only up to the message cap', () => {
    const big = new Uint8Array(MAX_MESSAGE_BYTES + 1000).fill(97)
    big.set(raw('Subject: big\r\n\r\n'))
    expect(parseMail(big).subject).toBe('big')
  })
})

describe('htmlToText', () => {
  it('reads entities and numeric references, and leaves an unknown one alone', () => {
    expect(htmlToText('a&lt;b&gt; &#65;&#x42; &unknown; &copy;')).toBe('a<b> AB &unknown; &copy;')
  })
})
