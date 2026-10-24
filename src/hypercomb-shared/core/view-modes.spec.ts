// view-modes.spec.ts — every full-surface view the essentials register is a
// TRANSIENT mode.
//
// view-mode.service.ts keeps the list by hand (this shell file cannot import
// the essentials' VisualBeeRegistry) and its header has long said a ratchet by
// this name guards it. None existed, and the list drifted a third time: the
// scroller (2026-09-01) never made it in, so its canvas was never suppressed
// and `body.hc-view-covered` — the visitor cover's and the approach's signal —
// never came up on a door that opens on it.
//
// Read from SOURCE: each `registry.register({ view: … })` declaration in
// essentials, its token resolved through the file-local or exported constant
// it names. A `behavior: 'navigation'` view (templates) never takes the
// surface and is not a mode. Generated files are not source: the build's
// gitignored `essentials-keys.ts` redeclares the same constant names as IoC
// keys (POSTIT_VIEW = '@commands/postit-kind'), so a scan that read it would
// pass in a bare export and fail in every built checkout.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

;(globalThis as { register?: unknown }).register = (): void => {}
const { isTransientMode } = await import('./view-mode.service')

const ESSENTIALS = join(__dirname, '..', '..', 'hypercomb-essentials', 'src')

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(path)
  }
  return out
}

const constantsIn = (code: string): Map<string, string> => new Map(
  [...code.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)].map(m => [m[1], m[2]] as [string, string]))

const registeredViews = (): string[] => {
  const sources = walk(ESSENTIALS).map(file => readFileSync(file, 'utf8'))
    .filter(code => !code.startsWith('// auto-generated'))
  const constants = new Map<string, string>()
  for (const code of sources) for (const [name, value] of constantsIn(code)) constants.set(name, value)
  const views = new Set<string>()
  for (const code of sources) {
    const local = constantsIn(code)
    for (const m of code.matchAll(/\.register\(\{([\s\S]*?)\n\s*\}\)/g)) {
      const block = m[1]
      const token = /\n\s*view:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]*))\s*,/.exec(block)
      if (!token) continue
      if (/\n\s*behavior:\s*'navigation'/.test(block)) continue
      const view = token[1] ?? local.get(token[2]) ?? constants.get(token[2])
      expect(view, `unresolved view constant ${token[2]}`).toBeTruthy()
      views.add(view!)
    }
  }
  return [...views].sort()
}

describe('view modes — every takeover view is transient', () => {
  it('finds the registered views (the scan itself is alive)', () => {
    expect(registeredViews()).toEqual(expect.arrayContaining(['website', 'postit', 'slides', 'game', 'scroller']))
  })

  it('each registered full-surface view covers the canvas and never restores on boot', () => {
    expect(registeredViews().filter(view => !isTransientMode(view))).toEqual([])
  })
})
