  // ai-list-query.service.ts (updated & working)

  import { Injectable, inject } from '@angular/core'
  import { HypercombData } from '../actions/hypercomb-data'
  import { IOpenAiQuery } from './i-open-ai-query'
  import { CellFactory } from '../inversion-of-control/factory/cell-factory'
  import { HONEYCOMB_SVC } from '../shared/tokens/i-comb-service.token'
  import { CoordinateDetector } from '../helper/detection/coordinate-detector'

  @Injectable({ providedIn: 'root' })
  export class AiListQuery extends HypercombData implements IOpenAiQuery {
    private readonly td_factory = inject(CellFactory)
    private readonly modify = inject(HONEYCOMB_SVC)
    private readonly detector = inject(CoordinateDetector)
    private numItems = 10
    private readonly lmStudioUrl = 'http://localhost:4220/v1'  // LM Studio default

    async query(text: string): Promise<any> {
      const prompt = `Give me exactly ${this.numItems} short "${text}" items as a pure JSON array of strings. No explanations, no markdown, no extra text. Example: ["Apple", "Banana", "Cherry"]`

      const response = await fetch(`${this.lmStudioUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'local-model', // LM Studio ignores this but requires the field
          messages: [
            { role: 'system', content: 'You only respond with raw JSON arrays of strings. Never add any other text.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.8,
          max_tokens: 500,
          stream: false
        })
      })

      if (!response.ok) {
        throw new Error(`LM Studio error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const rawContent: string = data.choices[0]?.message?.content || ''

      const items = this.parseStringArrayFromAny(rawContent.trim())

      if (!items.length) {
        console.warn('AI returned no valid items:', rawContent)
        return rawContent
      }

      // // --- Create cells in your honeycomb ---
      // const existingIndexes = new Set<number>(
      //   this.cs.cells()
      //     .map((t: any) => t.index as number)
      //     .filter(n => Number.isInteger(n))
      // )

      // let index = Math.max(...[...existingIndexes, -1]) + 1

      // for (const item of items) {
      //   while (existingIndexes.has(index)) index++
      //   const cell = await this.td_factory.create(<any>{})
      //   cell.name = item.trim()
      //   cell.index = index++
      //   cell.hive = this.stack.hiveName()!
      //   cell.sourceId = this.stack.cell()?.cellId
      //   await this.modify..modify.addCell(cell)
      // }

      return items // or whatever you want to return
    }

    canQuery(query: string): boolean {
      return !!query?.trim()
    }

    // --- Robust JSON array parser (handles junk before/after) ---
    private parseStringArrayFromAny(text: string): string[] {
      // 1. Try direct parse
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) {
          return parsed.filter(s => typeof s === 'string').map(s => s.trim())
        }
      } catch {}

      // 2. Extract first [...] block
      const match = text.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          const parsed = JSON.parse(match[0])
          if (Array.isArray(parsed)) {
            return parsed.filter(s => typeof s === 'string').map(s => s.trim())
          }
        } catch {}
      }

      return []
    }
  }