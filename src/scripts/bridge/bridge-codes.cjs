// bridge-codes.cjs — does this sender hold a bridge code?
//
// THE BROKER NEVER SEES A CODE IT DID NOT RECEIVE. The hive keeps its codes
// device-local and hands the broker only their SHA-256 hashes (at renderer
// registration, and again whenever the list changes). A sender presents the
// code itself; the broker hashes it once and asks whether that hash is one the
// renderer gave it, or the hash of the env token (the optional fallback).
//
// THE SHARED RULE (byte for byte with the hive's BridgeCodeStore): a code is
// String(x).trim(), no case folding, 1–256 PRINTABLE ASCII characters (0x21–
// 0x7E — no spaces); its hash is lowercase hex SHA-256 of its UTF-8 bytes.
// Printable ASCII because a Node client presents its code in the handshake's
// Authorization header, which cannot carry anything else intact. Anything
// else is not a code and hashes to ''.
//
// Twin: hypercomb-cli/src/bridge/server.ts keeps the same three functions.

const { createHash, timingSafeEqual } = require('node:crypto')

const HASH_RE = /^[0-9a-f]{64}$/
const CODE_RE = /^[\x21-\x7e]{1,256}$/
const MAX_HASHES = 256

// '' for anything that is not a code — empty after trimming, too long, or
// holding a character a header cannot carry.
function hashCode(code) {
  const text = String(code ?? '').trim()
  if (!CODE_RE.test(text)) return ''
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// The renderer's list as the broker keeps it: well-formed hashes only, each
// once, at most 256. Anything that is not an array is no list at all.
function parseCodeHashes(list) {
  const hashes = new Set()
  if (!Array.isArray(list)) return hashes
  for (const entry of list) {
    if (hashes.size >= MAX_HASHES) break
    if (typeof entry === 'string' && HASH_RE.test(entry)) hashes.add(entry)
  }
  return hashes
}

// Compared in constant time against every entry and the token hash, the
// results OR-ed with no early exit — how far the scan got says nothing.
function codeAdmitted(presentedHash, hashes, tokenHash) {
  if (typeof presentedHash !== 'string' || !HASH_RE.test(presentedHash)) return false
  const presented = Buffer.from(presentedHash, 'hex')
  let admitted = false
  for (const candidate of [...(hashes ?? []), tokenHash]) {
    if (typeof candidate !== 'string' || !HASH_RE.test(candidate)) continue
    admitted = timingSafeEqual(presented, Buffer.from(candidate, 'hex')) || admitted
  }
  return admitted
}

module.exports = { hashCode, parseCodeHashes, codeAdmitted }
