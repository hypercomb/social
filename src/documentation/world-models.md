# World models — the entrance

**Status: the entrance layer, 2026-10-29.** Five traits, one page, no fillers. The chat harness, the vendor plugs, and the subdomain door are later.

A world model predicts what a scene does next. This layer is the entrance to that integration. It lives in the essentials package at `hypercomb-essentials/src/world-models/`. `/world-models` opens the page. The page is a shell surface, `hc-world-models`, contributed by `WorldModelsDrone`. It is not a tag in either `app.html`.

## The traits

Each trait is declared `{ word, needs: true }`. There is no own version and no child folder. A trait is the name of the next layer and the label of an open seat. Extruding one later means a layer of its own, named that word, with its own signature. A trait is a word, not a subdomain.

| Trait | What a later extrusion fills |
|---|---|
| `subscription` | The visitor connects a subscription they already pay for. The secret stays on their device. |
| `language-model` | The model they bring. The chat harness, on the door, is what will speak. |
| `world` | A durable world kept as a signed artifact: a splat, a mesh, a panorama. |
| `clip` | A finished video kept as a signed artifact. |
| `session` | A live world. What is kept is a recording, signed. |

The page draws the five seats and one invitation: this door is where you connect a subscription and a language model you already have. The conversation arrives with the door. The page does not collect a secret, does not call a vendor, and does not write a pool or a layer. Its copy is registered from the module under `diamondcoreprocessor.com`, English. The shared catalogs are not the source.

## What is deferred

- The chat harness. It loads on demand once a subdomain door is added, and it keeps loading from there. This page does not fetch it.
- Vendor plugs. World Labs fills `world`. OpenRouter's video API fills `clip`. A live host such as fal Worlds fills `session`. NVIDIA Cosmos is the self-hosted predictor, beside `world`.
- A secret field. `subscription` is the seat. Connecting one uses the device-local store that already exists.

## Where it runs

Structural work is on localhost, the origin this machine owns. A later door, when asked for, is `try-world-models` on a zone whose host API this machine holds: `jwize.com`, or `try-world-models.localhost`. Debugging on a domain this machine does not own deploys onto that domain, and a sandbox door publishes the package for anyone to run. Signed bytes are safe to run because every byte is checked against its signature. That starts at a door this machine owns.

Publishing the essentials package is a separate act. This folder, its traits, its page, and this note are what that package needs for the work to continue. Opening, pruning, and minting leave the running trunk where it is until a person takes the package.
