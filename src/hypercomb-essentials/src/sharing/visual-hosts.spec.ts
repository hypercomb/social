import { describe, expect, it, vi } from 'vitest'
import { noteVisualHosts } from './visual-hosts.js'

describe('publisher image host discovery', () => {
  it('attributes every image variant and layer once, without fetching content', () => {
    const refs = ['a', 'b', 'c', 'd', 'e', 'f'].map(char => char.repeat(64))
    const note = vi.fn()
    noteVisualHosts([{
      layerSig: refs[0], imageSig: refs[1], small: { image: refs[1] },
      large: { image: refs[2] }, point: { image: refs[3] },
      flat: { small: { image: refs[4] }, large: { image: refs[5] } },
      name: '9'.repeat(64), link: '8'.repeat(64),
    }], ['publisher.example'], note)
    expect(note.mock.calls).toEqual(refs.map(sig => [sig, ['publisher.example']]))
  })

  it('ignores invalid signatures and hostless announcements', () => {
    const note = vi.fn()
    noteVisualHosts([{ imageSig: 'not-a-signature', small: { image: 123 } }], ['host.example'], note)
    noteVisualHosts([{ imageSig: 'a'.repeat(64) }], [], note)
    expect(note).not.toHaveBeenCalled()
  })
})
