const { existsSync } = require('fs')
const { dirname, join, resolve } = require('path')
const { spawnSync } = require('child_process')

const scriptDir = __dirname
const packageRoot = resolve(scriptDir, '..')
const tsxCandidates = [
  join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  join(packageRoot, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
]

const tsxCli = tsxCandidates.find(existsSync)

if (!tsxCli) {
  console.log('[prepare] skipping: tsx is not installed yet')
  process.exit(0)
}

const result = spawnSync(process.execPath, [tsxCli, './scripts/prepare.ts'], {
  cwd: packageRoot,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)