import { fetch, ResponseType, Body } from '@tauri-apps/api/http';

export { info, Language } from './info';

export async function tts(text, lang, options = {}) {
    const { config } = options;
    const serverUrl = (config?.serverUrl ?? 'http://localhost:8001').replace(/\/+$/, '');
    const voiceId = config?.voiceId ?? 'NgocHuyen';
    const model = config?.model ?? '';

    const res = await fetch(`${serverUrl}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Body.json({ text, voice: voiceId, model }),
        responseType: ResponseType.Binary,
        timeout: 15,
    });
    if (res.ok) {
        return res.data;
    }
    throw new Error(`VieNeu TTS failed: ${res.status}`);
}

export * from './Config';
export * from './info';
