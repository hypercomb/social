// root-holder.spec.ts — A NAMED ROOT NEEDS NO LISTING. A follower told by a
// signed pointer to take a root no host pool lists finds the host that serves
// the root's file, and only a host whose bytes hash to the name counts.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { rootHolder } from './acquire'

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('rootHolder', () => {
  it('finds the base that serves the root, and makes a row from it', async () => {
    const root = bytes('{"name":"root","cells":[]}')
    const sig = await SignatureService.sign(root)
    const asked: string[] = []
    const row = await rootHolder('content.example.com', sig, async url => {
      asked.push(url)
      return url === `https://content.example.com/${sig}` ? root : null
    })
    expect(row).toMatchObject({ zone: 'content.example.com', base: 'https://content.example.com', packageSig: sig })
    expect(asked).toEqual([`https://content.example.com/content/${sig}`, `https://content.example.com/${sig}`])
  })

  it('is no holder when every base answers with something else — a page, or nothing', async () => {
    const sig = await SignatureService.sign(bytes('{"name":"root"}'))
    expect(await rootHolder('example.com', sig, async () => bytes('<!doctype html><title>app</title>'))).toBeNull()
    expect(await rootHolder('example.com', sig, async () => { throw new Error('offline') })).toBeNull()
  })
})
