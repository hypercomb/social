import { Injectable, inject } from "@angular/core"
import { PromptLibrary } from "./prompts/prompt-library"
import { JSON_SCHEMA } from "./json_schema"

@Injectable({ providedIn: "root" })
export class AiService {

  // small reusable fetch wrapper
  private async callModel(body: any): Promise<any[]> {
    const response = await fetch("http://127.0.0.1:4220/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })

    if (!response.ok) throw new Error(await response.text())

    const raw = (await response.json())?.choices?.[0]?.message?.content ?? ""
    return this.extractArray(raw)
  }

  public async generateSubtopics(topic: string, count: number): Promise<any[]> {
    const body = {
      model: "llama-3.2-3b-instruct",
      temperature: 0.15,
      top_p: 0.85,
      top_k: 40,
      min_p: 0.05,
      repeat_penalty: 1.1,
      response_format: JSON_SCHEMA,
      messages: [
        {
          role: "system",
          content: `${PromptLibrary.SystemJson}\nRequested count: ${count}`
        },
        {
          role: "user",
          content: `${PromptLibrary.Followup}\n\nTopic: ${topic}`
        }
      ]
    }

    return this.callModel(body)
  }

  // ------------------------------
  // UTILITIES
  // ------------------------------

  private extractArray(text: string): any[] {
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
