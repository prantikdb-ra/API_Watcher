// API Watcher - Background Service Worker

const capturedCalls = {};
const badgeCounts   = {};
const networkLog    = {};
const MAX_LOG        = 500;
const pinnedDashboard  = {}; // originKey -> { url, responseBody }
// NOTE: fileMappings and setup data are persisted in chrome.storage.local
// so they survive service worker restarts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'NETWORK_LOG_ENTRY') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: true }); return true; }
    if (!networkLog[tabId]) networkLog[tabId] = [];
    networkLog[tabId].unshift(message.data);
    if (networkLog[tabId].length > MAX_LOG) networkLog[tabId].length = MAX_LOG;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_NETWORK_LOG') {
    sendResponse({ log: networkLog[message.tabId] || [] });
    return true;
  }

  if (message.type === 'PIN_DASHBOARD_ENTRY') {
    pinnedDashboard[message.originKey] = message.entry;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_PINNED_DASHBOARD') {
    sendResponse({ entry: pinnedDashboard[message.originKey] || null });
    return true;
  }

  if (message.type === 'SAVE_SETUP_DATA') {
    // Persist expense/request/benefit type data keyed by origin + type
    const storageKey = 'setupData_' + message.setupType + '_' + message.originKey.replace(/[^a-z0-9]/gi, '_');
    chrome.storage.local.set({ [storageKey]: message.data }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'GET_SETUP_DATA') {
    const storageKey = 'setupData_' + message.setupType + '_' + message.originKey.replace(/[^a-z0-9]/gi, '_');
    chrome.storage.local.get(storageKey, (result) => {
      sendResponse({ data: result[storageKey] || null });
    });
    return true;
  }

  if (message.type === 'SAVE_FILE_MAPPINGS') {
    // Persist to storage.local so it survives service worker restarts
    const storageKey = 'fileMappings_' + message.originKey.replace(/[^a-z0-9]/gi, '_');
    chrome.storage.local.set({ [storageKey]: message.mappings }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'GET_FILE_MAPPINGS') {
    const storageKey = 'fileMappings_' + message.originKey.replace(/[^a-z0-9]/gi, '_');
    chrome.storage.local.get(storageKey, (result) => {
      sendResponse({ mappings: result[storageKey] || null });
    });
    return true;
  }

  if (message.type === 'GET_ALL_NETWORK_LOGS') {
    // Return all logs across all tabs, each entry tagged with its tabId
    const allEntries = [];
    for (const [tabId, entries] of Object.entries(networkLog)) {
      for (const entry of (entries || [])) {
        allEntries.push({ ...entry, _tabId: parseInt(tabId) });
      }
    }
    sendResponse({ entries: allEntries });
    return true;
  }

  if (message.type === 'CLEAR_NETWORK_LOG') {
    networkLog[message.tabId] = [];
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'API_CALL_CAPTURED') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: true }); return true; }
    if (!capturedCalls[tabId]) capturedCalls[tabId] = [];
    capturedCalls[tabId].unshift(message.data);
    if (capturedCalls[tabId].length > MAX_LOG) capturedCalls[tabId].length = MAX_LOG;
    badgeCounts[tabId] = (badgeCounts[tabId] || 0) + 1;
    chrome.action.setBadgeText({ text: String(badgeCounts[tabId]), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#E63946', tabId });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_CAPTURED_CALLS') {
    sendResponse({ calls: capturedCalls[message.tabId] || [] });
    return true;
  }

  if (message.type === 'CLEAR_CAPTURED_CALLS') {
    capturedCalls[message.tabId] = [];
    badgeCounts[message.tabId]   = 0;
    chrome.action.setBadgeText({ text: '', tabId: message.tabId });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['apiIdentifiers', 'isEnabled', 'activeIdentifiers'], (result) => {
      let apiIdentifiers    = result.apiIdentifiers   || [];
      let activeIdentifiers = result.activeIdentifiers || [];

      // Seed default identifiers on first install (when list is empty)
      if (apiIdentifiers.length === 0) {
        const defaults = [
          { id: 'default_expense',     name: 'Expense Types',       type: 'exact', pattern: '/api/v1/expense-types/',       isDefault: true },
          { id: 'default_request',     name: 'Request Types',       type: 'exact', pattern: '/api/v1/request-types/',       isDefault: true },
          { id: 'default_benefit',     name: 'Benefit Types',       type: 'exact', pattern: '/api/v1/benefit-types/',       isDefault: true },
          { id: 'default_sf_jobs',     name: 'SF Integration Jobs', type: 'startswith', pattern: '/api/v1/sf-integration-jobs/', isDefault: true },
        ];
        apiIdentifiers    = defaults;
        activeIdentifiers = defaults.map(d => d.id);
        // Persist so they're saved for future sessions
        chrome.storage.sync.set({ apiIdentifiers, activeIdentifiers });
      }

      sendResponse({
        apiIdentifiers,
        isEnabled:         result.isEnabled !== false,
        activeIdentifiers
      });
    });
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(message.settings, () => sendResponse({ ok: true }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete capturedCalls[tabId];
  delete badgeCounts[tabId];
  delete networkLog[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    capturedCalls[tabId] = [];
    badgeCounts[tabId]   = 0;
    networkLog[tabId]    = [];
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
