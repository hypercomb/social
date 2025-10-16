
export const parsePromptToInstructions = (prompt: string): AIInstruction[] => {
  const lowerPrompt = prompt.toLowerCase()
  const matchedCommand = ActionRegistry.find(cmd =>
    cmd.keywords.some(keyword => lowerPrompt.includes(keyword))
  )

  if (!matchedCommand) return []

  const count = (() => {
    const match = prompt.match(/\b(\d+)\b/)
    return match ? parseInt(match[1]) : 1
  })()

  const hiveId = (() => {
    const match = prompt.match(/hive\s+(\w+)/i)
    return match ? match[1] : "default-hive"
  })()

  return Array.from({ length: count }, (_, i) => ({
    id: uuidv4(),
    action: matchedCommand.action,
    args: matchedCommand.buildArgs(i, hiveId)
  }))
}


