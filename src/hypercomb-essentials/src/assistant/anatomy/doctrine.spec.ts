// doctrine.spec.ts — THE DOCTRINE IS A HIVE ARTIFACT: sections as resources,
// a record naming them, a lineage bag whose head is the doctrine this hive
// runs. The seed follows the build until the participant chooses otherwise,
// and nothing is ever removed.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { ANATOMY_MECHANICS, ANATOMY_SECTIONS, ANATOMY_TEXT } from './anatomy.generated.js'
import {
  commitDoctrine, composeAnatomy, headingOf, hiveSection, isHeading, loadDoctrine, previousDoctrine, readMarkers, readRecord, sourceOf, writeSection,
  type DoctrineBag, type DoctrineIo,
} from './doctrine.js'

const world = () => {
  const heap = new Map<string, string>()
  const markers = new Map<string, string>()
  let clock = 1_000
  const bag: DoctrineBag = {
    names: async () => [...markers.keys()],
    read: async name => markers.get(name) ?? null,
    write: async (name, text) => { markers.set(name, text) },
  }
  const io: DoctrineIo = {
    put: async text => { const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer); heap.set(sig, text); return sig },
    get: async sig => heap.get(sig) ?? null,
    bag: async () => bag,
    now: () => ++clock,
  }
  return { io, heap, markers, bag }
}

const SEED = ['### One\n(source: one.md)\n\nFirst rule.', '### Two\n(source: two.md)\n\nSecond rule.']

describe('the seed', () => {
  it('composes to the build\'s own anatomy, byte for byte', () => {
    expect(composeAnatomy(ANATOMY_MECHANICS, ANATOMY_SECTIONS)).toBe(ANATOMY_TEXT)
    expect(ANATOMY_SECTIONS.every(section => headingOf(section) && sourceOf(section))).toBe(true)
  })
})

describe('sections', () => {
  it('reads a heading and a source, and writes a hive section in place or at the end', () => {
    expect(headingOf(SEED[0]!)).toBe('One')
    expect(sourceOf(SEED[1]!)).toBe('two.md')
    expect(hiveSection('Two', '\nNew second rule.\n\n')).toBe('### Two\n(source: hive)\n\nNew second rule.')
    expect(writeSection(SEED, 'Two', 'New second rule.')).toEqual([SEED[0], '### Two\n(source: hive)\n\nNew second rule.'])
    expect(writeSection(SEED, 'Three', 'Third rule.')).toHaveLength(3)
    expect(isHeading('The core rule')).toBe(true)
    expect(isHeading('### x')).toBe(false)
    expect(isHeading('a\nb')).toBe(false)
    expect(isHeading('x'.repeat(81))).toBe(false)
  })
})

describe('the doctrine bag', () => {
  it('takes the seed as marker zero on an empty bag, and every section is a resource the record names', async () => {
    const w = world()
    const state = await loadDoctrine(w.io, SEED)
    expect(state).toMatchObject({ sections: SEED, marker: '00000000', by: 'seed', seedPending: false })
    expect(await readRecord(w.io, state.recordSig)).toEqual(SEED)
    expect(JSON.parse(w.heap.get(state.recordSig)!)).toMatchObject({ kind: 'doctrine' })
    // Loading again writes nothing new.
    await loadDoctrine(w.io, SEED)
    expect([...w.markers.keys()]).toEqual(['00000000'])
  })

  it('follows a build whose doctrine moved while the head is the seed\'s', async () => {
    const w = world()
    await loadDoctrine(w.io, SEED)
    const moved = [...SEED, '### Three\n(source: three.md)\n\nThird rule.']
    const state = await loadDoctrine(w.io, moved)
    expect(state).toMatchObject({ sections: moved, marker: '00000001', by: 'seed' })
  })

  it('keeps the participant\'s head over a moved build, and says the build is pending', async () => {
    const w = world()
    await loadDoctrine(w.io, SEED)
    const edited = writeSection(SEED, 'Two', 'Rules change.')
    const committed = await commitDoctrine(w.io, edited, 'hive', SEED)
    expect(committed).toMatchObject({ ok: true, state: { marker: '00000001', by: 'hive', seedPending: false } })
    const moved = [...SEED, '### Three\n(source: three.md)\n\nThird rule.']
    const state = await loadDoctrine(w.io, moved)
    expect(state).toMatchObject({ sections: edited, marker: '00000001', by: 'hive', seedPending: true })
    expect((await readMarkers(w.bag)).map(marker => marker.by)).toEqual(['seed', 'hive'])
  })

  it('steps back as a forward commit, and a commit that changes nothing writes nothing', async () => {
    const w = world()
    await loadDoctrine(w.io, SEED)
    await commitDoctrine(w.io, SEED.slice(0, 1), 'hive', SEED)
    const back = await previousDoctrine(w.io)
    expect(back).toEqual({ sections: SEED })
    if ('error' in back) return
    const again = await commitDoctrine(w.io, back.sections, 'hive', SEED)
    expect(again).toMatchObject({ ok: true, state: { marker: '00000002', sections: SEED } })
    const same = await commitDoctrine(w.io, SEED, 'hive', SEED)
    expect(same).toMatchObject({ ok: true, state: { marker: '00000002' } })
    expect([...w.markers.keys()]).toEqual(['00000000', '00000001', '00000002'])
  })

  it('refuses an empty doctrine, and runs the seed without writing when the head cannot be read', async () => {
    const w = world()
    expect(await commitDoctrine(w.io, [], 'hive', SEED)).toEqual({ ok: false, error: 'the doctrine would have no sections' })
    await w.bag.write('00000000', JSON.stringify({ layerSig: 'f'.repeat(64), at: 1, by: 'hive' }))
    const state = await loadDoctrine(w.io, SEED)
    expect(state.sections).toEqual(SEED)
    expect(state.marker).toBe('')
    expect([...w.markers.keys()]).toEqual(['00000000'])
  })

  it('runs the seed in memory when no store is open', async () => {
    const w = world()
    const state = await loadDoctrine({ ...w.io, bag: async () => null }, SEED)
    expect(state).toMatchObject({ sections: SEED, marker: '', by: 'seed' })
  })
})
