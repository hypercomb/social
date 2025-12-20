// src/app/core/commands/command.model.ts

export interface Command {
  name: string
  execute(args: string[]): void
}
