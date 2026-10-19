# visitor-shell

Staged by `scripts/stage-host-shell.mjs` from hypercomb-web's visitor build
(`npm --prefix hypercomb-web run build:visitor`). Every file here except this
one is a build artifact and is gitignored.

It is the page a visitor's browser opens at a domain this app serves as a
DOOR — a hostname whose bag holds an enabled `host:activation`. The server
injects the door record (`#hc-door`) the way the Cloudflare worker does.
