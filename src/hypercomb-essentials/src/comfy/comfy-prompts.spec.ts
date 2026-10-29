import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import {
  listComfyPrompts,
  promptRecord,
  saveComfyPrompt,
  type ComfyPromptDraft,
} from './comfy-prompts.js'

interface Held {
  bytes: ArrayBuffer
  lastModified: number
}

const memory = () => {
  const files = new Map<string, Held>()
  let clock = 1_000
  const dir = {
    entries: async function* () {
      for (const [name, held] of files) {
        yield [name, {
          kind: 'file',
          getFile: async () => ({
            size: held.bytes.byteLength,
            lastModified: held.lastModified,
            text: async () => new TextDecoder().decode(held.bytes),
          }),
        }] as [string, { kind: string; getFile: () => Promise<{ size: number; lastModified: number; text: () => Promise<string> }> }]
      }
    },
  }
  const writes: ArrayBuffer[] = []
  const store = {
    getPool: async () => dir,
    putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => {
      writes.push(bytes)
      const sig = await SignatureService.sign(bytes)
      clock += 10
      files.set(sig, { bytes, lastModified: clock })
      return sig
    },
  }
  return { files, writes, store }
}

const lantern: ComfyPromptDraft = {
  positive: '  a paper lantern in fog  ',
  negative: ' text ',
  seed: 7,
  steps: 8,
  cfg: 1.5,
  width: 1024,
  height: 1024,
  batch: 1,
  workflow: 'klein-tile',
  label: 'Klein',
  fromTile: false,
  reviewers: 5,
}

describe('a kept prompt', () => {
  it('is the words and the knobs, with no clock in the bytes', () => {
    const record = promptRecord(lantern)
    expect(record).toEqual({
      kind: 'comfy-prompt@1',
      positive: 'a paper lantern in fog',
      negative: 'text',
      seed: 7,
      steps: 8,
      cfg: 1.5,
      width: 1024,
      height: 1024,
      batch: 1,
      workflow: 'klein-tile',
      label: 'Klein',
      reviewers: 5,
    })
    expect(JSON.stringify(record)).not.toContain('"at"')
    expect(JSON.stringify(record)).not.toContain('fromTile')
    expect(promptRecord({ positive: '   ' })).toBeNull()
    expect(promptRecord({ positive: 'dusk', fromTile: true, reviewers: 40 })?.fromTile).toBe(true)
    expect(promptRecord({ positive: 'dusk', reviewers: 40 })?.reviewers).toBe(8)
  })

  it('keeps two states and collapses the same state to one member', async () => {
    const { files, writes, store } = memory()
    const first = await saveComfyPrompt(lantern, store)
    const again = await saveComfyPrompt({ ...lantern, positive: 'a paper lantern in fog' }, store)
    const harbor = await saveComfyPrompt({ positive: 'a harbor at dusk', workflow: 'sdxl-tile', label: 'SDXL' }, store)
    expect(first).toBe(again)
    expect(harbor).not.toBe(first)
    expect(writes).toHaveLength(3)
    expect(files.size).toBe(2)
    const listed = await listComfyPrompts(store)
    expect(listed.map(row => row.text)).toEqual(['a harbor at dusk', 'a paper lantern in fog'])
    expect(listed[1]).toMatchObject({ seed: 7, workflow: 'klein-tile', label: 'Klein', reviewers: 5 })
    expect(listed[1].fromTile).toBeUndefined()
  })

  it('lists the language of every atom and skips markers and strangers', async () => {
    const { files, store } = memory()
    await saveComfyPrompt({ positive: 'kept' }, store)
    const noise = new TextEncoder().encode('nope').buffer as ArrayBuffer
    files.set('00000000', { bytes: noise, lastModified: 9_999 })
    files.set('not-a-signature', { bytes: noise, lastModified: 9_999 })
    files.set('ab'.repeat(32), { bytes: new TextEncoder().encode('{"kind":"other"}').buffer as ArrayBuffer, lastModified: 9_999 })
    const listed = await listComfyPrompts(store)
    expect(listed.map(row => row.text)).toEqual(['kept'])
  })

  it('does not write a prompt that has no words', async () => {
    const { writes, store } = memory()
    expect(await saveComfyPrompt({ positive: '  ', seed: 3 }, store)).toBeNull()
    expect(writes).toHaveLength(0)
    expect(await listComfyPrompts(store)).toEqual([])
  })
})
