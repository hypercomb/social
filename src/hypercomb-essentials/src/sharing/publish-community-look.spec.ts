// publish-community-look.spec.ts — THE HIVE'S WINDOW SHOWS WHAT ANOTHER DEVICE SAVED (2026-11-16).
//
// jwize: "when I turn it off from my phone it doesn't affect my desktop … They have to be globally In Sync, Last one
// wins". The Publish window read the community only on a full look, so a window left open never saw a phone's
// change. It now reads it again whenever it is looked at again, and a read that was out while one of its own
// switches landed never paints the older answer over it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DRONE = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'publish-status.drone.ts'), 'utf8')
const body = (signature: string): string => {
  const start = DRONE.indexOf(signature)
  expect(start, `${signature} not found`).toBeGreaterThan(-1)
  return DRONE.slice(start, DRONE.indexOf('\n  }\n', start))
}

describe('the Publish window reads the community again when looked at', () => {
  it('a shown tab or a focused hive reads it again', () => {
    expect(DRONE).toContain("document.addEventListener('visibilitychange', () => this.#lookAgain())")
    expect(DRONE).toContain("window.addEventListener('focus', () => this.#lookAgain())")
  })

  it('only while the window is open and shown; too soon or mid-switch is put off, never dropped — except an open, at once', () => {
    const look = body('#lookAgain(opened = false): void {')
    expect(look).toMatch(/if \(!this\.#open \|\| !this\.#zone\) return/)
    expect(look).toContain("document.visibilityState === 'hidden'")
    expect(look).toContain('this.#communityBusy.size > 0 ? COMMUNITY_LOOK_MS : opened ? 0 : this.#communityLookedAt + COMMUNITY_LOOK_MS - Date.now()')
    expect(look).toContain('this.#communityLookLater = setTimeout(')
    expect(look).toContain('void this.#readShowcase()')
  })

  it('an open window in focus asks every little while, and a sign by this hive itself is read again', () => {
    expect(DRONE).toMatch(/setInterval\(\(\) => \{ if \(Date\.now\(\) - this\.#communityLookedAt >= COMMUNITY_ON_SCREEN_MS - 1_000\) this\.#lookAgain\(\) \}, COMMUNITY_ON_SCREEN_MS\)/)
    expect(DRONE).toContain('this.onEffect(SHOWCASE_SIGNED_EFFECT, () => { this.#communityWrites++; this.#lookAgain(true) })')
  })

  it('every open reads it, even when the rest of the look is fresh', () => {
    expect(body('#lookOnOpen(): void {')).toContain('this.#lookAgain(true)')
  })

  it('a read begun before one of its own switches landed is dropped', () => {
    const read = body('async #readShowcase(): Promise<void> {')
    expect(read).toContain('const writes = this.#communityWrites')
    expect(read).toContain('this.#communityWrites !== writes || this.#communityReads !== asked) return')
    // Only the newest read asked paints.
    expect(read).toContain('const asked = ++this.#communityReads')
    expect(body('async #communitySwitch(')).toContain('this.#communityWrites++')
  })
})

// jwize 2026-11-17: "I still don't see the changes I make on my mobile … on my desktop". The hive's named public host
// was gone and nothing could name it again, so the window had no community and never read one. The community is the
// participant's own domain: the named public host, else the own host they chose — never this machine, never a default.
describe('your community lives on your own domain', () => {
  it('with no public host named, the window takes the zone the last save names, else the own host', () => {
    expect(DRONE).toMatch(/this\.#zone = host\s+\|\| \(SIG_RE\.test\(pubkey\) \? zoneDoor\(await communityZoneIn\(readDoor, pubkey, own\)[^\n]*\n\s+\|\| own/)
    // Found before the served read asks about it.
    expect(DRONE.indexOf('communityZoneIn(readDoor')).toBeLessThan(DRONE.indexOf('const servedRead = servedZones(this.#zone)'))
  })

  it('the own host counts only as a public domain', async () => {
    localStorage.clear()
    const { hostSyncService } = await import('./host-sync.service.js')
    expect(hostSyncService.ownHostDomain()).toBe('')
    hostSyncService.setOwnHost('https://JWize.com/')
    expect(hostSyncService.ownHostDomain()).toBe('jwize.com')
    hostSyncService.setOwnHost('content.jwize.com')
    expect(hostSyncService.ownHostDomain()).toBe('jwize.com')
    for (const machine of ['localhost:4250', 'localhost', '127.0.0.1', 'not a host']) {
      hostSyncService.setOwnHost(machine)
      expect(hostSyncService.ownHostDomain(), machine).toBe('')
    }
    // Naming the own host never names a public host: writes still need one named.
    expect(hostSyncService.publicHostDomain()).toBe('')
    localStorage.clear()
  })
})
