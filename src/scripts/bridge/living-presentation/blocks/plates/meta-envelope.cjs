// meta: every reference is the signature of a small envelope, and the envelope
// points at exactly one thing of one kind.
const { svg, marker, group, card, wire, curve, glyph, text } = require('./pieces.cjs')

const KINDS = [
  ['layer', 'the words under a word', 'layers'],
  ['resource', 'bytes, by signature', 'resource'],
  ['dependency', 'code a bee needs', 'deps'],
  ['bee', 'a behaviour', 'bee'],
]

module.exports = () => svg('A meta envelope pointing at exactly one of four kinds: a layer, bytes, a dependency or a behaviour', [
  `<defs>${marker('mt-a')}</defs>`,
  group('meta', [
    '<rect x="60" y="130" width="240" height="140" rx="3" fill="var(--panel)" stroke="var(--honey)" stroke-width="1.5"/>',
    '<path d="M60,130 L180,204 L300,130" fill="none" stroke="var(--honey)" stroke-width="1.5"/>',
    text(180, 250, 'meta', 'k', 24),
    text(180, 302, 'its signature is the reference', 'm f', 13),
  ].join('')),
  ...KINDS.map(([id, sub, icon], i) => {
    const y = 34 + i * 88
    return wire(`meta-${id}`, curve(300, 200, 598, y + 31), { arrow: 'mt-a' }) +
      card(id, 604, y, 316, 62, '', { inner: glyph(icon, 640, y + 31, 26) + text(668, y + 28, id, 'k', 19, 'start') + text(668, y + 48, sub, 'm f', 13, 'start') })
  }),
].join('\n'))
