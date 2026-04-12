/**
 * Voice Anywhere — Transcript Polish utility
 *
 * Runs the raw STT transcript through an AI service to improve quality.
 * Built-in levels have default prompts that can be overridden per-user.
 * Custom levels (user-defined) store their prompt directly.
 */

import { store } from './store';
import { getServiceName } from './service_instance';
import * as aiServices from '../services/ai';

export const BUILTIN_LEVELS = ['mild', 'medium', 'aggressive'];

export const POLISH_LEVEL_LABELS = {
    mild:       'Mild — Correct transcript',
    medium:     'Medium — Improve fluency',
    aggressive: 'Aggressive — Restructure & format',
};

export const DEFAULT_PROMPTS = {
    mild: `You are a transcript corrector.
Fix only obvious typos, grammar errors, and punctuation mistakes in the transcript below.
Do NOT change meaning, tone, word choice, or structure.
Output only the corrected transcript — no explanations, no commentary.`,

    medium: `You are a transcript editor.
Improve the fluency of the following spoken transcript:
- Remove filler words (um, uh, like, you know, so, basically)
- Fix run-on sentences and false starts
- Smooth out awkward phrasing
- Keep the original meaning and intent completely intact
Output only the improved transcript — no explanations, no commentary.`,

    aggressive: `You are a transcript-to-prose converter.
Process the transcript into polished written prose:
- Fix spelling, capitalization, and punctuation
- Remove filler words and stutters
- Group sentences into paragraphs by rhetorical function
- When the speaker lists parallel items, format them as a numbered list
Output only the final polished text — no explanations, no commentary.`,
};

/**
 * Polish a transcript using the specified AI service.
 *
 * @param {string} text          — raw transcript from STT
 * @param {object} opts
 * @param {string} opts.prompt       — the system prompt to use (already resolved by caller)
 * @param {string} opts.aiServiceKey — e.g. 'openai_ai', 'groq_ai@abc123'
 * @returns {Promise<string>}
 */
export async function polishTranscript(text, { prompt, aiServiceKey, targetLanguage }) {
    if (!text?.trim()) return text;
    if (!aiServiceKey) throw new Error('No AI service configured for Polish.');

    const serviceName = getServiceName(aiServiceKey);
    const service = aiServices[serviceName];
    if (!service?.summarize) {
        throw new Error(`AI service "${serviceName}" does not support text generation.`);
    }

    const config = (await store.get(aiServiceKey)) ?? {};
    let systemPrompt = prompt || DEFAULT_PROMPTS.mild;

    // If a target language is set, instruct the AI to also translate.
    // This covers STT services that don't support translation (e.g. ONNX, MLX).
    if (targetLanguage && targetLanguage !== 'none') {
        systemPrompt += `\nOutput the final result in this language: ${targetLanguage}.`;
    }

    return service.summarize(text, { config: { ...config, systemPrompt } });
}

/** Friendly display label for an AI service key */
export const AI_SERVICE_FRIENDLY_NAMES = {
    openai_ai:         'OpenAI',
    groq_ai:           'Groq',
    gemini_ai:         'Gemini',
    ollama_ai:         'Ollama',
    openai_compat_ai:  'OpenAI Compatible',
    transkit_cloud_ai: 'Transkit Cloud',
    local_sidecar_ai:  'Local Model',
};
