// diamondcoreprocessor.com/assistant/atomize.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from '@hypercomb/core'
import type { OverlayActionDescriptor } from '../presentation/tiles/tile-overlay.drone.js'

const ATOMIZE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle fill="white" cx="48" cy="48" r="8"/><circle fill="white" cx="48" cy="20" r="5"/><circle fill="white" cx="23" cy="64" r="5"/><circle fill="white" cx="73" cy="64" r="5"/><line stroke="white" stroke-width="2" x1="48" y1="40" x2="48" y2="25"/><line stroke="white" stroke-width="2" x1="41" y1="53" x2="27" y2="62"/><line stroke="white" stroke-width="2" x1="55" y1="53" x2="69" y2="62"/></svg>`

const ACTION_DESCRIPTOR: OverlayActionDescriptor = {
  name: 'atomize',
  svgMarkup: ATOMIZE_ICON_SVG,
  x: -25.25,
  y: 5,
  hoverTint: 0xd8c8ff,
  profile: 'private',
}

const LLM_ENDPOINT = 'http://127.0.0.1:4220/v1/chat/completions'
const LLM_MODEL = 'llama-3.2-3b-instruct'
const SUBTOPIC_COUNT = 7

const SYSTEM_PROMPT = `
You are a precise list generator.

Your job:
Given a single subject, produce a flat JSON array where each element is an object with:
- "name": a short 1–3 word label directly related to the subject
- "detail": a concise descriptive phrase (5–12 words)

Rules:
1. The list size is determined by user instruction.
2. If no count is given, output exactly 10 items.
3. Items must be unique.
4. Format is strictly: { "name": "...", "detail": "..." }.
5. Output ONLY the JSON array. No markdown, no text.
6. Must conform to the provided JSON schema.
`

const FOLLOWUP_PROMPT = `
You are generating new topics for the next layer of a hierarchical Hive.
Given a parent topic, create a list of short, digestible subtopics that explore the parent subject.

Each item must be:
- a short topic (1-3 words)
- general and easy to understand
- suitable as a tile label
- not a question
- not detailed or domain-expert language

Output only the short subtopics that naturally branch from the parent topic.
`

const JSON_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'FlatNamedList',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['name', 'detail'],
      },
      minItems: 1,
      maxItems: 20,
    },
  },
}

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class AtomizeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'atomizes a tile into subtopics via LLM'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action']

  #registered = false
  #effectsRegistered = false
  #busy = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('render:host-ready', () => {
      if (this.#registered) return
      this.#registered = true
      this.emitEffect('overlay:register-action', [ACTION_DESCRIPTOR])
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'atomize') return
      void this.#atomize(payload.label)
    })
  }

  async #atomize(rawLabel: string): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      const label = normalizeSeed(rawLabel) || rawLabel
      const lineage = this.resolve<{ explorerDir(): Promise<FileSystemDirectoryHandle> }>('lineage')
      const dir = await lineage?.explorerDir()
      if (!dir) return

      const tileDir = await dir.getDirectoryHandle(label, { create: true })
      const subtopics = await this.#callLLM(label)

      for (const item of subtopics) {
        const name = normalizeSeed(item.name)
        if (!name) continue
        await tileDir.getDirectoryHandle(name, { create: true })
        EffectBus.emit('seed:added', { seed: name })
      }

      await new hypercomb().act()
    } catch (err) {
      console.warn('[atomize] failed:', err)
    } finally {
      this.#busy = false
    }
  }

  async #callLLM(topic: string): Promise<{ name: string; detail: string }[]> {
    const response = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.15,
        top_p: 0.85,
        top_k: 40,
        min_p: 0.05,
        repeat_penalty: 1.1,
        response_format: JSON_SCHEMA,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\nRequested count: ${SUBTOPIC_COUNT}` },
          { role: 'user', content: `${FOLLOWUP_PROMPT}\n\nTopic: ${topic}` },
        ],
      }),
    })

    if (!response.ok) throw new Error(await response.text())

    const raw: string = (await response.json())?.choices?.[0]?.message?.content ?? ''
    return this.#extractArray(raw)
  }

  #extractArray(text: string): { name: string; detail: string }[] {
    try {
      const p = JSON.parse(text)
      if (Array.isArray(p)) return p
    } catch {}

    const m = text.match(/\[[\s\S]*\]/g) || []
    for (const chunk of m.sort((a, b) => b.length - a.length)) {
      try {
        const arr = JSON.parse(chunk)
        if (Array.isArray(arr)) return arr
      } catch {}
    }

    return []
  }
}

const _atomize = new AtomizeDrone()
window.ioc.register('@diamondcoreprocessor.com/AtomizeDrone', _atomize)
