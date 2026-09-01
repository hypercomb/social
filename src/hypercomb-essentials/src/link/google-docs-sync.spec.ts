import { describe, expect, it } from 'vitest'
import { driveFolderCandidates, reconcileGoogleDocs, type GoogleDocRecord } from './google-docs-sync.js'
import type { GoogleDocSummary } from './google-docs.js'

const doc = (id: string, parents: { id: string; name: string }[] = []): GoogleDocSummary => ({
  id,
  name: `doc-${id}`,
  url: `https://docs.google.com/document/d/${id}/edit`,
  modified: '2026-08-01T00:00:00.000Z',
  owner: 'someone@example.com',
  parents,
})

const record = (id: string, over: Partial<GoogleDocRecord> = {}): GoogleDocRecord => ({
  id,
  pulledVersion: '5',
  pulledSig: 'sig-pulled',
  currentSig: 'sig-pulled',
  ...over,
})

const at = (version: string | null) => () => version

describe('reconciling Drive against the hive', () => {
  it('adds a document the hive has never seen', () => {
    expect(reconcileGoogleDocs([doc('a')], [], at('5'))).toEqual([
      { action: 'add', doc: doc('a') },
    ])
  })

  it('leaves a document alone when neither side moved', () => {
    const plan = reconcileGoogleDocs([doc('a')], [record('a')], at('5'))
    expect(plan[0]!.action).toBe('unchanged')
  })

  it('pulls when only Google moved', () => {
    const plan = reconcileGoogleDocs([doc('a')], [record('a')], at('9'))
    expect(plan[0]!.action).toBe('pull')
  })

  it('pushes when only the hive edited', () => {
    const plan = reconcileGoogleDocs([doc('a')], [record('a', { currentSig: 'sig-edited' })], at('5'))
    expect(plan[0]!.action).toBe('push')
  })

  // The case the module exists for: pushing destroys their edit, pulling
  // destroys ours, so neither happens without the participant.
  it('refuses to choose when BOTH sides moved', () => {
    const plan = reconcileGoogleDocs([doc('a')], [record('a', { currentSig: 'sig-edited' })], at('9'))
    expect(plan[0]!.action).toBe('conflict')
  })

  it('treats an unknown version as moved rather than assuming it is safe', () => {
    // No version stamp available — the safe reading is "Google may have moved".
    expect(reconcileGoogleDocs([doc('a')], [record('a')], at(null))[0]!.action).toBe('pull')
    expect(reconcileGoogleDocs([doc('a')], [record('a', { pulledVersion: null })], at('5'))[0]!.action).toBe('pull')
  })

  it('reports a tracked document Drive stopped returning without deleting it', () => {
    const plan = reconcileGoogleDocs([], [record('gone')], at('5'))
    expect(plan).toEqual([{ action: 'vanished', record: record('gone') }])
  })

  it('handles a mixed sweep without losing or duplicating a document', () => {
    const plan = reconcileGoogleDocs(
      [doc('new'), doc('same'), doc('remote'), doc('local'), doc('both')],
      [
        record('same'),
        record('remote'),
        record('local', { currentSig: 'sig-edited' }),
        record('both', { currentSig: 'sig-edited' }),
        record('gone'),
      ],
      candidate => (candidate.id === 'remote' || candidate.id === 'both' ? '9' : '5'),
    )

    expect(plan.map(entry => entry.action)).toEqual([
      'add', 'unchanged', 'pull', 'push', 'conflict', 'vanished',
    ])
  })
})

describe('Drive folders as grouping candidates', () => {
  it('counts the folders a pulled set sits in, busiest first', () => {
    const folders = driveFolderCandidates([
      doc('a', [{ id: 'f1', name: 'Projects' }]),
      doc('b', [{ id: 'f1', name: 'Projects' }]),
      doc('c', [{ id: 'f2', name: 'Archive' }]),
    ])

    expect(folders).toEqual([
      { id: 'f1', name: 'Projects', count: 2 },
      { id: 'f2', name: 'Archive', count: 1 },
    ])
  })

  it('counts a document sitting in several folders under each of them', () => {
    const folders = driveFolderCandidates([
      doc('a', [{ id: 'f1', name: 'Projects' }, { id: 'f2', name: 'Archive' }]),
    ])

    expect(folders.map(folder => folder.name).sort()).toEqual(['Archive', 'Projects'])
  })

  it('offers nothing to group by when no document has a parent', () => {
    expect(driveFolderCandidates([doc('a'), doc('b')])).toEqual([])
  })
})
