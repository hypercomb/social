// diamondcoreprocessor.com/commands/accent.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
const STORAGE_KEY = 'hc:neon-color'

// Accent preset names → neon color index (maps to NEON_PRESETS in hex-overlay.shader)
const ACCENT_NAMES: Record<string, number> = {
  glacier: 0,
  bloom: 1,
  aurora: 2,
  ember: 3,
  nebula: 4,
}

const ACCENT_INDEX_TO_NAME: string[] = ['glacier', 'bloom', 'aurora', 'ember', 'nebula']
const get = (key: string) => (window as any).ioc?.get?.(key)

/**
 * /accent — set the hover overlay color by name, globally or per-tag.
 *
 * Named presets: glacier, bloom, aurora, ember, nebula
 *
 * Syntax:
 *   /accent                          — cycle to next preset
 *   /accent glacier                  — set default accent
 *   /accent education aurora         — assign aurora accent to tag "education"
 *   /accent [education, work] bloom  — assign bloom accent to multiple tags
 *   /accent ~education               — remove accent from tag "education"
 *   /select[a,b]/accent bloom        — set per-tile accent on selected tiles
 */
export class AccentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'accent'
  override readonly aliases = []
  override description = 'Set the hover accent color by name'
  override descriptionKey = 'slash.accent'

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim().toLowerCase()

    // No args: cycle to next preset
    if (!trimmed) {
      this.#cycle()
      return
    }

    // Remove accent from tag: /accent ~tagName
    if (trimmed.startsWith('~')) {
      const tagName = trimmed.slice(1).trim()
      if (tagName) await this.#removeTagAccent(tagName)
      return
    }

    // Bracket syntax: /accent [tag1, tag2] presetName
    const bracketMatch = trimmed.match(/^\[(.+?)\]\s*(.*)$/)
    if (bracketMatch) {
      const tagNames = bracketMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      const presetName = bracketMatch[2].trim()
      if (presetName && presetName in ACCENT_NAMES && tagNames.length > 0) {
        for (const tag of tagNames) {
          await this.#setTagAccent(tag, presetName)
        }
        // Also apply the accent as current default so it's immediately visible
        this.#setDefault(presetName)
      }
      return
    }

    const parts = trimmed.split(/\s+/)

    // Single arg: must be a preset name → set default
    if (parts.length === 1) {
      const name = parts[0]
      if (name in ACCENT_NAMES) {
        this.#setDefault(name)
      }
      return
    }

    // Two args: tagName presetName → assign accent to tag
    if (parts.length === 2) {
      const [tagName, presetName] = parts
      if (presetName in ACCENT_NAMES) {
        await this.#setTagAccent(tagName, presetName)

        // If tiles are selected, also write per-tile accent
        const selection = get('@diamondcoreprocessor.com/SelectionService') as
          { selected: ReadonlySet<string> } | undefined
        if (selection && selection.selected.size > 0) {
          await this.#setTileAccent(Array.from(selection.selected), presetName)
        }
      }
      return
    }
  }

  #cycle(): void {
    const current = loadIndex()
    const next = (current + 1) % ACCENT_INDEX_TO_NAME.length
    this.#setDefault(ACCENT_INDEX_TO_NAME[next])
  }

  #setDefault(name: string): void {
    const index = ACCENT_NAMES[name]
    if (index === undefined) return
    localStorage.setItem(STORAGE_KEY, String(index))
    EffectBus.emit('overlay:neon-color', { index, name })
  }

  async #setTagAccent(tagName: string, presetName: string): Promise<void> {
    const registry = get('@hypercomb.social/TagRegistry') as
      { setAccent: (n: string, a: string | undefined) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined
    if (!registry) return
    await registry.ensureLoaded()
    await registry.setAccent(tagName, presetName)
  }

  async #removeTagAccent(tagName: string): Promise<void> {
    const registry = get('@hypercomb.social/TagRegistry') as
      { setAccent: (n: string, a: string | undefined) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined
    if (!registry) return
    await registry.ensureLoaded()
    await registry.setAccent(tagName, undefined)
  }

  async #setTileAccent(labels: string[], presetName: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    if (!lineage) return
    const dir = await lineage.explorerDir()
    if (!dir) return

    for (const label of labels) {
      try {
        const cellDir = await dir.getDirectoryHandle(label, { create: true })
        const props = await readProps(cellDir)
        props['accent'] = presetName
        await writeProps(cellDir, props)
      } catch { /* skip inaccessible tiles */ }
    }

    void new hypercomb().act()
  }
}

// ── OPFS 0000 props helpers ─────────────────────────────────────

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
  const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(updates))
  await writable.close()
}

function loadIndex(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return 0
  const n = parseInt(stored, 10)
  return (n >= 0 && n < ACCENT_INDEX_TO_NAME.length) ? n : 0
}

// ── slash completion ────────────────────────────────────

AccentQueenBee.prototype.slashComplete = function (args: string): readonly string[] {
  const presets = Object.keys(ACCENT_NAMES)
  const q = args.toLowerCase().trim()

  // Remove mode: /accent ~tag
  if (q.startsWith('~')) {
    const tagQ = q.slice(1)
    const registry = get('@hypercomb.social/TagRegistry') as { names: readonly string[] } | undefined
    const names = registry?.names ?? []
    if (!tagQ) return names.map(n => `~${n}`)
    return names.filter(n => n.toLowerCase().startsWith(tagQ)).map(n => `~${n}`)
  }

  // Bracket mode: /accent [tag1, tag2] preset
  if (q.startsWith('[')) return presets

  // Two-arg: first word is a tag, complete preset for second
  const parts = q.split(/\s+/)
  if (parts.length >= 2) {
    const presetQ = parts[parts.length - 1]
    return presets.filter(p => p.startsWith(presetQ))
  }

  // Single arg: complete preset names + tag names
  const registry = get('@hypercomb.social/TagRegistry') as { names: readonly string[] } | undefined
  const tags = registry?.names ?? []
  const all = [...presets, ...tags]
  if (!q) return all
  return all.filter(s => s.toLowerCase().startsWith(q))
}

// ── registration ────────────────────────────────────────

const _accent = new AccentQueenBee()
window.ioc.register('@diamondcoreprocessor.com/AccentQueenBee', _accent)
