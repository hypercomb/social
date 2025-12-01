// src/app/ai/ai-list-query.ts

import { Injectable } from '@angular/core';
import { HypercombData } from '../actions/hypercomb-data';
import { IOpenAiQuery } from './i-open-ai-query';

@Injectable({ providedIn: 'root' })
export class AiListQuery extends HypercombData implements IOpenAiQuery {

  // system instructions for LM Studio
  private readonly SYSTEM = `
You are a precise list generator.

Your job:
Given a single subject, produce a flat JSON array where each element is an object with:
- "name": a short 1–3 word label directly related to the subject
- "detail": a concise descriptive phrase (5–12 words)

Rules:
1. The list size is determined by user instruction.
2. If the user does NOT provide a count, output exactly 10 items.
3. All items must be unique.
4. Each item must strictly follow: { "name": "...", "detail": "..." }.
5. Output ONLY the JSON array. No text, no explanations, no markdown.
6. Output must strictly conform to the provided JSON schema.
`;

  // JSON schema that LM Studio will enforce
  private readonly SCHEMA = {
    name: "FlatNamedList",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "short 1–3 word label related to the subject"
          },
          detail: {
            type: "string",
            description: "a short descriptive phrase related to the name"
          }
        },
        required: ["name", "detail"]
      },
      minItems: 1,
      maxItems: 20
    }
  };

  // public API ----------------------------------------------------

  public canQuery(q: string): boolean {
    return !!q?.trim();
  }

  public async query(userPrompt: string): Promise<any[]> {
    if (!userPrompt.trim()) return [];

    const count = this.extractCount(userPrompt) ?? 10;
    const purified = this.stripCount(userPrompt);

    const payload = {
      model: "llama-3.2-3b-instruct", // LM Studio model name
      response_format: {
        type: "json_schema",
        json_schema: this.SCHEMA
      },
      messages: [
        {
          role: "system",
          content: this.SYSTEM + `\nRequested item count: ${count}`
        },
        {
          role: "user",
          content: purified
        }
      ]
    };

    const response = await fetch("http://localhost:4220/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error("LM Studio Error:", response.status, await response.text());
      return [];
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";

    return this.extractArray(raw);
  }

  // helpers --------------------------------------------------------

  private extractArray(text: string): any[] {
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

    console.warn("Failed to parse LM Studio JSON:", text);
    return [];
  }

  private extractCount(input: string): number | null {
    const match = input.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
    if (!match) return null;

    const n = parseInt(match[1], 10);
    if (isNaN(n)) return null;

    return Math.min(Math.max(n, 1), 20);
  }

  private stripCount(input: string): string {
    return input.replace(/\d{1,2}/, "").replace(/[|:]/g, "").trim();
  }
}
