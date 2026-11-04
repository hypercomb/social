// kinds.spec.ts — one vocabulary of Nostr kinds (core nostr-kinds.ts).
//
// A kind is a protocol number; the same number typed in three files is how a
// handler and a filter drift apart. Every kind a module names must be a row of
// the vocabulary, every row is unique, and a retired number is never spoken.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import * as core from '@hypercomb/core'
import { NOSTR_KINDS, nostrKindEntry, SPEAKS_FOR_KINDS, SWARM_BEHAVIOR_KIND, SWARM_LIFECYCLE_KIND } from '@hypercomb/core'

const ESSENTIALS = join(__dirname, '..')

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== 'node_modules' && name !== 'dist') walk(full, out); continue }
    if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Every `X_KIND = 12345` / `KIND_X = 12345` a module declares, with where. */
const declared = (): { file: string; name: string; kind: number }[] => {
  const found: { file: string; name: string; kind: number }[] = []
  for (const file of walk(ESSENTIALS)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\b(?:readonly\s+)?#?((?:[A-Z][A-Z0-9_]*_KIND|KIND_[A-Z0-9_]+))\s*=\s*(\d{5})\b/g)) {
      found.push({ file: relative(ESSENTIALS, file).replace(/\\/g, '/'), name: m[1], kind: Number(m[2]) })
    }
  }
  return found
}

describe('the vocabulary itself', () => {
  it('names every kind once — no number appears twice', () => {
    const kinds = NOSTR_KINDS.map(k => k.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    const names = NOSTR_KINDS.map(k => k.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every row has a one-line meaning and sits in a Nostr range', () => {
    for (const row of NOSTR_KINDS) {
      expect(row.meaning.trim().length, row.name).toBeGreaterThan(8)
      expect(row.meaning.includes('\n'), row.name).toBe(false)
      const ephemeral = row.kind >= 20000 && row.kind < 30000
      const replaceable = row.kind >= 30000 && row.kind < 40000
      expect(ephemeral || replaceable, `${row.name} = ${row.kind}`).toBe(true)
    }
  })

  it('every exported *_KIND / KIND_* name of core is a live row of the table', () => {
    const exported = Object.entries(core).filter(([name, value]) =>
      typeof value === 'number' && (/_KIND$/.test(name) || /^KIND_/.test(name)))
    expect(exported.length).toBeGreaterThan(20)
    for (const [name, value] of exported) {
      const row = nostrKindEntry(value as number)
      expect(row, `${name} = ${value} has no row`).toBeDefined()
      expect(row?.retired, `${name} names a retired kind`).toBeUndefined()
    }
  })

  it('the kinds whose d-tag is the key they speak for are the lifecycle and behaviour slots', () => {
    expect([...SPEAKS_FOR_KINDS].sort()).toEqual([SWARM_LIFECYCLE_KIND, SWARM_BEHAVIOR_KIND].sort())
  })
})

describe('the modules speak only the vocabulary', () => {
  it('a kind a module still declares by number is a row of the table, never a retired one', () => {
    const rows = declared()
    expect(rows.length).toBeGreaterThan(0)
    const problems: string[] = []
    for (const { file, name, kind } of rows) {
      const row = nostrKindEntry(kind)
      if (!row) problems.push(`${file}: ${name} = ${kind} is not in core nostr-kinds`)
      else if (row.retired) problems.push(`${file}: ${name} = ${kind} reuses a retired kind (${row.name})`)
    }
    expect(problems).toEqual([])
  })

  it('the swarm, the content broker and host-sync restate no kind', () => {
    const names = declared().filter(r =>
      r.file === 'sharing/swarm.drone.ts' || r.file === 'sharing/content-broker.boot.drone.ts' || r.file === 'sharing/host-sync.service.ts')
    expect(names).toEqual([])
  })
})
