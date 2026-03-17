import { fetch, ResponseType } from '@tauri-apps/api/http';

export { info, Language } from './info';

export async function tts(text, lang, options = {}) {
    const { config } = options;
    const apiKey = config?.apiKey ?? '';
    const voiceId = config?.voiceId ?? 'FTYCiQT21H9XQvhRu0ch';
    const modelId = config?.modelId ?? 'eleven_flash_v2_5';

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: { type: 'Json', payload: { text, model_id: modelId } },
        responseType: ResponseType.Binary,
        timeout: 15,
    });
    if (res.ok) {
        return res.data;
    }
    throw new Error(`ElevenLabs TTS failed: ${res.status}`);
}

export * from './Config';
export * from './info';
