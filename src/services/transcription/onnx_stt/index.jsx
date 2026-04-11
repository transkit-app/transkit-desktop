import { OnnxSTTClient } from './client';
import { info } from './info';
import { Config } from './Config';

export { OnnxSTTClient as STTClient, info, Config };

export function createClient(options = {}) {
    return new OnnxSTTClient();
}
