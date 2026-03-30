/**
 * AI-powered in-monitor suggestion generation.
 *
 * Supports multiple modes in one call (combined prompt → single API request):
 *   'suggest_answer' — research + suggested replies
 *   'quick_insight'  — key point + next step
 *   'summarize'      — bullet-point summary of recent context
 *   'follow_up'      — follow-up questions to ask
 *
 * Returns a result object with fields for all requested modes, plus a `modes` array.
 */

import { store } from './store';
import { getServiceName } from './service_instance';
import * as aiServices from '../services/ai';

// ── Combined system prompt builder ────────────────────────────────────────────

function buildSystemPrompt(modes, responseLang, sourceLang, targetLang) {
    const src = sourceLang || 'the source language';
    const tgt = targetLang || 'the target language';

    const sections = [];
    const fields = [];

    if (modes.includes('suggest_answer')) {
        let answerInstruction;
        if (responseLang === 'both') {
            answerInstruction = `"suggestedAnswerSource": a natural reply in ${src}; "suggestedAnswerTarget": the same reply in ${tgt}`;
        } else if (responseLang === 'source') {
            answerInstruction = `"suggestedAnswerSource": a natural reply in ${src}; "suggestedAnswerTarget": ""`;
        } else {
            answerInstruction = `"suggestedAnswerSource": ""; "suggestedAnswerTarget": a natural reply in ${tgt}`;
        }
        sections.push(`SUGGEST ANSWER: Explain the highlighted line (2-4 sentences, "research"). Also provide "research_t" (research translated to ${tgt}). Provide ${answerInstruction}.`);
        fields.push('"research": "..."', '"research_t": "..."', '"suggestedAnswerSource": "..."', '"suggestedAnswerTarget": "..."');
    }

    if (modes.includes('quick_insight')) {
        sections.push(`QUICK INSIGHT: Identify the single most important point ("key_point") and the best next step for the listener ("suggested_next_step"). One sentence each. Be factual. Also provide "key_point_t" (key_point translated to ${tgt}) and "suggested_next_step_t" (suggested_next_step translated to ${tgt}).`);
        fields.push('"key_point": "..."', '"key_point_t": "..."', '"suggested_next_step": "..."', '"suggested_next_step_t": "..."');
    }

    if (modes.includes('summarize')) {
        sections.push(`SUMMARIZE: List confirmed facts and decisions from the recent context as "bullet_points" (array of strings). No speculation. Also provide "bullet_points_t" (each bullet translated to ${tgt}, same order and count).`);
        fields.push('"bullet_points": ["...", "..."]', '"bullet_points_t": ["...", "..."]');
    }

    if (modes.includes('follow_up')) {
        sections.push(`FOLLOW-UP: List practical, specific questions the listener should ask as "questions" (array of strings). Also provide "questions_t" (each question translated to ${tgt}, same order and count).`);
        fields.push('"questions": ["...", "..."]', '"questions_t": ["...", "..."]');
    }

    return `You are a real-time meeting/conversation assistant helping a listener follow and respond to live speech.

You will receive the listener's profile, recent conversation context, and the highlighted line.

Provide ALL of the following analysis sections:
${sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY valid JSON (no markdown, no code fences) with EXACTLY these fields:
{
  ${fields.join(',\n  ')}
}

Output ONLY the JSON object. No other text.`;
}

// ── User prompt (shared across all modes) ─────────────────────────────────────

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

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJSON(raw) {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no_json');
    return JSON.parse(match[0]);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {object} params.entry
 * @param {object[]} params.contextEntries
 * @param {object} params.userProfile
 * @param {string} params.aiServiceKey
 * @param {string[]} params.modes  — e.g. ['suggest_answer', 'quick_insight']
 * @param {'both'|'source'|'target'} params.responseLang  — for suggest_answer
 * @param {string} params.sourceLang
 * @param {string} params.targetLang
 */
export async function generateAiSuggestion({
    entry,
    contextEntries = [],
    userProfile = null,
    aiServiceKey,
    modes = ['suggest_answer'],
    responseLang = 'both',
    sourceLang = 'en',
    targetLang = 'vi',
}) {
    if (!aiServiceKey) throw new Error('no_service');

    const activeModes = Array.isArray(modes) && modes.length > 0 ? modes : ['suggest_answer'];

    const serviceName = getServiceName(aiServiceKey);
    const service = aiServices[serviceName];
    if (!service?.summarize) throw new Error('no_service');

    const config = await store.get(aiServiceKey);
    const systemPrompt = buildSystemPrompt(activeModes, responseLang, sourceLang, targetLang);
    const userPrompt = buildUserPrompt(entry, contextEntries, userProfile);

    const raw = await service.summarize(userPrompt, { config: { ...config, systemPrompt } });

    let parsed;
    try {
        parsed = extractJSON(raw);
    } catch {
        // Fallback: surface raw text as research
        return {
            modes: activeModes, responseLang,
            research: raw.slice(0, 300), research_t: '',
            suggestedAnswerSource: '', suggestedAnswerTarget: '',
            key_point: '', key_point_t: '', suggested_next_step: '', suggested_next_step_t: '',
            bullet_points: [], bullet_points_t: [], questions: [], questions_t: [],
        };
    }

    return {
        modes: activeModes, responseLang,
        research: typeof parsed.research === 'string' ? parsed.research : '',
        research_t: typeof parsed.research_t === 'string' ? parsed.research_t : '',
        suggestedAnswerSource: typeof parsed.suggestedAnswerSource === 'string' ? parsed.suggestedAnswerSource : '',
        suggestedAnswerTarget: typeof parsed.suggestedAnswerTarget === 'string' ? parsed.suggestedAnswerTarget : '',
        key_point: typeof parsed.key_point === 'string' ? parsed.key_point : '',
        key_point_t: typeof parsed.key_point_t === 'string' ? parsed.key_point_t : '',
        suggested_next_step: typeof parsed.suggested_next_step === 'string' ? parsed.suggested_next_step : '',
        suggested_next_step_t: typeof parsed.suggested_next_step_t === 'string' ? parsed.suggested_next_step_t : '',
        bullet_points: Array.isArray(parsed.bullet_points) ? parsed.bullet_points : [],
        bullet_points_t: Array.isArray(parsed.bullet_points_t) ? parsed.bullet_points_t : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        questions_t: Array.isArray(parsed.questions_t) ? parsed.questions_t : [],
    };
}
