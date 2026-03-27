import { callCloudAI, CLOUD_ENABLED } from '../../../lib/transkit-cloud';

export { info } from './info';
export * from './Config';

/**
 * Transkit Cloud AI
 * Routes AI suggestion requests through the Transkit Cloud backend (Gemini 2.5 Flash).
 * No API key required — uses the user's cloud session.
 *
 * @param {string} text - User prompt (system prompt is passed via config.systemPrompt)
 * @param {{ config?: object }} options
 * @returns {Promise<string>} - AI-generated text
 */
export async function summarize(text, options = {}) {
    if (!CLOUD_ENABLED) throw new Error('cloud_disabled');

    const { config } = options;
    const systemPrompt = config?.systemPrompt;

    const messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: text });

    const result = await callCloudAI(messages, 'ai');
    return result.text;
}
