// hypercomb.worker.js
// production service worker
// - serves OPFS-backed ESM dependencies
// - content-addressed by signature
// - no framework coupling
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith("/opfs/__dependencies__/")) return;

   // <- this will break every time the URL matches
  event.respondWith(handleDependencyRequest(url));
});

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith("/opfs/__dependencies__/")) return;

  event.respondWith(handleDependencyRequest(url));
});

async function handleDependencyRequest(url) {
  try {
    const sig = url.pathname.split("/").pop().replace(".js", "");
    if (!sig || !/^[a-f0-9]{64}$/i.test(sig)) {
      return new Response("invalid signature", { status: 400 });
    }

    const root = await navigator.storage.getDirectory();
    const depDir = await root.getDirectoryHandle("__dependencies__");
    const fileHandle = await depDir.getFileHandle(sig);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return new Response("dependency not found", { status: 404 });
  }
}
