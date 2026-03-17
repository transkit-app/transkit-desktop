import { fetch, ResponseType } from '@tauri-apps/api/http';

export { info, Language } from './info';

export async function tts(text, lang, options = {}) {
    const { config } = options;
    const l = config?.lang ?? lang ?? 'vi';
    const speed = config?.speed ?? 1;
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${l}&client=tw-ob&ttsspeed=${speed}`;
    const res = await fetch(url, { method: 'GET', responseType: ResponseType.Binary, timeout: 10 });
    if (res.ok) {
        return res.data;
    }
    throw new Error(`Google TTS failed: ${res.status}`);
}

export * from './Config';
export * from './info';
