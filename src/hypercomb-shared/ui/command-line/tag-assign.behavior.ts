// hypercomb-shared/ui/command-line/tag-assign.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'

/**
 * `label:tagName` or `label:tagName(#color)` assigns a tag to a seed.
 *
 * Examples:
 *   "navtest:education"            → tag "navtest" with "education"
 *   "navtest:education(#ff4444)"   → tag with color
 *
 * Tags are stored in the seed's 0000 properties file under
 * `tags: string[]`. Colors are stored globally in localStorage
 * under `hc:tag-colors`.
 */
export class TagAssignBehavior implements CommandLineBehavior {

  readonly name = 'tag-assign'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^\/!#\[].+:[^(]+(\([^)]+\))?$/,
      description: 'Assign a tag to a seed',
      examples: [
        { input: 'navtest:education', key: 'Enter', result: 'Tags "navtest" with "education"' },
        { input: 'navtest:work(#4caf50)', key: 'Enter', result: 'Tags "navtest" with "work" in green' },
      ]
    },
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    // must have content before : and after :, and not be a slash command, hash marker, or bracket syntax
    if (input.startsWith('/') || input.startsWith('!') || input.includes('[')) return false
    const colonIdx = input.indexOf(':')
    if (colonIdx <= 0 || colonIdx >= input.length - 1) return false
    // reject hash marker syntax: seed#Drone (# outside parentheses)
    const beforeParen = input.indexOf('(')
    const hashIdx = input.indexOf('#')
    if (hashIdx >= 0 && (beforeParen < 0 || hashIdx < beforeParen)) return false
    return true
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const colonIdx = input.indexOf(':')
    const seedRaw = input.slice(0, colonIdx).trim()
    const tagRaw = input.slice(colonIdx + 1).trim()

    const seedName = completions.normalize(seedRaw)
    if (!seedName || !tagRaw) return

    // parse optional color: tagName(#color)
    const colorMatch = tagRaw.match(/^([^(]+)(?:\(([^)]+)\))?$/)
    if (!colorMatch) return
    const tagName = colorMatch[1].trim()
    const color = colorMatch[2]?.trim()
    if (!tagName) return

    // ensure seed exists
    const dir = await lineage.explorerDir()
    if (!dir) return

    const seedDir = await dir.getDirectoryHandle(seedName, { create: true })

    // read existing tags, append if not present
    const props = await readProps(seedDir)
    const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []
    if (!tags.includes(tagName)) {
      tags.push(tagName)
      await writeProps(seedDir, { tags })
    }

    // persist global tag color
    if (color) {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      stored[tagName] = color
      localStorage.setItem('hc:tag-colors', JSON.stringify(stored))
    }

    EffectBus.emit('tags:changed', { updates: [{ seed: seedName, tag: tagName, color }] })
    EffectBus.emit('seed:added', { seed: seedName })
    await new hypercomb().act()
  }
}

// ── 0000 properties helpers (lightweight inline, avoids import from essentials) ──

const PROPS_FILE = '0000'

async function readProps(seedDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  try {
    const fh = await seedDir.getFileHandle(PROPS_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

async function writeProps(seedDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
  const existing = await readProps(seedDir)
  const merged = { ...existing, ...updates }
  const fh = await seedDir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}
