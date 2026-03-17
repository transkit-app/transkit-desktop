import { fetch, Body } from '@tauri-apps/api/http';

export { info } from './info';

export async function summarize(text, options = {}) {
    const { config } = options;
    const requestPath = (config?.requestPath ?? 'https://api.openai.com/v1/chat/completions').replace(/\/+$/, '');
    const apiKey = config?.apiKey ?? '';
    const model = config?.model ?? 'gpt-4o-mini';
    const systemPrompt = config?.systemPrompt ?? 'You are a professional translation assistant. Synthesize the provided translations into one clear, accurate, and natural result.';

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
    ];

    const res = await fetch(requestPath, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: Body.json({ model, messages, stream: false }),
        timeout: 30,
    });

    if (res.ok) {
        return res.data?.choices?.[0]?.message?.content ?? '';
    }
    throw new Error(`AI request failed: ${res.status}`);
}

export * from './Config';
export * from './info';
