// hypercomb-shim/src/host-panel.ts
//
// THE ONLY SURFACE THE SHIM OWNS. One card is every host's front door:
// the mark, the host's name, its public creation pool, and a way to add a
// chosen implementation. An operator may stage a title, sentence, and links.
// That is the whole interaction, deliberately:
// every other panel in the system arrives as a behaviour, through the very
// package this card replicates.
//
// It appears before adopted code loads. A hive that already holds a package
// lets its surface take over after the first pulse; the card remains available
// at /hosts and /@hypercomb. On an empty origin it is also the website.
//
// Framework-free by necessity, not taste. This runs BEFORE any bee exists, so
// there is nothing to render with but the DOM.

import { addHostZone, hostZone, listHostZones, removeHostZone } from './hosts'
import { hostRouteName } from '@hypercomb/runtime/host-activation'
import { askHostPackages } from '@hypercomb/runtime/host-packages'
import { acquire, installPackage, installedPackageSig, type HostPackage, type InstallOutcome } from './replicate'
import { frontDoorOf, readWelcome, type FrontDoor, type Welcome, type WelcomeLink } from './welcome'
import { addOffering, addPublicCreation, clearPendingSelection, listActiveOfferings,
  listActivePublicCreations, listAdoptions, listPendingSelections, stagePendingSelection, stagePendingCreation,
  listRevisionCandidates, publicCreationOrigin, readOfferings, readPublicCreations, rememberRevisionCandidate,
  rememberPublicCreationCandidate,
  turnOffOffering, turnOffPublicCreation,
  type ActiveOffering, type ActivePublicCreation, type Adoption, type Offering, type PublicCreation,
  type PendingSelection, type ReplicationProgress } from './offerings'

const STYLE = `
:host { all: initial }
.card {
  box-sizing: border-box; position: fixed; inset: 0; z-index: 2147483100;
  display: grid; place-items: start center; overflow: auto;
  background: radial-gradient(ellipse 75% 40% at 84% 0%, color-mix(in srgb, var(--md-primary) 9%, transparent), transparent 80%),
    linear-gradient(180deg, var(--md-surface-c-low), var(--md-surface) 25%, var(--md-surface));
  font: 14px/1.55 var(--md-font-ui, Inter, system-ui, sans-serif); color: var(--md-on-surface);
  color-scheme: var(--md-color-scheme);
}
/* A front door is taller than the viewport, and a grid that centres taller
   content clips its top where it cannot be scrolled back — so it starts at
   the top, with the brand's own margin as the breathing room. */
.panel { box-sizing: border-box; width: min(76rem, calc(100vw - 3rem)); margin: clamp(2rem, 5vh, 4.5rem) 0 5rem; }
h1 { margin: 0 0 .35rem; font-size: 1.2rem; font-weight: 600; color: var(--md-on-surface-strong); }
p.lede { margin: 0 0 1.25rem; color: var(--md-on-surface-var); }

/* the front door — the mark, the name, and what this is */
.brand { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr); column-gap: 1.1rem; align-items: center; margin-bottom: clamp(3rem, 7vh, 5.5rem); }
.brand svg { width: 3.1rem; height: 3.1rem; color: var(--md-primary); grid-row: span 2; }
.brand h1 {
  margin: 0; font-size: clamp(1.25rem, 3vw, 1.65rem); font-weight: 650;
  letter-spacing: -.035em; color: var(--md-on-surface-strong); overflow-wrap: anywhere;
}
.brand p { max-width: 39rem; margin: -.15rem 0 0; color: var(--md-on-surface-var); font-size: .84rem; line-height: 1.45; }

/* section headings, and the label above the directory */
.lbl {
  margin: 0 0 .75rem; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px; font-weight: 500; letter-spacing: .28em; text-transform: uppercase; color: var(--md-on-surface-faint);
}
section { margin-bottom: 2rem; }
.panel > section:last-of-type { margin-bottom: 0; }

/* chips: the places this origin sends you. A grid rather than a wrapping row —
   the directory is a list of equals and reads as one when the columns line up. */
.chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: .5rem; }
.chips.wide { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
a.chip {
  display: flex; flex-direction: column; gap: .15rem; min-width: 0;
  padding: .6rem .85rem; text-decoration: none;
  border: 1px solid var(--md-outline); border-radius: var(--md-shape-s);
  transition: border-color .2s, background .2s;
}
a.chip b { font-weight: 500; color: var(--md-on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a.chip b i { font-style: normal; margin-left: .35em; color: var(--md-on-surface-faint); }
a.chip span {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .78em;
  color: var(--md-on-surface-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
a.chip:hover { border-color: var(--md-primary); background: var(--md-surface-c-low); }
a.chip:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
a.chip.lead { border-color: var(--md-primary); background: var(--md-primary-container); }
a.chip.lead b { color: var(--md-on-primary-c); }
a.chip.lead:hover { background: var(--md-surface-c-high); }
a.chip.lead:focus-visible { outline-color: var(--md-primary); }

form { display: flex; gap: .5rem; }
input {
  flex: 1; box-sizing: border-box; min-width: 0; padding: .78rem 1rem; color: var(--md-on-surface);
  background: var(--md-surface-c-lowest); border: 1px solid var(--md-outline-variant); border-radius: .7rem;
  font: inherit;
}
input:focus { outline: 2px solid var(--md-primary); outline-offset: 1px; }
button {
  padding: .68rem .95rem; font: inherit; color: var(--md-on-surface); cursor: pointer;
  background: var(--md-surface-c-high); border: 1px solid var(--md-outline-variant);
  border-radius: .65rem; transition: background .18s, border-color .18s, transform .18s;
}
button:hover:not(:disabled) { background: var(--md-surface-c-highest); border-color: var(--md-outline); }
button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: .75rem; padding: .55rem .75rem; border-top: 1px solid var(--md-outline-variant); }
.status { min-height: 1.4em; margin: 1rem 0 0; color: var(--md-on-surface-var); }
.status[data-tone="bad"] { color: var(--hc-status-alert); }
.status[data-tone="good"] { color: var(--hc-status-ok); }
.gallery-head { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--md-outline-variant); }
.gallery-head h2 { margin: 0; color: var(--md-on-surface-strong); font: 500 clamp(2.7rem, 7vw, 4.5rem)/1.05 'Source Serif 4', Georgia, serif; letter-spacing: -.055em; }
.gallery-search { display: block; width: 100%; margin: 0 0 .75rem; padding: 1rem 1.15rem; font-size: 1.02rem; box-shadow: var(--md-elev-1); }
.gallery-search::placeholder { color: var(--md-on-surface-faint); }
.source-filter { margin: 0 0 .25rem; border: 1px solid var(--md-outline-variant); border-radius: .85rem; background: var(--md-surface-c-low); }
.source-filter > summary { display: flex; align-items: center; gap: .7rem; padding: .7rem 1rem; cursor: pointer; list-style: none; color: var(--md-on-surface-strong); font-weight: 600; }
.source-filter > summary::-webkit-details-marker { display: none; }
.source-filter > summary::after { content: '⌄'; margin-left: auto; font-size: 1.15rem; color: var(--md-on-surface-var); transition: transform .18s; }
.source-filter[open] > summary::after { transform: rotate(180deg); }
.source-filter > summary small { color: var(--md-on-surface-faint); font-size: .78rem; font-weight: 400; }
.source-search { display: block; width: calc(100% - 2rem); margin: .25rem 1rem .7rem; }
.domain-list { display: grid; gap: .4rem; margin: 0 1rem .5rem; max-height: 15rem; overflow: auto; }
.domain-row { display: flex; align-items: center; gap: .55rem; min-width: 0; padding: .45rem .55rem; border: 1px solid var(--md-outline-variant); border-radius: .6rem; background: var(--md-surface-c-lowest); }
.domain-row[data-pinned='true'] { border-color: color-mix(in srgb, var(--md-primary) 50%, var(--md-outline-variant)); }
.domain-row .domain-link { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-strong); font-weight: 600; text-decoration: none; }
.domain-row .domain-link:hover { color: var(--md-primary); text-decoration: underline; }
.domain-row .domain-link:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.domain-row span { color: var(--md-on-surface-var); font-size: .8rem; }
.domain-row button { padding: .25rem .55rem; font-size: .78rem; }
.domain-row .source-remove { color: var(--md-on-surface-faint); background: transparent; border-color: transparent; }
.source-note { margin: .25rem 1rem .6rem; color: var(--md-on-surface-faint); font-size: .78rem; }
.gallery-count { color: var(--md-on-surface-var); font-size: .82rem; margin: .9rem 0 1.1rem; }
.update-mark { color: var(--hc-status-ok) !important; font-weight: 600; }
.gallery-more { display: block; margin: 1.5rem auto 0; }
.gallery-more[hidden] { display: none; }
.offer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr)); gap: 1.15rem; align-items: stretch; }
.offer { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--md-outline-variant); border-radius: 1.05rem; background: var(--md-surface-c-low); overflow: hidden; box-shadow: var(--md-elev-1); transition: transform .2s, border-color .2s, box-shadow .2s; }
.offer[hidden] { display: none; }
.offer:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--md-primary) 55%, var(--md-outline-variant)); box-shadow: var(--md-elev-2); }
.offer:focus-within { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.offer-main { display: flex; flex: 1; flex-direction: column; width: 100%; padding: 0; color: var(--md-on-surface); text-decoration: none; }
.offer-main[type='button'] { text-align: left; border: 0; border-radius: 0; background: transparent; }
.offer-main[type='button']:hover { background: transparent; }
.offer-art { position: relative; display: grid; place-items: center; width: 100%; min-height: 11rem; overflow: hidden; isolation: isolate;
  background: radial-gradient(circle at 75% 30%, hsl(var(--art-hue) 48% 38% / .38), transparent 48%),
    linear-gradient(145deg, hsl(var(--art-hue) 28% 23%), hsl(var(--art-hue) 38% 11%));
  color: hsl(var(--art-hue) 58% 82%); }
.offer-art::before, .offer-art::after { content: ''; position: absolute; width: 9rem; height: 9rem; border: 1px solid currentColor; opacity: .12;
  clip-path: polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%); background: currentColor; transform: rotate(30deg); }
.offer-art::before { left: -2rem; bottom: -4.5rem; }
.offer-art::after { right: -1rem; top: -5rem; width: 13rem; height: 13rem; opacity: .07; }
.art-kind { position: absolute; top: .85rem; left: 1rem; z-index: 1; font: 600 .62rem/1.4 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .18em; }
.art-monogram { position: relative; z-index: 1; font: 400 5.5rem/.8 'Source Serif 4', Georgia, serif; text-shadow: 0 .3rem 1.4rem hsl(var(--art-hue) 65% 5% / .22); }
.offer-copy { display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: .35rem; min-width: 0; padding: 1rem 1.15rem 1.2rem; }
.offer-main b { color: var(--md-on-surface-strong); font-size: 1.15rem; font-weight: 650; line-height: 1.25; letter-spacing: -.025em; }
.offer-main .offer-copy > span { color: var(--md-on-surface-var); font-size: .78rem; overflow-wrap: anywhere; }
.offer-main .offer-copy .offer-visit { margin-top: .45rem; color: var(--md-primary); font-weight: 600; }
.offer-main em { font-style: normal; color: var(--hc-status-ok); font-size: .85rem; }
.offer-update { display: block; margin: 0 1rem 1rem; padding: .55rem .75rem; border: 1px solid var(--md-primary); border-radius: .6rem;
  background: var(--md-primary-container); color: var(--md-on-primary-c); font: 600 .78rem/1.4 var(--md-font-ui, Inter, system-ui, sans-serif);
  text-align: left; text-decoration: none; }
.offer-update:hover { background: var(--md-surface-c-high); color: var(--md-primary); }
.offer-select { margin: 0 1rem 1rem; color: var(--md-on-primary); background: var(--md-primary); border-color: var(--md-primary); font-weight: 700; }
.offer-select:hover { background: var(--md-primary-container); color: var(--md-on-primary-c); }
.offer-select[aria-pressed='true'] { color: var(--md-on-surface); background: var(--md-surface-c-high); }
.selection-return { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 0 0 1.2rem; padding: .85rem 1rem; border: 1px solid var(--md-primary); border-radius: var(--md-shape-s); background: var(--md-primary-container); color: var(--md-on-primary-c); }
.selection-return a { color: var(--md-on-primary-c); font-weight: 700; }
.offer-routes { display: flex; flex-wrap: wrap; gap: .35rem; padding: 0 1rem .75rem; }
.offer-routes a { padding: .2rem .45rem; border: 1px solid var(--md-outline); border-radius: var(--md-shape-xs); color: var(--md-on-surface); font-size: .75rem; text-decoration: none; }
.offer-routes a:hover { border-color: var(--md-primary); color: var(--md-primary); }
.offer-details { padding: .7rem 1.1rem; border-top: 1px solid var(--md-outline-variant); }
.offer-details summary { cursor: pointer; color: var(--md-on-surface-var); font-size: .78rem; }
.offer-details code { display: block; margin: .5rem 0; overflow-wrap: anywhere; color: var(--md-on-surface-var); font-size: .75rem; }
.offer-files { display: flex; gap: 1rem; margin: .5rem 0 .8rem; }
.offer-files a { color: var(--md-primary); font-size: .8rem; }
.offer-details button { width: 100%; }
.offer-details > a { display: block; padding: .5rem .65rem; border: 1px solid var(--md-outline); border-radius: var(--md-shape-xs); color: var(--md-on-surface); background: var(--md-surface-c-high); text-align: center; text-decoration: none; }
.offer-details > a:hover { border-color: var(--md-primary); color: var(--md-primary); }
.review { margin-bottom: 2rem; padding: clamp(1rem, 3vw, 1.7rem); border: 1px solid var(--md-outline-variant); border-radius: 1rem; background: var(--md-surface-c-low); }
.review h2 { margin: 0 0 1rem; font: 500 clamp(1.45rem, 3vw, 1.9rem)/1.2 'Source Serif 4', Georgia, serif; color: var(--md-on-surface-strong); }
.review p { margin: .35rem 0; color: var(--md-on-surface-var); }
.review code { display: block; margin: .6rem 0; overflow-wrap: anywhere; color: var(--md-on-surface-var); font-size: .75rem; }
.review a { color: var(--md-primary); }
.review button { margin-top: .8rem; }
.review-actions { display: flex; gap: .6rem; margin: .7rem 0 1rem; }
.review-actions button { margin-top: 0; color: var(--md-on-primary); background: var(--md-primary); border-color: var(--md-primary); font-weight: 650; }
.pending-tile { padding: 1rem 0; border-top: 1px solid var(--md-outline-variant); }
.pending-tile h3 { margin: 0; color: var(--md-on-surface-strong); font-size: 1rem; }
.pending-tile .pending-revision { margin: .35rem 0; font-size: .82rem; }
.pending-proof { margin: .5rem 0; color: var(--md-on-surface-var); font-size: .78rem; }
.pending-proof summary { cursor: pointer; }
.pending-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem 1rem; }
.pending-actions button { margin-top: 0; }
.source-form { margin: .8rem 1rem 1rem; }
.status { margin: .2rem 1rem 1rem; }
.gallery-empty { border-style: dashed; box-shadow: none; }
.gallery-empty:hover { transform: none; border-color: var(--md-outline-variant); box-shadow: none; }
.gallery-empty .offer-art { min-height: 11rem; filter: saturate(.55); }
.gallery-empty .art-monogram { opacity: .65; }
.gallery-empty .offer-copy { min-height: 6.5rem; }
.gallery-empty .offer-copy b { color: var(--md-on-surface-strong); font-size: 1.12rem; }
.gallery-empty .offer-copy span { color: var(--md-on-surface-var); font-size: .78rem; }
.gallery-empty button { margin: 0 1rem 1rem; }
.gallery-empty.secondary { opacity: .58; pointer-events: none; }
.technical { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--md-outline-variant); }
.technical > summary { cursor: pointer; color: var(--md-on-surface-var); }
.deployments { display: grid; gap: .75rem; margin-top: 1rem; }
.deployment { padding: .8rem 1rem; border: 1px solid var(--md-outline); border-radius: var(--md-shape-s); background: var(--md-surface-c-low); }
.deployment h3 { margin: 0; color: var(--md-on-surface-strong); }
.deployment p { margin: .35rem 0; color: var(--md-on-surface-var); }
.deployment a { color: var(--md-primary); }
.deployment details { margin-top: .6rem; }
.deployment summary { cursor: pointer; }

/* package replication — what this hive runs, and where to take another from */
.packages .revision { display: grid; gap: .25rem; margin: 0 0 1rem; color: var(--md-on-surface-var); font-size: .84rem; }
.packages .revision code { overflow-wrap: anywhere; color: var(--md-on-surface-strong); font-size: .78rem; }
.host { margin: 0 0 .9rem; border: 1px solid var(--md-outline-variant); border-radius: .85rem; background: var(--md-surface-c-low); overflow: hidden; }
.host > header { display: flex; align-items: center; gap: .6rem; padding: .6rem .9rem; }
.host .zone { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-strong); font-weight: 600; }
.host .tag { color: var(--md-on-surface-faint); font-size: .75rem; }
.host .body { padding: 0 .9rem .8rem; }
.host .body > .lbl { margin: .2rem 0 .4rem; }
.host li { flex-wrap: wrap; padding: .55rem 0; }
.host .label { display: grid; flex: 1; min-width: 0; }
.host .label b { color: var(--md-on-surface-strong); font-weight: 600; }
.host .label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-var); font-size: .78rem; }
.muted { margin: .2rem 0; color: var(--md-on-surface-faint); font-size: .82rem; }
.history { margin-top: .4rem; }
.history summary, .more-hosts > summary { cursor: pointer; color: var(--md-on-surface-var); font-size: .82rem; }
.history details { margin: .3rem 0 0 .6rem; }
.more-hosts { margin-top: .4rem; }
.more-hosts > div { margin-top: .8rem; }
.more-hosts form { margin: .6rem 0 0; }
/* a replication moving: the bar under the row, the count under the bar */
.replication { flex-basis: 100%; margin: .45rem 0 0; }
.replication-track { display: block; position: relative; height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--md-primary) 14%, transparent); }
.replication-fill { display: block; width: 0; height: 100%; background: var(--md-primary); transition: width .2s ease-out; }
.replication.indeterminate .replication-fill { width: 30%; animation: replication-slide 1.2s ease-in-out infinite; }
.replication.done .replication-fill { background: var(--hc-status-ok); }
.replication-count { display: block; margin-top: .3rem; color: var(--md-on-surface-var); font-size: .75rem; font-variant-numeric: tabular-nums; }
@keyframes replication-slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }

/* the footer — where the platform explains itself, on every host */
footer {
  display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1.1rem;
  margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--md-outline-variant);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11px;
  letter-spacing: .12em; color: var(--md-on-surface-faint);
}
footer .made { display: inline-flex; align-items: center; gap: .45rem; margin-right: auto; }
footer .made svg { width: 1rem; height: 1rem; color: var(--md-primary); }
footer a { color: var(--md-on-surface-var); text-decoration: none; border-bottom: 1px solid transparent; }
footer a:hover { color: var(--md-primary); border-bottom-color: var(--md-primary); }
footer a:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
@media (max-width: 640px) {
  .panel { width: calc(100vw - 1.5rem); margin: 1.4rem 0 3rem; }
  .brand { grid-template-columns: 2.7rem minmax(0, 1fr); gap: .35rem .7rem; margin-bottom: 2.5rem; }
  .brand svg { width: 2.5rem; height: 2.5rem; }
  .brand p { grid-column: 1 / -1; margin-top: .35rem; }
  .gallery-head h2 { font-size: 2.8rem; }
  .gallery-search { font-size: .92rem; }
  .domain-row { flex-wrap: wrap; }
  .domain-row .domain-link { min-width: 55%; }
  .offer-art { min-height: 10rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .01ms !important; }
  .replication.indeterminate .replication-fill { width: 100%; opacity: .45; animation: none; }
}
`

// The mark, drawn rather than fetched: this card renders before this origin
// holds any content, so it cannot depend on a file it has not got. A constant
// — no data from anywhere reaches this string.
const MARK = '<svg viewBox="-52 -52 104 104" aria-hidden="true" focusable="false">' +
  '<polygon points="50,0 25,43.3 -25,43.3 -50,0 -25,-43.3 25,-43.3" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
  '<polygon points="30,0 15,26 -15,26 -30,0 -15,-26 15,-26" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/>' +
  '<circle r="4" fill="currentColor"/></svg>'

const mark = (): Element => {
  const holder = document.createElement('div')
  holder.innerHTML = MARK
  return holder.firstElementChild ?? holder
}

/** A quiet, deterministic cover for an offering with no published artwork. */
const tileArt = (title: string, kind: string, signature: string): HTMLElement => {
  const art = document.createElement('div')
  art.className = 'offer-art'
  art.style.setProperty('--art-hue', String(170 + (Number.parseInt(signature.slice(0, 2), 16) || 0) % 110))
  const type = document.createElement('span')
  type.className = 'art-kind'
  type.textContent = kind
  const monogram = document.createElement('span')
  monogram.className = 'art-monogram'
  monogram.textContent = title.trim().slice(0, 1).toLocaleUpperCase() || 'H'
  art.append(type, monogram)
  return art
}

/** Empty positions show the tile geometry without inventing an offering. */
const emptyTile = (number: string, title: string, message: string): HTMLElement => {
  const tile = document.createElement('article')
  tile.className = 'offer gallery-empty'
  tile.setAttribute('aria-label', `Empty creation slot ${number}`)
  const art = tileArt(number, 'OPEN SLOT', number === '01' ? '30' : '8f')
  const monogram = art.querySelector('.art-monogram')
  if (monogram) monogram.textContent = number
  const copy = document.createElement('div')
  copy.className = 'offer-copy'
  const name = document.createElement('b')
  name.textContent = title
  const note = document.createElement('span')
  note.textContent = message
  copy.append(name, note)
  tile.append(art, copy)
  return tile
}

/** A module is named `<sig>.js` in one record and `<sig>` in another. */
const bareSig = (sig: string): string => sig.trim().toLowerCase().replace(/\.(?:js|json)$/, '')

/** One replication moving, as a bar and a count. With no known total the bar
 *  says only that files are arriving; it never claims an end it cannot see. */
const replicationMeter = (label: string): { element: HTMLElement; paint(done: number, total: number): void } => {
  const element = document.createElement('div')
  element.className = 'replication indeterminate'
  element.setAttribute('role', 'progressbar')
  element.setAttribute('aria-label', label)
  element.setAttribute('aria-valuemin', '0')
  const track = document.createElement('span')
  track.className = 'replication-track'
  const fill = document.createElement('span')
  fill.className = 'replication-fill'
  track.append(fill)
  const count = document.createElement('span')
  count.className = 'replication-count'
  count.textContent = 'Starting…'
  element.append(track, count)
  const paint = (done: number, total: number): void => {
    const known = total > 0
    const shown = known ? Math.min(done, total) : done
    element.classList.toggle('indeterminate', !known)
    element.classList.toggle('done', known && shown >= total)
    if (known) {
      element.setAttribute('aria-valuemax', String(total))
      element.setAttribute('aria-valuenow', String(shown))
      fill.style.width = `${Math.round(100 * shown / total)}%`
      count.textContent = `${shown} of ${total} files held`
    } else {
      element.removeAttribute('aria-valuemax')
      element.removeAttribute('aria-valuenow')
      fill.style.width = ''
      count.textContent = `${done} file${done === 1 ? '' : 's'} held`
    }
  }
  return { element, paint }
}

type Answer = { packages: HostPackage[]; answered: boolean }

const matchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

const galleryTerms = (query: string): string[] => query.toLowerCase().trim().split(/\s+/).filter(Boolean)

/** A selected host is a root when no other known zone contains it. A signed
 *  offering can still name several route subdomains beneath that root. */
const rootZones = (zones: string[]): string[] => {
  const unique = [...new Set(zones.filter(Boolean))]
  const known = new Set(unique)
  return unique.filter(zone => {
    for (let dot = zone.indexOf('.'); dot >= 0; dot = zone.indexOf('.', dot + 1)) {
      if (known.has(zone.slice(dot + 1))) return false
    }
    return true
  })
}

const rootDoor = (offer: Offering): string => {
  const host = new URL(offer.route).host
  return offer.doors.filter(door => matchesDomain(host, door)).sort((a, b) => a.length - b.length)[0] ?? host
}

/** Keep one-click adoption collision-resistant and name the local destination
 *  before the click. A later route chooser can shorten this suggested label. */
const localRouteFor = (offer: Offering, home: string): string => {
  const native = (window as unknown as { __TAURI__?: unknown }).__TAURI__
  const root = hostRouteName(native ? 'localhost' : home)
  if (!root) return ''
  const source = new URL(offer.route).hostname
  const plain = source.replaceAll('.', '-')
  let hash = 2166136261
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  const label = plain.length <= 63 ? plain : `${plain.slice(0, 54)}-${(hash >>> 0).toString(16).padStart(8, '0')}`
  const route = `${label}.${root}`
  return hostRouteName(route)
}

const visitHref = (route: string, source: string): string => {
  const url = new URL(route)
  const native = (window as unknown as { __TAURI__?: unknown }).__TAURI__
  url.searchParams.set('home', returnHome()?.href ?? (native ? 'hypercomb://offering/' : location.origin))
  url.searchParams.set('source', source)
  return url.href
}

type RemoteSiteChoice = { add: string; publisher: string; lineage: string; head: string }
type RemoteCreationChoice = { kind: 'creation'; publisher: string; meaning: string;
  key: string; location: string; head: string }
type RemoteChoice = RemoteSiteChoice | RemoteCreationChoice
const choiceKey = (choice: RemoteChoice): string => 'kind' in choice
  ? `creation:${choice.publisher}:${choice.meaning}:${choice.key}`
  : `site:${choice.publisher}:${choice.lineage}`
const returnHome = (): URL | null => {
  const raw = new URLSearchParams(location.search).get('home')
  if (!raw) return null
  try {
    const home = new URL(raw)
    if (home.href === 'hypercomb://offering/') return home
    const loopback = home.hostname === 'localhost' || home.hostname.endsWith('.localhost')
    if ((home.protocol !== 'https:' && !(loopback && home.protocol === 'http:'))
      || home.pathname !== '/' || home.search || home.hash || home.username || home.password) return null
    return home
  } catch { return null }
}

const returnHref = (home: URL, source: string, choices: RemoteChoice[]): string => {
  const url = home.protocol === 'hypercomb:' ? new URL(home) : new URL('/hosts', home)
  url.searchParams.set('source', source)
  url.searchParams.set('select', JSON.stringify(choices))
  return url.href
}

const domainVisitHref = (zone: string, self: string): string => {
  const visit = new URL(publicCreationOrigin(zone))
  if (zone !== self) {
    const native = (window as unknown as { __TAURI__?: unknown }).__TAURI__
    visit.searchParams.set('home', native ? 'hypercomb://offering/' : `${location.origin}/`)
  }
  return visit.href
}

/** What a door answered, kept for the life of the card: the origin's own
 *  packages cannot change between two renders of the same page. */
type PendingReview = { selection: PendingSelection; offer: Offering | PublicCreation | null;
  localRoute: string; heldHead: string | null; alreadyOn: boolean }
type NativeReview = { add: string; publisher: string; lineage: string; source: string | null }
  | { select: RemoteChoice[]; source: string }
type NativeReviewBridge = {
  core?: { invoke<T>(command: string): Promise<T> }
  event?: { listen(name: string, listener: () => void): Promise<() => void> }
}

class HostPanelElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: 'open' })
  #busy = false
  /** Undefined until read once; null when this host stages no front door. */
  #welcome: Welcome | null | undefined = undefined
  #handoffAttempted = false
  #reviews: PendingReview[] | null = null
  #reviewSource = ''
  #pending: PendingSelection[] = []
  #nativeUnlisten: (() => void) | null = null
  /** The origin you are standing on, as a zone — `` when it is not one
   *  (a file:// preview, an address with no dots that is not loopback). */
  readonly #self = hostZone(location.host)
  #galleryPins: Set<string> | null = null
  #galleryOffers = new Map<string, Offering[]>()
  #galleryCreations = new Map<string, PublicCreation[]>()
  #galleryQueue: string[] = []
  #galleryPending = new Set<string>()
  #gallerySearchZones = new Set<string>()
  #galleryReaders = 0
  #galleryRefresh: (() => void) | null = null
  #expandedTiles = new Set<string>()
  /** The tile each pending review was drawn in, so its bar lands on it. */
  #reviewTiles = new Map<PendingReview, HTMLElement>()
  #selfAnswer: Promise<Answer> | undefined = undefined
  #refreshOnReturn = (): void => {
    if (!this.isConnected || document.visibilityState === 'hidden') return
    for (const zone of new Set([...(this.#galleryPins ?? []), ...this.#gallerySearchZones])) {
      this.#galleryOffers.delete(zone)
      this.#galleryCreations.delete(zone)
      this.#queueGalleryZone(zone)
    }
    this.#galleryRefresh?.()
  }

  connectedCallback(): void {
    window.addEventListener('focus', this.#refreshOnReturn)
    document.addEventListener('visibilitychange', this.#refreshOnReturn)
    void this.#render()
    void this.#listenNativeReview()
  }

  disconnectedCallback(): void {
    window.removeEventListener('focus', this.#refreshOnReturn)
    document.removeEventListener('visibilitychange', this.#refreshOnReturn)
    this.#nativeUnlisten?.()
    this.#nativeUnlisten = null
  }

  async #listenNativeReview(): Promise<void> {
    const bridge = (window as unknown as { __TAURI__?: NativeReviewBridge }).__TAURI__
    if (!bridge?.core?.invoke || !bridge.event?.listen) return
    const receive = async (): Promise<void> => {
      const review = await bridge.core!.invoke<NativeReview | null>('take_offering_review').catch(() => null)
      if (!review || !this.isConnected) return
      const query = 'select' in review
        ? new URLSearchParams({ select: JSON.stringify(review.select), source: review.source })
        : new URLSearchParams({ add: review.add, publisher: review.publisher, lineage: review.lineage })
      if ('add' in review && review.source) query.set('source', review.source)
      await this.#takeHandoff(query, false)
    }
    const unlisten = await bridge.event.listen('hypercomb:offering-review', () => { void receive() }).catch(() => null)
    if (!unlisten) return
    if (!this.isConnected) { unlisten(); return }
    this.#nativeUnlisten = unlisten
    await receive()
  }

  #say(message: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
    const status = this.#root.querySelector('.status')
    if (!status) return
    status.textContent = message
    status.setAttribute('data-tone', tone)
  }

  async #render(): Promise<void> {
    // The front door is read once per card, not once per render: adding a
    // domain must not re-ask the origin for a file that cannot have changed.
    if (this.#welcome === undefined) this.#welcome = await readWelcome()
    if (!this.isConnected) return
    // Named as the zone it is — `localhost:4270` on a machine, the hostname
    // everywhere else — so the title and the box below it agree.
    const door: FrontDoor = frontDoorOf(this.#welcome, this.#self || location.hostname, location.origin)
    if (!this.isConnected) return
    // The tab is named for the place, not for the shell that drew it.
    document.title = door.title
    const zones = (await listHostZones()).filter(zone => zone !== this.#self)
    if (!this.isConnected) return
    this.#pending = await listPendingSelections().catch(() => [])
    if (!this.isConnected) return
    this.#root.replaceChildren()

    const style = document.createElement('style')
    style.textContent = STYLE

    const card = document.createElement('div')
    card.className = 'card'
    const panel = document.createElement('div')
    panel.className = 'panel'

    const [identity, ...doorLinks] = this.#frontDoor(door)
    panel.append(identity)
    if (this.#reviews?.length) panel.append(this.#reviewSection(this.#reviews))
    panel.append(this.#gallery(rootZones([this.#self, ...zones])))
    panel.append(...doorLinks)
    panel.append(this.#packages(zones))
    const technical = document.createElement('details')
    technical.className = 'technical'
    const summary = document.createElement('summary')
    summary.textContent = 'Deployment tiles and revisions'
    technical.append(summary)
    technical.addEventListener('toggle', () => {
      if (!technical.open || technical.childElementCount > 1) return
      const contents = document.createElement('div')
      contents.className = 'deployments'
      contents.textContent = 'Reading local deployments…'
      technical.append(contents)
      void this.#fillDeploymentDetails(contents)
    })
    panel.append(technical)
    if (door.footer.length > 0) panel.append(this.#footer(door.footer))

    card.append(panel)
    this.#root.append(style, card)
    if (!this.#handoffAttempted && ['add', 'select'].some(key => new URLSearchParams(location.search).has(key))) {
      this.#handoffAttempted = true
      void this.#takeHandoff()
    }
  }

  #frontDoor(door: FrontDoor): HTMLElement[] {
    const parts: HTMLElement[] = []

    const brand = document.createElement('div')
    brand.className = 'brand'
    brand.append(mark())
    const title = document.createElement('h1')
    title.textContent = door.title
    brand.append(title)
    const tagline = document.createElement('p')
    tagline.textContent = door.tagline
    brand.append(tagline)
    parts.push(brand)

    if (door.links.length > 0) {
      const links = document.createElement('section')
      const row = document.createElement('div')
      row.className = 'chips wide'
      // The first link leads: it is the one thing this origin most wants read.
      door.links.forEach((link, index) => row.append(this.#linkChip(link, index === 0)))
      links.append(row)
      parts.push(links)
    }

    return parts
  }

  #reviewSection(reviews: PendingReview[]): HTMLElement {
    this.#reviewTiles.clear()
    const section = document.createElement('section')
    section.className = 'review'
    const heading = document.createElement('h2')
    heading.textContent = `Review ${reviews.length} selected revision${reviews.length === 1 ? '' : 's'} from ${this.#reviewSource}`
    section.append(heading)
    const available = reviews.filter(review => review.offer && (review.alreadyOn
      || 'kind' in review.selection || review.localRoute))
    for (const review of reviews) {
      const tile = document.createElement('article')
      tile.className = 'pending-tile'
      const title = document.createElement('h3')
      title.textContent = review.offer?.title ?? ('kind' in review.selection
        ? review.selection.key : new URL(review.selection.route).host)
      const revision = document.createElement('p')
      revision.className = 'pending-revision'
      revision.textContent = review.heldHead && review.heldHead !== review.selection.head
        ? `${review.heldHead.slice(0, 12)}… → ${review.selection.head.slice(0, 12)}…`
        : review.alreadyOn ? 'This revision is already on here.'
          : `Selected head ${review.selection.head.slice(0, 12)}…`
      const proof = document.createElement('details')
      proof.className = 'pending-proof'
      const proofTitle = document.createElement('summary')
      proofTitle.textContent = 'Signed details'
      const provenance = document.createElement('code')
      provenance.textContent = `Publisher ${review.selection.pubkey}\nHead ${review.selection.head}`
        + ('kind' in review.selection ? `\nMeaning ${review.selection.meaning}\nLocation ${review.selection.location}`
          : `\nLocal route ${review.localRoute || 'unavailable'}`)
      provenance.style.whiteSpace = 'pre-wrap'
      proof.append(proofTitle, provenance)
      const actions = document.createElement('div')
      actions.className = 'pending-actions'
      const visit = document.createElement('a')
      visit.href = 'kind' in review.selection
        ? new URL(`/${review.selection.head}`, publicCreationOrigin(review.selection.source)).href
        : visitHref(review.selection.route, review.selection.source)
      visit.target = '_blank'
      visit.rel = 'noopener'
      visit.textContent = 'Inspect at source'
      const action = document.createElement('button')
      action.type = 'button'
      action.textContent = !review.offer ? 'Dismiss changed tile'
        : review.alreadyOn ? 'Already on · clear selection' : 'Turn on here'
      action.disabled = !!review.offer && !review.alreadyOn
        && !('kind' in review.selection) && !review.localRoute
      action.addEventListener('click', () => { void this.#completePending(review, action) })
      actions.append(visit, action)
      tile.append(title, revision, proof, actions)
      this.#reviewTiles.set(review, tile)
      section.append(tile)
    }
    if (available.length > 1) {
      const actions = document.createElement('div')
      actions.className = 'review-actions'
      const all = document.createElement('button')
      all.type = 'button'
      all.textContent = `Turn on all ${available.length}`
      all.addEventListener('click', () => { void this.#completeAllPending(available, all) })
      actions.append(all)
      section.append(actions)
    }
    return section
  }

  async #openPending(source: string): Promise<void> {
    const selected = this.#pending.filter(row => row.source === source)
    if (!selected.length) return
    const [offers, creations, active, activeCreations] = await Promise.all([
      readOfferings(source).catch(() => []), readPublicCreations(source).catch(() => []),
      listActiveOfferings().catch(() => []), listActivePublicCreations().catch(() => []),
    ])
    this.#reviewSource = source
    this.#reviews = selected.map(selection => {
      if ('kind' in selection) {
        const offer = creations.find(row => row.pubkey === selection.pubkey
          && row.meaning === selection.meaning && row.key === selection.key
          && row.location === selection.location && row.head === selection.head) ?? null
        const live = activeCreations.find(row => row.pubkey === selection.pubkey
          && row.meaning === selection.meaning && row.key === selection.key)
        return { selection, offer, localRoute: '', heldHead: live?.head ?? null,
          alreadyOn: live?.head === selection.head }
      }
      const offer = offers.find(row => row.route === selection.route
        && row.pubkey === selection.pubkey && row.lineage === selection.lineage
        && row.head === selection.head) ?? null
      const live = active.find(row => row.pubkey === selection.pubkey && row.lineage === selection.lineage)
      return { selection, offer, localRoute: live?.localRoute ?? (offer ? localRouteFor(offer, this.#self) : ''),
        heldHead: live?.head ?? null, alreadyOn: live?.head === selection.head }
    })
    await this.#render()
    this.#root.querySelector('.review')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  async #completePending(review: PendingReview, button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    button.disabled = true
    button.textContent = review.offer ? 'Verifying revision…' : 'Dismissing changed tile…'
    const ok = await this.#commitPending(review, true, this.#meterFor(review))
    if (!ok) {
      this.#busy = false
      button.disabled = false
      button.textContent = 'Try again'
      this.#say('The selected tile could not be verified or installed. It remains pending.', 'bad')
      return
    }
    await this.#refreshPendingReview(review.selection.source)
    this.#busy = false
    this.#say(review.offer ? `${review.offer.title} is on in this hive.` : 'Changed selection dismissed.', 'good')
  }

  /** Every action re-reads the signed current head before holding its closure. */
  async #commitPending(review: PendingReview, dismissChanged: boolean,
    onProgress?: (progress: ReplicationProgress) => void): Promise<boolean> {
    if (!review.offer) return dismissChanged
      && await clearPendingSelection(review.selection).catch(() => false)
    let ok = review.alreadyOn
    if (!ok && review.offer && 'kind' in review.selection) {
      const selected = review.selection
      const offered = await readPublicCreations(selected.source).catch(() => [])
      const current = offered.find(row => row.pubkey === selected.pubkey
        && row.meaning === selected.meaning && row.key === selected.key
        && row.location === selected.location && row.head === selected.head)
      ok = !!current && await addPublicCreation(current).catch(() => false)
    } else if (!ok && review.offer && !('kind' in review.selection) && review.localRoute) {
      const selected = review.selection
      const offered = await readOfferings(selected.source).catch(() => [])
      const current = offered.find(row => row.route === selected.route
        && row.pubkey === selected.pubkey && row.lineage === selected.lineage
        && row.head === selected.head)
      ok = !!current && await addOffering(current, review.localRoute, selected.source, onProgress).catch(() => false)
    }
    return ok && await clearPendingSelection(review.selection).catch(() => false)
  }

  async #refreshPendingReview(source: string): Promise<void> {
    this.#pending = await listPendingSelections()
    const remains = this.#pending.some(row => row.source === source)
    if (remains) await this.#openPending(source)
    else { this.#reviews = null; this.#reviewSource = ''; await this.#render() }
  }

  async #completeAllPending(reviews: PendingReview[], button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    button.disabled = true
    let completed = 0
    for (const [index, review] of reviews.entries()) {
      button.textContent = `Verifying ${index + 1} of ${reviews.length}…`
      if (await this.#commitPending(review, false, this.#meterFor(review))) completed++
    }
    await this.#refreshPendingReview(reviews[0]!.selection.source)
    this.#busy = false
    this.#say(completed === reviews.length
      ? `${completed} selected revisions are on in this hive.`
      : `${completed} of ${reviews.length} revisions are on. The others remain selected for review.`,
    completed === reviews.length ? 'good' : 'bad')
  }

  /** A bar on the review's own tile, fed by the closure walk. Only an offering
   *  carries a closure; a text theme is two files and needs none. */
  #meterFor(review: PendingReview): ((progress: ReplicationProgress) => void) | undefined {
    const tile = this.#reviewTiles.get(review)
    if (!tile || !review.offer || review.alreadyOn || 'kind' in review.selection) return undefined
    tile.querySelector('.replication')?.remove()
    const meter = replicationMeter(`Replicating ${review.offer.title}`)
    tile.append(meter.element)
    return ({ done, total }) => meter.paint(done, total)
  }

  #linkChip(link: WelcomeLink, lead: boolean): HTMLElement {
    const anchor = document.createElement('a')
    anchor.className = lead ? 'chip lead' : 'chip'
    anchor.href = link.href
    const label = document.createElement('b')
    label.textContent = link.label
    // Somewhere else on the web opens in its own tab and says so; somewhere on
    // this origin is this site still, and replaces the page it was clicked from.
    if (anchor.origin !== location.origin) {
      anchor.target = '_blank'
      anchor.rel = 'noopener'
      const out = document.createElement('i')
      out.setAttribute('aria-hidden', 'true')
      out.textContent = '↗'
      label.append(out)
    }
    anchor.append(label)
    if (link.note) {
      const note = document.createElement('span')
      note.textContent = link.note
      anchor.append(note)
    }
    return anchor
  }

  #pinsFor(zones: string[]): Set<string> {
    if (!this.#galleryPins) {
      let saved: unknown = null
      try { saved = JSON.parse(localStorage.getItem('hypercomb:gallery:pins') ?? 'null') } catch { /* private storage */ }
      const initial = Array.isArray(saved) ? saved : [this.#self, zones.find(zone => zone !== this.#self)]
      this.#galleryPins = new Set(initial.filter((zone): zone is string => typeof zone === 'string' && zones.includes(zone)))
    }
    for (const zone of this.#galleryPins) if (!zones.includes(zone)) this.#galleryPins.delete(zone)
    return this.#galleryPins
  }

  #savePins(): void {
    try { localStorage.setItem('hypercomb:gallery:pins', JSON.stringify([...this.#galleryPins ?? []])) }
    catch { /* the selection still works for this visit */ }
  }

  #queueGalleryZone(zone: string): void {
    if ((this.#galleryOffers.has(zone) && this.#galleryCreations.has(zone)) || this.#galleryPending.has(zone)) return
    this.#galleryPending.add(zone)
    this.#galleryQueue.push(zone)
    this.#drainGalleryQueue()
  }

  #drainGalleryQueue(): void {
    while (this.#galleryReaders < 3 && this.#galleryQueue.length) {
      const zone = this.#galleryQueue.shift()!
      if (!this.#galleryPins?.has(zone) && !this.#gallerySearchZones.has(zone)) {
        this.#galleryPending.delete(zone)
        continue
      }
      this.#galleryReaders++
      void Promise.all([readOfferings(zone).catch(() => []), readPublicCreations(zone).catch(() => [])]).then(([offers, creations]) => {
        this.#galleryOffers.set(zone, offers)
        this.#galleryCreations.set(zone, creations)
        this.#galleryPending.delete(zone)
        this.#galleryReaders--
        this.#galleryRefresh?.()
        this.#drainGalleryQueue()
      })
    }
  }

  #gallery(zones: string[]): HTMLElement {
    const home = returnHome()
    const selecting = !!home && (home.protocol === 'hypercomb:' || home.origin !== location.origin)
    // A visitor sees this domain's own offers. Their choices remain in the
    // URL until they return home; nothing is installed on the visited host.
    const pins = selecting ? (this.#galleryPins = new Set([this.#self])) : this.#pinsFor(zones)
    const choices = new Map<string, RemoteChoice>()
    if (selecting) {
      try {
        const raw = JSON.parse(new URLSearchParams(location.search).get('select') ?? '[]') as unknown
        if (Array.isArray(raw)) for (const value of raw.slice(0, 24)) {
          if (!value || typeof value !== 'object') continue
          const choice = value as Partial<RemoteSiteChoice & RemoteCreationChoice>
          if (typeof choice.publisher !== 'string' || typeof choice.head !== 'string') continue
          if (choice.kind === 'creation') {
            if (typeof choice.meaning !== 'string' || typeof choice.key !== 'string'
              || typeof choice.location !== 'string') continue
          } else if (typeof choice.add !== 'string' || typeof choice.lineage !== 'string') continue
          choices.set(choiceKey(choice as RemoteChoice), choice as RemoteChoice)
        }
      } catch { /* malformed URL choices are ignored */ }
    }
    const section = document.createElement('section')
    const returnBar = document.createElement('div')
    returnBar.className = 'selection-return'
    const returnNote = document.createElement('span')
    const returnLink = document.createElement('a')
    returnLink.textContent = 'Return to my hive'
    returnBar.append(returnNote, returnLink)
    const saveChoices = (): void => {
      const query = new URLSearchParams(location.search)
      if (choices.size) query.set('select', JSON.stringify([...choices.values()]))
      else query.delete('select')
      history.replaceState(history.state, '', `${location.pathname}?${query}${location.hash}`)
    }
    const toggleChoice = (offer: Offering): void => {
      const key = `site:${offer.pubkey}:${offer.lineage}`
      if (choices.has(key)) choices.delete(key)
      else if (choices.size < 24) choices.set(key, {
        add: offer.route, publisher: offer.pubkey, lineage: offer.lineage, head: offer.head,
      })
      saveChoices()
      paint()
    }
    const toggleCreationChoice = (creation: PublicCreation): void => {
      const key = `creation:${creation.pubkey}:${creation.meaning}:${creation.key}`
      if (choices.has(key)) choices.delete(key)
      else if (choices.size < 24) choices.set(key, { kind: 'creation', publisher: creation.pubkey,
        meaning: creation.meaning, key: creation.key, location: creation.location, head: creation.head })
      saveChoices()
      paint()
    }
    const head = document.createElement('div')
    head.className = 'gallery-head'
    const title = document.createElement('h2')
    title.textContent = 'Creations'
    head.append(title)
    const search = document.createElement('input')
    search.className = 'gallery-search'
    search.type = 'search'
    search.placeholder = 'Search creations or a domain · jwize.com camel'
    search.setAttribute('aria-label', 'Search domains and creations')
    search.addEventListener('input', () => { limit = 36; paint() })
    const sources = document.createElement('details')
    sources.className = 'source-filter'
    const sourcesSummary = document.createElement('summary')
    const sourcesName = document.createElement('span')
    sourcesName.textContent = 'Sources'
    const sourcesCount = document.createElement('small')
    sourcesSummary.append(sourcesName, sourcesCount)
    sources.append(sourcesSummary)
    const sourceSearch = document.createElement('input')
    sourceSearch.className = 'source-search'
    sourceSearch.type = 'search'
    sourceSearch.placeholder = 'Find a domain to show or remove'
    sourceSearch.setAttribute('aria-label', 'Find an added domain')
    sourceSearch.addEventListener('input', () => paint())
    const pinnedRows = document.createElement('div')
    pinnedRows.className = 'domain-list'
    const foundRows = document.createElement('div')
    foundRows.className = 'domain-list'
    const sourceNote = document.createElement('p')
    sourceNote.className = 'source-note'
    const count = document.createElement('p')
    count.className = 'gallery-count'
    const grid = document.createElement('div')
    grid.className = 'offer-grid'
    const more = document.createElement('button')
    more.className = 'gallery-more'
    more.type = 'button'
    more.textContent = 'Show more creations'
    more.addEventListener('click', () => { limit += 36; paint() })
    let limit = 36
    let adoptions: Adoption[] = []
    let active: ActiveOffering[] = []
    let activeCreations: ActivePublicCreation[] = []
    const remembered = new Set<string>()

    const previousByIdentity = (): Map<string, Adoption> => {
      const previous = new Map<string, Adoption>()
      for (const row of adoptions) {
        const key = `${row.pubkey}:${row.lineage}`
        if (!previous.has(key)) previous.set(key, row)
      }
      return previous
    }

    const activeByIdentity = (): Map<string, ActiveOffering> => {
      const enabled = new Map<string, ActiveOffering>()
      for (const row of active) {
        const key = `${row.pubkey}:${row.lineage}`
        if (!enabled.has(key)) enabled.set(key, row)
      }
      return enabled
    }

    const domainRow = (zone: string, selected: boolean): HTMLElement => {
      const row = document.createElement('div')
      row.className = 'domain-row'
      row.dataset['pinned'] = String(selected)
      const label = document.createElement('a')
      label.className = 'domain-link'
      label.textContent = zone
      label.href = domainVisitHref(zone, this.#self)
      label.target = '_blank'
      label.rel = 'noopener'
      label.setAttribute('aria-label', `Visit ${zone} to select tiles for this hive`)
      const offers = this.#galleryOffers.get(zone)
      const creations = this.#galleryCreations.get(zone)
      const pending = this.#pending.filter(row => row.source === zone).length
      const info = document.createElement(pending ? 'button' : 'span')
      info.textContent = pending ? `${pending} selected`
        : !offers && this.#galleryPending.has(zone) ? 'Reading…'
        : offers && creations ? `${offers.length + creations.length} creation${offers.length + creations.length === 1 ? '' : 's'}` : ''
      if (pending) {
        info.className = 'update-mark'
        info.setAttribute('type', 'button')
        info.setAttribute('aria-label', `Review ${pending} selected tiles from ${zone}`)
        info.addEventListener('click', () => { void this.#openPending(zone) })
      }
      const pin = document.createElement('button')
      pin.type = 'button'
      pin.textContent = selected ? 'Unpin' : 'Pin'
      pin.setAttribute('aria-label', `${selected ? 'Unpin' : 'Pin'} ${zone}`)
      pin.addEventListener('click', () => {
        if (selected) pins.delete(zone)
        else { pins.add(zone); this.#queueGalleryZone(zone) }
        this.#savePins()
        paint()
      })
      row.append(label, info, pin)
      if (zone !== this.#self) {
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'source-remove'
        remove.textContent = 'Remove'
        remove.setAttribute('aria-label', `Remove ${zone} from added domains`)
        remove.addEventListener('click', () => { void this.#remove(zone) })
        row.append(remove)
      }
      return row
    }

    const paint = (): void => {
      if (selecting && home) {
        returnNote.textContent = `${choices.size} tile${choices.size === 1 ? '' : 's'} selected for ${home.protocol === 'hypercomb:' ? 'my local hive' : home.host}`
        returnLink.href = returnHref(home, this.#self, [...choices.values()])
        returnLink.setAttribute('aria-label', `Return to my hive with ${choices.size} selected tiles`)
      }
      const terms = galleryTerms(search.value)
      const previous = previousByIdentity()
      const enabled = activeByIdentity()
      const sourceTerm = sourceSearch.value.toLowerCase().trim()
      const matchingSources = zones.filter(zone => zone.includes(sourceTerm))
      pinnedRows.replaceChildren(...[...pins].filter(zone => zone.includes(sourceTerm))
        .map(zone => domainRow(zone, true)))
      const candidates = matchingSources.filter(zone => !pins.has(zone))
      foundRows.replaceChildren(...candidates.slice(0, 3).map(zone => domainRow(zone, false)))
      sourceNote.textContent = candidates.length > 3
        ? `${candidates.length - 3} more domains · keep typing to narrow the list` : ''
      sourcesCount.textContent = `${pins.size} shown`
      const domainTerms = terms.filter(term => zones.some(zone => zone.includes(term)))
      this.#gallerySearchZones = new Set(domainTerms.length
        ? zones.filter(zone => domainTerms.every(term => zone.includes(term))).slice(0, 12) : [])
      for (const zone of this.#gallerySearchZones) this.#queueGalleryZone(zone)
      const visibleZones = new Set([...pins, ...this.#gallerySearchZones])
      const groups = new Map<string, { offer: Offering; offers: Offering[]; sources: Set<string> }>()
      for (const zone of visibleZones) for (const offer of this.#galleryOffers.get(zone) ?? []) {
        const key = `${offer.pubkey}:${offer.lineage}`
        const found = groups.get(key)
        if (!found) { groups.set(key, { offer, offers: [offer], sources: new Set([zone]) }); continue }
        found.sources.add(zone)
        if (!found.offers.some(row => row.route === offer.route)) found.offers.push(offer)
        if (Number(offer.index['created_at']) > Number(found.offer.index['created_at'])) found.offer = offer
      }
      const matches = [...groups.values()].filter(({ offer, offers, sources }) =>
        terms.every(term => [offer.title, offer.lineage, ...sources, ...offers.map(row => new URL(row.route).host)]
          .some(value => value.toLowerCase().includes(term))))
      const creationGroups = new Map<string, { creation: PublicCreation; sources: Set<string> }>()
      for (const zone of visibleZones) for (const creation of this.#galleryCreations.get(zone) ?? []) {
        const key = `${creation.pubkey}:${creation.location}`
        const group = creationGroups.get(key)
        if (group) group.sources.add(zone)
        else creationGroups.set(key, { creation, sources: new Set([zone]) })
      }
      const otherMatches = [...creationGroups.values()].filter(({ creation, sources }) =>
        terms.every(term => [creation.title, creation.meaning, creation.key, creation.host, ...sources]
          .some(value => value.toLowerCase().includes(term))))
      const total = matches.length + otherMatches.length
      count.textContent = `${total} creation${total === 1 ? '' : 's'} · ${visibleZones.size} source${visibleZones.size === 1 ? '' : 's'} in view`
      const activeByCreation = new Map(activeCreations.map(row =>
        [`${row.pubkey}:${row.meaning}:${row.key}`, row.head]))
      const siteCards = matches.slice(0, limit).map(group => this.#offeringTile(group, previous, enabled, remembered,
        selecting ? { choices, toggleChoice } : null))
      const creationCards = otherMatches.slice(0, Math.max(0, limit - siteCards.length))
        .map(group => this.#publicCreationTile(group, activeByCreation, remembered,
          selecting ? { choices, toggleChoice: toggleCreationChoice } : null))
      grid.replaceChildren(...siteCards, ...creationCards)
      if (!total) {
        const reading = [...visibleZones].some(zone => this.#galleryPending.has(zone))
        const first = emptyTile('01', reading ? 'Reading sources…'
          : terms.length ? 'No matching creations' : 'Your gallery starts here',
        reading ? 'Checking current public offerings.'
          : terms.length ? 'Try another search or choose a source.'
            : 'Choose a source to see what it offers.')
        if (!selecting) {
          const openSources = document.createElement('button')
          openSources.type = 'button'
          openSources.textContent = 'Choose sources'
          openSources.addEventListener('click', () => { sources.open = true; input.focus() })
          first.append(openSources)
        }
        const second = emptyTile('02', 'An open space',
          'Each published creation gets a tile you can explore.')
        second.classList.add('secondary')
        second.setAttribute('aria-hidden', 'true')
        grid.append(first, second)
      }
      more.hidden = total <= limit
    }

    const form = document.createElement('form')
    form.className = 'source-form'
    const input = document.createElement('input')
    input.placeholder = 'Add a root domain'
    input.spellcheck = false
    input.autocapitalize = 'off'
    input.setAttribute('aria-label', 'Root domain to add')
    const add = document.createElement('button')
    add.type = 'submit'
    add.textContent = 'Add domain'
    form.append(input, add)
    form.addEventListener('submit', event => { event.preventDefault(); void this.#add(input.value) })
    const status = document.createElement('p')
    status.className = 'status'
    sources.append(sourceSearch, pinnedRows, foundRows, sourceNote, form, status)
    if (selecting) section.append(returnBar, head, search, count, grid, more)
    else section.append(head, search, sources, count, grid, more)
    this.#galleryRefresh = () => { if (section.isConnected) paint() }
    paint()
    queueMicrotask(() => { for (const zone of pins) this.#queueGalleryZone(zone) })
    void listAdoptions().then(rows => { adoptions = rows; this.#galleryRefresh?.() }).catch(() => {})
    void listActiveOfferings().then(rows => { active = rows; this.#galleryRefresh?.() }).catch(() => {})
    void listActivePublicCreations().then(rows => { activeCreations = rows; this.#galleryRefresh?.() }).catch(() => {})
    return section
  }

  #updateBadge(source: string, title: string, selected: boolean): HTMLElement {
    const badge = selected ? document.createElement('button') : document.createElement('a')
    badge.className = 'offer-update'
    badge.textContent = selected ? '↻ Selected revision · review here' : '↻ New revision · choose at source'
    badge.setAttribute('aria-label', selected ? `Review selected revision of ${title}`
      : `Visit ${source} to choose the new revision of ${title}`)
    if (badge instanceof HTMLButtonElement) {
      badge.type = 'button'
      badge.addEventListener('click', () => { void this.#openPending(source) })
    } else {
      badge.href = domainVisitHref(source, this.#self)
      badge.target = '_blank'
      badge.rel = 'noopener'
    }
    return badge
  }

  #offeringTile(group: { offer: Offering; offers: Offering[]; sources: Set<string> },
    previous: Map<string, Adoption>, enabled: Map<string, ActiveOffering>, remembered: Set<string>,
    selection: { choices: Map<string, RemoteChoice>; toggleChoice: (offer: Offering) => void } | null = null): HTMLElement {
    const { offer, offers, sources } = group
    const identity = `${offer.pubkey}:${offer.lineage}`
    const held = previous.get(identity)
    const live = enabled.get(identity)
    const installed = live?.head === offer.head
    const localRoute = live?.localRoute ?? localRouteFor(offer, this.#self)
    const update = !selection && !!held && held.head !== offer.head
    const pending = selection ? undefined : this.#pending.find(row => !('kind' in row)
      && row.pubkey === offer.pubkey && row.lineage === offer.lineage)
    const source = pending?.source ?? [...sources][0] ?? rootDoor(offer)
    if (update) {
      const key = `${offer.pubkey}:${offer.lineage}:${held.head}:${offer.head}`
      if (!remembered.has(key)) { remembered.add(key); void rememberRevisionCandidate(held, offer) }
    }
    const tile = document.createElement('article')
    tile.className = 'offer'
    const link = document.createElement('a')
    link.className = 'offer-main'
    link.href = visitHref(offer.route, source)
    link.target = '_blank'
    link.rel = 'noopener'
    link.append(tileArt(offer.title, 'IMPLEMENTATION', offer.head))
    const copy = document.createElement('span')
    copy.className = 'offer-copy'
    const name = document.createElement('b')
    name.textContent = offer.title
    const address = document.createElement('span')
    address.textContent = new URL(offer.route).host
    const visit = document.createElement('span')
    visit.className = 'offer-visit'
    visit.textContent = 'Explore creation ↗'
    copy.append(name, address, visit)
    if (update) {
      const mark = document.createElement('em')
      mark.textContent = '↻ Update available'
      copy.append(mark)
    }
    link.append(copy)
    tile.append(link)
    if (!selection && (pending || update)) tile.append(this.#updateBadge(source, offer.title, !!pending))
    if (selection) {
      const selected = selection.choices.get(`site:${identity}`)?.head === offer.head
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'offer-select'
      toggle.textContent = selected ? 'Turn off' : 'Turn on'
      toggle.setAttribute('aria-pressed', String(selected))
      toggle.setAttribute('aria-label', `${selected ? 'Turn off' : 'Turn on'} ${offer.title} for my hive`)
      toggle.addEventListener('click', () => selection.toggleChoice(offer))
      tile.append(toggle)
    }
    if (offers.length > 1) {
      const endpoints = document.createElement('div')
      endpoints.className = 'offer-routes'
      for (const row of offers) {
        const endpoint = document.createElement('a')
        endpoint.href = visitHref(row.route, [...sources][0] ?? rootDoor(row))
        endpoint.target = '_blank'
        endpoint.rel = 'noopener'
        endpoint.textContent = new URL(row.route).host
        endpoints.append(endpoint)
      }
      tile.append(endpoints)
    }
    const details = document.createElement('details')
    details.className = 'offer-details'
    const detailKey = `site:${identity}`
    details.open = this.#expandedTiles.has(detailKey)
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return
      if (details.open) this.#expandedTiles.add(detailKey)
      else this.#expandedTiles.delete(detailKey)
    })
    const summary = document.createElement('summary')
    summary.textContent = selection ? 'Inspect signed revision' : 'Details and revision'
    const provenance = document.createElement('code')
    provenance.textContent = `From ${[...sources].join(', ')}\nLocal route ${localRoute || 'unavailable'}\nCurrent ${offer.head}${held ? `\nHeld ${held.head}` : ''}`
    provenance.style.whiteSpace = 'pre-wrap'
    const files = document.createElement('div')
    files.className = 'offer-files'
    for (const [label, href] of [
      ['Signed index', new URL(`hive/${offer.pubkey}`, offer.route).href],
      ['Payload bytes', new URL(offer.head, offer.route).href],
    ]) {
      const file = document.createElement('a')
      file.href = href
      file.target = '_blank'
      file.rel = 'noopener'
      file.textContent = label
      files.append(file)
    }
    const action = installed ? document.createElement('button') : document.createElement('a')
    if (installed) {
      action.setAttribute('type', 'button')
      action.textContent = 'Turn off here'
      action.addEventListener('click', () => { void this.#turnOffOffering(offer, action as HTMLButtonElement) })
    } else {
      action.textContent = live ? 'Visit host to review update' : 'Visit host to turn on'
      action.setAttribute('href', domainVisitHref(source, this.#self))
      action.setAttribute('target', '_blank')
      action.setAttribute('rel', 'noopener')
    }
    details.append(summary, provenance, files)
    if (!selection) details.append(action)
    if (!selection && live && !installed) {
      const off = document.createElement('button')
      off.type = 'button'
      off.textContent = 'Turn off'
      off.addEventListener('click', () => { void this.#turnOffOffering(offer, off) })
      details.append(off)
    }
    tile.append(details)
    return tile
  }

  #publicCreationTile(group: { creation: PublicCreation; sources: Set<string> },
    active: Map<string, string>, remembered: Set<string>,
    selection: { choices: Map<string, RemoteChoice>; toggleChoice: (creation: PublicCreation) => void } | null = null): HTMLElement {
    const { creation, sources } = group
    const accepted = active.get(`${creation.pubkey}:${creation.meaning}:${creation.key}`)
    const installed = accepted === creation.head
    const pending = selection ? undefined : this.#pending.find(row => 'kind' in row
      && row.pubkey === creation.pubkey && row.meaning === creation.meaning && row.key === creation.key)
    const source = pending?.source ?? [...sources][0] ?? creation.host
    if (!selection && accepted && !installed) {
      const key = `${creation.pubkey}:${creation.location}:${accepted}:${creation.head}`
      if (!remembered.has(key)) {
        remembered.add(key)
        void rememberPublicCreationCandidate({ meaning: creation.meaning, key: creation.key,
          pubkey: creation.pubkey, head: accepted }, creation, source)
      }
    }
    const tile = document.createElement('article')
    tile.className = 'offer'
    const details = document.createElement('details')
    details.className = 'offer-details'
    const detailKey = `creation:${creation.pubkey}:${creation.location}`
    details.open = this.#expandedTiles.has(detailKey)
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return
      if (details.open) this.#expandedTiles.add(detailKey)
      else this.#expandedTiles.delete(detailKey)
    })
    const main = document.createElement('button')
    main.className = 'offer-main'
    main.type = 'button'
    main.setAttribute('aria-label', `Inspect ${creation.title}`)
    main.append(tileArt(creation.title, 'CREATION', creation.head))
    const copy = document.createElement('span')
    copy.className = 'offer-copy'
    const name = document.createElement('b')
    name.textContent = creation.title
    const address = document.createElement('span')
    address.textContent = `${creation.meaning} · ${creation.host}`
    const inspect = document.createElement('span')
    inspect.className = 'offer-visit'
    inspect.textContent = 'Inspect creation ↓'
    copy.append(name, address, inspect)
    if (accepted && !installed) {
      const mark = document.createElement('em')
      mark.textContent = '↻ Update available'
      copy.append(mark)
    }
    main.append(copy)
    main.addEventListener('click', () => {
      details.open = !details.open
      if (details.open) this.#expandedTiles.add(detailKey)
      else this.#expandedTiles.delete(detailKey)
    })
    tile.append(main)
    if (!selection && (pending || (accepted && !installed))) {
      tile.append(this.#updateBadge(source, creation.title, !!pending))
    }
    if (selection) {
      const selected = selection.choices.get(`creation:${creation.pubkey}:${creation.meaning}:${creation.key}`)?.head === creation.head
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'offer-select'
      toggle.textContent = selected ? 'Turn off' : 'Turn on'
      toggle.setAttribute('aria-pressed', String(selected))
      toggle.setAttribute('aria-label', `${selected ? 'Turn off' : 'Turn on'} ${creation.title} for my hive`)
      toggle.addEventListener('click', () => selection.toggleChoice(creation))
      tile.append(toggle)
    }
    const summary = document.createElement('summary')
    summary.textContent = selection ? 'Inspect signed revision' : 'Details and revision'
    const provenance = document.createElement('code')
    provenance.textContent = `From ${[...sources].join(', ')}\nLocation ${creation.location}\nCurrent ${creation.head}${accepted ? `\nAccepted ${accepted}` : ''}`
    provenance.style.whiteSpace = 'pre-wrap'
    const files = document.createElement('div')
    files.className = 'offer-files'
    for (const [label, sig] of [['Signed meta', creation.head], ['Theme layer', creation.payload]] as const) {
      const file = document.createElement('a')
      file.href = new URL(`/${sig}`, publicCreationOrigin(creation.host)).href
      file.target = '_blank'
      file.rel = 'noopener'
      file.textContent = label
      files.append(file)
    }
    const button = installed || source === this.#self
      ? document.createElement('button') : document.createElement('a')
    if (button instanceof HTMLButtonElement) {
      button.type = 'button'
      button.textContent = installed ? 'Turn off' : accepted ? 'Turn on latest' : 'Turn on'
      button.addEventListener('click', () => {
        if (installed) void this.#turnOffPublicCreation(creation, button)
        else void this.#addPublicCreation(creation, button)
      })
    } else {
      button.textContent = accepted ? 'Visit host to review update' : 'Visit host to turn on'
      button.href = domainVisitHref(source, this.#self)
      button.target = '_blank'
      button.rel = 'noopener'
    }
    details.append(summary, provenance, files)
    if (!selection) details.append(button)
    tile.append(details)
    return tile
  }

  async #addPublicCreation(creation: PublicCreation, button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    button.disabled = true
    button.textContent = 'Verifying creation…'
    const ok = await addPublicCreation(creation).catch(() => false)
    this.#busy = false
    if (ok) await this.#render()
    else { button.disabled = false; button.textContent = 'Turn on' }
    this.#say(ok ? `${creation.title} is on in this hive at its accepted revision.`
      : `Could not turn on ${creation.title}; its signed head or bytes did not verify.`, ok ? 'good' : 'bad')
  }

  async #turnOffPublicCreation(creation: PublicCreation, button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    button.disabled = true
    const ok = await turnOffPublicCreation(creation).catch(() => false)
    this.#busy = false
    if (ok) await this.#render()
    else button.disabled = false
    this.#say(ok ? `${creation.title} is off here. Its accepted bytes remain available.`
      : `Could not turn off ${creation.title}.`, ok ? 'good' : 'bad')
  }

  async #turnOffOffering(offer: Offering, button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    button.disabled = true
    const ok = await turnOffOffering(offer.pubkey, offer.lineage).catch(() => false)
    this.#busy = false
    if (ok) await this.#render()
    else button.disabled = false
    this.#say(ok ? `${offer.title} is off here. Its signed bytes remain addressable.`
      : `Could not turn off ${offer.title}.`, ok ? 'good' : 'bad')
  }

  async #takeHandoff(query = new URLSearchParams(location.search), clearQuery = true): Promise<void> {
    const source = hostZone(query.get('source'))
    let choices: RemoteChoice[]
    try {
      if (query.has('select')) {
        const decoded = JSON.parse(query.get('select') ?? '') as unknown
        if (!source || !Array.isArray(decoded) || decoded.length > 24) throw new Error('invalid selection')
        choices = decoded as RemoteChoice[]
      } else {
        const add = query.get('add') ?? ''
        const publisher = query.get('publisher') ?? ''
        const lineage = query.get('lineage') ?? ''
        choices = [{ add, publisher, lineage, head: '' }]
      }
      for (const choice of choices) {
        if (!/^[a-f0-9]{64}$/.test(choice.publisher) || typeof choice.head !== 'string'
          || (choice.head && !/^[a-f0-9]{64}$/.test(choice.head))) throw new Error('invalid tile reference')
        if ('kind' in choice) {
          if (choice.kind !== 'creation' || !/^[a-f0-9]{64}$/.test(choice.location)
            || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(choice.meaning)
            || !choice.key || choice.key.length > 512 || !choice.head) throw new Error('invalid creation reference')
        } else {
          const route = new URL(choice.add)
          if (route.href !== `${route.origin}/` || !choice.lineage) throw new Error('invalid site reference')
        }
      }
    } catch {
      this.#say('The tile selection is malformed.', 'bad')
      return
    }
    const chosenSource = source || (choices[0] && !('kind' in choices[0]) ? new URL(choices[0].add).host : '')
    if (!chosenSource) { this.#say('The tile selection has no source domain.', 'bad'); return }
    this.#say(`Checking ${chosenSource}…`)
    try {
      const [offered, created] = await Promise.all([readOfferings(chosenSource), readPublicCreations(chosenSource)])
      const selected = choices.map(choice => 'kind' in choice
        ? created.find(row => row.pubkey === choice.publisher && row.meaning === choice.meaning
          && row.key === choice.key && row.location === choice.location && row.head === choice.head)
        : offered.find(row => row.route === choice.add && row.pubkey === choice.publisher
          && row.lineage === choice.lineage && (!choice.head || row.head === choice.head)))
      if (selected.some(offer => !offer)) throw new Error('a tile changed or is absent from this domain’s signed pool')
      let staged = 0
      for (const offer of selected) if (offer && await ('meaning' in offer
        ? stagePendingCreation(offer, chosenSource) : stagePendingSelection(offer, chosenSource))) staged++
      if (staged !== selected.length) throw new Error(`only ${staged} of ${selected.length} selections could be stored`)
      if (chosenSource !== this.#self) {
        const added = await addHostZone(chosenSource)
        if (added) {
          this.#galleryPins?.add(added)
          this.#savePins()
        }
      }
      if (clearQuery) {
        query.delete('add')
        query.delete('publisher')
        query.delete('lineage')
        query.delete('select')
        query.delete('source')
        history.replaceState(history.state, '', `${location.pathname}${query.size ? '?' + query : ''}${location.hash}`)
      }
      this.#pending = await listPendingSelections()
      if (staged) await this.#openPending(chosenSource)
      else await this.#render()
      this.#say(staged ? `${staged} revision${staged === 1 ? '' : 's'} selected from ${chosenSource}. Review them below.`
        : `No tiles selected from ${chosenSource}.`, 'good')
    } catch (error) {
      this.#say(`Could not stage tiles from ${chosenSource}: ${error instanceof Error ? error.message : 'verification failed'}.`, 'bad')
    }
  }

  /** Show only the implementations this hive actually serves. Accepted and
   * observed older heads stay available for a later signed diff or audit. */
  async #fillDeploymentDetails(into: HTMLElement): Promise<void> {
    const [active, adoptions, candidates] = await Promise.all([
      listActiveOfferings(), listAdoptions(), listRevisionCandidates(),
    ])
    if (!into.isConnected) return
    into.replaceChildren()
    if (!active.length) {
      const empty = document.createElement('p')
      empty.className = 'lede'
      empty.textContent = 'No deployment tiles are on here yet.'
      into.append(empty)
      return
    }
    for (const route of active) {
      const tile = document.createElement('article')
      tile.className = 'deployment'
      const title = document.createElement('h3')
      title.textContent = route.lineage.split('/').at(-1)?.replace(/(^|-)([a-z])/g,
        (_match, _dash: string, letter: string) => ` ${letter.toUpperCase()}`).trim() || route.localRoute
      const address = document.createElement('p')
      address.textContent = `${route.localRoute} · from ${route.source}`
      const source = document.createElement('a')
      source.href = route.sourceRoute
      source.target = '_blank'
      source.rel = 'noopener'
      source.textContent = 'Visit implementation'
      const current = document.createElement('p')
      current.textContent = `Current revision ${route.head.slice(0, 12)}…`
      current.title = route.head
      tile.append(title, address, source, current)
      const known = new Set<string>()
      for (const adoption of adoptions) {
        if (adoption.pubkey === route.pubkey && adoption.lineage === route.lineage
          && adoption.head !== route.head) known.add(adoption.head)
      }
      for (const candidate of candidates) {
        if ('lineage' in candidate && candidate.pubkey === route.pubkey
          && candidate.lineage === route.lineage) {
          if (candidate.from !== route.head) known.add(candidate.from)
          if (candidate.to !== route.head) known.add(candidate.to)
        }
      }
      if (known.size) {
        const revisions = document.createElement('details')
        const summary = document.createElement('summary')
        summary.textContent = `${known.size} known revision${known.size === 1 ? '' : 's'}`
        const list = document.createElement('ul')
        for (const sig of known) {
          const item = document.createElement('li')
          item.textContent = sig.slice(0, 12) + '…'
          item.title = sig
          list.append(item)
        }
        revisions.append(summary, list)
        tile.append(revisions)
      }
      into.append(tile)
    }
  }

  /** THE PACKAGE THIS HIVE RUNS, and where to take another from. Not tiles:
   *  a package is transport inventory, not a creation. It is still the one
   *  act that turns a cold origin into a working hive, so the card keeps it —
   *  the selected revision, what this host offers, the hosts you carry, and a
   *  known signature — each with a bar while its files arrive. */
  #packages(zones: string[]): HTMLElement {
    const section = document.createElement('section')
    section.className = 'packages'
    const heading = document.createElement('h2')
    heading.className = 'lbl'
    heading.textContent = 'Package replication'

    const revision = document.createElement('p')
    revision.className = 'revision'
    const sig = installedPackageSig()
    if (sig) {
      const code = document.createElement('code')
      code.textContent = sig
      const note = document.createElement('span')
      note.textContent = 'Selected revision. Replicate another package to switch, or this one again to repair missing files.'
      revision.append(code, note)
    } else {
      revision.textContent = 'No package revision selected. Choose a host offer or enter a known signature.'
    }
    section.append(heading, revision)

    if (this.#self) {
      const box = this.#hostBox(this.#self, true)
      this.#selfAnswer ??= this.#ask(this.#self)
      void this.#fill(box, this.#selfAnswer, 'Nothing published here yet.')
      section.append(box)
    }

    // The other hosts are asked only when opened: the gallery already asks
    // them for creations, and a packages pool is a second read per domain.
    const more = document.createElement('details')
    more.className = 'more-hosts'
    const summary = document.createElement('summary')
    summary.textContent = zones.length
      ? `Packages on ${zones.length} other host${zones.length === 1 ? '' : 's'}, or by signature`
      : 'Replicate a package by signature'
    more.append(summary)
    more.addEventListener('toggle', () => {
      if (!more.open || more.childElementCount > 1) return
      const contents = document.createElement('div')
      for (const zone of zones) {
        const box = this.#hostBox(zone, false)
        void this.#fill(box, this.#ask(zone), 'Nothing published here.')
        contents.append(box)
      }
      contents.append(this.#bySignature())
      more.append(contents)
    })

    const status = document.createElement('p')
    status.className = 'status package-status'
    status.setAttribute('role', 'status')
    section.append(more, status)
    return section
  }

  #sayPackages(message: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
    const status = this.#root.querySelector('.package-status')
    if (!status) return
    status.textContent = message
    status.setAttribute('data-tone', tone)
  }

  /** A known signature can be replicated even when no host lists it. The
   *  same authority and byte-verification gates handle listed and pasted roots. */
  #bySignature(): HTMLElement {
    const form = document.createElement('form')
    const input = document.createElement('input')
    input.placeholder = '64-character package signature'
    input.spellcheck = false
    input.autocapitalize = 'off'
    input.setAttribute('aria-label', 'Package signature')
    const take = document.createElement('button')
    take.type = 'submit'
    take.textContent = 'Replicate'
    form.append(input, take)
    form.addEventListener('submit', event => {
      event.preventDefault()
      void this.#installSignature(input.value, take)
    })
    return form
  }

  #hostBox(zone: string, self: boolean): HTMLElement {
    const host = document.createElement('section')
    host.className = self ? 'host self' : 'host'
    const header = document.createElement('header')
    const name = document.createElement('span')
    name.className = 'zone'
    name.textContent = zone
    header.append(name)
    if (self) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = 'this host'
      header.append(tag)
    }
    const body = document.createElement('div')
    body.className = 'body'
    const loading = document.createElement('p')
    loading.className = 'muted'
    loading.textContent = 'Asking…'
    body.append(loading)
    host.append(header, body)
    return host
  }

  async #ask(zone: string): Promise<Answer> {
    try { return await askHostPackages(zone, { limit: 1 }) } catch { return { packages: [], answered: false } }
  }

  /** "Publishes nothing" and "did not answer" are different facts, and only
   *  the second is about reachability — the box says which. */
  async #fill(box: HTMLElement, pending: Promise<Answer>, nothing: string): Promise<void> {
    const { packages, answered } = await pending
    const body = box.querySelector('.body')
    if (!body) return
    body.replaceChildren()
    if (packages.length === 0) {
      const none = document.createElement('p')
      none.className = 'muted'
      none.textContent = answered ? nothing : 'The host did not answer.'
      body.append(none)
      return
    }
    const latest = document.createElement('p')
    latest.className = 'lbl'
    latest.textContent = 'Latest offered revision'
    const list = document.createElement('ul')
    list.append(this.#packageRow(packages[0]!))

    const history = document.createElement('details')
    history.className = 'history'
    const summary = document.createElement('summary')
    summary.textContent = 'Browse publication history'
    const contents = document.createElement('div')
    history.append(summary, contents)
    let loaded = false
    history.addEventListener('toggle', () => {
      if (!history.open || loaded) return
      loaded = true
      void this.#loadHistory(packages[0]!.zone, contents, [])
    })
    body.append(latest, list, history)
  }

  async #loadHistory(zone: string, into: HTMLElement, held: HostPackage[]): Promise<void> {
    const before = held.at(-1)?.poolIndex
    into.textContent = 'Loading revisions…'
    let page: HostPackage[]
    try { page = (await askHostPackages(zone, { limit: 25, ...(before !== undefined ? { before } : {}) })).packages }
    catch {
      into.textContent = 'Could not read publication history.'
      return
    }
    if (!into.isConnected) return
    const rows = [...held, ...page]
    into.replaceChildren()
    const groups = new Map<string, HostPackage[]>()
    for (const row of rows) {
      const name = row.label || 'Unlabeled'
      const group = groups.get(name) ?? []
      group.push(row)
      groups.set(name, group)
    }
    for (const [name, revisions] of groups) {
      const group = document.createElement('details')
      const title = document.createElement('summary')
      title.textContent = name
      const list = document.createElement('ul')
      for (const revision of revisions) list.append(this.#packageRow(revision, true))
      group.append(title, list)
      into.append(group)
    }
    if (page.length === 25 && rows.at(-1)?.poolIndex !== 0) {
      const more = document.createElement('button')
      more.type = 'button'
      more.textContent = 'Load older revisions'
      more.addEventListener('click', () => { void this.#loadHistory(zone, into, rows) })
      into.append(more)
    }
  }

  #packageRow(pkg: HostPackage, revision = false): HTMLElement {
    const row = document.createElement('li')
    const label = document.createElement('div')
    label.className = 'label'
    const title = document.createElement('b')
    title.textContent = revision ? `Revision ${pkg.packageSig.slice(0, 12)}…` : pkg.label
    const detail = document.createElement('span')
    const atoms = pkg.bees.length + pkg.dependencies.length + pkg.layers.length
    detail.textContent = revision
      ? (pkg.at ? pkg.at.slice(0, 10) : pkg.packageSig)
      : atoms > 0
        ? `Revision ${pkg.packageSig.slice(0, 12)}… · ${atoms} atoms · ` +
          `${pkg.bees.length} bees, ${pkg.dependencies.length} deps, ${pkg.layers.length} layers`
        : `Revision ${pkg.packageSig.slice(0, 12)}…${pkg.at ? ` · ${pkg.at.slice(0, 10)}` : ''}`
    detail.title = pkg.packageSig
    label.append(title, detail)

    const take = document.createElement('button')
    take.type = 'button'
    take.textContent = pkg.packageSig === installedPackageSig() ? 'Repair' : 'Replicate'
    // A row that states its atoms gives the bar an end; one that does not
    // (admission derives the real inventory) moves as a count.
    const total = new Set([...pkg.layers, ...pkg.bees, ...pkg.dependencies].map(bareSig)).size
    take.addEventListener('click', () => {
      void this.#replicate(pkg.packageSig, take, row, total, onHeld => installPackage(pkg, [], { onHeld }))
    })
    row.append(label, take)
    return row
  }

  async #installSignature(raw: string, button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    const sig = raw.trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sig)) {
      this.#sayPackages('Enter a 64-character package signature.', 'bad')
      return
    }
    const zones = [...new Set([this.#self, ...await listHostZones()].filter(Boolean))]
    if (zones.length === 0) {
      this.#sayPackages('Add a domain that holds this package first.', 'bad')
      return
    }
    const form = button.closest('form') ?? button
    await this.#replicate(sig, button, form as HTMLElement, 0, onHeld => acquire(sig, zones, { onHeld }))
  }

  async #replicate(
    sig: string,
    button: HTMLButtonElement,
    at: HTMLElement,
    total: number,
    run: (onHeld: (sig: string) => void) => Promise<InstallOutcome>,
  ): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    for (const other of this.#root.querySelectorAll('button')) other.disabled = true
    const action = button.textContent ?? 'Replicate'
    button.textContent = 'Replicating…'
    this.#sayPackages(`Replicating ${sig.slice(0, 12)}…`)

    // Under the row it replicates; a form is a single line, so beneath it.
    const meter = replicationMeter(`Replicating ${sig.slice(0, 12)}`)
    if (at.tagName === 'FORM') at.after(meter.element)
    else at.append(meter.element)
    // Files arrive by the hundred: count every one, paint at most every tenth
    // of a second. A timer, not a frame — a hidden tab never runs a frame.
    const held = new Set<string>()
    let painting = 0
    const paint = (): void => { painting = 0; meter.paint(held.size, total) }
    const onHeld = (file: string): void => {
      held.add(bareSig(file))
      if (!painting) painting = window.setTimeout(paint, 100)
    }
    const restore = (message: string): void => {
      window.clearTimeout(painting)
      this.#busy = false
      for (const other of this.#root.querySelectorAll('button')) other.disabled = false
      button.textContent = action
      meter.element.remove()
      this.#sayPackages(message, 'bad')
    }

    let outcome: InstallOutcome
    try { outcome = await run(onHeld) }
    catch (error) {
      restore(error instanceof Error ? error.message : 'Replication failed.')
      return
    }
    if (!outcome.ok) {
      restore(outcome.error ?? 'Replication failed.')
      console.warn('[shim] replication incomplete', outcome)
      return
    }

    window.clearTimeout(painting)
    const count = outcome.fetched + outcome.present
    meter.paint(count, Math.max(total, count))
    this.#sayPackages(`Held ${count} atoms (${outcome.fetched} fetched). Starting…`, 'good')
    console.log('[shim] replication complete', outcome)
    // A reload, and only here. The import map has to be live BEFORE the first
    // module script evaluates, and the bees that just landed are exactly those
    // module scripts — so the honest move after a cold install is to start the
    // boot again with the heap full, rather than to patch a running graph.
    setTimeout(() => location.reload(), 400)
  }


  #footer(links: readonly WelcomeLink[]): HTMLElement {
    const footer = document.createElement('footer')
    const made = document.createElement('span')
    made.className = 'made'
    made.append(mark(), document.createTextNode('hypercomb'))
    footer.append(made)
    for (const link of links) {
      const anchor = document.createElement('a')
      anchor.href = link.href
      anchor.textContent = link.label
      if (link.note) anchor.title = link.note
      if (anchor.origin !== location.origin) {
        anchor.target = '_blank'
        anchor.rel = 'noopener'
      }
      footer.append(anchor)
    }
    return footer
  }

  async #add(raw: string): Promise<void> {
    if (this.#busy) return
    const zone = hostZone(raw)
    if (!zone) { this.#say(`"${raw.trim()}" is not a hostname.`, 'bad'); return }
    if (zone === this.#self) { this.#say(`${zone} is this host — what it publishes is already on the page.`); return }
    const added = await addHostZone(zone)
    if (!added) { this.#say(`Could not add ${zone}.`, 'bad'); return }
    this.#galleryPins?.add(added)
    this.#savePins()
    await this.#render()
    this.#say(`Added ${added}.`, 'good')
  }

  async #remove(zone: string): Promise<void> {
    if (this.#busy) return
    await removeHostZone(zone)
    this.#galleryPins?.delete(zone)
    this.#savePins()
    await this.#render()
    this.#say(`Removed ${zone}.`)
  }


}

const TAG = 'hc-shim-hosts'

/** Put the card up. Idempotent — a second call is a no-op, so a caller may
 *  ask on any path without tracking whether it already asked. */
export const showHostPanel = (): void => {
  if (!customElements.get(TAG)) customElements.define(TAG, HostPanelElement)
  if (document.querySelector(TAG)) return
  document.body.append(document.createElement(TAG))
}

/** A loaded package has supplied its own surface. Keep the host manager
 * available through /hosts and /@hypercomb, but let that surface take over. */
export const hideHostPanel = (): void => {
  document.querySelector(TAG)?.remove()
}
