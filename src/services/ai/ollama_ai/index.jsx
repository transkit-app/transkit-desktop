import { callOpenAIChat } from '../_base';

export { info } from './info';

export async function summarize(text, options = {}) {
    const { config } = options;
    return callOpenAIChat(text, {
        requestPath: 'http://localhost:11434/v1/chat/completions',
        apiKey: 'ollama',
        model: 'llama3.2',
        ...config,
    });
}

export * from './Config';
export * from './info';
