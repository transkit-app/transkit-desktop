/**
 * AI-powered Soniox context generation
 *
 * Given a user topic prompt and an AI service instance key,
 * calls the AI service and asks it to produce a complete Soniox
 * context object:
 *   {
 *     general: [{ key, value }],
 *     text: string,
 *     terms: string[],
 *     translation_terms: [{ source, target }]
 *   }
 */

import { store } from './store';
import { getServiceName } from './service_instance';
import * as aiServices from '../services/ai';

const SYSTEM_PROMPT = `You are a speech recognition context expert. The user will describe a topic or scenario they want to listen to and transcribe/translate.
Your job is to generate a Soniox STT context object that will improve transcription and translation accuracy.

Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "general": [
    { "key": "domain", "value": "..." },
    { "key": "topic", "value": "..." }
  ],
  "text": "A short paragraph describing the setting and context for this audio session.",
  "terms": ["term1", "term2"],
  "translation_terms": [
    { "source": "...", "target": "..." }
  ]
}

Rules:
- general: up to 8 key-value pairs describing domain, topic, setting, participants, organization, etc.
- text: 1-3 sentences of background context (≤ 300 chars)
- terms: important/uncommon vocabulary, brand names, technical terms, medications, people names that must be transcribed accurately (up to 30 terms)
- translation_terms: pairs where the translation of a specific word should be controlled (e.g. proper nouns, brand-specific names). Can be empty array if not needed.
- Keep ALL arrays non-null (use [] if empty)
- Output only the JSON object, nothing else`;

/**
 * Generate a Soniox context object from a topic description using AI.
 *
 * @param {string} topic - User's description of what they want to listen to
 * @param {string} aiServiceKey - Service instance key (e.g. "openai_ai@abc123")
 * @returns {Promise<{general, text, terms, translation_terms}>}
 */
export async function generateSonioxContext(topic, aiServiceKey) {
    if (!aiServiceKey) throw new Error('no_service');

    const serviceName = getServiceName(aiServiceKey);
    const service = aiServices[serviceName];
    if (!service?.summarize) throw new Error('no_service');

    const config = await store.get(aiServiceKey);

    const raw = await service.summarize(topic, {
        config: {
            ...config,
            systemPrompt: SYSTEM_PROMPT,
        },
    });

    // Strip markdown code fences if the model wraps output
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw new Error('parse_error');
    }

    return {
        general: Array.isArray(parsed.general) ? parsed.general : [],
        text: typeof parsed.text === 'string' ? parsed.text : '',
        terms: Array.isArray(parsed.terms) ? parsed.terms : [],
        translation_terms: Array.isArray(parsed.translation_terms) ? parsed.translation_terms : [],
    };
}
