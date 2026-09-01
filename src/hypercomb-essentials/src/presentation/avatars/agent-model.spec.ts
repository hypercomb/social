import { describe, expect, it } from 'vitest'
import { KNOWN_VENDORS, brandToken, identifyModel, isModelName, modelPalette } from './agent-model.js'

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

// The name a bee WEARS. It is painted on the abdomen, which is eight
// characters wide, so the reduction has to be lossy — and it has to lose the
// right things: the vendor (already said by the colour family) before the
// version, and the version before the word that separates siblings.
describe('brandToken', () => {
  it('drops the vendor — the colour family already said whose it is', () => {
    // The version survives when it fits — `opus45` and `opus` are different
    // models, and the belly has room to say so.
    expect(brandToken('claude-opus-4-5')).toBe('opus45')
    expect(brandToken('opus')).toBe('opus')
    // A version stranded at the FRONT by the dropped vendor names nothing.
    expect(brandToken('claude-3-5-sonnet')).toBe('sonnet')
    expect(brandToken('ollama:qwen')).toBe('qwen')
    expect(brandToken('lmstudio:zephyr')).toBe('zephyr')
  })

  it('keeps a version when a version is the whole difference', () => {
    expect(brandToken('grok-2')).toBe('grok2')
    expect(brandToken('grok-4')).toBe('grok4')
    expect(brandToken('gpt-4o')).toBe('gpt4o')
  })

  it('never runs past the belly', () => {
    for (const name of ['gemini-2.5-flash', 'llama-3.1-405b', 'deepseek-r1', 'orchestrator', 'gpt-4o-mini']) {
      expect(brandToken(name).length, name).toBeLessThanOrEqual(8)
    }
  })

  it('keeps the word that separates siblings when it has to cut', () => {
    expect(brandToken('gemini-2.5-flash')).toBe('gemflash')
    expect(brandToken('gemini-2.5-pro').endsWith('pro')).toBe(true)
    expect(brandToken('gpt-4o-mini').endsWith('mini')).toBe(true)
  })

  it('tells same-vendor siblings apart', () => {
    const lineup = ['opus', 'sonnet', 'haiku', 'fable', 'gpt-4o', 'gpt-4o-mini', 'gpt-5',
      'gemini-2.5-pro', 'gemini-2.5-flash', 'grok-2', 'grok-4']
    expect(new Set(lineup.map(brandToken)).size).toBe(lineup.length)
  })

  it('is safe to bake into an SVG, whatever it is handed', () => {
    for (const name of ['<script>', 'a & b', '  MiXeD-Case  ', '', '???']) {
      expect(brandToken(name)).toMatch(/^[a-z0-9]*$/)
    }
    expect(brandToken('  MiXeD-Case  ')).toBe('mixecase')
  })

  it('names a behaviour too — every bee wears something', () => {
    expect(brandToken('website')).toBe('website')
    expect(brandToken('tutor')).toBe('tutor')
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

// Vendor + tier alone gave a vendor only THREE looks to share among all its
// models, so same-weight siblings collided: `sonnet` and `fable` are both
// balanced Anthropic models and used to come out byte-identical. Two models
// working the same hive have to be tellable apart, so each one now carries its
// own accent inside its tier. These cases guard the accent from both sides —
// it must be big enough to see, and small enough that it can never overrule
// the family or the tier it sits in.
describe('modelPalette — every model is its own brand', () => {
  const hex = (c: string): [number, number, number] => {
    const n = Number.parseInt(c.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const apart = (a: string, b: string): number => {
    const [ar, ag, ab] = hex(a); const [br, bg, bb] = hex(b)
    return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)
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

  /** A line-up per vendor, deliberately including SAME-TIER siblings — the
   *  case tier can do nothing about. */
  const LINEUPS: Record<string, string[]> = {
    anthropic: ['opus', 'sonnet', 'haiku', 'fable', 'claude-3-5-sonnet', 'claude-3-opus'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o1', 'gpt-5', 'codex'],
    google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemma-2', 'gemini-1.5-pro'],
    meta: ['llama-3.1-405b', 'llama-3.1-70b', 'llama-3.2-8b'],
    mistral: ['mistral-large', 'mixtral-8x7b', 'codestral', 'magistral'],
    xai: ['grok-2', 'grok-4', 'grok-mini'],
    deepseek: ['deepseek-r1', 'deepseek-v3'],
    // NOT `local/mixtral` — that reads as Mistral, and rightly so: it is
    // mixtral, which happens to be running on your machine.
    local: ['ollama:qwen', 'ollama:phi', 'lmstudio:zephyr'],
  }
  const every = Object.values(LINEUPS).flat()

  it('the regression: sonnet and fable are no longer the same bee', () => {
    expect(modelPalette('sonnet')).not.toEqual(modelPalette('fable'))
    expect(apart(modelPalette('sonnet').body, modelPalette('fable').body)).toBeGreaterThan(8)
  })

  it('no two models anywhere fly the same colours', () => {
    const seen = new Map<string, string>()
    for (const model of every) {
      const key = JSON.stringify(modelPalette(model))
      expect(seen.has(key), `${model} looks exactly like ${seen.get(key)}`).toBe(false)
      seen.set(key, model)
    }
  })

  it('siblings differ enough to SEE, not merely enough to compare', () => {
    for (const [vendor, lineup] of Object.entries(LINEUPS)) {
      for (let i = 0; i < lineup.length; i++) {
        for (let j = i + 1; j < lineup.length; j++) {
          const a = modelPalette(lineup[i]); const b = modelPalette(lineup[j])
          // Body OR wing may carry the difference — a same-tier pair is
          // separated mostly by hue and wing tint, a cross-tier pair by both.
          const distance = apart(a.body, b.body) + apart(a.wing, b.wing)
          expect(distance, `${vendor}: ${lineup[i]} vs ${lineup[j]}`).toBeGreaterThan(12)
        }
      }
    }
  })

  // The other side of the bargain. An accent that could carry a model out of
  // its family would trade one unreadable thing for a worse one.
  it('never carries a model out of its family', () => {
    for (const [vendor, lineup] of Object.entries(LINEUPS)) {
      const hues = lineup.map(m => hue(modelPalette(m).body))
      for (const h of hues) {
        const drift = Math.abs(h - hues[0])
        expect(Math.min(drift, 360 - drift), `${vendor}`).toBeLessThan(12)
      }
    }
  })

  it('never lets a family drift into the family next door', () => {
    for (const a of every) {
      for (const b of every) {
        if (identifyModel(a).vendor === identifyModel(b).vendor) continue
        const drift = Math.abs(hue(modelPalette(a).body) - hue(modelPalette(b).body))
        expect(Math.min(drift, 360 - drift), `${a} vs ${b}`).toBeGreaterThan(13)
      }
    }
  })

  it('never lets an accent overrule the tier it sits in', () => {
    for (const [vendor, lineup] of Object.entries(LINEUPS)) {
      const by = (tier: string): number[] => lineup
        .filter(m => identifyModel(m).tier === tier)
        .map(m => luma(modelPalette(m).body))
      const deep = by('deep'); const balanced = by('balanced'); const fast = by('fast')
      if (deep.length && balanced.length) {
        expect(Math.max(...deep), `${vendor} deep vs balanced`).toBeLessThan(Math.min(...balanced))
      }
      if (balanced.length && fast.length) {
        expect(Math.max(...balanced), `${vendor} balanced vs fast`).toBeLessThan(Math.min(...fast))
      }
    }
  })

  it('keeps every bee readable as a bee, whatever its accent', () => {
    for (const model of every) {
      const palette = modelPalette(model)
      expect(luma(palette.stripe), `${model} stripe`).toBeLessThan(luma(palette.body))
      expect(luma(palette.wing), `${model} wing`).toBeGreaterThan(luma(palette.body))
      expect(luma(palette.head), `${model} head`).toBeLessThan(luma(palette.body))
    }
  })
})
