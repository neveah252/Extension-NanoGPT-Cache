/* NanoGPT Claude Prompt Cache v1.3.0 (Silent UI)
 * - No floating UI, no overlays, no keyboard shortcuts.
 * - Renders ONLY inside Settings → Extensions → Third Party (if supported).
 * - If not supported, runs headless with defaults (enabled, ttl '5m').
 */

/* global SillyTavern */

const MODULE_NAME = 'nanogpt_cache';
const defaultSettings = Object.freeze({
  enabled: true,
  ttl: '5m',
  onlyClaude: true,
  onlyWhenNanoGPT: false,
  urlSubstring: 'nanogpt',
});

function ctx() { return SillyTavern?.getContext?.(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }

function getSettings() {
  const c = ctx();
  if (!c) return clone(defaultSettings);
  const store = c.extensionSettings || (c.extensionSettings = {});
  if (!store[MODULE_NAME]) store[MODULE_NAME] = clone(defaultSettings);
  // backfill keys
  for (const k of Object.keys(defaultSettings)) {
    if (!Object.hasOwn(store[MODULE_NAME], k)) store[MODULE_NAME][k] = clone(defaultSettings[k]);
  }
  return store[MODULE_NAME];
}

function saveSettings() { try { ctx()?.saveSettingsDebounced?.(); } catch {} }

// ---- Payload patch (no UI side effects) ----
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

// ---- Drawer panel (only if supported by this ST build) ----
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
    </div>
  `;

  container.querySelector('[data-k="enabled"]').checked = !!s.enabled;
  container.querySelector('[data-k="ttl"]').value = s.ttl || '5m';
  container.querySelector('[data-k="onlyClaude"]').checked = !!s.onlyClaude;
  container.querySelector('[data-k="onlyWhenNanoGPT"]').checked = !!s.onlyWhenNanoGPT;
  container.querySelector('[data-k="urlSubstring"]').value = s.urlSubstring || 'nanogpt';

  container.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const key = el.getAttribute('data-k');
      const val = (el.type === 'checkbox') ? !!el.checked : (el.value || '').trim();
      const st = getSettings();
      st[key] = val;
      saveSettings();
    });
  });
}

function mountSettingsPanel() {
  const c = ctx();
  const getSection = c?.getExtensionSection;
  if (typeof getSection !== 'function') {
    // No UI support on this build — stay headless.
    return;
  }
  const container = getSection(MODULE_NAME, 'NanoGPT Prompt Cache');
  if (!container) return;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ngptc-wrap';
  buildSettingsContent(wrap);
  container.appendChild(wrap);
}

function init() {
  installPatch();
  // Render inside drawer if available
  try {
    const c = ctx();
    c?.eventSource?.on?.(c.event_types?.APP_READY, () => mountSettingsPanel());
    c?.eventSource?.on?.(c.event_types?.SETTINGS_UPDATED, () => mountSettingsPanel());
    // Also try immediately for newer builds
    mountSettingsPanel();
  } catch {
    // ignore
  }
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
