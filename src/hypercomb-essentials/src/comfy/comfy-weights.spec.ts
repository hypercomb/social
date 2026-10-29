import { describe, expect, it } from 'vitest'
import { kleinTile, sdxlRichTile } from './comfy-recipes.js'
import {
  emptyLoadClock,
  noteCached,
  noteExecuting,
  weightLabel,
  weightRoster,
  weightsIn,
} from './comfy-weights.js'

describe('weightsIn', () => {
  it('reads the Klein model, text encoder and VAE, and no LoRA', () => {
    const uses = weightsIn(kleinTile().graph)
    expect(uses.map(use => use.file)).toEqual([
      'flux3-image-klein-int8-convrot.safetensors',
      'qwen3vl_4b_int8_convrot.safetensors',
      'flux2-vae.safetensors',
    ])
    expect(uses.map(use => use.kind)).toEqual(['model', 'text', 'vae'])
  })

  it('reads the SDXL checkpoint and both LoRAs', () => {
    const uses = weightsIn(sdxlRichTile().graph)
    expect(uses.map(use => [use.kind, use.file])).toEqual([
      ['model', 'sd_xl_base_1.0.safetensors'],
      ['lora', 'sdxl_lightning_8step_lora.safetensors'],
      ['lora', 'add-detail-xl.safetensors'],
    ])
  })
})

describe('weightLabel', () => {
  it('names Icons Redmond', () => {
    expect(weightLabel('icons-redmond-v2.safetensors')).toBe('Icons Redmond')
  })
})

describe('weightRoster', () => {
  it('marks only the selected workflow active', () => {
    const rows = weightRoster(
      [
        { id: 'klein-tile', graph: kleinTile().graph },
        { id: 'sdxl-rich-tile', graph: sdxlRichTile().graph },
      ],
      'klein-tile',
      emptyLoadClock(),
    )
    const active = rows.filter(row => row.active).map(row => row.label)
    expect(active).toEqual(['FLUX.3 Klein INT8', 'Qwen3-VL 4B', 'FLUX.2 VAE'])
    expect(rows.find(row => row.label === 'Lightning 8-step')?.active).toBe(false)
    expect(rows.find(row => row.label === 'Add Detail XL')?.kind).toBe('lora')
  })
})

describe('noteExecuting', () => {
  it('times a loader until the next node, and a cached node is not a load', () => {
    const graph = kleinTile().graph
    const started = noteExecuting(emptyLoadClock(), graph, '1', 1_000)
    expect(started.file).toBe('flux3-image-klein-int8-convrot.safetensors')
    const again = noteExecuting(started, graph, '1', 1_500)
    expect(again).toBe(started)
    const done = noteExecuting(started, graph, '7', 4_200)
    expect(done.ms['flux3-image-klein-int8-convrot.safetensors']).toBe(3_200)
    expect(done.file).toBeNull()
    const cached = noteCached(done, graph, ['2', '3'])
    expect(cached.cached['qwen3vl_4b_int8_convrot.safetensors']).toBe(true)
    expect(cached.cached['flux2-vae.safetensors']).toBe(true)
    const rows = weightRoster([{ id: 'klein-tile', graph }], 'klein-tile', cached)
    expect(rows[0]?.ms).toBe(3_200)
    expect(rows[1]?.cached).toBe(true)
  })
})
