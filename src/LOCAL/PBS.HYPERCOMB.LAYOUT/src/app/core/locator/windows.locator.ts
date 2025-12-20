// src/app/core/locator/windows.locator.ts

import { Locator } from './locator'

// windows locator resolves via explicit user gesture.
// path is informational only (used for intent alignment / labeling).
export class WindowsLocator implements Locator<FileSystemHandle> {

  public async resolve(_path: string): Promise<FileSystemHandle | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const picker = (window as any).showOpenFilePicker as
        | (() => Promise<FileSystemFileHandle[]>)
        | undefined

      if (!picker) return null

      const files = await picker()
      return files?.[0] ?? null
    } catch {
      return null
    }
  }
}
