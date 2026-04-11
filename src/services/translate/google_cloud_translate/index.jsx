import { fetch } from '@tauri-apps/api/http';

export { info, Language } from './info';
export { Config } from './Config';

/**
 * Google Cloud Translation API v2.
 * Requires a Cloud Translation API key from Google Cloud Console.
 * Docs: https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */
export async function translate(text, from, to, options = {}) {
    const { config } = options;
    const apiKey = config?.apiKey;
    if (!apiKey) {
        throw new Error(
            'Google Cloud Translation API key is required. ' +
            'Configure it in Settings → Services → Translate.'
        );
    }

    const body = { q: text, target: to, format: 'text' };
    if (from && from !== 'auto') body.source = from;

    const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { type: 'Json', payload: body },
        }
    );

    if (!res.ok) {
        const errMsg = res.data?.error?.message ?? JSON.stringify(res.data);
        throw `Cloud Translation API error (${res.status}): ${errMsg}`;
    }

    const translated = res.data?.data?.translations?.[0]?.translatedText;
    if (translated == null) throw 'No translation returned from Cloud Translation API';
    return translated;
}
