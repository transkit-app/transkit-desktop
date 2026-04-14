import { Store } from 'tauri-plugin-store-api';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { watch } from 'tauri-plugin-fs-watch-api';
import { invoke } from '@tauri-apps/api';

export let store = new Store();

// Canonical defaults for service lists. These are written to the store on first run
// or after a reset so every component always reads a non-empty list, regardless of
// which page the user visits first.
const SERVICE_LIST_DEFAULTS = {
    translate_service_list:     ['google', 'bing', 'transkit_cloud_translate'],
    recognize_service_list:     ['system', 'tesseract'],
    tts_service_list:           ['transkit_cloud_tts', 'google_tts', 'edge_tts'],
    transcription_service_list: ['transkit_cloud_stt', 'deepgram_stt'],
    ai_service_list:            ['transkit_cloud_ai'],
};

export async function initStore() {
    const appConfigDirPath = await appConfigDir();
    const appConfigPath = await join(appConfigDirPath, 'config.json');
    store = new Store(appConfigPath);
    try { await store.load(); } catch (_) { /* first run — config.json doesn't exist yet */ }

    // Ensure service list defaults are present in the store before React renders.
    // This prevents pages with an incorrect empty-array default (e.g. LocalSidecar,
    // VoiceInput) from writing [] to the store and then showing an empty service list
    // on the Service/Translate page.
    let needsSave = false;
    for (const [key, defaultValue] of Object.entries(SERVICE_LIST_DEFAULTS)) {
        const existing = await store.get(key);
        if (existing === null) {
            await store.set(key, defaultValue);
            needsSave = true;
        }
    }
    if (needsSave) await store.save();

    // Do NOT await watch() — on Windows, watching a non-existent file can hang the promise
    // indefinitely, blocking React from rendering. Fire-and-forget is safe here since the
    // callback only fires on subsequent file changes, not during initial load.
    watch(appConfigPath, async () => {
        await store.load();
        await invoke('reload_store');
    }).catch(() => {});
}
