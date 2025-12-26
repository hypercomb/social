// src/app/core/action-manager.ts

import { InjectionToken } from "@angular/core"

export interface Action {
  readonly name: string
  run(): Promise<void>
}

export interface ActionManager {
  find(name:string): Promise<readonly Action[]>
}

export const ACTION_MANAGER = new InjectionToken<ActionManager>('ACTION_MANAGER')
