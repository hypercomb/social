// @vitest-environment node
//
// stamp-install-channel.spec.ts — the publisher record lands in BOTH places it
// is read: the package's (the update scout) and the web shell's (a cold
// install). Written together, byte-identical, so the two can never follow
// different publishers.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PUBLISHER_FILES, recordPublisher } from './stamp-install-channel.js'

const KEY = '1'.repeat(64)
const NEXT = '2'.repeat(64)

let dir: string
let record: string
let shell: string
const quiet = (): void => {}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stamp-publisher-'))
  record = join(dir, 'package.json')
  shell = join(dir, 'shell.json')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('recordPublisher', () => {
  it('writes the record and the shell copy together, byte-identical', () => {
    const written = recordPublisher({ pubkey: KEY, host: 'hypercomb.com' }, 'essentials', [record, shell], quiet)
    expect(written).toEqual([record, shell])
    expect(readFileSync(shell, 'utf8')).toBe(readFileSync(record, 'utf8'))
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({ pubkey: KEY, hosts: ['hypercomb.com'], channel: 'essentials' })
  })

  it('keeps the owner\'s hosts — the host a stamp landed on never replaces them', () => {
    writeFileSync(record, JSON.stringify({ pubkey: KEY, hosts: ['content.hypercomb.com'], channel: 'essentials' }, null, 2) + '\n')
    recordPublisher({ pubkey: NEXT, host: 'pluginthematrix.com' }, 'essentials', [record, shell], quiet)
    expect(JSON.parse(readFileSync(shell, 'utf8'))).toEqual({ pubkey: NEXT, hosts: ['content.hypercomb.com'], channel: 'essentials' })
  })

  it('heals a shell copy that drifted, leaving an unchanged record alone', () => {
    const text = JSON.stringify({ pubkey: KEY, hosts: ['content.hypercomb.com'], channel: 'essentials' }, null, 2) + '\n'
    writeFileSync(record, text)
    writeFileSync(shell, '{"pubkey":"stale"}')
    expect(recordPublisher({ pubkey: KEY }, 'essentials', [record, shell], quiet)).toEqual([shell])
    expect(readFileSync(shell, 'utf8')).toBe(text)
  })

  it('touches nothing for a stamp that changes nothing', () => {
    const text = JSON.stringify({ pubkey: KEY, hosts: ['content.hypercomb.com'], channel: 'essentials' }, null, 2) + '\n'
    writeFileSync(record, text)
    writeFileSync(shell, text)
    expect(recordPublisher({ pubkey: KEY }, 'essentials', [record, shell], quiet)).toEqual([])
  })

  it('records only the channel the scout reads', () => {
    expect(recordPublisher({ pubkey: KEY }, 'beta', [record, shell], quiet)).toEqual([])
    expect(existsSync(record) || existsSync(shell)).toBe(false)
  })

  it('names the package\'s record first and the web shell\'s copy beside it', () => {
    expect(PUBLISHER_FILES[0]!.replace(/\\/g, '/')).toMatch(/hypercomb-essentials\/src\/sharing\/install-publisher\.json$/)
    expect(PUBLISHER_FILES[1]!.replace(/\\/g, '/')).toMatch(/hypercomb-web\/src\/setup\/install-publisher\.json$/)
    for (const file of PUBLISHER_FILES) expect(existsSync(file)).toBe(true)
  })
})
