import { callCloudAI, CLOUD_ENABLED } from '../../../lib/transkit-cloud';
import { Language } from './info';

export { info, Language } from './info';
export * from './Config';

/**
 * Transkit Cloud Translate
 * Routes translation requests through Transkit Cloud backend (Gemini 2.5 Flash).
 * No API key required — uses the user's cloud session.
 *
 * @param {string} text
 * @param {string} from - Source language (Language enum value, e.g. 'auto', 'English')
 * @param {string} to   - Target language (Language enum value, e.g. 'Vietnamese')
 * @param {{ config?: object }} options
 * @returns {Promise<string>} - Translated text
 */
export async function translate(text, from, to, options = {}) {
    if (!CLOUD_ENABLED) throw new Error('cloud_disabled');

    const result = await callCloudAI(
        [{ role: 'user', content: text }],
        'translate',
        { source_lang: from, target_lang: to }
    );

    return result.text.trim();
}
