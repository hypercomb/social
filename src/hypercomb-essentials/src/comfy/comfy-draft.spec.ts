import { describe, expect, it } from 'vitest'
import {
  continuationKey,
  draftFromRecord,
  draftRecord,
  readComfyDraft,
  saveComfyDraft,
  type ComfyDraft,
} from './comfy-draft.js'

const klein = [
  { file: 'flux3-image-klein-int8-convrot.safetensors', kind: 'model', active: true },
  { file: 'qwen3vl_4b_int8_convrot.safetensors', kind: 'text', active: true },
  { file: 'flux2-vae.safetensors', kind: 'vae', active: true },
]

const rich = [
  { file: 'sd_xl_base_1.0.safetensors', kind: 'model', active: true },
  { file: 'add-detail-xl.safetensors', kind: 'lora', active: true },
  { file: 'sdxl_lightning_8step_lora.safetensors', kind: 'lora', active: true },
]

const icon = [
  { file: 'sd_xl_base_1.0.safetensors', kind: 'model', active: true },
  { file: 'icons-redmond-v2.safetensors', kind: 'lora', active: true },
  { file: 'sdxl_lightning_8step_lora.safetensors', kind: 'lora', active: false },
]

const blank = (): ComfyDraft => ({
  positive: 'a brass lantern',
  negative: '',
  seed: '',
  width: '1024',
  height: '1024',
  steps: '15',
  cfg: '1',
  batch: '1',
  fromTile: false,
  reviewers: 3,
})

describe('continuation keys', () => {
  it('names the model and the LoRAs, not the text encoder or the VAE', () => {
    expect(continuationKey(klein)).toBe('flux3-image-klein-int8-convrot.safetensors\n\n')
    expect(continuationKey(klein)).toBe(continuationKey([...klein].reverse()))
  })

  it('keeps a different LoRA set apart, and ignores a LoRA that is not loaded', () => {
    expect(continuationKey(rich)).not.toBe(continuationKey(icon))
    expect(continuationKey(rich)).toBe(continuationKey([...rich].reverse()))
    expect(continuationKey(icon)).toBe(
      'sd_xl_base_1.0.safetensors\n\nicons-redmond-v2.safetensors',
    )
  })

  it('is empty when nothing is loaded', () => {
    expect(continuationKey([])).toBe('')
    expect(continuationKey([{ file: 'x', kind: 'model', active: false }])).toBe('')
  })
})

describe('continuation records', () => {
  it('round-trips the form and leaves blanks out of the bytes', () => {
    const record = draftRecord(blank())
    expect(record).toEqual({
      kind: 'comfy-draft@1',
      positive: 'a brass lantern',
      reviewers: 3,
      width: 1024,
      height: 1024,
      steps: 15,
      cfg: 1,
      batch: 1,
    })
    expect(draftFromRecord(record)).toMatchObject({
      positive: 'a brass lantern',
      negative: '',
      seed: '',
      fromTile: false,
      width: '1024',
    })
  })

  it('writes one current record per combination and reads it back', async () => {
    const buckets = new Map<string, ArrayBuffer>()
    const keeps: string[] = []
    const store = {
      getPool: async () => ({}),
      getPoolDoc: async (_pool: unknown, subKey?: string) => buckets.get(subKey ?? '') ?? null,
      putPoolDoc: async (
        _pool: unknown,
        bytes: ArrayBuffer,
        subKey?: string,
        options?: { keep?: string },
      ) => {
        keeps.push(options?.keep ?? '')
        buckets.set(subKey ?? '', bytes)
        return 'sig'
      },
    }
    const key = continuationKey(icon)
    expect(await saveComfyDraft('', blank(), store)).toBeNull()
    expect(await saveComfyDraft(key, blank(), store)).toBe('sig')
    expect(keeps).toEqual(['current'])
    expect(await readComfyDraft(key, store)).toMatchObject({ positive: 'a brass lantern', width: '1024' })
    expect(await readComfyDraft(continuationKey(klein), store)).toBeNull()
  })
})
