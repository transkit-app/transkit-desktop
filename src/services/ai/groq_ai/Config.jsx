import { makeAiConfig } from '../_BaseConfig';
import { summarize } from './index';

export const Config = makeAiConfig(
    'groq_ai',
    { requestPath: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    summarize
);
