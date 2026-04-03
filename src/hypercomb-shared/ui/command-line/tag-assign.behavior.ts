// hypercomb-shared/ui/command-line/tag-assign.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'

/**
 * `label:tagName` or `label:tagName(#color)` assigns a tag to a cell.
 *
 * Examples:
 *   "navtest:education"            → tag "navtest" with "education"
 *   "navtest:education(#ff4444)"   → tag with color
 *
 * Tags are stored in the cell's 0000 properties file under
 * `tags: string[]`. Colors are stored globally in localStorage
 * under `hc:tag-colors`.
 */
export class TagAssignBehavior implements CommandLineBehavior {

  readonly name = 'tag-assign'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^\/!#\[].+:[^(]+(\([^)]+\))?$/,
      description: 'Assign a tag to a cell',
      examples: [
        { input: 'navtest:education', key: 'Enter', result: 'Tags "navtest" with "education"' },
        { input: 'navtest:work(#4caf50)', key: 'Enter', result: 'Tags "navtest" with "work" in green' },
      ]
    },
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    // must have content before : and after :, and not be a slash behaviour, hash marker, or bracket syntax
    if (input.startsWith('/') || input.startsWith('!') || input.includes('[')) return false
    const colonIdx = input.indexOf(':')
    if (colonIdx <= 0 || colonIdx >= input.length - 1) return false
    // reject hash marker syntax: cell#Drone (# outside parentheses)
    const beforeParen = input.indexOf('(')
    const hashIdx = input.indexOf('#')
    if (hashIdx >= 0 && (beforeParen < 0 || hashIdx < beforeParen)) return false
    return true
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const colonIdx = input.indexOf(':')
    const cellRaw = input.slice(0, colonIdx).trim()
    const tagRaw = input.slice(colonIdx + 1).trim()

    const cellName = completions.normalize(cellRaw)
    if (!cellName || !tagRaw) return

    // parse optional color: tagName(#color)
    const colorMatch = tagRaw.match(/^([^(]+)(?:\(([^)]+)\))?$/)
    if (!colorMatch) return
    const tagName = colorMatch[1].trim()
    const color = colorMatch[2]?.trim()
    if (!tagName) return

    // ensure cell exists
    const dir = await lineage.explorerDir()
    if (!dir) return

    const cellDir = await dir.getDirectoryHandle(cellName, { create: true })

    // read existing tags, append if not present
    const props = await readProps(cellDir)
    const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []
    if (!tags.includes(tagName)) {
      tags.push(tagName)
      await writeProps(cellDir, { tags })
    }

    // persist global tag color
    if (color) {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      stored[tagName] = color
      localStorage.setItem('hc:tag-colors', JSON.stringify(stored))
    }

    EffectBus.emit('tags:changed', { updates: [{ cell: cellName, tag: tagName, color }] })
    EffectBus.emit('cell:added', { cell: cellName })
    await new hypercomb().act()
  }
}

// ── 0000 properties helpers (lightweight inline, avoids import from essentials) ──

const PROPS_FILE = '0000'

async function readProps(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  try {
    const fh = await cellDir.getFileHandle(PROPS_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

async function writeProps(cellDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
  const existing = await readProps(cellDir)
  const merged = { ...existing, ...updates }
  const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}
