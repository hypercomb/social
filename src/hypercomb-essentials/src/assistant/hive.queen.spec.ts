// hive.queen.spec.ts — the word reads a name and an optional depth.

import { beforeAll, describe, expect, it } from 'vitest'

let parseHiveWord: typeof import('./hive.queen')['parseHiveWord']

beforeAll(async () => {
  // The module registers its queen at load; give it an IoC to register into.
  ;(window as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined }
  ;({ parseHiveWord } = await import('./hive.queen'))
})

describe('hive word', () => {
  it('defaults the name', () => {
    expect(parseHiveWord('')).toEqual({ name: 'hive' })
  })

  it('takes a name, which may be several words', () => {
    expect(parseHiveWord('solomon')).toEqual({ name: 'solomon' })
    expect(parseHiveWord('  solomon island ')).toEqual({ name: 'solomon island' })
  })

  it('takes a depth of 0, 1 or 2 after the name', () => {
    expect(parseHiveWord('solomon depth 0')).toEqual({ name: 'solomon', depth: 0 })
    expect(parseHiveWord('depth 2')).toEqual({ name: 'hive', depth: 2 })
  })

  it('leaves a depth that is not 0, 1 or 2 in the name', () => {
    expect(parseHiveWord('solomon depth 5')).toEqual({ name: 'solomon depth 5' })
  })
})
