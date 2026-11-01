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
    const mintedRoot = view.querySelector('.minted code')?.textContent ?? ''
    expect(mintedRoot).not.toBe(root.sig)
    await vi.waitFor(() => expect(view.textContent).toContain(`derived:${mintedRoot}`))
    expect(view.textContent).toContain('Minified the new registration.')

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

  it('keeps a published head while later mints and minifies continue', async () => {
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

    const publish = () => [...view.querySelectorAll('button')].find(button => button.textContent === 'Publish to head')!
    publish().click()
    await vi.waitFor(() => expect(view.querySelector('.published-head code.package')?.textContent).toBe(root.sig))
    expect(view.querySelector('.minted .published-head')).toBeNull()
    expect(view.querySelector('.head-lines')?.textContent).toBe(`${root.sig}\n`)
    expect(view.querySelector('.published-head a')?.getAttribute('download')).toBe('head')
    expect(view.textContent).toContain('Further builds leave these signatures in place.')
    expect(view.textContent).toContain('signatures to mind.')
    const stood = view.querySelector('.head-lines')?.textContent

    view.querySelector<HTMLInputElement>('label input')!.click()
    ;[...view.querySelectorAll('button')].find(button => button.textContent === 'Mint root')!.click()
    await vi.waitFor(() => expect(view.querySelector('.minted code')?.textContent).toMatch(/^[a-f0-9]{64}$/))
    const mintedRoot = view.querySelector('.minted code')?.textContent ?? ''
    expect(mintedRoot).not.toBe(root.sig)
    await vi.waitFor(() => expect(view.textContent).toContain('Minified the new registration.'))
    expect(view.querySelector('.published-head code.package')?.textContent).toBe(root.sig)
    expect(view.querySelector('.head-lines')?.textContent).toBe(stood)
    expect(view.querySelector('.published-head')?.textContent).not.toContain(mintedRoot)

    publish().click()
    await vi.waitFor(() => expect(view.querySelector('.published-head code.package')?.textContent).not.toBe(root.sig))
    const headPkg = view.querySelector('.published-head code.package')?.textContent ?? ''
    const derivation = view.querySelector('.published-head code.derivation')?.textContent ?? ''
    expect(headPkg).toMatch(/^[a-f0-9]{64}$/)
    expect(headPkg).not.toBe(mintedRoot)
    expect(derivation).toMatch(/^[a-f0-9]{64}$/)
    expect(view.querySelector('.head-lines')?.textContent).toBe(`${headPkg}\n${derivation}\n`)

    ;[...view.querySelectorAll('button')].find(button => button.textContent === 'Minify this folder')!.click()
    await vi.waitFor(() => expect(view.textContent).toContain(`derived:${root.sig}`))
    expect(view.querySelector('.published-head code.package')?.textContent).toBe(headPkg)
    expect(view.querySelector('.head-lines')?.textContent).toBe(`${headPkg}\n${derivation}\n`)
    view.remove()
  })
})
