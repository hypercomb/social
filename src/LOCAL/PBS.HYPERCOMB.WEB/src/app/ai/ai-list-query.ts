// ai-list-query.service.ts (FINAL – OpenAI Nano Test Mode)

import { Injectable } from '@angular/core';
import { HypercombData } from '../actions/hypercomb-data';
import { IOpenAiQuery } from './i-open-ai-query';
const apiKey =
  (window as any)?.hypercomb_openai_key ||
  localStorage.getItem('OPENAI_API_KEY') ||
  '';

@Injectable({ providedIn: 'root' })
export class AiListQuery extends HypercombData implements IOpenAiQuery {

  private readonly SYSTEM = `
You are the Hypercomb Hierarchy Builder.

Output ONLY one JSON array using this recursive Tile format:

A Tile is:
[
  "name",
  [
    Tile,
    Tile,
    ...
  ]
]

The output must be:
[
  Tile,  // 6 items
  Tile,
  Tile,
  Tile,
  Tile,
  Tile
]

Rules:
1. Always output exactly 6 top-level Tiles.
2. Every Tile must be exactly: [string, array].
3. The second element (children array) must always exist.
4. Each top-level Tile must contain 6 child Tiles.
5. Each child Tile must contain 3–6 grandchildren Tiles.
6. Names must be short and unique.
7. No objects, no prose, no markdown, no backticks.
8. Output only JSON that matches the Tile format.

`;

  public async query(userPrompt: string): Promise<any[]> {
    if (!userPrompt.trim()) return [];

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1',  // ← nano model
        input: [
          {
            role: "system",
            content: [
              { type: "input_text", text: this.SYSTEM }
            ]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: userPrompt }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI Error:', response.status, err);
      return [];
    }

    const data = await response.json();
    const text = await response.text()
    const raw = data.output_text ?? '';

    return this.extractNestedArray(raw);
  }

  public canQuery(q: string): boolean {
    return !!q?.trim();
  }

  private extractNestedArray(text: string): any[] {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {}

    const matches = text.match(/\[[\s\S]*\]/g) || [];
    for (const m of matches.sort((a, b) => b.length - a.length)) {
      try {
        const parsed = JSON.parse(m);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }

    console.warn('Failed to parse hierarchy:', text);
    return [];
  }
}
