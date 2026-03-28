export { info } from './info';
export { CustomSTTClient } from './client';
export * from './Config';

import { CustomSTTClient } from './client';

export function createClient() {
    return new CustomSTTClient();
}
