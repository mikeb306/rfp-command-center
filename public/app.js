/* ═══════════════════════════════════════════════════
   RFP COMMAND CENTER — Frontend Application
   ═══════════════════════════════════════════════════ */

const state = {
  tenders: [],
  selectedTenderId: null,
  detail: null,
  evidence: [],
  connectorsList: [],
  connectorRuns: [],
  currentView: 'dashboard'
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let toastContainer;

// ─── INIT ───
const RFP_QUOTES = [
  '"An RFP is just a love letter where the government asks 47 vendors to prove they\'re worthy."',
  '"Behind every great proposal is someone who stayed up way too late."',
  '"RFP: Requests for Punishment."',
  '"Compliance matrix? More like existential crisis matrix."',
  '"We put the FUN in \'this RFP is due by FUNday at 2pm.\'  Wait, no we don\'t."',
  '"Coffee: the real MVP of every proposal deadline."',
  '"Somewhere, a government evaluator is reading your proposal and eating a sandwich. Make it worth their time."',
  '"If at first you don\'t win the bid, reformat and resubmit."',
  '"RFPs: where \'shall\' means \'must\' and \'may\' means \'you better.\'"',
  '"A 200-page RFP walks into a bar. The bartender says, \'We\'re gonna need a bigger table.\'"'
];

document.addEventListener('DOMContentLoaded', () => {
  toastContainer = $('#toast-container');
  showRfpQuote();
  initLoginGate();
  hydrateAuth();
  initNavigation();
  initFileUpload();
  initFormHandlers();
  initButtonHandlers();
  initChatHandlers();
  initGovernanceHandlers();
  bootApp();
});

function showRfpQuote() {
  const el = $('#rfp-quote');
  if (!el) return;
  el.textContent = RFP_QUOTES[Math.floor(Math.random() * RFP_QUOTES.length)];
}

// ═══════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════

function initNavigation() {
  $$('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (btn.dataset.requiresTender !== undefined && !state.selectedTenderId) {
        toast('Select a tender first', 'error');
        return;
      }
      switchView(view);
    });
  });
  $('#dash-new-tender')?.addEventListener('click', () => {
    switchView('tenders');
    showCreateTenderForm();
  });
  $('#btn-show-create-tender')?.addEventListener('click', showCreateTenderForm);
  $('#btn-cancel-create-tender')?.addEventListener('click', hideCreateTenderForm);
}

function switchView(viewName) {
  state.currentView = viewName;
  $$('.nav-item').forEach((i) => i.classList.remove('active'));
  const nav = $(`.nav-item[data-view="${viewName}"]`);
  if (nav) nav.classList.add('active');
  $$('.view').forEach((v) => v.classList.remove('active'));
  const viewEl = $(`#view-${viewName}`);
  if (viewEl) viewEl.classList.add('active');
  refreshViewData(viewName);
}

function refreshViewData(viewName) {
  if (viewName === 'dashboard') {
    updateDashboardStats();
    renderDashboardTenders();
    renderDashboardConnectors();
  } else {
    updateTenderNameLabels();
    if (viewName === 'response-builder') renderResponseBuilder();
    if (viewName === 'governance') renderExportReadiness();
  }
}

function enableTenderViews() {
  $$('.nav-item[data-requires-tender]').forEach((b) => b.classList.add('enabled'));
}

function updateTenderNameLabels() {
  const name = state.detail?.tender?.title || 'No tender selected';
  ['#docs-tender-name', '#analysis-tender-name', '#rb-tender-name', '#governance-tender-name', '#ask-tender-name'].forEach((sel) => {
    const el = $(sel);
    if (el) el.textContent = name;
  });
}

function updateSidebarActiveTender() {
  const el = $('#sidebar-active-tender .sidebar-tender-name');
  if (el) el.textContent = state.detail?.tender?.title || 'No tender selected';
}

// ═══════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════

function hydrateAuth() {
  $('#auth-token').value = localStorage.getItem('rfp_auth_token') || '';
  $('#auth-user').value = localStorage.getItem('rfp_auth_user') || '';
}

// ═══════════════════════════════════════
//  FILE UPLOAD
// ═══════════════════════════════════════

function initFileUpload() {
  const dropZone = $('#file-drop-zone');
  const fileInput = $('#file-input');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
  });
}

async function handleFileUpload(file) {
  if (!state.selectedTenderId) {
    toast('Select a tender first', 'error');
    return;
  }

  const statusEl = $('#upload-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<span class="spinner"></span> Uploading and parsing <strong>' + esc(file.name) + '</strong>...';
  }

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/api/tenders/${state.selectedTenderId}/upload`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Upload failed');
    }

    if (statusEl) {
      statusEl.innerHTML = '<span style="color:var(--success);font-weight:600">Uploaded:</span> ' +
        esc(result.filename) + ' — ' + (result.charCount || 0).toLocaleString() + ' chars extracted';
    }
    toast(`Uploaded ${result.filename} (${(result.charCount || 0).toLocaleString()} chars)`, 'success');
    await loadTenderDetail(state.selectedTenderId);
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:var(--danger);font-weight:600">Error:</span> ' + esc(err.message);
    }
    toast(err.message, 'error');
  }
}

// ═══════════════════════════════════════
//  FORM HANDLERS
// ═══════════════════════════════════════

function initFormHandlers() {
  // Create tender
  $('#create-tender-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('#create-tender-form');
    const payload = Object.fromEntries(new FormData(f).entries());
    await api('/api/tenders', { method: 'POST', body: JSON.stringify(payload) });
    f.reset();
    hideCreateTenderForm();
    toast('Tender created', 'success');
    await loadTenders();
  });

  // Add document
  $('#add-doc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
    const fd = new FormData($('#add-doc-form'));
    const payload = {
      filename: String(fd.get('filename') || ''),
      mimeType: String(fd.get('mimeType') || 'text/plain'),
      text: String(fd.get('text') || ''),
      ocrUsed: fd.get('ocrUsed') === 'on'
    };
    await api(`/api/tenders/${state.selectedTenderId}/documents`, { method: 'POST', body: JSON.stringify(payload) });
    $('#add-doc-form').reset();
    toast('Document added', 'success');
    await loadTenderDetail(state.selectedTenderId);
  });

  // Evidence
  $('#evidence-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData($('#evidence-form'));
    const payload = {
      title: String(fd.get('title') || ''),
      summary: String(fd.get('summary') || ''),
      tags: String(fd.get('tags') || ''),
      reqTypes: String(fd.get('reqTypes') || ''),
      uri: String(fd.get('uri') || '')
    };
    await api('/api/evidence', { method: 'POST', body: JSON.stringify(payload) });
    $('#evidence-form').reset();
    toast('Evidence added', 'success');
    await loadEvidence();
    if (state.selectedTenderId) await loadTenderDetail(state.selectedTenderId);
  });

  // Search
  $('#search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.selectedTenderId) return;
    const q = String(new FormData($('#search-form')).get('q') || '').trim();
    if (!q) return;
    const btn = $('#search-form button[type="submit"]');
    btn.innerHTML = '<span class="spinner"></span> Searching…';
    btn.disabled = true;
    try {
      const result = await api(`/api/tenders/${state.selectedTenderId}/search?q=${encodeURIComponent(q)}&limit=5`);
      $('#search-results').textContent = JSON.stringify(result, null, 2);
    } finally {
      btn.textContent = 'Search';
      btn.disabled = false;
    }
  });

  // Draft
  $('#draft-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.selectedTenderId) return;
    const fd = new FormData($('#draft-form'));
    const payload = {
      sectionTitle: String(fd.get('sectionTitle') || ''),
      query: String(fd.get('query') || ''),
      topK: Number(fd.get('topK') || 6)
    };
    const btn = $('#draft-form button[type="submit"]');
    btn.innerHTML = '<span class="spinner"></span> Drafting…';
    btn.disabled = true;
    try {
      const result = await api(`/api/tenders/${state.selectedTenderId}/draft`, { method: 'POST', body: JSON.stringify(payload) });
      $('#draft-results').textContent = JSON.stringify(result, null, 2);
      toast('Draft generated', 'success');
    } finally {
      btn.textContent = 'Generate Draft';
      btn.disabled = false;
    }
  });

  // Q&A
  $('#qa-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
    const question = String(new FormData($('#qa-form')).get('question') || '').trim();
    if (!question) return;
    const btn = $('#qa-form button[type="submit"]');
    btn.innerHTML = '<span class="spinner"></span> Thinking…';
    btn.disabled = true;
    const history = $('#qa-history');
    // Add question bubble
    history.insertAdjacentHTML('beforeend',
      `<div style="margin-bottom:12px;padding:10px 14px;background:var(--primary-light, #e8f0fe);border-radius:10px 10px 10px 2px;font-size:14px"><strong>Q:</strong> ${escapeHtml(question)}</div>`
    );
    try {
      const result = await api(`/api/tenders/${state.selectedTenderId}/ask`, { method: 'POST', body: JSON.stringify({ question }) });
      const answer = result.answer || 'No answer returned.';
      const sources = (result.sources || []).map(s => `<div style="font-size:11px;color:var(--ink-tertiary);margin-top:2px">[${s.chunkId}] ${escapeHtml(s.text)}…</div>`).join('');
      history.insertAdjacentHTML('beforeend',
        `<div style="margin-bottom:16px;padding:10px 14px;background:var(--surface, #f8f9fa);border:1px solid var(--border, #dee2e6);border-radius:10px 10px 2px 10px;font-size:14px;white-space:pre-wrap"><strong>A:</strong> ${escapeHtml(answer)}${sources ? '<details style="margin-top:8px"><summary style="font-size:12px;color:#888;cursor:pointer">Sources</summary>' + sources + '</details>' : ''}</div>`
      );
      toast('Answer ready', 'success');
    } catch (err) {
      history.insertAdjacentHTML('beforeend',
        `<div style="margin-bottom:16px;padding:10px 14px;background:#fff0f0;border:1px solid #f5c6cb;border-radius:10px;font-size:14px;color:#721c24">Error: ${escapeHtml(err.message)}</div>`
      );
    } finally {
      btn.textContent = 'Ask';
      btn.disabled = false;
      $('#qa-form').reset();
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════
//  ASK RFP CHAT
// ═══════════════════════════════════════

function initChatHandlers() {
  // Chat form
  $('#chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const question = input?.value?.trim();
    if (!question || !state.selectedTenderId) return;
    input.value = '';
    await askRfpQuestion(question);
  });

  // Starter buttons
  document.querySelectorAll('.starter-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
      const question = btn.dataset.q;
      if (question) await askRfpQuestion(question);
    });
  });
}

async function askRfpQuestion(question) {
  const messages = $('#chat-messages');
  const sendBtn = $('#chat-send');
  if (!messages) return;

  // Hide welcome
  const welcome = messages.querySelector('.chat-welcome');
  if (welcome) welcome.style.display = 'none';

  // Add user bubble
  messages.insertAdjacentHTML('beforeend',
    `<div class="chat-bubble user">${escapeHtml(question)}</div>`
  );

  // Add thinking indicator
  const thinkingId = 'thinking-' + Date.now();
  messages.insertAdjacentHTML('beforeend',
    `<div class="chat-thinking" id="${thinkingId}"><span class="spinner"></span> Searching RFP documents...</div>`
  );
  messages.scrollTop = messages.scrollHeight;

  if (sendBtn) sendBtn.disabled = true;

  try {
    const result = await api(`/api/tenders/${state.selectedTenderId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question })
    });

    // Remove thinking
    const thinking = document.getElementById(thinkingId);
    if (thinking) thinking.remove();

    const answer = result.answer || 'No answer returned.';
    const sources = result.sources || [];

    let sourcesHtml = '';
    if (sources.length > 0) {
      sourcesHtml = `<details class="chat-sources"><summary>${sources.length} source${sources.length > 1 ? 's' : ''} cited</summary>`;
      for (const s of sources) {
        sourcesHtml += `<div class="chat-source-item">[${escapeHtml(s.chunkId || '')}] ${escapeHtml((s.text || '').slice(0, 200))}...</div>`;
      }
      sourcesHtml += '</details>';
    }

    messages.insertAdjacentHTML('beforeend',
      `<div class="chat-bubble ai">
        <div style="white-space:pre-wrap">${escapeHtml(answer)}</div>
        ${sourcesHtml}
        <span class="chat-copy" onclick="navigator.clipboard.writeText(this.closest('.chat-bubble').querySelector('div').textContent);this.textContent='Copied!'">Copy</span>
      </div>`
    );
  } catch (err) {
    const thinking = document.getElementById(thinkingId);
    if (thinking) thinking.remove();
    messages.insertAdjacentHTML('beforeend',
      `<div class="chat-bubble error">Error: ${escapeHtml(err.message)}</div>`
    );
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }
}

// SKU Search
$('#sku-search-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
  const query = String(new FormData($('#sku-search-form')).get('query') || '').trim();
  if (!query) return;
  await doSkuSearch(query);
});

$('#sku-auto-match')?.addEventListener('click', async () => {
  if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
  await doSkuSearch('');
});

async function doSkuSearch(query) {
  const btn = query ? $('#sku-search-form button[type="submit"]') : $('#sku-auto-match');
  const origText = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Searching…';
  btn.disabled = true;
  try {
    const result = await api(`/api/tenders/${state.selectedTenderId}/sku-match`, {
      method: 'POST',
      body: JSON.stringify({ query })
    });
    renderSkuResults(result);
    toast(`Found ${(result.matches || []).length} matching SKUs`, 'success');
  } catch (err) {
    $('#sku-results').innerHTML = `<div style="color:#dc3545;padding:8px">Error: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

function renderSkuResults(result) {
  const el = $('#sku-results');
  const matches = result.matches || [];
  if (matches.length === 0) {
    el.innerHTML = `<div style="padding:12px;background:var(--surface-hover);border-radius:8px;font-size:13px;color:var(--ink-tertiary)">${result.message || 'No matching SKUs found. Try a different search or analyze the RFP first.'}</div>`;
    return;
  }

  const modeLabel = result.mode === 'ai' ? 'AI-powered' : 'Keyword';
  let html = `<div style="font-size:12px;color:#888;margin-bottom:8px">${modeLabel} match — ${matches.length} results${result.query ? ' for "' + escapeHtml(result.query) + '"' : ' (auto-matched from RFP)'}</div>`;
  html += '<table class="data-table" style="width:100%;font-size:13px"><thead><tr><th>SKU</th><th>Product</th><th>Type</th><th>Specs</th><th>List Price</th>';
  if (result.mode === 'ai') html += '<th>Match Reason</th><th>Confidence</th>';
  html += '</tr></thead><tbody>';

  for (const m of matches) {
    const price = m.listPrice ? ('$' + Number(m.listPrice).toLocaleString()) : 'Quote';
    const conf = m.confidence || '';
    const confColor = conf === 'high' ? '#28a745' : conf === 'medium' ? '#ffc107' : '#6c757d';
    html += `<tr>`;
    html += `<td style="font-family:monospace;font-weight:600;white-space:nowrap">${escapeHtml(m.sku || '')}</td>`;
    html += `<td><strong>${escapeHtml(m.name || '')}</strong><br><span style="font-size:11px;color:#888">${escapeHtml(m.vendor || '')}</span></td>`;
    html += `<td>${escapeHtml(m.type || '')}</td>`;
    html += `<td style="font-size:12px;max-width:300px">${escapeHtml(m.specs || '')}</td>`;
    html += `<td style="font-weight:600;white-space:nowrap">${price}</td>`;
    if (result.mode === 'ai') {
      html += `<td style="font-size:12px">${escapeHtml(m.reason || '')}</td>`;
      html += `<td><span style="background:${confColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${conf.toUpperCase()}</span></td>`;
    }
    html += `</tr>`;
  }
  html += '</tbody></table>';

  // Show RFP SKU list if available
  if (result.skuListFromRfp && result.skuListFromRfp.length > 0) {
    html += '<div style="margin-top:16px;font-size:12px;color:#888">RFP requested items:</div>';
    html += '<ul style="font-size:13px;margin-top:4px">';
    for (const s of result.skuListFromRfp) {
      html += `<li><strong>${escapeHtml(s.item || '')}</strong> — ${escapeHtml(s.specs || '')} (qty: ${s.quantity || 'TBD'})</li>`;
    }
    html += '</ul>';
  }

  el.innerHTML = html;
}

// ═══════════════════════════════════════
//  BUTTON HANDLERS
// ═══════════════════════════════════════

function initButtonHandlers() {
  // Extract requirements
  $('#run-extract')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const btn = $('#run-extract');
    btn.innerHTML = '<span class="spinner"></span> Extracting…';
    btn.disabled = true;
    try {
      const result = await api(`/api/tenders/${state.selectedTenderId}/extract`, { method: 'POST' });
      await loadTenderDetail(state.selectedTenderId);
      $('#requirements').textContent = JSON.stringify(result.requirements, null, 2);
      toast(`Extracted ${result.requirementCount} requirements (${result.provider})`, 'success');
    } finally {
      btn.textContent = 'Extract Requirements';
      btn.disabled = false;
    }
  });

  // Index chunks
  $('#run-index')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const btn = $('#run-index');
    btn.innerHTML = '<span class="spinner"></span> Indexing…';
    btn.disabled = true;
    try {
      const result = await api(`/api/tenders/${state.selectedTenderId}/index`, { method: 'POST', body: JSON.stringify({}) });
      toast(`Indexed ${result.chunkCount} chunks (${result.embeddedCount} embedded)`, 'success');
      await loadTenders();
      await loadTenderDetail(state.selectedTenderId);
    } finally {
      btn.textContent = 'Index Chunks';
      btn.disabled = false;
    }
  });

  // Refresh matrix
  $('#refresh-matrix')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const result = await api(`/api/tenders/${state.selectedTenderId}/matrix`);
    $('#matrix').textContent = JSON.stringify(result.matrix, null, 2);
    toast('Matrix refreshed', 'info');
  });

  // Audit
  $('#refresh-audit')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const result = await api(`/api/tenders/${state.selectedTenderId}/audit`);
    $('#audit').textContent = JSON.stringify(result.auditEvents, null, 2);
  });

  $('#verify-audit')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const result = await api(`/api/tenders/${state.selectedTenderId}/audit/verify`);
    $('#audit').textContent = JSON.stringify({ verification: result }, null, 2);
    toast(result.valid ? 'Audit chain valid' : 'Audit chain issues detected', result.valid ? 'success' : 'error');
  });

  $('#resign-audit')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const result = await api(`/api/tenders/${state.selectedTenderId}/audit/resign`, {
      method: 'POST',
      body: JSON.stringify({ forceRewrite: Boolean($('#force-rewrite-audit')?.checked) })
    });
    $('#audit').textContent = JSON.stringify({ resign: result }, null, 2);
    toast('Audit chain re-signed', 'info');
  });

  // Analyze RFP
  $('#run-analyze')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
    const btn = $('#run-analyze');
    btn.innerHTML = '<span class="spinner"></span> Analyzing RFP… (this may take 30-60 seconds)';
    btn.disabled = true;
    try {
      const result = await api(`/api/tenders/${state.selectedTenderId}/analyze`, { method: 'POST' });
      state.analysis = result.analysis;
      renderAnalysisDashboard(result.analysis);
      toast('RFP analysis complete', 'success');
      await loadTenderDetail(state.selectedTenderId);
    } catch (err) {
      toast(`Analysis failed: ${err.message}`, 'error');
    } finally {
      btn.innerHTML = 'Analyze RFP';
      btn.disabled = false;
    }
  });

  // Generate RFP Response
  $('#generate-response')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
    const btn = $('#generate-response');
    const skipDrafts = Boolean($('#skip-drafts')?.checked);
    btn.innerHTML = '<span class="spinner"></span> Generating response document…';
    btn.disabled = true;
    try {
      const response = await fetch(`/api/tenders/${state.selectedTenderId}/generate-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ skipDrafts })
      });
      if (!response.ok) {
        let msg = 'Response generation failed.';
        try { const p = await response.json(); msg = p?.error || msg; } catch {}
        toast(msg, 'error');
        return;
      }
      const blob = await response.blob();
      const disp = response.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^";]+)"?/i);
      const filename = (m && m[1]) || `rfp-response-${state.selectedTenderId}-${new Date().toISOString().slice(0, 10)}.docx`;
      downloadBlob(blob, filename);
      toast('RFP Response DOCX generated', 'success');
    } catch (err) {
      toast(`Generation failed: ${err.message}`, 'error');
    } finally {
      btn.innerHTML = 'Generate RFP Response';
      btn.disabled = false;
    }
  });

  // Connectors
  $('#run-connectors')?.addEventListener('click', async () => {
    const btn = $('#run-connectors');
    btn.innerHTML = '<span class="spinner"></span> Running…';
    btn.disabled = true;
    try {
      const summary = await api('/api/connectors/run', { method: 'POST', body: JSON.stringify({}) });
      $('#connectors-runs').textContent = JSON.stringify(summary, null, 2);
      toast(`Connectors: ${summary.discovered} discovered, ${summary.created} created`, 'success');
      await loadConnectorRuns();
      await loadTenders();
    } finally {
      btn.textContent = 'Run Ingestion';
      btn.disabled = false;
    }
  });

}

// ═══════════════════════════════════════
//  DATA LOADING
// ═══════════════════════════════════════

async function bootApp() {
  const authed = await checkAuth();
  if (!authed) return; // login overlay shown, bootApp re-called after login
  try {
    await Promise.all([loadTenders(), loadConnectors(), loadConnectorRuns(), loadEvidence()]);
  } catch (err) {
    toast(`Boot error: ${err.message}`, 'error');
  }
}

async function checkAuth() {
  const token = localStorage.getItem('rfp_auth_token') || '';
  try {
    const res = await fetch('/api/whoami', { headers: token ? { 'x-api-token': token } : {} });
    if (res.ok) {
      $('#login-overlay').style.display = 'none';
      return true;
    }
  } catch { /* network error */ }
  // Show login screen
  $('#login-overlay').style.display = 'flex';
  $('#login-password').focus();
  return false;
}

function initLoginGate() {
  const form = $('#login-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#login-password').value.trim();
    if (!pw) return;
    try {
      const res = await fetch('/api/whoami', { headers: { 'x-api-token': pw } });
      if (res.ok) {
        localStorage.setItem('rfp_auth_token', pw);
        $('#auth-token').value = pw;
        $('#login-overlay').style.display = 'none';
        $('#login-error').style.display = 'none';
        bootApp();
      } else {
        $('#login-error').textContent = 'Invalid password';
        $('#login-error').style.display = 'block';
      }
    } catch {
      $('#login-error').textContent = 'Cannot reach server';
      $('#login-error').style.display = 'block';
    }
  });
}

async function loadTenders() {
  const data = await api('/api/tenders');
  state.tenders = data.tenders || [];
  renderTenderGrid();
  updateDashboardStats();
  renderDashboardTenders();
  if (!state.selectedTenderId && state.tenders.length > 0) {
    await selectTender(state.tenders[0].tenderId);
  }
}

async function loadConnectors() {
  const data = await api('/api/connectors');
  state.connectorsList = data.connectors || [];
  $('#connectors-list').textContent = JSON.stringify(state.connectorsList, null, 2);
  updateDashboardStats();
}

async function loadConnectorRuns() {
  const data = await api('/api/connectors/runs?limit=20');
  state.connectorRuns = data.runs || [];
  $('#connectors-runs').textContent = JSON.stringify(state.connectorRuns, null, 2);
  renderDashboardConnectors();
}

async function loadEvidence() {
  const data = await api('/api/evidence');
  state.evidence = data.evidenceAssets || [];
  $('#evidence-list').textContent = JSON.stringify(state.evidence, null, 2);
  updateDashboardStats();
}

async function selectTender(tenderId) {
  await loadTenderDetail(tenderId);
  enableTenderViews();
}

async function loadTenderDetail(tenderId) {
  const detail = await api(`/api/tenders/${tenderId}`);
  state.selectedTenderId = tenderId;
  state.detail = detail;
  updateSidebarActiveTender();
  updateTenderNameLabels();
  enableTenderViews();
  renderTenderGrid();

  const reqEl = $('#requirements');
  if (reqEl) {
    reqEl.textContent = detail.requirements?.length > 0
      ? JSON.stringify(detail.requirements, null, 2)
      : 'No requirements extracted yet. Add a document and run extraction.';
  }

  renderGates(detail.gates);
  renderSectionsWorkflow(detail.sectionWorkflow);

  try {
    const analysisData = await api(`/api/tenders/${tenderId}/analysis`);
    if (analysisData.analysis) {
      state.analysis = analysisData.analysis;
      renderAnalysisDashboard(analysisData.analysis);
    } else {
      state.analysis = null;
      const dash = $('#analysis-dashboard');
      if (dash) dash.style.display = 'none';
      const genBtn = $('#generate-response');
      if (genBtn) genBtn.style.display = 'none';
      const genOpts = $('#generate-response-options');
      if (genOpts) genOpts.style.display = 'none';
    }
  } catch {}

  try {
    const matrix = await api(`/api/tenders/${tenderId}/matrix`);
    const el = $('#matrix');
    if (el) el.textContent = JSON.stringify(matrix.matrix, null, 2);
  } catch {}

  try {
    const audit = await api(`/api/tenders/${tenderId}/audit`);
    const el = $('#audit');
    if (el) el.textContent = JSON.stringify(audit.auditEvents, null, 2);
  } catch {}
}

// ═══════════════════════════════════════
//  RENDERING
// ═══════════════════════════════════════

function renderTenderGrid() {
  const grid = $('#tender-grid');
  if (!grid) return;
  if (state.tenders.length === 0) {
    grid.innerHTML = '<p class="empty-state">No tenders yet. Create one to get started.</p>';
    return;
  }
  const statusLabel = (s) => {
    if (!s || s === 'open') return 'Open';
    if (s === 'no-bid') return 'No-Bid';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const statusClass = (s) => !s || s === 'open' ? 'open' : s === 'no-bid' ? 'no-bid' : s;

  grid.innerHTML = state.tenders.map((t) => {
    const st = t.status || 'open';
    return `
    <div class="tender-card${t.tenderId === state.selectedTenderId ? ' active' : ''}" data-tid="${t.tenderId}">
      <span class="tender-source-badge">${esc(t.sourceSystem)}</span>
      <span class="tender-status-badge status-${statusClass(st)}">${statusLabel(st)}</span>
      <div class="tender-card-title">${esc(t.title)}</div>
      <div class="tender-card-meta">
        <span>${esc(t.buyerName || 'No buyer')}</span>
        <span>Ref: ${esc(t.sourceRef)}</span>
      </div>
      <div class="tender-card-stats">
        <span class="tender-stat">Docs <span class="tender-stat-val">${t.docCount || 0}</span></span>
        <span class="tender-stat">Reqs <span class="tender-stat-val">${t.reqCount || 0}</span></span>
        <span class="tender-stat">Chunks <span class="tender-stat-val">${t.chunkCount || 0}</span></span>
        <span class="tender-stat">Gates <span class="tender-stat-val">${esc(t.gateSummary?.label || '0/3')}</span></span>
      </div>
      <div class="tender-card-actions" data-tid="${t.tenderId}">
        <select class="tender-status-select" data-tid="${t.tenderId}">
          ${['open', 'archived', 'won', 'lost', 'no-bid'].map((s) =>
            `<option value="${s}"${s === st ? ' selected' : ''}>${statusLabel(s)}</option>`
          ).join('')}
        </select>
        <span style="flex:1"></span>
        <button class="tender-delete-btn" data-tid="${t.tenderId}" title="Delete tender">&#128465; Delete</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.tender-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.tender-card-actions')) return;
      selectTender(card.dataset.tid);
      toast(`Selected: ${state.tenders.find((t) => t.tenderId === card.dataset.tid)?.title || ''}`, 'info');
    });
  });

  grid.querySelectorAll('.tender-status-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      e.stopPropagation();
      const tid = sel.dataset.tid;
      const newStatus = sel.value;
      try {
        await api(`/api/tenders/${tid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus })
        });
        toast(`Status changed to ${newStatus}`, 'success');
        await loadTenders();
      } catch (err) {
        toast(`Status update failed: ${err.message}`, 'error');
      }
    });
  });

  grid.querySelectorAll('.tender-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tid = btn.dataset.tid;
      const tender = state.tenders.find((t) => t.tenderId === tid);
      if (!confirm(`Delete tender "${tender?.title || tid}"? This cannot be undone.`)) return;
      try {
        await api(`/api/tenders/${tid}`, { method: 'DELETE' });
        toast('Tender deleted', 'success');
        if (state.selectedTenderId === tid) {
          state.selectedTenderId = null;
          state.detail = null;
        }
        await loadTenders();
      } catch (err) {
        toast(`Delete failed: ${err.message}`, 'error');
      }
    });
  });
}

function renderDashboardTenders() {
  const el = $('#dash-tenders-list');
  if (!el) return;
  if (state.tenders.length === 0) {
    el.innerHTML = '<p class="empty-state">No tenders yet</p>';
    return;
  }
  el.innerHTML = state.tenders.slice(0, 8).map((t) => `
    <div class="dash-tender-item" data-tid="${t.tenderId}">
      <div>
        <div class="dash-tender-title">${esc(t.title)}</div>
        <div class="dash-tender-meta">${esc(t.sourceSystem)} - ${t.docCount || 0} docs - ${t.reqCount || 0} reqs</div>
      </div>
      <span class="dash-tender-badge badge-open">${esc(t.gateSummary?.label || '0/3')}</span>
    </div>
  `).join('');
  el.querySelectorAll('.dash-tender-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectTender(item.dataset.tid);
      switchView('documents');
    });
  });
}

function renderDashboardConnectors() {
  const el = $('#dash-connector-activity');
  if (!el) return;
  if (state.connectorRuns.length === 0) {
    el.innerHTML = '<p class="empty-state">No connector runs yet</p>';
    return;
  }
  el.innerHTML = state.connectorRuns.slice(0, 6).map((r) => `
    <div class="connector-run-item">
      <span class="connector-run-status ${r.status}">${r.status}</span>
      ${esc(r.connectorName || r.connectorId)} - ${r.discovered || 0} found, ${r.created || 0} new
    </div>
  `).join('');
}

function updateDashboardStats() {
  const s = (id, v) => { const el = $(`#${id}`); if (el) el.textContent = v; };
  s('stat-total', state.tenders.length);
  s('stat-open', state.tenders.filter((t) => !t.status || t.status === 'open').length);
  s('stat-evidence', state.evidence.length);
  s('stat-connectors', state.connectorsList.filter((c) => c.active).length);
}

function renderGates(gates) {
  const el = $('#gates');
  if (!el) return;
  if (!gates) { el.innerHTML = '<p class="empty-state">No gate data.</p>'; return; }

  const labels = { bidNoBid: 'Gate 1: Bid / No-Bid', requirementMap: 'Gate 2: Requirement Map', pricingLegal: 'Gate 3: Pricing + Legal' };
  el.innerHTML = '';

  for (const key of ['bidNoBid', 'requirementMap', 'pricingLegal']) {
    const gate = gates[key] || {};
    const card = document.createElement('form');
    card.className = 'gate-card';
    card.innerHTML = `
      <h4>${labels[key]}</h4>
      <div class="form-group"><label>Status</label>
        <select name="status">${['pending', 'approved', 'needs_changes', 'rejected'].map((s) =>
          `<option value="${s}" ${gate.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Reviewer</label>
        <input name="reviewer" value="${escAttr(gate.reviewer || '')}" placeholder="Reviewer" /></div>
      <div class="form-group"><label>Note</label>
        <textarea name="note" rows="2">${esc(gate.note || '')}</textarea></div>
      <button type="submit" class="btn btn-sm btn-primary">Save</button>`;
    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.selectedTenderId) return;
      const fd = new FormData(card);
      await api(`/api/tenders/${state.selectedTenderId}/gates/${key}`, {
        method: 'POST',
        body: JSON.stringify({ status: fd.get('status'), reviewer: fd.get('reviewer'), note: fd.get('note') })
      });
      toast(`${labels[key]} updated`, 'success');
      await loadTenderDetail(state.selectedTenderId);
    });
    el.appendChild(card);
  }
}

function renderSectionsWorkflow(workflow) {
  const el = $('#sections-workflow');
  if (!el) return;
  if (!workflow) { el.innerHTML = '<p class="empty-state">No section data.</p>'; return; }
  el.innerHTML = '';

  for (const [key, section] of Object.entries(workflow)) {
    const card = document.createElement('form');
    card.className = 'gate-card';
    card.innerHTML = `
      <h4>${esc(section.title || key)}</h4>
      <div class="form-group"><label>Status</label>
        <select name="status">${['draft', 'in_review', 'approved', 'locked'].map((s) =>
          `<option value="${s}" ${section.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Assignee</label>
        <input name="assignee" value="${escAttr(section.assignee || '')}" /></div>
      <div class="form-group"><label>Reviewer</label>
        <input name="reviewer" value="${escAttr(section.reviewer || '')}" /></div>
      <div class="form-group"><label>Note</label>
        <textarea name="note" rows="2">${esc(section.note || '')}</textarea></div>
      <button type="submit" class="btn btn-sm btn-primary">Save</button>`;
    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.selectedTenderId) return;
      const fd = new FormData(card);
      await api(`/api/tenders/${state.selectedTenderId}/sections/${key}`, {
        method: 'POST',
        body: JSON.stringify({ status: fd.get('status'), assignee: fd.get('assignee'), reviewer: fd.get('reviewer'), note: fd.get('note') })
      });
      toast('Section updated', 'success');
      await loadTenderDetail(state.selectedTenderId);
    });
    el.appendChild(card);
  }
}

// ═══════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════

function showCreateTenderForm() {
  const c = $('#create-tender-card');
  if (c) c.style.display = 'block';
}

function hideCreateTenderForm() {
  const c = $('#create-tender-card');
  if (c) c.style.display = 'none';
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ═══════════════════════════════════════
//  API & UTILITIES
// ═══════════════════════════════════════

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(options.headers || {}) };
  const response = await fetch(url, { headers, ...options });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error || payload?.errors?.join(', ') || 'Request failed';
    toast(message, 'error');
    throw new Error(message);
  }
  return payload;
}

function getAuthHeaders() {
  const token = localStorage.getItem('rfp_auth_token') || '';
  const user = localStorage.getItem('rfp_auth_user') || '';
  const h = {};
  if (token) h['x-api-token'] = token;
  if (user) h['x-user-name'] = user;
  return h;
}

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escAttr(value) {
  return esc(value).replaceAll('"', '&quot;');
}

function downloadJson(payload, filename) {
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════
//  ANALYSIS DASHBOARD RENDERING
// ═══════════════════════════════════════

function renderAnalysisDashboard(analysis) {
  const dash = $('#analysis-dashboard');
  if (!dash || !analysis) return;
  dash.style.display = 'block';

  // Show the Generate Response button and options
  const genBtn = $('#generate-response');
  if (genBtn) genBtn.style.display = '';
  const genOpts = $('#generate-response-options');
  if (genOpts) genOpts.style.display = '';

  renderAnalysisSummary(analysis.summary);
  renderBidScore(analysis.bidNoBid);
  renderFitFactors(analysis.bidNoBid?.fitFactors);
  renderEvalCriteria(analysis.evaluationCriteria);
  renderSkuList(analysis.skuList);
  renderRiskLog(analysis.riskLog);
  renderRequirementsSummary(analysis.requirements);
  renderResponseOutline(analysis.responseOutline);
  renderKeyDates(analysis.keyDates);
  renderCompliance(analysis.saskatchewanCompliance);
  renderCompetitive(analysis.competitiveNotes);
}

function renderAnalysisSummary(s) {
  const el = $('#analysis-summary');
  if (!el || !s) return;
  el.innerHTML = `
    <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:8px">${esc(s.title)}</h2>
        <div class="summary-field"><span class="summary-label">Issuer</span> ${esc(s.issuer)}</div>
        <div class="summary-field"><span class="summary-label">Contract Type</span> ${esc(s.contractType)}</div>
        <div class="summary-field"><span class="summary-label">Contract Term</span> ${esc(s.contractTerm)}</div>
      </div>
      <div>
        <div class="summary-field"><span class="summary-label">Closing Date</span> <strong style="color:var(--xerox-red)">${esc(s.closingDate)}</strong></div>
        <div class="summary-field"><span class="summary-label">Estimated Value</span> <strong>${esc(s.estimatedValue)}</strong></div>
        <div class="summary-field"><span class="summary-label">Delivery Location</span> ${esc(s.deliveryLocation)}</div>
        <div class="summary-field"><span class="summary-label">Submission Method</span> ${esc(s.submissionMethod)}</div>
      </div>
    </div>`;
}

function renderBidScore(bid) {
  const el = $('#analysis-bid-score');
  const dbEl = $('#analysis-deal-breakers');
  if (!el || !bid) return;

  const score = bid.score || 0;
  const color = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : score >= 40 ? '#F97316' : 'var(--danger)';
  const pct = Math.min(100, Math.max(0, score));
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (pct / 100) * circumference;

  el.innerHTML = `
    <div class="score-gauge-container">
      <svg class="score-gauge" width="140" height="140" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" stroke-width="8"/>
        <circle cx="60" cy="60" r="54" fill="none" stroke="${color}" stroke-width="8"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
          stroke-linecap="round" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1s ease"/>
        <text x="60" y="55" text-anchor="middle" font-size="28" font-weight="700" fill="${color}">${score}</text>
        <text x="60" y="72" text-anchor="middle" font-size="10" fill="var(--ink-secondary)">/ 100</text>
      </svg>
      <div class="score-recommendation" style="color:${color};font-weight:600;font-size:0.95rem;margin-top:12px">${esc(bid.recommendation)}</div>
    </div>`;

  if (dbEl) {
    if (bid.dealBreakers && bid.dealBreakers.length > 0) {
      dbEl.innerHTML = bid.dealBreakers.map((d) =>
        `<div class="deal-breaker-item">${esc(d)}</div>`
      ).join('');
    } else {
      dbEl.innerHTML = '<p class="empty-state" style="padding:12px">No deal breakers identified</p>';
    }
  }
}

function renderFitFactors(factors) {
  const el = $('#analysis-fit-factors');
  if (!el || !factors || factors.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No strategic fit data yet</p>'; return; }
  el.innerHTML = `<table class="analysis-table">
    <thead><tr><th>Factor</th><th>Score</th><th>Rationale</th></tr></thead>
    <tbody>${factors.map((f) => {
      const color = f.score >= 80 ? 'var(--success)' : f.score >= 60 ? 'var(--warning)' : f.score >= 40 ? '#F97316' : 'var(--danger)';
      return `<tr><td style="font-weight:600">${esc(f.factor)}</td><td><span class="score-pill" style="background:${color}">${f.score}</span></td><td>${esc(f.rationale)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderEvalCriteria(criteria) {
  const el = $('#analysis-eval-criteria');
  if (!el || !criteria || criteria.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No evaluation criteria found</p>'; return; }
  const maxWeight = Math.max(...criteria.map((c) => parseFloat(c.weight) || 0));
  el.innerHTML = `<table class="analysis-table">
    <thead><tr><th>Criterion</th><th>Weight</th><th>Max Points</th><th>Notes</th></tr></thead>
    <tbody>${criteria.map((c) => {
      const w = parseFloat(c.weight) || 0;
      const highlight = w === maxWeight && maxWeight > 0 ? ' class="eval-highlight"' : '';
      return `<tr${highlight}><td style="font-weight:600">${esc(c.criterion)}</td><td>${esc(c.weight)}</td><td>${esc(c.maxPoints)}</td><td>${esc(c.notes)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderSkuList(skus) {
  const el = $('#analysis-sku-list');
  if (!el || !skus || skus.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No products/SKUs identified</p>'; return; }

  const grouped = {};
  for (const s of skus) {
    const cat = s.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  }

  let html = '';
  for (const [cat, items] of Object.entries(grouped)) {
    html += `<h4 style="margin:16px 0 8px;font-size:0.85rem"><span class="category-badge cat-${cat}">${esc(cat)}</span></h4>`;
    html += `<table class="analysis-table"><thead><tr><th>Item</th><th>Qty</th><th>Specs</th><th>Xerox Match</th><th>Vendor Options</th><th>Est. Cost</th><th>Notes</th></tr></thead><tbody>`;
    for (const s of items) {
      html += `<tr><td style="font-weight:600">${esc(s.item)}</td><td>${esc(s.quantity)}</td><td>${esc(s.specs)}</td><td>${esc(s.xeroxPortfolioMatch)}</td><td>${esc(s.vendorOptions)}</td><td>${esc(s.estimatedUnitCost)}</td><td>${esc(s.notes)}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  el.innerHTML = html;
}

function renderRiskLog(risks) {
  const el = $('#analysis-risk-log');
  if (!el || !risks || risks.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No risks identified</p>'; return; }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...risks].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  el.innerHTML = `<div class="risk-grid">${sorted.map((r) => `
    <div class="risk-card risk-${r.severity}">
      <div class="risk-header">
        <span class="severity-badge sev-${r.severity}">${esc(r.severity)}</span>
        <span class="category-badge">${esc(r.category)}</span>
      </div>
      <div class="risk-text">${esc(r.risk)}</div>
      <div class="risk-mitigation"><strong>Mitigation:</strong> ${esc(r.mitigation)}</div>
    </div>`).join('')}</div>`;
}

function renderRequirementsSummary(reqs) {
  const el = $('#analysis-requirements');
  if (!el || !reqs || reqs.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No requirements extracted</p>'; return; }

  const counts = {};
  for (const r of reqs) {
    counts[r.reqType] = (counts[r.reqType] || 0) + 1;
  }

  let html = '<div class="req-type-badges">';
  for (const [type, count] of Object.entries(counts)) {
    html += `<span class="req-type-badge">${esc(type)} <strong>${count}</strong></span>`;
  }
  html += `<span class="req-type-badge" style="background:var(--xerox-red-subtle);color:var(--xerox-red)">Total <strong>${reqs.length}</strong></span></div>`;

  html += '<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--ink-secondary)">Show all requirements (' + reqs.length + ')</summary>';
  html += '<table class="analysis-table" style="margin-top:12px"><thead><tr><th>ID</th><th>Type</th><th>Must Have</th><th>Statement</th><th>Section</th><th>Confidence</th></tr></thead><tbody>';
  for (const r of reqs) {
    html += `<tr><td style="font-family:var(--font-mono);font-size:0.75rem">${esc(r.reqId)}</td><td><span class="req-type-badge">${esc(r.reqType)}</span></td><td>${r.mustHave ? '<span style="color:var(--danger);font-weight:700">YES</span>' : 'No'}</td><td>${esc(r.statement)}</td><td>${esc(r.sectionRef)}</td><td>${typeof r.confidence === 'number' ? (r.confidence * 100).toFixed(0) + '%' : esc(String(r.confidence))}</td></tr>`;
  }
  html += '</tbody></table></details>';
  el.innerHTML = html;
}

function renderResponseOutline(outline) {
  const el = $('#analysis-response-outline');
  if (!el || !outline || outline.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No response outline generated</p>'; return; }

  el.innerHTML = outline.map((s, i) => `
    <details class="outline-section"${i === 0 ? ' open' : ''}>
      <summary class="outline-summary">
        <strong>${esc(s.section)}</strong>
        <span class="outline-pages">${esc(s.pageEstimate)} pages</span>
      </summary>
      <div class="outline-body">
        <div style="margin-bottom:12px"><strong style="font-size:0.8rem;color:var(--ink-secondary)">Key Points:</strong>
          <ul class="outline-list">${(s.keyPoints || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>
        <div><strong style="font-size:0.8rem;color:var(--ink-secondary)">Supporting Materials:</strong>
          <ul class="outline-list evidence-list">${(s.evidenceNeeded || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        </div>
      </div>
    </details>`).join('');
}

function renderKeyDates(dates) {
  const el = $('#analysis-key-dates');
  if (!el || !dates || dates.length === 0) { if (el) el.innerHTML = '<p class="empty-state">No key dates found</p>'; return; }
  el.innerHTML = `<table class="analysis-table">
    <thead><tr><th>Event</th><th>Date</th><th>Notes</th></tr></thead>
    <tbody>${dates.map((d) => `<tr><td style="font-weight:600">${esc(d.event)}</td><td><strong>${esc(d.date)}</strong></td><td>${esc(d.notes)}</td></tr>`).join('')}</tbody></table>`;
}

function renderCompliance(c) {
  const el = $('#analysis-compliance');
  if (!el || !c) { if (el) el.innerHTML = '<p class="empty-state">No compliance data</p>'; return; }

  const flag = (val, label) => `<span class="compliance-flag ${val ? 'flag-yes' : 'flag-no'}">${label}: ${val ? 'YES' : 'NO'}</span>`;
  el.innerHTML = `
    <div class="compliance-flags">
      ${flag(c.nwptaApplies, 'NWPTA Applies')}
      ${flag(c.cftaApplies, 'CFTA Applies')}
      ${flag(c.usContentRestrictions, 'US Content Restrictions')}
    </div>
    <div style="margin-top:16px">
      <div class="summary-field"><span class="summary-label">Local Preference</span> ${esc(c.localPreferenceNotes)}</div>
      <div class="summary-field" style="margin-top:8px"><span class="summary-label">Trade Agreements</span> ${esc(c.tradeAgreementNotes)}</div>
    </div>`;
}

function renderCompetitive(notes) {
  const el = $('#analysis-competitive');
  if (!el) return;
  if (!notes) { el.innerHTML = '<p class="empty-state">No competitive intelligence</p>'; return; }
  el.innerHTML = `<div style="font-size:0.9rem;line-height:1.7;color:var(--ink)">${esc(notes).replace(/\n/g, '<br>')}</div>`;
}

// ═══════════════════════════════════════
//  RESPONSE BUILDER
// ═══════════════════════════════════════

const SKU_CATEGORIES = ['hardware', 'software', 'licensing', 'cloud', 'security', 'network', 'print', 'av', 'services', 'other'];

function renderResponseBuilder() {
  const a = state.analysis;
  const empty = $('#rb-empty');
  const content = $('#rb-content');
  if (!a) {
    if (empty) empty.style.display = '';
    if (content) content.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = '';

  // Summary fields
  const s = a.summary || {};
  setVal('#rb-title', s.title);
  setVal('#rb-issuer', s.issuer);
  setVal('#rb-closing-date', s.closingDate);
  setVal('#rb-value', s.estimatedValue);
  setVal('#rb-contract-type', s.contractType);
  setVal('#rb-contract-term', s.contractTerm);
  setVal('#rb-delivery', s.deliveryLocation);
  setVal('#rb-submission', s.submissionMethod);

  // SKU table
  renderRbSkuTable(a.skuList || []);

  // Response sections
  renderRbSections(a.responseOutline || []);

  // Key dates
  renderRbDates(a.keyDates || []);

  // Competitive
  setVal('#rb-competitive', a.competitiveNotes || '');

  // Readiness checklist
  renderRbChecklist();

  // Wire up buttons (idempotent — remove old listeners via clone)
  wireRbButton('#rb-save', handleRbSave);
  wireRbButton('#rb-save-bottom', handleRbSave);
  wireRbButton('#rb-generate', handleRbGenerate);
  wireRbButton('#rb-generate-bottom', handleRbGenerate);
  wireRbButton('#rb-add-sku', handleRbAddSku);
  wireRbButton('#rb-add-section', handleRbAddSection);
  wireRbButton('#rb-add-date', handleRbAddDate);
}

function renderRbChecklist() {
  const el = $('#rb-checklist');
  if (!el) return;
  const a = state.analysis || {};
  const d = state.detail || {};

  const checks = [
    { label: 'Tender selected', ok: !!state.selectedTenderId },
    { label: 'Document(s) uploaded', ok: (d.documents?.length || 0) > 0, detail: `${d.documents?.length || 0} document(s)` },
    { label: 'RFP analysis complete', ok: !!a.summary, detail: a.summary ? 'Done' : 'Run "Analyze RFP" first' },
    { label: 'Bid/No-Bid score', ok: typeof a.bidNoBid?.score === 'number', detail: a.bidNoBid ? `${a.bidNoBid.score}/100 — ${a.bidNoBid.recommendation || ''}` : 'Pending' },
    { label: 'Cover page fields filled', ok: !!(a.summary?.title && a.summary?.issuer), detail: a.summary?.title ? 'Title + Issuer set' : 'Fill in Summary section above' },
    { label: 'SKU / Pricing items', ok: (a.skuList?.length || 0) > 0, detail: `${a.skuList?.length || 0} item(s)` },
    { label: 'Response sections defined', ok: (a.responseOutline?.length || 0) > 0, detail: `${a.responseOutline?.length || 0} section(s)` },
    { label: 'Key dates', ok: (a.keyDates?.length || 0) > 0, detail: `${a.keyDates?.length || 0} date(s)` },
    { label: 'Risk log', ok: (a.riskLog?.length || 0) > 0, detail: `${a.riskLog?.length || 0} risk(s)` },
    { label: 'Saskatchewan compliance', ok: !!a.saskatchewanCompliance, detail: a.saskatchewanCompliance ? 'Populated' : 'Pending' }
  ];

  const done = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const pct = Math.round((done / total) * 100);
  const color = pct === 100 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';

  let html = `<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
    <div style="font-size:1.4rem;font-weight:700;color:${color}">${done}/${total}</div>
    <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s"></div>
    </div>
    <span style="font-size:0.82rem;color:var(--ink-secondary)">${pct === 100 ? 'Ready to generate' : 'Items to review'}</span>
  </div>`;

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  for (const c of checks) {
    const icon = c.ok
      ? '<span style="color:var(--success);font-weight:700">&#10003;</span>'
      : '<span style="color:var(--ink-tertiary)">&#9675;</span>';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:${c.ok ? 'var(--success-bg)' : 'var(--navy-50)'}">
      ${icon}
      <div>
        <div style="font-size:0.85rem;font-weight:600">${esc(c.label)}</div>
        ${c.detail ? `<div style="font-size:0.75rem;color:var(--ink-secondary)">${esc(c.detail)}</div>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';

  // Note about old Export vs Response Builder
  if (pct < 100) {
    html += `<div style="margin-top:16px;padding:10px 14px;background:var(--xerox-red-subtle);border:1px solid var(--xerox-red-border);border-radius:6px;font-size:0.82rem;color:var(--ink)">
      <strong>Note:</strong> The "Generate DOCX" button here works without governance gates. The old "Download DOCX Proposal" in the Export tab requires all section workflows to be approved — use this Response Builder instead for faster generation.
    </div>`;
  }

  el.innerHTML = html;
}

function setVal(sel, val) {
  const el = $(sel);
  if (el) el.value = val || '';
}

function wireRbButton(sel, handler) {
  const el = $(sel);
  if (!el) return;
  const fresh = el.cloneNode(true);
  el.parentNode.replaceChild(fresh, el);
  fresh.addEventListener('click', handler);
}

// ── SKU Table ──

function renderRbSkuTable(skus) {
  const body = $('#rb-sku-body');
  if (!body) return;
  body.innerHTML = '';
  for (const s of skus) {
    body.appendChild(makeSkuRow(s));
  }
}

function makeSkuRow(s) {
  const tr = document.createElement('tr');
  const catOptions = SKU_CATEGORIES.map((c) =>
    `<option value="${c}"${c === s.category ? ' selected' : ''}>${c}</option>`
  ).join('');
  tr.innerHTML = `
    <td><select class="rb-input" data-field="category">${catOptions}</select></td>
    <td><input class="rb-input" data-field="item" value="${escAttr(s.item || '')}" /></td>
    <td><input class="rb-input" data-field="quantity" value="${escAttr(s.quantity || '')}" style="width:50px" /></td>
    <td><input class="rb-input" data-field="specs" value="${escAttr(s.specs || '')}" /></td>
    <td><input class="rb-input" data-field="xeroxPortfolioMatch" value="${escAttr(s.xeroxPortfolioMatch || '')}" /></td>
    <td><input class="rb-input" data-field="estimatedUnitCost" value="${escAttr(s.estimatedUnitCost || '')}" style="width:100px" /></td>
    <td><input class="rb-input" data-field="notes" value="${escAttr(s.notes || '')}" /></td>
    <td><button class="btn btn-sm btn-ghost rb-remove-row" title="Remove" style="color:var(--danger)">&times;</button></td>`;
  tr.querySelector('.rb-remove-row').addEventListener('click', () => tr.remove());
  return tr;
}

function handleRbAddSku() {
  const body = $('#rb-sku-body');
  if (!body) return;
  body.appendChild(makeSkuRow({
    category: 'hardware', item: '', quantity: '1', specs: '',
    xeroxPortfolioMatch: '', vendorOptions: '', estimatedUnitCost: '', notes: ''
  }));
}

function collectSkuRows() {
  const rows = $$('#rb-sku-body tr');
  return rows.map((tr) => {
    const get = (field) => {
      const el = tr.querySelector(`[data-field="${field}"]`);
      return el ? el.value : '';
    };
    return {
      category: get('category'), item: get('item'), quantity: get('quantity'),
      specs: get('specs'), xeroxPortfolioMatch: get('xeroxPortfolioMatch'),
      vendorOptions: '', estimatedUnitCost: get('estimatedUnitCost'), notes: get('notes')
    };
  });
}

// ── Response Sections ──

function renderRbSections(outline) {
  const el = $('#rb-sections');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < outline.length; i++) {
    el.appendChild(makeSectionCard(outline[i], i));
  }
}

function makeSectionCard(section, index) {
  const div = document.createElement('div');
  div.className = 'rb-section-card';
  div.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <input class="rb-input" data-field="section" value="${escAttr(section.section || '')}" style="font-weight:700;font-size:1rem;flex:1;margin-right:12px" placeholder="Section title" />
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:0.8rem;color:var(--ink-secondary)">Pages:</label>
        <input class="rb-input" data-field="pageEstimate" value="${escAttr(section.pageEstimate || '')}" style="width:60px" />
        <button class="btn btn-sm btn-ghost rb-remove-section" title="Remove" style="color:var(--danger)">&times;</button>
      </div>
    </div>
    <div style="margin-bottom:8px">
      <label style="font-size:0.8rem;font-weight:600;color:var(--ink-secondary)">Key Points (one per line)</label>
      <textarea class="rb-input" data-field="keyPoints" rows="3" style="width:100%;font-family:var(--font);font-size:0.85rem;padding:8px;border:1px solid var(--border);border-radius:6px;resize:vertical">${esc((section.keyPoints || []).join('\n'))}</textarea>
    </div>
    <div>
      <label style="font-size:0.8rem;font-weight:600;color:var(--ink-secondary)">Supporting Materials (one per line)</label>
      <textarea class="rb-input" data-field="evidenceNeeded" rows="2" style="width:100%;font-family:var(--font);font-size:0.85rem;padding:8px;border:1px solid var(--border);border-radius:6px;resize:vertical">${esc((section.evidenceNeeded || []).join('\n'))}</textarea>
    </div>`;
  div.querySelector('.rb-remove-section').addEventListener('click', () => div.remove());
  return div;
}

function handleRbAddSection() {
  const el = $('#rb-sections');
  if (!el) return;
  const count = el.querySelectorAll('.rb-section-card').length;
  el.appendChild(makeSectionCard({ section: '', pageEstimate: '2-3', keyPoints: [], evidenceNeeded: [] }, count));
}

function collectSections() {
  return $$('#rb-sections .rb-section-card').map((card) => {
    const get = (field) => {
      const el = card.querySelector(`[data-field="${field}"]`);
      return el ? el.value : '';
    };
    return {
      section: get('section'),
      pageEstimate: get('pageEstimate'),
      keyPoints: get('keyPoints').split('\n').map((l) => l.trim()).filter(Boolean),
      evidenceNeeded: get('evidenceNeeded').split('\n').map((l) => l.trim()).filter(Boolean)
    };
  });
}

// ── Key Dates ──

function renderRbDates(dates) {
  const body = $('#rb-dates-body');
  if (!body) return;
  body.innerHTML = '';
  for (const d of dates) {
    body.appendChild(makeDateRow(d));
  }
}

function makeDateRow(d) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="rb-input" data-field="event" value="${escAttr(d.event || '')}" /></td>
    <td><input class="rb-input" data-field="date" value="${escAttr(d.date || '')}" /></td>
    <td><input class="rb-input" data-field="notes" value="${escAttr(d.notes || '')}" /></td>
    <td><button class="btn btn-sm btn-ghost rb-remove-row" title="Remove" style="color:var(--danger)">&times;</button></td>`;
  tr.querySelector('.rb-remove-row').addEventListener('click', () => tr.remove());
  return tr;
}

function handleRbAddDate() {
  const body = $('#rb-dates-body');
  if (!body) return;
  body.appendChild(makeDateRow({ event: '', date: '', notes: '' }));
}

function collectDates() {
  return $$('#rb-dates-body tr').map((tr) => {
    const get = (field) => {
      const el = tr.querySelector(`[data-field="${field}"]`);
      return el ? el.value : '';
    };
    return { event: get('event'), date: get('date'), notes: get('notes') };
  });
}

// ── Collect All Edits ──

function collectAnalysisEdits() {
  const a = state.analysis || {};
  return {
    ...a,
    summary: {
      ...(a.summary || {}),
      title: $('#rb-title')?.value || '',
      issuer: $('#rb-issuer')?.value || '',
      closingDate: $('#rb-closing-date')?.value || '',
      estimatedValue: $('#rb-value')?.value || '',
      contractType: $('#rb-contract-type')?.value || '',
      contractTerm: $('#rb-contract-term')?.value || '',
      deliveryLocation: $('#rb-delivery')?.value || '',
      submissionMethod: $('#rb-submission')?.value || ''
    },
    skuList: collectSkuRows(),
    responseOutline: collectSections(),
    keyDates: collectDates(),
    competitiveNotes: $('#rb-competitive')?.value || ''
  };
}

// ── Save ──

async function handleRbSave() {
  if (!state.selectedTenderId) { toast('No tender selected', 'error'); return; }
  const edited = collectAnalysisEdits();
  const status = $('#rb-save-status');
  if (status) status.textContent = 'Saving…';
  try {
    await fetch(`/api/tenders/${state.selectedTenderId}/analysis`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(edited)
    });
    state.analysis = edited;
    if (status) status.textContent = 'Saved';
    toast('Analysis edits saved', 'success');
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  } catch (err) {
    if (status) status.textContent = '';
    toast(`Save failed: ${err.message}`, 'error');
  }
}

// ── Generate ──

async function handleRbGenerate() {
  if (!state.selectedTenderId) { toast('No tender selected', 'error'); return; }

  // Auto-save before generating
  const edited = collectAnalysisEdits();
  try {
    await fetch(`/api/tenders/${state.selectedTenderId}/analysis`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(edited)
    });
    state.analysis = edited;
  } catch {}

  const btn = $('#rb-generate');
  const skipDrafts = Boolean($('#rb-skip-drafts')?.checked);
  if (btn) { btn.innerHTML = '<span class="spinner"></span> Generating DOCX…'; btn.disabled = true; }
  try {
    const response = await fetch(`/api/tenders/${state.selectedTenderId}/generate-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ skipDrafts })
    });
    if (!response.ok) {
      let msg = 'Generation failed.';
      try { const p = await response.json(); msg = p?.error || msg; } catch {}
      toast(msg, 'error');
      return;
    }
    const blob = await response.blob();
    const disp = response.headers.get('Content-Disposition') || '';
    const m = disp.match(/filename="?([^";]+)"?/i);
    const filename = (m && m[1]) || `rfp-response-${state.selectedTenderId}.docx`;
    downloadBlob(blob, filename);
    toast('RFP Response DOCX downloaded', 'success');
  } catch (err) {
    toast(`Generation failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.innerHTML = 'Generate DOCX'; btn.disabled = false; }
  }
}

// ═══════════════════════════════════════
//  GOVERNANCE ENHANCEMENTS
// ═══════════════════════════════════════

function initGovernanceHandlers() {
  // Polish All Sections button
  $('#polish-all-btn')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) { toast('Select a tender first', 'error'); return; }
    const btn = $('#polish-all-btn');
    btn.innerHTML = '<span class="spinner"></span> Polishing all sections...';
    btn.disabled = true;
    try {
      const response = await fetch(`/api/tenders/${state.selectedTenderId}/generate-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ skipDrafts: false })
      });
      if (!response.ok) {
        let msg = 'Polish failed.';
        try { const p = await response.json(); msg = p?.error || msg; } catch {}
        toast(msg, 'error');
        return;
      }
      const blob = await response.blob();
      const disp = response.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^";]+)"?/i);
      const filename = (m && m[1]) || `rfp-response-${state.selectedTenderId}.docx`;
      downloadBlob(blob, filename);
      toast('All sections polished and DOCX downloaded', 'success');
      await loadTenderDetail(state.selectedTenderId);
      renderExportReadiness();
    } catch (err) {
      toast(`Polish failed: ${err.message}`, 'error');
    } finally {
      btn.innerHTML = 'Polish All Sections';
      btn.disabled = false;
    }
  });

  // Governance Export button
  $('#governance-export')?.addEventListener('click', async () => {
    if (!state.selectedTenderId) return;
    const btn = $('#governance-export');
    btn.innerHTML = '<span class="spinner"></span> Exporting...';
    btn.disabled = true;
    try {
      const response = await fetch(`/api/tenders/${state.selectedTenderId}/generate-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ skipDrafts: false })
      });
      if (!response.ok) {
        let msg = 'Export failed.';
        try { const p = await response.json(); msg = p?.error || msg; } catch {}
        toast(msg, 'error');
        return;
      }
      const blob = await response.blob();
      const disp = response.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^";]+)"?/i);
      const filename = (m && m[1]) || `rfp-response-${state.selectedTenderId}.docx`;
      downloadBlob(blob, filename);
      toast('DOCX exported successfully', 'success');
    } catch (err) {
      toast(`Export failed: ${err.message}`, 'error');
    } finally {
      btn.innerHTML = 'Export DOCX';
      btn.disabled = false;
    }
  });
}

function renderExportReadiness() {
  const el = $('#export-readiness');
  const exportBtn = $('#governance-export');
  if (!el) return;

  const d = state.detail;
  if (!d) { el.innerHTML = ''; return; }

  const gates = d.gates || {};
  const workflow = d.sectionWorkflow || {};

  // Check gates
  const gateKeys = ['bidNoBid', 'requirementMap', 'pricingLegal'];
  const approvedGates = gateKeys.filter(k => gates[k]?.status === 'approved').length;
  const allGatesApproved = approvedGates === gateKeys.length;

  // Check sections
  const sectionEntries = Object.values(workflow);
  const approvedSections = sectionEntries.filter(s => s.status === 'approved' || s.status === 'locked').length;
  const allSectionsApproved = approvedSections === sectionEntries.length;

  const ready = allGatesApproved && allSectionsApproved;

  if (ready) {
    el.className = 'export-readiness-bar ready';
    el.innerHTML = `
      <span class="readiness-icon">&#10003;</span>
      <span class="readiness-text">Ready to export</span>
      <span class="readiness-detail">${approvedGates}/3 gates approved, ${approvedSections}/${sectionEntries.length} sections approved</span>`;
    if (exportBtn) exportBtn.disabled = false;
  } else {
    const blockers = [];
    if (!allGatesApproved) blockers.push(`${3 - approvedGates} gate${3 - approvedGates > 1 ? 's' : ''} pending`);
    if (!allSectionsApproved) blockers.push(`${sectionEntries.length - approvedSections} section${sectionEntries.length - approvedSections > 1 ? 's' : ''} in draft`);

    el.className = 'export-readiness-bar blocked';
    el.innerHTML = `
      <span class="readiness-icon">&#9888;</span>
      <span class="readiness-text">Blocked</span>
      <span class="readiness-detail">${blockers.join(', ')}</span>`;
    if (exportBtn) exportBtn.disabled = true;
  }
}
