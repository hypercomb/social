import { describe, expect, it } from 'vitest'
import { applyParams, inferSeams } from './comfy-workflow.js'
import { kleinTile, pictureTileName, sdxlIcon, sdxlRichTile } from './comfy-recipes.js'

describe('kleinTile', () => {
  it('has no checkpoint seam, so the diffusion model is not swapped for a checkpoint', () => {
    const spec = kleinTile()
    expect(spec.seams.checkpoint).toBeUndefined()
    expect(spec.seams.seed).toEqual({ node: '7', input: 'seed' })
    expect(spec.graph['7']?.inputs['seed']).toBe('')
    expect(spec.graph['1']?.inputs['unet_name']).toBe('flux3-image-klein-int8-convrot.safetensors')
    expect(inferSeams(spec.graph).checkpoint).toEqual({ node: '1', input: 'unet_name' })
  })
})

describe('sdxlRichTile', () => {
  it('keeps the checkpoint seam on the SDXL file', () => {
    const spec = sdxlRichTile()
    expect(spec.seams.checkpoint).toEqual({ node: '4', input: 'ckpt_name' })
    expect(spec.graph['4']?.inputs['ckpt_name']).toBe('sd_xl_base_1.0.safetensors')
  })
})

describe('sdxlIcon', () => {
  it('keeps the trigger beside the subject and loads Icons Redmond', () => {
    const spec = sdxlIcon()
    expect(spec.id).toBe('sdxl-icon')
    expect(spec.label).toBe('SDXL icon')
    expect(spec.seams.positive).toEqual({ node: '6', input: 'text' })
    expect(spec.seams.checkpoint).toEqual({ node: '4', input: 'ckpt_name' })
    expect(spec.graph['6']?.inputs['text']).toBe('a single gold compass')
    expect(spec.graph['12']?.inputs['text']).toBe('icredm, icons, app icon')
    expect(spec.graph['10']?.inputs['lora_name']).toBe('icons-redmond-v2.safetensors')
    expect(spec.graph['10']?.inputs['strength_model']).toBe(0.8)
    expect(spec.graph['3']?.inputs['seed']).toBe('')
    expect(spec.graph['3']?.inputs['steps']).toBe(24)
    expect(spec.graph['3']?.inputs['cfg']).toBe(6)
    expect(spec.graph['5']?.inputs['width']).toBe(1024)
    expect(spec.graph['11']).toBeUndefined()
    const next = applyParams(spec.graph, spec.seams, { positive: 'a settings gear' })
    expect(next['6']?.inputs['text']).toBe('a settings gear')
    expect(next['12']?.inputs['text']).toBe('icredm, icons, app icon')
    expect(spec.graph['6']?.inputs['text']).toBe('a single gold compass')
  })
})

describe('pictureTileName', () => {
  it('keeps three words and the end of the seed', () => {
    expect(pictureTileName('Dusk over a hexagonal stone courtyard', 1004821)).toBe('dusk-hexagonal-stone-4821')
  })

  it('falls back when the prompt has no usable words', () => {
    expect(pictureTileName('', 7)).toBe('picture-7')
    expect(pictureTileName('bees', 12)).toBe('picture-12')
  })
})
