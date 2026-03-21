// diamondcoreprocessor.com/ui/slash-command/slash-command.provider.ts

export interface SlashCommand {
  readonly name: string
  readonly description: string
  readonly aliases?: readonly string[]
}

export interface SlashCommandMatch {
  readonly command: SlashCommand
  readonly provider: SlashCommandProvider
}

export interface SlashCommandProvider {
  readonly name: string
  readonly priority: number
  readonly commands: readonly SlashCommand[]
  execute(commandName: string, args: string): Promise<void> | void
}
