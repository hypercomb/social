#!/usr/bin/env node
// Driver test for the "white overlay on all tiles" fix. Launches a real
// (headed) Chromium against the dev shell and verifies:
//   1. both fixes are compiled into the served bundle
//   2. PATH A: a persisted 'website' view-mode no longer boots into the
//      canvas-hidden white screen — it falls back to hexagons
//   3. the body background (the actual "white wash" signal) is dark, not cream,
//      and forcing data-theme=light reproduces the wash (proving the cause)
// Fresh profile (empty hive) — the fix is data-independent, so that's fine.

const { chromium } = require('playwright')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile')
const BASE = 'http://localhost:4250'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const probe = `(() => {
  const vm = window.ioc && window.ioc.get && window.ioc.get('@hypercomb.social/ViewMode');
  const c = document.querySelector('#pixi-host canvas') || document.querySelector('canvas');
  const cs = c ? getComputedStyle(c) : null;
  return {
    viewMode: vm ? vm.mode : '(no ViewMode)',
    storedViewMode: localStorage.getItem('hc:view-mode'),
    dataTheme: document.documentElement.getAttribute('data-theme'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyClass: document.body.className,
    canvas: c ? (cs.visibility + '/' + cs.display) : 'NO-CANVAS',
  };
})()`

function isCream(rgb){ // light --md-surface is ~ rgb(245,237,224); anything bright = wash
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb||''); if(!m) return false
  const [r,g,b]=[+m[1],+m[2],+m[3]]; return (r+g+b)/3 > 150
}

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1440,height:900} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const errs=[]; page.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)) })
  const shot = async name => { try { await page.screenshot({ path: path.join(__dirname, name), timeout: 8000 }) ; console.log('   shot:', name) } catch(e){ console.log('   (screenshot skipped:', e.message.slice(0,40)+')') } }

  console.log('1) loading', BASE)
  await page.goto(BASE + '/', { waitUntil:'domcontentloaded' })
  await sleep(8000)

  console.log('\n2) FIX COMPILED IN SERVED BUNDLE?')
  const compiled = await page.evaluate(async () => {
    const srcs = [...document.querySelectorAll('script[src]')].map(s=>s.src)
    let vm=false, th=false
    for (const s of srcs){ try { const t = await (await fetch(s)).text(); if(t.includes('TRANSIENT_MODES')) vm=true; if(t.includes('prevTheme')) th=true } catch{} }
    return { scripts: srcs.length, viewModeFix: vm, themeFix: th }
  })
  console.log('   view-mode fix (TRANSIENT_MODES):', compiled.viewModeFix)
  console.log('   site-view theme fix (prevTheme):', compiled.themeFix)

  console.log('\n3) BASELINE (fresh load):')
  const base = await page.evaluate(probe); console.log('  ', JSON.stringify(base))
  console.log('   body is', isCream(base.bodyBg) ? 'CREAM/white (wash!)' : 'dark (ok)')
  await shot('_test-1-baseline.png')

  console.log('\n4) PATH A — persist website mode, reload, expect boot to HEXAGONS:')
  await page.evaluate(() => localStorage.setItem('hc:view-mode','website'))
  await page.reload({ waitUntil:'domcontentloaded' }); await sleep(8000)
  const after = await page.evaluate(probe); console.log('  ', JSON.stringify(after))
  const pathAFixed = after.viewMode === 'hexagons'
  console.log('   => PATH A', pathAFixed ? 'FIXED (booted hexagons despite stored website)' : 'NOT FIXED (still website)')
  console.log('   body is', isCream(after.bodyBg) ? 'CREAM/white (wash!)' : 'dark (ok)')
  await shot('_test-2-after-persist-website.png')

  console.log('\n5) CAUSE DEMO — force data-theme=light (reproduces the cream wash):')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','light')); await sleep(600)
  const light = await page.evaluate(probe); console.log('   bodyBg now:', light.bodyBg, isCream(light.bodyBg)?'(CREAM — this is the wash)':'(not cream)')
  await shot('_test-3-forced-light.png')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','dark')); await sleep(600)
  const dark = await page.evaluate(probe); console.log('   restored dark bodyBg:', dark.bodyBg, isCream(dark.bodyBg)?'(still cream?!)':'(dark — wash gone)')
  await shot('_test-4-restored-dark.png')

  console.log('\nCONSOLE ERRORS:', errs.length ? errs.slice(0,5) : 'none')
  console.log('\n=== VERDICT ===')
  console.log('compiled:', compiled.viewModeFix && compiled.themeFix ? 'BOTH FIXES LIVE' : 'MISSING ('+JSON.stringify(compiled)+')')
  console.log('path A (persistent boot-into-white):', pathAFixed ? 'FIXED' : 'NOT FIXED')
  console.log('theme->bodyBg causal chain:', isCream(light.bodyBg) && !isCream(dark.bodyBg) ? 'confirmed (light=cream, dark=clean)' : 'inconclusive')

  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
