import { describe, expect, it } from 'vitest'
import {
  addedChildSigs,
  generationFromJson,
  generationLine,
  generationSigOf,
} from './history-generation.js'

const SIG = 'a'.repeat(64)

describe('generationFromJson', () => {
  it('reads a generation record', () => {
    const view = generationFromJson(JSON.stringify({
      kind: 'comfy-generation@1',
      positive: 'a single gold compass',
      seed: 424242,
      steps: 24,
      cfg: 6,
      width: 1024,
      height: 1024,
      workflow: 'sdxl-icon',
      label: 'SDXL icon',
      model: 'sd_xl_base_1.0.safetensors',
    }))
    expect(view).toEqual({
      positive: 'a single gold compass',
      seed: 424242,
      steps: 24,
      cfg: 6,
      width: 1024,
      height: 1024,
      workflow: 'sdxl-icon',
      label: 'SDXL icon',
      model: 'sd_xl_base_1.0.safetensors',
    })
    expect(generationLine(view as { positive: string })).toBe('a single gold compass')
  })

  it('uses the name the participant gave the picture', () => {
    const view = generationFromJson(JSON.stringify({
      kind: 'comfy-generation@1',
      name: 'Lantern',
      positive: 'a paper lantern in fog',
    }))
    expect(view).toMatchObject({ name: 'Lantern', positive: 'a paper lantern in fog' })
    expect(generationLine(view as { positive: string; name: string })).toBe('Lantern')
  })

  it('follows a resource incidence one hop', () => {
    expect(generationFromJson(JSON.stringify({ meta: 1, resource: SIG, relation: 'generation' })))
      .toEqual({ follow: SIG })
  })

  it('ignores anything else', () => {
    expect(generationFromJson('not json')).toBeNull()
    expect(generationFromJson('{"kind":"other"}')).toBeNull()
  })
})

describe('generationSigOf', () => {
  it('reads only a signature', () => {
    expect(generationSigOf({ generation: SIG })).toBe(SIG)
    expect(generationSigOf({ generation: 'nope' })).toBe('')
    expect(generationSigOf(null)).toBe('')
  })
})

describe('addedChildSigs', () => {
  it('keeps the child that is new in this revision', () => {
    const older = 'b'.repeat(64)
    const newer = 'c'.repeat(64)
    expect(addedChildSigs([older], [newer])).toEqual([newer])
    expect(addedChildSigs([older], [older])).toEqual([])
  })
})
