import { resolve } from 'path'
import { buildModules } from '@hypercomb/sdk'

export async function runBuild(args: string[]): Promise<void> {
  const local = args.includes('--local')
  const projectRoot = resolve(process.cwd())

  console.log(`[hypercomb] building modules${local ? ' (local)' : ''}...`)

  const result = await buildModules({ projectRoot, local })

  if (!result.success) {
    console.error(`[hypercomb] build failed: ${result.error}`)
    process.exit(1)
  }

  console.log(`[hypercomb] build complete`)
  if (result.rootSignature) console.log(`[hypercomb] root signature: ${result.rootSignature}`)
  if (result.outputDir) console.log(`[hypercomb] output: ${result.outputDir}`)
}
