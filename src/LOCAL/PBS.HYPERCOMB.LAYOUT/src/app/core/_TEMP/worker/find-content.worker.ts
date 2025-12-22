import { inject } from '@angular/core'
import { Worker } from './worker.base'
import { OpfsAgent, DiscoveredTextFile } from '../agent/opfs.agent'
import { WindowsAgent } from '../agent/windows.agent'
import { FindContentQuery, FindContentResult, FindContentHit } from '../observe/find-content/find-content.model'


interface SearchOptions {
  maxHitsTotal: number
  maxHitsPerFile: number
  maxFiles: number
}
export class FindContentWorker extends Worker {

  public readonly action = 'find.content'

  private readonly opfs = inject(OpfsAgent)
  private readonly windows = inject(WindowsAgent)

  private static readonly SOURCE_ROOTS = ['src', 'workspace/src', 'repo/src'] as const
  private static readonly HISTORY_ROOTS = ['history', 'chatgpt/history', 'chatgpt', 'exports/chatgpt'] as const

  private static readonly SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.scss', '.css', '.md'] as const
  private static readonly HISTORY_EXTS = ['.json', '.md', '.txt', '.csv'] as const

  public async act(): Promise<void> {
    const started = performance.now()

    const options: SearchOptions = {
      maxHitsTotal: 250,
      maxHitsPerFile: 50,
      maxFiles: 10_000
    }

    const hits: FindContentHit[] = []
    let scannedFiles = 0
    let matchedFiles = 0
    let truncated = false
    const missingRoots: string[] = []

    const search = async (
      root: FileSystemDirectoryHandle,
      path: string,
      exts: readonly string[]
    ): Promise<void> => {
      const files = await this.opfs.walkTextFiles(root, path, {
        extensions: exts,
        maxFiles: options.maxFiles
      })

      for (const file of files) {
        if (hits.length >= options.maxHitsTotal) {
          truncated = true
          return
        }

        scannedFiles++
        const found = await this.searchFile(file, query, options, hits)
        if (found) matchedFiles++
      }
    }

    if (query.scope === 'source' || query.scope === 'all') {
      const resolved = await this.resolveOpfsRoot(FindContentWorker.SOURCE_ROOTS)
      if (resolved) {
        await search(resolved.dir, resolved.path, FindContentWorker.SOURCE_EXTS)
      } else {
        missingRoots.push(...FindContentWorker.SOURCE_ROOTS)
      }
    }

    if (query.scope === 'history' || query.scope === 'all') {
      const resolved = await this.resolveOpfsRoot(FindContentWorker.HISTORY_ROOTS)
      if (resolved) {
        await search(resolved.dir, resolved.path, FindContentWorker.HISTORY_EXTS)
      } else {
        missingRoots.push(...FindContentWorker.HISTORY_ROOTS)
      }
    }

    if (query.scope === 'windows') {
      const dir = await this.windows.pickDirectory()
      if (dir) {
        await search(dir, '', [...FindContentWorker.SOURCE_EXTS, ...FindContentWorker.HISTORY_EXTS])
      } else {
        missingRoots.push('windows')
      }
    }

    return {
      query,
      hits,
      scannedFiles,
      matchedFiles,
      durationMs: Math.round(performance.now() - started),
      truncated,
      missingRoots
    }
  }

  private resolveOpfsRoot = async (
    candidates: readonly string[]
  ): Promise<{ dir: FileSystemDirectoryHandle; path: string } | null> => {
    for (const path of candidates) {
      const dir = await this.opfs.tryGetDirectory(path)
      if (dir) return { dir, path }
    }
    return null
  }

  private searchFile = async (
    file: DiscoveredTextFile,
    query: FindContentQuery,
    options: SearchOptions,
    out: FindContentHit[]
  ): Promise<boolean> => {
    const f = await file.handle.getFile()
    if (f.size > 25 * 1024 * 1024) return false

    const needle = query.caseSensitive ? query.pattern : query.pattern.toLowerCase()
    const text = await f.text()
    const lines = text.split('\n')

    let found = false
    let hitsInFile = 0

    for (let i = 0; i < lines.length; i++) {
      if (out.length >= options.maxHitsTotal) return found

      const raw = lines[i].replace(/\r/g, '')
      const hay = query.caseSensitive ? raw : raw.toLowerCase()

      let idx = hay.indexOf(needle)
      while (idx >= 0) {
        found = true
        hitsInFile++

        out.push({
          path: file.path,
          line: i + 1,
          column: idx + 1,
          preview: raw
        })

        if (
          hitsInFile >= options.maxHitsPerFile ||
          out.length >= options.maxHitsTotal
        ) {
          return true
        }

        idx = hay.indexOf(needle, idx + Math.max(1, needle.length))
      }
    }

    return found
  }
}
