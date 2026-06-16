/* ═══════════════════════════════════════════════════════════════
   ArticleForge AI — Main Application Logic
   ═══════════════════════════════════════════════════════════════ */

import { marked } from 'marked';

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

// ── State ────────────────────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem('af-api-key') || '',
  model: localStorage.getItem('af-model') || 'gemini-2.5-flash',
  theme: localStorage.getItem('af-theme') || 'dark',
  targetAudience: localStorage.getItem('af-audience') || '',
  brand: localStorage.getItem('af-brand') || '',
  currentMode: 'compose', // 'compose' | 'update'
  queue: [],
  activeItemId: null,
  isGenerating: false,
};

let nextId = 1;

// ── DOM References ───────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Settings modal
  settingsModal: $('#settingsModal'),
  openSettings: $('#openSettings'),
  closeSettings: $('#closeSettings'),
  saveSettings: $('#saveSettings'),
  apiKeyInput: $('#apiKeyInput'),
  modelSelect: $('#modelSelect'),
  toggleKeyVisibility: $('#toggleKeyVisibility'),
  apiStatus: $('#apiStatus'),
  themeToggleBtn: $('#themeToggleBtn'),
  themeIconDark: $('#themeIconDark'),
  themeIconLight: $('#themeIconLight'),

  // Form
  articleForm: $('#articleForm'),
  modeComposeBtn: $('#modeComposeBtn'),
  modeUpdateBtn: $('#modeUpdateBtn'),
  titleInput: $('#titleInput'),
  wpUrlInput: $('#wpUrlInput'),
  targetSubtitleInput: $('#targetSubtitleInput'),
  topicInput: $('#topicInput'),
  keyphraseInput: $('#keyphraseInput'),
  toneSelect: $('#toneSelect'),
  styleInput: $('#styleInput'),
  customPromptInput: $('#customPromptInput'),
  targetAudienceInput: $('#targetAudienceInput'),
  brandInput: $('#brandInput'),
  starterInput: $('#starterInput'),
  starterWritingsInput: $('#starterWritingsInput'),
  quotationsContainer: $('#quotationsContainer'),
  addQuotationBtn: $('#addQuotationBtn'),
  addToQueueBtn: $('#addToQueueBtn'),
  generateSingleBtn: $('#generateSingleBtn'),

  // Queue
  queueList: $('#queueList'),
  queueCount: $('#queueCount'),
  clearQueueBtn: $('#clearQueueBtn'),
  generateAllBtn: $('#generateAllBtn'),
  emptyQueue: $('#emptyQueue'),

  // Preview
  previewActions: $('#previewActions'),
  previewRendered: $('#previewRendered'),
  previewRaw: $('#previewRaw'),
  previewStats: $('#previewStats'),
  emptyPreview: $('#emptyPreview'),
  tabRendered: $('#tabRendered'),
  tabRaw: $('#tabRaw'),
  copyBtn: $('#copyBtn'),
  downloadBtn: $('#downloadBtn'),
  statWords: $('#statWords'),
  statReadTime: $('#statReadTime'),
  statKeyphrase: $('#statKeyphrase'),
  statSections: $('#statSections'),

  // Toast
  toastContainer: $('#toastContainer'),
};

// ── Initialization ───────────────────────────────────────────────
function init() {
  // Load settings
  dom.apiKeyInput.value = state.apiKey;
  dom.modelSelect.value = state.model;
  updateApiStatus();
  applyTheme();

  // Settings modal
  dom.openSettings.addEventListener('click', () => openModal());
  dom.closeSettings.addEventListener('click', () => closeModal());
  dom.settingsModal.addEventListener('click', (e) => {
    if (e.target === dom.settingsModal) closeModal();
  });
  dom.saveSettings.addEventListener('click', saveSettings);
  dom.toggleKeyVisibility.addEventListener('click', toggleKeyVisibility);
  dom.themeToggleBtn.addEventListener('click', toggleTheme);

  // Form actions
  dom.modeComposeBtn.addEventListener('click', () => switchMode('compose'));
  dom.modeUpdateBtn.addEventListener('click', () => switchMode('update'));
  dom.addQuotationBtn.addEventListener('click', addQuotation);
  dom.addToQueueBtn.addEventListener('click', addToQueue);
  dom.generateSingleBtn.addEventListener('click', generateSingle);

  // Queue actions
  dom.clearQueueBtn.addEventListener('click', clearQueue);
  dom.generateAllBtn.addEventListener('click', generateAll);

  // Preview tabs
  dom.tabRendered.addEventListener('click', () => switchTab('rendered'));
  dom.tabRaw.addEventListener('click', () => switchTab('raw'));

  // Export
  dom.copyBtn.addEventListener('click', copyToClipboard);
  dom.downloadBtn.addEventListener('click', downloadAsTxt);

  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Show settings if no API key
  if (!state.apiKey) {
    setTimeout(() => openModal(), 500);
  }
}

// ── Settings ─────────────────────────────────────────────────────
function openModal() {
  dom.settingsModal.classList.add('active');
  dom.apiKeyInput.focus();
}

function closeModal() {
  dom.settingsModal.classList.remove('active');
}

function saveSettings() {
  state.apiKey = dom.apiKeyInput.value.trim();
  state.model = dom.modelSelect.value;
  localStorage.setItem('af-api-key', state.apiKey);
  localStorage.setItem('af-model', state.model);
  updateApiStatus();
  closeModal();
  showToast(state.apiKey ? 'Settings saved successfully!' : 'Please add an API key to get started.', state.apiKey ? 'success' : 'info');
}

function toggleKeyVisibility() {
  const input = dom.apiKeyInput;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function updateApiStatus() {
  const statusDot = dom.apiStatus.querySelector('.status-dot');
  const statusText = dom.apiStatus.querySelector('.status-text');
  if (state.apiKey) {
    statusDot.className = 'status-dot status-connected';
    statusText.textContent = 'API Connected';
  } else {
    statusDot.className = 'status-dot status-disconnected';
    statusText.textContent = 'No API Key';
  }
}

// ── Theme Management ─────────────────────────────────────────────
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  if (state.theme === 'light') {
    dom.themeIconDark.style.display = 'none';
    dom.themeIconLight.style.display = 'block';
  } else {
    dom.themeIconDark.style.display = 'block';
    dom.themeIconLight.style.display = 'none';
  }
}

function toggleTheme(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('af-theme', state.theme);
  applyTheme();
}

// ── Form Helpers ─────────────────────────────────────────────────
function switchMode(mode) {
  state.currentMode = mode;
  dom.articleForm.className = `mode-${mode}`;
  
  if (mode === 'compose') {
    dom.modeComposeBtn.classList.add('active');
    dom.modeUpdateBtn.classList.remove('active');
  } else {
    dom.modeUpdateBtn.classList.add('active');
    dom.modeComposeBtn.classList.remove('active');
  }
}

function addQuotation() {
  const div = document.createElement('div');
  div.className = 'quotation-item';
  div.innerHTML = `
    <button type="button" class="remove-quote-btn" title="Remove quotation" onclick="this.parentElement.remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <input type="text" class="quote-name" placeholder="Expert Name or Title (e.g. John Doe, CEO of TechCorp)" />
    <input type="url" class="quote-url" placeholder="Social Media / Website Link (optional)" />
    <textarea class="quote-text" rows="2" placeholder="Paste the quotation here..."></textarea>
  `;
  dom.quotationsContainer.appendChild(div);
}

function getFormData() {
  const quotations = Array.from(dom.quotationsContainer.querySelectorAll('.quotation-item'))
    .map(item => ({
      name: item.querySelector('.quote-name').value.trim(),
      url: item.querySelector('.quote-url').value.trim(),
      quote: item.querySelector('.quote-text').value.trim()
    }))
    .filter(q => q.name || q.quote);

  const common = {
    customPrompt: dom.customPromptInput.value.trim(),
    targetAudience: dom.targetAudienceInput.value.trim(),
    brand: dom.brandInput.value.trim(),
    expertQuotations: quotations.length > 0 ? quotations : undefined,
  };

  if (state.currentMode === 'compose') {
    return {
      ...common,
      mode: 'compose',
      title: dom.titleInput.value.trim(),
      topic: dom.topicInput.value.trim(),
      keyphrase: dom.keyphraseInput.value.trim(),
      tone: dom.toneSelect.value,
      styleInstructions: dom.styleInput.value.trim(),
      starterArticle: dom.starterInput.value.trim(),
    };
  } else {
    return {
      ...common,
      mode: 'update',
      title: dom.titleInput.value.trim(),
      wpUrl: dom.wpUrlInput.value.trim(),
      targetSubtitle: dom.targetSubtitleInput.value.trim(),
      starterWritings: dom.starterWritingsInput.value.trim(),
    };
  }
}

function validateForm() {
  const data = getFormData();
  if (!state.apiKey) {
    showToast('Please set your Gemini API key in Settings first.', 'error');
    openModal();
    return null;
  }
  if (!data.title) {
    showToast('Please enter an article title.', 'error');
    dom.titleInput.focus();
    return null;
  }
  
  if (data.mode === 'compose') {
    if (!data.topic) {
      showToast('Please enter a topic or core question.', 'error');
      dom.topicInput.focus();
      return null;
    }
    if (!data.keyphrase) {
      showToast('Please enter a focus keyphrase.', 'error');
      dom.keyphraseInput.focus();
      return null;
    }
  } else {
    if (!data.wpUrl) {
      showToast('Please enter the WordPress Post URL.', 'error');
      dom.wpUrlInput.focus();
      return null;
    }
    if (!data.targetSubtitle) {
      showToast('Please enter the Target Subtitle (H2).', 'error');
      dom.targetSubtitleInput.focus();
      return null;
    }
  }
  
  return data;
}

function clearForm() {
  // We keep the title and customPromptInput values for convenience
  dom.topicInput.value = '';
  dom.keyphraseInput.value = '';
  dom.styleInput.value = '';
  dom.starterInput.value = '';
  
  dom.wpUrlInput.value = '';
  dom.targetSubtitleInput.value = '';
  dom.starterWritingsInput.value = '';
  
  // Clear quotations
  dom.quotationsContainer.innerHTML = '';
  
  // Keep tone selection
}

// ── Queue Management ─────────────────────────────────────────────
function createQueueItem(data) {
  return {
    id: nextId++,
    ...data,
    status: 'pending', // pending | generating | complete | error
    progress: 0,
    progressMessage: '',
    article: '',
    wordCount: 0,
    error: '',
  };
}

function addToQueue() {
  const data = validateForm();
  if (!data) return;

  const item = createQueueItem(data);
  state.queue.push(item);
  
  // Save persistent fields
  localStorage.setItem('af-audience', data.targetAudience);
  localStorage.setItem('af-brand', data.brand);

  clearForm();
  renderQueue();
  showToast(`"${item.title}" added to queue.`, 'success');
}

function removeFromQueue(id) {
  const idx = state.queue.findIndex((q) => q.id === id);
  if (idx === -1) return;
  const item = state.queue[idx];
  if (item.status === 'generating') {
    showToast('Cannot remove an article that is currently generating.', 'error');
    return;
  }
  state.queue.splice(idx, 1);
  if (state.activeItemId === id) {
    state.activeItemId = null;
    renderPreview();
  }
  renderQueue();
}

function clearQueue() {
  if (state.isGenerating) {
    showToast('Cannot clear queue while generating.', 'error');
    return;
  }
  state.queue = [];
  state.activeItemId = null;
  renderQueue();
  renderPreview();
}

function selectQueueItem(id) {
  state.activeItemId = id;
  renderQueue();
  renderPreview();
}

// ── Queue Rendering ──────────────────────────────────────────────
function renderQueue() {
  dom.queueCount.textContent = state.queue.length;

  if (state.queue.length === 0) {
    dom.emptyQueue.style.display = 'flex';
    // Remove any existing queue items but keep the empty state
    const items = dom.queueList.querySelectorAll('.queue-item');
    items.forEach((el) => el.remove());
    return;
  }

  dom.emptyQueue.style.display = 'none';

  // Build queue HTML
  const html = state.queue
    .map((item) => {
      const isActive = item.id === state.activeItemId;
      const statusClass = `status-${item.status}`;
      const statusLabels = {
        pending: '⏳ Pending',
        generating: '⚡ Generating',
        complete: '✅ Complete',
        error: '❌ Error',
      };

      return `
      <div class="queue-item ${isActive ? 'active' : ''}" data-id="${item.id}" onclick="window.__selectItem(${item.id})">
        <div class="queue-item-header">
          <div class="queue-item-title">${escapeHtml(item.title)} <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: normal; margin-left: 4px;">(${item.mode === 'update' ? 'Update' : 'New'})</span></div>
          <span class="queue-item-status ${statusClass}">${statusLabels[item.status]}</span>
        </div>
        <div class="queue-item-meta">
          ${item.mode === 'compose' ? `
            <span>🔑 ${escapeHtml(item.keyphrase)}</span>
            <span>🎨 ${item.tone}</span>
          ` : `
            <span>🎯 ${escapeHtml(item.targetSubtitle)}</span>
          `}
          ${item.wordCount > 0 ? `<span>📝 ${item.wordCount.toLocaleString()} words</span>` : ''}
        </div>
        ${
          item.status === 'generating'
            ? `
          <div class="queue-item-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${item.progress}%"></div>
            </div>
            <div class="progress-text">${item.progressMessage || 'Starting...'}</div>
          </div>
        `
            : ''
        }
        ${
          item.status === 'error'
            ? `<div class="progress-text" style="color: var(--error); margin-top: 0.3rem">${escapeHtml(item.error)}</div>`
            : ''
        }
        <div class="queue-item-actions">
          ${
            item.status === 'pending'
              ? `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); window.__generateOne(${item.id})">▶ Generate</button>`
              : ''
          }
          ${
            item.status === 'complete' || item.status === 'error'
              ? `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); window.__regenerate(${item.id})">🔄 Retry</button>`
              : ''
          }
          ${
            item.status !== 'generating'
              ? `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); window.__removeItem(${item.id})" style="color: var(--error)">✕ Remove</button>`
              : ''
          }
        </div>
      </div>
    `;
    })
    .join('');

  // Replace content (keep empty state element)
  const items = dom.queueList.querySelectorAll('.queue-item');
  items.forEach((el) => el.remove());
  dom.queueList.insertAdjacentHTML('beforeend', html);
}

// Expose functions to onclick handlers
window.__selectItem = selectQueueItem;
window.__removeItem = removeFromQueue;
window.__generateOne = (id) => generateSingleById(id);
window.__regenerate = (id) => {
  const item = state.queue.find((q) => q.id === id);
  if (item) {
    item.status = 'pending';
    item.progress = 0;
    item.progressMessage = '';
    item.article = '';
    item.wordCount = 0;
    item.error = '';
    renderQueue();
    generateSingleById(id);
  }
};

// ── Preview Rendering ────────────────────────────────────────────
function renderPreview() {
  const item = state.queue.find((q) => q.id === state.activeItemId);

  if (!item || !item.article) {
    dom.emptyPreview.style.display = 'flex';
    dom.previewActions.style.display = 'none';
    dom.previewStats.style.display = 'none';
    dom.previewRendered.style.display = 'none';
    dom.previewRaw.style.display = 'none';
    dom.previewRendered.innerHTML = '';
    dom.previewRaw.textContent = '';
    return;
  }

  dom.emptyPreview.style.display = 'none';
  dom.previewActions.style.display = 'flex';
  dom.previewStats.style.display = 'grid';

  // Stats
  const wordCount = countWords(item.article);
  const readTime = Math.ceil(wordCount / 200);
  const keyphraseCount = countKeyphraseOccurrences(item.article, item.keyphrase);
  const sectionCount = (item.article.match(/^## /gm) || []).length;

  dom.statWords.textContent = wordCount.toLocaleString();
  dom.statReadTime.textContent = `${readTime} min`;
  dom.statKeyphrase.textContent = keyphraseCount;
  dom.statSections.textContent = sectionCount;

  // Rendered markdown
  dom.previewRendered.innerHTML = marked.parse(item.article);

  // Raw markdown
  dom.previewRaw.textContent = item.article;

  // Show correct tab
  const activeTab = dom.tabRendered.classList.contains('active') ? 'rendered' : 'raw';
  switchTab(activeTab);
}

function switchTab(tab) {
  if (tab === 'rendered') {
    dom.tabRendered.classList.add('active');
    dom.tabRaw.classList.remove('active');
    dom.previewRendered.style.display = 'block';
    dom.previewRaw.style.display = 'none';
  } else {
    dom.tabRaw.classList.add('active');
    dom.tabRendered.classList.remove('active');
    dom.previewRaw.style.display = 'block';
    dom.previewRendered.style.display = 'none';
  }
}

// ── Generation ───────────────────────────────────────────────────
async function generateSingle() {
  const data = validateForm();
  if (!data) return;

  const item = createQueueItem(data);
  state.queue.push(item);
  clearForm();
  renderQueue();

  await generateArticle(item);
}

async function generateSingleById(id) {
  const item = state.queue.find((q) => q.id === id);
  if (!item) return;
  if (state.isGenerating) {
    showToast('Please wait for the current generation to finish.', 'info');
    return;
  }
  await generateArticle(item);
}

async function generateAll() {
  if (state.isGenerating) {
    showToast('Generation is already in progress.', 'info');
    return;
  }

  const pendingItems = state.queue.filter((q) => q.status === 'pending');
  if (pendingItems.length === 0) {
    showToast('No pending articles in the queue.', 'info');
    return;
  }

  showToast(`Starting batch generation of ${pendingItems.length} article(s)...`, 'info');

  for (const item of pendingItems) {
    await generateArticle(item);
    // Small delay between articles to be nice to the API
    if (pendingItems.indexOf(item) < pendingItems.length - 1) {
      await sleep(1000);
    }
  }

  showToast(`Batch generation complete! ${pendingItems.filter((q) => q.status === 'complete').length} articles generated.`, 'success');
}

async function generateArticle(item) {
  state.isGenerating = true;
  item.status = 'generating';
  item.progress = 0;
  item.progressMessage = 'Initializing...';
  state.activeItemId = item.id;
  renderQueue();
  renderPreview();
  setGeneratingUI(true);

  try {
    const endpoint = item.mode === 'update' ? '/api/update-section' : '/api/generate';
    const bodyData = { 
      apiKey: state.apiKey, 
      model: state.model, 
      customPrompt: item.customPrompt || undefined, 
      targetAudience: item.targetAudience || undefined,
      brand: item.brand || undefined,
      expertQuotations: item.expertQuotations || undefined,
      title: item.title 
    };
    
    if (item.mode === 'update') {
      bodyData.wpUrl = item.wpUrl;
      bodyData.targetSubtitle = item.targetSubtitle;
      bodyData.starterWritings = item.starterWritings;
    } else {
      bodyData.topic = item.topic;
      bodyData.keyphrase = item.keyphrase;
      bodyData.starterArticle = item.starterArticle || undefined;
      bodyData.tone = item.tone;
      bodyData.styleInstructions = item.styleInstructions || undefined;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleSSEEvent(item, data);
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.slice(6));
        handleSSEEvent(item, data);
      } catch {
        // Skip
      }
    }

    if (item.status === 'generating') {
      // If we got here without a complete event, something went wrong
      item.status = 'error';
      item.error = 'Generation ended unexpectedly. Please try again.';
    }
  } catch (error) {
    item.status = 'error';
    item.error = error.message;
    showToast(`Error generating "${item.title}": ${error.message}`, 'error');
  } finally {
    state.isGenerating = false;
    setGeneratingUI(false);
    renderQueue();
    renderPreview();
  }
}

function handleSSEEvent(item, data) {
  switch (data.type) {
    case 'progress':
      item.progress = data.percent || item.progress;
      item.progressMessage = data.message || '';
      renderQueue();
      break;

    case 'outline':
      item.progress = data.percent || 10;
      item.progressMessage = `Outline ready: ${data.sections?.length || 0} sections`;
      renderQueue();
      break;

    case 'section_done':
      item.wordCount = data.wordCount || item.wordCount;
      item.progress = data.percent || item.progress;
      item.progressMessage = `Section "${data.name}" done — ${item.wordCount.toLocaleString()} words`;
      renderQueue();
      break;

    case 'complete':
      item.status = 'complete';
      item.article = data.article;
      item.wordCount = data.wordCount;
      item.progress = 100;
      item.progressMessage = '';
      showToast(`"${item.title}" generated! ${data.wordCount.toLocaleString()} words.`, 'success');
      renderQueue();
      renderPreview();
      break;

    case 'error':
      item.status = 'error';
      item.error = data.message;
      showToast(`Error: ${data.message}`, 'error');
      renderQueue();
      break;
  }
}

function setGeneratingUI(generating) {
  dom.generateAllBtn.disabled = generating;
  dom.generateSingleBtn.disabled = generating;
  dom.clearQueueBtn.disabled = generating;
}

// ── Export ────────────────────────────────────────────────────────
function copyToClipboard() {
  const item = state.queue.find((q) => q.id === state.activeItemId);
  if (!item?.article) return;

  navigator.clipboard
    .writeText(item.article)
    .then(() => showToast('Article copied to clipboard!', 'success'))
    .catch(() => showToast('Failed to copy to clipboard.', 'error'));
}

function downloadAsTxt() {
  const item = state.queue.find((q) => q.id === state.activeItemId);
  if (!item?.article) return;

  const blob = new Blob([item.article], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(item.title)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Article downloaded as .txt file!', 'success');
}

// ── Toast Notifications ──────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };

  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// ── Utilities ────────────────────────────────────────────────────
function countWords(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function countKeyphraseOccurrences(text, keyphrase) {
  if (!keyphrase) return 0;
  const regex = new RegExp(escapeRegExp(keyphrase), 'gi');
  return (text.match(regex) || []).length;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Initialize App ───────────────────────────────────────────────
// Load persistent fields
dom.targetAudienceInput.value = localStorage.getItem('af-audience') || '';
dom.brandInput.value = localStorage.getItem('af-brand') || '';

document.addEventListener('DOMContentLoaded', init);
