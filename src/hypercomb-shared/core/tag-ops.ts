// hypercomb-shared/core/tag-ops.ts
// Shared tag persistence helpers — used by command-line and queen bees.

import { EffectBus, hypercomb } from '@hypercomb/core'

const TAG_PROPS_FILE = '0000'

export async function readTagProps(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  try {
    const fh = await cellDir.getFileHandle(TAG_PROPS_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

export async function writeTagProps(cellDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
  const existing = await readTagProps(cellDir)
  const merged = { ...existing, ...updates }
  const fh = await cellDir.getFileHandle(TAG_PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}

export type TagOp = { label: string; tag: string; color?: string; remove: boolean }

/**
 * Persist tag operations to OPFS tiles + update global registry + emit effects.
 * Shared by command-line tag extraction and /keyword queen bee.
 */
export async function persistTagOps(
  ops: TagOp[],
  dir: FileSystemDirectoryHandle,
): Promise<void> {
  const registry = get('@hypercomb.social/TagRegistry') as
    { add: (n: string, c?: string) => Promise<void>; remove: (n: string) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined

  const updates: { cell: string; tag: string; color?: string }[] = []

  for (const op of ops) {
    try {
      const cellDir = await dir.getDirectoryHandle(op.label, { create: true })
      const props = await readTagProps(cellDir)
      const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []

      if (op.remove) {
        const idx = tags.indexOf(op.tag)
        if (idx >= 0) {
          tags.splice(idx, 1)
          await writeTagProps(cellDir, { tags })
        }
      } else {
        if (!tags.includes(op.tag)) {
          tags.push(op.tag)
          await writeTagProps(cellDir, { tags })
        }
      }
      updates.push({ cell: op.label, tag: op.tag, color: op.color })
    } catch { /* cell dir access failed — skip */ }
  }

  // Update master tag list (content-addressed resource)
  if (registry) {
    for (const op of ops) {
      if (!op.remove) {
        await registry.add(op.tag, op.color)
      }
    }
  }

  if (updates.length > 0) {
    EffectBus.emit('tags:changed', { updates })
  }
}

/**
 * Add tags to the global registry only (no tile assignment).
 */
export async function addToGlobalRegistry(
  tags: { name: string; color?: string }[],
): Promise<void> {
  const registry = get('@hypercomb.social/TagRegistry') as
    { add: (n: string, c?: string) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined
  if (!registry) return
  await registry.ensureLoaded()
  for (const tag of tags) {
    await registry.add(tag.name, tag.color)
  }
}

/**
 * Parse keyword args: single tag, ~tag, tag(#color), or [tag1, ~tag2, tag3(#color)].
 * Returns array of { tag, color?, remove } operations.
 */
export function parseKeywordArgs(args: string): { tag: string; color?: string; remove: boolean }[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  // Bracket batch: [tag1, ~tag2, tag3(#color)]
  const bracketMatch = trimmed.match(/^\[(.+)\]$/)
  if (bracketMatch) {
    const items = bracketMatch[1].split(',')
    const ops: { tag: string; color?: string; remove: boolean }[] = []
    for (const raw of items) {
      const item = raw.trim()
      if (!item) continue
      if (item.startsWith('~')) {
        const tag = item.slice(1).trim()
        if (tag) ops.push({ tag, remove: true })
      } else {
        const colorMatch = item.match(/^([^(]+)(?:\(([^)]+)\))?$/)
        if (colorMatch) {
          const tag = colorMatch[1].trim()
          const color = colorMatch[2]?.trim()
          if (tag) ops.push({ tag, color, remove: false })
        }
      }
    }
    return ops
  }

  // Single: ~tagName (remove) or tagName or tagName(#color)
  if (trimmed.startsWith('~')) {
    const tag = trimmed.slice(1).trim()
    return tag ? [{ tag, remove: true }] : []
  }

  const colorMatch = trimmed.match(/^([^(]+)(?:\(([^)]+)\))?$/)
  if (colorMatch) {
    const tag = colorMatch[1].trim()
    const color = colorMatch[2]?.trim()
    return tag ? [{ tag, color, remove: false }] : []
  }

  return []
}
