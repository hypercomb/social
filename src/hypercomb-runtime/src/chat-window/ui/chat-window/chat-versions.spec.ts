import { describe, expect, it } from 'vitest'
import { resourceVersion, versionsIn } from './chat-versions.js'

describe('chat versions', () => {
  it('reads a trial origin out of a receipt', () => {
    const head = 'try-'
    const named = `http://${head}press-kit-v1.localhost:4250/`
    expect(versionsIn(`The page is at ${named} and again at ${named}`)).toEqual([
      { href: `http://${head}press-kit-v1.localhost:4250`, label: `${head}press-kit-v1` },
    ])
    expect(versionsIn('nothing to open')).toEqual([])
  })

  it('links a resource by its signature', () => {
    const sig = 'ab'.repeat(32)
    expect(resourceVersion(sig)).toEqual({ href: `/@resource/${sig}`, label: 'abababab' })
    expect(resourceVersion('nope')).toBeNull()
  })
})
