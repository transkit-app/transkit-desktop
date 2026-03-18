/**
 * AI-powered in-monitor suggestion generation.
 *
 * Returns:
 *   research:              deep explanation / background knowledge
 *   suggestedAnswerSource: ready-to-use reply in source language
 *   suggestedAnswerTarget: ready-to-use reply in target language
 *
 * responseLang controls which answer fields are populated:
 *   'both'   → both source and target
 *   'source' → source only (suggestedAnswerTarget will be empty)
 *   'target' → target only (suggestedAnswerSource will be empty)
 */

import { store } from './store';
import { getServiceName } from './service_instance';
import * as aiServices from '../services/ai';

function buildSystemPrompt(responseLang, sourceLang, targetLang) {
    const src = sourceLang || 'the source language';
    const tgt = targetLang || 'the target language';

    let answerInstruction;
    if (responseLang === 'both') {
        answerInstruction = `"suggestedAnswerSource": A natural reply in ${src}. "suggestedAnswerTarget": The same reply in ${tgt}.`;
    } else if (responseLang === 'source') {
        answerInstruction = `"suggestedAnswerSource": A natural reply in ${src}. "suggestedAnswerTarget": "" (empty string).`;
    } else {
        answerInstruction = `"suggestedAnswerSource": "" (empty string). "suggestedAnswerTarget": A natural reply in ${tgt}.`;
    }

    return `You are a real-time meeting/conversation assistant helping a listener follow and respond to live speech.

You will receive: the listener's profile, recent conversation context, and a specific line to help with.

Return ONLY valid JSON (no markdown, no code fences) in this exact shape:
{
  "research": "...",
  "suggestedAnswerSource": "...",
  "suggestedAnswerTarget": "..."
}

Field rules:
- "research": Explain the topic/question in the highlighted line. Provide useful background, definitions, or context. Be concise (2-4 sentences). Write in the most helpful language for the listener.
- ${answerInstruction}
- Keep answers professional and contextually appropriate.
- Output ONLY the JSON object, nothing else.`;
}

function buildUserPrompt(entry, contextEntries, userProfile) {
    const profileLines = [];
    if (userProfile?.name) profileLines.push(`Name: ${userProfile.name}`);
    if (userProfile?.role) profileLines.push(`Role: ${userProfile.role}`);
    if (userProfile?.company) profileLines.push(`Company: ${userProfile.company}`);
    if (userProfile?.experienceLevel) profileLines.push(`Experience: ${userProfile.experienceLevel}`);
    if (userProfile?.expertise?.length) profileLines.push(`Expertise: ${userProfile.expertise.join(', ')}`);
    if (userProfile?.notes) profileLines.push(`Notes: ${userProfile.notes}`);

    const profileSection = profileLines.length
        ? `=== LISTENER PROFILE ===\n${profileLines.join('\n')}`
        : '=== LISTENER PROFILE ===\n(No profile set)';

    const contextSection = contextEntries.length
        ? `=== RECENT CONVERSATION (last ${contextEntries.length} lines) ===\n${contextEntries
            .map((e, i) => `[${i + 1}] ${e.original ? `Original: "${e.original}" | ` : ''}Translation: "${e.translation}"`)
            .join('\n')}`
        : '=== RECENT CONVERSATION ===\n(No prior context)';

    const targetSection = `=== TARGET LINE ===\n${entry.original ? `Original: "${entry.original}"\n` : ''}Translation: "${entry.translation}"`;

    return `${profileSection}\n\n${contextSection}\n\n${targetSection}`;
}

/**
 * Generate an AI suggestion for a specific conversation entry.
 *
 * @param {object} params
 * @param {object} params.entry
 * @param {object[]} params.contextEntries
 * @param {object} params.userProfile
 * @param {string} params.aiServiceKey
 * @param {'both'|'source'|'target'} params.responseLang
 * @param {string} params.sourceLang
 * @param {string} params.targetLang
 * @returns {Promise<{ research, suggestedAnswerSource, suggestedAnswerTarget }>}
 */
export async function generateAiSuggestion({
    entry,
    contextEntries = [],
    userProfile = null,
    aiServiceKey,
    responseLang = 'both',
    sourceLang = 'en',
    targetLang = 'vi',
}) {
    if (!aiServiceKey) throw new Error('no_service');

    const serviceName = getServiceName(aiServiceKey);
    const service = aiServices[serviceName];
    if (!service?.summarize) throw new Error('no_service');

    const config = await store.get(aiServiceKey);
    const systemPrompt = buildSystemPrompt(responseLang, sourceLang, targetLang);
    const userPrompt = buildUserPrompt(entry, contextEntries, userProfile);

    const raw = await service.summarize(userPrompt, {
        config: { ...config, systemPrompt },
    });

    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        return { research: raw, suggestedAnswerSource: '', suggestedAnswerTarget: '' };
    }

    return {
        research: typeof parsed.research === 'string' ? parsed.research : '',
        suggestedAnswerSource: typeof parsed.suggestedAnswerSource === 'string' ? parsed.suggestedAnswerSource : '',
        suggestedAnswerTarget: typeof parsed.suggestedAnswerTarget === 'string' ? parsed.suggestedAnswerTarget : '',
    };
}
