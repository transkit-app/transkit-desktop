import { invoke } from '@tauri-apps/api/tauri';

export { info, Language } from './info';
export { Config } from './Config';

async function getSidecarPort() {
    const port = await invoke('local_sidecar_get_port').catch(() => 0);
    if (!port) throw new Error('Local Model is not running. Enable it in Settings → Local Model.');
    return port;
}

export async function tts(text, lang, options = {}) {
    const { config } = options;
    const port = await getSidecarPort();

    const res = await fetch(`http://127.0.0.1:${port}/v1/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text,
            voice:  config?.voice  ?? 'af_heart',
            speed:  config?.speed  ?? 1.0,
            format: 'wav',
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? `Local Model TTS error: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
}
