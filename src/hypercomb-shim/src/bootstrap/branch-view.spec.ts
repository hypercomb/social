import { canonicalLayerJson, SignatureService } from '@hypercomb/core'
import { describe, expect, it, vi } from 'vitest'
import { branchView } from './branch-view'

const encoder = new TextEncoder()

const signed = async (name: string, fields: Record<string, unknown> = {}) => {
  const bytes = encoder.encode(canonicalLayerJson({ name, ...fields }))
  const sig = await SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  return { sig, bytes }
}

describe('the branch on the host page', () => {
  it('shows the folders, mints a new root when a file is off, and leaves AI dormant', async () => {
    const bee = encoder.encode('export const bee = 1\n')
    const beeSig = await SignatureService.sign(bee.buffer.slice(bee.byteOffset, bee.byteOffset + bee.byteLength))
    const child = await signed('arkanoid', { bees: [beeSig] })
    const root = await signed('essentials', { cells: [child.sig] })
    const files = new Map<string, Uint8Array>([[beeSig, bee], [child.sig, child.bytes], [root.sig, root.bytes]])
    const view = branchView({
      rootSig: root.sig,
      source: 'jwize.com',
      installed: root.sig,
      read: async sig => files.get(sig) ?? null,
    })
    document.body.append(view)
    await vi.waitFor(() => expect(view.textContent).toContain('arkanoid'))
    expect(view.textContent).toContain('files loaded here')
    expect(view.querySelector('iframe')).toBeNull()

    const file = view.querySelector<HTMLInputElement>('label input')!
    file.click()
    view.querySelectorAll('button')
    const mint = [...view.querySelectorAll('button')].find(button => button.textContent === 'Mint root')!
    mint.click()
    await vi.waitFor(() => expect(view.querySelector('.minted code')?.textContent).toMatch(/^[a-f0-9]{64}$/))
    expect(view.querySelector('.minted code')?.textContent).not.toBe(root.sig)

    const minify = [...view.querySelectorAll('button')].find(button => button.textContent === 'Minify this folder')!
    minify.click()
    await vi.waitFor(() => expect(view.textContent).toContain(`derived:${root.sig}`))

    const load = [...view.querySelectorAll('button')].find(button => button.textContent === 'Load AI')!
    load.click()
    expect(view.querySelector('iframe')).toBeNull()
    expect(view.textContent).toContain('AI stays dormant')
    const mission = view.querySelector<HTMLInputElement>('[aria-label="Mission name"]')!
    mission.value = 'review'
    load.click()
    expect(view.querySelector('iframe')?.getAttribute('src')).toBe('https://try-review.jwize.com/')
    view.remove()
  })
})
