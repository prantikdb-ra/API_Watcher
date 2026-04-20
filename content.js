// API Watcher - Content Script
// 1. Injects the page-level interceptor
// 2. Passively logs ALL XHR/Fetch to background (network log / discover)
// 3. Routes matched calls to background (watcher)

(function () {
  'use strict';

  // ── Inject interceptor ────────────────────────────────────────────────────
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  // ── Settings cache ────────────────────────────────────────────────────────
  let cachedSettings = null;
  let settingsLoaded = false;

  function loadSettings(cb) {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
      cachedSettings = res;
      settingsLoaded = true;
      cb(res);
    });
  }

  function matchesIdentifier(url, identifier) {
    try {
      const pathname = new URL(url).pathname;
      if (identifier.type === 'startswith') {
        return pathname.startsWith(identifier.pattern);
      }
      return pathname === identifier.pattern;
    } catch { return false; }
  }

  function findMatch(url, settings) {
    if (!settings?.isEnabled) return null;
    const active = (settings.activeIdentifiers || []);
    const ids    = (settings.apiIdentifiers   || []).filter(id => active.includes(id.id));
    return ids.find(id => matchesIdentifier(url, id)) || null;
  }

  // ── Handle every network event ────────────────────────────────────────────
  window.addEventListener('__apiwatcher_net__', (event) => {
    const data = event.detail;
    if (!data?.url) return;

    // Always send to passive network log (discover tab)
    chrome.runtime.sendMessage({ type: 'NETWORK_LOG_ENTRY', data });

    // ── Auto-detect dashboard source ─────────────────────────────────────────
    const body = data.responseBody;
    let originKey = '';
    try { originKey = new URL(data.url).origin; } catch {}

    if (originKey && body && typeof body === 'object') {

      // Integration run object → pin as dashboard source
      if (body.logs && body.status && body.started_on) {
        chrome.runtime.sendMessage({
          type: 'PIN_DASHBOARD_ENTRY',
          originKey,
          entry: { url: data.url, responseBody: body }
        });
      }

      // File-to-model mappings → detect by URL pattern OR response shape
      const isFileMappingUrl = data.url && data.url.includes('file-to-model-mappings');
      const isFileMappingShape = (
        Array.isArray(body) &&
        body.length > 0 &&
        body[0]?.model_to_map?.code &&
        body[0]?.file_name !== undefined &&
        body[0]?.column_names !== undefined
      );
      if (isFileMappingUrl || isFileMappingShape) {
        chrome.runtime.sendMessage({
          type: 'SAVE_FILE_MAPPINGS',
          originKey,
          mappings: Array.isArray(body) ? body : []
        });
      }

      // Expense / Request / Benefit types → detect by URL pattern
      if (Array.isArray(body) && body.length > 0 && data.url) {
        let setupType = null;
        if (data.url.includes('expense-types'))  setupType = 'expense';
        if (data.url.includes('request-types'))  setupType = 'request';
        if (data.url.includes('benefit-types'))  setupType = 'benefit';
        if (setupType) {
          chrome.runtime.sendMessage({
            type: 'SAVE_SETUP_DATA',
            originKey,
            setupType,
            data: body
          });
        }
      }
    }

    // Also check against watcher identifiers
    const process = (settings) => {
      const matched = findMatch(data.url, settings);
      if (!matched) return;
      chrome.runtime.sendMessage({
        type: 'API_CALL_CAPTURED',
        data: {
          ...data,
          matchedIdentifier:   matched.name || matched.pattern,
          matchedIdentifierId: matched.id
        }
      });
    };

    if (settingsLoaded) process(cachedSettings);
    else loadSettings(process);
  });

  // ── Reload settings on change ─────────────────────────────────────────────
  chrome.storage.onChanged.addListener(() => {
    settingsLoaded = false;
    loadSettings(() => {});
  });
})();
