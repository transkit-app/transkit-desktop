export { info } from './info';
export { GladiaClient } from './client';
export * from './Config';

import { GladiaClient } from './client';

export function createClient() {
    return new GladiaClient();
}
