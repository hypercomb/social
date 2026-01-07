import { FOLLOWUP_QUESTIONS } from "./followup-question"
import { SYSTEM_PROMPT_JSON } from "./system-prompt-json"

export interface PromptLibraryType {
  SystemJson: string
  Followup: string
}

export const PromptLibrary: PromptLibraryType = { 
  SystemJson: SYSTEM_PROMPT_JSON,
  Followup: FOLLOWUP_QUESTIONS,
}
