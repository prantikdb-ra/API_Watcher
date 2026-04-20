# 📡 API Watcher — Chrome Extension

**Version:** 1.1  
**Authors:** Pranzo & Claude  
**Contact:** [prantik_b@rollingarrays.tech](mailto:prantik_b@rollingarrays.tech)

---

## Overview

API Watcher is a Chrome Extension built for **Reimburse implementation consultants**. It passively captures all XHR and Fetch network traffic on any tab, lets you monitor specific API endpoints, and provides structured exports of SF Integration run data — without needing browser DevTools.

---

## Installation

1. Download and unzip the extension folder
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `api-watcher-extension` folder
5. The 📡 icon will appear in your Chrome toolbar

> After updating the extension code, click the **refresh icon** on the extension card at `chrome://extensions` to reload it.

---

## Features

### 👁 Watcher Tab
Monitor specific API endpoints and log every matched call.

- Toggle the watcher ON/OFF using the header switch
- Matched calls appear in real time with method, status, and response body
- Click any call card to expand and view full URL, request headers, and response body (syntax highlighted)
- **⬇ CSV** — exports all captured calls. On SF Integration stages pages, generates a structured report with: `Date | File Name | Model | Pass | Fail | Total`
- **Clear** — resets the captured call list for the current tab

### 🔍 Discover Tab
Browse all XHR/Fetch traffic captured passively from page load.

- Every network call is captured automatically — no action needed
- Filter by URL search, HTTP method, and status code
- Click any row to expand and see the full URL
- **+ Watch** — adds that URL path as an active watcher identifier instantly
- **Clear** — resets the network log for the current tab

### 📋 File Config Tab
View and export the SF Integration file-to-model column mappings.

- Automatically captured when you visit `settings/sf-integration/file-configuration`
- Mappings are **persisted to `chrome.storage.local`** — survive browser restarts
- Each file card shows: file name, model code, model title, and column counts (total / enabled / mandatory)
- Expand any card to see the full column table: Custom Name, Default Name, Enabled, Mandatory
- **⬇ (download button)** on each card — downloads a pipe-delimited (`|`) header-only template CSV, named after the file (e.g. `Employee_BankDetails.csv`). Only enabled columns are included, using custom names. Ready to hand to a client as a data upload template.

### 📄 Row Logs Tab
Capture and export paginated failure/success row logs from SF Integration runs.

- Automatically captures row-level API responses as you browse failure/success log pages
- Handles pagination — each "Show More" page click is captured and accumulated
- Progress bar shows: `300 of 1980 rows captured — 3 of 20 pages`
- Turns green and shows ✓ when all pages have been loaded
- **Export Failures / Export Successes** — downloads a pipe-delimited CSV with all captured rows
- Failures and successes are always exported as **separate files**
- File named: `EmployeeApprovers_failure_run771.csv`

**Row log CSV columns:**
```
Row Index | Status | Message | Exception | Error Code | Error Message | ...row_data fields...
```
- `Error Code` — e.g. `INVALID_EMPLOYEE_ID`
- `Error Message` — e.g. `User with employee id "007561" does not exists.`
- Row data columns are **dynamic** — whatever fields exist in that file type

---

## Settings Page

Manage your API identifiers — the specific URL paths the Watcher tab monitors.

- **Add form:** Enter a label and exact URL path (e.g. `/api/v1/sf-integration-jobs`)
- **Match type:** Always exact pathname match — query strings and fragments are ignored
- **Checkboxes:** Toggle individual identifiers active/inactive without deleting them
- **Select All / Deselect All** for bulk management
- Changes save automatically to `chrome.storage.sync`

> Access settings via: right-click the 📡 icon → **Options**, or the ⚙️ button in the popup.

---

## Key Workflows

### Setting Up a Watcher Identifier
1. Navigate to the target Reimburse page
2. Open the extension → **Discover** tab
3. Interact with the page to trigger API calls
4. Find the call you want to monitor — click to expand
5. Click **+ Watch** — the path is saved and immediately active
6. Switch to **Watcher** tab — future matched calls appear here

### Exporting an SF Integration Run Summary
1. Navigate to `stage.reimburse.work/settings/sf-integration/stages/{id}`
2. Let the page fully load
3. Open the extension → **Watcher** tab
4. Click **⬇ CSV** — downloads `sf-integration-run-{id}.csv` with one row per file

### Exporting Failed Rows
1. Navigate to a run's failure log page: `.../stages/{id}/logs/{model}/{filename}/failure/`
2. Scroll through the records (click "Show More" for each additional page)
3. Open the extension → **Row Logs** tab — see capture progress
4. Once all pages are loaded, click **Export Failures**

### Downloading a Client File Template
1. Navigate to `settings/sf-integration/file-configuration`
2. Let the page load — mappings are captured automatically
3. Open the extension → **File Config** tab
4. Click the **⬇** button on any file to download its pipe-delimited template

---

## Architecture

| File | Role |
|---|---|
| `manifest.json` | Chrome Extension manifest (MV3) |
| `background.js` | Service worker — message router, data store |
| `content.js` | Content script — bridges page ↔ background, auto-detects key responses |
| `injected.js` | Page-context script — monkey-patches `fetch` and `XHR` |
| `popup.html/js` | Extension popup — all 4 tabs |
| `settings.html/js` | Options page — identifier management |

**Data persistence:**
- Network log and captured calls: **in-memory** (cleared on tab navigation)
- File-to-model mappings: **`chrome.storage.local`** (permanent until cleared)
- Watcher identifiers: **`chrome.storage.sync`** (synced across devices)

---

## Supported Pages (Reimburse SF Integration)

| Page | What gets captured |
|---|---|
| `settings/sf-integration/stages/{id}` | Integration run summary (logs, file stats, status) |
| `settings/sf-integration/stages/{id}/logs/{model}/{file}/failure/` | Failed row data (paginated) |
| `settings/sf-integration/stages/{id}/logs/{model}/{file}/success/` | Successful row data (paginated) |
| `settings/sf-integration/file-configuration` | File-to-model column mappings |

---

## Known Limitations

- **In-memory network log** — captured calls and row logs reset on page navigation or browser restart. Open the Row Logs tab and export before navigating away.
- **File mappings persist** — stored in `chrome.storage.local`, available across sessions.
- **Content script requires page reload** — after installing or updating the extension, reload any open tabs before the interceptor takes effect.
- **MV3 service worker sleep** — Chrome may put the background worker to sleep after inactivity. The popup's polling keeps it alive while open.
- **Row log CSV columns are dynamic** — column order in the export reflects the fields present in that specific file type's `row_data`.

---

## Version History

| Version | Date | Notes |
|---|---|---|
| 1.0 | April 2026 | Initial stable release |
| 1.1 | April 2026 | Added Expense/Request/Benefit type capture and export; default watcher identifiers |

---

*API Watcher is an internal tool built for Reimburse implementation consultants at Rolling Arrays.*  
*© 2026 Pranzo & Claude — Rolling Arrays Technology*
