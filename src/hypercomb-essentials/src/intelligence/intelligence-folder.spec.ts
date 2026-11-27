import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { folderMessage, intelligenceFolder, type DirectoryHandle } from './intelligence-folder.js'
import type { LayoutDirectory } from './intelligence-layout.js'

const GROUP = '{\n  "kind": "intelligence-group",\n  "name": "lineage-of-science",\n  "problem": "The public proofs the community stamps"\n}\n'

const handle = (name: string, grant: 'granted' | 'prompt' | 'denied', folder: 'present' | 'missing' | 'blocked' = 'present'): DirectoryHandle => ({
  name,
  kind: 'directory',
  queryPermission: vi.fn(async () => grant),
  requestPermission: vi.fn(async () => grant),
  entries: () => ({
    next: async () => {
      if (folder === 'blocked') throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      if (folder === 'missing') throw Object.assign(new Error('gone'), { name: 'NotFoundError' })
      return { done: true, value: undefined }
    },
  }),
} as unknown as DirectoryHandle)

const memory = () => {
  let saved: DirectoryHandle | null = null
  return {
    read: async () => saved,
    write: async (value: DirectoryHandle) => { saved = value },
    saved: () => saved,
  }
}

const tree = (name: string) => {
  const buckets = new Map<string, Map<string, string>>()
  const rootBucket = new Map<string, string>()
  buckets.set(name, rootBucket)
  const asDir = (dirName: string, bucket: Map<string, string>): DirectoryHandle => ({
    name: dirName,
    kind: 'directory',
    entries: () => ({ next: async () => ({ done: true, value: undefined }) }),
    getDirectoryHandle: async (child: string, options: { create: boolean }) => {
      const key = `${dirName}/${child}`
      let nested = buckets.get(key)
      if (!nested) {
        if (!options.create) throw Object.assign(new Error('gone'), { name: 'NotFoundError' })
        nested = new Map()
        buckets.set(key, nested)
      }
      return asDir(child, nested)
    },
    getFileHandle: async (file: string) => {
      if (!bucket.has(file)) throw Object.assign(new Error('gone'), { name: 'NotFoundError' })
      const text = bucket.get(file) ?? ''
      return { getFile: async () => ({ text: async () => text }) }
    },
  }) as unknown as DirectoryHandle
  return {
    root: asDir(name, rootBucket),
    buckets,
    write: vi.fn(async (dir: LayoutDirectory, file: string, text: string) => {
      const dirName = (dir as { name?: string }).name
      const key = dirName === name ? name : `${name}/${dirName}`
      const bucket = buckets.get(key)
      if (!bucket) throw Object.assign(new Error('gone'), { name: 'NotFoundError' })
      bucket.set(file, text)
    }),
  }
}

describe('intelligence folder prompt', () => {
  beforeEach(() => EffectBus.clear())

  it('opens the Windows folder prompt when nothing is set, then writes the group', async () => {
    const disk = tree('Intelligence')
    const pick = vi.fn(async () => disk.root)
    const store = memory()
    const folder = intelligenceFolder({ store, pick, write: disk.write })
    const outcome = await folder.start()

    expect(pick).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ kind: 'started', name: 'Intelligence' })
    expect(store.saved()).toBe(disk.root)
    expect(disk.buckets.get('Intelligence/lineage-of-science')?.get('group.json')).toBe(GROUP)
    expect(disk.buckets.get('Intelligence/lineage-of-science')?.has('refs.jsonl')).toBe(false)
    expect(folderMessage(outcome)).toContain('intelligence root')

    const again = await folder.start()
    expect(again).toEqual({ kind: 'started', name: 'Intelligence', already: true })
    expect(pick).toHaveBeenCalledOnce()
    expect(disk.write).toHaveBeenCalledTimes(1)
  })

  it('leaves a group that is already in the folder', async () => {
    const disk = tree('Intelligence')
    disk.buckets.set('Intelligence/lineage-of-science', new Map([['group.json', 'keep\n'], ['refs.jsonl', 'keep-refs\n']]))
    const outcome = await intelligenceFolder({
      store: memory(),
      pick: vi.fn(async () => disk.root),
      write: disk.write,
    }).start()
    expect(outcome.kind).toBe('started')
    expect(disk.write).not.toHaveBeenCalled()
    expect(disk.buckets.get('Intelligence/lineage-of-science')?.get('group.json')).toBe('keep\n')
    expect(disk.buckets.get('Intelligence/lineage-of-science')?.get('refs.jsonl')).toBe('keep-refs\n')
  })

  it('does not open a second prompt when the set folder is gone', async () => {
    const existing = handle('Intelligence', 'granted', 'missing')
    const pick = vi.fn(async () => handle('Other', 'granted'))
    const outcome = await intelligenceFolder({ store: memory(), pick, held: existing }).start()
    expect(pick).not.toHaveBeenCalled()
    expect(outcome).toEqual({ kind: 'reset', name: 'Intelligence', reason: 'disconnected' })
    expect(folderMessage(outcome)).toContain('disconnected')
  })

  it('does not prompt again when the grant has lapsed, and reset asks for the rights', async () => {
    const existing = handle('Intelligence', 'prompt')
    const pick = vi.fn(async () => handle('Other', 'granted'))
    const folder = intelligenceFolder({ store: memory(), pick, held: existing })

    const lapsed = await folder.start()
    expect(pick).not.toHaveBeenCalled()
    expect(lapsed).toEqual({ kind: 'reset', name: 'Intelligence', reason: 'rights' })
    expect(folderMessage(lapsed)).toContain('Reset the folder')
    expect(folderMessage(lapsed)).toContain('did not give up its rights')

    existing.requestPermission = vi.fn(async () => 'granted' as const)
    const again = await folder.reset()
    expect(again.kind).toBe('started')
    expect(existing.requestPermission).toHaveBeenCalledOnce()
    expect(pick).not.toHaveBeenCalled()
  })

  it('reset opens the folder prompt when no folder was stored', async () => {
    const chosen = handle('Groups', 'granted')
    const pick = vi.fn(async () => chosen)
    const outcome = await intelligenceFolder({ store: memory(), pick }).reset()
    expect(pick).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ kind: 'started', name: 'Groups' })
  })

  it('reports a lapsed write without opening another prompt', async () => {
    const disk = tree('Intelligence')
    const pick = vi.fn(async () => disk.root)
    disk.write.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const outcome = await intelligenceFolder({ store: memory(), pick, write: disk.write }).start()
    expect(pick).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ kind: 'reset', name: 'Intelligence', reason: 'rights' })
  })
})
