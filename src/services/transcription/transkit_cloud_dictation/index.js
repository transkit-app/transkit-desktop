export { info } from './info';
export { DictationClient } from './client';
export { Config } from './Config';

import { DictationClient } from './client';

export function createClient(_options = {}) {
    return new DictationClient();
}
