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

// The anatomy FIRST: it writes src/assistant/anatomy/anatomy.generated.ts,
// and prepare.ts must then see that file when it derives the folder index.
for (const script of ['./scripts/build-anatomy.ts', './scripts/prepare.ts']) {
  const result = spawnSync(process.execPath, [tsxCli, script], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

process.exit(0)