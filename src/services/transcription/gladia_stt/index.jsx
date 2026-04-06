export { info } from './info';
export { GladiaClient } from './client';
export * from './Config';

import { GladiaClient } from './client';
import { info } from './info';
import { createAsyncTranscriptionClient } from '../async_factory';

export function createClient(options = {}) {
    if (options.preferAsync) {
        const asyncClient = createAsyncTranscriptionClient(info.name);
        if (asyncClient) return asyncClient;
    }
    return new GladiaClient();
}
