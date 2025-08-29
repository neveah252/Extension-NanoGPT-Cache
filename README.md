# Extension-NanoGPT-Cache

SillyTavern extension that injects `cache_control` for Claude requests sent through NanoGPT (or any compatible API).

## Install (Git URL method)
1. Create a new **public** GitHub repo, e.g. `Extension-NanoGPT-Cache`.
2. Upload all files from this folder to the repo **root** (same level as `manifest.json`).
3. In SillyTavern → **Extensions** → **Import from Git**, paste your repo URL:
   `https://github.com/<you>/Extension-NanoGPT-Cache`
4. Click **Install just for me** (or **for all users**), then restart ST.  
5. Enable **NanoGPT Prompt Cache** in the Extensions tab.

## Settings
- Toggle enable/disable.
- TTL string (e.g., `5m`, `1h`).
- Limit to Claude models only (default ON).
- Optional: only inject when API URL contains a substring (default `nanogpt`).

## Notes
This repo keeps the files at the repo root as required by ST's external extension importer.