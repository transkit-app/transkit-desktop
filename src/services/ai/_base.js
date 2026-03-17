import { fetch, Body } from '@tauri-apps/api/http';

export async function callOpenAIChat(text, config) {
    const requestPath = (config?.requestPath ?? 'https://api.openai.com/v1/chat/completions').replace(/\/+$/, '');
    const apiKey = config?.apiKey ?? '';
    const model = config?.model ?? 'gpt-4o-mini';
    const systemPrompt =
        config?.systemPrompt ??
        'You are a professional translation assistant. Synthesize the provided translations into one clear, accurate, and natural result. Output only the final translation without explanation.';

    const res = await fetch(requestPath, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: Body.json({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], stream: false }),
        timeout: 30,
    });

    if (res.ok) {
        return res.data?.choices?.[0]?.message?.content ?? '';
    }
    throw new Error(`AI request failed: ${res.status}`);
}
