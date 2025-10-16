export interface ComfyHistory {
  [promptId: string]: ComfyPromptExecution
}

export interface ComfyPromptExecution {
  prompt: ComfyPrompt
  extra_data: {
    client_id?: string
    [key: string]: any
  }
  outputs: {
    [nodeName: string]: OutputFile[]
  }
  timestamp: number
  workflow_name?: string
}

export interface ComfyPrompt {
  [nodeId: string]: {
    class_type: string
    inputs: {
      [inputKey: string]: any
    }
  }
}

export interface OutputFile {
  filename: string
  subfolder: string
  type: "output" | "temp" | "input"
}


