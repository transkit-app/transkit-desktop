import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

export { info, Language } from './info';

export async function tts(text, lang, options = {}) {
    const { config } = options;
    const voice = config?.voice ?? 'vi-VN-HoaiMyNeural';
    const rate = config?.rate ?? '+0%';
    const pitch = config?.pitch ?? '+0Hz';
    const id = 'tts-' + Math.random().toString(36).slice(2);
    const chunks = [];

    return new Promise(async (resolve, reject) => {
        const unlistenChunk = await listen('edge_tts_chunk', ({ payload }) => {
            if (payload.id !== id) return;
            const bin = atob(payload.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            chunks.push(bytes);
        });

        const unlistenDone = await listen('edge_tts_done', ({ payload }) => {
            if (payload.id !== id) return;
            unlistenChunk();
            unlistenDone();
            if (payload.error) {
                reject(new Error(payload.error));
            } else {
                const total = chunks.reduce((a, b) => a + b.length, 0);
                const result = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
                resolve(Array.from(result));
            }
        });

        invoke('synthesize_edge_tts', { id, text, voice, rate, pitch }).catch(e => {
            unlistenChunk();
            unlistenDone();
            reject(e);
        });
    });
}

export * from './Config';
export * from './info';
