import { remote } from 'webdriverio'

const username = process.env['LT_USERNAME']
const accessKey = process.env['LT_ACCESS_KEY']

if (!username || !accessKey) {
  console.error('Set LT_USERNAME and LT_ACCESS_KEY env vars first')
  process.exit(1)
}

console.log('Connecting to LambdaTest — starting Android Chrome session...')

const driver = await remote({
  hostname: 'mobile-hub.lambdatest.com',
  port: 443,
  path: '/wd/hub',
  protocol: 'https',
  logLevel: 'warn',
  capabilities: {
    platformName: 'Android',
    'appium:deviceName': 'Galaxy S23',
    'appium:platformVersion': '13',
    browserName: 'Chrome',
    'lt:options': {
      username,
      accessKey,
      build: 'Mobile Debug',
      name: 'Android Camera Button Investigation',
      network: true,
      console: true,
      w3c: true,
    },
  },
})

try {
  console.log('Session started. Navigating to playground.hypercomb.io...')
  await driver.url('https://playground.hypercomb.io')

  console.log('Waiting 15s for page to load...')
  await driver.pause(15000)

  const title = await driver.getTitle().catch(() => '(could not get title)')
  console.log('Page title:', title)

  const logs = await driver.getLogs('browser').catch(() => [])
  if (logs.length === 0) {
    console.log('No browser logs captured.')
  } else {
    console.log('\n=== Browser Console Logs ===')
    for (const entry of logs as any[]) {
      console.log(`[${entry.level}] ${entry.message}`)
    }
  }
} catch (err) {
  console.error('Session error:', err)
} finally {
  console.log('\nClosing session...')
  await driver.deleteSession()
}
