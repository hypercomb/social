import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class WindowsAgent {

  public pickDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      // user gesture required
      // this is only available in secure contexts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const picker = (window as any).showDirectoryPicker as (() => Promise<FileSystemDirectoryHandle>) | undefined
      if (!picker) return null

      return await picker()
    } catch {
      return null
    }
  }

  public pickFile = async (): Promise<FileSystemFileHandle | null> => {
    try {
      // user gesture required
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const picker = (window as any).showOpenFilePicker as (() => Promise<FileSystemFileHandle[]>) | undefined
      if (!picker) return null

      const files = await picker()
      return files?.[0] ?? null
    } catch {
      return null
    }
  }
}
