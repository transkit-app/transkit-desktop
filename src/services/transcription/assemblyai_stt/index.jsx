export { info } from './info';
export { AssemblyAIClient } from './client';
export * from './Config';

import { AssemblyAIClient } from './client';

export function createClient() {
    return new AssemblyAIClient();
}
