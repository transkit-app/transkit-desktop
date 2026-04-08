export { info } from './info';
export { Config } from './Config';

import { LocalSidecarSTTClient } from './client';
import { info } from './info';

export function createClient() {
    return new LocalSidecarSTTClient();
}
