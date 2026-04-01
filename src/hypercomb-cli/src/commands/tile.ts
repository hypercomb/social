import { send } from '../bridge/client.js'

const USAGE = `Usage: hypercomb tile <subcommand> [options]

Subcommands:
  add <name> [name2...]         Create one or more tiles
  remove <name> [name2...]      Remove specific tiles
  remove --all                  Remove all tiles at current location
  list                          List visible tiles
  inspect <name>                Show tile properties
  history                       Show operation log for current location
`

export async function runTile(args: string[]): Promise<void> {
  const sub = args[0]
  const rest = args.slice(1)

  switch (sub) {
    case 'add':
      return tileAdd(rest)
    case 'remove':
      return tileRemove(rest)
    case 'list':
      return tileList()
    case 'inspect':
      return tileInspect(rest)
    case 'history':
      return tileHistory()
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE)
      return
    default:
      console.error(`Unknown tile subcommand: ${sub}\n`)
      console.log(USAGE)
      process.exit(1)
  }
}

async function tileAdd(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: hypercomb tile add <name> [name2...]')
    process.exit(1)
  }

  const res = await send({ op: 'add', cells: args })

  if (!res.ok) {
    console.error(`[tile] add failed: ${res.error}`)
    process.exit(1)
  }

  for (const cell of args) {
    console.log(`[tile] added: ${cell}`)
  }
}

async function tileRemove(args: string[]): Promise<void> {
  const all = args.includes('--all')

  if (!all && args.length === 0) {
    console.error('Usage: hypercomb tile remove <name> [name2...] | --all')
    process.exit(1)
  }

  const res = all
    ? await send({ op: 'remove', all: true })
    : await send({ op: 'remove', cells: args })

  if (!res.ok) {
    console.error(`[tile] remove failed: ${res.error}`)
    process.exit(1)
  }

  if (all) {
    const count = res.data?.count ?? 0
    console.log(`[tile] removed all (${count} tiles)`)
  } else {
    for (const cell of args) {
      console.log(`[tile] removed: ${cell}`)
    }
  }
}

async function tileList(): Promise<void> {
  const res = await send({ op: 'list' })

  if (!res.ok) {
    console.error(`[tile] list failed: ${res.error}`)
    process.exit(1)
  }

  const cells: string[] = res.data ?? []
  if (cells.length === 0) {
    console.log('[tile] (empty)')
  } else {
    for (const cell of cells) {
      console.log(`  ${cell}`)
    }
    console.log(`[tile] ${cells.length} tile(s)`)
  }
}

async function tileInspect(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: hypercomb tile inspect <name>')
    process.exit(1)
  }

  const res = await send({ op: 'inspect', cell: args[0] })

  if (!res.ok) {
    console.error(`[tile] inspect failed: ${res.error}`)
    process.exit(1)
  }

  console.log(JSON.stringify(res.data ?? {}, null, 2))
}

async function tileHistory(): Promise<void> {
  const res = await send({ op: 'history' })

  if (!res.ok) {
    console.error(`[tile] history failed: ${res.error}`)
    process.exit(1)
  }

  const ops: { op: string; cell: string; at: number }[] = res.data ?? []
  if (ops.length === 0) {
    console.log('[tile] (no history)')
  } else {
    for (const entry of ops) {
      const time = new Date(entry.at).toISOString()
      console.log(`  ${time}  ${entry.op.padEnd(8)} ${entry.cell}`)
    }
    console.log(`[tile] ${ops.length} operation(s)`)
  }
}
