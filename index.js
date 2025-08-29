/* NanoGPT Claude Prompt Cache (Compat UI)
 * Forces a small floating settings panel (works even if ST's extension section helpers differ).
 * Still stores to SillyTavern extensionSettings for persistence and patches request sender.
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

function getSettings() {
  const c = ctx();
  if (!c) return structuredClone(defaultSettings);
  const store = c.extensionSettings || (c.extensionSettings = {});
  if (!store[MODULE_NAME]) store[MODULE_NAME] = structuredClone(defaultSettings);
  for (const k of Object.keys(defaultSettings)) {
    if (!Object.hasOwn(store[MODULE_NAME], k)) store[MODULE_NAME][k] = defaultSettings[k];
  }
  return store[MODULE_NAME];
}

function saveSettings() {
  try { ctx()?.saveSettingsDebounced?.(); } catch {}
}

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
          overridePayload = {
            ...overridePayload,
            cache_control: { enabled: true, ttl: s.ttl || '5m' },
          };
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

// ------- Compat UI (floating) -------
function buildCompatUI() {
  if (document.getElementById('ngptc-compat-root')) return;

  const root = document.createElement('div');
  root.id = 'ngptc-compat-root';
  root.className = 'ngptc-compat-root';

  root.innerHTML = `
    <button class="ngptc-chip" title="NanoGPT Cache Settings">NGPT Cache</button>
    <div class="ngptc-panel" hidden>
      <div class="ngptc-header">
        <span>NanoGPT Prompt Cache</span>
        <button class="ngptc-close" title="Close">×</button>
      </div>
      <div class="ngptc-body">
        <label class="row"><input type="checkbox" data-k="enabled"> Enable cache_control</label>
        <label class="row">TTL <input type="text" data-k="ttl" placeholder="5m or 1h"></label>
        <label class="row"><input type="checkbox" data-k="onlyClaude"> Only when model looks like Claude</label>
        <label class="row">
          <input type="checkbox" data-k="onlyWhenNanoGPT"> Only when API URL contains
          <input type="text" class="sub" data-k="urlSubstring" placeholder="nanogpt">
        </label>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  const s = getSettings();
  const panel = root.querySelector('.ngptc-panel');
  const chip = root.querySelector('.ngptc-chip');
  const close = root.querySelector('.ngptc-close');

  root.querySelector('[data-k="enabled"]').checked = !!s.enabled;
  root.querySelector('[data-k="ttl"]').value = s.ttl || '5m';
  root.querySelector('[data-k="onlyClaude"]').checked = !!s.onlyClaude;
  root.querySelector('[data-k="onlyWhenNanoGPT"]').checked = !!s.onlyWhenNanoGPT;
  root.querySelector('[data-k="urlSubstring"]').value = s.urlSubstring || 'nanogpt';

  chip.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  close.addEventListener('click', () => { panel.hidden = true; });

  root.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const key = el.getAttribute('data-k');
      const val = (el.type === 'checkbox') ? !!el.checked : (el.value || '').trim();
      const store = getSettings();
      store[key] = val;
      saveSettings();
    });
  });
}

function maybeMountCompatUI() {
  buildCompatUI();
  try {
    const c = ctx();
    c?.eventSource?.on?.(c.event_types?.APP_READY, () => buildCompatUI());
    c?.eventSource?.on?.(c.event_types?.SETTINGS_UPDATED, () => buildCompatUI());
  } catch {}
}

(function init() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'style.css';
  document.head.appendChild(link);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installPatch(); maybeMountCompatUI(); });
  } else {
    installPatch(); maybeMountCompatUI();
  }
})();
