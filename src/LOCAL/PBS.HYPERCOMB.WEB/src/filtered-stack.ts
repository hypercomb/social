// filtered-stack.ts
// drop-in helper to clean up noisy stack traces (node + browser)

const skipPatterns = ["node_modules", "pixi.js", "rxjs"]

// optional: increase stack depth so you still see enough frames after filtering
Error.stackTraceLimit = 100

// node.js only: prepareStackTrace gives you structured frames
if (typeof (Error as any).prepareStackTrace !== "undefined") {
  Error.prepareStackTrace = (err: Error, structured: NodeJS.CallSite[]) => {
    const lines: string[] = []

    // first line = error message
    lines.push(err.toString())

    // subsequent lines = filtered callsites
    for (const call of structured) {
      const line = "    at " + call.toString()
      if (!skipPatterns.some(p => line.includes(p))) {
        lines.push(line)
      }
    }

    return lines.join("\n")
  }
}

// browser fallback: wrap console.error for filtering
const originalError = console.error
console.error = (...args: any[]) => {
  const filtered = args.map(arg => {
    if (arg instanceof Error && arg.stack) {
      const lines = arg.stack.split("\n")
      return lines.filter(line => !skipPatterns.some(p => line.includes(p))).join("\n")
    }
    return arg
  })
  originalError(...filtered)
}
