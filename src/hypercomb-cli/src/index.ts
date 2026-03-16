import { runBuild } from './commands/build.js'
import { runInspect } from './commands/inspect.js'

const USAGE = `Usage: hypercomb <command> [options]

Commands:
  build [--local]          Build essentials modules (--local skips Azure deploy)
  inspect [--keys|--registry]  Show IoC keys or live registry contents
  help                     Show this message
`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  const rest = args.slice(1)

  switch (command) {
    case 'build':
      return runBuild(rest)
    case 'inspect':
      return runInspect(rest)
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE)
      return
    default:
      console.error(`Unknown command: ${command}\n`)
      console.log(USAGE)
      process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
