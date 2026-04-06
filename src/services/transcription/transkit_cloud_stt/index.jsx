export { info } from './info';
export { TranskitCloudSTTClient } from './client';
export * from './Config';

import { TranskitCloudSTTClient } from './client';
import { info } from './info';
import { createAsyncTranscriptionClient } from '../async_factory';

export function createClient(options = {}) {
    if (options.preferAsync) {
        const asyncClient = createAsyncTranscriptionClient(info.name);
        if (asyncClient) return asyncClient;
    }
    return new TranskitCloudSTTClient();
}
