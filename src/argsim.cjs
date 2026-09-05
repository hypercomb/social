const flag = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const KEEP = process.argv.includes('--keep')
const MAX_MB = Number(flag('max', '9.4'))
const asked = process.argv.slice(2).find(a => !a.startsWith('--') && a !== String(MAX_MB))
const stem = asked ? asked.replace(/\.html$/, '').replace(/^hypercomb-/, '') : null
console.log(JSON.stringify(process.argv.slice(2)), '=> MAX_MB=' + MAX_MB, 'KEEP=' + KEEP, 'asked=' + asked, 'stem=' + stem)
