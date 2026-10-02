// hypercomb-hosts — the forwarder every CLAIMED domain is routed to
// (documentation/domain-claim.md).
//
// WHY A SECOND SCRIPT EXISTS AT ALL: every `wrangler deploy` replaces ALL of a
// script's routes with the ones its config declares (wrangler's own comment:
// "PUT will delete previous routes on this script"). A claim adds its two
// routes — `<domain>/*` and `*.<domain>/*` — through the Cloudflare API, at the
// moment the domain goes active. Added to the main worker, they would vanish
// on its next deploy, and every claimed domain with them.
//
// So claimed routes land HERE, on a script whose config (wrangler.hosts.toml)
// declares no routes, so deploying it never touches them. It is deployed once
// and changes only if forwarding does. All it does is hand the request to the
// main worker over a service binding; the URL survives the binding, so the
// main worker resolves the claimed hostname exactly as if it were routed there
// itself, and keeps deploying as it always has.

export default { fetch: (request, env) => env.HOST.fetch(request) }
