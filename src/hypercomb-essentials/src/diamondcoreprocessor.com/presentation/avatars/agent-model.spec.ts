import { describe, expect, it } from 'vitest'
import { KNOWN_VENDORS, identifyModel, isModelName, modelPalette } from './agent-model.js'

describe('isModelName', () => {
  it('knows this hive\'s own model commands', () => {
    for (const name of ['opus', 'sonnet', 'haiku', 'fable']) expect(isModelName(name)).toBe(true)
  })

  it('knows models from other vendors', () => {
    for (const name of ['gpt-4o', 'o3-mini', 'gemini-2.5-pro', 'llama-3.1-70b', 'mistral-large', 'grok-2', 'deepseek-r1', 'ollama:qwen']) {
      expect(isModelName(name), name).toBe(true)
    }
  })

  it('does not mistake a behaviour for a model', () => {
    for (const name of ['website', 'tutor', 'sync', 'orchestrator', 'present', '']) {
      expect(isModelName(name), name).toBe(false)
    }
  })
})

describe('identifyModel', () => {
  it('reads the vendor off the name', () => {
    expect(identifyModel('claude-opus-4').vendor).toBe('anthropic')
    expect(identifyModel('gpt-4o').vendor).toBe('openai')
    expect(identifyModel('gemini-2.5-flash').vendor).toBe('google')
    expect(identifyModel('llama-3.1-405b').vendor).toBe('meta')
    expect(identifyModel('mixtral-8x7b').vendor).toBe('mistral')
    expect(identifyModel('grok-2').vendor).toBe('xai')
    expect(identifyModel('ollama:phi').vendor).toBe('local')
  })

  it('reads the tier off the name', () => {
    expect(identifyModel('opus').tier).toBe('deep')
    expect(identifyModel('sonnet').tier).toBe('balanced')
    expect(identifyModel('haiku').tier).toBe('fast')
    expect(identifyModel('gemini-2.5-pro').tier).toBe('deep')
    expect(identifyModel('gpt-4o-mini').tier).toBe('fast')
  })

  it('never fails on a model it has never heard of', () => {
    const unknown = identifyModel('some-new-model-9')
    expect(unknown.vendor).toBe('unknown')
    expect(unknown.tier).toBe('balanced')
  })

  it('is case-insensitive and trims', () => {
    expect(identifyModel('  GPT-4o  ').vendor).toBe('openai')
  })
})

describe('modelPalette', () => {
  const hex = (c: string): [number, number, number] => {
    const n = Number.parseInt(c.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const luma = (c: string): number => {
    const [r, g, b] = hex(c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const hue = (c: string): number => {
    const [r, g, b] = hex(c).map(v => v / 255)
    const max = Math.max(r, g, b); const min = Math.min(r, g, b)
    if (max === min) return 0
    const d = max - min
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return ((h * 60) % 360 + 360) % 360
  }

  it('gives one family per vendor — siblings share a hue', () => {
    const claude = ['opus', 'sonnet', 'haiku'].map(m => hue(modelPalette(m).body))
    for (const h of claude) expect(Math.abs(h - claude[0])).toBeLessThan(12)
  })

  it('separates vendors — a Claude bee never looks like a GPT bee', () => {
    const families = KNOWN_VENDORS.map(v => hue(modelPalette(
      { anthropic: 'opus', openai: 'gpt-4o', google: 'gemini-pro', meta: 'llama-3',
        mistral: 'mistral-large', xai: 'grok-2', deepseek: 'deepseek-r1', local: 'ollama:x' }[v] as string,
    ).body))
    for (let i = 0; i < families.length; i++) {
      for (let j = i + 1; j < families.length; j++) {
        const apart = Math.abs(families[i] - families[j])
        expect(Math.min(apart, 360 - apart), `${KNOWN_VENDORS[i]} vs ${KNOWN_VENDORS[j]}`).toBeGreaterThan(14)
      }
    }
  })

  it('shades by tier — deep models darker than fast ones in the same family', () => {
    expect(luma(modelPalette('opus').body)).toBeLessThan(luma(modelPalette('sonnet').body))
    expect(luma(modelPalette('sonnet').body)).toBeLessThan(luma(modelPalette('haiku').body))
    expect(luma(modelPalette('gpt-4o-mini').body)).toBeGreaterThan(luma(modelPalette('o3').body))
  })

  it('keeps stripes dark and wings light, whatever the vendor', () => {
    for (const model of ['opus', 'gpt-4o', 'gemini-flash', 'made-up-model']) {
      const palette = modelPalette(model)
      expect(luma(palette.stripe), model).toBeLessThan(luma(palette.body))
      expect(luma(palette.wing), model).toBeGreaterThan(luma(palette.body))
    }
  })

  it('is stable — the same model always looks the same', () => {
    expect(modelPalette('gpt-4o')).toEqual(modelPalette('gpt-4o'))
  })
})
