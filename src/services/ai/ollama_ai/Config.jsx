import { makeAiConfig } from '../_BaseConfig';
import { summarize } from './index';

export const Config = makeAiConfig(
    'ollama_ai',
    { requestPath: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2' },
    summarize
);
