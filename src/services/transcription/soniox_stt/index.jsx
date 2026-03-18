export { info } from './info';
export { SonioxClient } from './client';
export * from './Config';

import { SonioxClient } from './client';

export function createClient() {
    return new SonioxClient();
}
