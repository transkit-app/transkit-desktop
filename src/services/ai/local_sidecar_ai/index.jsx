import { invoke } from '@tauri-apps/api/tauri';

export { info } from './info';
export { Config } from './Config';

async function getSidecarPort() {
    const port = await invoke('local_sidecar_get_port').catch(() => 0);
    if (!port) throw new Error('Local Model is not running. Enable it in Settings → Local Model.');
    return port;
}

export async function summarize(text, options = {}) {
    const { config } = options;
    const port = await getSidecarPort();

    const messages = config?.promptList?.length
        ? config.promptList.map(m => ({
            role: m.role,
            content: m.content.replaceAll('$text', text),
          }))
        : [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user',   content: text },
          ];

    const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages,
            temperature: config?.temperature ?? 0.3,
            max_tokens:  config?.maxTokens  ?? 512,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? `Local Model AI error: ${res.status}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
}
