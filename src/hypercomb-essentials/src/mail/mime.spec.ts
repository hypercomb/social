// mail/mime.spec.ts — one message, read. The messages here are written the way
// real mail is: CRLF line ends, folded headers, encoded words, and parts in
// every transfer encoding.

import { describe, expect, it } from 'vitest'
import { attachmentBytes, attachmentsBytes, htmlToText, MAX_MESSAGE_BYTES, parseMail, previewText } from './mime.js'

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

describe('attachmentBytes — one attachment, opened when it is asked for', () => {
  const text = (bytes: Uint8Array | null): string | null => (bytes ? String.fromCharCode(...bytes) : null)

  const mixed = raw(crlf([
    'Content-Type: multipart/mixed; boundary=X', '',
    '--X', 'Content-Type: text/plain', '', 'see attached', '',
    '--X', 'Content-Type: multipart/related; boundary=R', '',
    '--R', 'Content-Type: text/html', '', '<img src="cid:logo">', '',
    '--R', 'Content-Type: image/png', 'Content-ID: <logo>', 'Content-Transfer-Encoding: base64', '', btoa('PNGBYTES'), '',
    '--R--', '',
    '--X', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="plan.pdf"', 'Content-Transfer-Encoding: base64', '', b64('first file'), '',
    '--X', 'Content-Type: text/csv', 'Content-Disposition: attachment; filename="rows.csv"', 'Content-Transfer-Encoding: quoted-printable', '', 'a,b=3Dc', '',
    '--X', 'Content-Type: message/rfc822', '', 'Subject: inner', '', 'inner body', '',
    '--X--', '',
  ]))

  it('numbers attachments exactly as parseMail lists them, with the inline image left out of the count', () => {
    expect(parseMail(mixed).attachments.map(a => a.filename)).toEqual(['plan.pdf', 'rows.csv', 'message.eml'])
    expect(text(attachmentBytes(mixed, 0))).toBe('first file')
    expect(text(attachmentBytes(mixed, 1))).toBe('a,b=c')
    // An attached file comes out byte for byte: its own CRLFs are not rewritten.
    expect(text(attachmentBytes(mixed, 2))).toBe('Subject: inner\r\n\r\ninner body')
  })

  it('gives bytes whose length is the size parseMail reported', () => {
    const listed = parseMail(mixed).attachments
    listed.forEach((a, i) => expect(attachmentBytes(mixed, i)?.length).toBe(a.size))
  })

  it('answers null for an index there is no attachment at, and never throws', () => {
    expect(attachmentBytes(mixed, 3)).toBeNull()
    expect(attachmentBytes(mixed, -1)).toBeNull()
    expect(attachmentBytes(mixed, 1.5)).toBeNull()
    expect(attachmentBytes(mixed, Number.NaN)).toBeNull()
    expect(attachmentBytes(new Uint8Array(0), 0)).toBeNull()
    expect(() => attachmentBytes(raw('\u0000garbage'), 0)).not.toThrow()
  })

  it('opens an svg and an over-cap image, which were listed rather than inlined', () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 10)
    const mail = raw(crlf([
      'Content-Type: multipart/related; boundary=R', '',
      '--R', 'Content-Type: image/svg+xml', 'Content-ID: <s>', '', '<svg/>', '',
      '--R', 'Content-Type: image/png', 'Content-ID: <big>', 'Content-Transfer-Encoding: base64', '', btoa(big), '',
      '--R--', '',
    ]))
    expect(text(attachmentBytes(mail, 0))).toBe('<svg/>')
    expect(attachmentBytes(mail, 1)?.length).toBe(big.length)
  })

  it('spends the inline budget in the same order as parseMail, so an image past the total cap is numbered on both walks', () => {
    const image = (cid: string, fill: string): string[] => ['--R', 'Content-Type: image/png', `Content-ID: <${cid}>`, 'Content-Transfer-Encoding: base64', '', btoa(fill.repeat(2 * 1024 * 1024)), '']
    const mail = raw(crlf([
      'Content-Type: multipart/related; boundary=R', '',
      ...image('a', 'a'), ...image('b', 'b'), ...image('c', 'c'), ...image('d', 'd'), ...image('e', 'e'),
      '--R--', '',
    ]))
    const parsed = parseMail(mail)
    expect(Object.keys(parsed.inlineImages)).toEqual(['a', 'b', 'c', 'd'])
    expect(parsed.attachments.length).toBe(1)
    const bytes = attachmentBytes(mail, 0)
    expect(bytes?.length).toBe(2 * 1024 * 1024)
    expect(bytes?.[0]).toBe('e'.charCodeAt(0))
  })

  it('stays inside the part cap: an attachment past it cannot be opened, as it was never listed', () => {
    const filler = Array.from({ length: 250 }, (_, i) => `--X\r\nContent-Type: text/plain\r\n\r\npart ${i}\r\n`).join('')
    const mail = raw(`Content-Type: multipart/mixed; boundary=X\r\n\r\n${filler}--X\r\nContent-Type: application/zip\r\nContent-Disposition: attachment; filename=late.zip\r\n\r\nzz\r\n--X--\r\n`)
    expect(parseMail(mail).attachments).toEqual([])
    expect(attachmentBytes(mail, 0)).toBeNull()
  })
})

describe('previewText — the opening of a message, for a list row', () => {
  const of = (text: string, max?: number): string => previewText({ text }, max)

  it('folds whitespace into one line', () => {
    expect(of('Hi Ana,\n\n  the plans   are\tready.\n')).toBe('Hi Ana, the plans are ready.')
  })

  it('leaves out the quoted reply, its "On … wrote:" line and the signature', () => {
    const reply = 'Sounds good.\n\nOn Thu, 5 Nov 2026, Ana <ana@example.org> wrote:\n> the plans\n> are ready\n\n-- \nJaime'
    expect(of(reply)).toBe('Sounds good.')
    expect(of('Fine by me.\n---------- Forwarded message ----------\nFrom: x')).toBe('Fine by me.')
    expect(of('> quoted first\nthen mine')).toBe('then mine')
  })

  it('does not mistake a sentence beginning with "on" for an attribution', () => {
    expect(of('once more\nok')).toBe('once more ok')
  })

  it('falls back to the whole text when everything was quoted', () => {
    expect(of('> only a quote')).toBe('> only a quote')
  })

  it('cuts to max characters with an ellipsis, never splitting a character in two', () => {
    const cut = of('a'.repeat(200))
    expect(Array.from(cut).length).toBe(120)
    expect(cut.endsWith('…')).toBe(true)
    expect(of('☕'.repeat(20), 10)).toBe(`${'☕'.repeat(9)}…`)
    expect(of('😀'.repeat(20), 5)).toBe(`${'😀'.repeat(4)}…`)
    expect(of('short', 120)).toBe('short')
    expect(of('anything', 0)).toBe('')
  })

  it('reads a parsed message, html-only ones included', () => {
    const mail = parseMail(raw(crlf(['Content-Type: text/html', '', '<p>Hello <b>there</b></p><p>second</p>', ''])))
    expect(previewText(mail)).toBe('Hello there second')
  })

  it('looks only at the head of a very long message', () => {
    const started = performance.now()
    expect(of(`start ${'word '.repeat(1_000_000)}`, 20)).toBe('start word word wor…')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('after the security review (R1)', () => {
  const quick = (run: () => unknown, ms: number): void => {
    const started = performance.now()
    run()
    expect(performance.now() - started).toBeLessThan(ms)
  }

  it('#2 htmlToText is one forward scan: a sea of `<` or of unclosed `<style` costs its length', () => {
    quick(() => expect(htmlToText('<'.repeat(1e6))).toBe(''), 200)
    quick(() => expect(htmlToText('<style'.repeat(2e5))).toBe(''), 200)
    quick(() => htmlToText('<script>'.repeat(1e5)), 200)
    quick(() => htmlToText(`a${' '.repeat(1e6)}b\n`), 200)
    quick(() => htmlToText('&'.repeat(5e5) + 'a'.repeat(5e5)), 200)
  })

  it('#2 a `<` with no `>` ends the text, and a script with no closer runs to the end', () => {
    expect(htmlToText('kept <b>bold</b> then <never closed')).toBe('kept bold then')
    expect(htmlToText('before<script>alert(1) and the rest')).toBe('before')
    expect(htmlToText('a<SCRIPT type=x>no</ScRiPt >b<style>p{}</style>c')).toBe('abc')
    expect(htmlToText('one<br/>two<BR>three</P>four</h2>five</divx>six')).toBe('one\ntwo\nthree\nfour\nfivesix')
  })

  it('#2 reads only the first 512 KB of an html body as text', () => {
    expect(htmlToText(`${'a'.repeat(600 * 1024)}`).length).toBe(512 * 1024)
  })

  it('#7 takes line breaks and bidi controls out of decoded headers and filenames', () => {
    const subject = btoa('Hi\r\nBcc: boss@corp.example')
    const mail = parseMail(raw(crlf([
      `Subject: =?utf-8?B?${subject}?=`, `From: =?utf-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('Ana\u0007\u202e')))}?= <ana@example.org>`,
      'Content-Type: multipart/mixed; boundary=X', '',
      '--X', 'Content-Type: application/octet-stream', "Content-Disposition: attachment; filename*=utf-8''invoice%E2%80%AEfdp.exe", '', 'MZ', '',
      '--X', 'Content-Type: application/octet-stream', "Content-Disposition: attachment; filename*=utf-8''a%E2%81%A6b%E2%80%8Fc%C2%85d%00e", '', 'x', '',
      '--X--', '',
    ])))
    expect(mail.subject).toBe('Hi  Bcc: boss@corp.example')
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.from).toBe('Ana <ana@example.org>')
    expect(mail.attachments.map(a => a.filename)).toEqual(['invoicefdp.exe', 'abcde'])
  })

  it('#8 a large nested message reads in about the time of one pass over it', () => {
    // 8 multiparts deep, one quoted-printable part of very short lines, ~14 MB — the shape that took 7 s.
    const lines = Array.from({ length: 2_950_000 }, (_, i) => (i % 2 ? 'a=3D' : 'b=')).join('\r\n')
    let part = `Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=big.bin\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${lines}`
    for (let level = 0; level < 7; level++) part = `Content-Type: multipart/mixed; boundary=L${level}\r\n\r\n--L${level}\r\n${part}\r\n--L${level}--\r\n`
    const bytes = raw(part)
    expect(bytes.length).toBeGreaterThan(14 * 1024 * 1024)
    expect(bytes.length).toBeLessThan(15 * 1024 * 1024)
    let parsed: ReturnType<typeof parseMail> | undefined
    quick(() => { parsed = parseMail(bytes) }, 1000)
    expect(parsed?.attachments.length).toBe(1)
    let opened: Uint8Array | null = null
    quick(() => { opened = attachmentBytes(bytes, 0) }, 1500)
    expect(opened!.length).toBe(parsed!.attachments[0]!.size)
  })

  it('#8 lists an attachment\'s size without decoding it, and the size matches the bytes', () => {
    const file = Array.from({ length: 3000 }, (_, i) => String.fromCharCode(i % 256)).join('')
    const mail = raw(crlf([
      'Content-Type: multipart/mixed; boundary=X', '',
      '--X', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename=a.bin', 'Content-Transfer-Encoding: base64', '', b64(file), '',
      '--X', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename=b.bin', 'Content-Transfer-Encoding: quoted-printable', '', 'x=3Dy=\r\nz=41', '',
      '--X--', '',
    ]))
    const listed = parseMail(mail).attachments
    expect(listed.map(a => a.size)).toEqual([3000, 5])
    expect(String.fromCharCode(...attachmentBytes(mail, 0)!)).toBe(file)
    expect(String.fromCharCode(...attachmentBytes(mail, 1)!)).toBe('x=yzA')
  })

  it('#8 keeps reading a boundary only at the start of a line, and ignores a longer boundary that shares its start', () => {
    const mail = parseMail(raw(crlf([
      'Content-Type: multipart/mixed; boundary=X', '',
      'preamble --X not a delimiter',
      '--X', 'Content-Type: text/plain', '', 'one --X still one', '--Xlonger is text too', '',
      '--X  ', 'Content-Type: text/plain', '', 'two', '',
      '--X--', 'epilogue',
    ])))
    expect(mail.text).toBe('one --X still one\n--Xlonger is text too\n\ntwo')
  })

  it('#9 the inline map has no prototype, so a cid named like an Object member finds nothing', () => {
    const mail = parseMail(raw('Subject: x\r\n\r\nbody'))
    expect(Object.getPrototypeOf(mail.inlineImages)).toBeNull()
    expect(mail.inlineImages['constructor']).toBeUndefined()
    expect(mail.inlineImages['toString']).toBeUndefined()
  })
})

describe('attachmentsBytes — many attachments from one walk (R2)', () => {
  /** A small picture's bytes, different for every index. */
  const picture = (index: number, size: number): Uint8Array => {
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + index * 7) & 0xff
    return bytes
  }
  const asText = (bytes: Uint8Array): string => {
    let out = ''
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return out
  }
  /** Byte for byte, without vitest walking 190 typed arrays element by element. */
  const same = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean =>
    !!a && !!b && a.length === b.length && a.every((byte, i) => byte === b[i])
  const COUNT = 190
  const SIZE = 23 * 1024
  const pictures = Array.from({ length: COUNT }, (_, i) => picture(i, SIZE))
  const message = raw(crlf([
    'From: a@example.com',
    'Subject: pictures',
    'Content-Type: multipart/mixed; boundary="B"',
    '',
    '--B',
    'Content-Type: text/plain',
    '',
    'All of them.',
    ...pictures.flatMap((bytes, i) => [
      '--B',
      `Content-Type: image/png; name="p${i}.png"`,
      `Content-Disposition: attachment; filename="p${i}.png"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64(asText(bytes)),
    ]),
    '--B--',
    '',
  ]))

  it('returns all 190 pictures of a ~6 MB message from one call, well under a second', () => {
    expect(message.length).toBeGreaterThan(5.5 * 1024 * 1024)
    expect(message.length).toBeLessThan(6.5 * 1024 * 1024)
    expect(parseMail(message).attachments.length).toBe(COUNT)

    const started = performance.now()
    const found = attachmentsBytes(message, pictures.map((_, i) => i))
    expect(performance.now() - started).toBeLessThan(750)

    expect(found.size).toBe(COUNT)
    for (let i = 0; i < COUNT; i++) expect(same(found.get(i), pictures[i]), `picture ${i}`).toBe(true)
    for (const i of [0, 97, 189]) expect(same(found.get(i), attachmentBytes(message, i)), `picture ${i}`).toBe(true)
  })

  it('answers only the indices that name an attachment', () => {
    const found = attachmentsBytes(message, [3, 3, 189, 190, -1, 1.5, Number.NaN])
    expect([...found.keys()].sort((a, b) => a - b)).toEqual([3, 189])
    expect(attachmentsBytes(message, []).size).toBe(0)
  })

  it('numbers as parseMail does when inline images come first', () => {
    const mixed = raw(crlf([
      'Content-Type: multipart/related; boundary="R"',
      '',
      '--R',
      'Content-Type: text/html',
      '',
      '<p><img src="cid:logo"></p>',
      '--R',
      'Content-Type: image/png',
      'Content-ID: <logo>',
      'Content-Transfer-Encoding: base64',
      '',
      b64(asText(picture(900, 64))),
      '--R',
      'Content-Type: application/pdf; name="a.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      b64('first'),
      '--R',
      'Content-Type: application/zip; name="b.zip"',
      'Content-Transfer-Encoding: base64',
      '',
      b64('second'),
      '--R--',
    ]))
    expect(parseMail(mixed).attachments.map(a => a.filename)).toEqual(['a.pdf', 'b.zip'])
    const found = attachmentsBytes(mixed, [0, 1])
    expect(asText(found.get(0)!)).toBe('first')
    expect(asText(found.get(1)!)).toBe('second')
    expect(found.get(1)).toEqual(attachmentBytes(mixed, 1))
  })

  it('gives an empty Map for malformed input, never a throw', () => {
    const inputs = [
      new Uint8Array(0),
      raw('no headers, no body'),
      raw(crlf(['Content-Type: multipart/mixed; boundary="X"', '', '--X', 'Content-Type: image/png; name="a.png"', 'Content-Transfer-Encoding: base64', ''])),
      raw(crlf(['Content-Type: multipart/mixed; boundary=""', '', '--', '--'])),
      Uint8Array.from({ length: 4096 }, (_, i) => (i * 131) & 0xff),
    ]
    for (const input of inputs) {
      const found = attachmentsBytes(input, [0, 1, 2])
      expect(found).toBeInstanceOf(Map)
      for (const bytes of found.values()) expect(bytes).toBeInstanceOf(Uint8Array)
    }
    expect(attachmentsBytes(new Uint8Array(0), [0]).size).toBe(0)
    expect(attachmentsBytes(raw('no headers, no body'), [0]).size).toBe(0)
  })
})
