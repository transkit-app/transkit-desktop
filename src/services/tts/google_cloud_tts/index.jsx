import { fetch } from '@tauri-apps/api/http';

export { info, Language } from './info';
export * from './Config';

/**
 * Google Cloud Text-to-Speech — Chirp3-HD
 *
 * Docs: https://cloud.google.com/text-to-speech/docs/chirp3-hd
 *
 * @param {string} text       - Text to synthesize (max 5 000 bytes)
 * @param {string} lang       - BCP-47 language code from Language enum (e.g. "en-US")
 * @param {{ config?: object }} options
 * @returns {Promise<number[]>} - MP3 binary data
 */
export async function tts(text, lang, options = {}) {
    const { config } = options;
    const apiKey = config?.apiKey ?? '';
    const voice = config?.voice ?? 'Charon';
    const speakingRate = parseFloat(config?.speakingRate ?? '1.0');
    const pitch = parseFloat(config?.pitch ?? '0');

    if (!apiKey) throw new Error('Google Cloud API key is required');

    // Voice name format: {languageCode}-Chirp3-HD-{personality}
    const voiceName = `${lang}-Chirp3-HD-${voice}`;

    const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
                type: 'Json',
                payload: {
                    input: { text },
                    voice: { languageCode: lang, name: voiceName },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        speakingRate: isNaN(speakingRate) ? 1.0 : speakingRate,
                        pitch: isNaN(pitch) ? 0 : pitch,
                    },
                },
            },
            timeout: 30,
        }
    );

    if (!res.ok) {
        const errMsg = res.data?.error?.message ?? res.status;
        throw new Error(`Google Cloud TTS failed: ${errMsg}`);
    }

    // Response: { audioContent: "<base64 MP3>" }
    const base64 = res.data?.audioContent;
    if (!base64) throw new Error('Google Cloud TTS: empty audioContent in response');

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(bytes);
}
