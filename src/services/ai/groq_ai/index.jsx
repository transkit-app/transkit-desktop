import { callOpenAIChat } from '../_base';

export { info } from './info';

export async function summarize(text, options = {}) {
    const { config } = options;
    return callOpenAIChat(text, {
        requestPath: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        ...config,
    });
}

export * from './Config';
export * from './info';
