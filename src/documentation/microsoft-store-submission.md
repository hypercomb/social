# Microsoft Store submission

Everything needed to put the Windows client in the Microsoft Store, and the
copy to paste into each Partner Center field.

## The route: EXE/MSI listing, never MSIX

Tauri emits `.exe` (NSIS) and `.msi` (WiX) only — no MSIX — and the Store has
accepted unpackaged Win32 installers since June 2021. That constraint happens
to point at the right answer anyway: **an MSIX would break Serve This Hive.**
Packaged apps run in AppContainer, where loopback is blocked by default, so a
browser on the same machine could not reach `hypercomb-serve` on 4270 without
the user running `CheckNetIsolation LoopbackExempt` by hand. Do not package.

In Partner Center this means **New product → EXE or MSI app**. The product
type is fixed at creation; a product reserved as "MSIX or PWA app" can never
accept this installer, and the name has to be released and re-reserved.

## What blocks a submission today

| Blocker | State | What closes it |
|---|---|---|
| Code signing | The Windows workflow signs only when `WINDOWS_CERTIFICATE` is set, and it does `Import-PfxCertificate` — a shape that only works for a self-signed or pre-2023 certificate. Publicly trusted OV certificates have required hardware key storage since June 2023. | Azure Trusted Signing (Artifact Signing), $9.99/mo, individual developers eligible, designed for CI. Identity validation there is the long pole — start it first. |
| WebView2 install mode | No `bundle.windows` block, so the default is `downloadBootstrapper` — a downloader stub, which the Store forbids. | `tauri.microsoftstore.conf.json` (in `hypercomb-client/app/`) sets `offlineInstaller`. Merge it into the config the workflow generates. |
| Installer URL | CI emits run artifacts: they expire and need auth. | A GitHub release step. Release asset URLs are versioned and immutable, which is exactly what the Store requires. |
| Self-update | The Store does not update EXE/MSI listings, and `scripts/client/windows-client.mjs` is a developer tool (gh CLI + CI artifacts). | The Tauri updater plugin, or a "Check for updates" menu item. |
| Privacy policy URL | Required, because the app networks. | `hypercomb-web/public/privacy.html` — ships with every web deploy. Fill in `PRIVACY_CONTACT_EMAIL` and confirm the live URL before pasting it. |
| Store art | Does not exist. | One 1:1 box art tile (the gold hexagon mark), 2:3 poster art recommended, and at least one screenshot — four or more recommended. |

Signing also has a second payoff: it retires the Smart App Control problem
that currently makes this monorepo unbuildable on the author's own machine.

## Building the Store installer

The Store build differs from the public build in exactly one way — the
WebView2 runtime is embedded rather than downloaded at install time. Rather
than passing two `--config` flags, fold the store block into the signing
config the workflow already writes as a heredoc, so one merged config is
passed and the behaviour is identical locally and in CI:

```json
{
  "bundle": {
    "publisher": "Hypercomb Project",
    "windows": {
      "certificateThumbprint": "<thumbprint>",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com",
      "webviewInstallMode": { "type": "offlineInstaller" }
    }
  }
}
```

`publisher` must be set explicitly and must not equal `productName`. Tauri
derives it from the identifier when absent — `io.hypercomb.client` yields
"hypercomb", which collides with the product "Hypercomb" and fails Store
registration. Set it to whatever publisher display name is reserved in
Partner Center.

Silent install, which the Store requires, is already satisfied: NSIS takes
`/S`, MSI takes `/quiet`.

---

# Listing copy

Paste-ready. Character limits noted where Partner Center enforces one.

## Product name

```
Hypercomb
```

## Short description (limit 1,000)

```
A workspace that keeps everything you know on your own machine. Notes, pictures, pages and plans live as hexagonal tiles you can nest, arrange and publish. Every feature is a module you can switch on, off, or replace. No account, no cloud, works offline.
```

## Description (limit 10,000)

```
Hypercomb is a workspace for everything you know, and it lives on your machine rather than on somebody's server.

Your work takes the form of tiles on a honeycomb. A tile can hold a note, a picture, a list, a page, or more tiles — so a single hive can be a project, a journal, a business, a course, or a website, without ever asking you to choose which kind of app you are in.

WHAT IT DOES

- Nest tiles inside tiles, as deep as the subject actually goes.
- Write notes, drop in pictures, and mark tiles up so they group themselves.
- Walk backwards through the history of any page. Every change is recorded, and nothing is quietly overwritten.
- Publish any page as a real website, or serve your whole hive from this machine so other people can read it in their browsers.
- Back the hive up to a folder you choose, in an open format that verifies itself on the way out and refuses damaged content on the way back in.

BUILT OUT OF PARTS YOU CAN REPLACE

Hypercomb is a runtime, not a fixed feature list. Every behaviour — the editor, the views, the games, the publishing — is a separate signed module identified by the hash of its own contents. You turn behaviours on and off per page. You can bring in modules other people have made, and make your own. The application you installed ships with a complete set; nothing has to be fetched for it to work.

That design is also why the hive is portable. Content is addressed by what it is rather than where it sits, so the same hive opens in this application, in a browser, or on a machine somebody else is running — and identical content is stored once, however many places point at it.

YOURS, AND PRIVATE BY DEFAULT

There is no account and no sign-up. There is no analytics, no telemetry and no crash reporting. Nothing is sent anywhere unless you publish it, serve it, or join a shared room — and shared rooms will not send or receive a byte without both a room name and a secret you supply.

OPEN SOURCE

Hypercomb is free software under the GNU Affero General Public License v3.0. The source is public and the file format is documented, so nothing you make here can be locked away from you — including by us.
```

## App features (limit 200 each, 20 max)

```
Nest tiles inside tiles — one hive holds a project, a journal, a business or a course
Walk backwards through the full history of any page; nothing is silently overwritten
Publish any page as a website, or serve the whole hive from this machine
Every feature is a module you can switch on, off, or replace per page
Self-verifying backups to a folder you choose, in an open documented format
Works entirely offline — no account, no sign-up, no cloud
No analytics, no telemetry, no crash reporting
Free software under the AGPL v3.0, with public source
```

## Keywords (7 terms max, 40 chars each, 21 unique words total)

```
notes
knowledge base
offline first
local first
personal wiki
outliner
self hosted
```

## Applicable license terms (required, limit 10,000)

```
Hypercomb is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation.

Hypercomb is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

The full licence text is at https://www.gnu.org/licenses/agpl-3.0.html and is included with the application.

Section 13 of the AGPL applies to this program: if you modify it and let other people interact with the modified version over a network, you must offer those users the source of your modified version. The application includes a feature that serves your hive to other machines; running that feature with the unmodified program imposes no obligation on you.

Documentation is licensed separately under Creative Commons Attribution-ShareAlike 4.0.
```

## Notes for certification (limit 2,000)

This field is the highest-leverage part of the submission: it is where the
dynamic-code question gets answered before a reviewer forms their own theory
about it.

```
Thank you for reviewing. Three notes that anticipate questions this app tends to raise.

1. MODULES ARE NOT REMOTE CODE EXECUTION. Hypercomb is a runtime for interchangeable modules, each identified by a SHA-256 hash of its own contents. This is the app's described functionality and is stated plainly in the listing. The installer ships a complete set of modules and the app adopts the set contained in the installed package: the code that runs after a clean install is the code you certified, and it is not replaced by anything fetched at startup. There is no auto-update of behaviour, no remote configuration, and no server that can change what this app does. A user may deliberately import a module they authored or chose, in the way a user installs an extension; this never happens on its own and never changes the described functionality.

2. LOCAL SERVER, USER-INITIATED. The Hive menu offers "Serve This Hive", which binds a port in the 4270-4279 range so other machines on the user's own network can read content the user has published. It runs only while switched on, stops on quit, and Windows presents its usual firewall prompt on first use. It is off unless chosen, and it serves only published content.

3. NO DATA COLLECTION. There is no account, no sign-in, no analytics, no telemetry and no crash reporting. The hive is one local database file. Network connections occur only where the user publishes, replicates, serves, or joins a shared room; shared rooms refuse to transmit without a user-supplied room and secret. The privacy policy URL in this submission describes this in full.

The app is free software under the AGPL v3.0; the source is public and every claim above can be checked against it.
```

## Other fields

| Field | Value |
|---|---|
| Discoverability | **Available through link** for the first submission — it certifies for real while staying out of search. Switch to full availability once it passes. |
| Pricing | Free |
| Category | Productivity |
| Does this product access, collect or transmit personal information? | **Yes** — it networks. This is what makes the privacy policy URL required. |
| Privacy policy URL | The deployed `privacy.html`. Confirm it is live before submitting. |
| App type (Packages page) | EXE (and MSI, if both are listed) |
| Installer parameters | `/S` for the NSIS `.exe`; `/quiet` for the `.msi` |
| Architecture | x64 |
| Age ratings | Complete the questionnaire; the app has no objectionable content and no user-generated content shared with strangers by default. |

## Order of work

Reserving the name and completing every page except **Packages** needs no
installer and can be done now. Packages needs a signed installer at a
permanent URL, so it waits on the certificate. Trusted Signing onboarding is
the critical path; everything else is a day.
