// API Watcher — Popup Script

let allCalls  = [];
let networkLog = [];
let settings  = { apiIdentifiers: [], isEnabled: false, activeIdentifiers: [] };
let currentTabId  = null;
let currentTabUrl = '';
let activeTab     = 'watcher';
let addedPaths    = new Set();
let fileMappings  = []; // from /api/v1/file-to-model-mappings/
let rowLogGroups  = {}; // key: `${runId}|${modelCode}|${filename}|${status}` -> accumulated group
let setupData     = { expense: null, request: null, benefit: null }; // captured type configs

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function shortPath(url) {
  try { const u=new URL(url); return u.pathname+(u.search.length>1?u.search.slice(0,30)+(u.search.length>31?'…':''):''); }
  catch { return url.length>60?url.slice(0,57)+'…':url; }
}

function methodCls(m) {
  return ['GET','POST','PUT','DELETE','PATCH'].includes((m||'').toUpperCase()) ? 'm-'+m.toUpperCase() : 'm-other';
}

function statusCls(s) {
  if (!s) return '';
  if (s>=200&&s<300) return 's2';
  if (s>=300&&s<400) return 's3';
  if (s>=400&&s<500) return 's4';
  return 's5';
}

function syntaxHL(obj) {
  if (obj===null||obj===undefined) return '<span class="nl">null</span>';
  if (typeof obj==='string') { const t=obj.length>2000?obj.slice(0,2000)+'…':obj; return `<span class="s">"${esc(t)}"</span>`; }
  if (typeof obj==='number') return `<span class="n">${obj}</span>`;
  if (typeof obj==='boolean') return `<span class="b">${obj}</span>`;
  const j = JSON.stringify(obj,null,2);
  if (!j) return '<span class="nl">null</span>';
  const trimmed = j.length>3000 ? j.slice(0,3000)+'…' : j;
  return esc(trimmed).replace(
    /(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    m => { let c='n'; if(/^&quot;/.test(m)) c=/:$/.test(m)?'k':'s'; else if(/true|false/.test(m)) c='b'; else if(/null/.test(m)) c='nl'; return `<span class="${c}">${m}</span>`; }
  );
}

function showToast(msg, color='var(--accent)') {
  const t = document.getElementById('toast');
  t.textContent=msg; t.style.borderColor=color; t.style.color=color;
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 2200);
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Extract date from Reimburse filename timestamp suffix
// e.g. Employee_JobInformation_20260407T022000.csv → 07/04/2026
function dateFromFilename(filename) {
  const m = String(filename || '').match(/(\d{4})(\d{2})(\d{2})T\d{6}/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`; // DD/MM/YYYY
}

// Strip timestamp suffix and .csv to get the clean model file name
// e.g. Employee_JobInformation_20260407T022000.csv → Employee_JobInformation
function cleanFilename(filename) {
  return String(filename || '')
    .replace(/\.csv$/i, '')
    .replace(/_\d{8}T\d{6}$/, '')
    .trim();
}

// Reimburse SF Integration CSV — one row per file from FILE_PROCESSING stage
// Columns: Date, File Name, Model, Pass, Fail, Total
function buildSFIntegrationCSV(body, mappings) {
  // Build a lookup: file_name base → model title
  const modelLookup = {};
  if (Array.isArray(mappings)) {
    for (const m of mappings) {
      if (m.file_name && m.model_to_map?.title) {
        modelLookup[m.file_name.toLowerCase()] = m.model_to_map.title.replace(/\.csv$/i,'');
      }
    }
  }
  const rows = [];
  const headers = ['Date', 'File Name', 'Model', 'Pass', 'Fail', 'Total'];

  const procStage = body?.logs?.FILE_PROCESSING;
  if (!procStage || typeof procStage !== 'object') return null;

  for (const modelData of Object.values(procStage)) {
    if (!modelData || typeof modelData !== 'object') continue;
    const fileSummary = modelData.file_summary || {};
    for (const [rawKey, fData] of Object.entries(fileSummary)) {
      if (!fData || typeof fData !== 'object') continue;
      const fileName = fData.file_name || rawKey;
      const pass     = fData.row_summary?.success_count ?? 0;
      const fail     = fData.row_summary?.failure_count ?? 0;
      const cleanName = cleanFilename(fileName);
      const modelTitle = modelLookup[cleanName.toLowerCase()] || '';
      rows.push({
        'Date':      dateFromFilename(fileName),
        'File Name': cleanName,
        'Model':     modelTitle,
        'Pass':      pass,
        'Fail':      fail,
        'Total':     pass + fail
      });
    }
  }

  if (rows.length === 0) return null;
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))
  ];
  return lines.join('\r\n');
}

// Generic CSV for any other watcher call
function buildGenericCSV(calls) {
  if (!calls || calls.length === 0) return null;
  const headers = ['API Name', 'HTTP Method', 'Status Code', 'Response'];
  const rows = calls.map(call => ({
    'API Name':    call.matchedIdentifier || call.url || '',
    'HTTP Method': call.method || '',
    'Status Code': call.responseStatus || '',
    'Response':    typeof call.responseBody === 'object'
                     ? JSON.stringify(call.responseBody)
                     : String(call.responseBody ?? '')
  }));
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))
  ];
  return lines.join('\r\n');
}

function downloadCSV() {
  const q = document.getElementById('watcherSearch').value.toLowerCase();
  const calls = q
    ? allCalls.filter(c => c.url?.toLowerCase().includes(q) || c.matchedIdentifier?.toLowerCase().includes(q))
    : allCalls;

  if (calls.length === 0) { showToast('No calls to export', 'var(--orange)'); return; }

  const isSFStages = /\/settings\/sf-integration\/stages/i.test(currentTabUrl);
  let csv = null;
  let filename = `api-watcher-${Date.now()}.csv`;

  if (isSFStages) {
    const stagesCall = calls.find(c => c.responseBody?.logs?.FILE_PROCESSING);
    if (stagesCall) {
      csv = buildSFIntegrationCSV(stagesCall.responseBody, fileMappings);
      const runMatch = currentTabUrl.match(/\/stages\/(\d+)/);
      if (runMatch) filename = `sf-integration-run-${runMatch[1]}.csv`;
    }
  }

  if (!csv) csv = buildGenericCSV(calls);
  if (!csv) { showToast('Nothing to export', 'var(--orange)'); return; }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('\u2713 CSV exported');
}

// ── File Config ──────────────────────────────────────────────────────────────

function renderFileConfig(query) {
  const list  = document.getElementById('fileconfigList');
  const q     = (query||'').toLowerCase().trim();

  if (!fileMappings || fileMappings.length === 0) {
    list.innerHTML = `<div class="fc-no-data">
      <div style="font-size:28px;opacity:.4">📋</div>
      <div style="font-size:12px;font-weight:600;color:var(--text);opacity:.6">No file mappings yet</div>
      <div>Visit <span style="color:var(--accent)">settings/sf-integration/file-configuration</span><br>and the extension will capture the config automatically.</div>
    </div>`;
    document.getElementById('fileconfigCount').textContent = '0';
    return;
  }

  const filtered = q
    ? fileMappings.filter(m =>
        (m.file_name||'').toLowerCase().includes(q) ||
        (m.model_to_map?.title||'').toLowerCase().includes(q) ||
        (m.model_to_map?.code||'').toLowerCase().includes(q)
      )
    : fileMappings;

  document.getElementById('fileconfigCount').textContent = filtered.length;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="fc-no-data"><div style="font-size:28px;opacity:.4">🔍</div><div>No matches found</div></div>`;
    return;
  }

  list.innerHTML = filtered.map((mapping, i) => {
    const cols        = mapping.column_names || {};
    const allCols     = Object.entries(cols);
    const enabledCols = allCols.filter(([,v]) => v.is_enabled);
    const mandCols    = allCols.filter(([,v]) => v.is_mandatory);

    const tableRows = allCols.map(([colName, colData]) => `
      <tr class="${colData.is_enabled ? '' : 'disabled'}">
        <td>${esc(colData.custom || colName)}</td>
        <td style="color:var(--muted)">${esc(colData.default || colName)}</td>
        <td style="text-align:center">${colData.is_enabled ? '<span class="badge-on">✓</span>' : '<span class="badge-off">–</span>'}</td>
        <td style="text-align:center">${colData.is_mandatory ? '<span class="badge-req">★</span>' : '<span class="badge-off">–</span>'}</td>
      </tr>`).join('');

    return `<div class="fc-card" data-i="${i}">
      <div class="fc-header">
        <span class="caret">▶</span>
        <span class="fc-filename">${esc(mapping.file_name || '—')}</span>
        <span class="fc-model">${esc(mapping.model_to_map?.code || '—')}</span>
        <button class="fc-dl-btn" data-i="${i}" title="Download template">⬇</button>
      </div>
      <div class="fc-title">${esc(mapping.model_to_map?.title || '—')}</div>
      <div class="fc-stats">
        <span class="fc-stat">Columns: <b>${allCols.length}</b></span>
        <span class="fc-stat">Enabled: <b style="color:var(--green)">${enabledCols.length}</b></span>
        <span class="fc-stat">Mandatory: <b style="color:var(--orange)">${mandCols.length}</b></span>
      </div>
      <div class="fc-detail">
        <table class="fc-table">
          <thead>
            <tr>
              <th>Custom Name</th>
              <th>Default Name</th>
              <th>Enabled</th>
              <th>Mandatory</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.fc-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.fc-dl-btn')) return;
      card.classList.toggle('expanded');
      const caret = card.querySelector('.caret');
      if (caret) caret.textContent = card.classList.contains('expanded') ? '▼' : '▶';
    });
  });

  // Per-file download buttons
  list.querySelectorAll('.fc-dl-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const mapping = filtered[parseInt(btn.dataset.i)];
      if (mapping) downloadFileTemplate(mapping);
    });
  });
}

// Download a pipe-delimited header-only template for a single file mapping
function downloadFileTemplate(mapping) {
  const cols = mapping.column_names || {};
  // Only enabled columns, using custom name as header
  const enabledHeaders = Object.values(cols)
    .filter(c => c.is_enabled)
    .map(c => c.custom || c.default || '');

  if (enabledHeaders.length === 0) {
    showToast('No enabled columns for this file', 'var(--orange)');
    return;
  }

  // Single header row, pipe-delimited, no data rows
  const content = enabledHeaders.join('|');

  // Filename: use the file_name from mapping (clean, no extension)
  const baseName = (mapping.file_name || 'template')
    .replace(/\.csv$/i, '')
    .replace(/\s+/g, '_');
  const filename = `${baseName}.csv`;

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`\u2713 Downloaded ${filename}`);
}

// Keep exportFileConfig stub so the toolbar button still works — now downloads all as a zip isn't feasible,
// so we repurpose it to show a toast guiding user to use per-file buttons
function exportFileConfig() {
  if (!fileMappings || fileMappings.length === 0) {
    showToast('No file config captured yet', 'var(--orange)');
    return;
  }
  showToast('Use ⬇ on each file to download its template', 'var(--accent2)');
}


// ── Setup Data (Expense / Request / Benefit Types) ───────────────────────────

const SETUP_META = {
  expense: {
    label:    'Expense Types',
    icon:     '💰',
    filename: 'expense-types',
    build:    buildExpenseCSV
  },
  request: {
    label:    'Request Types',
    icon:     '📋',
    filename: 'request-types',
    build:    buildRequestCSV
  },
  benefit: {
    label:    'Benefit Types',
    icon:     '🎁',
    filename: 'benefit-types',
    build:    buildBenefitCSV
  }
};

// ── All possible field extractors ────────────────────────────────────────────
const FIELD_EXTRACTORS = {
  expense: {
    'code':                           e => e.code || '',
    'title':                          e => e.title || '',
    'category.title':                 e => e.category?.title || '',
    'category.code':                  e => e.category?.code || '',
    'is_active':                      e => e.is_active ? 'Yes' : 'No',
    'is_expense_eligibility_enabled': e => e.is_expense_eligibility_enabled ? 'Yes' : 'No',
    'is_attached_to_requests':        e => e.is_attached_to_requests ? 'Yes' : 'No',
    'has_approval_rule':              e => e.has_approval_rule ? 'Yes' : 'No',
    'attached_to_request.titles':     e => Array.isArray(e.attached_to_request) ? e.attached_to_request.map(r => r.title).join(', ') : '',
    'attached_to_request.codes':      e => Array.isArray(e.attached_to_request) ? e.attached_to_request.map(r => r.code).join(', ') : '',
    'id':                             e => e.id ?? '',
  },
  request: {
    'code':           r => r.code || '',
    'title':          r => r.title || '',
    'is_active':      r => r.is_active ? 'Yes' : 'No',
    'is_travel_type': r => r.is_travel_type ? 'Yes' : 'No',
    'id':             r => r.id ?? '',
  },
  benefit: {
    'code':      b => b.code || '',
    'title':     b => b.title || '',
    'is_active': b => b.is_active ? 'Yes' : 'No',
    'id':        b => b.id ?? '',
  }
};

// Map field keys to human-readable column headers
const FIELD_LABELS = {
  'code': 'Code', 'title': 'Title', 'category.title': 'Category',
  'category.code': 'Category Code', 'is_active': 'Active',
  'is_expense_eligibility_enabled': 'Eligibility Enabled',
  'is_attached_to_requests': 'Attached to Requests',
  'has_approval_rule': 'Has Approval Rule',
  'attached_to_request.titles': 'Linked Request Names',
  'attached_to_request.codes': 'Linked Request Codes',
  'is_travel_type': 'Is Travel Type', 'id': 'Internal ID'
};

// Default fields if prefs not yet saved
const DEFAULT_FIELDS = {
  expense: ['code','title','category.title','is_active','is_expense_eligibility_enabled','is_attached_to_requests','has_approval_rule','attached_to_request.titles'],
  request: ['code','title','is_active','is_travel_type'],
  benefit: ['code','title','is_active']
};

function buildExpenseCSV(data) { return buildDynamicCSV('expense', data); }
function buildRequestCSV(data) { return buildDynamicCSV('request', data); }
function buildBenefitCSV(data) { return buildDynamicCSV('benefit', data); }

function buildDynamicCSV(type, data, selectedKeys) {
  const keys = selectedKeys || DEFAULT_FIELDS[type];
  const extractors = FIELD_EXTRACTORS[type];
  const headers = keys.map(k => FIELD_LABELS[k] || k);
  const rows = data.map(item => {
    const row = {};
    keys.forEach((k, i) => { row[headers[i]] = extractors[k] ? extractors[k](item) : ''; });
    return row;
  });
  return { headers, rows };
}

function downloadSetupCSV(type) {
  const data = setupData[type];
  if (!data || data.length === 0) {
    showToast('No data captured yet', 'var(--orange)');
    return;
  }
  const meta = SETUP_META[type];

  // Load saved field prefs from storage, then build and download
  chrome.storage.local.get('exportFieldPrefs', (res) => {
    const prefs = res.exportFieldPrefs;
    const selectedKeys = (prefs && prefs[type] && prefs[type].length > 0)
      ? prefs[type]
      : DEFAULT_FIELDS[type];

    const { headers, rows } = buildDynamicCSV(type, data, selectedKeys);
    const lines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => csvCell(r[h] ?? '')).join(','))
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${meta.filename}-${Date.now()}.csv`
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`✓ ${data.length} ${meta.label.toLowerCase()} exported`);
  });
}

// Render the setup data panel inside Discover tab
function renderSetupPanel() {
  // Remove existing panel if any
  const existing = document.getElementById('setupPanel');
  if (existing) existing.remove();

  const hasAny = setupData.expense || setupData.request || setupData.benefit;
  if (!hasAny) return;

  const panel = document.createElement('div');
  panel.id = 'setupPanel';
  panel.style.cssText = 'flex-shrink:0;padding:6px 8px;background:var(--bg2);border-bottom:1px solid var(--border)';

  const types = ['expense', 'request', 'benefit'];
  panel.innerHTML = `
    <div style="font-family:var(--mono);font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Captured Setup Data</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${types.map(type => {
        const d    = setupData[type];
        const meta = SETUP_META[type];
        if (!d) return '';
        return `<button class="setup-dl-btn" data-type="${type}" style="display:flex;align-items:center;gap:5px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:9px;padding:5px 10px;cursor:pointer;transition:all .15s">
          ${meta.icon} ${meta.label} <span style="color:var(--accent);font-weight:700">${d.length}</span> <span style="color:var(--muted)">⬇</span>
        </button>`;
      }).join('')}
    </div>`;

  // Insert before the item list
  const list = document.getElementById('discoverList');
  list.parentNode.insertBefore(panel, list);

  panel.querySelectorAll('.setup-dl-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--text)'; });
    btn.addEventListener('click', () => downloadSetupCSV(btn.dataset.type));
  });
}

// ── Row Logs ─────────────────────────────────────────────────────────────────
// Detects paginated /rows/ API calls in the network log, groups and accumulates them.

// Parse a /rows/ URL to extract metadata
// URL pattern (page): /api/v1/sf-integration-jobs/{runId}/rows/?file=X&file_name=Y&success=true/false&page=N
// Page URL pattern:   /settings/sf-integration/stages/{runId}/logs/{model}/{filename}/{status}/
function parseRowsUrl(url) {
  try {
    const u    = new URL(url);
    const path = u.pathname;
    const apiMatch = path.match(/\/sf-integration-jobs\/(\d+)\/rows\/?/);
    if (!apiMatch) return null;
    const runId    = apiMatch[1];
    const file     = u.searchParams.get('file') || '';
    const fileName = u.searchParams.get('file_name') || '';
    const page     = parseInt(u.searchParams.get('page') || '1', 10);
    if (!runId || !file) return null;
    // Status is inferred from response data — not a URL param
    return { runId, file, fileName, page, status: null };
  } catch { return null; }
}

// Determine status from the actual row data in the response
function inferStatus(data) {
  if (!Array.isArray(data) || data.length === 0) return 'unknown';
  // All rows in one page response have the same is_success value
  return data[0]?.is_success === true ? 'success' : 'failure';
}

function groupKey(meta) {
  return `${meta.runId}|${meta.file}|${meta.fileName}|${meta.status}`;
}

// Scan network log and build/update rowLogGroups
function buildRowLogGroups(log) {
  const groups = {};
  for (const entry of (log || [])) {
    if (!entry.url) continue;
    const meta = parseRowsUrl(entry.url);
    if (!meta) continue;
    const body = entry.responseBody;
    if (!body || !Array.isArray(body.data)) continue;

    // Infer status from the actual row data
    const status = inferStatus(body.data);
    meta.status  = status;

    const key = groupKey(meta);
    if (!groups[key]) {
      groups[key] = {
        runId:        meta.runId,
        file:         meta.file,
        fileName:     meta.fileName,
        status:       status,
        totalRecords: body.pagination_data?.total_records || 0,
        totalPages:   body.pagination_data?.number_of_pages || 1,
        pages:        {},
      };
    }
    // Store this page's rows (dedup by page number)
    groups[key].pages[meta.page] = body.data;
    // Update totals from latest pagination_data
    if (body.pagination_data?.total_records) {
      groups[key].totalRecords = body.pagination_data.total_records;
      groups[key].totalPages   = body.pagination_data.number_of_pages;
    }
  }
  return groups;
}

function getAllRows(group) {
  // Flatten all captured pages in order
  return Object.keys(group.pages)
    .map(Number).sort((a,b) => a-b)
    .flatMap(p => group.pages[p]);
}

function getCapturedCount(group) {
  return Object.values(group.pages).reduce((s, rows) => s + rows.length, 0);
}

function getCapturedPages(group) {
  return Object.keys(group.pages).length;
}

function renderRowLogs() {
  const list   = document.getElementById('rowlogsList');
  const groups = buildRowLogGroups(networkLog);
  rowLogGroups = groups;

  const keys = Object.keys(groups);
  if (keys.length === 0) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">📄</div>
      <div class="empty-title">No row logs yet</div>
      <div class="empty-sub">Visit a run's failure or success log page and scroll through the records. Each page loaded will be captured here automatically.</div>
    </div>`;
    return;
  }

  // Sort: failures first, then by runId desc
  keys.sort((a,b) => {
    const ga = groups[a], gb = groups[b];
    if (ga.status !== gb.status) return ga.status === 'failure' ? -1 : 1;
    return parseInt(gb.runId) - parseInt(ga.runId);
  });

  list.innerHTML = keys.map(key => {
    const g          = groups[key];
    const captured   = getCapturedCount(g);
    const pages      = getCapturedPages(g);
    const isComplete = captured >= g.totalRecords && g.totalRecords > 0;
    const pct        = g.totalRecords > 0 ? Math.min(100, Math.round((captured / g.totalRecords) * 100)) : 0;
    const isFail     = g.status === 'failure';
    const cleanFile  = g.fileName.replace(/\.csv$/i,'').replace(/_\d{8}T\d{6}$/, '');

    return `<div class="rl-card ${g.status}" data-key="${esc(key)}">
      <div class="rl-header">
        <div class="rl-filename">${esc(cleanFile)}</div>
        <span class="rl-status-badge ${isFail ? 'fail' : 'pass'}">${isFail ? 'FAILURES' : 'SUCCESSES'}</span>
      </div>
      <div class="rl-meta">Run #${esc(g.runId)} &nbsp;·&nbsp; Model: ${esc(g.file)}</div>
      <div class="rl-progress" style="margin-top:8px">
        <div class="rl-progress-text ${isComplete ? 'complete' : ''}">
          ${isComplete
            ? `✓ All <b>${captured.toLocaleString()}</b> rows captured (${pages} pages)`
            : `<b>${captured.toLocaleString()}</b> of <b>${g.totalRecords.toLocaleString()}</b> rows captured — ${pages} of ${g.totalPages} pages`
          }
          ${!isComplete ? `<span style="color:var(--orange);margin-left:6px">↓ Scroll the page to load more</span>` : ''}
        </div>
        <div class="rl-bar-wrap" style="margin-top:4px">
          <div class="rl-bar-fill ${isComplete ? 'complete' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="rl-actions">
        <button class="rl-dl-btn ${isFail ? 'fail-btn' : 'pass-btn'}" data-key="${esc(key)}">
          ⬇ ${isFail ? 'Export Failures' : 'Export Successes'} (${captured.toLocaleString()} rows)
        </button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.rl-dl-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => downloadRowLog(btn.dataset.key));
  });
}

function downloadRowLog(key) {
  const group = rowLogGroups[key];
  if (!group) return;

  const rows = getAllRows(group);
  if (rows.length === 0) { showToast('No rows captured yet', 'var(--orange)'); return; }

  // Collect all row_data keys across all rows (dynamic columns per file type)
  const rowDataKeys = new Set();
  for (const row of rows) {
    if (row.row_data && typeof row.row_data === 'object') {
      Object.keys(row.row_data).forEach(k => rowDataKeys.add(k));
    }
  }
  const dataColumns = [...rowDataKeys];

  // Fixed columns first, then dynamic row_data columns
  const fixedHeaders = ['Row Index', 'Status', 'Message', 'Exception', 'Error Code', 'Error Message'];
  const headers      = [...fixedHeaders, ...dataColumns];

  const lines = [headers.join('|')];

  for (const row of rows) {
    // validation_errors is an object keyed by field name: { "Employee ID": { code, msg }, ... }
    let errorCodes = '';
    let errorMsgs  = '';
    const ve = row.validation_errors;
    if (ve && typeof ve === 'object' && !Array.isArray(ve)) {
      const codes = [], msgs = [];
      for (const fieldData of Object.values(ve)) {
        if (fieldData?.code) codes.push(fieldData.code);
        if (fieldData?.msg)  msgs.push(fieldData.msg);
      }
      errorCodes = codes.join('; ');
      errorMsgs  = msgs.join('; ');
    } else if (Array.isArray(ve) && ve.length > 0) {
      // fallback if it's still an array in some responses
      errorMsgs = ve.join('; ');
    }

    const fixed = [
      row.row_index     ?? '',
      row.is_success    ? 'Pass' : 'Fail',
      row.message       || '',
      row.exception_msg || '',
      errorCodes,
      errorMsgs,
    ];

    const dynamic = dataColumns.map(col => {
      const v = row.row_data?.[col];
      return v === null || v === undefined ? '' : String(v);
    });

    // Pipe-delimited — replace any pipe in values with space
    lines.push([...fixed, ...dynamic].map(v => String(v).replace(/\|/g, ' ')).join('|'));
  }

  const content  = lines.join('\r\n');
  const cleanFile = group.fileName.replace(/\.csv$/i,'').replace(/_\d{8}T\d{6}$/, '');
  const filename  = `${cleanFile}_${group.status}_run${group.runId}.csv`;

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`\u2713 ${lines.length - 1} rows exported`);
}

// ── Discover ──────────────────────────────────────────────────────────────────
function getFilteredLog() {
  const q      = (document.getElementById('discoverSearch').value||'').toLowerCase().trim();
  const method = document.getElementById('methodFilter').value;
  const status = document.getElementById('statusFilter').value;
  return networkLog.filter(entry => {
    if (q && !entry.url.toLowerCase().includes(q)) return false;
    if (method && (entry.method||'').toUpperCase() !== method) return false;
    if (status && !String(entry.responseStatus||'').startsWith(status)) return false;
    return true;
  });
}

function renderDiscover() {
  const list     = document.getElementById('discoverList');
  const filtered = getFilteredLog();
  document.getElementById('logCount').textContent = networkLog.length;
  renderSetupPanel();

  if (networkLog.length === 0) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">No traffic yet</div>
      <div class="empty-sub">All XHR and Fetch calls on this tab are captured automatically as you interact with the page.</div>
    </div>`;
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">No matches</div>
      <div class="empty-sub">Adjust your search or filters.</div>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(entry => {
    let pathname='', host='';
    try { const u=new URL(entry.url); pathname=u.pathname; host=u.hostname; } catch { pathname=entry.url; }
    const alreadyAdded = addedPaths.has(pathname);
    const isJson = entry.contentType?.includes('json') || (entry.responseBody && typeof entry.responseBody==='object');

    return `<div class="log-row">
      <div class="log-row-header">
        <span class="caret">▶</span>
        <span class="method-badge ${methodCls(entry.method)}">${esc(entry.method||'?')}</span>
        <span class="log-path" title="${esc(entry.url)}">${esc(pathname)}</span>
        <span class="status-pill ${statusCls(entry.responseStatus)}">${entry.responseStatus||'—'}</span>
        ${isJson?'<span class="tag-json">JSON</span>':''}
        <button class="add-btn${alreadyAdded?' added':''}" data-path="${esc(pathname)}" ${alreadyAdded?'disabled':''}>
          ${alreadyAdded?'✓ Watching':'+ Watch'}
        </button>
      </div>
      <div class="log-host">${esc(host)}<span class="tag-src" style="margin-left:7px">${esc((entry.source||'').toUpperCase())}</span></div>
      <div class="log-detail">
        <div class="log-full-url">${esc(entry.url)}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.log-row').forEach(row => {
    row.querySelector('.log-row-header').addEventListener('click', e => {
      if (e.target.closest('.add-btn')) return;
      row.classList.toggle('expanded');
      const caret = row.querySelector('.caret');
      if (caret) caret.textContent = row.classList.contains('expanded') ? '▼' : '▶';
    });
  });

  list.querySelectorAll('.add-btn[data-path]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.disabled) return;
      addIdentifier(btn.dataset.path);
    });
  });
}

function addIdentifier(path) {
  if (addedPaths.has(path)) return;
  const id = 'id_' + Math.random().toString(36).slice(2,10);
  settings.apiIdentifiers.push({ id, name: path, type: 'exact', pattern: path });
  settings.activeIdentifiers.push(id);
  addedPaths.add(path);
  chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: { apiIdentifiers: settings.apiIdentifiers, activeIdentifiers: settings.activeIdentifiers }
  }, () => { showToast(`✓ Now watching: ${path}`); updateStatusBar(); renderDiscover(); });
}

// ── Watcher ───────────────────────────────────────────────────────────────────
function renderWatcher(query) {
  const list  = document.getElementById('callList');
  const q     = (query||'').toLowerCase();
  const calls = q ? allCalls.filter(c=>c.url?.toLowerCase().includes(q)||c.matchedIdentifier?.toLowerCase().includes(q)) : allCalls;
  document.getElementById('callCount').textContent = calls.length;

  if (calls.length === 0) {
    const isOn   = settings.isEnabled;
    const hasIds = (settings.activeIdentifiers||[]).length > 0;
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">📡</div>
      <div class="empty-title">${!isOn?'Watcher is Off':!hasIds?'No identifiers set':'Listening…'}</div>
      <div class="empty-sub">${
        !isOn ? 'Toggle the switch above to start matching API calls.' :
        !hasIds ? 'Use the Discover tab to browse traffic and pick APIs to watch.' :
        'Navigate the page — matched calls appear here in real time.'
      }</div>
      ${!hasIds?`<button class="btn-go" id="goDiscover">Go to Discover →</button>`:''}
    </div>`;
    document.getElementById('goDiscover')?.addEventListener('click', ()=>switchTab('discover'));
    return;
  }

  list.innerHTML = calls.map((call,i) => `
    <div class="call-card" data-i="${i}">
      <div class="card-row">
        <span class="method-badge ${methodCls(call.method)}">${esc(call.method||'GET')}</span>
        <span class="card-url" title="${esc(call.url)}">${esc(shortPath(call.url))}</span>
        <span class="status-pill ${statusCls(call.responseStatus)}">${call.responseStatus||'—'}</span>
      </div>
      <div class="card-meta">
        <span class="tag-matched">⚡ ${esc(call.matchedIdentifier||'—')}</span>
        <span class="tag-src">${esc((call.source||'').toUpperCase())}</span>
      </div>
      <div class="card-detail">
        <div class="detail-block">
          <div class="detail-title">Full URL</div>
          <div class="detail-body">${esc(call.url)}</div>
        </div>
        ${call.requestHeaders&&Object.keys(call.requestHeaders).length>0?`
        <div class="detail-block">
          <div class="detail-title">Request Headers</div>
          <div class="detail-body">${syntaxHL(call.requestHeaders)}</div>
        </div>`:''}
        ${call.responseBody!=null?`
        <div class="detail-block">
          <div class="detail-title">Response Body</div>
          <div class="detail-body">${syntaxHL(call.responseBody)}</div>
        </div>`:''}
      </div>
    </div>`).join('');

  list.querySelectorAll('.call-card').forEach(el => el.addEventListener('click', ()=>el.classList.toggle('expanded')));
}

// ── Status bar ────────────────────────────────────────────────────────────────
function updateStatusBar() {
  const n  = (settings.activeIdentifiers||[]).length;
  const on = settings.isEnabled;
  document.getElementById('statusDot').className = 'dot'+(on&&n>0?' on':'');
  document.getElementById('statusText').textContent = on?(n>0?'Watching for API calls':'No identifiers active'):'Watcher inactive';
  document.getElementById('identifierCount').textContent = `${n} identifier${n!==1?'s':''} active`;
  document.getElementById('toggleLabel').textContent = on?'ON':'OFF';
}

// ── Tab switch ────────────────────────────────────────────────────────────────
function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+name));
  if (name==='discover')    renderDiscover();
  if (name==='fileconfig')  renderFileConfig(document.getElementById('fileconfigSearch').value);
  if (name==='rowlogs')     renderRowLogs();
  if (name==='watcher')  renderWatcher(document.getElementById('watcherSearch').value);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId  = tab?.id;
  currentTabUrl = tab?.url || '';
  try { document.getElementById('pageHost').textContent = new URL(currentTabUrl).hostname; } catch {}

  await new Promise(res => chrome.runtime.sendMessage({ type:'GET_SETTINGS' }, r => { settings=r||settings; res(); }));
  addedPaths = new Set((settings.apiIdentifiers||[]).map(id=>id.pattern));

  await new Promise(res => chrome.runtime.sendMessage({ type:'GET_CAPTURED_CALLS', tabId:currentTabId }, r => { allCalls=r?.calls||[]; res(); }));
  await new Promise(res => chrome.runtime.sendMessage({ type:'GET_NETWORK_LOG', tabId:currentTabId }, r => { networkLog=r?.log||[]; res(); }));
  // Load expense/request/benefit setup data
  try {
    const originKey = new URL(currentTabUrl).origin;
    for (const type of ['expense', 'request', 'benefit']) {
      await new Promise(res => chrome.runtime.sendMessage(
        { type: 'GET_SETUP_DATA', setupType: type, originKey }, r => {
          if (r?.data) setupData[type] = r.data;
          res();
        }
      ));
    }
    // Scan all storage as fallback if nothing found for current origin
    if (!setupData.expense && !setupData.request && !setupData.benefit) {
      await new Promise(res => {
        chrome.storage.local.get(null, (all) => {
          for (const [key, val] of Object.entries(all)) {
            if (!Array.isArray(val) || val.length === 0) continue;
            if (key.startsWith('setupData_expense_'))  setupData.expense  = setupData.expense  || val;
            if (key.startsWith('setupData_request_'))  setupData.request  = setupData.request  || val;
            if (key.startsWith('setupData_benefit_'))  setupData.benefit  = setupData.benefit  || val;
          }
          res();
        });
      });
    }
  } catch {}

  // Load file-to-model mappings — try current origin first, then scan storage for any saved mappings
  try {
    const originKey = new URL(currentTabUrl).origin;
    await new Promise(res => chrome.runtime.sendMessage({ type:'GET_FILE_MAPPINGS', originKey }, r => {
      fileMappings = r?.mappings || [];
      res();
    }));
  } catch {}
  // If nothing found for current origin, scan storage.local for any saved mappings
  if (fileMappings.length === 0) {
    await new Promise(res => {
      chrome.storage.local.get(null, (all) => {
        for (const [key, val] of Object.entries(all)) {
          if (key.startsWith('fileMappings_') && Array.isArray(val) && val.length > 0) {
            fileMappings = val;
            break;
          }
        }
        res();
      });
    });
  }

  document.getElementById('mainToggle').checked = settings.isEnabled;
  updateStatusBar();
  renderWatcher('');

  document.getElementById('mainToggle').addEventListener('change', e => {
    settings.isEnabled = e.target.checked;
    chrome.runtime.sendMessage({ type:'SAVE_SETTINGS', settings:{ isEnabled: settings.isEnabled } });
    updateStatusBar();
    if (activeTab==='watcher') renderWatcher(document.getElementById('watcherSearch').value);
  });

  document.getElementById('settingsBtn').addEventListener('click', ()=>chrome.runtime.openOptionsPage());
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click', ()=>switchTab(b.dataset.tab)));
  document.getElementById('watcherSearch').addEventListener('input', e=>renderWatcher(e.target.value));
  document.getElementById('discoverSearch').addEventListener('input', ()=>renderDiscover());
  document.getElementById('methodFilter').addEventListener('change', ()=>renderDiscover());
  document.getElementById('statusFilter').addEventListener('change', ()=>renderDiscover());
  document.getElementById('exportBtn').addEventListener('click', downloadCSV);
  document.getElementById('clearBtn').addEventListener('click', ()=>{
    chrome.runtime.sendMessage({ type:'CLEAR_CAPTURED_CALLS', tabId:currentTabId }, ()=>{ allCalls=[]; renderWatcher(''); });
  });
  document.getElementById('fileconfigSearch').addEventListener('input', e => renderFileConfig(e.target.value));
  document.getElementById('clearRowLogsBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type:'CLEAR_NETWORK_LOG', tabId:currentTabId }, () => {
      networkLog = []; rowLogGroups = {}; renderRowLogs();
    });
  });
  document.getElementById('exportConfigBtn').addEventListener('click', exportFileConfig);
  document.getElementById('clearLogBtn').addEventListener('click', ()=>{
    chrome.runtime.sendMessage({ type:'CLEAR_NETWORK_LOG', tabId:currentTabId }, ()=>{ networkLog=[]; renderDiscover(); });
  });
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
setInterval(() => {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ type:'GET_CAPTURED_CALLS', tabId:currentTabId }, r => {
    const c = r?.calls||[];
    if (c.length!==allCalls.length) { allCalls=c; if(activeTab==='watcher') renderWatcher(document.getElementById('watcherSearch').value); }
  });
  chrome.runtime.sendMessage({ type:'GET_NETWORK_LOG', tabId:currentTabId }, r => {
    const l = r?.log||[];
    if (l.length!==networkLog.length) {
      networkLog=l;
      document.getElementById('logCount').textContent=l.length;
      if(activeTab==='discover') renderDiscover();
      if(activeTab==='rowlogs')  renderRowLogs();
    }
  });
  // Poll for new setup data
  try {
    const originKey = new URL(currentTabUrl).origin;
    for (const type of ['expense', 'request', 'benefit']) {
      chrome.runtime.sendMessage({ type:'GET_SETUP_DATA', setupType: type, originKey }, r => {
        if (r?.data && JSON.stringify(r.data) !== JSON.stringify(setupData[type])) {
          setupData[type] = r.data;
          if (activeTab === 'discover') renderSetupPanel();
        }
      });
    }
  } catch {}
  try {
    const originKey = new URL(currentTabUrl).origin;
    chrome.runtime.sendMessage({ type:'GET_FILE_MAPPINGS', originKey }, r => {
      const m = r?.mappings || [];
      if (m.length > 0 && m.length !== fileMappings.length) {
        fileMappings = m;
        if (activeTab==='fileconfig') renderFileConfig(document.getElementById('fileconfigSearch').value);
      } else if (m.length === 0 && fileMappings.length === 0) {
        // Scan all stored mappings as fallback
        chrome.storage.local.get(null, (all) => {
          for (const [key, val] of Object.entries(all)) {
            if (key.startsWith('fileMappings_') && Array.isArray(val) && val.length > 0) {
              fileMappings = val;
              if (activeTab==='fileconfig') renderFileConfig(document.getElementById('fileconfigSearch').value);
              break;
            }
          }
        });
      }
    });
  } catch {}
}, 1500);

init();
