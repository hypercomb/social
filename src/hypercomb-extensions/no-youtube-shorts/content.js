(function () {
  "use strict";

  const STYLE_ID = "no-youtube-shorts-style";
  let enabled = true;
  let scanTimer;

  const css = `
    ytd-reel-shelf-renderer,
    ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
    ytd-guide-entry-renderer:has(a[href^="/shorts"]),
    ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),
    ytd-video-renderer:has(a[href^="/shorts/"]),
    ytd-grid-video-renderer:has(a[href^="/shorts/"]),
    ytd-rich-item-renderer:has(a[href^="/shorts/"]),
    ytm-reel-shelf-renderer,
    ytm-pivot-bar-item-renderer:has(a[href^="/shorts"]),
    ytm-video-with-context-renderer:has(a[href^="/shorts/"]),
    a[title="Shorts"][href^="/shorts"] {
      display: none !important;
    }
  `;

  function setStyle(active) {
    let style = document.getElementById(STYLE_ID);
    if (active && !style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = css;
      (document.head || document.documentElement).append(style);
    } else if (!active) {
      style?.remove();
    }
  }

  function redirectShort() {
    if (!enabled || !location.pathname.startsWith("/shorts/")) return;
    const videoId = location.pathname.split("/")[2];
    location.replace(videoId ? `/watch?v=${encodeURIComponent(videoId)}` : "/");
  }

  function labelFor(element) {
    return [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function activateFewerShorts() {
    if (!enabled) return;
    const controls = document.querySelectorAll("button, [role='button'], ytd-button-renderer, tp-yt-paper-item");
    for (const control of controls) {
      const label = labelFor(control);
      if (/^(show|view|see) fewer shorts\b/.test(label) || label.includes("show fewer shorts")) {
        const clickable = control.matches("button, [role='button'], tp-yt-paper-item")
          ? control : control.querySelector("button, [role='button']");
        if (clickable && !clickable.dataset.noShortsActivated) {
          clickable.dataset.noShortsActivated = "true";
          clickable.click();
        }
      }
    }
  }

  function apply() {
    setStyle(enabled);
    redirectShort();
    activateFewerShorts();
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(apply, 120);
  }

  chrome.storage.sync.get({ noYouTubeShortsEnabled: true }, (stored) => {
    enabled = stored.noYouTubeShortsEnabled;
    apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.noYouTubeShortsEnabled) return;
    enabled = changes.noYouTubeShortsEnabled.newValue;
    apply();
  });
  const observer = new MutationObserver(schedule);
  function startObserver() {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  document.documentElement ? startObserver() : addEventListener("DOMContentLoaded", startObserver, { once: true });
  addEventListener("yt-navigate-finish", schedule, true);
  addEventListener("popstate", schedule, true);
})();
