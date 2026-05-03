import { send } from '../bridge/client.js'

const USAGE = `Usage: hypercomb do "<text>"
       hypercomb do --stdin

Submits text through the in-app command-line state machine. Anything the
keyboard accepts is accepted here: cell names, slash behaviours, bracket
selects, multi-token grammar.

Modes:
  do "<text>"     Submit a single line.
  do --stdin      Read lines from stdin and submit each in order.
                  Blank lines are skipped. A failure stops the run unless
                  --keep-going is passed.

Flags:
  --keep-going    With --stdin, continue past failures.
`

export async function runDo(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE)
    return
  }

  if (args[0] === '--stdin') {
    return doStdin(args.slice(1))
  }

  // single-line mode: join remaining args so unquoted invocations
  // like `hypercomb do select alpha bravo` still work.
  const text = args.join(' ')
  await submitOne(text)
}

async function submitOne(text: string): Promise<void> {
  if (!text.trim()) {
    console.error('[do] empty text')
    process.exit(1)
  }

  const res = await send({ op: 'submit', text })

  if (!res.ok) {
    console.error(`[do] submit failed: ${res.error}`)
    process.exit(1)
  }

  console.log(`[do] ${text}`)
}

async function doStdin(args: string[]): Promise<void> {
  const keepGoing = args.includes('--keep-going')
  const lines = await readStdinLines()

  let successes = 0
  let failures = 0

  for (const raw of lines) {
    const text = raw.trim()
    if (!text) continue

    const res = await send({ op: 'submit', text })
    if (res.ok) {
      console.log(`[do] ${text}`)
      successes++
    } else {
      console.error(`[do] FAIL: ${text} — ${res.error}`)
      failures++
      if (!keepGoing) {
        console.error(`[do] stopped at first failure (use --keep-going to continue)`)
        process.exit(1)
      }
    }
  }

  console.log(`[do] ${successes} ok, ${failures} failed`)
  if (failures > 0 && keepGoing) process.exit(1)
}

function readStdinLines(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { buf += chunk })
    process.stdin.on('end', () => resolve(buf.split(/\r?\n/)))
    process.stdin.on('error', reject)
  })
}
