// diamondcoreprocessor.com/link/normalize.spec.ts
//
// Tile links are typed by hand. These tests pin the contract that every
// saved link — scheme or no scheme — leaves normalizeLink as something
// window.open can actually navigate to.

import { describe, it, expect } from 'vitest'
import { normalizeLink } from './normalize.js'

describe('normalizeLink', () => {
  it('leaves full URLs untouched', () => {
    expect(normalizeLink('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d')
    expect(normalizeLink('http://localhost:4250/hello')).toBe('http://localhost:4250/hello')
    expect(normalizeLink('ftp://files.example.com')).toBe('ftp://files.example.com')
  })

  it('leaves in-app paths origin-relative', () => {
    expect(normalizeLink('/@resource/abc123')).toBe('/@resource/abc123')
    expect(normalizeLink('/dolphin/practice')).toBe('/dolphin/practice')
  })

  it('leaves authority-less real schemes untouched', () => {
    expect(normalizeLink('mailto:bee@hive.io')).toBe('mailto:bee@hive.io')
    expect(normalizeLink('tel:+15551234567')).toBe('tel:+15551234567')
  })

  it('rescues the host-parsed-as-scheme trap (the "localhost:4250" tab-to-nowhere)', () => {
    expect(normalizeLink('localhost:4250')).toBe('http://localhost:4250')
    expect(normalizeLink('localhost:4250/hello')).toBe('http://localhost:4250/hello')
    expect(normalizeLink('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
  })

  it('prefixes https:// onto bare web hosts', () => {
    expect(normalizeLink('www.google.com')).toBe('https://www.google.com')
    expect(normalizeLink('example.com/path?q=1')).toBe('https://example.com/path?q=1')
    expect(normalizeLink('youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
  })

  it('trims whitespace and passes empty through', () => {
    expect(normalizeLink('  example.com  ')).toBe('https://example.com')
    expect(normalizeLink('')).toBe('')
    expect(normalizeLink('   ')).toBe('')
  })
})
