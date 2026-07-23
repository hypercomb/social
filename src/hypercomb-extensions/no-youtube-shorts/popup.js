"use strict";

const enabled = document.querySelector("#enabled");
chrome.storage.sync.get({ noYouTubeShortsEnabled: true }, (stored) => {
  enabled.checked = stored.noYouTubeShortsEnabled;
});
enabled.addEventListener("change", () => {
  chrome.storage.sync.set({ noYouTubeShortsEnabled: enabled.checked });
});
