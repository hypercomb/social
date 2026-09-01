const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const extensionDir = __dirname;
const defaultsSource = fs.readFileSync(path.join(extensionDir, "defaults.js"), "utf8");
const contentSource = fs.readFileSync(path.join(extensionDir, "content.js"), "utf8");

function wait(ms = 180) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createPage({ hostname = "www.linkedin.com", settings = {}, hive = null, html = "" } = {}) {
  const dom = new JSDOM(
    `<!doctype html><body><div id="editor" contenteditable="true">${html}</div></body>`,
    { runScripts: "dangerously", url: `https://${hostname}/article/edit`, pretendToBeVisual: true }
  );
  const stored = {
    enabled: true,
    caseSensitive: false,
    openInNewTab: true,
    domains: ["linkedin.com"],
    groups: [{ id: "general", name: "General", enabled: true }],
    domainGroups: {},
    replacements: [
      { id: "hypercomb", phrase: "hypercomb", url: "https://hypercomb.io", groupId: "general", enabled: true }
    ],
    ...settings
  };
  const changeListeners = [];
  dom.window.chrome = {
    storage: {
      sync: {
        get(_defaults, callback) { callback(structuredClone(stored)); }
      },
      local: {
        get(_defaults, callback) { callback({ hive: structuredClone(hive) }); }
      },
      onChanged: {
        addListener(listener) { changeListeners.push(listener); }
      }
    }
  };
  dom.window.eval(defaultsSource);
  dom.window.eval(contentSource);
  await wait(0);
  return {
    dom,
    editor: dom.window.document.querySelector("#editor"),
    notifySettingsChanged() {
      for (const listener of changeListeners) listener({}, "sync");
    }
  };
}

async function run() {
  {
    const page = await createPage({ html: "Meet hypercomb today." });
    page.editor.dispatchEvent(new page.dom.window.InputEvent("input", { bubbles: true }));
    await wait();
    const link = page.editor.querySelector("a");
    assert.equal(link?.textContent, "hypercomb");
    assert.equal(link?.href, "https://hypercomb.io/");
    assert.equal(link?.target, "_blank");
  }

  {
    const page = await createPage({ html: "hypercombed is not hypercomb" });
    page.editor.dispatchEvent(new page.dom.window.Event("paste", { bubbles: true }));
    await wait();
    assert.equal(page.editor.querySelectorAll("a").length, 1);
    assert.equal(page.editor.textContent, "hypercombed is not hypercomb");
  }

  {
    const page = await createPage({
      html: '<a href="https://already.example">hypercomb</a> plus hypercomb'
    });
    page.editor.dispatchEvent(new page.dom.window.InputEvent("input", { bubbles: true }));
    await wait();
    const links = [...page.editor.querySelectorAll("a")];
    assert.equal(links.length, 2);
    assert.equal(links[0].href, "https://already.example/");
    assert.equal(links[1].href, "https://hypercomb.io/");
  }

  {
    const page = await createPage({ hostname: "mail.google.com", html: "hypercomb" });
    page.editor.dispatchEvent(new page.dom.window.InputEvent("input", { bubbles: true }));
    await wait();
    assert.equal(page.editor.querySelector("a"), null);
  }

  {
    const page = await createPage({
      hostname: "mail.google.com",
      settings: { domains: ["linkedin.com", "google.com"] },
      html: "hypercomb"
    });
    page.editor.dispatchEvent(new page.dom.window.InputEvent("input", { bubbles: true }));
    await wait();
    assert.equal(page.editor.querySelector("a")?.href, "https://hypercomb.io/");
  }

  {
    // Synced hive replacements (local storage) link alongside manual ones,
    // and a disabled site's items stay inert.
    const page = await createPage({
      hive: {
        sites: [
          { host: "revolucion.test", title: "Revolución", enabled: true },
          { host: "dark.test", title: "Dark", enabled: false }
        ],
        replacements: [
          { id: "hive:revolucion.test:flavor-wheel", phrase: "Flavor Wheel", url: "https://revolucion.test/flavor-wheel", groupId: "hive", siteHost: "revolucion.test", enabled: true },
          { id: "hive:dark.test:root", phrase: "Dark", url: "https://dark.test/", groupId: "hive", siteHost: "dark.test", enabled: true }
        ]
      },
      html: "The flavor wheel beats Dark and hypercomb agrees."
    });
    page.editor.dispatchEvent(new page.dom.window.InputEvent("input", { bubbles: true }));
    await wait();
    const links = [...page.editor.querySelectorAll("a")].map((a) => a.href);
    assert.ok(links.includes("https://revolucion.test/flavor-wheel"), "hive item links");
    assert.ok(links.includes("https://hypercomb.io/"), "manual item still links");
    assert.ok(!links.includes("https://dark.test/"), "disabled site stays inert");
  }

  console.log("Smart Autolinker content tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
