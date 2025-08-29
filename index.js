// NanoGPT Claude Prompt Cache Extension
// Adds cache_control to outgoing Chat Completions when using Claude models via NanoGPT.
// Requires ST build with ConnectionManagerRequestService overridePayload support.

/* global SillyTavern */

// ----- settings (persisted) -----
const MODULE_NAME = 'nanogpt_cache';
const defaultSettings = Object.freeze({
  enabled: true,
  ttl: '5m',                 // e.g. "5m", "1h"
  onlyClaude: true,          // only tag Claude-family models
  onlyWhenNanoGPT: false,    // set true if you ONLY want it when URL contains "nanogpt"
  urlSubstring: 'nanogpt',   // used when onlyWhenNanoGPT is true
});

function getSettings() {
  const ctx = SillyTavern.getContext();
  const { extensionSettings } = ctx;
  if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
  // backfill new keys on update
  for (const k of Object.keys(defaultSettings)) {
    if (!Object.hasOwn(extensionSettings[MODULE_NAME], k)) {
      extensionSettings[MODULE_NAME][k] = defaultSettings[k];
    }
  }
  return extensionSettings[MODULE_NAME];
}

function saveSettings() {
  SillyTavern.getContext().saveSettingsDebounced();
}

// ----- tiny UI toggle in Extensions panel -----
function renderSettingsPanel() {
  const wrap = document.createElement('div');
  wrap.className = 'ngptc-wrap';

  const s = getSettings();

  // enabled
  const en = document.createElement('label');
  en.innerHTML = `<input type="checkbox" ${s.enabled ? 'checked' : ''}/> Enable cache_control`;
  en.querySelector('input').addEventListener('change', (e) => { s.enabled = !!e.target.checked; saveSettings(); });
  wrap.appendChild(en);

  // ttl
  const ttl = document.createElement('label');
  ttl.className = 'ngptc-row';
  ttl.innerHTML = `TTL <input type="text" value="${s.ttl}" placeholder="5m or 1h" />`;
  ttl.querySelector('input').addEventListener('input', (e) => { s.ttl = e.target.value.trim(); saveSettings(); });
  wrap.appendChild(ttl);

  // onlyClaude
  const oc = document.createElement('label');
  oc.className = 'ngptc-row';
  oc.innerHTML = `<input type="checkbox" ${s.onlyClaude ? 'checked' : ''}/> Only when model looks like Claude`;
  oc.querySelector('input').addEventListener('change', (e) => { s.onlyClaude = !!e.target.checked; saveSettings(); });
  wrap.appendChild(oc);

  // onlyWhenNanoGPT + substring
  const ow = document.createElement('label');
  ow.className = 'ngptc-row';
  ow.innerHTML = `<input type="checkbox" ${s.onlyWhenNanoGPT ? 'checked' : ''}/> Only when API URL contains:`;
  const sub = document.createElement('input');
  sub.type = 'text';
  sub.value = s.urlSubstring;
  sub.placeholder = 'nanogpt';
  sub.className = 'ngptc-sub';
  ow.appendChild(sub);
  ow.querySelector('input[type="checkbox"]').addEventListener('change', (e) => { s.onlyWhenNanoGPT = !!e.target.checked; saveSettings(); });
  sub.addEventListener('input', (e) => { s.urlSubstring = e.target.value.trim(); saveSettings(); });
  wrap.appendChild(ow);

  return wrap;
}

function mountSettingsPanel() {
  const ctx = SillyTavern.getContext();
  const container = ctx.getExtensionSection(MODULE_NAME, 'NanoGPT Prompt Cache');
  container.innerHTML = '';
  container.appendChild(renderSettingsPanel());
}

// ----- monkey-patch request sender to inject overridePayload -----
function installPatch() {
  const ctx = SillyTavern.getContext();
  const { ConnectionManagerRequestService } = ctx; // public/scripts/extensions/shared.js

  if (!ConnectionManagerRequestService || typeof ConnectionManagerRequestService.sendRequest !== 'function') {
    console.warn('[NanoGPT-Cache] ConnectionManagerRequestService.sendRequest not found.');
    return;
  }

  if (ConnectionManagerRequestService.__ngptc_patched) return;

  const original = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);

  ConnectionManagerRequestService.sendRequest = async function patchedSendRequest(profileId, prompt, maxTokens, custom, overridePayload = {}) {
    try {
      const s = getSettings();
      if (s.enabled) {
        // Determine model & api url from the selected profile
        const profiles = ctx.profiles;
        const profile = profiles?.[profileId] || {};
        const model = profile.model || '';
        const apiUrl = profile['api-url'] || '';

        const isClaude = /claude/i.test(model);
        const urlMatch = s.onlyWhenNanoGPT ? (apiUrl && apiUrl.toLowerCase().includes((s.urlSubstring || '').toLowerCase())) : true;

        if ((!s.onlyClaude || isClaude) && urlMatch) {
          // Merge our cache_control into any existing overridePayload
          overridePayload = {
            ...overridePayload,
            cache_control: {
              enabled: true,
              ttl: s.ttl || '5m',
            },
          };
        }
      }
    } catch (e) {
      console.warn('[NanoGPT-Cache] failed to prepare overridePayload', e);
    }

    // Call original with possibly augmented overridePayload
    return original(profileId, prompt, maxTokens, custom, overridePayload);
  };

  ConnectionManagerRequestService.__ngptc_patched = true;
  console.log('[NanoGPT-Cache] sendRequest() patched');
}

// ----- init -----
(function init() {
  const { eventSource, event_types } = SillyTavern.getContext();

  // Build settings UI when app is ready and on settings updates.
  eventSource.on(event_types.APP_READY, () => {
    installPatch();
    mountSettingsPanel();
  });

  eventSource.on(event_types.SETTINGS_UPDATED, () => {
    mountSettingsPanel();
  });
})();
