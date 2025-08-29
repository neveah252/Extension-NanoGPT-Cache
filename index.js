/* NanoGPT Claude Prompt Cache (Compat UI) v1.2.0
 * - Draggable mini chip; remembers position
 * - Ctrl+Alt+N toggles panel
 * - Option to hide chip entirely
 * - If ST extension section exists, render there and auto-hide chip
 */

/* global SillyTavern */

const MODULE_NAME = 'nanogpt_cache';
const defaultSettings = Object.freeze({
  enabled: true,
  ttl: '5m',
  onlyClaude: true,
  onlyWhenNanoGPT: false,
  urlSubstring: 'nanogpt',
  chipHidden: false,
  chipPos: { x: null, y: null } // saved in px from bottom-right
});

function ctx() { return SillyTavern?.getContext?.(); }

function clone(v){ return JSON.parse(JSON.stringify(v)); }

function getSettings() {
  const c = ctx();
  if (!c) return clone(defaultSettings);
  const store = c.extensionSettings || (c.extensionSettings = {});
  if (!store[MODULE_NAME]) store[MODULE_NAME] = clone(defaultSettings);
  for (const k of Object.keys(defaultSettings)) {
    if (!Object.hasOwn(store[MODULE_NAME], k)) store[MODULE_NAME][k] = clone(defaultSettings[k]);
  }
  return store[MODULE_NAME];
}

function saveSettings() { try { ctx()?.saveSettingsDebounced?.(); } catch {} }

// ------- Payload patch -------
function installPatch() {
  const c = ctx();
  const svc = c?.ConnectionManagerRequestService;
  if (!svc || typeof svc.sendRequest !== 'function') {
    console.warn('[NanoGPT-Cache] ConnectionManagerRequestService.sendRequest not found.');
    return;
  }
  if (svc.__ngptc_patched) return;

  const original = svc.sendRequest.bind(svc);
  svc.sendRequest = async function patchedSendRequest(profileId, prompt, maxTokens, custom, overridePayload = {}) {
    try {
      const s = getSettings();
      if (s.enabled) {
        const profiles = c.profiles;
        const profile = profiles?.[profileId] || {};
        const model = profile.model || '';
        const apiUrl = profile['api-url'] || '';
        const isClaude = /claude/i.test(model);
        const urlMatch = s.onlyWhenNanoGPT ? (apiUrl && apiUrl.toLowerCase().includes((s.urlSubstring || '').toLowerCase())) : true;
        if ((!s.onlyClaude || isClaude) && urlMatch) {
          overridePayload = { ...overridePayload, cache_control: { enabled: true, ttl: s.ttl || '5m' } };
        }
      }
    } catch (e) {
      console.warn('[NanoGPT-Cache] failed to prepare overridePayload', e);
    }
    return original(profileId, prompt, maxTokens, custom, overridePayload);
  };
  svc.__ngptc_patched = true;
  console.log('[NanoGPT-Cache] sendRequest() patched');
}

// ------- Shared settings form -------
function buildSettingsContent(container) {
  const s = getSettings();
  container.innerHTML = `
    <div class="ngptc-body">
      <label class="row"><input type="checkbox" data-k="enabled"> Enable cache_control</label>
      <label class="row">TTL <input type="text" data-k="ttl" placeholder="5m or 1h"></label>
      <label class="row"><input type="checkbox" data-k="onlyClaude"> Only when model looks like Claude</label>
      <label class="row">
        <input type="checkbox" data-k="onlyWhenNanoGPT"> Only when API URL contains
        <input type="text" class="sub" data-k="urlSubstring" placeholder="nanogpt">
      </label>
      <label class="row"><input type="checkbox" data-k="chipHidden"> Hide floating button (use Ctrl+Alt+N)</label>
    </div>
  `;
  container.querySelector('[data-k="enabled"]').checked = !!s.enabled;
  container.querySelector('[data-k="ttl"]').value = s.ttl || '5m';
  container.querySelector('[data-k="onlyClaude"]').checked = !!s.onlyClaude;
  container.querySelector('[data-k="onlyWhenNanoGPT"]').checked = !!s.onlyWhenNanoGPT;
  container.querySelector('[data-k="urlSubstring"]').value = s.urlSubstring || 'nanogpt';
  container.querySelector('[data-k="chipHidden"]').checked = !!s.chipHidden;

  container.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const key = el.getAttribute('data-k');
      const val = (el.type === 'checkbox') ? !!el.checked : (el.value || '').trim();
      const store = getSettings();
      store[key] = val;
      saveSettings();
      if (key === 'chipHidden') updateChipVisibility();
    });
  });
}

// ------- Extension-tab panel (preferred) -------
function mountSettingsPanelIfSupported() {
  const c = ctx();
  const container = c?.getExtensionSection?.(MODULE_NAME, 'NanoGPT Prompt Cache');
  if (!container) return false;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ngptc-wrap';
  buildSettingsContent(wrap);
  container.appendChild(wrap);
  return true;
}

// ------- Floating UI (fallback + optional) -------
let chip, panel;
function ensureFloatingUI() {
  if (document.getElementById('ngptc-chip')) return;

  chip = document.createElement('button');
  chip.id = 'ngptc-chip';
  chip.className = 'ngptc-chip';
  chip.title = 'NanoGPT Cache Settings (Ctrl+Alt+N)';
  chip.textContent = 'N';

  panel = document.createElement('div');
  panel.id = 'ngptc-panel';
  panel.className = 'ngptc-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="ngptc-header">
      <span>NanoGPT Prompt Cache</span>
      <button class="ngptc-close" title="Close">×</button>
    </div>
    <div class="ngptc-inner"></div>
  `;
  document.body.append(chip, panel);

  // Fill settings
  buildSettingsContent(panel.querySelector('.ngptc-inner'));

  // Positioning (from settings)
  const s = getSettings();
  positionChipFromSettings();

  // Drag
  let dragging = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;
  chip.addEventListener('mousedown', (e) => {
    dragging = true;
    chip.classList.add('dragging');
    startX = e.clientX; startY = e.clientY;
    const rect = chip.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newRight = Math.max(4, startRight - dx);
    const newBottom = Math.max(4, startBottom - dy);
    chip.style.right = newRight + 'px';
    chip.style.bottom = newBottom + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; chip.classList.remove('dragging');
    persistChipPosition();
  });

  // Toggle
  chip.addEventListener('click', () => { if (!dragging) panel.hidden = !panel.hidden; });
  panel.querySelector('.ngptc-close')?.addEventListener('click', () => panel.hidden = true);

  // Shortcut
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'n' || e.key === 'N')) {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.focus();
    }
  });

  updateChipVisibility();
}

function positionChipFromSettings() {
  const s = getSettings();
  const right = (s.chipPos?.x == null) ? 12 : s.chipPos.x;
  const bottom = (s.chipPos?.y == null) ? 12 : s.chipPos.y;
  chip.style.right = right + 'px';
  chip.style.bottom = bottom + 'px';
}

function persistChipPosition() {
  const rect = chip.getBoundingClientRect();
  const right = Math.max(4, Math.round(window.innerWidth - rect.right));
  const bottom = Math.max(4, Math.round(window.innerHeight - rect.bottom));
  const s = getSettings();
  s.chipPos = { x: right, y: bottom };
  saveSettings();
}

function updateChipVisibility() {
  const s = getSettings();
  if (!chip) return;
  chip.style.display = s.chipHidden ? 'none' : 'inline-flex';
}

function init() {
  // inject styles
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'style.css';
  document.head.appendChild(link);

  installPatch();

  // Preferred: mount inside Extensions tab if API exists
  const hasPanel = mountSettingsPanelIfSupported();

  // Fallback/Optional: floating UI
  ensureFloatingUI();
  if (hasPanel) {
    // Auto-hide chip by default if extension section exists
    const s = getSettings();
    if (s.chipHidden === false) { s.chipHidden = true; saveSettings(); }
    updateChipVisibility();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
