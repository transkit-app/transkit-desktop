import { makeAiConfig } from '../_BaseConfig';
import { summarize } from './index';

export const Config = makeAiConfig(
    'openai_ai',
    { requestPath: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    summarize
);
