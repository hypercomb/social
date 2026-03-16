import { resolve } from 'path'
import { spawnSync } from 'child_process'

export interface BuildOptions {
  projectRoot: string
  local?: boolean
}

export interface BuildResult {
  success: boolean
  rootSignature?: string
  outputDir?: string
  error?: string
}

export async function buildModules(options: BuildOptions): Promise<BuildResult> {
  const scriptPath = resolve(options.projectRoot, 'hypercomb-essentials/scripts/build-module.ts')
  const args = [scriptPath]
  if (options.local) args.push('--local')

  const result = spawnSync('tsx', args, {
    cwd: resolve(options.projectRoot, 'hypercomb-essentials'),
    stdio: 'pipe',
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    return {
      success: false,
      error: result.stderr || result.stdout || 'build failed',
    }
  }

  // Extract root signature from output
  const sigMatch = result.stdout.match(/root signature:\s*([a-f0-9]{64})/i)
  const outMatch = result.stdout.match(/output:\s*(.+)/i)

  return {
    success: true,
    rootSignature: sigMatch?.[1],
    outputDir: outMatch?.[1]?.trim(),
  }
}
