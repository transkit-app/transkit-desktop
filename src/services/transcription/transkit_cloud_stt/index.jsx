export { info } from './info';
export { TranskitCloudSTTClient } from './client';
export * from './Config';

import { TranskitCloudSTTClient } from './client';

export function createClient() {
    return new TranskitCloudSTTClient();
}
