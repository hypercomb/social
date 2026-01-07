import { readFile } from 'node:fs/promises'
import { SignatureService } from '@hypercomb/core'

const filePath = process.argv[2]

if (!filePath) {
  console.error('usage: npx ts-node hash-file.ts <file-path>')
  process.exit(1)
}

// read raw bytes from disk
const buffer = await readFile(filePath)

// IMPORTANT:
// Node Buffer may be larger than the view — slice correctly
const bytes = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength
)

// dump bytes using the SAME helper as the browser
SignatureService.dumpBytes('DISK BYTES', bytes)

// compute signature using SAME code path
const signature = await SignatureService.sign(bytes)

console.log({
  file: filePath,
  signature
})
