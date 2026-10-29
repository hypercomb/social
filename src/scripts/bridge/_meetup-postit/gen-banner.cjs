// Generate the Meetup invite banner from the current Hypercomb hive collage.
// The same source image is used for both the listing cover and the page hero.
const fs = require('fs')
const path = require('path')
const { chromium } = require('C:/Projects/hypercomb/social/src/node_modules/playwright')

const ASSETS = __dirname
const SOURCE = path.join(__dirname, '..', '_meetups-site', 'hero.webp')
const PAGE = path.join(ASSETS, 'meetup-page.html')
const PNG = path.join(ASSETS, 'meetup-banner.png')
const JPG = path.join(ASSETS, 'meetup-banner.jpg')
const WIDTH = 1600
const HEIGHT = 896 // matches the collage's 2000×1119 aspect ratio

async function main() {
  const source = fs.readFileSync(SOURCE).toString('base64')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><style>*{margin:0}html,body,img{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}img{object-fit:cover}</style><img src="data:image/webp;base64,${source}">`)
    await page.locator('img').evaluate(img => img.decode())
    await page.screenshot({ path: PNG, type: 'png' })
    await page.screenshot({ path: JPG, type: 'jpeg', quality: 88 })
  } finally {
    await browser.close()
  }

  const html = fs.readFileSync(PAGE, 'utf8')
  const updated = html.replace(/(\.mu-hero\s*\{[^}]*?url\("data:image\/jpeg;base64,)[^"]+(")/s,
    (_, before, after) => before + fs.readFileSync(JPG).toString('base64') + after)
  if (updated === html) throw new Error('Could not find the Meetup hero image in meetup-page.html')
  fs.writeFileSync(PAGE, updated)
  console.log(`Updated ${PNG}, ${JPG}, and embedded hero image in ${PAGE}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
