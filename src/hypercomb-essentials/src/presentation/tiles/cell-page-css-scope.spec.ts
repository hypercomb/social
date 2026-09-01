import { describe, expect, it } from 'vitest'
import { scopeCellPageCss } from './cell-page-css-scope.js'

const HOST = '#hc-site-view-host'
const scope = (css: string): string => scopeCellPageCss(css, HOST).replace(/\s+/g, ' ').trim()

describe('scopeCellPageCss', () => {
  it('confines an ordinary rule to the host', () => {
    expect(scope('.card { padding: 1rem }')).toBe('#hc-site-view-host .card { padding: 1rem }')
  })

  it('maps the page roots onto the host — the artifact IS the page root', () => {
    expect(scope('body { background: #fff }')).toBe('#hc-site-view-host { background: #fff }')
    expect(scope('html { color: red }')).toBe('#hc-site-view-host { color: red }')
    expect(scope(':root { --bg: #000 }')).toBe('#hc-site-view-host { --bg: #000 }')
    expect(scope('html, body { margin: 0 }')).toBe('#hc-site-view-host, #hc-site-view-host { margin: 0 }')
  })

  it('keeps what is attached to a root compound, so mirrored classes still match', () => {
    expect(scope('body.dark .card { color: #eee }'))
      .toBe('#hc-site-view-host.dark .card { color: #eee }')
    expect(scope('html[data-theme="light"] a { color: #06c }'))
      .toBe('#hc-site-view-host[data-theme="light"] a { color: #06c }')
  })

  it('collapses a chained root pair — html and body are the same element here', () => {
    expect(scope('html body .x { color: red }')).toBe('#hc-site-view-host .x { color: red }')
    expect(scope('html > body { margin: 0 }')).toBe('#hc-site-view-host { margin: 0 }')
  })

  it('merges qualifiers across the collapse — the dark-mode pattern', () => {
    expect(scope('html.dark body { background: #10131a }'))
      .toBe('#hc-site-view-host.dark { background: #10131a }')
    expect(scope('html[data-theme="dark"] body .card { color: #eee }'))
      .toBe('#hc-site-view-host[data-theme="dark"] .card { color: #eee }')
    expect(scope('body.dark, html.dark body { color: #eee }'))
      .toBe('#hc-site-view-host.dark, #hc-site-view-host.dark { color: #eee }')
  })

  it('does not mistake a class or element that merely starts with a root name', () => {
    expect(scope('.bodycopy { color: red }')).toBe('#hc-site-view-host .bodycopy { color: red }')
    expect(scope('body-note { color: red }')).toBe('#hc-site-view-host body-note { color: red }')
  })

  it('splits a selector list without breaking on commas inside :is()/:not()', () => {
    expect(scope(':is(h1, h2) span { margin: 0 }'))
      .toBe('#hc-site-view-host :is(h1, h2) span { margin: 0 }')
  })

  it('recurses into conditional groups', () => {
    expect(scope('@media (min-width: 40em) { .card { display: grid } }'))
      .toBe('@media (min-width: 40em) { #hc-site-view-host .card { display: grid } }')
    expect(scope('@supports (display: grid) { body { display: grid } }'))
      .toBe('@supports (display: grid) { #hc-site-view-host { display: grid } }')
  })

  it('leaves describing at-rules alone', () => {
    expect(scope('@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }'))
      .toBe('@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }')
    expect(scope('@font-face { font-family: X; src: url(x.woff2) }'))
      .toBe('@font-face { font-family: X; src: url(x.woff2) }')
  })

  it('passes statement at-rules through in place', () => {
    expect(scope('@import url("x.css"); .a { color: red }'))
      .toBe('@import url("x.css"); #hc-site-view-host .a { color: red }')
  })

  it('never treats braces or commas inside strings and comments as structure', () => {
    expect(scope('.a::after { content: "}" } /* .b { x } */ .c { color: red }'))
      .toBe('#hc-site-view-host .a::after { content: "}" } /* .b { x } */ #hc-site-view-host .c { color: red }')
  })

  it('is a no-op on empty input', () => {
    expect(scopeCellPageCss('', HOST)).toBe('')
  })
})
