// show-cell.secret-notice.spec.ts — `mesh:secret` is a notice, never the secret.
// The bus replays its last value to every late subscriber (and the bridge's
// `effect-last` hands it off the page), so the room secret never rides it:
// ShowCellDrone reads it from the SecretStore when the notice lands. The drone
// cannot be stood up in a unit test, so this reads its source.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

describe('show-cell hears mesh:secret as a notice', () => {
  it('reads the secret from the SecretStore and never from the payload', () => {
    const at = SRC.indexOf("this.onEffect('mesh:secret'")
    expect(at, 'the mesh:secret listener').toBeGreaterThan(-1)
    const handler = SRC.slice(at, SRC.indexOf('\n    })', at))
    expect(handler).toContain("'@hypercomb.social/SecretStore'")
    expect(SRC).not.toMatch(/'mesh:secret',\s*\(\s*\{\s*secret/)
  })
})
