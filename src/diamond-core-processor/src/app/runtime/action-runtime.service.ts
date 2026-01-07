// src/app/runtime/action-runtime.service.ts
import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class ActionRuntimeService {

  private registry = new Map<string, string>()

  public register = (name: string, code: string): void => {
    this.registry.set(name, code)
  }

  public execute = async (name: string): Promise<void> => {
    const code = this.registry.get(name)
    if (!code) throw new Error(`action not found: ${name}`)

    const blob = new Blob([code], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)

    try {
      const mod = await import(url)
      const ActionClass =
        mod.default ??
        Object.values(mod).find(v => typeof v === 'function')

      if (!ActionClass) {
        throw new Error('no exported action class found')
      }

      const instance = new ActionClass()
      if (typeof instance.execute === 'function') {
        await instance.execute()
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}
