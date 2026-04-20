// API Watcher — Dashboard Script
// Strategy: 
//   1. Ask background for the network log of the source tab
//   2. Find the entry that matches /stages/{runId} with a JSON response body
//   3. Use that captured response directly — no new fetch needed
//   4. Fallback: try common API URL patterns with credentials

const params   = new URLSearchParams(location.search);
const origin   = params.get('origin')  || '';
const runId    = params.get('runId')   || '';
const pageUrl  = params.get('pageUrl') || '';
const srcTabId = parseInt(params.get('tabId') || '0', 10);

document.getElementById('topOrigin').textContent = origin ? new URL(origin).hostname : '—';
document.getElementById('topRunId').textContent  = runId || '—';

// ── Stage metadata ────────────────────────────────────────────────────────────
const STAGE_META = {
  CONNECTION:      { icon: '🔌', label: 'Connection'    },
  FILE_AVAILABLE:  { icon: '📂', label: 'File Available' },
  FILE_IMPORTED:   { icon: '📥', label: 'Imported'      },
  FILE_PROCESSING: { icon: '⚙️', label: 'Processing'    },
};
const STAGE_ORDER = ['CONNECTION', 'FILE_AVAILABLE', 'FILE_IMPORTED', 'FILE_PROCESSING'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  } catch { return iso; }
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = parseFloat(ms);
  if (isNaN(s)) return '—';
  if (s < 60) return `${s.toFixed(2)}s`;
  return `${Math.floor(s/60)}m ${(s%60).toFixed(0)}s`;
}

function statusChipHtml(status) {
  const s   = (status||'').toUpperCase();
  const cls = s==='COMPLETED' ? 'chip-completed' : s==='FAILED' ? 'chip-failed' : 'chip-running';
  return `<div class="status-chip ${cls}"><span class="chip-dot"></span>${esc(s||'UNKNOWN')}</div>`;
}

// ── Data extraction ───────────────────────────────────────────────────────────
function extractStages(logs) {
  const result = {};
  for (const stageName of STAGE_ORDER) {
    const stageData = logs[stageName];
    if (!stageData) { result[stageName] = null; continue; }

    if (stageName === 'CONNECTION') {
      result[stageName] = {
        isSuccess:    stageData.is_success,
        message:      stageData.message,
        createdOn:    stageData.created_on,
        exceptionMsg: stageData.exception_msg || '',
        files: []
      };
      continue;
    }

    const files = [];
    for (const [, modelData] of Object.entries(stageData)) {
      if (typeof modelData !== 'object' || !modelData) continue;
      const fileSummary = modelData.file_summary || {};
      for (const [fileName, fData] of Object.entries(fileSummary)) {
        if (typeof fData !== 'object' || !fData) continue;
        files.push({
          fileName:     fData.file_name                    || fileName,
          modelToMap:   fData.model_to_map                 || '',
          isSuccess:    fData.is_success,
          message:      fData.message                      || '',
          createdOn:    fData.created_on                   || '',
          exceptionMsg: fData.exception_msg                || '',
          successCount: fData.row_summary?.success_count   ?? null,
          failureCount: fData.row_summary?.failure_count   ?? null,
          id:           fData.id,
        });
      }
    }

    result[stageName] = { isSuccess: files.every(f => f.isSuccess), files };
  }
  return result;
}

function collectFiles(stages) {
  const map = {};
  for (const stageName of STAGE_ORDER) {
    if (stageName === 'CONNECTION') continue;
    const stage = stages[stageName];
    if (!stage) continue;
    for (const f of stage.files) {
      if (!map[f.fileName]) map[f.fileName] = { fileName: f.fileName, modelToMap: f.modelToMap, stageResults: {} };
      map[f.fileName].stageResults[stageName] = f;
    }
  }
  return Object.values(map);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  const stages = extractStages(data.logs || {});
  const files  = collectFiles(stages);

  let totalSuccess = 0, totalFailure = 0;
  const procStage = stages['FILE_PROCESSING'];
  if (procStage) {
    for (const f of procStage.files) {
      totalSuccess += f.successCount || 0;
      totalFailure += f.failureCount || 0;
    }
  }
  const totalRows  = totalSuccess + totalFailure;
  const successPct = totalRows > 0 ? Math.round((totalSuccess/totalRows)*100) : null;

  // Update topbar status chip
  const chipEl = document.getElementById('topStatus');
  if (chipEl) chipEl.outerHTML = statusChipHtml(data.status);

  document.getElementById('pageContent').innerHTML = `

    <div class="summary-grid">
      <div class="summary-card" style="--card-color:var(--green)">
        <div class="card-label">Records Processed</div>
        <div class="card-value">${totalSuccess.toLocaleString()}</div>
        <div class="card-sub">successful rows</div>
      </div>
      <div class="summary-card" style="--card-color:${totalFailure>0?'var(--red)':'var(--green)'}">
        <div class="card-label">Failed Rows</div>
        <div class="card-value">${totalFailure.toLocaleString()}</div>
        <div class="card-sub">${successPct!==null ? successPct+'% success rate' : '—'}</div>
      </div>
      <div class="summary-card" style="--card-color:var(--accent)">
        <div class="card-label">Files Processed</div>
        <div class="card-value">${files.length}</div>
        <div class="card-sub">in this run</div>
      </div>
      <div class="summary-card" style="--card-color:var(--purple)">
        <div class="card-label">Duration</div>
        <div class="card-value">${fmtDuration(data.time_taken)}</div>
        <div class="card-sub">total run time</div>
      </div>
    </div>

    <div class="meta-row">
      <div class="meta-card">
        <div class="meta-label">Started</div>
        <div class="meta-value">${fmtDate(data.started_on)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Completed</div>
        <div class="meta-value">${fmtDate(data.completed_on)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Run ID</div>
        <div class="meta-value">#${esc(String(data.id||runId))}</div>
      </div>
    </div>

    <div class="timeline-section">
      <div class="section-title">Execution Stages</div>
      <div class="timeline">
        ${STAGE_ORDER.map(sName => {
          const meta  = STAGE_META[sName];
          const stage = stages[sName];
          const ok    = stage ? stage.isSuccess : false;
          const cls   = !stage ? 'skip' : ok ? 'ok' : 'err';
          const msg   = !stage ? 'Not run'
            : sName==='CONNECTION' ? (stage.message || (ok?'Connected':'Failed'))
            : ok ? `${stage.files.length} file(s) OK`
            : `${stage.files.filter(f=>!f.isSuccess).length} file(s) failed`;
          return `<div class="stage-step">
            <div class="stage-icon ${cls}">${meta.icon}</div>
            <div class="stage-name">${esc(meta.label)}</div>
            <div class="stage-msg ${cls}">${esc(msg)}</div>
            ${sName==='CONNECTION' && stage?.createdOn ? `<div class="stage-time">${esc(stage.createdOn)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>

    ${files.length > 0 ? `
    <div class="files-section">
      <div class="section-title">File Breakdown</div>
      ${files.map(file => {
        const procData  = file.stageResults['FILE_PROCESSING'];
        const sc  = procData?.successCount ?? null;
        const fc  = procData?.failureCount ?? null;
        const tot = (sc||0) + (fc||0);
        const pct = tot > 0 ? Math.round(((sc||0)/tot)*100) : null;
        const overallOk = Object.values(file.stageResults).every(f=>f.isSuccess);
        return `<div class="file-card">
          <div class="file-card-header">
            <div class="file-icon">📄</div>
            <div style="flex:1;min-width:0">
              <div class="file-name">${esc(file.fileName)}</div>
              <div class="file-model">Model: ${esc(file.modelToMap)}</div>
            </div>
            <span class="file-status-badge ${overallOk?'badge-ok':'badge-err'}">${overallOk?'✓ Success':'✗ Failed'}</span>
          </div>
          <div class="file-stages">
            ${['FILE_AVAILABLE','FILE_IMPORTED','FILE_PROCESSING'].map(sName => {
              const fd = file.stageResults[sName];
              const sOk = fd?.isSuccess;
              const hasCounts = sName==='FILE_PROCESSING' && sc!==null;
              return `<div class="file-stage-cell">
                <div class="fsc-stage">${esc(STAGE_META[sName]?.label||sName)}</div>
                ${fd ? `
                  <div class="fsc-msg ${sOk?'ok':'err'}">${esc(fd.message||(sOk?'OK':'Failed'))}</div>
                  ${fd.exceptionMsg ? `<div style="font-family:var(--mono);font-size:9px;color:var(--red);margin-top:4px">${esc(fd.exceptionMsg)}</div>` : ''}
                  ${hasCounts ? `
                    <div class="fsc-counts">
                      <div class="fsc-count"><span class="fsc-count-label">Success</span><span class="fsc-count-val success">${(sc||0).toLocaleString()}</span></div>
                      <div class="fsc-count"><span class="fsc-count-label">Failed</span><span class="fsc-count-val failure">${(fc||0).toLocaleString()}</span></div>
                    </div>
                    ${pct!==null?`
                    <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
                    <div style="font-family:var(--mono);font-size:9px;color:var(--muted);margin-top:4px">${pct}% success rate</div>`:''}
                  ` : ''}
                ` : `<div class="fsc-msg" style="color:var(--muted)">—</div>`}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}

    ${stages.CONNECTION?.exceptionMsg ? `
    <div class="section-title" style="margin-top:8px">Errors</div>
    <div class="exception-block">
      <div class="exception-label">Connection Error</div>
      <div class="exception-msg">${esc(stages.CONNECTION.exceptionMsg)}</div>
    </div>` : ''}
  `;
}

function showError(msg, apiUrl) {
  document.getElementById('pageContent').innerHTML = `
    <div class="center-state">
      <div class="center-icon">⚠️</div>
      <div class="center-title">Could not load run data</div>
      <div class="center-sub" style="text-align:left;background:var(--bg2);padding:16px 20px;border-radius:10px;border:1px solid var(--border);max-width:520px">
        <strong style="color:var(--text)">What happened:</strong><br>
        ${esc(msg)}<br><br>
        <strong style="color:var(--text)">To fix this:</strong><br>
        1. Go back to the integration run page<br>
        2. Open the <strong>Discover</strong> tab in the extension<br>
        3. Find the API call that loads the run data (look for a call returning JSON with <code>logs</code>, <code>status</code>)<br>
        4. Click <strong>+ Watch</strong> on it, then reload the page<br>
        5. Come back to this dashboard<br><br>
        <span style="color:var(--muted);font-size:10px">Attempted: ${esc(apiUrl||'—')}</span>
      </div>
    </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function looksLikeRunObject(body) {
  if (!body || typeof body !== 'object') return false;
  return !!(body.logs || body.status || body.started_on || body.time_taken);
}

function findInEntries(entries) {
  if (!Array.isArray(entries)) return null;
  // First pass: strict — URL contains /stages/{runId}
  let found = entries.find(e =>
    e.url && e.url.includes(`/stages/${runId}`) && looksLikeRunObject(e.responseBody)
  );
  if (found) return found;
  // Second pass: looser — any JSON that looks like a run object for this runId
  found = entries.find(e =>
    looksLikeRunObject(e.responseBody) &&
    String(e.responseBody?.id) === String(runId)
  );
  return found || null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function load() {
  if (!runId) { showNotFound(); return; }

  // Step 1 — check if user explicitly pinned a dashboard source for this origin
  if (origin) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_PINNED_DASHBOARD', originKey: origin });
      if (resp?.entry?.responseBody && looksLikeRunObject(resp.entry.responseBody)) {
        render(resp.entry.responseBody);
        return;
      }
    } catch (e) { console.warn('GET_PINNED_DASHBOARD failed:', e); }
  }

  // Step 2 — search ALL tab logs for any matching captured response
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_ALL_NETWORK_LOGS' });
    const found = findInEntries(resp?.entries || []);
    if (found) {
      window.render(found.responseBody);
      return;
    }
  } catch (e) { console.warn('GET_ALL_NETWORK_LOGS failed:', e); }

  // Step 3 — show guided instructions
  showNotFound();
}

function showNotFound() {
  document.getElementById('pageContent').innerHTML = `
    <div class="center-state" style="align-items:flex-start;padding:0 32px">
      <div style="width:100%;max-width:600px;margin:0 auto">
        <div style="font-size:28px;margin-bottom:16px;text-align:center">🔍</div>
        <div style="font-size:18px;font-weight:800;text-align:center;margin-bottom:8px">Run data not captured yet</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted);text-align:center;margin-bottom:28px">
          The extension needs to see the API call that loads this run before the dashboard can work.
        </div>

        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px">
          <div style="padding:14px 18px;background:var(--bg3);border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em">
            How to fix — one time setup
          </div>
          <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">
            ${[
              ['1', '🌐', 'Go back to the run page', \`Navigate to <code style="color:var(--accent)">/stages/${runId}</code> in the app\`],
              ['2', '⏳', 'Wait for the page to fully load', 'The app will make an internal API call to fetch run data'],
              ['3', '📡', 'Open the extension → Discover tab', 'You will see the API call listed there — click the row to expand it'],
              ['4', '📊', 'Click <strong style="color:var(--accent2)">Use for Dashboard</strong> on the response', 'Find the call returning JSON with <code style="color:var(--accent)">logs</code> + <code style="color:var(--accent)">status</code> fields and click that purple button'],
              ['5', '✅', 'Come back and click View Dashboard', 'The dashboard will now load from that captured response — no API guessing needed'],
            ].map(([num, icon, title, desc]) => `
              <div style="display:flex;align-items:flex-start;gap:12px">
                <div style="width:22px;height:22px;border-radius:50%;background:var(--bg4);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:9px;font-weight:700;color:var(--accent);flex-shrink:0;margin-top:1px">${num}</div>
                <div>
                  <div style="font-weight:700;font-size:12px;margin-bottom:3px">${icon} ${title}</div>
                  <div style="font-family:var(--mono);font-size:10px;color:var(--muted);line-height:1.6">${desc}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 16px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Debug info</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted);line-height:1.8">
            Run ID: <span style="color:var(--text)">${runId}</span><br>
            Origin: <span style="color:var(--text)">${esc(origin)}</span><br>
            Tab ID: <span style="color:var(--text)">${srcTabId||'not passed'}</span><br>
            Page URL: <span style="color:var(--text);word-break:break-all">${esc(pageUrl)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

load();

// ── CSV Download ──────────────────────────────────────────────────────────────
let _lastData = null;

function downloadCSV(data) {
  const stages = extractStages(data.logs || {});
  const files  = collectFiles(stages);

  const headers = [
    'run_id','status','started_on','completed_on','duration_sec',
    'file_name','model',
    'stage','is_success','message','success_count','failure_count','success_rate_pct','exception'
  ];

  const rows = [];
  const baseFields = {
    run_id:       data.id || runId,
    status:       data.status || '',
    started_on:   data.started_on || '',
    completed_on: data.completed_on || '',
    duration_sec: data.time_taken || '',
  };

  // CONNECTION row
  const conn = stages['CONNECTION'];
  if (conn) {
    rows.push({
      ...baseFields,
      file_name: '', model: '',
      stage: 'CONNECTION',
      is_success: conn.isSuccess,
      message: conn.message || '',
      success_count: '', failure_count: '', success_rate_pct: '',
      exception: conn.exceptionMsg || ''
    });
  }

  // File stage rows
  for (const file of files) {
    for (const stageName of ['FILE_AVAILABLE','FILE_IMPORTED','FILE_PROCESSING']) {
      const fd = file.stageResults[stageName];
      if (!fd) continue;
      const sc  = fd.successCount ?? '';
      const fc  = fd.failureCount ?? '';
      const tot = (Number(sc)||0) + (Number(fc)||0);
      const pct = tot > 0 ? Math.round(((Number(sc)||0)/tot)*100) : '';
      rows.push({
        ...baseFields,
        file_name:       file.fileName,
        model:           file.modelToMap,
        stage:           stageName,
        is_success:      fd.isSuccess,
        message:         fd.message || '',
        success_count:   sc,
        failure_count:   fc,
        success_rate_pct: pct,
        exception:       fd.exceptionMsg || ''
      });
    }
  }

  const csvEsc = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  };

  const csvContent = [
    headers.join(','),
    ...rows.map(r => headers.map(h => csvEsc(r[h])).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `reimburse-run-${runId}-${Date.now()}.csv`
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// Wire CSV button after render
const _origRender = render;
window.render = function(data) {
  _lastData = data;
  _origRender(data);
  const btn = document.getElementById('csvBtn');
  if (btn) {
    btn.style.display = 'flex';
    btn.onclick = () => downloadCSV(data);
  }
};
