import { fetch, Body } from '@tauri-apps/api/http';

export { info } from './info';

const DEFAULT_SYSTEM_PROMPT =
    'You are a professional translation assistant. Synthesize the provided translations into one clear, accurate, and natural result. Output only the final translation without explanation.';

export async function summarize(text, options = {}) {
    const { config } = options;
    const apiKey = config?.apiKey ?? '';
    const model = config?.model ?? 'gemini-2.0-flash';
    const systemPrompt = config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Body.json({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text }] }],
        }),
        timeout: 30,
    });

    if (res.ok) {
        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    throw new Error(`Gemini request failed: ${res.status} ${JSON.stringify(res.data)}`);
}

export * from './Config';
export * from './info';
