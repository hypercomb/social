import { PromptLibrary } from "./prompts/prompt-library"

export class LmClient {

  // -----------------------------------------
  // Default mode: regular tile generator
  // -----------------------------------------
  public static buildDefaultRequest(topic: string, count: number): any {
    return {
      model: "llama-3.2-3b-instruct",
      temperature: 0.15,
      top_p: 0.85,
      top_k: 40,
      min_p: 0.05,
      repeat_penalty: 1.1,
      response_format: window["LM_SCHEMA"],
      messages: [
        {
          role: "system",
          content: `${PromptLibrary.SystemJson}\nRequested count: ${count}`
        },
        {
          role: "user",
          content: topic
        }
      ]
    }
  }

  // -----------------------------------------
  // Follow-up mode: subtopic generator
  // -----------------------------------------
  public static buildFollowupRequest(topic: string, count: number): any {
    return {
      model: "llama-3.2-3b-instruct",
      temperature: 0.15,
      top_p: 0.85,
      top_k: 40,
      min_p: 0.05,
      repeat_penalty: 1.1,
      response_format: window["LM_SCHEMA"],
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
  }
}
