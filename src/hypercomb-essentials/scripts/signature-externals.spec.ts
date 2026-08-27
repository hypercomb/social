// @vitest-environment node

import { build } from 'esbuild'
import { signatureExternalPlugin, signatureModuleUrl } from './signature-externals'

const POOL = 'a'.repeat(64)
const CORE = 'b'.repeat(64)
const PIXI = 'c'.repeat(64)

describe('signature externals', () => {
  it('creates an exact extension-free OPFS module URL', () => {
    expect(signatureModuleUrl(POOL.toUpperCase(), CORE.toUpperCase()))
      .toBe(`/opfs/${POOL}/${CORE}`)
  })

  it('rejects non-signature addresses', () => {
    expect(() => signatureModuleUrl('dependencies', CORE)).toThrow(/64-hex/)
    expect(() => signatureModuleUrl(POOL, 'pixi.js')).toThrow(/64-hex/)
  })

  it('rewrites only declared platform imports during bundling', async () => {
    const result = await build({
      stdin: {
        contents: [
          "import { EffectBus } from '@hypercomb/core'",
          "import { Container } from 'pixi.js'",
          'console.log(EffectBus, Container)',
        ].join('\n'),
        loader: 'js',
      },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      plugins: [signatureExternalPlugin(POOL, {
        '@hypercomb/core': CORE,
        'pixi.js': PIXI,
      })],
    })

    const output = result.outputFiles[0].text
    expect(output).toContain(`from \"/opfs/${POOL}/${CORE}\"`)
    expect(output).toContain(`from \"/opfs/${POOL}/${PIXI}\"`)
    expect(output).not.toContain("'@hypercomb/core'")
    expect(output).not.toContain("'pixi.js'")
  })
})
