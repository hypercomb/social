(function () {
  "use strict";

  let settings = SmartAutolinkerDefaults;
  let timer = null;
  let applying = false;
  let activeChooser = null;

  function normalizeDomain(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .replace(/^\*\./, "");
  }

  function domainEnabled(hostname, domains) {
    const host = normalizeDomain(hostname);
    return (domains || []).some((value) => {
      const domain = normalizeDomain(value);
      return domain && (host === domain || host.endsWith(`.${domain}`));
    });
  }

  function matchingDomain(hostname, domains) {
    const host = normalizeDomain(hostname);
    return (domains || [])
      .map(normalizeDomain)
      .filter((domain) => domain && (host === domain || host.endsWith(`.${domain}`)))
      .sort((a, b) => b.length - a.length)[0] || null;
  }

  function loadSettings() {
    chrome.storage.sync.get(SmartAutolinkerDefaults, (stored) => {
      settings = stored;
    });
  }

  function editableRoot(target) {
    let element = target instanceof Element ? target : target?.parentElement;
    while (element) {
      if (element.hasAttribute("contenteditable")) {
        return element.getAttribute("contenteditable")?.toLowerCase() === "false" ? null : element;
      }
      element = element.parentElement || element.getRootNode?.().host || null;
    }
    return null;
  }

  function editorFromEvent(event) {
    for (const target of event.composedPath?.() || [event.target]) {
      const root = editableRoot(target);
      if (root) return root;
    }
    const selection = document.getSelection();
    return editableRoot(selection?.anchorNode);
  }

  function caretOffset(root) {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    return prefix.toString().length;
  }

  function restoreCaret(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.data.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= node.data.length;
    }
    root.focus();
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function replacementRegex(items) {
    const phrases = [...new Set(items
      .map((item) => item.phrase.trim())
      .filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);
    if (!phrases.length) return null;
    return new RegExp(`(^|[^\\p{L}\\p{N}_])(${phrases.join("|")})(?=$|[^\\p{L}\\p{N}_])`,
      settings.caseSensitive ? "gu" : "giu");
  }

  function showChoice(root, phrase, candidates, decisionKey) {
    activeChooser?.remove();
    const groupNames = new Map((settings.groups || []).map((group) => [group.id, group.name]));
    const menu = document.createElement("div");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", `Choose a link for ${phrase}`);
    Object.assign(menu.style, {
      position: "fixed", zIndex: "2147483647", width: "min(360px, calc(100vw - 24px))",
      padding: "10px", border: "1px solid #cbd8d0", borderRadius: "10px",
      background: "#fff", color: "#17211b", boxShadow: "0 12px 32px rgba(0,0,0,.2)",
      font: "13px/1.35 system-ui, sans-serif"
    });
    const heading = document.createElement("div");
    heading.textContent = `Choose link for “${phrase}”`;
    Object.assign(heading.style, { fontWeight: "700", margin: "0 0 7px" });
    menu.append(heading);
    for (const item of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      const group = groupNames.get(item.groupId || "general") || "General";
      button.textContent = `${group} — ${item.url}`;
      button.title = item.url;
      Object.assign(button.style, {
        display: "block", width: "100%", margin: "5px 0", padding: "8px 9px",
        overflow: "hidden", border: "0", borderRadius: "7px", background: "#e9f5ef",
        color: "#075f46", cursor: "pointer", textAlign: "left", textOverflow: "ellipsis", whiteSpace: "nowrap"
      });
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        menu.remove();
        activeChooser = null;
        linkEditor(root, new Map([[decisionKey, item]]));
      });
      menu.append(button);
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Not now";
    Object.assign(cancel.style, { border: "0", background: "transparent", color: "#66736b", cursor: "pointer", padding: "5px 2px 0" });
    cancel.addEventListener("click", () => { menu.remove(); activeChooser = null; });
    menu.append(cancel);
    document.documentElement.append(menu);
    const selection = document.getSelection();
    const caretRect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const rootRect = root.getBoundingClientRect();
    const anchor = caretRect?.width || caretRect?.height ? caretRect : rootRect;
    const left = Math.max(8, Math.min(anchor.left, innerWidth - 368));
    const below = anchor.bottom + 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${below + menu.offsetHeight < innerHeight ? below : Math.max(8, anchor.top - menu.offsetHeight - 8)}px`;
    activeChooser = menu;
  }

  function eligibleTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.data.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("a, script, style, code, pre")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function linkEditor(root, decisions = new Map()) {
    if (applying || !settings.enabled || !domainEnabled(location.hostname, settings.domains)) return;
    const enabledGroups = new Set((settings.groups || SmartAutolinkerDefaults.groups)
      .filter((group) => group.enabled !== false).map((group) => group.id));
    const site = matchingDomain(location.hostname, settings.domains);
    const siteRule = site && settings.domainGroups?.[site];
    const allowedGroups = Array.isArray(siteRule) ? new Set(siteRule) : null;
    const items = (settings.replacements || []).filter((item) => {
      const groupId = item.groupId || "general";
      return item.enabled !== false && item.phrase && item.url && enabledGroups.has(groupId) && (!allowedGroups || allowedGroups.has(groupId));
    });
    const regex = replacementRegex(items);
    if (!regex) return;

    const lookup = new Map();
    for (const item of items) {
      const key = settings.caseSensitive ? item.phrase.trim() : item.phrase.trim().toLocaleLowerCase();
      if (!lookup.has(key)) lookup.set(key, []);
      if (!lookup.get(key).some((entry) => entry.url === item.url)) lookup.get(key).push(item);
    }
    const savedCaret = caretOffset(root);
    let changed = false;
    const ambiguities = new Map();
    applying = true;

    for (const node of eligibleTextNodes(root)) {
      const text = node.data;
      regex.lastIndex = 0;
      let match;
      let last = 0;
      let hasMatch = false;
      const fragment = document.createDocumentFragment();
      while ((match = regex.exec(text))) {
        const phraseStart = match.index + match[1].length;
        const key = settings.caseSensitive ? match[2] : match[2].toLocaleLowerCase();
        const candidates = lookup.get(key) || [];
        const item = decisions.get(key) || (candidates.length === 1 ? candidates[0] : null);
        if (!item) {
          if (candidates.length > 1) ambiguities.set(key, { phrase: match[2], candidates });
          continue;
        }
        hasMatch = true;
        fragment.append(text.slice(last, phraseStart));
        const link = document.createElement("a");
        link.href = item.url;
        link.textContent = match[2];
        if (settings.openInNewTab) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        fragment.append(link);
        last = phraseStart + match[2].length;
      }
      if (hasMatch) {
        fragment.append(text.slice(last));
        node.replaceWith(fragment);
        changed = true;
      }
    }

    if (changed && savedCaret !== null) restoreCaret(root, savedCaret);
    applying = false;
    if (ambiguities.size && !activeChooser) {
      const [key, ambiguity] = ambiguities.entries().next().value;
      showChoice(root, ambiguity.phrase, ambiguity.candidates, key);
    }
  }

  function schedule(root, delay) {
    if (!root) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const currentRoot = root.isConnected ? root : editableRoot(document.getSelection()?.anchorNode);
      if (currentRoot) linkEditor(currentRoot);
    }, delay);
  }

  document.addEventListener("input", (event) => schedule(editorFromEvent(event), 80), true);
  document.addEventListener("paste", (event) => schedule(editorFromEvent(event), 30), true);

  // Framework editors sometimes replace their inner nodes after dispatching input.
  // Watching DOM changes lets us run after that render rather than modifying a stale node.
  const observer = new MutationObserver((mutations) => {
    if (applying || !settings.enabled || !domainEnabled(location.hostname, settings.domains)) return;
    for (const mutation of mutations) {
      const root = editableRoot(mutation.target);
      if (root) {
        schedule(root, 100);
        return;
      }
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") loadSettings();
  });
  loadSettings();
})();
