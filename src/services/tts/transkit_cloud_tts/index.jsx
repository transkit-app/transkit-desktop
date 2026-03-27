import { callCloudTTS, CLOUD_ENABLED } from '../../../lib/transkit-cloud';

export { info, Language } from './info';
export * from './Config';

/**
 * Transkit Cloud TTS
 * Proxies text-to-speech through the Transkit Cloud backend.
 * No API key required — uses the user's cloud session.
 *
 * @param {string} text
 * @param {string} lang - Language code from Language enum
 * @param {{ config?: object }} options
 * @returns {Promise<number[]>} - Binary audio data (audio/mpeg)
 */
export async function tts(text, lang, options = {}) {
    if (!CLOUD_ENABLED) throw new Error('cloud_disabled');

    const { config } = options;
    const voiceId = config?.voiceId ?? 'auto';

    const arrayBuffer = await callCloudTTS(text, voiceId, lang);
    // Convert ArrayBuffer to number[] to match the binary format returned
    // by other TTS providers using Tauri's ResponseType.Binary
    return Array.from(new Uint8Array(arrayBuffer));
}
