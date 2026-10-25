// The router's first navigation must not percent-encode the selection tail.

import '@angular/compiler'
import { describe, expect, it } from 'vitest'
import { AddressUrlSerializer } from './address-url-serializer'

describe('AddressUrlSerializer', () => {
  const s = new AddressUrlSerializer()
  const round = (url: string): string => s.serialize(s.parse(url))

  it('keeps the selection brackets literal in the path', () => {
    expect(round('/Plain/[x]')).toBe('/Plain/[x]')
    expect(round('/Big-Ideas/[a-b,c]')).toBe('/Big-Ideas/[a-b,c]')
  })

  it('leaves a query and a fragment as the default serializer writes them', () => {
    expect(round('/p/[x]?q=%5B1%5D#h')).toBe('/p/[x]?q=%5B1%5D#h')
  })
})
