
// type-only: erased at build, wonâ€™t trigger CommonJS warning

import { Injectable, inject } from '@angular/core'
import { LMStudioClient } from '@lmstudio/sdk'
import { HypercombData } from '../actions/hypercomb-data'
import { IOpenAiQuery } from './i-open-ai-query'
import { CellFactory } from '../inversion-of-control/factory/cell-factory'
import { focused } from '../state/interactivity/focus-cell'
import { COMB_SERVICE } from '../shared/tokens/i-cell-repository.token'

@Injectable({ providedIn: 'root' })
export class AiListQuery extends HypercombData implements IOpenAiQuery {
  private readonly td_factory = inject(CellFactory)
  private readonly modify = inject(COMB_SERVICE)

  private numItems = 10

  async query(text: string): Promise<any> {
    // const client = await getLmClient()
    // const model = await client.llm.model('meta-llama-3.1-8b-instruct')

    // const prompt = `
    //   Return exactly ${this.numItems} short "${text}" items as a pure JSON array of strings.
    //   No prose, no code fences, no key just the array.
    //   Example: ["first", "second"]`

    // const result = await model.respond(prompt)
    // const raw: string =
    //   typeof result === 'string'
    //     ? result
    //     : (result as any)?.content ?? JSON.stringify(result)

    // const items = this.parseStringArrayFromAny(raw)

    // if (!items.length) {
    //   console.warn('AI returned no parsable items', raw)
    //   return result
    // }

    // // gather used indexes from current layout
    // const existingIndexes = new Set<number>(
    //   this.cs.cells()
    //     .map((t: any) => (t.index ?? t.index) as number)
    //     .filter((n: any) => Number.isInteger(n))
    // )

    // let index = 0
    // for (const item of items) {
    //   while (existingIndexes.has(index)) index++
    //   const cell = await this.td_factory.create(<any>{})
    //   cell.name = item
    //   cell.index = index++
    //   cell.hive = focused.hive()?.name!
    //   cell.sourceId = focused.cellId()
    //   await this.modify.addCell(cell)
    // }

    // // await this.layout.refresh()
    // return result
    throw new Error('AI integration is currently disabled')
  }

  canQuery(query: string): boolean {
    return !!query
  }

  // --- helpers ---

  private parseStringArrayFromAny(text: string): string[] {
    // Try strict parse first
    const direct = this.tryParseJsonArray(text)
    if (direct) return direct

    // Try to extract first top-level [...] block
    const extracted = this.extractFirstJsonArray(text)
    if (extracted) return extracted

    return []
  }

  private tryParseJsonArray(s: string): string[] | null {
    try {
      const v = JSON.parse(s)
      if (Array.isArray(v)) return v.filter(x => typeof x === 'string')
    } catch {
      // ignore
    }
    return null
  }

  private extractFirstJsonArray(s: string): string[] | null {
    const start = s.indexOf('[')
    const end = s.lastIndexOf(']')
    if (start === -1 || end === -1 || end <= start) return null
    const slice = s.slice(start, end + 1)
    return this.tryParseJsonArray(slice)
  }
}


let lmClientPromise: Promise<LMStudioClient> | null = null
async function getLmClient(): Promise<LMStudioClient> {
  if (!lmClientPromise) {
    lmClientPromise = import(/* webpackChunkName: "web-chunk" */  '@lmstudio/sdk').then(m => new m.LMStudioClient())
  }
  return lmClientPromise
}