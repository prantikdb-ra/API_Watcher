// API Watcher - Settings Script

let identifiers = [];
let activeIdentifiers = [];

function generateId() {
  return 'id_' + Math.random().toString(36).substring(2, 10);
}

function showToast(msg = '✓ Settings saved') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function saveSettings() {
  chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      apiIdentifiers: identifiers,
      activeIdentifiers
    }
  }, () => showToast());
}

function renderList() {
  const list = document.getElementById('identifierList');
  document.getElementById('totalCount').textContent = `${identifiers.length} total`;

  if (identifiers.length === 0) {
    list.innerHTML = `<div class="empty-ids">No identifiers configured yet.<br>Add your first one above.</div>`;
    return;
  }

  list.innerHTML = identifiers.map((id, i) => {
    const isActive = activeIdentifiers.includes(id.id);
    return `
      <div class="identifier-item ${isActive ? 'active-item' : ''}" data-id="${id.id}">
        <input type="checkbox" class="id-checkbox" data-id="${id.id}" ${isActive ? 'checked' : ''}>
        <div class="id-info">
          <div class="id-name">${escapeHtml(id.name || id.pattern)}${id.isDefault ? ' <span style="font-size:9px;color:var(--muted);font-family:var(--mono)">· default</span>' : ''}</div>
          <div class="id-meta">
            <span class="id-type type-${id.type}">${id.type}</span>
            <span class="id-pattern">${escapeHtml(id.pattern)}</span>
          </div>
        </div>
        <div class="id-actions">
          <button class="btn-delete" data-index="${i}" title="Delete">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  // Checkbox events
  list.querySelectorAll('.id-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        if (!activeIdentifiers.includes(id)) activeIdentifiers.push(id);
      } else {
        activeIdentifiers = activeIdentifiers.filter(a => a !== id);
      }
      renderList();
      saveSettings();
    });
  });

  // Delete buttons
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      const removed = identifiers.splice(index, 1)[0];
      activeIdentifiers = activeIdentifiers.filter(a => a !== removed.id);
      renderList();
      saveSettings();
    });
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addIdentifier() {
  const name = document.getElementById('idName').value.trim();
  const pattern = document.getElementById('idPattern').value.trim();

  if (!pattern) {
    document.getElementById('idPattern').focus();
    return;
  }

  // Ensure it looks like a path
  const cleanPattern = pattern.startsWith('/') ? pattern : '/' + pattern;

  const id = generateId();
  identifiers.push({ id, name: name || cleanPattern, type: 'exact', pattern: cleanPattern });
  activeIdentifiers.push(id);

  document.getElementById('idName').value = '';
  document.getElementById('idPattern').value = '';

  renderList();
  saveSettings();
}

function init() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    identifiers = res?.apiIdentifiers || [];
    activeIdentifiers = res?.activeIdentifiers || [];
    renderList();
  });

  document.getElementById('addBtn').addEventListener('click', addIdentifier);

  document.getElementById('idPattern').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addIdentifier();
  });

  document.getElementById('selectAllBtn').addEventListener('click', () => {
    activeIdentifiers = identifiers.map(id => id.id);
    renderList();
    saveSettings();
  });

  document.getElementById('deselectAllBtn').addEventListener('click', () => {
    activeIdentifiers = [];
    renderList();
    saveSettings();
  });

  document.getElementById('idName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('idPattern').focus();
  });
}

init();

// ── Export Settings ──────────────────────────────────────────────────────────

const EXPORT_FIELDS = {
  expense: [
    { key: 'code',                          label: 'Code',                     desc: 'e.g. E017',          default: true  },
    { key: 'title',                         label: 'Title',                    desc: 'e.g. Airfare',        default: true  },
    { key: 'category.title',                label: 'Category',                 desc: 'e.g. General',        default: true  },
    { key: 'category.code',                 label: 'Category Code',            desc: 'e.g. GEN',            default: false },
    { key: 'is_active',                     label: 'Active',                   desc: 'Yes / No',            default: true  },
    { key: 'is_expense_eligibility_enabled',label: 'Eligibility Enabled',      desc: 'Yes / No',            default: true  },
    { key: 'is_attached_to_requests',       label: 'Attached to Requests',     desc: 'Yes / No',            default: true  },
    { key: 'has_approval_rule',             label: 'Has Approval Rule',        desc: 'Yes / No',            default: true  },
    { key: 'attached_to_request.titles',    label: 'Linked Request Names',     desc: 'comma-separated',     default: true  },
    { key: 'attached_to_request.codes',     label: 'Linked Request Codes',     desc: 'e.g. R002, R001',     default: false },
    { key: 'id',                            label: 'Internal ID',              desc: 'numeric record ID',   default: false },
  ],
  request: [
    { key: 'code',           label: 'Code',           desc: 'e.g. R002',   default: true  },
    { key: 'title',          label: 'Title',           desc: 'Full name',   default: true  },
    { key: 'is_active',      label: 'Active',          desc: 'Yes / No',    default: true  },
    { key: 'is_travel_type', label: 'Is Travel Type',  desc: 'Yes / No',    default: true  },
    { key: 'id',             label: 'Internal ID',     desc: 'numeric',     default: false },
  ],
  benefit: [
    { key: 'code',      label: 'Code',        desc: 'e.g. B003',   default: true  },
    { key: 'title',     label: 'Title',       desc: 'Full name',   default: true  },
    { key: 'is_active', label: 'Active',      desc: 'Yes / No',    default: true  },
    { key: 'id',        label: 'Internal ID', desc: 'numeric',     default: false },
  ]
};

let exportPrefs = {}; // { expense: Set<key>, request: Set<key>, benefit: Set<key> }

function loadExportPrefs(callback) {
  chrome.storage.local.get('exportFieldPrefs', (res) => {
    const saved = res.exportFieldPrefs || {};
    for (const type of ['expense', 'request', 'benefit']) {
      if (saved[type]) {
        exportPrefs[type] = new Set(saved[type]);
      } else {
        // Default: all fields marked default: true
        exportPrefs[type] = new Set(EXPORT_FIELDS[type].filter(f => f.default).map(f => f.key));
      }
    }
    if (callback) callback();
  });
}

function saveExportPrefs() {
  const toSave = {};
  for (const type of ['expense', 'request', 'benefit']) {
    toSave[type] = [...exportPrefs[type]];
  }
  chrome.storage.local.set({ exportFieldPrefs: toSave }, () => {
    showToast('✓ Export settings saved');
    updateAllCounts();
  });
}

function updateCount(type) {
  const el = document.getElementById(`${type}-selected-count`);
  if (!el) return;
  const total    = EXPORT_FIELDS[type].length;
  const selected = exportPrefs[type]?.size || 0;
  el.textContent = `${selected} of ${total} fields`;
}

function updateAllCounts() {
  ['expense', 'request', 'benefit'].forEach(updateCount);
}

function renderFieldGrid(type) {
  const grid = document.getElementById(`fields-${type}`);
  if (!grid) return;
  const fields = EXPORT_FIELDS[type];
  const selected = exportPrefs[type] || new Set();

  grid.innerHTML = fields.map(field => `
    <label class="field-item">
      <input type="checkbox" data-type="${type}" data-key="${field.key}" ${selected.has(field.key) ? 'checked' : ''}>
      <div>
        <div class="field-item-label">${field.label}</div>
        <div class="field-item-desc">${field.desc}</div>
      </div>
    </label>
  `).join('');

  grid.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const t = cb.dataset.type;
      const k = cb.dataset.key;
      if (cb.checked) exportPrefs[t].add(k);
      else exportPrefs[t].delete(k);
      updateCount(t);
    });
  });
}

function initExportSettings() {
  // Tab switching
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('page-' + btn.dataset.page).classList.add('active');
    });
  });

  // Collapsible panels
  document.querySelectorAll('.export-type-header').forEach(header => {
    header.addEventListener('click', () => {
      const panel = document.getElementById('panel-' + header.dataset.panel);
      if (panel) panel.classList.toggle('open');
    });
  });

  // Select all / none
  document.querySelectorAll('.btn-select-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const type   = btn.dataset.type;
      const action = btn.dataset.action;
      if (action === 'all') {
        exportPrefs[type] = new Set(EXPORT_FIELDS[type].map(f => f.key));
      } else {
        exportPrefs[type] = new Set();
      }
      renderFieldGrid(type);
      updateCount(type);
    });
  });

  // Save button
  document.getElementById('saveExportBtn').addEventListener('click', saveExportPrefs);

  // Load prefs and render
  loadExportPrefs(() => {
    ['expense', 'request', 'benefit'].forEach(type => {
      renderFieldGrid(type);
      updateCount(type);
    });
  });
}

initExportSettings();
