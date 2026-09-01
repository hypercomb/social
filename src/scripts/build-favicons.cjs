// Builds the favicon set from one master SVG and installs it into every shell.
//
//   node scripts/build-favicons.cjs           # build + install
//
// Rasterises with the Playwright Chromium already in the repo — no native
// image toolchain, and the PNG is exactly what a browser would paint.
//
// The mark: a solid gold hexagon with the H knocked OUT to transparency, lit
// by a rim highlight along the top facet. The solid mass is what makes it hold
// at 16px where an outline would dissolve, and letting the tab's own colour
// fill the H means one file reads on both light and dark chrome.
//
// Two renderings of it:
//
//   TAB    the hexagon filling the frame, H transparent — favicon.ico / *.png.
//   TILE   the same hexagon inset on the splash's radial near-black, so the H
//          reads dark. Home-screen and PWA surfaces composite transparency
//          unpredictably (iOS flattens onto black or white) and Android may
//          crop a maskable icon to a circle, so this one is opaque and the art
//          sits inside the 80%-diameter safe zone.
const fs = require('fs'), path = require('path')
const { chromium } = require('playwright')

const REPO = path.resolve(__dirname, '..')
const SHELLS = ['hypercomb-web/public', 'hypercomb-shim/public', 'hypercomb-dev/public']

// userSpaceOnUse, NOT the default objectBoundingBox: the fill and the rim
// stroke are separate elements, and per-object gradients would each restart
// the ramp and break the light direction. One shared space, one ramp.
const GOLD = `<linearGradient id="g" gradientUnits="userSpaceOnUse"
      x1="6" y1="1" x2="26" y2="31">
    <stop offset="0" stop-color="#ffe08a"/><stop offset=".42" stop-color="#f8b73a"/>
    <stop offset="1" stop-color="#d9860b"/></linearGradient>
  <linearGradient id="r" gradientUnits="userSpaceOnUse" x1="16" y1="1" x2="16" y2="17">
    <stop offset="0" stop-color="#fff6d8" stop-opacity=".95"/>
    <stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></linearGradient>`

// Pointy-top hexagon, inset so the rounded stroke stays inside the viewBox.
const HEX = '16,1.2 28.6,8.6 28.6,23.4 16,30.8 3.4,23.4 3.4,8.6'

// The H as a mask — white keeps, black cuts it to transparency.
const HMASK = `<mask id="h">
    <polygon points="${HEX}" fill="#fff"/>
    <g fill="#000">
      <rect x="9.7" y="8.6" width="4.1" height="14.8" rx=".5"/>
      <rect x="18.2" y="8.6" width="4.1" height="14.8" rx=".5"/>
      <rect x="9.7" y="14.3" width="12.6" height="3.4"/>
    </g></mask>`

// Solid gold body, then a rim light along the top facet. Both masked, so the
// H stays open through the highlight too.
const MARK = `<polygon points="${HEX}" fill="url(#g)" stroke="url(#g)"
             stroke-width="1.6" stroke-linejoin="round" mask="url(#h)"/>
  <polygon points="${HEX}" fill="none" stroke="url(#r)"
             stroke-width="1.1" stroke-linejoin="round" mask="url(#h)"/>`

const TAB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Hypercomb">
  <defs>${GOLD}${HMASK}</defs>
  ${MARK}
</svg>`

// 0.62 scale keeps the art inside the 80%-diameter circle Android may crop a
// maskable icon to; the radial field is the splash's own background, which is
// also what shows through the H.
const TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Hypercomb">
  <defs>${GOLD}${HMASK}
    <radialGradient id="bg" cx=".5" cy=".42" r=".9">
      <stop offset="0" stop-color="#0c1018"/><stop offset=".6" stop-color="#05060a"/>
      <stop offset="1" stop-color="#030409"/></radialGradient></defs>
  <rect width="32" height="32" fill="url(#bg)"/>
  <g transform="translate(16 16) scale(.62) translate(-16 -16)">
    ${MARK}
  </g>
</svg>`

// ── minimal ICO writer: an .ico is a header plus embedded PNGs ──────────
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2)          // reserved, type=icon
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  for (let i = 0; i < pngs.length; i++) {
    const { size, buf } = pngs[i], e = 6 + 16 * i
    head[e] = size >= 256 ? 0 : size                           // 0 means 256
    head[e + 1] = size >= 256 ? 0 : size
    head[e + 2] = 0; head[e + 3] = 0
    head.writeUInt16LE(1, e + 4)                               // colour planes
    head.writeUInt16LE(32, e + 6)                              // bits per pixel
    head.writeUInt32LE(buf.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += buf.length
  }
  return Buffer.concat([head, ...pngs.map(p => p.buf)])
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  async function raster(svg, size) {
    await page.setViewportSize({ width: size, height: size })
    // deviceScaleFactor is 1 and the viewport IS the size, so the screenshot
    // is a pixel-exact render at the requested dimension.
    await page.setContent(
      `<body style="margin:0;background:transparent">` +
      svg.replace('width="32" height="32"', `width="${size}" height="${size}"`),
      { waitUntil: 'load' })
    return await page.screenshot({ omitBackground: true })
  }

  const tab = {}, tile = {}
  for (const s of [16, 32, 48, 64]) tab[s] = await raster(TAB_SVG, s)
  for (const s of [180, 192, 512]) tile[s] = await raster(TILE_SVG, s)
  await browser.close()

  const icoBuf = ico([16, 32, 48].map(size => ({ size, buf: tab[size] })))

  for (const shell of SHELLS) {
    const dir = path.join(REPO, shell)
    if (!fs.existsSync(dir)) { console.log(`skip   ${shell} (no such dir)`); continue }
    const put = (name, buf) => {
      fs.writeFileSync(path.join(dir, name), buf)
      console.log(`  ${shell}/${name}  ${(buf.length / 1024).toFixed(1)}K`)
    }
    put('favicon.svg', Buffer.from(TAB_SVG))
    put('favicon.ico', icoBuf)
    put('favicon-16.png', tab[16])
    put('favicon-32.png', tab[32])
    put('favicon-48.png', tab[48])
    put('apple-touch-icon.png', tile[180])
    put('icon-192.png', tile[192])
    put('icon-512.png', tile[512])
    // icon.svg is referenced by the existing manifests — keep it, now amber.
    put('icon.svg', Buffer.from(TILE_SVG))
  }
})().catch(e => { console.error(e); process.exit(1) })
