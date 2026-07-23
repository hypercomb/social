(function (root) {
  "use strict";

  const defaults = {
    enabled: true,
    caseSensitive: false,
    openInNewTab: true,
    domains: ["linkedin.com"],
    groups: [{ id: "general", name: "General", enabled: true }],
    domainGroups: {},
    replacements: [
      { id: "hypercomb", phrase: "hypercomb", url: "https://hypercomb.io", groupId: "general", enabled: true }
    ]
  };

  root.SmartAutolinkerDefaults = defaults;
})(globalThis);
