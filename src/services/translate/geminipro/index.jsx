import { fetch, Body } from '@tauri-apps/api/http';
import { Language } from './info';

export async function translate(text, from, to, options = {}) {
    const { config, setResult, detect } = options;

    const appendGeminiText = (payload, target) => {
        let parsed;
        try {
            parsed = JSON.parse(payload);
        } catch {
            return { ok: false, target };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        let nextTarget = target;

        for (const item of items) {
            const parts = item?.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
                if (typeof part?.text === 'string' && part.text !== '') {
                    nextTarget += part.text;
                }
            }
        }

        if (nextTarget !== target) {
            if (setResult) {
                setResult(nextTarget + '_');
            } else {
                return { ok: true, target: '[STREAM]' };
            }
        }

        return { ok: true, target: nextTarget };
    };

    let { apiKey, stream, promptList, requestPath } = config;
    if (!requestPath) {
        requestPath = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';
    }
    if (!/https?:\/\/.+/.test(requestPath)) {
        requestPath = `https://${requestPath}`;
    }
    if (requestPath.endsWith('/')) {
        requestPath = requestPath.slice(0, -1);
    }
    requestPath = stream
        ? `${requestPath}:streamGenerateContent?alt=sse&key=${apiKey}`
        : `${requestPath}:generateContent?key=${apiKey}`;

    promptList = promptList.map((item) => {
        return {
            ...item,
            parts: [
                {
                    text: item.parts[0].text
                        .replaceAll('$text', text)
                        .replaceAll('$from', from)
                        .replaceAll('$to', to)
                        .replaceAll('$detect', Language[detect]),
                },
            ],
        };
    });

    const headers = {
        'Content-Type': 'application/json',
    };
    let body = {
        contents: promptList,
        safetySettings: [
            {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'BLOCK_NONE',
            },
            {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'BLOCK_NONE',
            },
            {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'BLOCK_NONE',
            },
            {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_NONE',
            },
        ],
    };

    if (stream) {
        const res = await window.fetch(requestPath, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
        });
        if (res.ok) {
            let target = '';
            const reader = res.body.getReader();
            try {
                let lineBuffer = '';
                let pendingPayload = '';
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (pendingPayload) {
                            const parsed = appendGeminiText(pendingPayload, target);
                            if (parsed.ok) {
                                target = parsed.target;
                            }
                        }
                        setResult(target.trim());
                        return target.trim();
                    }

                    lineBuffer += decoder.decode(value, { stream: true });
                    const lines = lineBuffer.split(/\r?\n/);
                    lineBuffer = lines.pop() ?? '';

                    for (const rawLine of lines) {
                        const line = rawLine.trim();
                        if (!line || !line.startsWith('data:')) {
                            continue;
                        }

                        let payload = line.slice(5).trim();
                        if (payload === '' || payload === '[DONE]') {
                            continue;
                        }

                        if (pendingPayload) {
                            payload = pendingPayload + payload;
                        }

                        const parsed = appendGeminiText(payload, target);
                        if (!parsed.ok) {
                            pendingPayload = payload;
                            continue;
                        }

                        pendingPayload = '';
                        target = parsed.target;
                        if (target === '[STREAM]') {
                            return target;
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } else {
            throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`;
        }
    } else {
        let res = await fetch(requestPath, {
            method: 'POST',
            headers: headers,
            body: Body.json(body),
        });

        if (res.ok) {
            let result = res.data;
            const { candidates } = result;
            if (candidates) {
                let target = candidates[0].content.parts[0].text.trim();
                if (target) {
                    if (target.startsWith('"')) {
                        target = target.slice(1);
                    }
                    if (target.endsWith('"')) {
                        target = target.slice(0, -1);
                    }
                    return target.trim();
                } else {
                    throw JSON.stringify(candidates);
                }
            } else {
                throw JSON.stringify(result);
            }
        } else {
            throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`;
        }
    }
}

export * from './Config';
export * from './info';
