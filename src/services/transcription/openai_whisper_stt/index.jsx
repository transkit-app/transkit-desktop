export { info } from './info';
export { OpenAIWhisperClient } from './client';
export * from './Config';

import { OpenAIWhisperClient } from './client';

export function createClient() {
    return new OpenAIWhisperClient();
}
