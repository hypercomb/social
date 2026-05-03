import { runBuild } from './commands/build.js'
import { runInspect } from './commands/inspect.js'
import { runTile } from './commands/tile.js'
import { runDo } from './commands/do.js'
import { runBridge } from './bridge/server.js'

const USAGE = `Usage: hypercomb <command> [options]

Commands:
  build [--local]              Build essentials modules (--local skips Azure deploy)
  inspect [--keys|--registry]  Show IoC keys or live registry contents
  bridge                       Start WebSocket relay (port 2401)
  tile <subcommand>            Manage tiles via bridge (add/remove/list/inspect/history)
  do "<text>" | do --stdin     Submit text through the in-app command line
  help                         Show this message
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
    case 'bridge':
      return runBridge()
    case 'tile':
      return runTile(rest)
    case 'do':
      return runDo(rest)
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
