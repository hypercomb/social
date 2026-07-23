"use strict";

const replacementList = document.querySelector("#replacementList");
const replacementTemplate = document.querySelector("#replacementTemplate");
const groupList = document.querySelector("#groupList");
const groupTemplate = document.querySelector("#groupTemplate");
const domains = new Set();
let domainGroups = {};

function currentGroups() {
  return [...groupList.querySelectorAll(".group-row")].map((row) => ({
    id: row.dataset.id,
    name: row.querySelector(".group-name").value.trim() || "Untitled group",
    enabled: row.querySelector(".group-enabled input").checked
  }));
}

function fillGroupSelect(select, selected) {
  select.replaceChildren();
  const groups = currentGroups();
  for (const group of groups) select.add(new Option(group.name, group.id));
  select.value = groups.some((group) => group.id === selected) ? selected : groups[0]?.id || "";
}

function refreshGroupReferences() {
  for (const select of replacementList.querySelectorAll(".item-group")) {
    const selected = select.value;
    fillGroupSelect(select, selected);
  }
  renderDomainRules();
}

function addGroup(group = { name: "", enabled: true }) {
  const row = groupTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = group.id || crypto.randomUUID();
  row.querySelector(".group-name").value = group.name || "";
  row.querySelector(".group-enabled input").checked = group.enabled !== false;
  row.querySelector(".group-name").addEventListener("input", refreshGroupReferences);
  row.querySelector(".remove-group").addEventListener("click", () => {
    if (groupList.children.length === 1) return;
    const removedId = row.dataset.id;
    row.remove();
    for (const domain of Object.keys(domainGroups)) domainGroups[domain] = domainGroups[domain].filter((id) => id !== removedId);
    refreshGroupReferences();
  });
  groupList.append(row);
  return row;
}

function addReplacement(item = { phrase: "", url: "", enabled: true }) {
  const row = replacementTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = item.id || crypto.randomUUID();
  row.querySelector(".phrase").value = item.phrase || "";
  row.querySelector(".url").value = item.url || "";
  row.querySelector(".item-enabled").checked = item.enabled !== false;
  fillGroupSelect(row.querySelector(".item-group"), item.groupId || "general");
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  replacementList.append(row);
}

function normalizeDomain(value) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^\*\./, "").split(/[/?#]/)[0];
}

function renderDomains() {
  const container = document.querySelector("#domainList");
  container.replaceChildren();
  for (const domain of [...domains].sort()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.append(domain);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${domain}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => { domains.delete(domain); delete domainGroups[domain]; renderDomains(); renderDomainRules(); });
    chip.append(remove);
    container.append(chip);
  }
  renderDomainRules();
}

function renderDomainRules() {
  const container = document.querySelector("#domainRules");
  container.replaceChildren();
  const groups = currentGroups();
  for (const domain of [...domains].sort()) {
    const card = document.createElement("div");
    card.className = "domain-rule";
    const title = document.createElement("strong");
    title.textContent = `${domain} groups`;
    const choices = document.createElement("div");
    choices.className = "domain-rule-groups";
    const configured = Array.isArray(domainGroups[domain]) ? new Set(domainGroups[domain]) : new Set(groups.map((group) => group.id));
    for (const group of groups) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = configured.has(group.id);
      checkbox.addEventListener("change", () => {
        const selected = new Set(domainGroups[domain] || groups.map((entry) => entry.id));
        checkbox.checked ? selected.add(group.id) : selected.delete(group.id);
        domainGroups[domain] = [...selected];
      });
      label.append(checkbox, group.name);
      choices.append(label);
    }
    card.append(title, choices);
    container.append(card);
  }
}

chrome.storage.sync.get(SmartAutolinkerDefaults, (settings) => {
  (settings.groups?.length ? settings.groups : SmartAutolinkerDefaults.groups).forEach(addGroup);
  settings.replacements.forEach(addReplacement);
  settings.domains.map(normalizeDomain).filter(Boolean).forEach((domain) => domains.add(domain));
  domainGroups = settings.domainGroups || {};
  document.querySelector("#caseSensitive").checked = settings.caseSensitive;
  document.querySelector("#openInNewTab").checked = settings.openInNewTab;
  renderDomains();
});

document.querySelector("#addGroup").addEventListener("click", () => {
  const row = addGroup({ name: "New group", enabled: true });
  refreshGroupReferences();
  row.querySelector(".group-name").select();
});
document.querySelector("#addReplacement").addEventListener("click", () => addReplacement());
document.querySelector("#domainForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#newDomain");
  const domain = normalizeDomain(input.value);
  if (domain && domain.includes(".")) domains.add(domain);
  input.value = "";
  renderDomains();
});

document.querySelector("#save").addEventListener("click", () => {
  const groups = currentGroups();
  const validGroupIds = new Set(groups.map((group) => group.id));
  const replacements = [...replacementList.querySelectorAll(".replacement-row")].map((row) => ({
    id: row.dataset.id,
    phrase: row.querySelector(".phrase").value.trim(),
    url: row.querySelector(".url").value.trim(),
    groupId: validGroupIds.has(row.querySelector(".item-group").value) ? row.querySelector(".item-group").value : groups[0].id,
    enabled: row.querySelector(".item-enabled").checked
  })).filter((item) => item.phrase && item.url);

  const invalid = replacements.find((item) => {
    try { return !["http:", "https:"].includes(new URL(item.url).protocol); } catch { return true; }
  });
  const status = document.querySelector("#saveStatus");
  if (invalid) {
    status.textContent = `Use a full http(s) URL for “${invalid.phrase}”.`;
    status.className = "error";
    return;
  }
  for (const domain of domains) {
    if (!Array.isArray(domainGroups[domain])) domainGroups[domain] = groups.map((group) => group.id);
    domainGroups[domain] = domainGroups[domain].filter((id) => validGroupIds.has(id));
  }
  chrome.storage.sync.set({
    groups, replacements, domainGroups, domains: [...domains],
    caseSensitive: document.querySelector("#caseSensitive").checked,
    openInNewTab: document.querySelector("#openInNewTab").checked
  }, () => {
    status.textContent = "Saved";
    status.className = "success";
    setTimeout(() => { status.textContent = ""; }, 1800);
  });
});
