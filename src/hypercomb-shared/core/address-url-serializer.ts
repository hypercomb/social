// hypercomb-shared/core/address-url-serializer.ts
//
// THE ROUTER WRITES THE ADDRESS THE WAY NAVIGATION DOES. Angular's router
// re-serializes the URL on its first navigation and percent-encodes the
// selection brackets, so `/parent/[x]` settled to `/parent/%5Bx%5D` on every
// load. Navigation's canonical writer form is the literal bracket tail; this
// keeps the brackets literal in the path (only there — a query or fragment is
// left exactly as the default serializer wrote it).

import { DefaultUrlSerializer, type UrlTree } from '@angular/router'

export class AddressUrlSerializer extends DefaultUrlSerializer {
  override serialize(tree: UrlTree): string {
    const url = super.serialize(tree)
    const cut = url.search(/[?#]/)
    const path = cut < 0 ? url : url.slice(0, cut)
    const rest = cut < 0 ? '' : url.slice(cut)
    return path.replace(/%5B/gi, '[').replace(/%5D/gi, ']') + rest
  }
}
