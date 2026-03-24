export { info } from './info';
export { DeepgramClient } from './client';
export * from './Config';

import { DeepgramClient } from './client';

export function createClient() {
    return new DeepgramClient();
}
