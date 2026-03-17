import { fetch, ResponseType, Body } from '@tauri-apps/api/http';

export { info, Language } from './info';

export async function tts(text, lang, options = {}) {
    const { config } = options;
    const serverUrl = (config?.serverUrl ?? 'http://localhost:8080').replace(/\/+$/, '');
    const voice = config?.voice ?? 'alloy';
    const model = config?.model ?? 'tts-1';
    const apiKey = config?.apiKey ?? '';

    const res = await fetch(`${serverUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: Body.json({ input: text, voice, model }),
        responseType: ResponseType.Binary,
        timeout: 15,
    });
    if (res.ok) {
        return res.data;
    }
    throw new Error(`OpenAI TTS failed: ${res.status}`);
}

export * from './Config';
export * from './info';
