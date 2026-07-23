"use strict";

const enabled = document.querySelector("#enabled");
const status = document.querySelector("#siteStatus");
const links = document.querySelector("#popupLinks");
const template = document.querySelector("#popupLinkTemplate");
const message = document.querySelector("#popupStatus");
let saveTimer;
let groups = [];

function normalizeDomain(value) {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

chrome.storage.sync.get(SmartAutolinkerDefaults, (settings) => {
  enabled.checked = settings.enabled;
  groups = settings.groups?.length ? settings.groups : SmartAutolinkerDefaults.groups;
  renderGroups();
  settings.replacements.forEach(addLinkRow);
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    try {
      const host = normalizeDomain(new URL(tab.url).hostname);
      const active = settings.domains.some((domain) => host === normalizeDomain(domain) || host.endsWith(`.${normalizeDomain(domain)}`));
      status.textContent = active ? `Active on ${host}` : `Not enabled on ${host || "this page"}`;
      status.className = active ? "active" : "";
    } catch { status.textContent = "Unavailable on this page"; }
  });
});

enabled.addEventListener("change", () => chrome.storage.sync.set({ enabled: enabled.checked }));
document.querySelector("#openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#manageGroups").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#addLink").addEventListener("click", () => {
  const row = addLinkRow({ phrase: "", url: "", enabled: true });
  row.querySelector(".popup-phrase").focus();
});

function addLinkRow(item) {
  const row = template.content.firstElementChild.cloneNode(true);
  row.dataset.id = item.id || crypto.randomUUID();
  row.querySelector(".popup-phrase").value = item.phrase || "";
  row.querySelector(".popup-url").value = item.url || "";
  const select = row.querySelector(".popup-group");
  for (const group of groups) select.add(new Option(group.name, group.id));
  select.value = item.groupId || "general";
  row.querySelector(".popup-item-enabled").checked = item.enabled !== false;
  row.addEventListener("input", scheduleSave);
  row.addEventListener("change", scheduleSave);
  row.querySelector(".popup-remove").addEventListener("click", () => {
    row.remove();
    saveLinks();
  });
  links.append(row);
  return row;
}

function renderGroups() {
  const container = document.querySelector("#popupGroups");
  container.replaceChildren();
  for (const group of groups) {
    const label = document.createElement("label");
    label.className = "group-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = group.enabled !== false;
    checkbox.addEventListener("change", () => {
      group.enabled = checkbox.checked;
      chrome.storage.sync.set({ groups });
    });
    label.append(checkbox, group.name);
    container.append(label);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  message.textContent = "";
  saveTimer = setTimeout(saveLinks, 350);
}

function saveLinks() {
  const replacements = [...links.querySelectorAll(".popup-link")].map((row) => ({
    id: row.dataset.id,
    phrase: row.querySelector(".popup-phrase").value.trim(),
    url: row.querySelector(".popup-url").value.trim(),
    groupId: row.querySelector(".popup-group").value || "general",
    enabled: row.querySelector(".popup-item-enabled").checked
  })).filter((item) => item.phrase || item.url);

  const incomplete = replacements.find((item) => !item.phrase || !item.url);
  const invalid = replacements.find((item) => {
    if (!item.url) return false;
    try { return !["http:", "https:"].includes(new URL(item.url).protocol); } catch { return true; }
  });
  if (incomplete || invalid) {
    message.textContent = incomplete ? "Enter both a phrase and URL to save." : "URLs must begin with http:// or https://";
    message.className = "popup-message error";
    return;
  }
  chrome.storage.sync.set({ replacements }, () => {
    message.textContent = "Saved";
    message.className = "popup-message success";
    setTimeout(() => { if (message.textContent === "Saved") message.textContent = ""; }, 1200);
  });
}
