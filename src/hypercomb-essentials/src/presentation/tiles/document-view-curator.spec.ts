import { afterEach, describe, expect, it } from 'vitest'
import type { Note } from '../../notes/notes.drone.js'
import { openDocumentViewCurator } from './document-view-curator.js'
import type { DocumentViewItem } from './document-view-source.js'

const note: Note = { id: 'n', text: '', shape: null, mark: null, tags: [], children: [] }
const item = (segments: string[], depth: number): DocumentViewItem => ({
  name: segments.at(-1)!,
  title: segments.at(-1)!,
  source: segments.slice(1).join(' › '),
  segments,
  depth,
  tags: [],
  notes: [note],
  childCount: 0,
})

describe('document view curator', () => {
  afterEach(() => document.body.replaceChildren())

  it('drills into a branch and commits the exact selected subset on Done', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    let saved: readonly (readonly string[])[] | undefined
    openDocumentViewCurator({
      host,
      rootLabel: 'root',
      rootSegments: ['root'],
      items: [
        item(['root', 'alpha'], 0),
        item(['root', 'alpha', 'detail'], 1),
        item(['root', 'beta'], 0),
      ],
      includedPaths: undefined,
      onCancel: () => undefined,
      onDone: paths => { saved = paths },
    })

    const labels = [...host.querySelectorAll<HTMLButtonElement>('.curator-label')]
    expect(labels.map(label => label.textContent)).toEqual([
      expect.stringContaining('alpha'),
      expect.stringContaining('beta'),
    ])
    labels[0]!.click()
    expect(host.querySelector('.curator-label')?.textContent).toContain('detail')

    host.querySelector<HTMLButtonElement>('.curator-check')!.click()
    host.querySelector<HTMLButtonElement>('.curator-done')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(saved).toEqual([['alpha'], ['beta']])
    expect(host.querySelector('.document-curator')).toBeNull()
  })
})
