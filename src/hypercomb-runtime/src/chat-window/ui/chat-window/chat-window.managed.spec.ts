// chat-window.managed.spec.ts — the chat window on a managed site door
// (jwize, 2026-11-13: "The ai should be able to do anything it likes").
//
// The doors are covered where they live (core/managed-page.spec.ts, the
// grammar and the work-fence managed specs); this holds the window to the one
// switch that wires them: on a managed page a write waits only for somewhere
// to wait, every model reads freely, the lesson is the replica's, and the
// receipts say the change shows on the card. Everywhere else every one of
// those reads exactly as it did.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'hypercomb-runtime', 'src', 'chat-window', 'ui', 'chat-window', 'chat-window.ts'), 'utf8').replace(/\r\n/g, '\n')

describe('the chat window on a managed site door', () => {
  it('reads the page once per turn, the way the shim does', () => {
    expect(source).toContain("import { managedPage } from '../../core/managed-page'")
    expect(source).toContain('const managed = managedPage()')
  })

  it('writes need only the Execution column there — never a census verb granted first', () => {
    expect(source).toContain('const canEdit = managed ? !!queue : canChange')
    expect(source).toContain('const canWrite = canEdit && canRead && !!installedPackageSig()')
    expect(source).toContain('const canWriteDoctrine = canEdit && !!anatomyDoctrine?.write')
    expect(source).toContain('const canWriteFiles = canEdit && !!tileFiles?.write && !!tileFiles.read')
    // Changes themselves are still the census's, under the page's grant.
    expect(source).toContain('const canChange = !!queue && !!slash?.executePublicCanonical && callableBehaviours(behaviourEntries).length > 0')
  })

  it('lets every model read freely there, and only a granted one elsewhere', () => {
    expect(source).toContain("&& (!!managed || (providerId === 'local' && localReadyAndTrusted) || (hiveAccess?.granted?.() ?? []).includes(providerId))")
  })

  it('teaches the replica in place of the trial, and the SANDBOX line only elsewhere', () => {
    expect(source).toContain('...(managed ? { managed: { lineage: managed.lineage, title: managed.title } } : {}),')
    expect(source).toContain("managed ? managedRule({ lineage: managed.lineage, title: managed.title }) : canWriteFiles ? sandboxRule(undefined, grammarContext.page) : '',")
  })

  it('asks only for the page to be read before it changes, and says the change shows on the card', () => {
    expect(source).toContain('managed ? pageChangeUnready(parsed.route, reads, { managed: true }) : pageChangeUnready(parsed.route, reads)')
    expect(source).toContain('...(managed ? { managed: true } : {}),')
  })

  it('hands the card target to the tile-files door with its part, and counts a card write as the page work done', () => {
    expect(source).toContain("type TileFileTarget = { route: readonly string[]; kind: 'page' | 'file' | 'card'; name?: string; part?: 'details' | 'theme' }")
    expect(source).toContain('...(parsed.part ? { part: parsed.part } : {}),')
    expect(source).toContain("ran.some(line => line.startsWith('write page /') || line.startsWith('write card /')),")
  })
})
