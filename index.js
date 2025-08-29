/* NanoGPT Claude Prompt Cache v1.4.0
 * Purpose: Add NanoGPT Claude prompt caching via cache_control.
 * Scope: Applies ONLY when API URL contains/hosts "nanogpt" (default) and model looks like "claude".
 * UI: 
 *   - Primary: settings panel inside Extensions drawer (non-invasive).
 *   - Secondary: tiny adaptive chip (16px) that expands to a small box; draggable; remembers position; can be disabled.
 *   - Colors/styles inherit from current theme; no fixed palette.
 */

/* global SillyTavern */

const MODULE_NAME = 'nanogpt_cache';
const defaultSettings = Object.freeze({
  enabled: true,
  ttl: '5m',
  onlyClaude: true,
  onlyWhenNanoGPT: true,      // default ON per your request
  urlSubstring: 'nanogpt',
  chipEnabled: true,
  chipPos: { x: null, y: null }
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
function saveSettings(){ try { ctx()?.saveSettingsDebounced?.(); } catch {} }

// --- Utility: host match ---
function apiMatchesNanoGPT(apiUrl, substr) {
  if (!apiUrl) return false;
  const s = (substr || '').toLowerCase();
  try {
    const u = new URL(apiUrl);
    return u.hostname.toLowerCase().includes(s) || u.href.toLowerCase().includes(s);
  } catch {
    return apiUrl.toLowerCase().includes(s);
  }
}

// --- Patch ---
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
        const model = String(profile.model || '');
        const apiUrl = String(profile['api-url'] || '');
        const isClaude = /claude/i.test(model);
        const nanoOk = s.onlyWhenNanoGPT ? apiMatchesNanoGPT(apiUrl, s.urlSubstring) : true;

        if (nanoOk && (!s.onlyClaude || isClaude)) {
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

// --- Shared settings form (used in drawer & small box) ---
function buildSettingsContent(container) {
  const s = getSettings();
  container.innerHTML = `
    <div class="ngptc-body">
      <label class="row"><input type="checkbox" data-k="enabled"> Enable cache_control (Claude)</label>
      <label class="row">TTL <input type="text" data-k="ttl" placeholder="5m or 1h"></label>
      <label class="row"><input type="checkbox" data-k="onlyClaude"> Only when model looks like Claude</label>
      <label class="row">
        <input type="checkbox" data-k="onlyWhenNanoGPT"> Only when API URL contains/host
        <input type="text" class="sub" data-k="urlSubstring" placeholder="nanogpt">
      </label>
      <label class="row"><input type="checkbox" data-k="chipEnabled"> Show mini box</label>
    </div>
  `;

  container.querySelector('[data-k="enabled"]').checked = !!s.enabled;
  container.querySelector('[data-k="ttl"]').value = s.ttl || '5m';
  container.querySelector('[data-k="onlyClaude"]').checked = !!s.onlyClaude;
  container.querySelector('[data-k="onlyWhenNanoGPT"]').checked = !!s.onlyWhenNanoGPT;
  container.querySelector('[data-k="urlSubstring"]').value = s.urlSubstring || 'nanogpt';
  container.querySelector('[data-k="chipEnabled"]').checked = !!s.chipEnabled;

  container.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const key = el.getAttribute('data-k');
      const val = (el.type === 'checkbox') ? !!el.checked : (el.value || '').trim();
      const st = getSettings(); st[key] = val; saveSettings();
      if (key === 'chipEnabled') syncChipVisibility();
    });
  });
}

// --- Drawer panel ---
function mountDrawerPanel() {
  const c = ctx();
  const getSec = c?.getExtensionSection;
  if (typeof getSec !== 'function') return false;
  const container = getSec(MODULE_NAME, 'NanoGPT Prompt Cache');
  if (!container) return false;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ngptc-wrap';
  buildSettingsContent(wrap);
  container.appendChild(wrap);
  return true;
}

// --- Small box (non-intrusive) ---
let chip, card;
function ensureMiniBox() {
  if (chip || card) return;
  const s = getSettings();

  chip = document.createElement('button');
  chip.className = 'ngptc-chip'; // 16px dot-like
  chip.title = 'NanoGPT Cache Settings';
  chip.setAttribute('aria-label','NanoGPT Cache Settings');

  card = document.createElement('div');
  card.className = 'ngptc-card';
  card.hidden = true;
  card.innerHTML = `
    <div class="ngptc-title">NanoGPT Prompt Cache</div>
    <div class="ngptc-inner"></div>
    <div class="ngptc-actions">
      <button class="btn small close">Close</button>
    </div>
  `;

  document.body.append(chip, card);
  buildSettingsContent(card.querySelector('.ngptc-inner'));

  // Position (bottom-right, remembers pos; card anchors above chip)
  positionFromSettings();
  let dragging = false, sx=0, sy=0, startR=0, startB=0;
  chip.addEventListener('mousedown', (e)=>{
    dragging = true; sx=e.clientX; sy=e.clientY;
    const rect = chip.getBoundingClientRect();
    startR = Math.max(0, window.innerWidth - rect.right);
    startB = Math.max(0, window.innerHeight - rect.bottom);
    document.body.classList.add('ngptc-dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e)=>{
    if(!dragging) return;
    const dx=e.clientX - sx, dy=e.clientY - sy;
    const r=Math.max(4, startR - dx), b=Math.max(4, startB - dy);
    chip.style.right = r + 'px'; chip.style.bottom = b + 'px';
    card.style.right = r + 'px'; card.style.bottom = (b + 22) + 'px';
  });
  window.addEventListener('mouseup', ()=>{
    if(!dragging) return;
    dragging=false; document.body.classList.remove('ngptc-dragging');
    persistChipPos();
  });

  chip.addEventListener('click', ()=>{ if (!dragging) { card.hidden = !card.hidden; }});
  card.querySelector('.close')?.addEventListener('click', ()=> card.hidden = true);
  syncChipVisibility();
}

function positionFromSettings() {
  const s = getSettings();
  const right = (s.chipPos?.x == null) ? 12 : s.chipPos.x;
  const bottom = (s.chipPos?.y == null) ? 12 : s.chipPos.y;
  if (chip) { chip.style.right = right+'px'; chip.style.bottom = bottom+'px'; }
  if (card) { card.style.right = right+'px'; card.style.bottom = (bottom+22)+'px'; }
}
function persistChipPos(){
  const rect = chip.getBoundingClientRect();
  const right = Math.max(4, Math.round(window.innerWidth - rect.right));
  const bottom = Math.max(4, Math.round(window.innerHeight - rect.bottom));
  const s = getSettings(); s.chipPos = { x: right, y: bottom }; saveSettings();
}
function syncChipVisibility(){
  const s = getSettings();
  if (chip) chip.style.display = s.chipEnabled ? 'inline-flex' : 'none';
  if (!s.chipEnabled && card) card.hidden = true;
}

function init() {
  // inject styles
  const link = document.createElement('link'); link.rel='stylesheet'; link.href='style.css'; document.head.appendChild(link);
  installPatch();

  const hasDrawer = mountDrawerPanel();
  // Always provide the mini box, but tiny & draggable; user can disable it.
  ensureMiniBox();
  if (hasDrawer) {
    // If drawer exists, default chip to enabled (tiny) but user can turn it off.
    syncChipVisibility();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
