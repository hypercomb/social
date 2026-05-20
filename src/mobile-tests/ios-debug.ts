import { remote } from 'webdriverio'
import { writeFileSync } from 'fs'

const username = process.env['LT_USERNAME']
const accessKey = process.env['LT_ACCESS_KEY']

if (!username || !accessKey) {
  console.error('Set LT_USERNAME and LT_ACCESS_KEY env vars first')
  process.exit(1)
}

// Target: iOS 26 (matches real device iOS 26.4.2 where SAH concurrency OOM occurs).
// If LambdaTest doesn't have iOS 26 yet, change platformVersion to '18'.
console.log('Connecting to LambdaTest — starting iPhone 16 iOS 26 Safari session...')

const driver = await remote({
  hostname: 'mobile-hub.lambdatest.com',
  port: 443,
  path: '/wd/hub',
  protocol: 'https',
  logLevel: 'warn',
  capabilities: {
    platformName: 'iOS',
    'appium:deviceName': 'iPhone 16',
    'appium:platformVersion': '26',
    browserName: 'Safari',
    'lt:options': {
      username,
      accessKey,
      build: 'Mobile Debug',
      name: 'iOS Safari Crash Investigation',
      network: true,
      console: true,
      w3c: true,
    },
  },
})

try {
  console.log('Session started. Navigating to playground.hypercomb.io...')
  await driver.url('https://playground.hypercomb.io')

  console.log('Waiting 20s for page to load or crash...')
  await driver.pause(20000)

  const title = await driver.getTitle().catch(() => '(could not get title — page may have crashed)')
  console.log('Page title:', title)

  // Screenshot the install screen so we can see the UI
  const screenshotBefore = await driver.takeScreenshot()
  writeFileSync('screenshot-before.png', screenshotBefore, 'base64')
  console.log('Screenshot saved: screenshot-before.png')

  // Step 1: click the install button on playground.hypercomb.io
  console.log('\nLooking for install button...')
  let clicked = false
  for (const selector of ['[data-install]', 'button*=Install', 'a*=Install', 'button*=install', 'a*=install']) {
    try {
      const el = await driver.$(selector)
      if (await el.isDisplayed()) {
        await el.click()
        console.log(`Clicked: ${selector}`)
        clicked = true
        break
      }
    } catch { /* try next */ }
  }
  if (!clicked) console.log('Could not find install button — check screenshot-before.png')

  // Step 2: wait for redirect to DCP domain
  await driver.pause(5000)
  const urlAfterInstall = await driver.getUrl()
  console.log('URL after install click:', urlAfterInstall)

  const screenshotDcp = await driver.takeScreenshot()
  writeFileSync('screenshot-dcp.png', screenshotDcp, 'base64')
  console.log('Screenshot saved: screenshot-dcp.png')

  // Step 3: if on DCP domain, click through install there
  if (urlAfterInstall.includes('dcp.')) {
    console.log('On DCP domain. Looking for install/confirm button...')
    for (const selector of ['button*=Install', 'a*=Install', 'button*=Confirm', 'button*=Continue', '[data-install]']) {
      try {
        const el = await driver.$(selector)
        if (await el.isDisplayed()) {
          await el.click()
          console.log(`Clicked DCP: ${selector}`)
          break
        }
      } catch { /* try next */ }
    }
  }

  // Step 4: wait for redirect back to hypercomb and drones to load
  console.log('\nWaiting 30s for install + redirect + drone initialization...')
  await driver.pause(30000)

  const urlFinal = await driver.getUrl()
  const titleFinal = await driver.getTitle().catch(() => '(page may have crashed)')
  console.log('Final URL:', urlFinal)
  console.log('Final title:', titleFinal)

  const screenshotFinal = await driver.takeScreenshot()
  writeFileSync('screenshot-final.png', screenshotFinal, 'base64')
  console.log('Screenshot saved: screenshot-final.png')

  // Collect all logs accumulated during the session
  const logs = await driver.getLogs('safariConsole').catch(() => [])
  if (logs.length === 0) {
    console.log('No Safari console logs captured.')
  } else {
    console.log('\n=== Safari Console Logs ===')
    for (const entry of logs as any[]) {
      const parsed = (() => { try { return JSON.parse(entry.message) } catch { return null } })()
      const text = parsed?.text ?? entry.message
      const level = parsed?.level ?? entry.level
      if (['error', 'warning'].includes(level) || level === 'SEVERE' || level === 'WARNING') {
        console.log(`[${level}] ${text}`)
      }
    }
    console.log('\n--- All logs ---')
    for (const entry of logs as any[]) {
      const parsed = (() => { try { return JSON.parse(entry.message) } catch { return null } })()
      console.log(`[${parsed?.level ?? entry.level}] ${parsed?.text ?? entry.message}`)
    }
  }

  const crashLogs = await driver.getLogs('crashlog').catch(() => [])
  if (crashLogs.length > 0) {
    console.log('\n=== Crash Logs ===')
    for (const entry of crashLogs as any[]) {
      console.log(entry.message)
    }
  }
} catch (err) {
  console.error('Session error:', err)
} finally {
  console.log('\nClosing session...')
  await driver.deleteSession()
}
