import { invoke } from '@tauri-apps/api/tauri';

export { info, Language } from './info';
export { Config } from './Config';

async function getSidecarPort() {
    const port = await invoke('local_sidecar_get_port').catch(() => 0);
    if (!port) throw new Error('Local Model is not running. Enable it in Settings → Local Model.');
    return port;
}

export async function translate(text, from, to, options = {}) {
    const { config, setResult } = options;
    const port = await getSidecarPort();

    const res = await fetch(`http://127.0.0.1:${port}/v1/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text,
            from: from === 'auto' ? 'auto' : from,
            to,
            context: config?.context ?? '',
            system_prompt: config?.systemPrompt ?? '',
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? `Local Model translate error: ${res.status}`);
    }

    const data = await res.json();
    setResult(data.translated ?? '');
}
