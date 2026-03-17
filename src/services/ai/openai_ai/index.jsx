import { callOpenAIChat } from '../_base';

export { info } from './info';

export async function summarize(text, options = {}) {
    const { config } = options;
    return callOpenAIChat(text, {
        requestPath: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        ...config,
    });
}

export * from './Config';
export * from './info';
