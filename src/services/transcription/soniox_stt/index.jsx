export { info } from './info';
export { SonioxClient } from './client';
export * from './Config';

import { SonioxClient } from './client';
import { info } from './info';
import { createAsyncTranscriptionClient } from '../async_factory';

export function createClient(options = {}) {
    if (options.preferAsync) {
        const asyncClient = createAsyncTranscriptionClient(info.name);
        if (asyncClient) return asyncClient;
    }
    return new SonioxClient();
}
